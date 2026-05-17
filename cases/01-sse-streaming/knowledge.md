# SSE 流式响应基础

## 核心概念

所有主流 LLM API（OpenAI、Anthropic、Google）都用 **SSE（Server-Sent Events）** 做流式响应，没有一家用 WebSocket。原因是 LLM 流式输出的本质是服务器往客户端逐 token 推送数据——**单向推送，SSE 天然适合**。

模型是**自回归生成**的——一个 token 一个 token 往外蹦。API 把这个过程包装成一系列 SSE 事件，以 Anthropic 为例：`message_start` → `content_block_start` → `content_block_delta`（反复推送） → `content_block_stop` → `message_delta` → `message_stop`。

## 关键要点

- SSE 跑在标准 HTTP 上，不需要协议升级，任何 HTTP 基础设施都能直接用
- SSE 重连友好：协议定义了 `Last-Event-ID` 和重试机制，断了之后重连有据可循
- SSE 认证简单：每次请求都是标准 HTTP，API Key 直接放 Header 里
- SSE 格式朴素：`event:` 说事件类型，`data:` 放 JSON，空行结束
- 每个 `text-delta` 事件就是一个 token 片段，前端收到后立即追加显示，形成"打字机效果"

## 代码解析

本案例用 `streamText` 的 `fullStream` 迭代器逐 chunk 消费流式响应。关键事件类型：

- `step-start`：新的一轮开始
- `text-delta`：包含一个 token 片段（不是完整文本）
- `finish`：终止原因（`stop`）和 token 用量统计

```javascript
for await (const event of result.fullStream) {
  if (event.type === 'text-delta') {
    fullText += event.textDelta; // 逐 token 拼接
  }
}
```

核心原则：**不要等所有 chunk 到齐才显示——逐 chunk 渲染才是"流式"。**

## 延伸思考

- 为什么 WebSocket 在 LLM 流式场景中不被采用？SSE 的工程优势具体体现在哪些场景？
- 如果 SSE 推到一半断了，客户端手里有一堆不完整的 token，该怎么处理？
