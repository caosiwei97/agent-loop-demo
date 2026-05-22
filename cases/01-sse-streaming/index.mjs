/**
 * @title SSE 流式响应基础
 * @group 流式响应
 * @description 最简流式输出：streamText 逐 token 返回文本，实现"打字机效果"。
 *   无工具、无循环，只演示 text-delta 事件的消费方式。
 */

import { createMockModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';

// ═══ 本案例新增 ═══
// 无 — 这是最简基线：只做 streamText + text-delta 消费
// ══════════════════

const model = createMockModel([
  { type: 'text-delta', textDelta: '你好！' },
  { type: 'text-delta', textDelta: '我是一个' },
  { type: 'text-delta', textDelta: 'AI 助手，' },
  { type: 'text-delta', textDelta: '正在逐字' },
  { type: 'text-delta', textDelta: '输出文本。' },
  { type: 'text-delta', textDelta: '这就是流式响应的' },
  { type: 'text-delta', textDelta: '"打字机效果"。' },
  { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 30 } },
]);

async function main() {
  const messages = [{ role: 'user', content: '你好，请介绍一下你自己' }];

  console.log('[用户]', messages[0].content);
  console.log('\n── 流式输出 ──');

  // 调用模型（无工具，单轮）
  const result = streamText({ model, messages });

  // 消费流：只关注 text-delta
  let text = '';
  for await (const event of result.fullStream) {
    if (event.type === 'text-delta') {
      text += event.textDelta;
      process.stdout.write(event.textDelta);
    }
  }

  console.log('\n\n[完成] 共输出', text.length, '个字符');
}

main().catch(console.error);
