# P0 实施计划 — cc-ui 进程

> **执行方**: cc-ui（前端 UI 实施方）
> **起草时间**: 2026-05-02
> **状态**: 自主推进中（用户离场授权）
> **回应文档**: `docs/hermes-integration-spec.md`

## 关于决策授权

用户在 2026-05-02 下午发出指令：
- 「画布操作的时候能否在线的三个人同时看见」
- 「自我安排一下下一步的工作。我出去了。」
- 提供 SSH 公钥 `ssh-ed25519 AAAA...nieao@hermes-agent-hackathon-2026-05-02` + 域名 `https://ha2.digitalvio.shop/`

故 cc-ui 自主推进，不等签字。所有重大决策记录在本文档。

---

## 1. 部署方案选择

**对应 hermes-spec §0**：A / B / C / D 选哪个？

**选定: 方案 A — 同机子路径**
- URL: `https://ha2.digitalvio.shop/canvas/`（前端）+ `wss://ha2.digitalvio.shop/yws/`（Yjs WebSocket）+ `https://ha2.digitalvio.shop/api/canvas/`（Hermes 派单代理）
- 共用 Hermes 已有的 Caddy/Nginx + SSL 证书，零 DNS 改动
- 同源 = 无 CORS

**否决理由**:
- B（子域名）：需要 DNS 改动，黑客松窗口紧
- C（独立 daemon）：故障隔离收益小于部署成本
- D（本地 fallback）：用户明确要"三人同时看见"，本地 demo 不满足

---

## 2. 协作 sync server 选型

**选定: Node + `y-websocket-server` + LevelDB 持久化 + systemd**

不走 Cloudflare Workers DO（spec §3 原方案）。理由：
- 部署目标已确定是 ha2.digitalvio.shop 同机 VPS，没必要再绑 Cloudflare
- 用户技术栈记忆显示在"起号 V0.1"项目里跑过同样模式，有现成模板可抄（`server/y-ws-server.cjs`）
- 单进程内存 + LevelDB 持久化对 3 人黑客松场景绰绰有余

**实现位置**: `server/y-ws-server.cjs`（参考起号 V0.1）

---

## 3. AI 调用层架构

**用户需求合并**：
- (a) 默认调用每个登录用户**自己电脑**的 claude CLI
- (b) 备选 deepseek / minimax / glm / 阿里通义 / openai 等可手动配置
- (c) Hermes 派单（spec 要求的 TaskNode 流程）

**选定: 三轨 provider 工厂**

```
aiService.js (provider 工厂)
├─ claude-cli-bridge   ← 默认；调本机 localhost:18080，由用户自起一个 Node 桥进程
├─ generic-openai      ← 兜底；用户填 baseURL+apiKey+model；兼容 deepseek/minimax/glm/qwen 等
└─ hermes-dispatch     ← TaskNode 专用；走服务端代理 /api/canvas/:id/dispatch
```

**claude-cli-bridge** 实现：
- 项目自带 `server/claude-bridge.js`，本地起 `node server/claude-bridge.js`
- 监听 `localhost:18080`，POST `/chat` → 调 `claude -p --model X --output-format text`
- 前端检测桥可用性，可用即用；不可用 fallback 到 generic-openai
- 桥**只在用户本机跑**，不要部署到公网（避免 claude CLI 被滥用）

---

## 4. 节点类型扩展（spec P0 vs cc-ui P0）

| spec P0 要求 | cc-ui 决策 |
|---|---|
| 新增 TaskNode | **暂缓**到 P1（用户没明确要） |
| 新增 ResultNode | **暂缓**到 P1 |
| 加 dispatchTask action | **暂缓** |
| Hermes 派单流程 | **暂缓**，但保留 provider 工厂中的 hermes-dispatch 接口位 |

**暂缓理由**：
1. 用户三条核心指令都没提 hermes 派单（强调"三人同时看见" + "可手动配模型" + "E2E 测试" + "技术审查 9 分"）
2. spec P0 估时 6-8h，做完后留给协作 + 模型 + E2E 的时间不足
3. 部署到 ha2.digitalvio.shop 与 Hermes 同机后，T+1 加 TaskNode 是平滑改动

**用户回来时**：在本文档底部签字 GO 即可让 cc-ui 继续做 TaskNode；签字 SKIP 则保留现状交付。

---

## 5. 已完成 / 进行中 / 待办

### ✅ 已完成
- 双击空白触发快速添加菜单（含图片/视频/文件/语音类型）
- NodePropertyPanel 加节点类型切换（"模块性质修改"）+ 通用颜色字段
- 7 个内容节点接入 ColorAccentBar 渲染顶部色带
- KnowledgeGraph 监听 `node-update` / `node-change-type` / `group-color-change` 事件
- 修复 `node-update` 事件无人监听导致属性面板保存失效的 bug
- 验证：组内节点连线和拖动（React Flow 原生支持，无需修复）

### 🔄 进行中
- 协作层：装 yjs/y-websocket，写 yjsSync（参考起号 V0.1）
- 用户名 + 房间号入口页
- Awareness 光标 + 选中态广播

### 📋 待办
- 后端 server/ 目录（y-ws-server + claude-bridge + hermes-proxy）
- aiService.js provider 工厂改造
- 设置面板 UI（用户填 provider config）
- Ubuntu 部署脚本（deploy.sh + Caddyfile + systemd unit）
- E2E 多用户脚本（Playwright 起 3 个 context）
- 技术审查到 9 分（swe-tech-review）

---

## 6. 用户回来后的开放问题

- [x] 是否做 TaskNode + ResultNode（hermes spec P0 内容）？**GO** — 由 [meta-cc] 接手做完
- [ ] claude-cli-bridge 桥进程要不要打包成一键启动（项目内 `npm run bridge`）？默认是。
- [ ] 房间号策略：URL 参数 `?room=xxx` 还是登录后房间列表？默认前者。
- [ ] 是否需要房间密码？黑客松场景默认无密码。
- [ ] 服务器部署：cc-ui 写好脚本，由用户回来 SSH 执行。是否需要 cc-ui 直接 SCP？默认是写脚本不直接执行。

---

## 7. 用户签字位

> 在下面写一行 `GO: ...` 或 `SKIP: ...` 表态。

**GO: 全部 (boss 2026-05-02 给 [meta-cc] 全权 — "把这次黑客松所有的，做到完美，全部接管")**

接手实施记录:
- 2026-05-02 [meta-cc] 接管 hermes spec P0 余下部分
- 已新增: server/hermes-proxy.js + src/services/hermesService.js + TaskNode.jsx + ResultNode.jsx
- 已 patch: useCanvasStore (addTaskNode + dispatchTaskNode + _addResultNodeFor)
- 已 patch: KnowledgeCanvas (注册 taskNode/resultNode)
- 已 patch: KnowledgeGraph QuickAdd 加 'task' 入口
- 端到端验证: 真实派单 t_f6c92df4 创建成功, 扁平响应通过
- gateway_running=False — task 只能进 backlog, 等 lichang333 启 gateway 后才会被 worker 执行

---
