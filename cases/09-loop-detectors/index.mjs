/**
 * @title 死循环检测：四种检测器
 * @group 运行时安全
 * @description 演示四种循环检测器的工作原理
 */

import { createHash } from 'node:crypto';

// ============================================================================
// 四种循环检测器
//
// 基于教学材料和参考实现 (super-agent/src/loop-detection.ts)
// 演示用阈值：5/8/10（生产环境通常是 10/20/30）
// ============================================================================

console.log('='.repeat(60));
console.log('案例 09: 死循环检测 -- 四种检测器');
console.log('='.repeat(60));
console.log();

// --- 配置（演示用降低的阈值） ---
const WARNING_THRESHOLD = 5;
const CRITICAL_THRESHOLD = 8;
const BREAKER_THRESHOLD = 10;
const HISTORY_SIZE = 30;

// --- 基础工具函数 ---
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hash(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function hashToolCall(toolName, params) {
  return `${toolName}:${hash(stableStringify(params))}`;
}

function hashResult(result) {
  return hash(stableStringify(result));
}

// ============================================================================
// 检测器 1: 通用重复检测 (generic_repeat)
// ============================================================================
console.log('=== 检测器 1: 通用重复检测 (generic_repeat) ===');
console.log();
console.log('原理: 同一工具 + 同一参数反复调用，超过阈值告警/熔断');
console.log('注意: 这个检测器只告警不熔断（有些工具确实会被合法地反复调用）');
console.log();

// 模拟调用记录
const genericHistory = [];

function recordGenericCall(toolName, params) {
  const callHash = hashToolCall(toolName, params);
  genericHistory.push({ toolName, callHash, timestamp: Date.now() });
  if (genericHistory.length > HISTORY_SIZE) genericHistory.shift();

  // 计算相同调用出现的次数
  const count = genericHistory.filter(h => h.callHash === callHash).length;

  let status = '正常';
  let action = '';
  if (count >= CRITICAL_THRESHOLD) {
    status = '阻断';
    action = ' -> 阻断工具执行';
  } else if (count >= WARNING_THRESHOLD) {
    status = '警告';
    action = ' -> 记录日志，工具继续执行';
  }

  console.log(`  ${toolName}(${JSON.stringify(params)}) 调用次数: ${count} -> [${status}]${action}`);
  return { count, status };
}

// 模拟 10 次相同调用
for (let i = 0; i < 10; i++) {
  recordGenericCall('read_file', { path: 'src/index.ts' });
}

console.log();
console.log('  三级响应:');
console.log(`    < ${WARNING_THRESHOLD} 次: 正常执行`);
console.log(`    >= ${WARNING_THRESHOLD} 次: Warning -> 记日志，工具继续执行`);
console.log(`    >= ${CRITICAL_THRESHOLD} 次: Critical -> 阻断工具，Agent 收到错误`);
console.log();

// ============================================================================
// 检测器 2: 无进展轮询检测 (no_progress_streak)
// ============================================================================
console.log('=== 检测器 2: 无进展轮询检测 (no_progress_streak) ===');
console.log();
console.log('原理: 同参数 + 同结果 = 没有新信息 = 死循环');
console.log('区别: 和 generic_repeat 不同，这里还要看结果是否变化');
console.log();

const noProgressHistory = [];

function recordNoProgressCall(toolName, params, result) {
  const callHash = hashToolCall(toolName, params);
  const resultHash = hashResult(result);
  noProgressHistory.push({ toolName, callHash, resultHash });
  if (noProgressHistory.length > HISTORY_SIZE) noProgressHistory.shift();

  // 计算连续相同结果的次数
  let streak = 0;
  let lastRHash = null;
  for (let i = noProgressHistory.length - 1; i >= 0; i--) {
    const r = noProgressHistory[i];
    if (r.callHash !== callHash) continue;
    if (!lastRHash) { lastRHash = r.resultHash; streak = 1; continue; }
    if (r.resultHash !== lastRHash) break;
    streak++;
  }

  let status = '正常';
  let icon = '[+]';
  if (streak >= BREAKER_THRESHOLD) {
    status = '熔断';
    icon = '[X]';
  } else if (streak >= CRITICAL_THRESHOLD) {
    status = '阻断';
    icon = '[!]';
  } else if (streak >= WARNING_THRESHOLD) {
    status = '警告';
    icon = '[?]';
  } else if (streak >= 3) {
    status = '可疑';
    icon = '[~]';
  }

  console.log(`  ${icon} check_status("deploy-1") 结果: "${result}" -> ${status} (连续 ${streak} 次相同)`);
  return { streak, status };
}

// 模拟一系列状态查询（部署状态一直没变）
const statusResults = [
  'pending', 'pending', 'running', 'running', 'running',
  'running', 'running', 'running', 'running', 'running',
];

for (const result of statusResults) {
  recordNoProgressCall('check_status', { id: 'deploy-1' }, result);
}

console.log();
console.log('  比喻:');
console.log('    "刷新快递物流 10 次，每次都是运输中下一站郑州"');
console.log('    "-> 死循环，应该换个策略或者等待更长时间"');
console.log();

// ============================================================================
// 检测器 3: Ping-Pong 检测 (乒乓循环)
// ============================================================================
console.log('=== 检测器 3: Ping-Pong 检测 (乒乓循环) ===');
console.log();
console.log('原理: 两个工具交替调用 (A->B->A->B)，且双方的结果都没变化');
console.log('场景: Agent 反复读写同一个文件，但写入没有生效');
console.log();

const pingPongHistory = [];

function recordPingPongCall(toolName, params, result) {
  const callHash = hashToolCall(toolName, params);
  const resultHash = hashResult(result);
  pingPongHistory.push({ toolName, callHash, resultHash });
  if (pingPongHistory.length > HISTORY_SIZE) pingPongHistory.shift();

  // 检测乒乓模式
  if (pingPongHistory.length < 4) {
    console.log(`  ${toolName}(${JSON.stringify(params)}) -> 记录中...`);
    return;
  }

  // 找最后两种不同的 callHash
  const last = pingPongHistory[pingPongHistory.length - 1];
  let otherHash = null;
  for (let i = pingPongHistory.length - 2; i >= 0; i--) {
    if (pingPongHistory[i].callHash !== last.callHash) {
      otherHash = pingPongHistory[i].callHash;
      break;
    }
  }

  if (!otherHash) {
    console.log(`  ${toolName}(${JSON.stringify(params)}) -> 未检测到交替模式`);
    return;
  }

  // 计算交替次数
  let altCount = 0;
  for (let i = pingPongHistory.length - 1; i >= 0; i--) {
    const expected = altCount % 2 === 0 ? last.callHash : otherHash;
    if (pingPongHistory[i].callHash !== expected) break;
    altCount++;
  }

  // 检查两边的结果是否都没变
  const hash1Results = new Set(
    pingPongHistory.filter(h => h.callHash === last.callHash).map(h => h.resultHash)
  );
  const hash2Results = new Set(
    pingPongHistory.filter(h => h.callHash === otherHash).map(h => h.resultHash)
  );
  const noChange = hash1Results.size === 1 && hash2Results.size === 1;

  let status = '正常';
  if (altCount >= CRITICAL_THRESHOLD && noChange) {
    status = '阻断 - 乒乓循环';
  } else if (altCount >= WARNING_THRESHOLD && noChange) {
    status = '警告 - 可能的乒乓循环';
  }

  console.log(
    `  ${toolName}(${JSON.stringify(params)}) ` +
    `交替: ${altCount} 次, ` +
    `结果未变: ${noChange ? '是' : '否'} ` +
    `-> ${status}`
  );
}

// 模拟乒乓循环: 读写交替，但内容不变
const pingPongCalls = [
  { name: 'read_file', params: { path: 'config.json' }, result: '{"port": 3000}' },
  { name: 'write_file', params: { path: 'config.json', content: '{"port": 3000}' }, result: '写入成功' },
  { name: 'read_file', params: { path: 'config.json' }, result: '{"port": 3000}' },       // 读取结果没变!
  { name: 'write_file', params: { path: 'config.json', content: '{"port": 3000}' }, result: '写入成功' },
  { name: 'read_file', params: { path: 'config.json' }, result: '{"port": 3000}' },       // 还是没变!
  { name: 'write_file', params: { path: 'config.json', content: '{"port": 3000}' }, result: '写入成功' },
  { name: 'read_file', params: { path: 'config.json' }, result: '{"port": 3000}' },
  { name: 'write_file', params: { path: 'config.json', content: '{"port": 3000}' }, result: '写入成功' },
  { name: 'read_file', params: { path: 'config.json' }, result: '{"port": 3000}' },
  { name: 'write_file', params: { path: 'config.json', content: '{"port": 3000}' }, result: '写入成功' },
];

for (const call of pingPongCalls) {
  recordPingPongCall(call.name, call.params, call.result);
}

console.log();
console.log('  关键判断: 两边的结果都没变化');
console.log('    read_file 结果相同 -> 说明写入没生效 -> 乒乓循环');
console.log('    如果 write_file 之后 read_file 结果变化了 -> 正常的重试逻辑');
console.log();

// ============================================================================
// 检测器 4: 全局熔断器 (global_circuit_breaker)
// ============================================================================
console.log('=== 检测器 4: 全局熔断器 (global_circuit_breaker) ===');
console.log();
console.log('原理: 累计无进展调用达到阈值 -> 强制停止，没有例外');
console.log('定位: 最后一道防线，不管什么原因，30 次无进展就熔断');
console.log();

// 综合检测：统计所有无进展调用
const globalHistory = [];

function globalDetect(toolName, params, result) {
  const callHash = hashToolCall(toolName, params);
  const resultHash = hashResult(result);
  globalHistory.push({ toolName, callHash, resultHash });
  if (globalHistory.length > HISTORY_SIZE) globalHistory.shift();

  // 统计无进展调用总数
  let noProgressTotal = 0;
  const seen = new Map();
  for (const record of globalHistory) {
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

  if (noProgressTotal >= BREAKER_THRESHOLD) {
    console.log(`  [!!!] 全局熔断触发! 无进展调用累计 ${noProgressTotal} 次 (阈值: ${BREAKER_THRESHOLD})`);
    console.log(`  [!!!] 强制停止 Agent Loop，返回部分结果`);
    return true; // 熔断
  }
  return false;
}

// 模拟混合的无进展调用
console.log('  模拟多种工具的无进展调用:');
const mixedCalls = [
  { name: 'read_file', params: { path: 'a.ts' }, result: 'content-a' },
  { name: 'read_file', params: { path: 'a.ts' }, result: 'content-a' },   // 重复
  { name: 'grep_files', params: { pattern: 'todo' }, result: '3 matches' },
  { name: 'grep_files', params: { pattern: 'todo' }, result: '3 matches' }, // 重复
  { name: 'grep_files', params: { pattern: 'todo' }, result: '3 matches' }, // 重复
  { name: 'read_file', params: { path: 'a.ts' }, result: 'content-a' },   // 重复
  { name: 'read_file', params: { path: 'a.ts' }, result: 'content-a' },   // 重复
  { name: 'grep_files', params: { pattern: 'todo' }, result: '3 matches' }, // 重复
  { name: 'read_file', params: { path: 'a.ts' }, result: 'content-a' },   // 重复
  { name: 'grep_files', params: { pattern: 'todo' }, result: '3 matches' }, // 重复
  { name: 'read_file', params: { path: 'a.ts' }, result: 'content-a' },   // 重复
];

let triggered = false;
for (const [i, call] of mixedCalls.entries()) {
  const tripped = globalDetect(call.name, call.params, call.result);
  if (tripped) {
    triggered = true;
    break;
  }
}

if (!triggered) {
  console.log('  (演示数据未触发熔断，正常结束)');
}

console.log();

// ============================================================================
// 总结: 三级响应体系
// ============================================================================
console.log('='.repeat(60));
console.log('总结: 三级响应体系');
console.log('='.repeat(60));
console.log();
console.log(`  Warning  (${WARNING_THRESHOLD} 次) -> 记日志，工具继续执行`);
console.log(`  Critical (${CRITICAL_THRESHOLD} 次) -> 阻断工具，Agent 收到错误`);
console.log(`  Break    (${BREAKER_THRESHOLD} 次) -> 全局熔断，强制停止`);
console.log();
console.log('四种检测器的分工:');
console.log('  1. generic_repeat    - 通用重复检测（只告警，不熔断）');
console.log('  2. no_progress_streak - 无进展轮询检测（同参数 + 同结果）');
console.log('  3. ping_pong         - 乒乓循环检测（两个工具交替且无进展）');
console.log('  4. global_circuit_breaker - 全局熔断（最后防线，无差别熔断）');
console.log();
console.log('生产环境阈值通常是 10/20/30，这里用 5/8/10 方便演示');
