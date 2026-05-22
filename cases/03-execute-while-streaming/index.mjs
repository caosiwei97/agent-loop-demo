/**
 * @title 边说边执行
 * @group 流式响应
 * @description 完整的 while(true) Agent Loop：工具执行后结果反馈到消息列表，
 *   模型继续推理直到无工具调用。相比 case-02，新增了循环和消息组装。
 */

import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

// ═══ 本案例新增 ═══
// +while(true) 循环驱动多轮
// +response.messages 反馈到 messages 数组
// +双重退出条件：无工具调用 / 达到最大轮次
// ══════════════════

const model = createMultiTurnModel([
  // 第1轮：读取文件
  [
    { type: 'text-delta', textDelta: '让我先看看文件内容...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 10, completionTokens: 20 } },
  ],
  // 第2轮：写入修复
  [
    { type: 'text-delta', textDelta: '发现问题，我来修复...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_2', toolName: 'write_file', args: '{"path":"src/utils.ts","content":"// fixed version"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 30, completionTokens: 25 } },
  ],
  // 第3轮：最终总结
  [
    { type: 'text-delta', textDelta: '修复完成！我将 moment 替换为了 dayjs，减小了包体积。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 50, completionTokens: 30 } },
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
