# 三层降级链

## 核心概念

光有重试不够。Agent 的容错是分层的——每一层处理不同级别的故障，内层解决不了的才升级到外层：

- **Layer 1**：流式请求 + 指数退避重试（最多 10 次）
- **Layer 2**：非流式降级（切换为一次性请求-响应，对服务端更友好）
- **Layer 3**：模型降级（Opus → Sonnet，换模型不重建上下文）

核心原则：**两层的失败预算是连续的，不是各算各的。** Layer 1 用了 6 次重试后，Layer 2 只有剩余的 4 次机会。

## 关键要点

- 流式失败转非流式有效：非流式不需要维持长连接，对服务端压力更小
- 模型降级有效：不同模型有独立的服务资源和算力配额，Opus 过载不代表 Sonnet 也过载
- 同一 API 提供商的模型共享消息格式，换模型只需改 `model` 字段
- **兄弟模型 Failover**：API 速率限制按模型区分，Sonnet 4.6 满了不代表 Haiku 也满
- 只有 `rate_limit` 和 `overloaded` 才值得兄弟模型切换，`billing` 和 `auth` 是 Provider 级别问题

## 代码解析

本案例模拟完整的降级过程：

```
Layer 1: 流式请求 → 429/529 × 6 次 → 连续失败，升级
Layer 2: 非流式请求 → 529 × 3 次 → 连续 3 次 529，升级
Layer 3: Opus → Sonnet → 成功
```

关键代码逻辑——共享失败预算：
```javascript
const TOTAL_FAIL_BUDGET = 10;
const remainingBudget = TOTAL_FAIL_BUDGET - layer1FailCount;
const layer2MaxAttempts = Math.min(NON_STREAM_RETRY_MAX, remainingBudget);
```

## 延伸思考

- 如果你同时接了多家 API 提供商（Anthropic + OpenAI + Google），你会按什么顺序 failover？优先兄弟模型还是优先跨 Provider？
- 三层降级的每一层都有时间成本，如何平衡"降级速度"和"重试机会"？
