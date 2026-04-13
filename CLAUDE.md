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
- `components/canvas/` — 8 种节点组件
- `utils/fileParser.js` — 文件解析引擎
