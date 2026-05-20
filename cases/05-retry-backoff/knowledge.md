# 指数退避重试

## 核心概念

不是所有错误都值得重试。`429` 限流等一等就好，`401` 密钥过期等多久都没用。

| 类型       | 状态码                                  | 怎么办    |
| ---------- | ------------------------------------- | ------ |
| **可重试**  | `429`、`529`/`503`、`408`、`ECONNRESET` | 指数退避重试 |
| **不可重试** | `400`、`401`/`403`、`402`              | 直接报错   |
| **需要降级** | 连续多次 `529`、流式反复断开                    | 换策略    |

最差的做法： `while + sleep`。

```javascript
while (true) {
  try {
    return await callAPI();
  } catch (e) {
    await sleep(1000); // 不管什么错，等 1 秒再来
  }
}
```

`429` 越重试越限流，`401` 重试再多也没用。

## 关键要点

- **指数退避**：第一次等 500ms，第二次 1s，第三次 2s，间隔翻倍递增
- **随机抖动**：在退避时间上加随机偏移，把不同客户端的请求在时间轴上打散
- **重试风暴**：1000 个客户端同时等 1 秒后重试 → 同时打回去 → 又 429
- **Retry-After 头**：服务端给的答案优先于自己计算的退避时间
- Claude Code 基础退避 500ms，每次翻倍，最多重试 10 次

## 代码解析

本案例对比了三种重试策略：

```javascript
// 固定间隔（差）—— 导致重试风暴
function fixedDelay(attempt) { return 1000; }

// 指数退避（好）
function exponentialBackoff(attempt) {
  return Math.min(500 * Math.pow(2, attempt), 30000);
}

// 指数退避 + 随机抖动（最好）— Claude Code 的做法
function getRetryDelay(attempt) {
  const base = 500;
  const delay = base * Math.pow(2, attempt);
  const jitter = Math.random() * delay * 0.25;
  return Math.min(delay + jitter, 30000);
}
```

## 延伸思考

- 如果服务端返回了 `Retry-After: 5`，但你的指数退避计算出来只需等 1 秒，该听谁的？为什么？
- 429 和 529 都是可重试错误，但它们的重试策略是否应该不同？
