# Agent Loop 教学演示

一个交互式的 Agent Loop 教学平台，通过可视化、可执行的案例帮助你理解 AI Agent 核心循环的每个关键环节。

## 项目简介

本项目围绕 Agent Loop（智能体循环）的三大主题，提供 **12 个渐进式教学案例**，每个案例都包含：

- **知识点** — 深度讲解原理与设计思路
- **可运行代码** — 基于 Node.js 的可执行 `.mjs` 脚本，使用 mock 模拟真实场景
- **流程图** — Mermaid 绘制的架构/流程可视化
- **思维导图** — 知识点结构化总结
- **Excalidraw 蓝图** — 核心案例的交互式架构图（部分案例）
- **交互演示** — 可在浏览器中直接运行的 HTML 演示（部分案例）

## 技术架构

```
agent-teaching-demo/
├── source/                      # 知识来源（人工维护）
│   ├── Agent-Loop-深度分享.md    # 原始教学长文
│   └── assets/                  # 原始素材（Excalidraw 蓝图等）
├── cases/                       # 12 个教学案例
│   ├── lib/                     # 共享模块（mock-model、retry、loop-detection 等）
│   ├── 01-sse-streaming/        # 每个案例包含：index.mjs / knowledge.md / diagram.mmd / mindmap.md / interactive.html
│   └── ...
├── src/                         # Astro + React 前端
│   ├── pages/index.astro        # 单页入口
│   ├── components/              # React 组件（App、KnowledgeTree、ContentArea、TopBar）
│   ├── tabs/                    # Tab 视图（Code、Diagram、Excalidraw、Interactive、Knowledge）
│   ├── demos/                   # 交互演示组件
│   ├── hooks/useWebContainer.ts # WebContainer 沙箱执行
│   └── lib/                     # 类型定义、案例加载器
├── public/                      # 静态资源（字体、图标、数据）
└── astro.config.mjs             # Astro 配置（静态输出、COOP/COEP 头）
```

### 技术栈

- **框架**：Astro（静态输出）+ React 19 + TypeScript
- **UI**：Ant Design 6
- **可视化**：Excalidraw（交互画板）、Mermaid（流程图）、Markmap（思维导图）
- **代码执行**：WebContainer API（浏览器内 Node.js 沙箱）
- **工程**：pnpm

### 前端 Tab 页

每个案例打开后可切换 6 个视图：

| Tab | 说明 |
|-----|------|
| 代码 | 带语法高亮的源码查看，支持一键执行 |
| 全景图 | Excalidraw 交互式画板，展示架构全貌 |
| 知识点 | Markdown 渲染的深度讲解文章 |
| 流程图 | Mermaid 绘制的流程/架构图 |
| 交互演示 | 可在浏览器中直接运行的 HTML 演示 |
| 思维导图 | Markmap 渲染的知识结构图 |

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装与启动

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev        # http://localhost:5173
```

### 构建与预览

```bash
pnpm build
```

构建产物在 `dist/` 目录。本项目使用了 [WebContainer](https://webcontainers.io/)，它依赖 `SharedArrayBuffer`，浏览器要求页面处于 **Cross-Origin Isolated** 状态。因此静态服务器必须发送以下响应头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

#### 方式一：astro preview（默认支持）

```bash
pnpm preview
```

Astro 内置的预览服务器已自动配置 COOP/COEP 头。

#### 方式二：serve + serve.json

在项目根目录创建 `serve.json`：

```json
{
  "headers": [
    {
      "source": "**/*",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

```bash
npx serve dist
```

#### 方式三：Python

```bash
python3 -c "
import http.server
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy','same-origin')
        self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        super().end_headers()
http.server.HTTPServer(('0.0.0.0',4321),H).serve_forever()
"
```

然后访问 `http://localhost:4321`。

> **注意**：直接双击 `dist/index.html`（`file://` 协议）或使用不带 COOP/COEP 头的静态服务器，WebContainer 会报错：`SharedArrayBuffer transfer requires self.crossOriginIsolated`。

### 直接运行单个案例

每个 `cases/*/index.mjs` 都是独立可执行的：

```bash
node cases/01-sse-streaming/index.mjs
node cases/05-retry-backoff/index.mjs
node cases/12-agent-loop-skeleton/index.mjs
```

## 作为 Skill 使用

本项目已封装为 [teaching-viz](https://github.com/caosiwei97/agent-skills/tree/main/skills/teaching-viz) skill，可在 OpenCode 等 AI Agent 中直接调用：

```bash
npx skills add caosiwei97/agent-skills --path skills/teaching-viz
```

传入一个包含 Markdown 教学内容的目录，即可自动生成带有知识树、流程图、思维导图、Excalidraw 画板的交互式教学页面。

## License

MIT
