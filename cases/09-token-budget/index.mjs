/**
 * @title Token 预算控制
 * @group 运行时安全
 * @description 追踪累计 token 用量，在接近上限时注入 nudge 提示让模型收敛，
 *   超限时强制退出。相比 case-03，新增了 checkBudget() 预算检查函数。
 */

import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

// ═══ 本案例新增 ═══
// +checkBudget() — 返回 'ok' | 'nudge' | 'stop'
// +累计 token 追踪
// +90% 时注入 nudge 消息催促模型收敛
// ══════════════════

/**
 * 检查 token 预算
 * @param {number} used - 已使用 token
 * @param {number} total - 总预算
 * @returns {'ok'|'nudge'|'stop'}
 */
function checkBudget(used, total) {
  const ratio = used / total;
  if (ratio >= 1.0) return 'stop';
  if (ratio >= 0.9) return 'nudge';
  return 'ok';
}

const model = createMultiTurnModel([
  // 第1轮
  [
    { type: 'text-delta', textDelta: '让我读取文件...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 100, completionTokens: 50 } },
  ],
  // 第2轮（接近预算 — 将触发 nudge）
  [
    { type: 'text-delta', textDelta: '分析中...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_2', toolName: 'grep_files', args: '{"pattern":"moment"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 200, completionTokens: 100 } },
  ],
  // 第3轮（收到 nudge 后给出最终结论）
  [
    { type: 'text-delta', textDelta: '总结：建议将 moment 替换为 dayjs 以减小体积。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 250, completionTokens: 60 } },
  ],
]);

async function agentLoop() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 然后修复问题' }];
  let step = 0;
  const MAX_STEPS = 5;
  const TOKEN_BUDGET = 500;
  let tokensUsed = 0;

  console.log('[用户]', messages[0].content);
  console.log(`[预算] 总额 ${TOKEN_BUDGET} tokens`);

  while (true) {
    step++;
    console.log(`\n── 第 ${step} 轮 ──`);

    // 1. 调用模型
    const result = streamText({ model, messages, tools: allTools, maxSteps: 1 });

    // 2. 消费流
    let text = '';
    let hasToolCall = false;
    for await (const event of result.fullStream) {
      if (event.type === 'text-delta') {
        text += event.textDelta;
        process.stdout.write(event.textDelta);
      } else if (event.type === 'tool-call') {
        hasToolCall = true;
        console.log(`\n  [工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
      } else if (event.type === 'tool-result') {
        console.log(`  [工具结果] ${event.toolName} → ${String(event.result).slice(0, 60)}...`);
      }
    }

    // 更新 token 用量
    const usage = await result.usage;
    tokensUsed += (usage.promptTokens + usage.completionTokens);
    console.log(`  [预算] 已用 ${tokensUsed}/${TOKEN_BUDGET} tokens`);

    // 预算检查
    const budgetStatus = checkBudget(tokensUsed, TOKEN_BUDGET);
    if (budgetStatus === 'stop') {
      console.log('\n[退出] Token 预算耗尽，强制停止');
      break;
    }
    if (budgetStatus === 'nudge') {
      console.log('  [预算] 接近上限，注入收敛提示');
      messages.push({ role: 'user', content: '[系统提示] token 预算即将耗尽，请尽快给出结论。' });
    }

    // 3. 退出判断
    if (!hasToolCall) { console.log('\n[退出] 模型完成，无工具调用'); break; }
    if (step >= MAX_STEPS) { console.log('\n[退出] 达到最大轮次'); break; }

    // 4. 组装下轮
    const response = await result.response;
    messages.push(...response.messages);
  }

  console.log(`\n[完成] 共 ${step} 轮，总计 ${tokensUsed} tokens`);
}

agentLoop().catch(console.error);
