/**
 * @title Agent Loop 完整骨架
 * @group 运行时安全
 * @description 整合所有防御机制的完整 Agent Loop：死循环检测（case-08）+
 *   Token 预算控制（case-09）+ 截断恢复（case-10）+ 七种退出路径（case-11）。
 *   这是教学系列的最终统一版本。
 */

import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';
import { fingerprint } from '../lib/utils.mjs';

// ═══ 本案例新增 ═══
// 整合全部防御机制（无单独新增，是 08+09+10+11 的组合）：
// - detectLoop(): 死循环指纹检测
// - checkBudget(): token 预算控制
// - 截断恢复: finishReason === 'length' 处理
// - 七路退出: determineExit() 统一判定
// ══════════════════

// --- 死循环检测 (from case-08) ---
function detectLoop(window, toolName, args, threshold = 3) {
  const fp = fingerprint(toolName, args);
  window.push(fp);
  if (window.length > 10) window.shift();
  const count = window.filter(f => f === fp).length;
  return { looped: count >= threshold, fp };
}

// --- Token 预算控制 (from case-09) ---
function checkBudget(used, total) {
  const ratio = used / total;
  if (ratio >= 1.0) return 'stop';
  if (ratio >= 0.9) return 'nudge';
  return 'ok';
}

// --- 退出原因 (from case-11) ---
const ExitReason = {
  END_TURN: 'end_turn',
  MAX_STEPS: 'max_steps',
  LOOP_DETECTED: 'loop_detected',
  BUDGET_EXCEEDED: 'budget_exceeded',
  USER_ABORT: 'user_abort',
  ERROR: 'error',
  CONTEXT_OVERFLOW: 'context_overflow',
};

function determineExit({ hasToolCall, step, maxSteps, loopDetected, tokensUsed, budget, msgLength, maxContext }) {
  if (!hasToolCall) return ExitReason.END_TURN;
  if (step >= maxSteps) return ExitReason.MAX_STEPS;
  if (loopDetected) return ExitReason.LOOP_DETECTED;
  if (tokensUsed >= budget) return ExitReason.BUDGET_EXCEEDED;
  if (msgLength >= maxContext) return ExitReason.CONTEXT_OVERFLOW;
  return null;
}

const model = createMultiTurnModel([
  // 第1轮：读取文件
  [
    { type: 'text-delta', textDelta: '让我先查看文件...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 50, completionTokens: 30 } },
  ],
  // 第2轮：搜索依赖
  [
    { type: 'text-delta', textDelta: '搜索相关引用...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_2', toolName: 'grep_files', args: '{"pattern":"moment"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 100, completionTokens: 40 } },
  ],
  // 第3轮：写入修复
  [
    { type: 'text-delta', textDelta: '执行修复...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_3', toolName: 'write_file', args: '{"path":"src/utils.ts","content":"import dayjs from \\"dayjs\\";"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 150, completionTokens: 50 } },
  ],
  // 第4轮：最终总结
  [
    { type: 'text-delta', textDelta: '修复完成！已将 moment 替换为 dayjs，包体积从 67KB 降至 2KB。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 200, completionTokens: 60 } },
  ],
]);

async function agentLoop() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 然后修复问题' }];
  let step = 0;
  const MAX_STEPS = 10;
  const TOKEN_BUDGET = 2000;
  const MAX_CONTEXT = 50;
  const MAX_TRUNCATIONS = 3;
  let tokensUsed = 0;
  let truncationCount = 0;
  const fpWindow = [];

  console.log('[用户]', messages[0].content);
  console.log(`[配置] 最大轮次=${MAX_STEPS}, Token预算=${TOKEN_BUDGET}, 上下文上限=${MAX_CONTEXT}条`);

  while (true) {
    step++;
    console.log(`\n── 第 ${step} 轮 ──`);

    // 1. 调用模型
    let result;
    try {
      result = streamText({ model, messages, tools: allTools, maxSteps: 1 });
    } catch (err) {
      console.log(`\n[退出] ${ExitReason.ERROR}: ${err.message}`);
      break;
    }

    // 2. 消费流
    let text = '';
    let hasToolCall = false;
    let loopDetected = false;
    for await (const event of result.fullStream) {
      if (event.type === 'text-delta') {
        text += event.textDelta;
        process.stdout.write(event.textDelta);
      } else if (event.type === 'tool-call') {
        hasToolCall = true;
        console.log(`\n  [工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
        // 死循环检测
        const { looped, fp } = detectLoop(fpWindow, event.toolName, event.args);
        console.log(`  [指纹] ${fp}${looped ? ' ⚠ 重复!' : ''}`);
        if (looped) loopDetected = true;
      } else if (event.type === 'tool-result') {
        console.log(`  [工具结果] ${event.toolName} → ${String(event.result).slice(0, 60)}...`);
      }
    }

    // 更新 token 用量
    const usage = await result.usage;
    tokensUsed += (usage.promptTokens + usage.completionTokens);
    console.log(`  [预算] ${tokensUsed}/${TOKEN_BUDGET} tokens`);

    // 截断恢复 (from case-10)
    const finishReason = await result.finishReason;
    if (finishReason === 'length') {
      truncationCount++;
      console.log(`  [截断] 第 ${truncationCount} 次 (finishReason=length)`);
      if (truncationCount >= MAX_TRUNCATIONS) {
        console.log(`\n[退出] 截断次数过多`);
        break;
      }
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: '你的输出被截断了，请从断点处继续。' });
      continue;
    }

    // Token 预算 nudge (from case-09)
    const budgetStatus = checkBudget(tokensUsed, TOKEN_BUDGET);
    if (budgetStatus === 'nudge' && hasToolCall) {
      console.log('  [预算] 接近上限，注入收敛提示');
      messages.push({ role: 'user', content: '[系统提示] token 预算即将耗尽，请尽快给出结论。' });
    }

    // 3. 七路退出判定 (from case-11)
    const exitReason = determineExit({
      hasToolCall,
      step,
      maxSteps: MAX_STEPS,
      loopDetected,
      tokensUsed,
      budget: TOKEN_BUDGET,
      msgLength: messages.length,
      maxContext: MAX_CONTEXT,
    });

    if (exitReason) {
      console.log(`\n[退出] ${exitReason}`);
      break;
    }

    // 4. 组装下轮
    const response = await result.response;
    messages.push(...response.messages);
  }

  console.log(`\n[完成] 共 ${step} 轮，总计 ${tokensUsed} tokens，截断恢复 ${truncationCount} 次`);
}

agentLoop().catch(console.error);
