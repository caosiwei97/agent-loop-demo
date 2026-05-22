/**
 * @title 三层降级链
 * @group 容错机制
 * @description 当主模型失败时，依次尝试：流式 → 非流式 → 小模型。
 *   相比 case-05，新增了 degradeOnFailure() 三层降级策略。
 */

import { createFailingModel, createMockModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';
import { sleep } from '../lib/utils.mjs';

// ═══ 本案例新增 ═══
// +degradeOnFailure() — 三层降级链
//   Layer 1: 流式主模型（带重试）
//   Layer 2: 非流式主模型
//   Layer 3: 小模型兜底
// ══════════════════

/**
 * 三层降级执行
 * @param {Array<{name: string, model: any}>} layers
 * @param {object} params - streamText 的参数（除 model 外）
 * @returns {Promise<{result: any, layer: string}>}
 */
async function degradeOnFailure(layers, params) {
  for (const layer of layers) {
    try {
      console.log(`  [降级] 尝试 Layer: ${layer.name}`);
      const result = streamText({ model: layer.model, ...params });
      // 尝试消费第一个事件来验证连接
      const reader = result.fullStream[Symbol.asyncIterator]();
      const first = await reader.next();
      if (first.done) throw new Error('空响应');
      // 成功 — 返回结果
      return { result, layer: layer.name };
    } catch (err) {
      console.log(`  [降级] ${layer.name} 失败: ${err.message}`);
      await sleep(100);
    }
  }
  throw new Error('所有降级层均失败');
}

// 主模型：前 2 次失败
const primaryModel = createFailingModel({ failCount: 2 });
// 备用模型：直接成功
const fallbackModel = createMockModel([
  { type: 'text-delta', textDelta: '（降级模型）文件内容看起来正常，无需修复。' },
  { type: 'finish', finishReason: 'stop', usage: { promptTokens: 5, completionTokens: 15 } },
]);

const layers = [
  { name: '流式主模型', model: primaryModel },
  { name: '非流式主模型', model: primaryModel },
  { name: '小模型兜底', model: fallbackModel },
];

async function agentLoop() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 然后修复问题' }];
  let step = 0;
  const MAX_STEPS = 5;

  console.log('[用户]', messages[0].content);

  while (true) {
    step++;
    console.log(`\n── 第 ${step} 轮 ──`);

    // 1. 调用模型（带三层降级）
    const { result, layer } = await degradeOnFailure(layers, {
      messages,
      tools: allTools,
      maxSteps: 1,
    });
    console.log(`  [降级] 使用: ${layer}`);

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
