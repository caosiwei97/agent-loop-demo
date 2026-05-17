/**
 * @title 输出截断恢复
 * @group 运行时安全
 * @description 演示模型输出被截断后的渐进式恢复策略
 */

import { createTruncatingModel, createMockModel, createMultiTurnModel } from '../lib/mock-model.mjs';
import { allTools } from '../lib/mock-tools.mjs';
import { streamText } from 'ai';

// ============================================================================
// 输出截断恢复 — 三步渐进式策略
//
// 模型输出可能因为 max_output_tokens 限制而被截断 (finishReason: 'length')
// 教学材料定义了三步渐进恢复：
//   Step 1: 静默提高上限 (8192 -> 65536)，对用户透明
//   Step 2: 注入恢复消息（最多 3 次），指导模型高效续写
//   Step 3: 认栽，返回不完整结果
//
// 恢复消息的设计非常讲究：
//   - "不要道歉" — 浪费 Token
//   - "不要回顾" — 浪费 Token
//   - "从断点继续" — 高效
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
console.log('案例 11: 输出截断恢复');
console.log('='.repeat(60));
console.log();

// ============================================================================
// Step 1: 静默提高上限
// ============================================================================
console.log('=== Step 1: 静默提高上限 ===');
console.log();
console.log('原理: 第一次截断时，静默将 max_output_tokens 从 8192 提高到 65536');
console.log('为什么静默: 对用户完全透明，用户不会看到"抱歉输出被截断"这种东西');
console.log();

const DEFAULT_MAX_OUTPUT = 8192;
const RAISED_MAX_OUTPUT = 65536;
const MAX_RECOVERY_ATTEMPTS = 3;

// 模拟第一次尝试（被截断）
const truncModel1 = createTruncatingModel({
  truncateCount: 1,
  truncatedText: '这是一段非常详细的分析报告。首先，从架构层面来看，该项目采用了模块化设计，包含了以下核心模块：核心引擎、插件系统、配置管理、日志系统。在核心引擎中，我们发现了几处可以优化的地方：1) 缓存策略使用了简单的 LRU，但在高并发场景下性能不足...',
  finalChunks: [
    { type: 'text-delta', textDelta: '这不会被使用' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 100 } },
  ],
});

let currentMaxOutput = DEFAULT_MAX_OUTPUT;

console.log(`初始 max_output_tokens: ${currentMaxOutput}`);
console.log();

const result1 = streamText({
  model: truncModel1,
  tools: allTools,
  prompt: '请对这段代码做详细的代码审查',
});

const { text: text1, finishReason: finish1, usage: usage1 } = await consumeResult(result1);

console.log(`第一次请求:`);
console.log(`  输出: "${text1.slice(0, 80)}..."`);
console.log(`  finishReason: ${finish1}`);
console.log(`  输出 Token: ${usage1.completionTokens}`);
console.log();

if (finish1 === 'length') {
  console.log(`  -> 检测到截断! (finishReason = 'length')`);
  console.log(`  -> 静默提高上限: ${currentMaxOutput} -> ${RAISED_MAX_OUTPUT}`);
  currentMaxOutput = RAISED_MAX_OUTPUT;
}

console.log();

// ============================================================================
// Step 2: 注入恢复消息
// ============================================================================
console.log('=== Step 2: 注入恢复消息 (最多 3 次) ===');
console.log();
console.log('关键设计:');
console.log('  - 第一次: "直接从断点继续——不要道歉，不要回顾。把剩余工作拆成更小的块。"');
console.log('  - 后续:   "再次被截断。大幅精简，只列关键结论。"');
console.log('  - 为什么"不要道歉": 浪费 Token');
console.log('  - 为什么"不要回顾": 浪费 Token');
console.log('  - 为什么"从断点继续": 最高效');
console.log();

// 恢复消息模板
const recoveryMessages = [
  '直接从断点继续——不要道歉，不要回顾。把剩余工作拆成更小的块。',
  '再次被截断。大幅精简，只列关键结论。',
  '第三次截断。如果这次还说不完，就返回已完成的部关结论。',
];

// 模拟多次截断 + 恢复的过程
// 使用 createMultiTurnModel 模拟多轮
const recoveryModel = createMultiTurnModel([
  // 第 1 轮: 被截断
  [
    { type: 'text-delta', textDelta: '正在生成详细的代码分析报告...（第 1 部分：架构分析）项目整体架构采用分层设计，核心层负责业务逻辑，适配层处理外部接口...（第 2 部分：性能问题）发现 3 处性能瓶颈：1) 数据库查询未使用索引 2) 缓存命中率低 3) 序列化开销过大...（第 3 部分：安全审计）检查发现...' },
    { type: 'finish', finishReason: 'length', usage: { promptTokens: 20, completionTokens: 8192 } },
  ],
  // 第 2 轮: 注入恢复消息后还是被截断
  [
    { type: 'text-delta', textDelta: '继续安全审计部分...（第 3 部分续）SQL 注入风险：发现 2 处未参数化的查询。XSS 风险：前端模板引擎未启用自动转义...（第 4 部分：代码规范）命名不一致、缺少错误处理、硬编码配置值...（第 5 部分：依赖审计）发现 3 个过时依赖...' },
    { type: 'finish', finishReason: 'length', usage: { promptTokens: 30, completionTokens: 8192 } },
  ],
  // 第 3 轮: 终于完成了
  [
    { type: 'text-delta', textDelta: '关键结论: 1) 修复 SQL 注入（紧急）2) 更新过时依赖 3) 添加缓存层 4) 统一命名规范。优先级：P0 -> P1 -> P2 -> P3。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 25, completionTokens: 200 } },
  ],
]);

let recoveryCount = 0;
let accumulatedText = '';
let lastFinishReason = '';

for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS + 1; attempt++) {
  const prompt = recoveryCount === 0
    ? '请对这段代码做详细的代码审查'
    : recoveryMessages[Math.min(recoveryCount - 1, recoveryMessages.length - 1)];

  console.log(`--- 第 ${attempt} 次请求 ---`);

  if (recoveryCount > 0) {
    console.log(`  注入恢复消息: "${prompt}"`);
  }

  const result = streamText({
    model: recoveryModel,
    tools: allTools,
    prompt,
  });

  const { text, finishReason, usage } = await consumeResult(result);

  accumulatedText += text;

  console.log(`  输出: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);
  console.log(`  finishReason: ${finishReason}`);
  console.log(`  输出 Token: ${usage.completionTokens}`);
  console.log(`  累计输出长度: ${accumulatedText.length} 字符`);
  console.log();

  if (finishReason === 'length') {
    recoveryCount++;
    if (recoveryCount >= MAX_RECOVERY_ATTEMPTS) {
      console.log(`  -> 已达到最大恢复次数 (${MAX_RECOVERY_ATTEMPTS})，进入 Step 3`);
      break;
    }
    console.log(`  -> 截断，准备注入第 ${recoveryCount + 1} 条恢复消息`);
  } else {
    console.log(`  -> 正常完成！恢复成功`);
    lastFinishReason = finishReason;
    break;
  }

  lastFinishReason = finishReason;
}

console.log();

// ============================================================================
// Step 3: 认栽
// ============================================================================
console.log('=== Step 3: 认栽 (如果恢复失败) ===');
console.log();
console.log('如果 64K 限制下连续 3 次都说不完，说明任务拆分有问题');
console.log('此时应该:');
console.log('  1. 返回已生成的部分结果');
console.log('  2. 标记为"输出被截断"');
console.log('  3. 提供已完成的部分的摘要');
console.log();

if (recoveryCount >= MAX_RECOVERY_ATTEMPTS) {
  console.log('模拟: 返回不完整结果');
  console.log(`  状态: 输出被截断 (经过 ${recoveryCount} 次恢复尝试)`);
  console.log(`  已输出: ${accumulatedText.length} 字符`);
  console.log(`  建议: 将任务拆分为更小的子任务`);
} else {
  console.log('本次演示中恢复成功，未触发"认栽"步骤');
}

console.log();

// ============================================================================
// 总结
// ============================================================================
console.log('='.repeat(60));
console.log('总结: 输出截断恢复');
console.log('='.repeat(60));
console.log();
console.log('三步渐进式恢复:');
console.log(`  Step 1: 静默提高上限 (${DEFAULT_MAX_OUTPUT} -> ${RAISED_MAX_OUTPUT})`);
console.log('          - 对用户透明，不会看到任何错误提示');
console.log();
console.log('  Step 2: 注入恢复消息 (最多 3 次)');
console.log('          - "不要道歉" — 浪费 Token');
console.log('          - "不要回顾" — 浪费 Token');
console.log('          - "从断点继续" — 高效');
console.log('          - "拆成更小的块" — 降低再次截断的概率');
console.log();
console.log('  Step 3: 认栽');
console.log('          - 返回不完整结果，标记为截断');
console.log('          - 为什么不无限重试: "如果 64K 限制下连续 3 次都说不完，说明任务拆分有问题"');
console.log();
console.log('恢复消息设计的精髓:');
console.log('  普通人的做法: "抱歉被截断了，让我重新开始" -> 浪费 Token + 浪费时间');
console.log('  工程师的做法: "从断点继续，不要道歉，不要回顾" -> 最高效');
