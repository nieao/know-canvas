# Know Canvas - 知识图谱画布

## 项目概述

Know Canvas 是一个开源知识图谱可视化工具，让用户通过导入外部文件（MD/TXT/JSON/CSV）和信息，构建交互式知识网络。

## 技术栈

- React 19 + Vite 7
- React Flow 11 (画布引擎)
- Zustand 5 + Immer (状态管理)
- Tailwind CSS 4

## 设计风格

建筑极简唯美（Architectural Minimalism）：
- 暖色点缀 `#c8a882`，黑白基调
- 衬线标题 (Noto Serif SC)，无衬线正文 (Noto Sans SC)

## 开发命令

```bash
npm run dev    # 开发服务器
npm run build  # 生产构建
```

## 核心架构

- `useCanvasStore` — 画布节点/边/布局/分组状态
- `useKnowledgeStore` — 知识源/分类/搜索状态
- `useGraphStore` — 组合 Hook
- `components/canvas/` — 10 种节点组件 (含 TaskNode + ResultNode 派给 Hermes)
- `utils/fileParser.js` — 文件解析引擎

---

## ⚠️ 黑客松迭代 — 已上线 + 多 cc 协作

**已上线**: https://ha2.digitalvio.shop/canvas/?room=demo-railway
**push main 60-75 秒自动部署** (VPS 上 `know-canvas-autopull.timer` 处理)

**完整 AI agent 导引**: 请读 [AGENTS.md](./AGENTS.md) — 含:
- 仓库结构速查 (含每个新文件 1 行注释)
- "你被问 X 时看 Y 文件" 12 种问题速查表
- Hermes API 3 个核心 schema 坑 (改 hermes 集成前必看)
- 多 cc 协作签字协议 (避冲突)
- 快速诊断命令 (本地 4 服务 health + 线上 deploy-marker)

**新增的兄弟仓库 / docs**:
- 兄弟仓库 [hermes-agent-deploy/feat/metahermes](https://github.com/lichang333/hermes-agent-deploy/tree/feat/metahermes) — metahermes 行业知识包
- `docs/INTEGRATION-NOTES.md` — Hermes API 已踩坑沉淀
- `docs/CC-HANDOFF.md` — 多 cc 协作协议
- `docs/hermes-integration-spec.md` — TaskNode 派单完整规范
- `server/hermes-proxy.js` — Hermes API 中转 (凭据保管 + 反爬 UA)

**新加的 server (3 个独立 daemon)**:
| 服务 | 端口 | 启动 |
|------|-----|------|
| y-ws-server (Yjs sync) | 1234 | `npm run yws` |
| claude-bridge (本机 claude CLI) | 18080 | `npm run bridge` |
| hermes-proxy (Hermes 中转) | 17081 | `npm run hermes` |

或直接双击 `start-full.bat` 一键起全部 + 浏览器.
