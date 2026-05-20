/**
 * @title 死循环检测：哈希指纹
 * @group 运行时安全
 * @description 演示如何用 SHA256 哈希指纹检测重复的工具调用
 */

import { createHash } from 'node:crypto';

// ============================================================================
// 哈希指纹检测 — 死循环检测的基础
//
// Agent Loop 中，模型可能反复调用同一个工具、传同一个参数。
// 我们需要一种高效的方式来判断"这次调用和之前某次调用是否完全相同"。
//
// 方法：把工具名 + 参数序列化为字符串，然后算 SHA256 哈希的前 12 位。
// 这样可以 O(1) 比较两次调用是否相同，而不需要存储完整的参数。
// ============================================================================

console.log('='.repeat(60));
console.log('案例 08: 死循环检测 -- 哈希指纹');
console.log('='.repeat(60));
console.log();

// --- 指纹函数（来自教学材料） ---

/**
 * 计算工具调用的哈希指纹
 *
 * 关键设计：
 * 1. Object.keys(params).sort() 保证键的顺序不影响结果
 * 2. 只取 SHA256 前 12 位（足够区分，又不会太长）
 */
function fingerprint(name, params) {
  // 稳定序列化：先对 key 排序，再 JSON.stringify
  const stable = JSON.stringify(params, Object.keys(params || {}).sort());
  return createHash('sha256').update(name + stable).digest('hex').slice(0, 12);
}

/**
 * 计算结果的哈希指纹（用于检测"无进展轮询"）
 */
function resultFingerprint(result) {
  const str = JSON.stringify(result);
  return createHash('sha256').update(str).digest('hex').slice(0, 12);
}

// ============================================================================
// 演示 1: 相同工具 + 相同参数 -> 相同指纹
// ============================================================================
console.log('=== 演示 1: 基本指纹计算 ===');
console.log();

const fp1 = fingerprint('read_file', { path: 'src/index.ts' });
console.log(`指纹计算：fingerprint("read_file", {path: "src/index.ts"})`);
console.log(`  参数序列化: ${JSON.stringify({ path: 'src/index.ts' })}`);
console.log(`  SHA256 哈希: ${fp1}`);
console.log();

const fp2 = fingerprint('read_file', { path: 'src/index.ts' });
console.log(`再次调用:   fingerprint("read_file", {path: "src/index.ts"})`);
console.log(`  SHA256 哈希: ${fp2}`);
console.log(`  比较: ${fp1} === ${fp2} -> ${fp1 === fp2 ? '相同' : '不同'}`);
console.log();

// ============================================================================
// 演示 2: 相同工具 + 不同参数 -> 不同指纹
// ============================================================================
console.log('=== 演示 2: 不同参数产生不同指纹 ===');
console.log();

const fp3 = fingerprint('read_file', { path: 'src/utils.ts' });
console.log(`fingerprint("read_file", {path: "src/utils.ts"})  -> ${fp3}`);
console.log(`fingerprint("read_file", {path: "src/index.ts"})  -> ${fp1}`);
console.log(`  比较: ${fp3} === ${fp1} -> ${fp3 === fp1 ? '相同' : '不同'}`);
console.log();

// ============================================================================
// 演示 3: 稳定序列化问题 — 键的顺序不影响
// ============================================================================
console.log('=== 演示 3: 稳定序列化 -- 键的顺序不影响 ===');
console.log();

// JavaScript 中，{a:1, b:2} 和 {b:2, a:1} 在逻辑上等价
// 但 JSON.stringify 可能产生不同的字符串
const obj1 = { a: 1, b: 2 };
const obj2 = { b: 2, a: 1 };

// 直接 JSON.stringify（不稳定！）
const s1 = JSON.stringify(obj1);
const s2 = JSON.stringify(obj2);
console.log(`  直接 JSON.stringify:`);
console.log(`    {a:1, b:2} -> ${s1}`);
console.log(`    {b:2, a:1} -> ${s2}`);
console.log(`    相同? ${s1 === s2}`);
console.log();

// 用排序键的 replacer（稳定！）
const stable1 = JSON.stringify(obj1, Object.keys(obj1).sort());
const stable2 = JSON.stringify(obj2, Object.keys(obj2).sort());
console.log(`  排序键后 JSON.stringify:`);
console.log(`    {a:1, b:2} -> ${stable1}`);
console.log(`    {b:2, a:1} -> ${stable1}`);
console.log(`    相同? ${stable1 === stable2}`);
console.log();

// 指纹函数自动处理排序
const fp4 = fingerprint('tool', { a: 1, b: 2 });
const fp5 = fingerprint('tool', { b: 2, a: 1 });
console.log(`  指纹对比:`);
console.log(`    fingerprint("tool", {a:1, b:2}) -> ${fp4}`);
console.log(`    fingerprint("tool", {b:2, a:1}) -> ${fp5}`);
console.log(`    相同? ${fp4 === fp5}`);
console.log();

// ============================================================================
// 演示 4: 模拟死循环检测场景
// ============================================================================
console.log('=== 演示 4: 实际检测场景 ===');
console.log();
console.log('场景: Agent 重复调用同一个工具，检查是否陷入死循环');
console.log();

// 模拟一系列工具调用（含结果）
const toolCalls = [
  { name: 'read_file', params: { path: 'src/index.ts' }, result: '文件内容（首次读取）' },
  { name: 'read_file', params: { path: 'src/index.ts' }, result: '文件内容（相同）' },  // 死循环！
  { name: 'read_file', params: { path: 'src/index.ts' }, result: '文件内容（相同）' },  // 死循环！
  { name: 'read_file', params: { path: 'src/utils.ts' }, result: '不同文件的内容' },    // 正常
  { name: 'grep_files', params: { pattern: 'console.log' }, result: '找到 3 处匹配' },
  { name: 'grep_files', params: { pattern: 'console.log' }, result: '找到 3 处匹配' },  // 死循环！
];

// 跟踪调用历史
const callHistory = new Map();

for (const [i, call] of toolCalls.entries()) {
  const fp = fingerprint(call.name, call.params);
  const rfp = resultFingerprint(call.result);

  console.log(`调用 ${i + 1}: ${call.name}(${JSON.stringify(call.params)})`);
  console.log(`  调用指纹: ${fp}, 结果指纹: ${rfp}`);

  // 查找历史中是否有相同指纹的调用
  const key = `${call.name}:${fp}`;
  if (callHistory.has(key)) {
    const prev = callHistory.get(key);
    if (prev.resultFp === rfp) {
      console.log(`  [!] 相同调用 + 相同结果 = 无进展! (之前在调用 ${prev.index + 1} 出现过)`);
    } else {
      console.log(`  [=] 相同调用 + 不同结果 = 有进展 (可能是轮询)`);
    }
  } else {
    console.log(`  [+] 首次出现`);
  }

  // 记录到历史
  callHistory.set(key, { index: i, resultFp: rfp });
  console.log();
}

// ============================================================================
// 总结
// ============================================================================
console.log('='.repeat(60));
console.log('总结: 哈希指纹检测');
console.log('='.repeat(60));
console.log();
console.log('比喻:');
console.log('  "刷新快递物流 10 次，每次都是运输中下一站郑州 -- 无进展"');
console.log('  "如果每次得到不同的进展信息 -- 正常跟进"');
console.log();
console.log('关键设计:');
console.log('  1. fingerprint(工具名, 参数) = SHA256 前 12 位');
console.log('  2. 必须用 Object.keys().sort() 保证稳定序列化');
console.log('  3. 调用指纹相同 + 结果指纹相同 = 无进展 = 死循环');
console.log('  4. 调用指纹相同 + 结果指纹不同 = 有进展 = 合法轮询');
console.log();
console.log('效率:');
console.log('  - 指纹只有 12 个字符，可以高效存储和比较');
console.log('  - 滑动窗口只保留最近 30 次调用的指纹');
console.log('  - O(1) 查找，不会随着历史增长而变慢');
