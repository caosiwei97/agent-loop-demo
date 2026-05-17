/**
 * @title Token 预算控制
 * @group 运行时安全
 * @description 演示 Token 预算的两道防线：90% nudge + 递减回报检测
 */

import { createMultiTurnModel } from '../../lib/mock-model.mjs';
import { allTools } from '../../lib/mock-tools.mjs';
import { streamText } from 'ai';

// ============================================================================
// Token 预算控制 — 防止 Agent Loop 无限消耗
//
// 当 Agent 陷入某种循环时，Token 消耗会持续增长。
// 教学材料中定义了两道防线：
//   防线 1: 90% nudge — 到达预算 90% 时提醒模型"快到限制了，但不要总结"
//   防线 2: 递减回报检测 — 连续两轮输出都很少时，判断为无效循环
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
console.log('案例 10: Token 预算控制');
console.log('='.repeat(60));
console.log();

// ============================================================================
// Part 1: 90% nudge
// ============================================================================
console.log('=== Part 1: 90% nudge ===');
console.log();
console.log('原理: 当 Token 用量达到预算的 90% 时，注入提醒消息');
console.log('关键: 提醒模型"不要总结"（否则模型收到限制信号后会本能地开始总结）');
console.log();

const TOKEN_BUDGET = 10000;
const NUDGE_THRESHOLD = 0.90; // 90%

// 模拟多轮交互，逐步消耗 Token
// 用 createMultiTurnModel 模拟每一轮返回不同的 text 和 usage
const nudgeModel = createMultiTurnModel([
  // 第 1 轮: 正常消耗
  [
    { type: 'text-delta', textDelta: '正在分析代码结构...找到了 5 个需要修改的文件。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 200, completionTokens: 3000 } },
  ],
  // 第 2 轮: 还在正常范围
  [
    { type: 'text-delta', textDelta: '正在处理第 3 个文件，修改 import 语句...' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 500, completionTokens: 2500 } },
  ],
  // 第 3 轮: 接近 90%（总输出约 8700）
  [
    { type: 'text-delta', textDelta: '继续处理剩余文件...' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 700, completionTokens: 3200 } },
  ],
  // 第 4 轮: 已超过 90%
  [
    { type: 'text-delta', textDelta: '好的，加速完成最后的修改...' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 900, completionTokens: 2000 } },
  ],
]);

let totalInputTokens = 0;
let totalOutputTokens = 0;
let nudgeInjected = false;

for (let turn = 1; turn <= 4; turn++) {
  const result = streamText({
    model: nudgeModel,
    tools: allTools,
    prompt: nudgeInjected
      ? '继续工作（nudge 已注入）'
      : '帮我重构这个项目的所有文件',
  });

  const { text, usage } = await consumeResult(result);

  totalInputTokens += usage.promptTokens;
  totalOutputTokens += usage.completionTokens;

  const totalTokens = totalInputTokens + totalOutputTokens;
  const ratio = totalTokens / TOKEN_BUDGET;

  console.log(`第 ${turn} 轮:`);
  console.log(`  输出: "${text.slice(0, 50)}..."`);
  console.log(`  本轮消耗: 输入 ${usage.promptTokens}, 输出 ${usage.completionTokens}`);
  console.log(`  累计: ${totalTokens} / ${TOKEN_BUDGET} (${(ratio * 100).toFixed(1)}%)`);

  // 检查是否需要 nudge
  if (!nudgeInjected && ratio >= NUDGE_THRESHOLD) {
    const pct = Math.round(ratio * 100);
    const nudgeMessage = `已完成 Token 目标的 ${pct}%（${totalTokens.toLocaleString()} / ${TOKEN_BUDGET.toLocaleString()}）。继续工作——不要总结。`;
    console.log();
    console.log(`  [nudge] 注入提醒:`);
    console.log(`  "${nudgeMessage}"`);
    console.log(`  为什么说"不要总结"？模型收到"快到限制了"的信号后，本能反应就是开始总结`);
    nudgeInjected = true;
  }

  console.log();
}

console.log('nudge 设计要点:');
console.log('  - 不说"停下来"，而是说"继续工作"');
console.log('  - 明确"不要总结"，避免浪费 Token 在无意义的回顾上');
console.log('  - 在 90% 而不是 100% 注入，给模型留一些空间');
console.log();

// ============================================================================
// Part 2: 递减回报检测
// ============================================================================
console.log('=== Part 2: 递减回报检测 ===');
console.log();
console.log('原理: 跟踪每轮输出 Token，连续两轮都很少 = 可能在兜圈子');
console.log('前提: 总输出 > 5000 Token 时才检测（避免小任务误报）');
console.log();

// 模拟递减回报的场景
const outputHistory = [
  { turn: 1, output: 3000, action: 'read_file, grep_files -> 正在扫描代码库' },
  { turn: 2, output: 2500, action: 'write_file -> 修改了 3 个文件' },
  { turn: 3, output: 400,  action: 'read_file -> 重新读取确认修改' },
  { turn: 4, output: 300,  action: 'read_file -> 又读了一遍（可能迷路了）' },
  { turn: 5, output: 200,  action: 'read_file -> 还在读...' },
];

const DIMINISHING_THRESHOLD = 500; // 每轮低于此视为"递减"
const MIN_TOTAL_FOR_CHECK = 5000;  // 总输出超过此值才开始检测
const LOW_STREAK_LIMIT = 2;        // 连续 N 次递减则停止

let runningTotal = 0;
let lowStreak = 0;
let diminishingTriggered = false;

for (const entry of outputHistory) {
  runningTotal += entry.output;
  console.log(`续写第 ${entry.turn} 次: +${entry.output} Token -> ${entry.action}`);
  console.log(`  累计输出: ${runningTotal} Token`);

  if (runningTotal >= MIN_TOTAL_FOR_CHECK) {
    if (entry.output < DIMINISHING_THRESHOLD) {
      lowStreak++;
      console.log(`  -> 增量很小 (< ${DIMINISHING_THRESHOLD})`);
      if (lowStreak >= LOW_STREAK_LIMIT) {
        console.log(`  -> 连续 ${lowStreak} 次递减，检测到无效循环！停止续写`);
        diminishingTriggered = true;
        break;
      }
    } else {
      lowStreak = 0;
      console.log(`  -> 正常`);
    }
  } else {
    console.log(`  -> 总输出 < ${MIN_TOTAL_FOR_CHECK}，跳过检测`);
  }
  console.log();
}

if (!diminishingTriggered) {
  console.log('  未触发递减回报检测（演示数据正常完成）');
}

console.log();
console.log('递减回报检测要点:');
console.log(`  - 阈值: 每轮 < ${DIMINISHING_THRESHOLD} Token 视为递减`);
console.log(`  - 触发条件: 连续 ${LOW_STREAK_LIMIT} 次递减 + 总输出 > ${MIN_TOTAL_FOR_CHECK}`);
console.log('  - 为什么设最小总量？短任务本来每轮输出就少，不应误报');
console.log();

// ============================================================================
// Part 3: 费用计算
// ============================================================================
console.log('=== Part 3: 费用计算 ===');
console.log();
console.log('为什么 Token 预算控制如此重要？来看真实费用:');
console.log();

const costPerMillionOutput = 15; // Claude Sonnet: $15/百万输出 Token
const avgOutputPerTurn = 1000;
const runawayTurns = 200;
const totalRunawayOutput = avgOutputPerTurn * runawayTurns;
const outputCost = (totalRunawayOutput / 1_000_000) * costPerMillionOutput;

console.log(`假设 Claude Sonnet 定价:`);
console.log(`  输出: $${costPerMillionOutput}/百万 Token`);
console.log(`  输入: $3/百万 Token (约为输出的 1/5)`);
console.log();
console.log(`失控场景:`);
console.log(`  ${runawayTurns} 轮 x ${avgOutputPerTurn} Token/轮 = ${totalRunawayOutput.toLocaleString()} 输出 Token`);
console.log(`  输出费用: $${outputCost.toFixed(2)}`);
console.log();
console.log(`但输入 Token 才是大头!`);
console.log(`  每轮都要带完整上下文（对话历史 + 系统提示 + 工具结果）`);
console.log(`  假设每轮输入 = 输出的 10-20 倍`);
console.log();

const inputMultiplier = 15; // 中间值
const totalRunawayInput = totalRunawayOutput * inputMultiplier;
const costPerMillionInput = 3;
const inputCost = (totalRunawayInput / 1_000_000) * costPerMillionInput;
const totalCost = outputCost + inputCost;

console.log(`  累计输入 = ${totalRunawayInput.toLocaleString()} Token (${inputMultiplier}x 输出)`);
console.log(`  输入费用: $${inputCost.toFixed(2)}`);
console.log(`  总费用: $${totalCost.toFixed(2)}`);
console.log();
console.log(`-> 一次失控，$50-100 不是开玩笑`);
console.log();

// ============================================================================
// 总结
// ============================================================================
console.log('='.repeat(60));
console.log('总结: Token 预算控制');
console.log('='.repeat(60));
console.log();
console.log('两道防线:');
console.log('  1. 90% nudge - 提醒模型加速完成，不要总结');
console.log('  2. 递减回报 - 连续两轮输出很少，判断为无效循环');
console.log();
console.log('费用意识:');
console.log('  - 输入 Token 才是大头（每轮都带完整上下文）');
console.log('  - 200 轮失控可能花费 $50-100');
console.log('  - Token 预算不是可选项，是必需品');
