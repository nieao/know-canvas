# Know Canvas 标准画布导出 JSON 规范 · v1.0

> **目的**: 让 Know Canvas 的画布（含 Aletheia 决策、Hermes 派单、知识节点全套）能以一份**中性、自描述、平台无关**的 JSON 导出，被秒哒（Miaoda）/ Coze / n8n / LangFlow 等低代码 / AI 工作流平台秒读懂。
>
> **MIME**: `application/vnd.know-canvas.canvas+json`
> **文件后缀**: `.kcanvas.json`
> **当前版本**: `1.0.0`

---

## 设计原则（4 条）

1. **节点 + 边 + 元数据三段式**：跟 React Flow / Mermaid / mxgraph / Coze 工作流通用拓扑兼容。
2. **type 二级化**：顶层 `type` 是标准化大类（`task / ontology / synthesis / ...`），`subtype` 是细分（`ontology.goal`, `ontology.entity`），导入方按需识别。
3. **不漏 agent 痕迹**：每个 task / synthesis 节点保留 `agent_mode / assigned_to / tokens / progress` 等运行时痕迹，秒哒可以直接重放。
4. **厂商扩展空间隔离**：`extensions.know_canvas`、`extensions.miaoda` 等命名空间字段不互相污染。

---

## 顶层 Schema

```jsonc
{
  "schema_version": "1.0.0",            // 必填. 遵循 semver
  "format": "know-canvas/canvas-export",// 必填. 用于 import 方识别协议
  "metadata": { ... },                  // 必填. 画布元数据
  "viewport": { ... },                  // 选填. 当前视口
  "nodes": [ ... ],                     // 必填. 节点数组
  "edges": [ ... ],                     // 必填. 边数组
  "agent_runs": [ ... ],                // 选填. Aletheia / Hermes 运行历史
  "extensions": { ... }                 // 选填. 厂商扩展空间
}
```

---

## metadata（画布元数据）

```jsonc
{
  "metadata": {
    "id": "demo-final",                       // 画布唯一标识 (yjs room id)
    "title": "在上海开咖啡馆 · 决策框架",
    "description": "用 Aletheia 多 agent 对抗推演的可行性分析",

    "created_at": "2026-05-02T11:11:33.311Z", // ISO8601
    "updated_at": "2026-05-02T13:53:00.000Z",
    "exported_at": "2026-05-02T14:20:00.000Z",

    "authors": [
      { "id": "ou_7fc4...", "name": "你想猫", "role": "owner" },
      { "id": "ou_a1b2...", "name": "李畅",   "role": "editor" }
    ],

    "scenario": "tob",                        // tob | toc | tog (Aletheia 场景)
    "language": "zh-CN",
    "tags": ["AI 决策", "Aletheia", "咖啡馆"],

    "stats": {
      "node_count": 12,
      "edge_count": 8,
      "agent_count": 3                        // 涉及多少种 agent (hermes / synthesis / ...)
    }
  }
}
```

---

## viewport（视口，选填）

```jsonc
{
  "viewport": { "x": 0, "y": 0, "zoom": 1.0 }
}
```

---

## nodes（核心节点数组）

每个节点必须有 `id / type / position / data` 四个必填字段。

### 节点通用形态

```jsonc
{
  "id": "node-xxx",                  // 必填. 全局唯一. 推荐 <type>-<ts>-<rand>
  "type": "ontology",                // 必填. 顶层标准类型, 见下表
  "subtype": "goal",                 // 选填. type 内的细分
  "position": { "x": 100, "y": 200 },// 必填.
  "size":     { "width": 240, "height": 120 }, // 选填.

  "data": {                          // 必填. 节点主体数据 (按 type 不同字段不同)
    "title": "...",
    "description": "..."
  },

  "style": {                         // 选填. 视觉样式 (导入方可忽略)
    "background_color": "#1a1a1a",
    "border_color": "#c8a882",
    "icon": "..."
  },

  "parent_id": null,                 // 选填. 分组节点关系
  "z_index": 0,                      // 选填.
  "locked": false                    // 选填.
}
```

### 标准 type 大类 (8 种)

| type | 用途 | subtype | 在 Know Canvas 的对应 |
|---|---|---|---|
| `concept` | 知识概念 | — | `conceptNode` |
| `category` | 分类 | — | `categoryNode` |
| `bookmark` | 网页书签 | — | `bookmarkNode` |
| `media` | 多媒体 | `image` / `video` / `file` / `note` | `imageNode` / `videoNode` / `fileNode` / `noteNode` |
| `group` | 分组容器 | — | `groupNode` |
| `task` | Agent 任务（派单） | — | `taskNode` |
| `result` | 任务结果（回流） | — | `resultNode` |
| **`ontology`** | **本体节点 (Aletheia)** | `goal` / `entity` / `constraint` / `assumption` | `ontologyNode` |
| **`challenge`** | **反驳节点 (Aletheia)** | `low` / `medium` / `high` / `critical` | `challengeNode` |
| **`synthesis`** | **共识综合 (Aletheia)** | — | `synthesisNode` |

### 各 type 的 data schema

#### `concept`
```jsonc
{ "title": "区块链", "description": "...", "tags": ["技术"], "icon": "..." }
```

#### `task`（核心 — 秒哒可以拿这个还原工作流）
```jsonc
{
  "title": "选址分析",
  "body": "...",
  "status": "done",                // draft | pending | running | done | failed
  "agent_mode": "auto",            // auto | manual
  "assigned_to": "hermes",         // hermes | claude-cli | synthesis | feishu-bot | ...
  "hermes_assignee": "data-analyst", // 选填. Hermes profile 名

  "claimed_by": "hermes-ye63e1",   // worker instance id
  "claimed_at": "2026-05-02T11:11:33Z",
  "finished_at": "2026-05-02T11:11:40Z",
  "elapsed_ms": 4144,

  "tokens": {
    "input": 256, "output": 384, "total": 640,
    "model": "claude-opus-4.6"
  },

  "progress": {
    "phase": "done",
    "eta_ms": 0,
    "events": null
  },

  "error": null
}
```

#### `result`
```jsonc
{
  "title": "选址分析 · 结果",
  "summary": "黄浦/静安一线核心商圈...",
  "result": "## 行动方案\n...",     // markdown / 任意结构
  "source_task_id": "task-xxx",   // 必填. 反指 task
  "produced_by": "hermes",
  "produced_at": "2026-05-02T11:11:40Z"
}
```

#### `ontology`（Aletheia 本体节点）
```jsonc
{
  "variant": "goal",              // goal | entity | constraint | assumption
  "title": "在上海开咖啡馆",
  "description": "...",
  "parent_goal": "...",           // entity/constraint/assumption 反指 goal
  "sentence": "在上海开一家咖啡馆"  // goal 节点保留原始一句话
}
```

#### `challenge`（Aletheia 反驳节点）
```jsonc
{
  "title": "选址成本被低估",
  "body": "...",
  "severity": "high",             // low | medium | high | critical
  "tag": "compliance",            // compliance | business | logic | evidence (影响 healthScore 权重)
  "target_node_id": "task-xxx",   // 反指被反驳的节点
  "persona": "reddit"             // 反驳人格: reddit | audit | socratic
}
```

#### `synthesis`（Aletheia 共识节点 — 秒哒最该读这个）
```jsonc
{
  "summary": "已综合 3 提议 + 2 反驳",
  "action_plan": "## 综合行动方案\n\n1. ...\n2. ...",
  "health_score": 87,             // 0-100 综合健壮度评分
  "source_proposer_ids": ["onto-a", "onto-b", "task-c"],
  "source_refuter_ids":  ["chal-x", "chal-y"],
  "produced_by": "synthesis",
  "produced_at": "2026-05-02T11:30:00Z",
  "tokens": { "input": 200, "output": 500, "total": 700, "model": "..." }
}
```

---

## edges（边数组）

```jsonc
{
  "edges": [
    {
      "id": "edge-xxx",                // 必填.
      "source": "node-A",              // 必填.
      "target": "node-B",              // 必填.
      "source_handle": "out",          // 选填. React Flow 多 handle 时用
      "target_handle": "in",           // 选填.

      "type": "derives",               // 标准化关系类型, 见下表
      "label": "派生",
      "animated": false,

      "data": {
        "weight": 1.0,
        "is_running": false            // 任务执行时的视觉态
      },

      "style": {
        "stroke": "#c8a882",
        "stroke_width": 2,
        "stroke_dasharray": null
      }
    }
  ]
}
```

### 标准边 type (8 种 + 自定义)

| type | 含义 | 视觉色 |
|---|---|---|
| `causal` | 因果 | 暖 #c8a882 |
| `compose` | 组成 | 蓝灰 #7c9eb2 |
| `depend` | 依赖 | 绿灰 #8b9e7c |
| `similar` | 相似 | 紫灰 #9e7cb2 |
| `contrast` | 对比 | 玫瑰 #b27c8b |
| `derive` | 派生 | 青灰 #7cb2a8 |
| `reference` | 引用 | 橙灰 #b2917c |
| `sequence` | 顺序 | 黄灰 #a8a87c |
| `agent_dispatch` | **Agent 派单（task → result）** | 暖 |
| `refute` | **反驳指向（challenge → target）** | 红 |
| `synthesize` | **综合指向（source → synthesis）** | 紫 |

---

## agent_runs（Aletheia 运行历史，选填）

让秒哒能"重放"思考过程。

```jsonc
{
  "agent_runs": [
    {
      "id": "run-xxx",
      "started_at": "2026-05-02T11:00:00Z",
      "finished_at": "2026-05-02T11:30:00Z",
      "duration_ms": 45000,

      "scenario": "tob",
      "persona": "reddit",
      "weights": { "logic": 1.0, "compliance": 0.8, "business": 1.2 },
      "thresholds": { "max_rounds": 5, "exit_delta": 0.01 },

      "rounds": [
        { "round": 1, "delta": 0.34, "health_score": 42, "node_count": 4 },
        { "round": 2, "delta": 0.18, "health_score": 65, "node_count": 7 },
        { "round": 3, "delta": 0.04, "health_score": 87, "node_count": 12 }
      ],

      "final_health_score": 87,
      "exit_reason": "delta_below_threshold",  // delta_below_threshold | max_rounds_reached | manual_stop

      "synthesis_node_id": "syn-xxx",          // 反指最终 synthesis 节点
      "involved_node_ids": ["onto-a", "task-c", "chal-x", ...]
    }
  ]
}
```

---

## extensions（厂商扩展，选填）

```jsonc
{
  "extensions": {
    "know_canvas": {
      "yjs_room": "demo-final",
      "yjs_doc_state_b64": "AAEC...",            // 选填. 完整 yjs 增量, 用于跨实例还原
      "deploy_url": "https://ha2.digitalvio.shop/canvas/?room=demo-final"
    },
    "miaoda": {
      // 秒哒可以在这里塞它需要的字段, 不污染主 schema
      "intent": "...",
      "ui_hints": [...]
    }
  }
}
```

---

## 完整样例（最小可用）

```jsonc
{
  "schema_version": "1.0.0",
  "format": "know-canvas/canvas-export",
  "metadata": {
    "id": "demo-final",
    "title": "在上海开咖啡馆",
    "created_at": "2026-05-02T11:00:00Z",
    "updated_at": "2026-05-02T11:30:00Z",
    "exported_at": "2026-05-02T11:35:00Z",
    "authors": [{ "id": "ou_7fc4...", "name": "你想猫", "role": "owner" }],
    "scenario": "tob",
    "stats": { "node_count": 4, "edge_count": 3, "agent_count": 2 }
  },
  "viewport": { "x": 0, "y": 0, "zoom": 1.0 },
  "nodes": [
    {
      "id": "onto-1", "type": "ontology", "subtype": "goal",
      "position": { "x": 400, "y": 100 },
      "data": { "variant": "goal", "title": "在上海开咖啡馆", "sentence": "在上海开一家咖啡馆" }
    },
    {
      "id": "task-1", "type": "task",
      "position": { "x": 200, "y": 300 },
      "data": {
        "title": "选址分析", "body": "黄浦/静安/徐汇候选",
        "status": "done", "agent_mode": "auto", "assigned_to": "hermes",
        "elapsed_ms": 4144,
        "tokens": { "input": 256, "output": 384, "total": 640 }
      }
    },
    {
      "id": "chal-1", "type": "challenge",
      "position": { "x": 600, "y": 300 },
      "data": {
        "title": "选址成本被低估", "severity": "high", "tag": "business",
        "target_node_id": "task-1", "persona": "reddit"
      }
    },
    {
      "id": "syn-1", "type": "synthesis",
      "position": { "x": 400, "y": 500 },
      "data": {
        "summary": "已综合 1 提议 + 1 反驳",
        "action_plan": "## 行动方案\n1. 先小店试水\n2. ...",
        "health_score": 87,
        "source_proposer_ids": ["onto-1", "task-1"],
        "source_refuter_ids":  ["chal-1"]
      }
    }
  ],
  "edges": [
    { "id": "e1", "source": "onto-1", "target": "task-1",  "type": "derive" },
    { "id": "e2", "source": "task-1", "target": "chal-1",  "type": "refute" },
    { "id": "e3", "source": "chal-1", "target": "syn-1",   "type": "synthesize" }
  ],
  "agent_runs": [
    {
      "id": "run-1", "duration_ms": 12000,
      "scenario": "tob", "persona": "reddit",
      "weights": { "logic": 1, "compliance": 1, "business": 1.2 },
      "rounds": [
        { "round": 1, "delta": 0.34, "health_score": 50, "node_count": 2 },
        { "round": 2, "delta": 0.04, "health_score": 87, "node_count": 4 }
      ],
      "final_health_score": 87,
      "exit_reason": "delta_below_threshold",
      "synthesis_node_id": "syn-1"
    }
  ],
  "extensions": {
    "know_canvas": {
      "yjs_room": "demo-final",
      "deploy_url": "https://ha2.digitalvio.shop/canvas/?room=demo-final"
    }
  }
}
```

---

## 实施建议

### Know Canvas 侧
1. 加 `src/services/canvasExport.js` — 一个纯函数 `exportCanvas(yDoc, metadata) -> json`
2. 加 store action `useCanvasStore.exportToKcanvasJson()`
3. 顶部 toolbar 加「导出」按钮（已有保存/导入/导出占位，把"导出"指到这里）
4. 文件名：`<title>-<date>.kcanvas.json`

### 秒哒对接
- 给秒哒方一份本规范文档 + 一份完整样例
- 秒哒 import 时按 `format` 字段路由：`format === "know-canvas/canvas-export"` 走他们的 know-canvas adapter
- 秒哒不识别的字段（如 `agent_runs / extensions.know_canvas`）忽略即可，不报错
- 秒哒输出回画布时，可以填 `extensions.miaoda`，下次导入 Know Canvas 不丢失

### 版本演进
- 主版本（1.x → 2.0）：节点 type 重命名、必填字段调整 → 不向后兼容
- 次版本（1.0 → 1.1）：加新字段 / 加新 type → 向后兼容
- 修订版本（1.0.0 → 1.0.1）：文档勘误 / 字段语义说明
- 任何升级在本文档顶部加 changelog
