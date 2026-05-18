/**
 * @title 指数退避 + 随机抖动
 * @group 容错机制
 * @description 演示指数退避重试策略，为什么固定间隔会导致"重试风暴"
 */

import { createFailingModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

console.log('=== Case 05: 指数退避 + 随机抖动 ===\n');

// ---- 第一部分：错误分类 ----

console.log('--- 错误分类 ---\n');

const errorClasses = [
  { category: '可重试',    codes: '429, 529/503, 408, ECONNRESET', action: '自动重试' },
  { category: '不可重试',  codes: '400, 401/403, 402',             action: '立即失败' },
  { category: '需要降级',  codes: '连续多次 529',                   action: '切换模型' },
];

errorClasses.forEach(c => {
  console.log(`  ${c.category.padEnd(8)} | ${c.codes.padEnd(25)} | ${c.action}`);
});

// ---- 第二部分：三种重试策略对比 ----

console.log('\n--- 三种重试策略对比 ---\n');

// 策略1：固定间隔（差）
function fixedDelay(attempt) {
  return 1000;
}

// 策略2：指数退避（好）
function exponentialBackoff(attempt) {
  const baseDelay = 500;
  const maxDelay = 30000;
  return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
}

// 策略3：指数退避 + 随机抖动（最好）— Claude Code 的做法
function getRetryDelay(attempt) {
  const baseDelay = 500;
  const maxDelay = 30000;
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * exponentialDelay * 0.25;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

// 打印对比表
console.log('  重试次数 | 固定间隔(ms) | 指数退避(ms) | 退避+抖动(ms)');
console.log('  --------|-------------|-------------|--------------');

for (let i = 0; i < 5; i++) {
  const fixed = fixedDelay(i);
  const exp = exponentialBackoff(i);
  const jittered = getRetryDelay(i);
  console.log(
    `  ${String(i + 1).padStart(7)} | ` +
    `${String(fixed).padStart(11)} | ` +
    `${String(exp).padStart(11)} | ` +
    `${String(Math.round(jittered)).padStart(13)}`
  );
}

// ---- 第三部分：为什么固定间隔不好 ----

console.log('\n--- 固定间隔导致"重试风暴" ---\n');

console.log('[模拟] 5 个客户端同时遇到 429，都用固定间隔 1000ms:');
const clients = ['Client-A', 'Client-B', 'Client-C', 'Client-D', 'Client-E'];
const fixedT = 1000;
clients.forEach((c, i) => {
  const t = fixedT;
  console.log(`  ${c}: 在 ${t}ms 后重试`);
});
console.log('  -> 所有客户端在同一时刻重试，再次打爆服务器');

console.log('\n[模拟] 5 个客户端使用指数退避 + 抖动:');
clients.forEach((c, i) => {
  const t = getRetryDelay(i);
  console.log(`  ${c}: 在 ${Math.round(t)}ms 后重试`);
});
console.log('  -> 重试时间分散开，减轻服务器压力');

// ---- 第四部分：实际重试演示 ----

console.log('\n--- 实际重试演示 ---\n');

// 模拟一次模型调用，返回 { ok, output, error }
async function callModel(model) {
  const stream = streamText({
    model,
    tools: allTools,
    prompt: 'hello',
    maxRetries: 0,
  });

  let output = '';
  let streamError = null;
  for await (const event of stream.fullStream) {
    if (event.type === 'text-delta') {
      output += event.textDelta;
    }
    if (event.type === 'error') {
      streamError = event.error;
    }
  }
  if (streamError) {
    return { ok: false, error: streamError };
  }
  return { ok: true, output };
}

// 使用加速版退避函数做演示
async function retryWithBackoff(model, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    console.log(`[尝试 ${attempt + 1}] 正在调用模型...`);
    const result = await callModel(model);

    if (result.ok) {
      console.log(`[尝试 ${attempt + 1}] 成功! 输出: "${result.output}"`);
      return result.output;
    }

    // 演示用更短的延迟 (实际生产中 baseDelay=500~1000ms)
    const baseDelay = 200;
    const delay = baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay;
    console.log(`[尝试 ${attempt + 1}] 失败: ${result.error.message}`);
    if (attempt < maxRetries - 1) {
      console.log(`[退避]   等待 ${Math.round(delay)}ms 后重试...`);
      await new Promise(r => setTimeout(r, delay));
    } else {
      console.log(`[放弃]   已达最大重试次数 ${maxRetries}`);
    }
  }
}

async function main() {
  // 创建一个前 2 次失败、第 3 次成功的模型
  const model = createFailingModel({
    failCount: 2,
    error: new Error('429 Too Many Requests'),
  });

  const result = await retryWithBackoff(model, 5);

  console.log('\n--- 要点总结 ---');
  console.log('1. 固定间隔重试会导致"重试风暴"——所有客户端同时重试');
  console.log('2. 指数退避让重试间隔翻倍增长，避免集中重试');
  console.log('3. 加入随机抖动进一步分散重试时间');
  console.log('4. 429/503/408/ECONNRESET 可重试，400/401/403 不可重试');
  console.log('5. 连续多次 529 应考虑降级到其他模型');
}

main().catch(console.error);
