/**
 * @title Agent Loop 完整骨架
 * @group 运行时安全
 * @description 带全部三层防御的完整 Agent Loop 骨架
 */

import { createHash } from 'node:crypto';
import { createMultiTurnModel } from '../lib/mock-model.mjs';
import { allTools } from '../lib/mock-tools.mjs';
import { streamText } from 'ai';

// ============================================================================
// Agent Loop 完整骨架 — 三层防御
//
// 这是教学材料的综合案例，将前面所有运行时安全机制整合在一起：
//   第一层防御: 死循环检测 — fingerprint + 滑动窗口计数
//   第二层防御: Token 预算  — 90% nudge + 递减回报检测
//   第三层防御: 截断恢复   — 渐进式恢复消息
//
// 模拟场景: Agent 被要求"找到并移除项目中所有 console.log"
// ============================================================================

/**
 * 辅助函数：消耗流并返回结果
 * streamText 的 promise（text, usage, finishReason）需要在流被消耗后才能 resolve
 */
async function consumeResult(result) {
  let text = '';
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  return {
    text,
    usage: await result.usage,
    finishReason: await result.finishReason,
  };
}

console.log('='.repeat(60));
console.log('案例 12: Agent Loop 完整骨架（三层防御）');
console.log('='.repeat(60));
console.log();
console.log('场景: 找到并移除项目中所有 console.log');
console.log();

// --- 配置 ---
const MAX_TURNS = 20;
const TOKEN_BUDGET = 15_000;
const DIMINISHING_THRESHOLD = 500;
const DIMINISHING_MIN_TOTAL = 5000;
const MAX_RECOVERY = 3;
const WARNING_THRESHOLD = 5;
const CRITICAL_THRESHOLD = 8;
const BREAKER_THRESHOLD = 10;

// --- 状态 ---
let turn = 0;
let totalOutput = 0;
let totalInput = 0;
let lowStreak = 0;
let recoveryCount = 0;
const callHistory = new Map(); // fingerprint -> { count, results: [] }

// ============================================================================
// 工具函数: 指纹计算
// ============================================================================
function fingerprint(name, params) {
  const stable = JSON.stringify(params, Object.keys(params || {}).sort());
  return createHash('sha256').update(name + stable).digest('hex').slice(0, 12);
}

function resultHash(result) {
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  return createHash('sha256').update(str).digest('hex').slice(0, 8);
}

// ============================================================================
// 第一层防御: 死循环检测
// ============================================================================
function checkLoop(toolName, params, result) {
  const fp = fingerprint(toolName, params);
  const rHash = resultHash(result);

  if (!callHistory.has(fp)) {
    callHistory.set(fp, { count: 0, results: [] });
  }
  const entry = callHistory.get(fp);
  entry.count++;
  entry.results.push(rHash);

  // 检查通用重复
  if (entry.count >= BREAKER_THRESHOLD) {
    return { level: 'break', message: `[熔断] ${toolName} 已调用 ${entry.count} 次，强制停止` };
  }
  if (entry.count >= CRITICAL_THRESHOLD) {
    return { level: 'critical', message: `[阻断] ${toolName} 已调用 ${entry.count} 次` };
  }
  if (entry.count >= WARNING_THRESHOLD) {
    return { level: 'warning', message: `[警告] ${toolName} 已调用 ${entry.count} 次` };
  }

  // 检查无进展轮询（最后 3 次结果是否相同）
  const recentResults = entry.results.slice(-3);
  if (recentResults.length >= 3) {
    const allSame = recentResults.every(r => r === recentResults[0]);
    if (allSame) {
      return { level: 'critical', message: `[无进展] ${toolName} 连续 3 次返回相同结果` };
    }
  }

  return null; // 正常
}

// ============================================================================
// 第二层防御: Token 预算检测
// ============================================================================
function checkBudget(outputThisTurn) {
  totalOutput += outputThisTurn;
  const ratio = (totalInput + totalOutput) / TOKEN_BUDGET;

  // 90% nudge
  let nudge = null;
  if (ratio >= 0.90 && ratio < 0.95) {
    const pct = Math.round(ratio * 100);
    nudge = `已完成 Token 目标的 ${pct}%（${(totalInput + totalOutput).toLocaleString()} / ${TOKEN_BUDGET.toLocaleString()}）。继续工作——不要总结。`;
  }

  // 递减回报检测
  let diminishing = false;
  if (totalOutput > DIMINISHING_MIN_TOTAL) {
    if (outputThisTurn < DIMINISHING_THRESHOLD) {
      lowStreak++;
      if (lowStreak >= 2) {
        diminishing = true;
      }
    } else {
      lowStreak = 0;
    }
  }

  // 超预算
  if (totalInput + totalOutput >= TOKEN_BUDGET) {
    return { budgetExceeded: true, nudge, diminishing };
  }

  return { budgetExceeded: false, nudge, diminishing };
}

// ============================================================================
// 第三层防御: 截断恢复消息
// ============================================================================
const recoveryMessages = [
  '直接从断点继续——不要道歉，不要回顾。把剩余工作拆成更小的块。',
  '再次被截断。大幅精简，只列关键结论。',
  '第三次截断。只输出最关键的结论。',
];

// ============================================================================
// 模拟 Agent Loop
// ============================================================================

// 模拟多轮: Agent 搜索 console.log -> 读取文件 -> 写入文件
// 其中有一个重复调用触发循环检测
const loopModel = createMultiTurnModel([
  // Turn 1: 搜索 console.log
  [
    { type: 'text-delta', textDelta: '让我先搜索项目中的 console.log...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'c1', toolName: 'grep_files', args: '{"pattern":"console\\\\.log"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 100, completionTokens: 50 } },
  ],
  // Turn 2: 读取第一个文件
  [
    { type: 'text-delta', textDelta: '找到了匹配，让我读取文件内容...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'c2', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 200, completionTokens: 60 } },
  ],
  // Turn 3: 读取第二个文件
  [
    { type: 'text-delta', textDelta: '继续读取其他文件...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'c3', toolName: 'read_file', args: '{"path":"src/index.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 300, completionTokens: 60 } },
  ],
  // Turn 4: 读取 Button.tsx（这个文件没有 console.log，但模型"不确定"又读了）
  [
    { type: 'text-delta', textDelta: '让我再确认一下这个文件...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'c4', toolName: 'read_file', args: '{"path":"src/components/Button.tsx"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 400, completionTokens: 60 } },
  ],
  // Turn 5: 又重复读 src/utils.ts（触发循环检测警告!）
  [
    { type: 'text-delta', textDelta: '让我重新确认一下...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'c5', toolName: 'read_file', args: '{"path":"src/utils.ts"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 500, completionTokens: 60 } },
  ],
  // Turn 6: 写入修改后的文件
  [
    { type: 'text-delta', textDelta: '现在开始修改文件，移除 console.log...' },
    { type: 'tool-call', toolCallType: 'function', toolCallId: 'c6', toolName: 'write_file', args: '{"path":"src/utils.ts","content":"export function formatDate(date) { ... }"}' },
    { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 600, completionTokens: 80 } },
  ],
  // Turn 7: 完成
  [
    { type: 'text-delta', textDelta: '已完成所有修改，共移除 1 处 console.log 调用。' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 700, completionTokens: 100 } },
  ],
]);

console.log('开始 Agent Loop...');
console.log(`配置: MAX_TURNS=${MAX_TURNS}, TOKEN_BUDGET=${TOKEN_BUDGET.toLocaleString()}`);
console.log();

let currentPrompt = '找到并移除项目中所有 console.log 调用';
let stopped = false;
let stopReason = '';

for (let t = 1; t <= MAX_TURNS && !stopped; t++) {
  turn = t;
  console.log(`--- Turn ${t}/${MAX_TURNS} ---`);

  try {
    const result = streamText({
      model: loopModel,
      tools: allTools,
      prompt: currentPrompt,
      maxSteps: 1,
    });

    // 必须先消耗流，然后才能 await promise
    const { text, usage, finishReason } = await consumeResult(result);
    const steps = await result.steps;

    totalInput += usage.promptTokens;

    // 显示输出
    if (text) {
      console.log(`  输出: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
    }

    // 检查工具调用
    if (steps && steps.length > 0) {
      for (const step of steps) {
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const tc of step.toolCalls) {
            console.log(`  工具调用: ${tc.toolName}(${typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)})`);

            // 获取工具执行结果
            let toolResult = '(无结果)';
            if (step.toolResults && step.toolResults.length > 0) {
              const tr = step.toolResults.find(r => r.toolCallId === tc.toolCallId);
              if (tr) {
                toolResult = typeof tr.result === 'string'
                  ? tr.result
                  : JSON.stringify(tr.result);
              }
            }

            console.log(`  工具结果: ${toolResult.slice(0, 80)}${toolResult.length > 80 ? '...' : ''}`);

            // 第一层防御: 死循环检测
            // tc.args 可能是对象也可能是字符串，统一处理
            const parsedArgs = typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args;
            const loopResult = checkLoop(tc.toolName, parsedArgs, toolResult);
            if (loopResult) {
              console.log(`  [第一层] ${loopResult.message}`);
              if (loopResult.level === 'break') {
                stopped = true;
                stopReason = loopResult.message;
                break;
              } else if (loopResult.level === 'critical') {
                // 阻断工具，Agent 收到错误（这里只打印警告）
                console.log(`  [第一层] 阻断此次工具调用，Agent 会收到错误`);
              }
            }
          }
        }
      }
    }

    // 第二层防御: Token 预算检测
    const outputThisTurn = usage.completionTokens;
    const budgetCheck = checkBudget(outputThisTurn);

    const totalUsed = totalInput + totalOutput;
    const budgetRatio = ((totalUsed / TOKEN_BUDGET) * 100).toFixed(1);
    console.log(`  Token: 输入 ${usage.promptTokens}, 输出 ${outputThisTurn}, 累计 ${totalUsed}/${TOKEN_BUDGET} (${budgetRatio}%)`);

    if (budgetCheck.nudge) {
      console.log(`  [第二层] nudge: "${budgetCheck.nudge}"`);
      currentPrompt = budgetCheck.nudge;
    }

    if (budgetCheck.diminishing) {
      console.log(`  [第二层] 递减回报检测: 连续 ${lowStreak} 次输出 < ${DIMINISHING_THRESHOLD} Token`);
      stopped = true;
      stopReason = 'Token 递减回报检测触发';
      break;
    }

    if (budgetCheck.budgetExceeded) {
      console.log(`  [第二层] Token 预算耗尽`);
      stopped = true;
      stopReason = 'Token 预算耗尽';
      break;
    }

    // 第三层防御: 截断恢复
    if (finishReason === 'length') {
      recoveryCount++;
      console.log(`  [第三层] 输出被截断! (第 ${recoveryCount} 次恢复)`);
      if (recoveryCount <= MAX_RECOVERY) {
        const msg = recoveryMessages[Math.min(recoveryCount - 1, recoveryMessages.length - 1)];
        console.log(`  [第三层] 注入恢复消息: "${msg}"`);
        currentPrompt = msg;
      } else {
        console.log(`  [第三层] 恢复次数已达上限，返回不完整结果`);
        stopped = true;
        stopReason = '截断恢复失败';
        break;
      }
    } else if (finishReason === 'stop') {
      console.log(`  正常完成!`);
      stopped = true;
      stopReason = '任务完成';
    }

  } catch (e) {
    console.log(`  错误: ${e.message}`);
    stopped = true;
    stopReason = `错误: ${e.message}`;
  }

  console.log();
}

// ============================================================================
// 执行总结
// ============================================================================
console.log('='.repeat(60));
console.log('Agent Loop 执行总结');
console.log('='.repeat(60));
console.log();
console.log(`  总轮次: ${turn} / ${MAX_TURNS}`);
console.log(`  停止原因: ${stopReason}`);
console.log(`  Token 消耗: 输入 ${totalInput}, 输出 ${totalOutput}, 总计 ${totalInput + totalOutput}`);
console.log(`  Token 预算: ${TOKEN_BUDGET} (${((totalInput + totalOutput) / TOKEN_BUDGET * 100).toFixed(1)}%)`);
console.log(`  恢复次数: ${recoveryCount}`);
console.log();

// 显示三层防御的状态
console.log('三层防御状态:');
console.log(`  第一层 (死循环检测):`);

let maxRepeat = 0;
let repeatTool = '';
for (const [fp, entry] of callHistory.entries()) {
  if (entry.count > maxRepeat) {
    maxRepeat = entry.count;
    repeatTool = fp.split(':')[0];
  }
}
console.log(`    最多重复调用: ${repeatTool} (${maxRepeat} 次)`);
if (maxRepeat >= WARNING_THRESHOLD) {
  console.log(`    状态: 已触发警告`);
} else {
  console.log(`    状态: 正常`);
}

console.log(`  第二层 (Token 预算):`);
const totalUsedFinal = totalInput + totalOutput;
console.log(`    已用: ${totalUsedFinal} / ${TOKEN_BUDGET} (${(totalUsedFinal / TOKEN_BUDGET * 100).toFixed(1)}%)`);
console.log(`    递减回报: ${lowStreak} 次低输出`);
console.log(`    状态: ${totalUsedFinal >= TOKEN_BUDGET ? '超预算' : lowStreak >= 2 ? '递减回报' : '正常'}`);

console.log(`  第三层 (截断恢复):`);
console.log(`    恢复次数: ${recoveryCount} / ${MAX_RECOVERY}`);
console.log(`    状态: ${recoveryCount >= MAX_RECOVERY ? '恢复失败' : recoveryCount > 0 ? '已恢复' : '未触发'}`);

console.log();
console.log('核心代码结构:');
console.log('  const MAX_TURNS = 20;');
console.log('  const TOKEN_BUDGET = 15_000;');
console.log('  let turn = 0, totalOutput = 0, lowStreak = 0;');
console.log('  const callHistory = new Map();');
console.log();
console.log('  for (turn = 1; turn <= MAX_TURNS; turn++) {');
console.log('    // 1. 调用模型，获取响应');
console.log('    // 2. 执行工具调用，检查死循环检测 (第一层)');
console.log('    // 3. 检查 Token 预算 + nudge (第二层)');
console.log('    // 4. 检查截断恢复 (第三层)');
console.log('    // 5. 如果 finishReason === "stop"，结束');
console.log('  }');
