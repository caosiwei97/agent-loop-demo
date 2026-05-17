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

## 教学内容

### 一、流式响应

| 案例 | 说明 |
|------|------|
| SSE 流式响应基础 | Server-Sent Events 的基本原理与实现 |
| Tool Call 解析 | 从 SSE 流中解析工具调用的完整流程 |
| 边流式边执行 | 流式接收的同时并行执行工具调用 |
| 并发安全 | 多个工具并发执行时的状态管理与竞态防护 |

### 二、容错机制

| 案例 | 说明 |
|------|------|
| 指数退避 + 随机抖动 | 失败重试的经典策略，避免惊群效应 |
| SSE 心跳 + 看门狗 | 检测连接存活、自动断线重连 |
| 三层降级链 | 主模型 → 备选模型 → 本地回退的渐进降级 |

### 三、运行时安全（三根保险丝）

| 案例 | 说明 |
|------|------|
| 死循环检测：哈希指纹 | 用调用指纹 + 结果指纹检测重复循环 |
| 死循环检测：四种检测器 | 频率、序列、语义、递归四种检测策略 |
| Token 预算控制 | 90% 预警 + 递减回报检测，防止 token 超限 |
| 输出截断恢复 | `finishReason === 'length'` 时的渐进式恢复 |
| Agent Loop 完整骨架 | 把三根保险丝和七种退出路径串联成完整循环 |

## 技术架构

```
agent-teaching-demo/
├── source/                      # 知识来源（人工维护）
│   ├── Agent-Loop-深度分享.md    # 原始教学长文
│   └── assets/                  # 原始素材（Excalidraw 蓝图等）
├── cases/                       # 12 个教学案例（AI 基于来源生成）
│   └── lib/                     # 共享模块（mock-model、retry、loop-detection 等）
├── apps/
│   ├── server/                  # Hono 后端 — 案例管理、代码执行、静态资源
│   └── web/                     # React + Vite 前端 — 知识树、可视化、交互式 UI
```

### 技术栈

- **前端**：React 19 + Ant Design 6 + Vite 8 + TypeScript
- **可视化**：Excalidraw（交互画板）、Mermaid（流程图）、Markmap（思维导图）
- **后端**：Hono + Node.js，提供 REST API 和代码沙箱执行
- **工程**：pnpm workspace monorepo

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

# 同时启动前端和后端（开发模式）
pnpm dev

# 或分别启动
pnpm dev:server   # 后端 → http://localhost:38888
pnpm dev:web      # 前端 → http://localhost:5173
```

打开 http://localhost:5173 即可看到教学界面。

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
