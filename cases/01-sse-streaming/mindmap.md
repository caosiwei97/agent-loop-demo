# SSE 流式响应基础
## 为什么用 SSE
### 单向推送，天然适合 LLM 输出
### 跑在标准 HTTP 上
### 重连友好 (Last-Event-ID)
### 认证简单 (API Key in Header)
## SSE 事件流
### message_start → 消息开始
### content_block_delta → 逐 token 推送
### content_block_stop → 内容块结束
### message_stop → 整条消息结束
## 核心：自回归生成
### 一个 token 一个 token 往外蹦
### 每个 delta 就是一个微小增量
### 前端逐 chunk 渲染 = 打字机效果
## 不用 WebSocket 的原因
### 审批是低频事件
### SSE + HTTP POST = 双向通信
