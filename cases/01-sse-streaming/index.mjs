/**
 * @title SSE 流式响应基础
 * @group 流式响应
 * @description 演示 LLM 如何通过 SSE 逐 token 输出，模拟"打字机效果"
 */

import { createMockModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';

console.log('=== Case 01: SSE 流式响应基础 ===\n');

// 模型是自回归生成的 —— 一个 token 一个 token 往外蹦
// 每个 chunk 就是一个微小的增量，不是完整的结果
const model = createMockModel([
  { type: 'text-delta', textDelta: '你好' },
  { type: 'text-delta', textDelta: '，' },
  { type: 'text-delta', textDelta: '我是' },
  { type: 'text-delta', textDelta: '一个' },
  { type: 'text-delta', textDelta: ' AI ' },
  { type: 'text-delta', textDelta: '助手' },
  { type: 'text-delta', textDelta: '。' },
  { type: 'finish', finishReason: 'stop', usage: { promptTokens: 8, completionTokens: 7 } },
], { chunkDelay: 100 });

async function main() {
  console.log('[概念] LLM 生成文本是"自回归"的 —— 一个 token 一个 token 往外蹦');
  console.log('[概念] 每个 chunk 就是流中的一个微小增量\n');
  console.log('--- 开始消费 fullStream ---\n');

  const result = streamText({
    model,
    prompt: '你好',
  });

  let fullText = '';

  for await (const event of result.fullStream) {
    switch (event.type) {
      case 'step-start':
        console.log(`[event: step-start]  新的一轮开始`);
        break;

      case 'text-delta':
        // 每个 text-delta 就是一个 token 片段
        // 前端收到后立即追加到页面上，用户看到"打字机效果"
        process.stdout.write(`[event: text-delta]  "${event.textDelta}"`);
        fullText += event.textDelta;
        // 模拟视觉延迟
        await new Promise(r => setTimeout(r, 80));
        console.log();
        break;

      case 'step-finish':
        console.log(`[event: step-finish] 本轮结束`);
        break;

      case 'finish':
        console.log(`\n[event: finish]     finishReason=${event.finishReason}`);
        console.log(`[event: finish]     usage: promptTokens=${event.usage.promptTokens}, completionTokens=${event.usage.completionTokens}`);
        break;

      default:
        console.log(`[event: ${event.type}]`, event);
    }
  }

  console.log('\n--- 拼接结果 ---');
  console.log(`完整文本: "${fullText}"`);

  console.log('\n--- 要点总结 ---');
  console.log('1. 流式响应通过 fullStream 迭代器逐 chunk 消费');
  console.log('2. text-delta 事件包含一个 token 片段，不是完整文本');
  console.log('3. 前端收到 text-delta 后立即追加显示，形成"打字机效果"');
  console.log('4. finish 事件包含终止原因和 token 用量统计');
  console.log('5. 不要等所有 chunk 到齐才显示 —— 逐 chunk 渲染才是"流式"');
}

main().catch(console.error);
