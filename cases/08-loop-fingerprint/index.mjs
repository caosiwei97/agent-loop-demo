/**
 * @title 死循环检测
 * @group 运行时安全
 * @description 用 SHA256 指纹 + 滑动窗口检测重复工具调用，防止 Agent 陷入死循环。
 *   相比 case-03，新增了 detectLoop() 指纹检测函数。
 */

import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { streamText } from 'ai';
import { allTools } from '../lib/mock-tools.mjs';
import { fingerprint } from '../lib/utils.mjs';

// ═══ 本案例新增 ═══
// +detectLoop() — 滑动窗口 + SHA256 指纹检测重复调用
// +循环检测后注入提示或强制退出
// ══════════════════

/**
 * 死循环检测器
 * @param {string[]} window - 最近 N 次调用的指纹数组
 * @param {string} toolName - 当前工具名
 * @param {object} args - 当前工具参数
 * @param {number} threshold - 相同指纹出现次数阈值
 * @returns {{looped: boolean, fp: string}}
 */
function detectLoop(window, toolName, args, threshold = 3) {
  const fp = fingerprint(toolName, args);
  window.push(fp);
  // 只保留最近 10 条
  if (window.length > 10) window.shift();
  // 统计相同指纹出现次数
  const count = window.filter(f => f === fp).length;
  return { looped: count >= threshold, fp };
}

const model = createMultiTurnModel([
  // 第1轮：读取文件
  [
    { type: 'text-delta', textDelta: '让我查看文件...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 10, completionTokens: 20 } },
  ],
  // 第2轮：重复读同一个文件（模拟死循环）
  [
    { type: 'text-delta', textDelta: '再看一下...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_2', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 20, completionTokens: 20 } },
  ],
  // 第3轮：又重复（将触发检测）
  [
    { type: 'text-delta', textDelta: '我再确认一下...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_3', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 30, completionTokens: 20 } },
  ],
]);

async function agentLoop() {
  const messages = [{ role: 'user', content: '帮我查看 src/utils.ts 然后修复问题' }];
  let step = 0;
  const MAX_STEPS = 5;
  const fpWindow = [];  // 指纹滑动窗口

  console.log('[用户]', messages[0].content);

  while (true) {
    step++;
    console.log(`\n── 第 ${step} 轮 ──`);

    // 1. 调用模型
    const result = streamText({ model, messages, tools: allTools, maxSteps: 1 });

    // 2. 消费流
    let text = '';
    let hasToolCall = false;
    let loopDetected = false;
    for await (const event of result.fullStream) {
      if (event.type === 'text-delta') {
        text += event.textDelta;
        process.stdout.write(event.textDelta);
      } else if (event.type === 'tool-call') {
        hasToolCall = true;
        console.log(`\n  [工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
        // 指纹检测
        const { looped, fp } = detectLoop(fpWindow, event.toolName, event.args);
        console.log(`  [指纹] ${fp}${looped ? ' ⚠ 重复!' : ''}`);
        if (looped) loopDetected = true;
      } else if (event.type === 'tool-result') {
        console.log(`  [工具结果] ${event.toolName} → ${String(event.result).slice(0, 60)}...`);
      }
    }

    // 3. 退出判断
    if (loopDetected) { console.log('\n[退出] 检测到死循环，强制中断'); break; }
    if (!hasToolCall) { console.log('\n[退出] 模型完成，无工具调用'); break; }
    if (step >= MAX_STEPS) { console.log('\n[退出] 达到最大轮次'); break; }

    // 4. 组装下轮
    const response = await result.response;
    messages.push(...response.messages);
  }

  console.log(`\n[完成] 共 ${step} 轮`);
}

agentLoop().catch(console.error);
