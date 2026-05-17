/**
 * @title 边说边执行
 * @group 流式响应
 * @description 演示"边说边执行"——工具块一完成就立即执行，不等整条消息说完
 */

import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

console.log('=== Case 03: 边说边执行 ===\n');

// 多轮模型：
// 第1轮：先说一句话，然后发起 3 个并发的文件读取
// 第2轮：拿到工具结果后，输出总结
const model = createMultiTurnModel([
  [
    { type: 'text-delta', textDelta: '好的，我来帮你看看这三个文件的内容。\n\n' },
    // 三个 read_file 调用（可以并发执行）
    {
      type: 'tool-call',
      toolCallType: 'function',
      toolCallId: 'call_1',
      toolName: 'read_file',
      args: '{"path":"src/utils.ts"}',
    },
    {
      type: 'tool-call',
      toolCallType: 'function',
      toolCallId: 'call_2',
      toolName: 'read_file',
      args: '{"path":"src/index.ts"}',
    },
    {
      type: 'tool-call',
      toolCallType: 'function',
      toolCallId: 'call_3',
      toolName: 'read_file',
      args: '{"path":"package.json"}',
    },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 10, completionTokens: 30 } },
  ],
  [
    { type: 'text-delta', textDelta: '已读取全部 3 个文件。可以看到这个项目使用了 moment.js 来处理日期格式化。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 50, completionTokens: 20 } },
  ],
]);

async function main() {
  console.log('[概念] Agent Loop 不会等所有工具调用说完才开始执行');
  console.log('[概念] 工具块一完成就立即执行，后续工具调用的生成在时间上重叠\n');
  console.log('--- 开始 streamText (maxSteps=5) ---\n');

  const result = streamText({
    model,
    tools: allTools,
    prompt: '帮我看看项目的文件结构',
    maxSteps: 5,
  });

  let stepCount = 0;

  for await (const event of result.fullStream) {
    const ts = `${Date.now() % 100000}`.padStart(5, '0');

    switch (event.type) {
      case 'step-start':
        stepCount++;
        console.log(`[${ts}ms] [step-start] 第 ${stepCount} 轮开始`);
        break;

      case 'text-delta':
        process.stdout.write(`[${ts}ms] [text-delta]  "${event.textDelta}"\n`);
        break;

      case 'tool-call':
        console.log(`[${ts}ms] [tool-call]   ${event.toolName}(${event.args})`);
        break;

      case 'tool-result':
        const preview = String(event.result).split('\n')[0].substring(0, 60);
        console.log(`[${ts}ms] [tool-result] ${event.toolName} -> "${preview}..."`);
        break;

      case 'step-finish':
        console.log(`[${ts}ms] [step-finish] 第 ${stepCount} 轮结束\n`);
        break;

      case 'finish':
        console.log(`[${ts}ms] [finish]     总共 ${stepCount} 轮, reason=${event.finishReason}`);
        break;
    }
  }

  console.log('\n--- 时序分析 ---');
  console.log('观察上面的时间戳:');
  console.log('  - 文本输出和工具调用可以交替出现');
  console.log('  - 工具执行和下一轮工具调用的生成在时间上重叠');
  console.log('  - 这就是"边说边执行"——不等整条消息说完就开始干活');

  console.log('\n--- 要点总结 ---');
  console.log('1. streamText + maxSteps 实现自动多轮 Agent Loop');
  console.log('2. 工具调用一完成就执行，不等所有工具块到齐');
  console.log('3. 工具执行和后续文本/工具生成在时间上重叠 (pipelining)');
  console.log('4. maxSteps 限制最大轮次，防止无限循环');
}

main().catch(console.error);
