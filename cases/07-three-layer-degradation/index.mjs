/**
 * @title 三层降级链
 * @group 容错机制
 * @description 演示三层容错降级：流式重试 -> 非流式降级 -> 模型降级
 */

import { createMockModel } from '../../lib/mock-model.mjs';
import { allTools } from '../../lib/mock-tools.mjs';
import { streamText } from 'ai';

// ============================================================================
// 三层降级策略的教学演示
//
// 当请求持续失败时，不能无脑重试。教学材料中定义了三层降级链：
//   Layer 1: 流式请求 + 指数退避重试（最多 10 次）
//   Layer 2: 非流式降级（改用 doGenerate，对服务器压力更小）
//   Layer 3: 模型降级（Opus -> Sonnet，换模型但不重建上下文）
//
// 关键洞察："两层的失败预算是连续的，不是各算各的"
// 即：Layer 1 用了 3 次重试失败后，Layer 2 不是从头给 3 次，
// 而是共享同一个失败预算。
// ============================================================================

/**
 * 辅助函数：消耗流并返回结果
 * streamText 的 promise（text, usage, finishReason）需要在流被消耗后才能 resolve
 */
async function consumeResult(result) {
  let text = '';
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  return {
    text,
    usage: await result.usage,
    finishReason: await result.finishReason,
  };
}

console.log('='.repeat(60));
console.log('案例 07: 三层降级链');
console.log('='.repeat(60));
console.log();

// --- 模拟配置 ---
const STREAM_RETRY_MAX = 10;   // Layer 1 最大重试次数
const NON_STREAM_RETRY_MAX = 3; // Layer 2 最大重试次数
const BASE_DELAY_MS = 500;     // 指数退避基础延迟
const TOTAL_FAIL_BUDGET = 10;  // Layer 1 + Layer 2 共享的失败预算

// ============================================================================
// Layer 1: 流式请求 + 指数退避重试
// ============================================================================
console.log('=== Layer 1: 流式请求 + 指数退避重试 ===');
console.log('  策略: 失败后等待时间翻倍 (500ms -> 1s -> 2s -> ...)');
console.log('  预算: 最多 10 次重试');
console.log();

// 模拟 Layer 1: 6 次全部失败（指数退避）
// 在真实场景中，这里会调用 streamText 并在 catch 中重试
// 为了演示清晰，我们模拟这个过程
const layer1Errors = [
  { code: '429', message: 'Too Many Requests' },
  { code: '429', message: 'Too Many Requests' },
  { code: '529', message: 'Site Overloaded' },
  { code: '429', message: 'Too Many Requests' },
  { code: '529', message: 'Site Overloaded' },
  { code: '529', message: 'Site Overloaded' },
];

let layer1FailCount = 0;

for (let i = 1; i <= STREAM_RETRY_MAX; i++) {
  // 模拟请求失败
  const error = layer1Errors[i - 1];
  if (error) {
    layer1FailCount++;
    const delay = BASE_DELAY_MS * Math.pow(2, i - 1);
    console.log(`  重试 ${i}/${STREAM_RETRY_MAX}: ${error.code} -> 等待 ${delay}ms`);

    if (layer1FailCount >= 6) {
      console.log(`  ...连续 ${layer1FailCount} 次失败，升级到 Layer 2`);
      break;
    }
  }
}

console.log();

// ============================================================================
// Layer 2: 非流式降级
// ============================================================================
console.log('=== Layer 2: 非流式降级 ===');
console.log('  策略: 切换为非流式请求 (doGenerate)，超时 120 秒');
console.log('  原因: 非流式对服务器压力更小，更容易成功');
console.log();

// 注意：失败预算是连续的！Layer 1 已经用了 6 次
const remainingBudget = TOTAL_FAIL_BUDGET - layer1FailCount;

console.log(`  失败预算: 总计 ${TOTAL_FAIL_BUDGET} 次`);
console.log(`  Layer 1 已用: ${layer1FailCount} 次`);
console.log(`  剩余预算: ${remainingBudget} 次`);
console.log();

// 模拟 Layer 2: 3 次也全部失败
let layer2FailCount = 0;
const layer2MaxAttempts = Math.min(NON_STREAM_RETRY_MAX, remainingBudget);

for (let i = 1; i <= layer2MaxAttempts; i++) {
  layer2FailCount++;
  console.log(`  [非流式] 尝试 ${i}/${layer2MaxAttempts} 失败: 529 Site Overloaded`);
}

if (layer2FailCount >= layer2MaxAttempts) {
  console.log(`  ...连续 ${layer2FailCount} 次 529，非流式也扛不住，升级到 Layer 3`);
}

console.log();

// ============================================================================
// Layer 3: 模型降级
// ============================================================================
console.log('=== Layer 3: 模型降级 ===');
console.log('  策略: Opus -> Sonnet，换模型但不重建上下文');
console.log('  关键: 保留完整的对话历史，只是换一个更轻量的模型');
console.log();

// Layer 3 使用轻量模型（模拟 Sonnet 代替 Opus）— 这次用成功模型
const layer3Model = createMockModel([
  { type: 'text-delta', textDelta: '[Sonnet 响应] 代码分析结果：该文件包含 3 个函数，建议优化 formatDate 函数...' },
  { type: 'finish', finishReason: 'stop', usage: { promptTokens: 8, completionTokens: 45 } },
]);

console.log('  切换模型: Claude Opus -> Claude Sonnet');
console.log('  保留上下文: 是（完整的对话历史）');
console.log();

try {
  const result = streamText({ model: layer3Model, tools: allTools, prompt: '分析这段代码' });
  const { text } = await consumeResult(result);
  console.log(`  成功！Sonnet 模型响应:`);
  console.log(`  "${text}"`);
} catch (e) {
  console.log(`  模型降级也失败了: ${e.message}`);
  console.log(`  最终方案: 返回错误给用户，提示稍后重试`);
}

console.log();

// ============================================================================
// 总结
// ============================================================================
console.log('='.repeat(60));
console.log('总结: 三层降级链');
console.log('='.repeat(60));
console.log();
console.log('1. Layer 1 (流式重试): 指数退避，最多 10 次');
console.log('   - 适用场景: 暂时的 429/529 错误');
console.log('   - 等待策略: 500ms -> 1s -> 2s -> 4s -> ...');
console.log();
console.log('2. Layer 2 (非流式降级): 改用 doGenerate，对服务器更友好');
console.log('   - 适用场景: 流式端点压力大，但非流式端点可能还能用');
console.log('   - 等待策略: 固定间隔（不用指数退避）');
console.log();
console.log('3. Layer 3 (模型降级): Opus -> Sonnet，保留上下文');
console.log('   - 适用场景: 大模型服务器过载，小模型可能还能用');
console.log('   - 关键: 不重建上下文，直接复用对话历史');
console.log();
console.log('核心原则: "两层的失败预算是连续的，不是各算各的"');
console.log('  - Layer 1 用了 6 次 -> Layer 2 只有剩余的 4 次机会');
console.log('  - 这样避免每层都重试 10 次 = 总共 30 次浪费时间');
