/**
 * @title Tool Call 流式解析
 * @group 流式响应
 * @description 演示工具调用的参数 JSON 如何通过流式碎片拼接而成
 */

import { createMockModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

console.log('=== Case 02: Tool Call 流式解析 ===\n');

// ---- 第一部分：手动演示 JSON 碎片拼接 ----

console.log('--- Part 1: JSON 碎片拼接过程 ---\n');

const fragments = [
  '{"ci',
  'ty":"',
  '北京"',
  '}',
];

console.log('[概念] 工具调用的 args 在流式传输中被拆成多个碎片');
console.log('[概念] 每个碎片单独看都不合法，只有全部拼起来才是有效 JSON\n');

let accumulated = '';
fragments.forEach((frag, i) => {
  accumulated += frag;
  console.log(`  片段 ${i + 1}: "${frag}"`);
  console.log(`  累积:   "${accumulated}"`);
  try {
    JSON.parse(accumulated);
    console.log(`  解析:   成功!`);
  } catch {
    console.log(`  解析:   失败 (不完整)`);
  }
  console.log();
});

console.log(`最终完整 JSON: ${fragments.join('')}`);
console.log(`解析结果: city = "${JSON.parse(fragments.join('')).city}"`);

console.log('\n[关键] 过早解析 = 崩溃。等全部输出完再解析。\n');

// ---- 第二部分：使用 streamText 展示实际的 tool call 流 ----

console.log('--- Part 2: streamText 中的 Tool Call 流 ---\n');

const model = createMockModel([
  { type: 'text-delta', textDelta: '让我查一下北京的天气。' },
  {
    type: 'tool-call',
    toolCallType: 'function',
    toolCallId: 'call_weather_1',
    toolName: 'get_weather',
    // 在真实场景中，这个 args 字符串也是通过多个 text-delta 碎片拼接的
    // AI SDK 帮我们处理了拼接，最终得到完整的 JSON
    args: '{"city":"北京"}',
  },
  { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 10, completionTokens: 15 } },
]);

async function main() {
  const result = streamText({
    model,
    tools: allTools,
    prompt: '北京天气怎么样',
  });

  for await (const event of result.fullStream) {
    switch (event.type) {
      case 'text-delta':
        process.stdout.write(event.textDelta);
        break;

      case 'tool-call':
        console.log('\n');
        console.log(`[tool-call] 工具名: ${event.toolName}`);
        // AI SDK v4 的 tool-call 事件中，args 已经是解析好的对象
        // 框架内部完成了 JSON 碎片的拼接和解析
        console.log(`[tool-call] 完整参数:`, event.args);
        console.log(`[tool-call] 参数类型: ${typeof event.args}`);
        console.log(`[tool-call] city 字段: "${event.args.city}"`);
        break;

      case 'tool-result':
        console.log(`[tool-result] ${event.toolName} 返回: ${event.result}`);
        break;

      case 'finish':
        console.log(`\n[finish] reason=${event.finishReason}`);
        break;
    }
  }

  console.log('\n--- 要点总结 ---');
  console.log('1. 工具调用参数在流式传输中被拆成多个碎片');
  console.log('2. 每个碎片单独看不是合法 JSON');
  console.log('3. AI SDK 内部自动拼接碎片，在 tool-call 事件中给出完整参数');
  console.log('4. 开发者不需要手动拼接，但需要理解这个机制');
  console.log('5. 如果你自己解析原始流，切记等所有碎片到齐后再 JSON.parse');
}

main().catch(console.error);
