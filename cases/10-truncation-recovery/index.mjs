/**
 * @title 截断恢复
 * @group 运行时安全
 * @description 当模型因 context 过长而截断（finishReason='length'）时，
 *   注入恢复消息让模型继续输出。相比 case-03，新增了截断检测和恢复逻辑。
 */

import { createTruncatingModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

// ═══ 本案例新增 ═══
// +finishReason === 'length' 检测
// +截断后注入恢复消息："你的输出被截断了，请继续"
// +使用 createTruncatingModel 模拟截断场景
// ══════════════════

const model = createTruncatingModel({ truncateCount: 2 });

async function agentLoop() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 然后修复问题' }];
  let step = 0;
  const MAX_STEPS = 5;
  let truncationCount = 0;
  const MAX_TRUNCATIONS = 3;

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

    // 截断检测与恢复
    const finishReason = await result.finishReason;
    if (finishReason === 'length') {
      truncationCount++;
      console.log(`\n  [截断] 第 ${truncationCount} 次截断 (finishReason=length)`);
      if (truncationCount >= MAX_TRUNCATIONS) {
        console.log('\n[退出] 截断次数过多，放弃');
        break;
      }
      // 注入恢复消息
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: '你的输出被截断了，请从断点处继续。' });
      console.log('  [恢复] 注入继续指令，进入下一轮');
      continue;
    }

    // 3. 退出判断
    if (!hasToolCall) { console.log('\n[退出] 模型完成，无工具调用'); break; }
    if (step >= MAX_STEPS) { console.log('\n[退出] 达到最大轮次'); break; }

    // 4. 组装下轮
    const response = await result.response;
    messages.push(...response.messages);
  }

  console.log(`\n[完成] 共 ${step} 轮，截断恢复 ${truncationCount} 次`);
}

agentLoop().catch(console.error);
