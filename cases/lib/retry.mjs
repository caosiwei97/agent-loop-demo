/**
 * 重试逻辑
 *
 * 提供错误分类、指数退避计算和重试循环。
 * 提取自案例 05/07，供多个案例共用。
 */

/**
 * 判断错误是否可重试
 *
 * 可重试: 429 (Too Many Requests), 529 (Site Overloaded),
 *         503 (Service Unavailable), 408 (Request Timeout),
 *         ECONNRESET, ETIMEDOUT, ENOTFOUND
 *
 * @param {Error} error - 错误对象
 * @returns {boolean}
 */
export function isRetryable(error) {
  const msg = error.message || '';
  // HTTP 状态码
  if (msg.includes('429') || msg.includes('529') || msg.includes('503') || msg.includes('408')) {
    return true;
  }
  // 网络错误
  if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
    return true;
  }
  return false;
}

/**
 * 计算重试延迟（指数退避 + 随机抖动）
 *
 * @param {number} attempt - 当前重试次数（从 0 开始）
 * @param {number} [baseMs=500] - 基础延迟（毫秒）
 * @param {number} [maxMs=30000] - 最大延迟（毫秒）
 * @returns {number} 延迟毫秒数
 */
export function calculateDelay(attempt, baseMs = 500, maxMs = 30000) {
  const exponentialDelay = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * exponentialDelay * 0.25;
  return Math.min(exponentialDelay + jitter, maxMs);
}

/**
 * 带指数退避的重试循环
 *
 * @param {Function} fn - 异步函数，返回值表示成功
 * @param {number} [maxRetries=10] - 最大重试次数
 * @param {object} [opts]
 * @param {number} [opts.baseMs=500] - 基础延迟
 * @param {number} [opts.maxMs=30000] - 最大延迟
 * @param {Function} [opts.onRetry] - 重试回调 (attempt, delay, error)
 * @param {Function} [opts.onError] - 错误分类函数，返回 true 表示可重试
 * @returns {Promise<*>} fn 的返回值
 */
export async function retryWithBackoff(fn, maxRetries = 10, opts = {}) {
  const { baseMs = 500, maxMs = 30000, onRetry, onError } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // 检查是否可重试
      if (onError ? !onError(err) : !isRetryable(err)) {
        throw err;
      }

      if (attempt >= maxRetries) {
        throw err;
      }

      const delay = calculateDelay(attempt, baseMs, maxMs);
      if (onRetry) {
        onRetry(attempt, delay, err);
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
