/**
 * @title 指数退避重试
 * @group 容错机制
 * @description 当 streamText 调用失败（如 429/5xx），使用指数退避策略自动重试。
 *   相比 case-03，新增了 retryWithBackoff() 包裹 streamText 调用。
 */

import { createFailingModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';
import { sleep } from '../lib/utils.mjs';

// ═══ 本案例新增 ═══
// +retryWithBackoff() — 指数退避重试封装
// +错误分类（可重试 vs 不可重试）
// ══════════════════

/**
 * 指数退避重试
 * @param {() => any} fn - 要重试的函数
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = /429|5\d{2}|ECONNRESET|TIMEOUT/.test(err.message);
      if (!isRetryable || attempt === maxRetries) {
        console.log(`  [重试] 不可恢复错误或已达上限，抛出`);
        throw err;
      }
      const delayMs = Math.min(1000 * 2 ** attempt, 8000);
      console.log(`  [重试] 第 ${attempt + 1} 次失败: ${err.message}，${delayMs}ms 后重试...`);
      await sleep(delayMs);
    }
  }
}

// 前 2 次失败，第 3 次成功
const model = createFailingModel({ failCount: 2 });

async function agentLoop() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 然后修复问题' }];
  let step = 0;
  const MAX_STEPS = 5;

  console.log('[用户]', messages[0].content);

  while (true) {
    step++;
    console.log(`\n── 第 ${step} 轮 ──`);

    // 1. 调用模型（带重试）
    const result = await retryWithBackoff(
      () => streamText({ model, messages, tools: allTools, maxSteps: 1 })
    );

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
