# Hermes ↔ Know Canvas 反向调用集成

> **给谁看**: Hermes Agent 团队 (实现 telegram bot 推送的人)
> **目标**: 让 Hermes 能反向调用 know-canvas 画布, 投任务并接收完成回调

---

## 架构 (一图看懂)

```
Telegram User
     │ /画布 在上海开一家咖啡馆
     ▼
Hermes Agent (VPS)
     │ POST /api/submit          ← 你只需要做这一步
     ▼
know-canvas cli-bridge :17082    ← 我这边管的
     │ yjs WebSocket
     ▼
y-ws-server :1234 (Yjs 黑板)
     │ 节点出现
     ▼
画布前端任意 tab → 跑 _runHtmlAnswer → 写回 yjs
     │ taskStatus 变化
     ▼
cli-bridge watcher 触发 callback
     │ POST {node_id, status, html}    ← 你这边接 callback
     ▼
Hermes telegram bot.send(...)   ← 推回用户
```

**关键设计**: 画布状态唯一权威是 Yjs 黑板。cli-bridge 只是 *注入器 + watcher*, 不是 task queue, 也不存任务。所以重启 cli-bridge 不会丢数据 (yjs 仍在), 但**进行中的 callback 会丢** (重启前未完成的回调不会重发)。

---

## API

### POST /api/submit

投递一个画布任务。

**请求**:
```bash
curl -X POST http://127.0.0.1:17082/api/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "在上海开一家咖啡馆需要哪些资源",
    "mode": "meta",
    "room": "demo-railway",
    "callback_url": "http://127.0.0.1:18000/canvas-callback",
    "callback_token": "随机生成的 token, 后面 callback 会原样回传"
  }'
```

**字段**:
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | ✓ | 要投到画布底部 AI 输入框的文本 |
| `mode` | `meta` \| `hermes` | × | 默认 `meta` (画布元认知 LLM 路线), `hermes` 走 Hermes 派单 |
| `room` | string | × | 默认 `demo-railway`, 画布房间 ID |
| `callback_url` | string | × | 状态变化时 POST 到这里。不填就只投递不回调 |
| `callback_token` | string | × | 任意字符串, 后续 callback 走 header `X-Canvas-Token` 原样回传, 用来验证来源 |

**响应**:
```json
{
  "ok": true,
  "node_id": "htmlpage-1730000000000-abc123",
  "room": "demo-railway",
  "mode": "meta",
  "watch_url": "https://ha2.digitalvio.shop/canvas/?room=demo-railway&focus=htmlpage-1730000000000-abc123"
}
```

把 `watch_url` 一起发给 Telegram 用户, 用户点进去就能在画布里看到。

---

### Callback 协议 (你要实现的接收端)

cli-bridge 在以下 3 个时机会 POST 到你的 `callback_url`:

| 时机 | status | 携带字段 |
|---|---|---|
| 节点创建后立即 | `pending` | `prompt`, `mode`, `room` |
| LLM/Hermes 启动 | `running` | `prompt`, `mode`, `room` |
| 完成 | `done` | `prompt`, `mode`, `room`, `html` |
| 失败 | `failed` | `prompt`, `mode`, `room`, `error` |

**Header**: `X-Canvas-Token: <你 submit 时传的 callback_token>`

**Body 示例**:
```json
{
  "node_id": "htmlpage-1730000000000-abc123",
  "status": "done",
  "prompt": "在上海开一家咖啡馆需要哪些资源",
  "mode": "meta",
  "room": "demo-railway",
  "html": "<!DOCTYPE html>..."
}
```

**重试**: callback POST 失败时 cli-bridge 会退避重试 3 次 (5s / 15s / 30s), 之后放弃。如果你的接收端会暂时挂掉, 不用担心丢失太多。

**幂等**: 同一个 `(node_id, status)` 边沿只触发 1 次。但**重启 cli-bridge 后所有 watcher 丢失**, 已 done 的任务不会重发 — 你需要自己去 `GET /api/status/:nodeId?room=...` 兜底查询。

---

### GET /api/status/:nodeId?room=...

主动查询节点当前状态 (兜底用)。

**响应**:
```json
{
  "ok": true,
  "node_id": "htmlpage-...",
  "room": "demo-railway",
  "status": "done",
  "prompt": "...",
  "mode": "meta",
  "html": "<!DOCTYPE...>",
  "error": "",
  "tasks": [
    { "label": "解析输入意图", "status": "done" },
    { "label": "推理 5 维度元认知", "status": "done" },
    { "label": "渲染 HTML 页面", "status": "done" }
  ]
}
```

---

### GET /health

健康检查。

```json
{
  "ok": true,
  "service": "know-canvas-cli-bridge",
  "version": "0.1.0",
  "port": 17082,
  "yws_url": "ws://127.0.0.1:1234",
  "room_count": 1,
  "watcher_count": 3,
  "rooms": ["demo-railway"]
}
```

---

## Hermes 端集成示例 (Python)

```python
import secrets
import requests
from fastapi import FastAPI, Request, Header, HTTPException

app = FastAPI()

# 内存里存 callback_token → telegram chat_id 的映射 (重启会丢, 生产建议用 redis)
PENDING = {}  # node_id -> {chat_id, token}

@app.post('/canvas-dispatch')
async def canvas_dispatch(req: Request):
    """Telegram bot handler 调这里"""
    body = await req.json()
    chat_id = body['chat_id']
    prompt = body['prompt']

    token = secrets.token_urlsafe(16)
    r = requests.post(
        'http://127.0.0.1:17082/api/submit',
        json={
            'prompt': prompt,
            'mode': 'meta',
            'room': 'demo-railway',
            'callback_url': 'http://127.0.0.1:18000/canvas-callback',
            'callback_token': token,
        },
        timeout=10,
    )
    data = r.json()
    if not data.get('ok'):
        return {'ok': False, 'error': data.get('error')}

    node_id = data['node_id']
    PENDING[node_id] = {'chat_id': chat_id, 'token': token}

    # 立即回复用户
    telegram.send_message(
        chat_id,
        f"✓ 已投到画布\n查看: {data['watch_url']}\n等结果中..."
    )
    return {'ok': True, 'node_id': node_id}


@app.post('/canvas-callback')
async def canvas_callback(req: Request, x_canvas_token: str = Header(None)):
    """cli-bridge 推回来"""
    payload = await req.json()
    node_id = payload['node_id']

    pending = PENDING.get(node_id)
    if not pending:
        # 未知 node_id (可能 cli-bridge 重启过, 或者别人投的) — 静默忽略
        return {'ok': True, 'note': 'unknown node_id'}

    if x_canvas_token != pending['token']:
        raise HTTPException(403, 'token mismatch')

    chat_id = pending['chat_id']
    status = payload['status']

    if status == 'running':
        telegram.send_message(chat_id, f"⏳ 画布已开始处理 {node_id[:14]}...")
    elif status == 'done':
        msg = (
            f"✓ 画布任务完成 {node_id[:14]}\n"
            f"输入: {payload['prompt'][:80]}\n"
            f"→ 查看: http://canvas.digitalvio.shop/canvas/?room=demo-railway&focus={node_id}"
        )
        telegram.send_message(chat_id, msg)
        PENDING.pop(node_id, None)
    elif status == 'failed':
        telegram.send_message(
            chat_id,
            f"✗ 画布任务失败 {node_id[:14]}\n错误: {payload.get('error', '未知')}"
        )
        PENDING.pop(node_id, None)
    # status == 'pending' 不发, 太啰嗦

    return {'ok': True}
```

---

## 命令行测试 (不用集成代码也能跑通)

`cli/know-canvas` 是个 Node 单文件 CLI, 直接调本机 cli-bridge:

```bash
# 健康检查
./cli/know-canvas health

# 派单 + 等结果
./cli/know-canvas submit "在上海开一家咖啡馆" --mode meta --wait

# 异步派单, 后续主动查
./cli/know-canvas submit "..." --json
# {"ok":true,"node_id":"htmlpage-...","room":"demo-railway",...}
./cli/know-canvas status htmlpage-... --room demo-railway

# 流式订阅 (SSE) 当前 room 所有 htmlPageNode 状态变更
./cli/know-canvas tail --room demo-railway
```

---

## 已知限制 / 黑客松简化

1. **callback_token 不验签** — 仅原样回传, Hermes 端要自己 verify (上面示例里有)
2. **重启丢 watcher** — cli-bridge 重启后, 进行中的 callback 全部丢失。重启前已 done 的任务不会重新推 callback。Hermes 端要靠 polling status 兜底
3. **首条事件 race** — 已修复: observer 必须先于 nodesMap.set 注册 (代码里有注释)
4. **多 room 隔离** — submit 时指定不同 room 即可, daemon 内部用引用计数管理 ydoc/provider 连接, refCount 归零 + 5 分钟闲置后才真关
5. **没有鉴权** — cli-bridge 监听 127.0.0.1, 假设 VPS 上同主机访问就是可信的。如果要暴露公网, 加 reverse proxy + auth

---

## 排错速查

```bash
# cli-bridge 起来没?
curl -s http://127.0.0.1:17082/health | jq

# yws 起来没?
curl -s http://127.0.0.1:1234/health | jq

# 看 cli-bridge 日志
sudo journalctl -u know-canvas-cli-bridge -f --since "5 min ago"

# 手动投一个测试任务
curl -X POST http://127.0.0.1:17082/api/submit \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"hello", "mode":"meta"}' | jq

# 然后浏览器开 https://ha2.digitalvio.shop/canvas/?room=demo-railway 看节点是否出现
```

---

## 联系 / 锁

改 cli-bridge 集成相关代码请先在 `docs/CC-HANDOFF.md` 里画个锁, 避免多 cc 撞车。
