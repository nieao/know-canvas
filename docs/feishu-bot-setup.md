# 飞书 Bot 接入 Know Canvas · 配置指南

> **总工作流**: 飞书群里 @bot 一句话 → 自动派单到 Know Canvas demo-final 房间 → Aletheia 多 agent 跑 → 结果发回飞书。
> 用 lark-cli WebSocket 长连接订阅事件, **无需公网回调地址**, 纯本地 daemon 跑。

---

## 一、boss 在飞书后台做的事 (一次性配置)

### 1. 登录飞书开发者后台

打开 https://open.feishu.cn/app, 选你的应用 (没有就新建一个"自建应用")。

### 2. 启用机器人能力

`能力配置` → `机器人` → 开启。

### 3. 配置事件订阅 (关键)

`事件与回调` → `订阅方式` → 选 **"使用长连接接收事件"** (重要, 不要选 webhook)

`事件配置` → `添加事件` → 搜 `im.message.receive_v1` (接收消息事件) → 添加。

### 4. 申请权限

`权限管理` → 搜并申请以下 4 个 scope:

| Scope | 用途 |
|---|---|
| `im:message:receive_as_bot` | 接收用户发给 bot 的消息 (事件订阅必需) |
| `im:message:send_as_bot` | bot 主动发消息 / 回复消息 |
| `im:chat` | 群聊读写 (拉群、改群信息) |
| `im:resource` | 接收图片/文件等富媒体 (可选, 如果只发文本可跳) |

### 5. 发布版本

`版本管理与发布` → 创建版本 → 提交审核 (企业内自建应用通常秒过) → 发布。

> ⚠ **权限和事件订阅修改后, 必须重新发布版本才生效**。

### 6. 把 bot 加进群

任意一个测试群 → 群设置 → 群机器人 → 添加机器人 → 选你这个应用 → 确认。

### 7. 把 App ID + App Secret 给本地 daemon

把 App ID 和 App Secret 发给 daemon 所在机器 (现在是你这台 Windows)。

---

## 二、本地 daemon 配置 (一次性)

### 1. 配 lark-cli

```powershell
lark-cli config init --new
```

按提示输入 App ID + App Secret。这会写到 `%USERPROFILE%\.lark\config.json`。

### 2. 验证 bot 身份能用

```powershell
lark-cli auth status --as bot
```

应该返回 `{"identity": "bot", "tokenStatus": "valid"}`。

### 3. (可选) 测一条事件订阅

```powershell
lark-cli event +subscribe --as bot --event-types im.message.receive_v1 --compact
```

然后在飞书群里 @bot 发"hello", 应该立刻看到 NDJSON 一行打出来。看到了说明事件链路通。

---

## 三、启动 bot daemon

### 前置

确保 Know Canvas orchestra 栈在跑 (yws + conductor + orchestra-http + vite):

```powershell
start-orchestra.bat
```

这一步起来后, 端口 1234 / 17082 / 17083 / 5180 都应该 LISTENING。

### 启 bot daemon

```powershell
start-feishu-bot.bat
```

或直接命令行:

```powershell
cd server
node feishu-bot-daemon.js
```

输出长这样:

```
[feishu-bot] 11:30:00 room=demo-final, orchestra=http://127.0.0.1:17082, ws=ws://127.0.0.1:1234
[feishu-bot] 11:30:00 connecting yjs ...
[feishu-bot] 11:30:01 spawning lark-cli event +subscribe ...
[feishu-bot] 11:30:01 yjs synced
[feishu-bot] 11:30:02 yjs: connected
```

---

## 四、试一下

在飞书群 @bot 发: **"在上海开一家咖啡馆"**

预期:

1. 几秒内 bot 回: `[Aletheia] 已派单到画布: task-xxx, 看 https://ha2.digitalvio.shop/canvas/?room=demo-final 实时围观, 处理完我会发结果。`
2. 1-2 分钟后 bot 再回完整结果 (Hermes mock 4s + dispatcher tick + 综合 ≈ 30s 内, 真 LLM 模式更长)。

实时画布上能看到一个 TaskNode 出现 → 跑完 → ResultNode 涌现, 三人协作模式三人都看得到。

---

## 五、关键环境变量 (daemon 行为可调)

| ENV | 默认 | 含义 |
|---|---|---|
| `FEISHU_BOT_ROOM` | `demo-final` | 派单到哪个 yjs 房间 |
| `ORCHESTRA_HTTP` | `http://127.0.0.1:17082` | orchestra-http 地址 |
| `ORCHESTRA_WS_URL` | `ws://127.0.0.1:1234` | yjs sync ws 地址 |
| `LARK_CLI` | `lark-cli` | lark-cli 二进制路径 (PATH 里没有时改这个) |

---

## 六、排错

### bot 无响应

1. **lark-cli event +subscribe 没起来**: 看 daemon 输出, 应该有 `spawning lark-cli ...`。如果立刻退出 + 重连, 通常是身份没配好或权限不够 → 回去做"一、3-5"。
2. **bot 没在群里**: 加进群再试 (一、6)。
3. **事件订阅没选长连接**: 后台改成长连接重新发布版本 (一、3 + 一、5)。

### bot 回 "派单失败"

orchestra-http 没起来 → `start-orchestra.bat`。

### bot 回 "超时"

意味着 5 分钟内没看到 yjs 上对应 ResultNode 涌现, 通常是:
- conductor 没起 → `curl http://127.0.0.1:17083/health` 看是否 `rooms: ["demo-final"]`
- worker 没抢到 task → 看 conductor 控制台日志
- 真 Hermes 模式但 gateway_running=false → 后台启 gateway (CC-HANDOFF.md §G #7)

### 想改 bot 触发条件 (只响应 @ 的消息)

`server/feishu-bot-daemon.js` 的 `handleMessageEvent` 函数加 `@_user_1` 或显式 mention 检查。当前 demo 阶段未做, p2p 私聊全收, 群聊 `sender_type === 'user'` 全收。

---

## 七、安全提醒

- App Secret **不要**提交到 git (config init 写到 `%USERPROFILE%\.lark\` 已是 gitignore 之外)
- bot 回的消息内容会公开给群成员, 派单 body 包含发送者 open_id, 注意脱敏
- daemon 当前只接文本, 不解析图片/文件 (后期可加, 用 lark-cli `+messages-resources-download`)
