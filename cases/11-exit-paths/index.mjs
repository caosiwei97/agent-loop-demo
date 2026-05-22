/**
 * @title 七种退出路径
 * @group 运行时安全
 * @description Agent Loop 的 7 种退出条件：end_turn / max_steps / loop_detected /
 *   budget_exceeded / user_abort / error / context_overflow。
 *   相比 case-03 的 2 个退出条件，扩展为完整的 7 路判断。
 */

import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';
import { fingerprint } from '../lib/utils.mjs';

// ═══ 本案例新增 ═══
// +7 种退出路径的完整判断逻辑（替代 case-03 的简单双条件）
// +ExitReason 枚举 + determineExit() 统一退出判定
// ══════════════════

/** 退出原因枚举 */
const ExitReason = {
  END_TURN: 'end_turn',           // 模型主动结束
  MAX_STEPS: 'max_steps',         // 达到最大轮次
  LOOP_DETECTED: 'loop_detected', // 检测到死循环
  BUDGET_EXCEEDED: 'budget_exceeded', // token 预算耗尽
  USER_ABORT: 'user_abort',       // 用户中断（模拟）
  ERROR: 'error',                 // 不可恢复错误
  CONTEXT_OVERFLOW: 'context_overflow', // 上下文溢出
};

/**
 * 统一退出判定
 * @returns {string|null} 退出原因，null 表示继续
 */
function determineExit({ hasToolCall, step, maxSteps, loopDetected, tokensUsed, budget, msgLength, maxContext }) {
  if (!hasToolCall) return ExitReason.END_TURN;
  if (step >= maxSteps) return ExitReason.MAX_STEPS;
  if (loopDetected) return ExitReason.LOOP_DETECTED;
  if (tokensUsed >= budget) return ExitReason.BUDGET_EXCEEDED;
  if (msgLength >= maxContext) return ExitReason.CONTEXT_OVERFLOW;
  return null;
}

const model = createMultiTurnModel([
  // 第1轮
  [
    { type: 'text-delta', textDelta: '让我查看文件...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 50, completionTokens: 30 } },
  ],
  // 第2轮
  [
    { type: 'text-delta', textDelta: '分析完毕，问题已定位。修复建议如下...' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 50 } },
  ],
]);

async function agentLoop() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 然后修复问题' }];
  let step = 0;
  const MAX_STEPS = 10;
  const TOKEN_BUDGET = 2000;
  const MAX_CONTEXT = 50;  // 消息数上限（模拟上下文溢出）
  let tokensUsed = 0;
  const fpWindow = [];

  console.log('[用户]', messages[0].content);

  while (true) {
    step++;
    console.log(`\n── 第 ${step} 轮 ──`);

    let result;
    try {
      // 1. 调用模型
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
        const fp = fingerprint(event.toolName, event.args);
        fpWindow.push(fp);
        if (fpWindow.length > 10) fpWindow.shift();
        if (fpWindow.filter(f => f === fp).length >= 3) loopDetected = true;
      } else if (event.type === 'tool-result') {
        console.log(`  [工具结果] ${event.toolName} → ${String(event.result).slice(0, 60)}...`);
      }
    }

    // 更新 token
    const usage = await result.usage;
    tokensUsed += (usage.promptTokens + usage.completionTokens);

    // 3. 七路退出判定
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

  console.log(`\n[完成] 共 ${step} 轮，总计 ${tokensUsed} tokens`);
}

agentLoop().catch(console.error);
