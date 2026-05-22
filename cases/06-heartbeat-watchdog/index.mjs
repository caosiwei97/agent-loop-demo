/**
 * @title 心跳看门狗
 * @group 容错机制
 * @description 用 Promise.race 检测流是否卡住。如果超过指定时间没有新事件，
 *   判定为超时并恢复。相比 case-03，新增了 watchdog() 超时检测机制。
 */

import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';

// ═══ 本案例新增 ═══
// +watchdog() — 基于 Promise.race 的心跳超时检测
// +超时后中断流并标记，触发恢复逻辑
// ══════════════════

/**
 * 心跳看门狗：给异步迭代器加超时保护
 * @param {AsyncIterable} stream - fullStream 迭代器
 * @param {number} timeoutMs - 单个事件最长等待时间
 * @returns {AsyncGenerator} - 带超时保护的事件流
 */
async function* watchdog(stream, timeoutMs = 5000) {
  const iterator = stream[Symbol.asyncIterator]();
  while (true) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('WATCHDOG_TIMEOUT')), timeoutMs)
    );
    try {
      const { value, done } = await Promise.race([iterator.next(), timeout]);
      if (done) return;
      yield value;
    } catch (err) {
      if (err.message === 'WATCHDOG_TIMEOUT') {
        console.log(`\n  [看门狗] 超过 ${timeoutMs}ms 无响应，判定超时`);
        yield { type: 'watchdog-timeout' };
        return;
      }
      throw err;
    }
  }
}

const model = createMultiTurnModel([
  // 第1轮：正常工具调用
  [
    { type: 'text-delta', textDelta: '我来读取文件...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 10, completionTokens: 20 } },
  ],
  // 第2轮：正常完成
  [
    { type: 'text-delta', textDelta: '文件内容正常，没有需要修复的问题。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 30, completionTokens: 25 } },
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

    // 2. 消费流（带看门狗保护）
    let text = '';
    let hasToolCall = false;
    let timedOut = false;
    for await (const event of watchdog(result.fullStream, 5000)) {
      if (event.type === 'watchdog-timeout') {
        timedOut = true;
        break;
      } else if (event.type === 'text-delta') {
        text += event.textDelta;
        process.stdout.write(event.textDelta);
      } else if (event.type === 'tool-call') {
        hasToolCall = true;
        console.log(`\n  [工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
      } else if (event.type === 'tool-result') {
        console.log(`  [工具结果] ${event.toolName} → ${String(event.result).slice(0, 60)}...`);
      }
    }

    // 超时恢复：注入提示让模型继续
    if (timedOut) {
      console.log('  [恢复] 注入超时恢复消息，重新开始本轮');
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: '你似乎卡住了，请继续。' });
      continue;
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
