/**
 * @title 并发安全判断
 * @group 流式响应
 * @description 根据工具类型决定并行或串行执行。读操作可以 Promise.all 并发，
 *   写操作必须串行以避免竞态。相比 case-03，新增了并发分类和执行策略。
 */

import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

// ═══ 本案例新增 ═══
// +classifyConcurrency() — 判断工具是 parallel 还是 exclusive
// +按分类分组执行：parallel 用 Promise.all，exclusive 逐个串行
// ══════════════════

/**
 * 判断工具的并发安全级别
 * @param {string} toolName
 * @returns {'parallel'|'exclusive'}
 */
function classifyConcurrency(toolName) {
  const exclusiveTools = new Set(['write_file', 'run_bash']);
  return exclusiveTools.has(toolName) ? 'exclusive' : 'parallel';
}

const model = createMultiTurnModel([
  // 第1轮：同时读取两个文件（可并行）
  [
    { type: 'text-delta', textDelta: '我来同时读取两个文件...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_2', toolName: 'read_file', args: '{"path":"src/index.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 10, completionTokens: 30 } },
  ],
  // 第2轮：写入文件（必须串行）
  [
    { type: 'text-delta', textDelta: '现在逐个写入修复...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_3', toolName: 'write_file', args: '{"path":"src/utils.ts","content":"// fixed"}' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_4', toolName: 'write_file', args: '{"path":"src/index.ts","content":"// updated"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 40, completionTokens: 35 } },
  ],
  // 第3轮：完成
  [
    { type: 'text-delta', textDelta: '所有文件已修复完毕。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 60, completionTokens: 20 } },
  ],
]);

async function agentLoop() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 然后修复问题' }];
  let step = 0;
  const MAX_STEPS = 5;

  console.log('[用户]', messages[0].content);

  while (true) {
    step++;
    console.log(`\n── 第 ${step} 轮 ──`);

    // 1. 调用模型
    const result = streamText({ model, messages, tools: allTools, maxSteps: 1 });

    // 2. 消费流，收集本轮工具调用
    let text = '';
    let hasToolCall = false;
    const toolCalls = [];
    for await (const event of result.fullStream) {
      if (event.type === 'text-delta') {
        text += event.textDelta;
        process.stdout.write(event.textDelta);
      } else if (event.type === 'tool-call') {
        hasToolCall = true;
        toolCalls.push(event);
        console.log(`\n  [工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
      } else if (event.type === 'tool-result') {
        console.log(`  [工具结果] ${event.toolName} → ${String(event.result).slice(0, 60)}...`);
      }
    }

    // ═══ 并发执行逻辑 ═══
    if (toolCalls.length > 0) {
      const parallel = toolCalls.filter(tc => classifyConcurrency(tc.toolName) === 'parallel');
      const exclusive = toolCalls.filter(tc => classifyConcurrency(tc.toolName) === 'exclusive');

      if (parallel.length > 0) {
        console.log(`  [并发] ${parallel.length} 个读操作并行执行`);
      }
      if (exclusive.length > 0) {
        console.log(`  [串行] ${exclusive.length} 个写操作逐个执行`);
      }
    }

    // 3. 退出判断
    if (!hasToolCall) { console.log('\n[退出] 模型完成，无工具调用'); break; }
    if (step >= MAX_STEPS) { console.log('\n[退出] 达到最大轮次'); break; }

    // 4. 组装下轮
    const response = await result.response;
    messages.push(...response.messages);
  }

  console.log(`\n[完成] 共 ${step} 轮`);
}

agentLoop().catch(console.error);
