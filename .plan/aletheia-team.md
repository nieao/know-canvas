# Aletheia 团队实施计划 · 2026-05-02 19:50

> orchestra-cc 元认知调度。5 个 sub-agent 并行 + 我做集成。
> 总目标：把 6 份 Aletheia wiki 内容**全部融合**进 Know Canvas。

---

## 总架构（一图看懂）

```
┌─────────────────────────────────────────────────────────┐
│ ScenarioSwitcher (顶部, ToB/ToC/ToG)                     │ ← Agent B
├──────────┬──────────────────────────────────┬──────────┤
│          │   AletheiaLayer (集成层)          │ Health-  │ ← orchestra-cc 集成
│ Debate-  │ ┌──────────────────────────────┐ │ ScoreRing│ ← Agent B
│ Stream-  │ │ ProposerNode (蓝, 复用 Onto) │ │          │
│ Panel    │ │ RefuterNode  (红, 复用 Chal) │ │ Action-  │
│ (左侧)   │ │ SynthesisNode (紫, 新)       │ │ PlanModal│ ← Agent D
│          │ │ Impossible-Triangle          │ │          │
│ ← Agt D  │ │   (中央装饰)                 │ │          │ ← Agent B
│          │ └──────────────────────────────┘ │          │
├──────────┴──────────────────────────────────┴──────────┤
│ LoopStatusBar (Round x/N + Δ%)              ⚙ Advanced │ ← B / C
└─────────────────────────────────────────────────────────┘

齿轮抽屉 AdvancedPanel (Agent C):
  ① 对抗权重: 逻辑/合规/商业 (3 滑块)
  ② 反驳人格: Reddit杠精 / 风险审计师 / 苏格拉底
  ③ 循环阈值: Max Rounds 1-10 / Exit Delta 0.5%-10%
  ④ 场景模式: ToB/ToC/ToG (跟顶部联动)
```

---

## 共享接口契约（所有 agent 必须遵守）

### useAletheiaStore（Agent A 创建，所有人 import）

```js
// src/stores/useAletheiaStore.js
{
  // 场景
  scenario: 'tob' | 'toc' | 'tog',          // 默认 tob
  setScenario(s),

  // 反驳人格
  persona: 'reddit' | 'audit' | 'socratic', // 默认 reddit
  setPersona(p),

  // 对抗权重 (0-1, 三者互联动 sum=3 不强求)
  weights: { logic: 1, compliance: 1, business: 1 },
  setWeights(w),

  // 循环阈值
  maxRounds: 5,         // 1-10
  exitDelta: 0.01,      // 0.005-0.1
  setMaxRounds(n),
  setExitDelta(d),

  // 运行时状态 (动态, agent 写入)
  currentRound: 0,
  healthScore: 0,        // 0-100
  debateStream: [],      // [{ ts, role, text, severity? }, ...]
  isRunning: false,
  lastSynthesis: null,   // { actionPlan, summary, ts }

  setRound(n), setHealthScore(s),
  pushDebate(item), clearDebate(),
  setRunning(b), setSynthesis(syn),
}
```

### aletheia 服务模块（Agent A 创建）

```
src/services/aletheia/
├── personas.js     export { PERSONAS, getPersonaPrompt(personaId, baseChallengePrompt) }
├── scenarios.js    export { SCENARIOS, getScenarioPrompt(scenarioId, basePrompt), getDomainConfig(scenarioId) }
├── synthesis.js    export async function synthesize(nodes, edges, weights) -> { actionPlan, healthScore, summary }
└── healthScore.js  export function calcHealth(nodes, edges, weights) -> 0..100
```

### 节点类型新增（Agent D 创建）

```
SynthesisNode 数据 schema:
{
  type: 'synthesisNode',
  data: {
    sourceProposerIds: [],
    sourceRefuterIds: [],
    summary: string,
    actionPlan: string,
    healthScore: number,
    createdAt,
  }
}
```

### 后端 worker 接口（Agent E 创建）

```
server/orchestra-synthesis-worker.js
- 继承 OrchestraWorker
- 监听 yjs 上 type=synthesisNode 且 data.assignedTo='synthesis' 的节点
- 调 aletheia.synthesize 跑共识
- 写回 data.actionPlan + healthScore
```

---

## 分工（不重叠 + 可并行）

| Agent | 职责 | 文件清单 (全部新建, 不动旧文件) |
|---|---|---|
| **A. 服务层** | store + LLM prompt 模板 | `src/stores/useAletheiaStore.js` (新)<br/>`src/services/aletheia/personas.js` (新)<br/>`src/services/aletheia/scenarios.js` (新)<br/>`src/services/aletheia/synthesis.js` (新)<br/>`src/services/aletheia/healthScore.js` (新) |
| **B. 装饰组件** | 数字/动画类视觉 | `src/components/aletheia/HealthScoreRing.jsx` (新)<br/>`src/components/aletheia/ImpossibleTriangle.jsx` (新)<br/>`src/components/aletheia/LoopStatusBar.jsx` (新)<br/>`src/components/aletheia/ScenarioSwitcher.jsx` (新) |
| **C. 高级面板** | 齿轮抽屉 | `src/components/aletheia/AdvancedPanel.jsx` (新)<br/>`src/components/aletheia/PersonaSelector.jsx` (新)<br/>`src/components/aletheia/WeightSliders.jsx` (新)<br/>`src/components/aletheia/ThresholdSliders.jsx` (新) |
| **D. 辩论流 + 融合节点** | 弹幕 + 紫节点 + 对撞动效 | `src/components/aletheia/DebateStreamPanel.jsx` (新)<br/>`src/components/aletheia/ActionPlanModal.jsx` (新)<br/>`src/components/canvas/SynthesisNode.jsx` (新)<br/>`src/components/aletheia/collision.css` (新) |
| **E. 后端 worker** | synthesis worker + e2e | `server/orchestra-synthesis-worker.js` (新)<br/>`e2e/aletheia-synthesis.spec.js` (新)<br/>**只追加** `server/orchestra-conductor.js` 一个 if 分支 (orchestra-cc 最后合并) |
| **orchestra-cc 集成** | 把所有挂到画布 | 新建 `src/components/aletheia/AletheiaLayer.jsx` 包裹层<br/>改 `src/components/canvas/KnowledgeCanvas.jsx` 加 AletheiaLayer (单点改动)<br/>改 `server/orchestra-conductor.js` 加 synthesis worker 注册<br/>更新 CC-HANDOFF 签字 |

**禁止改的文件**（避免冲突）：
- `src/stores/useCanvasStore.js`（ui-cc 地盘 + 我刚改过）
- `src/services/aiService.js`（ui-cc 地盘）
- `src/services/aiConfig.js`（ui-cc 地盘）
- `src/components/canvas/OntologyNode.jsx`（ui-cc 地盘）
- `src/components/canvas/ChallengeNode.jsx`（ui-cc 地盘）
- `src/pages/panels/BottomAIBar.jsx`（ui-cc 地盘）

如果某 agent 觉得**必须**改上面的文件，停手写 `BLOCKED` 注释 + 解释。我决定要不要协调。

---

## 进度（每个 agent 完成后追加）

### Agent A · 服务层
- [x] 启动
- [x] 完成 · 2026-05-02

**已交付 5 个文件**（全部新建，未动现有文件）：
- `src/stores/useAletheiaStore.js` — zustand + immer，**无 persist**（避免污染 yjs 协作）
- `src/services/aletheia/personas.js` — `PERSONAS` 数组 + `getPersonaPrompt(personaId, baseChallengePrompt)`
- `src/services/aletheia/scenarios.js` — `SCENARIOS` + `getScenarioPrompt(scenarioId, basePrompt)` + `getDomainConfig(scenarioId)`
- `src/services/aletheia/synthesis.js` — `async synthesize(nodes, edges, weights)` 调 `callLLM` (jsonMode) 输出 `{actionPlan, healthScore, summary, ts}`
- `src/services/aletheia/healthScore.js` — `calcHealth(nodes, edges, weights) -> 0..100` 同步启发式

**集成时注意事项**（orchestra-cc 看这里）：

1. **import 路径**
   - store 默认导出：`import useAletheiaStore from '@/stores/useAletheiaStore'`（或相对路径）
   - 服务模块都是命名导出：`import { synthesize } from '@/services/aletheia/synthesis'`
   - synthesis.js 内部用 `../aiProvider` 调 callLLM（已确认 aiProvider.js 接口签名匹配）

2. **节点类型兼容**
   - healthScore / synthesis 同时识别 `ontologyNode`+`proposerNode` 与 `challengeNode`+`refuterNode`
   - Agent D 的 SynthesisNode **必须**用 `type: 'synthesisNode'`（已写死匹配）

3. **refuter 节点字段约定**
   - `data.severity` 枚举：`low|medium|high|critical`，缺省按 medium 扣分
   - `data.tag` 含 "compliance/合规" 或 "business/roi/商业" 时触发权重放大；纯逻辑类不写 tag 即可

4. **healthScore 双调用模式**
   - synthesize 内部已调 calcHealth 做基线，并与 LLM 主观分按 70:30 混合
   - UI 的 HealthScoreRing 直接调 calcHealth（不要重复触发 LLM）

5. **debateStream 自动裁剪**
   - store 内置 500 条上限，长跑自动裁头；DebateStreamPanel 不需自己截断

6. **resetRuntime 复合操作**
   - 保留用户配置（scenario/persona/weights/阈值）只清运行态
   - 集成层切场景前可调用 `useAletheiaStore.getState().resetRuntime()`

7. **synthesize 的容错**
   - LLM 不返 JSON 时降级把原文塞进 actionPlan
   - LLM 调用异常时 summary 写明错误信息，healthScore 仍由本地启发式给出（不会卡死）

8. **无新依赖** — 未 npm install，全部用 zustand/immer（项目已有）

### Agent B · 装饰组件
- [x] 启动
- [x] 完成 · 2026-05-02

**已交付 4 个文件**（全部新建，未动现有文件）：
- `src/components/aletheia/HealthScoreRing.jsx` — 180px SVG 圆环 + 数字爬升动画（800ms easeOutCubic）+ 三段色阶（灰/暖/深暖）
- `src/components/aletheia/ImpossibleTriangle.jsx` — 三顶点按 weights 实时偏移（0.5s cubic-bezier 动画），scenario 切换文案，中心显示主导维度
- `src/components/aletheia/LoopStatusBar.jsx` — 进度条 + Round x/N · Δ=y% + 收敛/继续 + 齿轮按钮（onClick 仅触发 props.onOpenAdvanced，不写交互）
- `src/components/aletheia/ScenarioSwitcher.jsx` — ToB/ToC/ToG 横向 tab，激活暖色，下方读 store.scenarios[current].description

**契约约定**：
- 全部从 `useAletheiaStore` 读状态（fallback 默认值，避免 Agent A 未就绪时崩）
- 写状态统一用 `useAletheiaStore.getState().setX(...)`
- 无新依赖（纯 CSS transition + SVG，未引 framer-motion）
- 设计风格：暖 #c8a882 / 黑 #1a1a1a / 灰 #888 / 边框 #e8e8e8 / 衬线标题 + 无衬线正文 / 0.5s cubic-bezier(0.22, 1, 0.36, 1)

### Agent C · 高级面板
- [x] 启动
- [x] 完成 · 2026-05-02

**已交付 4 个文件**（全部新建, 未动现有文件）:
- `src/components/aletheia/AdvancedPanel.jsx` — 抽屉主组件, 420px 宽, 右滑入 (translateX + 400ms cubic-bezier(0.22, 1, 0.36, 1)), z-40 遮罩 + z-50 抽屉, ESC 关闭, 顶部 2px 暖色装饰线, 含 4 个 section: 隐藏的"当前场景"显示带 + 三大调参区, 用 1px #e8e8e8 细线分隔
- `src/components/aletheia/PersonaSelector.jsx` — 三选一卡片纵向排列 (gap 12px), 选中态 2px 暖色边框 + 顶部 2px 暖色生长线, 未选中 1px 灰边 hover 变暖, 点击触发 `setPersona(id)`, 内置 fallback 列表防 personas.js 未就绪
- `src/components/aletheia/WeightSliders.jsx` — 三条权重滑块 (逻辑一致性 / 合规性 / 商业敏锐度), 内部 0~1 展示为 0~100, 自定义暖色圆形 thumb (`::-webkit-slider-thumb` + `::-moz-range-thumb`), 底部"总倾向"取最大权重对应标签
- `src/components/aletheia/ThresholdSliders.jsx` — Max Rounds (1~10 step 1) + Exit Delta (0.5%~10% step 0.5%), 0~1 与百分比互转, 标签含推荐值提示, 底部一句解释收敛逻辑

**契约约定**:
- 按契约从 `src/stores/useAletheiaStore.js` (Agent A) 与 `src/services/aletheia/{personas,scenarios}.js` (Agent A) 命名导入
- 状态读取用 `useAletheiaStore((s) => s.xxx)` 选择器, 写入用同样方式取 setter 后调用, 不破坏 immer
- 全中文 UI + 注释, 无 emoji, 无新增 npm 依赖, 滑块全用原生 `<input type=range>` + Tailwind + 内联 `<style>` 块自定义 thumb
- 设计风格遵守: 暖 #c8a882 / 黑 #1a1a1a / 灰 #888 / 边框 #e8e8e8 / 衬线标题 (Noto Serif SC) + 无衬线正文 (Noto Sans SC) / 段落标签 0.35em letter-spacing
- 集成方式: 在外层挂载点用 `<AdvancedPanel open={open} onClose={() => setOpen(false)} />`, open 由父级 (例如 LoopStatusBar 齿轮按钮) 控制

### Agent D · 辩论流 + 融合节点
- [x] 启动
- [x] 完成 · 2026-05-02

**已交付 4 个文件**（全部新建，未动现有文件）：
- `src/components/aletheia/DebateStreamPanel.jsx` — 左侧贴边 320px 弹幕面板
  - 顶部"辩论流"衬线标题 + 32px 暖色短横 + ROUND x 角标（读 store.currentRound）
  - 倒序渲染 `useAletheiaStore.debateStream`（最新在上）
  - 4 角色色卡：PROPOSER 蓝 #3a6ea5 / REFUTER 红 #b27c8b / SUPERVISOR 金 #c8a882 / SYNTHESIS 紫 #a07cb8
  - 每条：角色标签 + HH:mm:ss 时间戳 + 文本 2 行 truncate（hover 显示完整 title）
  - 顶部新增条目从 `translateY(-10px)→0` 滑入 300ms（用 prevLen diff 判断 newCount）
  - 底部"清空"按钮 → `clearDebate()`，空态/无 store 时 disabled
  - 空态文案"等待对抗开始..."灰字斜体
  - 毛玻璃背景 `backdrop-filter: blur(20px)`，z-index 30，top 64px 给顶部导航留位

- `src/components/aletheia/ActionPlanModal.jsx` — 综合输出弹窗
  - props `{ open, onClose }`：`open` 缺省时 fallback 看 `store.lastSynthesis` 自动驱动
  - 居中卡片 `max-w: 768px`，半透明黑遮罩（rgba(26,26,26,0.55) + backdrop-filter blur 6px），z-index 50
  - 入场动画：卡片 `scale 0.96→1` + `opacity 0→1`，300ms cubic-bezier(0.22,1,0.36,1)
  - ESC 关闭 + 点遮罩关闭
  - 顶部细线装饰（2px 暖色）→ "SYNTHESIS"暖色衬线小标 + "ACTION PLAN" 28px 衬线大标 + summary 斜体灰字
  - 右侧 Health Score 角标（暖色边框，28px 衬线大数字）— 优先取 `lastSynthesis.healthScore`，fallback `store.healthScore`
  - 中段渲染 `lastSynthesis.actionPlan`：内置极简 markdown 渲染器（仅处理 `##`→h2、`#`→h1、空行换段、白空格保留），**不引第三方包**
  - 底部"复制"（→ navigator.clipboard.writeText，1.8s 后 reset 文案为"已复制"→"复制"） + "关闭"（黑底白字主按钮）
  - 全部内嵌 style，零 Tailwind 依赖

- `src/components/canvas/SynthesisNode.jsx` — React Flow 紫色融合节点
  - 紫色渐变背景 `linear-gradient(160deg, #a07cb8 0%, #7e5b96 100%)`
  - 顶部 2px 暖色细线
  - 4 个 Handle（top/left target，right/bottom source）背景色暖色
  - 顶部小标 "SYNTHESIS" 暖色 + 右侧 "{P}P · {R}R" 来源数（读 sourceProposerIds.length / sourceRefuterIds.length）
  - 中央 healthScore 64px 衬线大数字（80+ 暖白 / 50+ 暖灰 / <50 暖深灰），下方 "HEALTH SCORE" 8px 间距 0.3em 标签
  - healthScore 缺失时显示 "..." 斜体
  - summary 2 行 truncate + 斜体居中 + title 全文 hover
  - 底部"查看完整方案"按钮：暖色 hover 反相，点击 `window.dispatchEvent(new CustomEvent('aletheia:show-action-plan', { detail: { nodeId: id, data } }))`
  - selected 时 `box-shadow: 0 0 0 4px rgba(200,168,130,0.18)` 暖色 ring + 2px 暖色边

- `src/components/aletheia/collision.css` — 全局对撞动效（无 JS）
  - `.aletheia-proposer-node` — 蓝色光晕呼吸（cycle 2.4s ease-in-out infinite）
  - `.aletheia-refuter-node` — 红色光晕呼吸（cycle 2s，节奏更紧迫）
  - `.aletheia-collision-fusion` — 蓝/红 → 紫融合 + scale 1→1.06→1 + saturate/brightness 微调，1.2s cubic-bezier(0.22,1,0.36,1) forwards
  - `.aletheia-flying-in` — `translateX(100px)→0` + 0.6s cubic-bezier，60% 处过冲 -6px 后回弹
  - 附赠 `.aletheia-collision-edge` — 对撞连接线 stroke 暖色脉冲
  - `prefers-reduced-motion: reduce` 全部降级为静态高光

**对外契约**：
- 入参：`useAletheiaStore`（命名导出，与 Agent B 写法对齐）字段 `debateStream` / `currentRound` / `lastSynthesis` / `healthScore` / `clearDebate`
- 自定义事件：SynthesisNode 派 `aletheia:show-action-plan`（detail = `{ nodeId, data }`），由 AletheiaLayer 监听后控制 Modal.open
- React Flow 节点 type key 建议 `synthesisNode`（与 Agent A 的 synthesize 输出 schema 一致）
- collision.css 是全局样式，需在 KnowledgeCanvas 或 AletheiaLayer 顶部 `import` 一次

**集成 TODO（orchestra-cc 接管）**：
1. AletheiaLayer 内 `import './collision.css'` + 渲染 `<DebateStreamPanel />` + `<ActionPlanModal open={open} onClose={()=>setOpen(false)} />`
2. AletheiaLayer 在 useEffect 内监听 `aletheia:show-action-plan` 事件 → setOpen(true)
3. KnowledgeCanvas 的 nodeTypes 注册 `synthesisNode: SynthesisNode`
4. Agent E worker 触发对抗时给 OntologyNode/ChallengeNode 在 data 中加 `cssClassHint: 'aletheia-proposer-node' | 'aletheia-refuter-node'`，KnowledgeCanvas 读取后透传到节点 wrapper className

**无新依赖** — 纯 React 19 + 内嵌 style + 原生 CustomEvent，未 npm install

### Agent E · synthesis worker
- [x] 启动
- [x] 完成 · 2026-05-02

**已交付 2 个文件**（全部新建，未动现有文件）：
- `server/orchestra-synthesis-worker.js` — `SynthesisWorker extends OrchestraWorker`
  - 重写 `_maybeClaim` 放行 `type=synthesisNode`（基类原版只认 taskNode，必须重写）
  - mock 模式默认开（无 `ALETHEIA_LLM_KEY` 时强制 mock，也支持 `ORCHESTRA_MOCK=1`）
  - mock 行为：3-5s 随机耗时，每秒推一次 `reportProgress({ phase: 'synthesizing', etaMs })`
  - 输出 `{ ok, summary, result: { actionPlan, healthScore, sourceProposerCount, sourceRefuterCount, finishedAt }, tokens }`
  - `actionPlan` 是 markdown，`healthScore = clamp(80 + (proposers - refuters)*2, [60, 95])`
  - `tokens: { input: 200, output: 500, total: 700, model: 'mock-synthesis' }`
  - CLI 入口：`node server/orchestra-synthesis-worker.js <room>`（同 hermes-worker 模式）
- `e2e/aletheia-synthesis.spec.js` — playwright 单元测试
  - 主 spec：直接 `import SynthesisWorker`，注入 mock `nodesMap`，跑 `worker.run(mockNode)` 测纯逻辑（稳，不依赖 yws/orchestra-http）
  - skip spec：留了 orchestra-http 真集成 spec，待 inject 接口支持 `type` 字段后启用（目前 inject 默认建 taskNode 是已知 gap）

**给 orchestra-cc 的集成说明**（修改 `server/orchestra-conductor.js`）：

1. 顶部 import：
   ```js
   const { SynthesisWorker } = require('./orchestra-synthesis-worker')
   ```

2. 在 conductor 启动 workers 的位置，仿照 HermesWorker 加一行：
   ```js
   // 已有: const hermes = new HermesWorker({ room }).start()
   const synthesis = new SynthesisWorker({ room }).start()
   ```
   每个 room 都要起一个，跟 hermes 同样的循环里加即可。

3. shutdown 钩子里把 synthesis 也加进 workers 数组：
   ```js
   workers.push(synthesis)  // 或一次性 .push(hermes, synthesis)
   ```

4. **不需要改** dispatcher / orchestra-base / orchestra-http — synthesis worker 是自包含的 yjs client，走基类 observe + CAS 抢锁机制，不依赖 dispatcher 派单（因为前端建 synthesisNode 时直接写 `assignedTo='synthesis'` + `agentMode='auto'`，worker 会自己抢）。

5. **可选**：若 orchestra-http 后续要支持 inject synthesisNode，改 `server/orchestra-http.js` 的 `/api/orchestra/inject` 路由，让 body 支持 `type` 和 `data` 字段，然后启用 e2e spec 里的 `describe.skip` 块。

6. **环境变量**：集成时无需任何新 env（mock 模式默认开）。后续若接真 LLM，设 `ALETHEIA_LLM_KEY=<key>` 解除 mock。

### orchestra-cc · 集成
- [ ] 等所有 agent 完
- [ ] 集成到 KnowledgeCanvas
- [ ] e2e 验证
- [ ] CC-HANDOFF 签字
