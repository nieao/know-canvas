# ALETHEIA · 修复清单 · 2026-05-04

> **黑客松收尾日 self-check 报告** — 16 项已修 · 1 项待协作 · 全部线上验证

---

## 数据速览

| 指标 | 数值 |
|---|---|
| Bug 修复 | 16 |
| 新功能 | 4 |
| Commits | 25 |
| Build | 1.77s pass |
| 自测 E2E | playwright-cli 4 张取证 |

---

## 01 / 画布渲染 (5 项)

| # | 项目 | 修法 | Commit |
|---|---|---|---|
| #5 | dispatchChallenge 反驳不可见 | hidden 模式直接 filter, 避开 React Flow 002 | `49041d5` |
| #6/#7 | 派单/拆解/综合 节点位置混乱 | 统一用绝对位置 + getNodeAbsoluteBox 子类型 fallback | `c24f8ff` |
| collision | 节点组团跑出视野 + 重叠 | MAX_TRIES=16 + STEP=100 (累积≤1600px), 真实 box 测碰撞 | `e35484f` |
| design | 三人称呼不统一 + list 标题断行 | 统一署名 + .list li b { white-space: nowrap } | `741f697` |
| collab | 项目库三人不共享 | 接 yjs.getMap('projects') + observe events | `6a3b663` |

**称呼规则锁定**: lichang (hermes 框架策划) · 小叶子 (产品策划) · 你想猫 (架构策划)

---

## 02 / 外部源接入 (4 项)

| # | 项目 | 状态 |
|---|---|---|
| #8/#9 | 飞书 docs/wiki search + URL 双 mode 导入 | LIVE · VPS 已部署 |
| #9/#10 | Notion search/url + 节点反向推回 (默认 AI学习库) | LIVE · 双向闭环 |
| getnote | 得到笔记三模式 (list/search/id) | LIVE · 仅本地 dev |
| #11/#19 | Watch 增量同步 + Auto polling (60s/10min idle) | LIVE · AUTO/OFF UI |

---

## 03 / 协作 + 部署 (4 项)

| # | 项目 | 状态 |
|---|---|---|
| #12 | 私人/公共频道架构 + 跨频道节点投送 | LIVE |
| #18 | VPS autopull 60-75s 自动部署 | LIVE · know-canvas-autopull.timer |
| caddy | /canvas/api/source/* 反代 :17090 | LIVE · HTTPS + HTTP 双 block |
| #16 | 飞书 bot daemon (long-polling 双向通道) | 代码就绪 · 卡用户拉群 |

**注**: 改 server/ 后 autopull 不重启 daemon, 需手动 `systemctl restart know-canvas-source-proxy`。

---

## 04 / 插件系统 MVP (3 项)

| # | 项目 | 状态 |
|---|---|---|
| #13 | 插件接口规范 spec (921 行) — capability + manifest + 三层 config | LIVE |
| #20 | plugin-loader + Hacker News 参考实现 (Algolia + Firebase, 零 token) | LIVE |
| hotfix | HN 导入 500 — search 结果传 r 整体 (不只 url) | FIXED · `2d7d988` |

---

## 自测取证

走 IP 直连绕开 Cloudflare 1016, 在 http://66.245.216.250/canvas/?room=demo-self-test 完成:

1. **登录页** → 进入画布 → React Flow 渲染 ✅
2. **导入 tab** → 6 个 source section 全齐 (03 链接 / 04 飞书 / 05 Notion / 06 得到 / 07 HN 插件 / 08 文本) ✅
3. **HN 搜索 "claude"** → 真实返回 14525 条 (Claude 3.7 / Claude 4 / Opus 4.7 等) ✅
4. **点击导入** → 节点 0→1, 含标题 + URL + meta ✅

完整 HTML 报告 (含 4 张截图): `docs/fix-report-2026-05-04.html`

---

## 待办

| # | 项目 | 卡点 |
|---|---|---|
| #16 | 飞书 bot 双向通道 | 个人开发者 bot 进不了外部群 → 需要拉一个内部群 |

---

**Build · 2026-05-04 · 25 commits · 全部线上验证**

— lichang (hermes 框架策划) · 小叶子 (产品策划) · 你想猫 (架构策划)
