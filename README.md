<p align="center">
  <img src="public/vite.svg" width="64" height="64" alt="Know Canvas Logo" />
</p>

<h1 align="center">Know Canvas</h1>

<p align="center">
  <strong>开源知识图谱画布</strong><br />
  从外部文件和信息构建可视化知识网络
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> · 
  <a href="#-核心特性">核心特性</a> · 
  <a href="#-架构设计">架构设计</a> · 
  <a href="#-节点系统">节点系统</a> · 
  <a href="#-贡献指南">贡献指南</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-c8a882?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-333333?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind-4-06b6d4?style=flat-square&logo=tailwindcss" alt="Tailwind" />
</p>

---

## Overview

Know Canvas 将零散的文档、链接和文本片段转化为**交互式知识图谱**。导入一篇 Markdown，AI 自动提取关键概念、发现层级与共现关系，在画布上呈现为可拖拽、可连线、可分组的可视化网络。

```
  文件/URL/文本  ──→  解析引擎  ──→  概念提取  ──→  关系推断  ──→  可视化画布
       │                │               │               │              │
   MD/JSON/CSV     fileParser.js    aiService.js   suggestRelations   React Flow
   图片/视频/PDF   linkPreview.js   extractConcepts                   KnowledgeCanvas
```

---

## 🚀 快速开始

```bash
git clone https://github.com/nieao/know-canvas.git
cd know-canvas
npm install
npm run dev        # http://localhost:5180
```

```bash
npm run build      # 生产构建
npm run test:e2e   # E2E 测试 (Playwright)
```

---

## ✦ 核心特性

### 多格式导入

| 格式 | 处理方式 | 产出 |
|:-----|:---------|:-----|
| `.md` | 提取标题层级 + 段落 + 行内标签 | 概念节点 + 层级关系 |
| `.json` | 解析数组/对象，智能字段匹配 | 概念节点 |
| `.csv` | 自动识别标题/描述/标签列 | 概念节点 |
| `.txt` | 按段落分割 | 概念节点 |
| 图片 | `jpg` `png` `gif` `webp` `svg` | 图片节点 |
| 视频 | `mp4` `webm` `mov` | 视频节点 |
| 文档 | `pdf` `doc` `xlsx` `ppt` | 文件节点 |
| URL | Microlink 元数据抓取 | 书签节点 |

### 8 种知识关系

```
  因果 ━━━━━━  A 导致 B           ┃  相似 ╌╌╌╌╌  A 类似 B
  组成 ━━━━━━  A 是 B 的部分      ┃  矛盾 ━━━━━━  A 与 B 矛盾
  依赖 ━━━━━━  A 依赖于 B         ┃  引用 ╌╌╌╌╌  A 引用 B
  顺序 ━━━━━━  A 在 B 之前        ┃  相关 ╌╌╌╌╌  一般关联
```

### 智能交互

- **圈选 + 右键** — 自动链接（全互连 / 链式 / 按类型）
- **拖拽导入** — 文件直接拖进画布
- **快捷键** — `Ctrl+C/V` 复制粘贴 · `?` 快捷键面板 · `Space` 平移
- **多种布局** — 网格 · 力导向 · 径向 · 层次
- **分组折叠** — 将相关概念打包管理

---

## 🏛 架构设计

### 系统拓扑

```
┌─────────────────────────────────────────────────────────┐
│                    Know Canvas                          │
│                                                         │
│  ┌──────────┐   ┌──────────────────┐   ┌────────────┐  │
│  │          │   │                  │   │            │  │
│  │  左面板   │   │   KnowledgeCanvas  │   │  右面板    │  │
│  │          │   │   (React Flow)   │   │            │  │
│  │ 知识源    │◀─▶│                  │◀─▶│ 概念详情   │  │
│  │ 文件导入  │   │  ┌────┐ ┌────┐  │   │ 关系编辑   │  │
│  │ URL 导入  │   │  │概念│─│概念│  │   │ 标签管理   │  │
│  │ 文本导入  │   │  └────┘ └────┘  │   │ 分类分配   │  │
│  │ 搜索过滤  │   │       │         │   │            │  │
│  │          │   │  ┌────┐ ┌────┐  │   │            │  │
│  │          │   │  │书签│─│笔记│  │   │            │  │
│  │          │   │  └────┘ └────┘  │   │            │  │
│  └──────────┘   └──────────────────┘   └────────────┘  │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐    │
│  │              BottomAIBar                        │    │
│  │  [ 提取概念 ] [ 发现关系 ] [ 知识摘要 ] [ 分析 ] │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 数据流

```
                    ┌─────────────┐
                    │   用户输入   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ 文件解析  │ │ URL 抓取  │ │ 文本输入  │
        │fileParser│ │linkPreview│ │ 直接粘贴  │
        └─────┬────┘ └─────┬────┘ └─────┬────┘
              │            │            │
              └────────────┼────────────┘
                           ▼
                  ┌─────────────────┐
                  │  aiService.js   │
                  │  概念提取 + 关系  │
                  └────────┬────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │useCanvas │ │useKnowl- │ │useGraph  │
        │  Store   │ │edgeStore │ │  Store   │
        │节点/边/布局│ │知识源/分类 │ │ 组合接口  │
        └─────┬────┘ └──────────┘ └──────────┘
              │
              ▼
     ┌─────────────────┐
     │ KnowledgeCanvas │
     │   (React Flow)  │
     │                 │
     │  8 种节点类型    │
     │  8 种关系连线    │
     │  4 种布局算法    │
     └─────────────────┘
```

### 技术栈

| 层级 | 技术 | 版本 | 用途 |
|:-----|:-----|:-----|:-----|
| 视图 | React | 19 | UI 框架 |
| 画布 | React Flow | 11 | 交互式节点图 |
| 状态 | Zustand + Immer | 5 | 不可变状态管理 |
| 样式 | Tailwind CSS | 4 | 原子化 CSS |
| 构建 | Vite | 7 | 开发/构建工具 |
| 测试 | Playwright | - | E2E 浏览器测试 |
| 导出 | html-to-image / jspdf | - | PNG/PDF 导出 |

---

## 🧩 节点系统

### 8 种节点类型

```
  ┌─ 知识类 ─────────────────────────────────────┐
  │                                               │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
  │  │  概念     │  │  分类     │  │  笔记     │    │
  │  │ Concept  │  │ Category │  │  Note    │    │
  │  │          │  │          │  │          │    │
  │  │ 标题/描述 │  │ 名称/颜色 │  │ 自由文本  │    │
  │  │ 标签/来源 │  │ 子节点数  │  │ 可编辑   │    │
  │  └──────────┘  └──────────┘  └──────────┘    │
  └───────────────────────────────────────────────┘

  ┌─ 媒体类 ─────────────────────────────────────┐
  │                                               │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
  │  │  书签     │  │  图片     │  │  视频     │    │
  │  │ Bookmark │  │  Image   │  │  Video   │    │
  │  │          │  │          │  │          │    │
  │  │ URL 预览  │  │ 缩放/裁切│  │ YT/B站   │    │
  │  │ 元数据    │  │ 拖拽上传  │  │ 本地文件  │    │
  │  └──────────┘  └──────────┘  └──────────┘    │
  └───────────────────────────────────────────────┘

  ┌─ 组织类 ─────────────────────────────────────┐
  │                                               │
  │  ┌──────────┐  ┌──────────┐                   │
  │  │  文件     │  │  分组     │                   │
  │  │  File    │  │  Group   │                   │
  │  │          │  │          │                   │
  │  │ PDF/DOC  │  │ 折叠/展开 │                   │
  │  │ XLS/PPT  │  │ 颜色/命名 │                   │
  │  └──────────┘  └──────────┘                   │
  └───────────────────────────────────────────────┘
```

---

## 📂 项目结构

```
know-canvas/
├── public/
│   └── vite.svg                # 知识图谱 Logo
├── src/
│   ├── components/
│   │   ├── canvas/
│   │   │   ├── KnowledgeCanvas.jsx   # 主画布容器
│   │   │   ├── ConceptNode.jsx       # 概念节点
│   │   │   ├── CategoryNode.jsx      # 分类节点
│   │   │   ├── BookmarkNode.jsx      # 书签节点
│   │   │   ├── ImageNode.jsx         # 图片节点
│   │   │   ├── VideoNode.jsx         # 视频节点
│   │   │   ├── NoteNode.jsx          # 笔记节点
│   │   │   ├── FileNode.jsx          # 文件节点
│   │   │   ├── GroupNode.jsx         # 分组节点
│   │   │   ├── SelectionToolbar.jsx  # 多选工具栏
│   │   │   └── NodePropertyPanel.jsx # 属性面板
│   │   └── ErrorBoundary.jsx         # 错误边界
│   ├── pages/
│   │   ├── KnowledgeGraph.jsx        # 主页面
│   │   └── panels/
│   │       ├── LeftPanel.jsx         # 知识源管理
│   │       ├── RightPanel.jsx        # 概念详情
│   │       ├── BottomAIBar.jsx       # AI 分析栏
│   │       └── SaveExportToolbar.jsx # 保存导出
│   ├── stores/
│   │   ├── useCanvasStore.js         # 画布状态
│   │   ├── useKnowledgeStore.js      # 知识源状态
│   │   └── useGraphStore.js          # 组合 Hook
│   ├── services/
│   │   └── aiService.js              # AI 概念提取
│   └── utils/
│       ├── fileParser.js             # 多格式文件解析
│       ├── linkPreview.js            # URL 元数据
│       └── videoUtils.js             # 视频处理
├── e2e/
│   └── full-flow.spec.js            # 22 个 E2E 测试
├── playwright.config.js
├── vite.config.js
└── package.json
```

---

## ⌨️ 快捷键

| 快捷键 | 操作 |
|:-------|:-----|
| `Ctrl + B` | 切换左侧知识源面板 |
| `Ctrl + ]` | 切换右侧详情面板 |
| `Ctrl + A` | 全选节点 |
| `Ctrl + C / V` | 复制 / 粘贴节点 |
| `Ctrl + 0` | 适应视图 |
| `Ctrl + 1` | 重置缩放 100% |
| `Space + 拖拽` | 平移画布 |
| `?` | 快捷键面板 |
| `Delete` | 删除选中 |
| `右键` (多选) | 自动链接菜单 |

---

## 📤 导出格式

| 格式 | 说明 |
|:-----|:-----|
| **JSON** | 完整画布数据，可重新导入 |
| **Markdown** | 按分类整理的知识库文档 |
| **JSON-LD** | 语义化链接数据（Schema.org） |
| **PNG** | 高清画布截图 |

---

## 🎨 设计语言

**建筑极简唯美** (Architectural Minimalism)

```
色彩    ■ #1a1a1a 主文字    □ #fafafa 背景    ■ #c8a882 暖色点缀
字体    衬线标题 Noto Serif SC  ·  无衬线正文 Noto Sans SC
间距    8px 倍数系统  ·  内容区 max-width: 1100px
线条    1px solid #e8e8e8  ·  hover 变暖色
动效    cubic-bezier(0.22, 1, 0.36, 1)  ·  IntersectionObserver 入场
```

---

## 🤝 贡献指南

```bash
# Fork & Clone
git clone https://github.com/<your-name>/know-canvas.git

# 安装依赖
npm install

# 开发
npm run dev

# 运行测试
npm run test:e2e

# 构建
npm run build
```

欢迎提交 Issue 和 Pull Request。

---

## Roadmap

- [ ] AI 深度分析 — 接入 claude CLI 进行语义概念提取
- [ ] 协同编辑 — 多人实时协作
- [ ] 知识库持久化 — 后端存储 + 用户系统
- [ ] 插件系统 — 自定义节点类型和关系
- [ ] 更多导入源 — Notion / Obsidian / Roam Research

---

## License

MIT

---

<p align="center">
  <sub>Built with React Flow + Zustand + Tailwind CSS</sub>
</p>
