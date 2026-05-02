# AGENTS.md — AI Agent 项目导引

> **给谁看**: 任何 AI agent (Claude Code / Cursor / Codex / Aider / Continue / 其他) 第一次进入这个项目
> **目标**: 30 秒读完, 知道项目是什么 + 该读什么 + 最常见的 3 件事怎么做
> **不要重复**: README.md / docs/ 里已经有的东西在这里只**指路**, 不**复述**

---

## 1. 项目是什么 (一句话)

**Know Canvas** = React Flow 知识图谱画布 + Yjs CRDT 多人实时协作 + 三轨 AI 调用 (claude-cli / openai-like / Hermes 派单).

是黑客松项目 "AI 解放劳动者" 的一部分, 跟兄弟项目 [metahermes](https://github.com/lichang333/hermes-agent-deploy/tree/feat/metahermes/metahermes) 和 [Hermes Agent](https://ha2.digitalvio.shop) 组成三件套.

**已上线**: https://ha2.digitalvio.shop/canvas/?room=demo-railway

---

## 2. 仓库结构 (只列 AI 最常碰的)

```
know-canvas/
├── AGENTS.md                  ← 你现在读的这个
├── README.md                  原项目说明 (画布功能介绍)
├── PROJECT-SUMMARY.md (兄弟仓库 黑客松 5-1/) 完整项目总结 ← 想了解全貌看这个
│
├── docs/                      ★ 文档总入口
│   ├── hermes-integration-spec.md  Hermes 派单完整规范
│   ├── INTEGRATION-NOTES.md        Hermes API 已踩坑 (3 个核心坑)
│   ├── DEPLOYMENT-OPTIONS.md       A/B/C/D 部署方案对比 (已选 A)
│   ├── GITHUB-ACTIONS-SETUP.md     GitHub Actions 配置 (备用)
│   ├── ONESHOT.md                  VPS oneshot 部署命令
│   ├── CC-HANDOFF.md               多 cc 协作协议 + Hermes 连接信息
│   └── P0-PLAN-cc-ui.md            ui-cc 已实施清单
│
├── src/
│   ├── pages/
│   │   ├── KnowledgeGraph.jsx      ★ 主页 (集成 store + Yjs + 事件分发)
│   │   └── JoinRoom.jsx            房间号入口
│   ├── components/canvas/          10 种节点 (含 ★ TaskNode + ResultNode)
│   ├── stores/useCanvasStore.js    ★ Zustand store (1700+ 行, 改之前先 grep)
│   ├── collab/                     Yjs 多人协作层
│   └── services/
│       ├── aiService.js + aiProvider.js + aiConfig.js  三轨 AI
│       └── hermesService.js        ★ Hermes 调用 (走 hermes-proxy)
│
├── server/                    Node 后端 (3 个独立 daemon)
│   ├── y-ws-server.js              Yjs sync, port 1234
│   ├── claude-bridge.js            本机 claude CLI 桥, port 18080
│   └── hermes-proxy.js             ★ Hermes API 中转 + 凭据保管, port 17081
│
├── deploy/                    部署
│   ├── deploy-on-vps.sh            VPS-side 一键部署
│   └── auto-pull.sh (在 VPS 上)    每 60s 自动 git pull + redeploy
│
├── start-full.bat / stop-full.bat  Windows 一键起全家桶
└── .github/workflows/deploy.yml    GitHub Actions (备用, 当前用 VPS auto-pull)
```

---

## 3. 最常见的 3 件事 → 直接告诉你怎么做

### A. "把这个改动上线"

**正常流程**:
```bash
git push origin main
# 60-75 秒后自动上线 https://ha2.digitalvio.shop/canvas/
```

VPS 上有 `know-canvas-autopull.timer` 每 60 秒自动 `git pull` + redeploy. 不需要任何手动操作.

**验证上线成功**:
```bash
curl -s https://ha2.digitalvio.shop/canvas/.deploy-marker
# 返回的 SHA 应该等于你 push 的那个 commit
```

### B. "改 Hermes 集成相关代码"

读这两份:
1. `docs/INTEGRATION-NOTES.md` — Hermes API **3 个核心坑** (priority 是 int / POST 不带尾斜杠 / 响应嵌套 task)
2. `src/services/hermesService.js` — 前端 API 封装

不要直接 `fetch` Hermes (浏览器没法设 User-Agent + 凭据不能暴露). **走 server/hermes-proxy.js 中转**.

### C. "起本地开发环境"

```bash
# 双击 (Windows)
start-full.bat
# 或者手动:
cd server && npm install
cd ..       && npm install
npm run dev                 # 前端 5180
node server/y-ws-server.js     # Yjs sync 1234
node server/claude-bridge.js   # 本机 claude CLI 18080
node server/hermes-proxy.js    # Hermes 中转 17081 (需要 HERMES_USER/PASS)
```

凭据从兄弟仓库的 `黑客松 5-1/.env` 加载 (start-full.bat 自动做这个).

---

## 4. 你被问到具体问题时, 看哪个文件

| 问题类型 | 看 |
|---------|---|
| 怎么加新节点类型? | `src/components/canvas/TaskNode.jsx` (最新加的, 当模板抄) + `KnowledgeCanvas.jsx` 第 35 行 nodeTypes 注册 |
| 怎么加 store action? | `src/stores/useCanvasStore.js` 末尾的 `addTaskNode/dispatchTaskNode` (异步 action 怎么写, 怎么 import service 避免循环) |
| 怎么调 Hermes? | `src/services/hermesService.js` (前端) + `server/hermes-proxy.js` (后端中转) |
| 怎么改 Yjs 同步? | `src/collab/yjsSync.js` + `src/collab/PresenceLayer.jsx` |
| 怎么部署? | `deploy/deploy-on-vps.sh` (VPS 跑的) + `docs/ONESHOT.md` (一行命令) |
| 怎么改 nginx? | SSH 到 VPS 改 `/etc/nginx/sites-enabled/ha2.digitalvio.shop` (有 backup 在 `/etc/nginx/.backups/`), 然后 `nginx -t && systemctl reload nginx` |
| 多 cc 协作怎么办? | `docs/CC-HANDOFF.md` (身份标签 / 文件锁 / 签字位) |

---

## 5. 快速诊断命令

```bash
# 本地服务全活吗
curl http://localhost:5180/                  # 前端
curl http://localhost:1234/health            # Yjs sync
curl http://localhost:18080/health           # claude bridge
curl http://localhost:17081/health           # hermes proxy

# Hermes 那边活吗 (需要 .env 里的凭据)
python "../黑客松 5-1/metahermes/smoke_test.py"   # 4 题端到端

# 线上活吗
curl -s https://ha2.digitalvio.shop/canvas/.deploy-marker
curl -s https://ha2.digitalvio.shop/canvas/  -o /dev/null -w 'status=%{http_code}\n'
```

---

## 6. 当前已知阻塞 (在 PR 里别提"修这个")

- **Hermes gateway_running=False** — lichang333 在 dashboard 启 gateway 后, Skill 元任务才会被 worker 真执行
- **没有 worker profile** — assignees=[] 状态. 需要 lichang333 在 dashboard 创建 1 个 (例 railway-data-analyst)
- **Cron / Profile 装载靠手动** — `/api/cron/jobs` 和 `/api/profiles` 是 token-protected, 手动 dashboard 操作 (有指引)

---

## 7. 协作签字 (重要!)

如果你是新来的 AI agent, 在 `docs/CC-HANDOFF.md` 里:
1. 给自己起个标签 (`[meta-cc]` / `[ui-cc]` / `[deploy-cc]` 等)
2. **改 src/components/canvas/* 之前** check 是不是 ui-cc 的领域 (它在 P0-PLAN 里宣告过的)
3. **改 server/hermes-proxy.js 之前** check 是不是 meta-cc 的领域
4. push 完在 CC-HANDOFF.md 末尾留一行 "[你的标签] 2026-XX-XX HH:MM 改了 X, 原因 Y"

避免冲突的硬规则: **同一文件同一时间只 1 个 cc 在改**. 用 git status 看是不是别人正在修改.

---

## 8. 如果你还有疑问, 优先级排序

1. **代码层问题** → 直接 `Grep`/`Read` 仓库, 这里 1700 行 store 比文档准
2. **架构层问题** → 读 `PROJECT-SUMMARY.md` (兄弟仓库) + `docs/hermes-integration-spec.md`
3. **Hermes API 问题** → `docs/INTEGRATION-NOTES.md` (实测 verified)
4. **部署 / 运维问题** → `docs/ONESHOT.md` + `docs/GITHUB-ACTIONS-SETUP.md`
5. **协作问题** → `docs/CC-HANDOFF.md`
6. **还不行** → 在 PR description 里写明你的卡点 + 你试过什么, boss 会回

---

**一句话总结**: 这是个能跑通的项目, 不是 toy project. 99% 的代码改动 push main 60 秒自动上线. 改之前看一眼 `docs/INTEGRATION-NOTES.md` 避开 Hermes API 那 3 个坑.
