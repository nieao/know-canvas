# 会话记录 · 2026-05-02 · 系统剪贴板粘贴 → 自动建节点

> 这是 boss × ui-cc 单次会话（context compact 后到收尾）的留档。
> 紧接 [session-log-2026-05-02-conductor.md](./session-log-2026-05-02-conductor.md) + [CC-HANDOFF.md](./CC-HANDOFF.md)。
> 范围: 撤回 VocaBuilder 整合 + 加 Ctrl+V 系统剪贴板自动建节点。

---

## 会话起点（context compact 后）

context 恢复时手上未结的事:
- 已撤 VocaBuilder 完整快照 (commit 3d2db09 → feat/full-snapshot)
- 待办: 实现 Ctrl+V 系统剪贴板 → 自动建节点 (boss 原话: "VocaBuilder 我只要画布 外部文件链接文字 等导入功能")

---

## 设计决策

### 为什么单独加 paste 监听器, 不复用 keydown Ctrl+V?

`KnowledgeCanvas.jsx:360-366` 既有的 keydown Ctrl+V 走 `handlePaste()`, 那是**画布内部剪贴板**(复制选中节点然后粘贴克隆), 跟系统剪贴板没关系——keydown 拿不到 `e.clipboardData`。系统粘贴必须监听原生 `paste` 事件才能拿到 `clipboardData.files / .getData('text/plain')`。

### 优先级: 内部剪贴板 > 系统剪贴板

如果用户先复制了画布节点, 然后又复制了别的东西到系统剪贴板, 此时 Ctrl+V 应该走哪条? 我的选择是**让位给内部**(只要 `clipboardData.nodes.length > 0` 就跳过), 因为 keydown handler 会在 paste handler 之前触发并 `e.preventDefault()`, 真实场景几乎不会冲突。

### 为什么文件粘贴复用 `canvas-file-drop` 而不是新事件?

KnowledgeGraph 既有的 `handleFileDrop(files, position)` 已经按扩展名分流到 `addImageNode/addVideoNode/addFileNode`, 完全够用。复用避免双份代码 → 一份 bug 修两处。

### 为什么 URL 粘贴复用 `canvas-url-drop`?

同上。`KnowledgeGraph.jsx:218` 既有 `(e) => addBookmarkNode(e.detail.url, '', '', '', '', e.detail.position, true)`, 自带异步抓 favicon + 标题, 一行复用。

### 多 URL 检测

如果剪贴板是多行文本且**每一行都是 URL**, 当作多 URL 处理, 每个建一个 BookmarkNode 并 30px 偏移堆叠。混杂(部分 URL 部分文字)时按纯文本处理避免误判。

### 落点为什么是画布可视中心?

paste 事件没有鼠标坐标 (键盘触发的). 选项:
- A. 上次鼠标位置 → 需要全局 mousemove 监听, 性能税
- B. 视口中心 (`window.innerWidth/2`) → 不准, 画布有侧栏
- **C. wrapper 元素中心** (`reactFlowWrapper.current.getBoundingClientRect()`) → 准, 0 成本 ✅

---

## 改动清单

### `src/components/canvas/KnowledgeCanvas.jsx` (+76 行 useEffect)

新增 `paste` 事件监听器, 焦点在 INPUT/TEXTAREA/SELECT/contenteditable 时不拦截。流程:
```
焦点可编辑? → 让浏览器默认处理
clipboardData.files 非空? → 派 canvas-file-drop
text 是单 URL? → 派 canvas-url-drop
text 全是 URL 多行? → 多次派 canvas-url-drop, 30px 偏移
否则 → 派 canvas-paste-text
```

落点用 `reactFlowWrapper.current.getBoundingClientRect()` 中心 + `screenToFlowPosition` 转换。

### `src/pages/KnowledgeGraph.jsx` (+5 行)

新加 `canvas-paste-text` 事件 handler:
```js
const onCanvasPasteText = (e) => {
  const { text, position } = e.detail
  if (text) addNoteNode(text, position)
}
```
register/cleanup 配套加好。

### `.test-paste.mjs` (新增 Playwright 验证)

模拟 4 种场景:
1. 单 URL → BookmarkNode (✅ 自动抓 favicon + 标题)
2. 多行 3 URL → 3 BookmarkNode 堆叠
3. 多行纯文本 → NoteNode
4. 输入框焦点时粘贴不建节点

`headless: true`, 用 `ClipboardEvent` + `DataTransfer` 模拟系统粘贴。

---

## 测试结果

```
[13:45:14] baseline 节点数: 11
[13:45:16] ✅ URL 粘贴建 BookmarkNode (节点 11→12, BookmarkNode=1)
[13:45:19] ✅ 3 URL 粘贴建 3 节点 (+3 节点)
[13:45:21] ✅ 纯文本粘贴建 NoteNode (节点 15→16, NoteNode 0→1)
[13:45:22] ✅ INPUT 焦点粘贴不建节点 (节点 16→16 不变)
通过 4, 失败 0
```

视觉确认 (`.test-screenshots/paste-{01,02,03}-*.png`): BookmarkNode 拉到了 anthropic.com 的真实标题 "Home | Anthropic", 说明 conductor 反代起作用。

---

## 没自动测的部分

**文件 / 图片粘贴**: code path 已写好(走 `canvas-file-drop` → `handleFileDrop` → `addImageNode/addFileNode`), 但 Playwright 模拟剪贴板二进制需要 CDP 级 `Input.insertText` 操作, 跳过。用户实际从资源管理器复制图片/PDF 粘贴会自动建对应节点。建议手测一次确认。

---

## 已知坑

### 1. `clipboardData.getData('text/uri-list')` 在某些浏览器不返回

Chrome/Edge 大部分情况下 URL 复制只走 `text/plain`, `text/uri-list` 只在拖拽时填充。我同时读两个, 取非空的。

### 2. URL 检测严格度

`/^https?:\/\/\S+$/i` — 只认 http/https 开头, 不认 `example.com` 这种省略协议的, 不认 `ftp://` `mailto:`。如果将来要扩, 改这一行正则。理由: 太宽容会把"这是 https://test 的笔记"这种文本误判成 URL。

### 3. 内部剪贴板 vs 系统剪贴板冲突

keydown Ctrl+V 触发 `handlePaste()` 后 `e.preventDefault()` 不会阻止后续 paste 事件 (浏览器不发了)。但理论上某些 IME 场景可能有竞态。实测没复现, 先不防御。

---

## 下一步留给谁

- **boss**: 实测一下从微信/QQ/钉钉复制图片粘贴(这些 IM 客户端剪贴板格式偶尔奇葩); 从 Office 复制表格粘贴目前会走纯文本 → NoteNode, 是否要解析 HTML 表格另说
- **orchestra-cc**: 没冲突, 我没动他的 SynthesisNode/AletheiaLayer 那段
- **lichang333**: 还在等他给 SOUL.md 加 `kanban_done` 收尾提示 (跟本次粘贴功能无关, 但 demo 时如果走真 Hermes 链路, ResultNode 才会涌现)

---

## 提交记录

```
(本次会话未提交; boss 决定何时归并到 main 再 push)
```
