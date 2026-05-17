/**
 * 循环检测器
 *
 * 滑动窗口历史 + 四种检测器 + 三级响应。
 * 提取自案例 08/09，供案例 09/12 共用。
 *
 * 检测器：
 *   1. generic_repeat      — 通用重复检测
 *   2. no_progress_streak  — 无进展轮询检测
 *   3. ping_pong           — 乒乓循环检测
 *   4. circuit_breaker     — 全局熔断器
 *
 * 三级响应：
 *   WARNING  — 记日志，工具继续执行
 *   CRITICAL — 阻断工具，Agent 收到错误
 *   BREAK    — 全局熔断，强制停止
 */

import { createHash } from 'node:crypto';

function hash(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function hashToolCall(toolName, params) {
  // 稳定序列化：排序键
  const sorted = JSON.stringify(params, Object.keys(params || {}).sort());
  return `${toolName}:${hash(sorted)}`;
}

function hashResult(result) {
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  return hash(str);
}

export class LoopDetector {
  /**
   * @param {object} [opts]
   * @param {number} [opts.warning=5]   - 警告阈值
   * @param {number} [opts.critical=8]  - 阻断阈值
   * @param {number} [opts.breaker=10]  - 熔断阈值
   * @param {number} [opts.historySize=30] - 滑动窗口大小
   */
  constructor(opts = {}) {
    this.WARNING = opts.warning ?? 5;
    this.CRITICAL = opts.critical ?? 8;
    this.BREAKER = opts.breaker ?? 10;
    this.HISTORY_SIZE = opts.historySize ?? 30;

    // 各检测器共享的历史
    this._genericHistory = [];
    this._noProgressHistory = [];
    this._pingPongHistory = [];
    this._globalHistory = [];
  }

  /**
   * 记录一次工具调用（在调用前记录）
   */
  recordCall(toolName, params) {
    const callHash = hashToolCall(toolName, params);
    const entry = { toolName, callHash, timestamp: Date.now() };
    this._genericHistory.push(entry);
    if (this._genericHistory.length > this.HISTORY_SIZE) this._genericHistory.shift();
  }

  /**
   * 记录一次工具调用及其结果（在调用完成后记录）
   */
  recordResult(toolName, params, result) {
    const callHash = hashToolCall(toolName, params);
    const resultHash = hashResult(result);

    const entry = { toolName, callHash, resultHash, timestamp: Date.now() };

    this._noProgressHistory.push(entry);
    if (this._noProgressHistory.length > this.HISTORY_SIZE) this._noProgressHistory.shift();

    this._pingPongHistory.push(entry);
    if (this._pingPongHistory.length > this.HISTORY_SIZE) this._pingPongHistory.shift();

    this._globalHistory.push(entry);
    if (this._globalHistory.length > this.HISTORY_SIZE) this._globalHistory.shift();
  }

  /**
   * 执行所有检测器，返回最严重的结果
   *
   * @param {string} toolName - 工具名
   * @param {object} params - 工具参数
   * @returns {{ stuck: boolean, level: string|null, detector: string, count: number, message: string }}
   */
  detect(toolName, params) {
    // 按优先级从高到低检测
    const results = [
      this._detectCircuitBreaker(),
      this._detectPingPong(),
      this._detectNoProgress(toolName, params),
      this._detectGenericRepeat(toolName, params),
    ];

    // 返回最严重的
    const severity = { break: 3, critical: 2, warning: 1, null: 0 };
    let worst = { stuck: false, level: null, detector: 'none', count: 0, message: '正常' };

    for (const r of results) {
      if (severity[r.level] > severity[worst.level]) {
        worst = r;
      }
    }

    return worst;
  }

  /**
   * 重置所有历史
   */
  reset() {
    this._genericHistory = [];
    this._noProgressHistory = [];
    this._pingPongHistory = [];
    this._globalHistory = [];
  }

  // --- 检测器 1: 通用重复检测 ---
  _detectGenericRepeat(toolName, params) {
    const callHash = hashToolCall(toolName, params);
    const count = this._genericHistory.filter(h => h.callHash === callHash).length;

    if (count >= this.BREAKER) {
      return { stuck: true, level: 'break', detector: 'generic_repeat', count, message: `[熔断] ${toolName} 已调用 ${count} 次，强制停止` };
    }
    if (count >= this.CRITICAL) {
      return { stuck: true, level: 'critical', detector: 'generic_repeat', count, message: `[阻断] ${toolName} 已调用 ${count} 次` };
    }
    if (count >= this.WARNING) {
      return { stuck: false, level: 'warning', detector: 'generic_repeat', count, message: `[警告] ${toolName} 已调用 ${count} 次` };
    }
    return { stuck: false, level: null, detector: 'generic_repeat', count, message: '正常' };
  }

  // --- 检测器 2: 无进展轮询检测 ---
  _detectNoProgress(toolName, params) {
    const callHash = hashToolCall(toolName, params);

    // 计算连续相同结果的次数
    let streak = 0;
    let lastRHash = null;
    for (let i = this._noProgressHistory.length - 1; i >= 0; i--) {
      const r = this._noProgressHistory[i];
      if (r.callHash !== callHash) continue;
      if (!lastRHash) { lastRHash = r.resultHash; streak = 1; continue; }
      if (r.resultHash !== lastRHash) break;
      streak++;
    }

    if (streak >= this.BREAKER) {
      return { stuck: true, level: 'break', detector: 'no_progress_streak', count: streak, message: `[无进展熔断] ${toolName} 连续 ${streak} 次返回相同结果` };
    }
    if (streak >= this.CRITICAL) {
      return { stuck: true, level: 'critical', detector: 'no_progress_streak', count: streak, message: `[无进展阻断] ${toolName} 连续 ${streak} 次返回相同结果` };
    }
    if (streak >= this.WARNING) {
      return { stuck: false, level: 'warning', detector: 'no_progress_streak', count: streak, message: `[无进展警告] ${toolName} 连续 ${streak} 次返回相同结果` };
    }
    return { stuck: false, level: null, detector: 'no_progress_streak', count: streak, message: '正常' };
  }

  // --- 检测器 3: 乒乓循环检测 ---
  _detectPingPong() {
    if (this._pingPongHistory.length < 4) {
      return { stuck: false, level: null, detector: 'ping_pong', count: 0, message: '数据不足' };
    }

    const last = this._pingPongHistory[this._pingPongHistory.length - 1];
    let otherHash = null;
    for (let i = this._pingPongHistory.length - 2; i >= 0; i--) {
      if (this._pingPongHistory[i].callHash !== last.callHash) {
        otherHash = this._pingPongHistory[i].callHash;
        break;
      }
    }

    if (!otherHash) {
      return { stuck: false, level: null, detector: 'ping_pong', count: 0, message: '未检测到交替模式' };
    }

    // 计算交替次数
    let altCount = 0;
    for (let i = this._pingPongHistory.length - 1; i >= 0; i--) {
      const expected = altCount % 2 === 0 ? last.callHash : otherHash;
      if (this._pingPongHistory[i].callHash !== expected) break;
      altCount++;
    }

    // 检查两边的结果是否都没变
    const hash1Results = new Set(
      this._pingPongHistory.filter(h => h.callHash === last.callHash).map(h => h.resultHash)
    );
    const hash2Results = new Set(
      this._pingPongHistory.filter(h => h.callHash === otherHash).map(h => h.resultHash)
    );
    const noChange = hash1Results.size === 1 && hash2Results.size === 1;

    if (altCount >= this.CRITICAL && noChange) {
      return { stuck: true, level: 'critical', detector: 'ping_pong', count: altCount, message: `[乒乓循环] 两个工具交替调用 ${altCount} 次且无进展` };
    }
    if (altCount >= this.WARNING && noChange) {
      return { stuck: false, level: 'warning', detector: 'ping_pong', count: altCount, message: `[乒乓警告] 疑似交替循环 ${altCount} 次` };
    }
    return { stuck: false, level: null, detector: 'ping_pong', count: altCount, message: '正常' };
  }

  // --- 检测器 4: 全局熔断器 ---
  _detectCircuitBreaker() {
    // 统计无进展调用总数
    let noProgressTotal = 0;
    const seen = new Map();
    for (const record of this._globalHistory) {
      const key = record.callHash;
      if (!seen.has(key)) {
        seen.set(key, { count: 0, lastResultHash: null, noProgress: 0 });
      }
      const entry = seen.get(key);
      if (entry.lastResultHash === record.resultHash) {
        entry.noProgress++;
        noProgressTotal++;
      } else {
        entry.lastResultHash = record.resultHash;
      }
      entry.count++;
    }

    if (noProgressTotal >= this.BREAKER) {
      return { stuck: true, level: 'break', detector: 'circuit_breaker', count: noProgressTotal, message: `[全局熔断] 无进展调用累计 ${noProgressTotal} 次` };
    }
    return { stuck: false, level: null, detector: 'circuit_breaker', count: noProgressTotal, message: '正常' };
  }
}
