# 2026-05-03 · 新机部署 + 元认知节点化

> 单次 session 内做了:新 VPS 部署 + DeepSeek 接入 / 节点级 4 推进按钮 / 元认知改 inline / ConceptNode 加元认知 / 圈选组合分析 + 批量推进

## 1. 概览

| 项 | 值 |
|---|---|
| 线上地址 | http://66.245.216.250/canvas/ |
| LLM | DeepSeek (`deepseek-chat`),凭据保管在 `/etc/know-canvas/llm.env` |
| 上线 commits | `67c1f0f` → `929c8d2` (8 个 commit) |

---

## 2. 时间线

### 2.1 部署到新 VPS

新机 `root@66.245.216.250:8765`,Ubuntu 26.04 / Vultr。

**新增组件**:

| 文件 | 作用 |
|---|---|
| `server/vps-llm-proxy.mjs` | DeepSeek 转发代理(127.0.0.1:17080) — 凭据从 systemd EnvironmentFile 注入,不暴露浏览器 |
| `deploy/know-canvas-llm-proxy.service` | systemd 单元,读 `/etc/know-canvas/llm.env` |
| `deploy/Caddyfile.newvps` | IP 模式 :80 — `/canvas/` 静态 + `/yws/` WS + `/canvas/api/llm/` 反代 17080 |
| `deploy/deploy-newvps.sh` | 一键部署:探测 → build → tar+ssh → systemd → caddy → 健康检查 |

**前端契约**(`src/services/aiProvider.js` 的 `callVpsProxy`):

```
POST /canvas/api/llm/chat
{ system, prompt, model, temperature, jsonMode }
→ { ok, text, model, usage }
```

**部署用法**:

```bash
DEEPSEEK_API_KEY=sk-xxx bash deploy/deploy-newvps.sh
```

### 2.2 节点级推进按钮 — 4 个

`OntologyNode` 上 2×2 按钮网格。生成 Aletheia 框架后,用户直接在节点上推进,不用回底部输入框开新一轮(那会丢上下文)。

| 按钮 | 行为 |
|---|---|
| 🔧 **拆解** | 节点级二次拆解,生成 3-5 个子 entity 节点(自动连边) |
| ⚡ **元认知** | (后续改成 inline,见 2.3) |
| 🚀 **派 Hermes** | 转 TaskNode 派给远端 worker |
| ⚔ **反驳** | Devil's Advocate 生成 ChallengeNode |

子节点也带同样 4 个按钮 → **层层推进**(拆解→拆解→反驳→元认知 任意组合)。

### 2.3 元认知改 inline 模式

**之前**:5 步元认知工作流,在画布上长出 5 个 metaStepNode(信息散在多处,占画布空间)。

**改后**:1 次 LLM 调用一次性返回 5 维度,结果直接 inline 折叠在节点上。

5 维度:

1. **核心意图** — 真正想解决什么问题(1 句)
2. **隐含目标** — 用户没明说但想要的(2-3 条)
3. **关键风险** — 最容易翻车的点(2-3 条,粉灰警示色)
4. **前置依赖** — 推进前必须先确认/完成(2-3 条)
5. **下一步行动** — 具体动作(1-3 条,有序列表)

成本:5 次 LLM → 1 次,信息密度反而更高。

### 2.4 ConceptNode 也加元认知

抽 `MetaAnalysisInline.jsx` 共享组件,删 ~70 行重复。`OntologyNode` + `ConceptNode` + 组合分析节点 都复用。

ConceptNode 单按钮一行(不需要派 Hermes / 反驳)。

### 2.5 圈选组合分析 + 批量推进

`SelectionToolbar` 加 2 个按钮(选中 ≥ 2 节点时浮现):

**🧠 组合分析**
- 把选中节点当一个系统看,生成新组合分析节点(深底 GOAL 风格凸显)
- 虚线 (`6 3` dasharray) 连到所有源节点
- inline 展开"组合涌现的洞察"和"跨节点依赖断裂 / 优先级冲突 / 资源竞争"
- Prompt 跟单节点不同,强调系统视角

**🚀 批量推进 ▾**
| 子动作 | 范围 |
|---|---|
| 批量元认知 | 所有节点(含 ConceptNode),`Promise.allSettled` 并发 |
| 批量拆解 | 仅 OntologyNode(自动跳过) |
| 批量派 Hermes | 仅 OntologyNode |

---

## 3. 核心代码点

### 3.1 节点级元认知 store action

```js
// useCanvasStore.js
analyzeNodeMetaCognitive: async (nodeId) => {
  // 1. 标记 metaAnalyzing: true (UI 立刻变灰显 loading)
  // 2. 调 aiService.analyzeNodeMeta(node)
  // 3. 写 node.data.metaAnalysis + metaExpanded: true
  // 4. yjs 自动同步给协作者
}
```

任何节点都能调(节点无关 — 只读 `data.title` + `data.description` + `data.variant`)。

### 3.2 组合分析 store action

```js
analyzeGroupMetaCognitive: async (nodeIds) => {
  // 1. 算几何中心, 上方 220px 建占位 OntologyNode (variant: goal)
  // 2. 自动连虚线到所有源节点
  // 3. 占位节点 metaAnalyzing: true
  // 4. 调 aiService.analyzeGroupMeta(nodes)
  // 5. 把 5 维度写到占位节点的 metaAnalysis
  // 6. metaExpanded: true 让用户立刻看到
}
```

视觉用 `goal` variant 凸显这是组合分析,跟普通 entity 区分。

### 3.3 共享组件

```jsx
// MetaAnalysisInline.jsx
<MetaAnalysisInline
  analysis={metaAnalysis}    // { core_intent, implicit_goals, key_risks, ... }
  textColor={meta.color}      // 跟随节点 variant 配色
  onReanalyze={onReanalyze}   // 重跑回调 (可选)
  isAnalyzing={isAnalyzing}   // loading 态
/>
```

---

## 4. 实战踩坑沉淀

### 4.1 部署链(`deploy-newvps.sh` 已修)

| 坑 | 修复 |
|---|---|
| `/tmp` tmpfs 476M 被 camoufox 占满 | 脚本启动先 `rm -rf /tmp/camoufox* /tmp/uv-*` |
| `gpg --dearmor` 在 SSH 无 tty 时打不开 `/dev/tty` | 加 `--batch --yes` |
| Windows Git Bash 没 rsync | 改 `tar -czf - \| ssh` 跨平台 |
| `vps-llm-proxy.js` ES module 但 `server/package.json` 是 commonjs | 重命名 `.mjs` |
| `systemctl is-active` 在 `activating` 时返回非零会触发 `set -e` 早退,导致 Caddyfile 不装 | 加 `\|\| true` |
| ufw 默认不开 80 / 443 | 自动 `ufw allow 80/tcp 443/tcp` |
| caddy 包安装会 `Caddyfile` 默认配置覆盖,需后置装我们的 | step 顺序:先 systemd 后 Caddyfile |

### 4.1.1 Caddyfile 被覆盖事件 ⚠

**症状**:用户报告"画布看不到了",访问 `/canvas/` 返回 "Hermes Agent is online" 文本。

**根因**:Hermes Agent 部署进程(`hermes_cli.main gateway run --replace`)把 `/etc/caddy/Caddyfile` 整个覆盖成自己的配置,我们的 4 条路由全没了。文件本身在,只是不路由。

**新机的 Caddyfile 是 know-canvas + Hermes 共用的**,任何一方独占覆盖会冲掉对方。

**修复**:合并版 Caddyfile —— 保留 Hermes 的 `ha2.digitalvio.shop` 域名 site + `:80` 默认 respond,在 `:80` block 里恢复 know-canvas 的 4 条路由 + 根路径 302 → `/canvas/`。

**坑点**:全局配置里 Hermes 设了 `admin off`,导致 `caddy reload` 不能用(走 admin API 推新配置)。改用 `systemctl restart caddy` 直接重启。

**长期方案**:
- 跟 Hermes 同事约定:Caddyfile 不互相覆盖,都通过 merge 改
- 或者 Hermes 用 `import /etc/caddy/conf.d/*.caddy` 模式,know-canvas 单独占一个文件
- 或者新机改回 `admin localhost:2019`(本地可用,外网不可达)

### 4.2 SSH key

新机不在默认 `~/.ssh/id_*` 路径下。本机两把 ed25519 中,`hermes_agent_vps` 已加到新机。

`~/.ssh/config` 用 alias `newvps` 简化:

```
Host newvps
    HostName 66.245.216.250
    Port 8765
    User root
    IdentityFile ~/.ssh/hermes_agent_vps
    IdentitiesOnly yes
```

### 4.3 测试 selector 干扰

playwright 测试 `button:has-text("元认知")` 会同时匹配:
- 节点上的 ⚡ 元认知按钮
- LeftPanel 的"元认知" tab chip

精准 selector:`.react-flow__node button:has-text("元认知")`。

### 4.4 LLM JSON 输出鲁棒

aiService 的 `tryParseLLMJson` 抗 ` ```json ` 围栏 + 抗前后缀 + 抗多余字符。所有 prompt 末尾加"严格输出 JSON 不要 markdown 围栏"。

---

## 5. 上线验证

```
HTTP /canvas/                       200 OK · 508B HTML · TTFB 584ms
HTTP /canvas/intro.html             200 OK · 31KB
HTTP /canvas/assets/index-*.js      200 OK · 853KB
HTTP /canvas/api/llm/health         {"ok":true,"model":"deepseek-chat"}
POST /canvas/api/llm/chat           真实 DeepSeek 回复 + token usage
```

服务清单:

```
caddy                  :80    → 静态 + 反代
know-canvas-yws        127.0.0.1:1234   y-websocket sync
know-canvas-llm-proxy  127.0.0.1:17080  → DeepSeek
```

API key 改:

```bash
ssh newvps
nano /etc/know-canvas/llm.env
systemctl restart know-canvas-llm-proxy
```

---

## 6. 后续

- 装 autopull timer(像老 ha2 服务器那样,push main 60-75 秒自动 `git pull && npm run build:canvas && rsync dist/`)→ 不用每次手动 tar+ssh
- ConceptNode 元认知按钮分类 / 默认收起的 UX(目前一直可见)
- 组合分析节点支持多种 variant 视觉(目前都用 goal)

---

## 7. 改动文件清单

```
新建:
  server/vps-llm-proxy.mjs
  deploy/know-canvas-llm-proxy.service
  deploy/Caddyfile.newvps
  deploy/deploy-newvps.sh
  src/components/canvas/MetaAnalysisInline.jsx

改动:
  src/services/aiService.js                     +135  analyzeNodeMeta + analyzeGroupMeta + decomposeNodeFurther
  src/stores/useCanvasStore.js                  +200  4 个新 action
  src/components/canvas/OntologyNode.jsx        重构  4 按钮网格 + 元认知 inline
  src/components/canvas/ConceptNode.jsx         +70   元认知按钮 + 折叠区
  src/components/canvas/SelectionToolbar.jsx    +85   组合分析 + 批量推进 dropdown
  src/pages/KnowledgeGraph.jsx                  +25   selection-action 路由 2 新 case
  src/pages/panels/BottomAIBar.jsx              文案  框架生成后引导用户去节点点按钮

  package.json + server/package.json            llm-proxy 脚本
  .gitignore                                    .test-*.mjs + .claude/
  17 个 src/components/canvas/*Node.jsx          hex 颜色入 var() token
```

## 8. Commits

```
929c8d2 feat(meta): ConceptNode 加元认知 + 圈选组合分析 + 批量推进
fb7aa33 feat(node): 元认知改 inline 模式 — 节点内直接展开 5 维度分析
e43ecfc feat(node): OntologyNode 上 4 个推进按钮 — 拆解 / 元认知 / 派Hermes / 反驳
a3c5228 fix(deploy): 修复部署脚本 — 实战踩坑
b1e7036 refactor(canvas): 补 4 个文件的 hex → token 迁移
9d5a66b feat(deploy): VPS LLM 代理 + 新机一键部署 (66.245.216.250)
67c1f0f refactor(canvas): 节点全局 hex 颜色入 token (主题色 + 语义色拆分)
```
