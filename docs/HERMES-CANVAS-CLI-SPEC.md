# Know Canvas ⇄ Hermes CLI 接入规范 v1.0

> 给 Hermes Agent (或任何外部 HTTP 客户端) 反向调用 Know Canvas 的协议。
> Hermes 派单一句话 → Canvas 上长出节点 → 远端 LLM 跑完 → callback 回 Hermes。

**当前线上端点**:
- 入口 (Hermes → Canvas): `https://ha2.digitalvio.shop/canvas/cli/api/submit`
- 健康检查: `https://ha2.digitalvio.shop/canvas/cli/health`
- 协议版本: `1.0` · daemon 版本: `0.1.0`
- 联系人: 你想猫 (lichang) · room=`demo-railway`

---

## 1. 体系结构

```
┌──────────────┐                                ┌──────────────┐
│   Hermes     │   ① POST /api/submit           │   Canvas     │
│   Agent      │ ─────────────────────────────► │   CLI        │
│              │                                │   Bridge     │
│              │ ◄───────────────────────────── │   :17082     │
│              │   ④ POST {callback_url}         └──────┬───────┘
│              │      (status: pending/running/         │
│              │       done/failed)                     │ Yjs WS
└──────────────┘                                        ▼
                                                  ┌──────────────┐
                                                  │ y-ws-server  │
                                                  │   :1234      │
                                                  └──────┬───────┘
                                                         │ broadcast
                                                         ▼
                                                  ┌──────────────┐
                                                  │  Canvas 前端  │
                                                  │   (浏览器)    │
                                                  │  ② 看到节点    │
                                                  │  ③ 跑 LLM    │
                                                  └──────────────┘
```

**节点状态权威 = Yjs 黑板**。
CLI Bridge 只做注入 + watcher，不是 task queue。
任意一个浏览器 tab 进入 `room` 都会跑 LLM 把节点写完。

---

## 2. 端点

### 2.1 `POST /api/submit` — 派单
派一句话 prompt，在 Canvas 上长出一个 `htmlPageNode`，状态机 `pending → running → done|failed`。

**请求**:
```json
{
  "prompt": "在上海开一家精品咖啡馆, 启动资金 50w",
  "mode": "meta",
  "room": "demo-railway",
  "callback_url": "https://hermes.example.com/api/canvas-callback",
  "callback_token": "secret-shared-with-hermes"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | ✅ | 一句话任务描述, ≤ 2000 字符 |
| `mode` | `"meta"` \| `"hermes"` | 否 | 默认 `meta` (元认知 5 维度 HTML); `hermes` 为反向回包模式 |
| `room` | string | 否 | 默认 `demo-railway`; Hermes 与 Canvas 必须用同一 room 才能联调 |
| `callback_url` | string | 否 | 节点状态变化时 Canvas 反向 POST 的 URL; **不传则只能轮询 status** |
| `callback_token` | string | 否 | 透传到 callback 的 `X-Canvas-Token` header, 用于 Hermes 校验来源 |

**响应** (`200`):
```json
{
  "ok": true,
  "node_id": "htmlpage-1736912345678-xy7zk2",
  "room": "demo-railway",
  "mode": "meta",
  "watch_url": "https://ha2.digitalvio.shop/canvas/?room=demo-railway&focus=htmlpage-1736912345678-xy7zk2"
}
```

**错误**:
- `400` — `{"ok":false,"error":"缺少 prompt"}`
- `500` — `{"ok":false,"error":"<原因>"}`

### 2.2 `GET /api/status/{node_id}?room={room}` — 轮询单节点
**请求**: `GET /api/status/htmlpage-1736912345678-xy7zk2?room=demo-railway`

**响应** (`200`):
```json
{
  "ok": true,
  "node_id": "htmlpage-...",
  "room": "demo-railway",
  "status": "done",
  "prompt": "...",
  "mode": "meta",
  "html": "<!DOCTYPE html>...",
  "error": "",
  "tasks": [
    { "label": "解析输入意图", "status": "done" },
    { "label": "推理 5 维度元认知", "status": "done" },
    { "label": "渲染 HTML 页面", "status": "done" }
  ]
}
```

**`status` 取值**: `pending | running | done | failed | unknown`
**未找到**: `404` `{"ok":false,"error":"node not found"}`

### 2.3 `GET /api/watch/{room}` — SSE 流式订阅整房间
适合长任务监控。`Content-Type: text/event-stream`。

**事件**:
- `event: hello` — 连接建立, `data: {"room","ts"}`
- `event: change` — 节点变更, `data: {"node_id","status","prompt","mode","ts"}`
- `: keepalive <ts>` — 25 秒心跳

**示例 (curl)**:
```bash
curl -N https://ha2.digitalvio.shop/canvas/cli/api/watch/demo-railway
```

### 2.4 `GET /health` — 健康检查
```json
{
  "ok": true,
  "service": "know-canvas-cli-bridge",
  "version": "0.1.0",
  "port": 17082,
  "yws_url": "ws://127.0.0.1:1234",
  "room_count": 2,
  "watcher_count": 3,
  "rooms": ["demo-railway", "hermes-test"]
}
```

---

## 3. Callback 协议 (Canvas → Hermes)

每次节点状态切换 (边沿触发, 不重复推) Canvas 会 `POST callback_url`:

**Headers**:
- `Content-Type: application/json; charset=utf-8`
- `X-Canvas-Token: {callback_token}` (如提交时传了)

**Payload**:
```json
{
  "node_id": "htmlpage-1736912345678-xy7zk2",
  "status": "done",
  "prompt": "在上海开一家精品咖啡馆, 启动资金 50w",
  "mode": "meta",
  "room": "demo-railway",
  "html": "<!DOCTYPE html>...",
  "error": ""
}
```

| 状态 | 何时触发 | payload 包含 |
|------|---------|-------------|
| `pending` | 节点刚被 Bridge 注入 (submit 后立即) | 基础字段 |
| `running` | 浏览器 tab 接手开始跑 LLM | 基础字段 |
| `done` | LLM 跑完, html 写回 | + `html` |
| `failed` | LLM 异常 / 节点被删 | + `error` |

**Hermes 端必须返回 2xx**, 否则 Canvas 会按以下退避重试:
- 第 1 次失败: 5 秒后重试
- 第 2 次失败: 15 秒后重试
- 第 3 次失败: 30 秒后重试
- 第 4 次失败: **彻底放弃**, 写日志

> 幂等性: `node_id + status` 二元组在一次任务中至多推一次, Hermes 可按此去重。

---

## 4. 节点状态机

```
                ┌──────────┐
                │ pending  │  ← submit 后, Bridge 注入到 yjs
                └────┬─────┘
                     │ 浏览器 tab 拉到节点 → 调 _runHtmlAnswer
                     ▼
                ┌──────────┐
                │ running  │  ← LLM 正在跑
                └────┬─────┘
                     │
                ┌────┴─────────┐
                ▼              ▼
          ┌────────┐      ┌────────┐
          │  done  │      │ failed │
          └────────┘      └────────┘
```

**注意**:
- `pending → running` 的间隔 = 该 room 下浏览器 tab 何时打开 (Canvas 是被动消费)
- 如果该 room **没有任何浏览器** 打开, 节点会永远停在 `pending`
- Bridge **不主动启动浏览器**, Hermes 应主动 `watch_url` 让用户进画布看, 或派一个 headless tab

---

## 5. 端到端示例

### 5.1 简单派单 (无 callback, 轮询)
```bash
# 派单
curl -sX POST https://ha2.digitalvio.shop/canvas/cli/api/submit \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"分析 2026 上半年 AI 编辑器市占率", "mode":"meta", "room":"demo-railway"}'

# 拿到 node_id, 然后轮询
NODE_ID=htmlpage-...
ROOM=demo-railway
while true; do
  STATUS=$(curl -s "https://ha2.digitalvio.shop/canvas/cli/api/status/${NODE_ID}?room=${ROOM}" | jq -r .status)
  echo "$STATUS"
  [[ "$STATUS" == "done" || "$STATUS" == "failed" ]] && break
  sleep 3
done
```

### 5.2 Hermes 反向 callback 模式
```python
# Hermes side
import requests
resp = requests.post(
    "https://ha2.digitalvio.shop/canvas/cli/api/submit",
    json={
        "prompt": "用户的提问",
        "mode": "meta",
        "room": f"hermes-task-{task_id}",
        "callback_url": f"https://hermes.example.com/api/canvas-callback/{task_id}",
        "callback_token": HERMES_SHARED_TOKEN,
    },
    timeout=10,
)
node_id = resp.json()["node_id"]
# 不需要轮询, 等 callback 即可
# Canvas 会在 done/failed 时 POST 到 callback_url
```

```python
# Hermes 处理 callback
@app.post("/api/canvas-callback/<task_id>")
def canvas_callback(task_id: str):
    if request.headers.get("X-Canvas-Token") != HERMES_SHARED_TOKEN:
        return {"ok": False}, 401
    payload = request.json
    if payload["status"] == "done":
        save_html(task_id, payload["html"])
    elif payload["status"] == "failed":
        log_error(task_id, payload["error"])
    return {"ok": True}, 200
```

### 5.3 SSE 流式订阅 (Node)
```js
import { EventSource } from 'eventsource'
const es = new EventSource('https://ha2.digitalvio.shop/canvas/cli/api/watch/demo-railway')
es.addEventListener('change', (e) => {
  const data = JSON.parse(e.data)
  console.log(`节点 ${data.node_id} → ${data.status}`)
})
```

---

## 6. 部署 & 运维

| 服务 | 端口 | 启动命令 | 说明 |
|------|------|---------|------|
| `y-ws-server` | 1234 | `npm run yws` | Yjs 协作 WS, **必须最先起** |
| `canvas-cli-bridge` | 17082 | `node server/canvas-cli-bridge.mjs` | 反向 HTTP 入口 |
| Caddy | 80/443 | systemd | 反代 + TLS |

VPS systemd 配置:
- `/etc/systemd/system/canvas-cli-bridge.service`
- 日志: `journalctl -u canvas-cli-bridge -f`

Caddy 反代规则 (`/etc/caddy/Caddyfile.canvas`):
```
ha2.digitalvio.shop {
    handle /canvas/cli/* {
        uri strip_prefix /canvas/cli
        reverse_proxy 127.0.0.1:17082
    }
    handle /canvas/yws/* {
        uri strip_prefix /canvas/yws
        reverse_proxy 127.0.0.1:1234
    }
    handle /canvas/* {
        root * /var/www/know-canvas
        file_server
    }
}
```

---

## 7. FAQ

**Q: prompt 一直停在 pending, 不变 running?**
A: 该 room 没有浏览器 tab. 解决: 让 Hermes 用户打开 `watch_url`, 或部署一个 headless Chrome 自动跑 room.

**Q: callback_url 收不到回调?**
A: 检查 Hermes 端 callback 是否返回 2xx. 4xx/5xx Bridge 会按 5/15/30 秒退避重试 3 次, 之后放弃 (查 journal 日志).

**Q: 同一 prompt 派两次会重复执行吗?**
A: 会. Bridge 每次 submit 生成新 `node_id`. 如需幂等, Hermes 端用业务 key 加锁后再 submit.

**Q: html 字段最大多少字节?**
A: 软限 200KB. 超过会被前端截断. 长内容建议外链.

**Q: 是否支持中途取消?**
A: 暂不. 目前只能让用户在 Canvas UI 上手动删节点 → 触发 `failed` callback.

---

## 8. 变更日志

- `1.0` (2026-05-03) — 首次发布. Hermes ↔ Canvas 反向调用 MVP.

---

> 反馈 / Bug: GitHub Issue 或飞书私聊 @你想猫
