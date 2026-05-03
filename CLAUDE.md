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

---

## 🛡 自检 skill (强制) — `know-canvas-self-check`

**何时必须触发**:
- 用户说"自查"、"画布自检"、"canvas 检查"、"ppt 设计审查"、"声明完成前"
- 我自己改了 `useCanvasStore.js` 的 collision 逻辑 / `KnowledgeCanvas.jsx` 的 hidden 处理 / 任何 `docs/*.html` PPT
- push 完成后 (检查 deploy-marker)

调用: `Skill("know-canvas-self-check")` → 读 `~/.claude/skills/know-canvas-self-check/SKILL.md` 看三道闸 + 13 项执行清单.

**已沉淀的 5 个核心 bug** (在 `domain-knowledge.md`):
1. React Flow 002 "Parent node X not found" — cascade hidden + filter (4 轮迭代)
2. 节点组团跑得远 + 重叠 — collision 用真实尺寸 + MAX_TRIES 限 16
3. PPT list 标题断行 — `.list li b { white-space: nowrap }`
4. USER A/B/C 名字不统一 — 锁定 `lichang (hermes 框架策划) · 小叶子 (产品策划) · 你想猫 (架构策划)` + SVG 双行
5. 项目库不共享 — 接 `yjs.getMap('projects')` + observe

**称呼锁定** (任何文件不允许变格式):
```
lichang (hermes 框架策划) · 小叶子 (产品策划) · 你想猫 (架构策划)
```

**不要重新发明轮子** — 看到 React Flow 002 / 组团重叠 / list 标题断行 → 先读 `domain-knowledge.md` 对应 section, 直接套正例代码.
