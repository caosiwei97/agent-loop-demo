/**
 * @title Tool Call 流式解析
 * @group 流式响应
 * @description 在流式输出中解析工具调用事件。相比 case-01，新增了 tools 参数
 *   和 tool-call / tool-result 事件的处理逻辑。
 */

import { createMockModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

// ═══ 本案例新增 ═══
// +tools 参数传入 streamText
// +tool-call 事件处理（观察 JSON args 如何在流结束后完整组装）
// +tool-result 事件处理
// ══════════════════

const model = createMockModel([
  { type: 'text-delta', textDelta: '让我读取一下文件内容...' },
  { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
  { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 10, completionTokens: 25 } },
]);

async function main() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 的内容' }];

  console.log('[用户]', messages[0].content);
  console.log('\n── 流式输出 ──');

  // 调用模型（带工具，单轮 — 只观察事件，不做多轮）
  const result = streamText({ model, messages, tools: allTools, maxSteps: 1 });

  // 消费流：处理 text-delta + tool-call + tool-result
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

  console.log(`\n\n[完成] 文本长度=${text.length}, 有工具调用=${hasToolCall}`);
}

main().catch(console.error);
