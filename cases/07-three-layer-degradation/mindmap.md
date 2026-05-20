# 三层降级链
## Layer 1: 流式重试
### 指数退避 + 随机抖动
### 最多重试 10 次
### 处理暂时性 429/529
## Layer 2: 非流式降级
### 切换为 doGenerate
### 一次性请求-响应
### 对服务端压力更小
### 超时 120 秒
## Layer 3: 模型降级
### Opus → Sonnet
### 换模型不重建上下文
### 不同模型有独立资源配额
## 核心原则
### 失败预算是连续的
### Layer 1 用了 6 次 → Layer 2 只有 4 次
### 兄弟模型 Failover 优先于跨 Provider
### 每层只处理自己擅长的故障
## 兄弟模型 Failover
### Sonnet 4.6 限流 → Sonnet 4.5 / Haiku
### API 速率限制按模型区分
### 消息格式一致，无需转换上下文
### 只有 rate_limit/overloaded 值得
### billing/auth 是 Provider 级问题
## 多 Provider 容灾
### Anthropic → OpenAI → Google → Ollama
### 临时故障: 退避封顶 1hr
### 持久故障(欠费/密钥): 退避基数 5hr
### 兄弟模型优先于跨 Provider
### 跨 Provider 需要上下文适配
