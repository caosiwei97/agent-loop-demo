/**
 * @title 并发安全判断
 * @group 流式响应
 * @description 演示哪些工具可以并发执行（读），哪些必须串行（写）
 */

import { allTools } from '../lib/mock-tools.mjs';

console.log('=== Case 04: 并发安全判断 ===\n');

// ---- 第一部分：安全分类表 ----

console.log('--- 工具安全分类 ---\n');

const classification = [
  { tool: 'Read 文件',  safety: '天然安全', concurrent: '可并发' },
  { tool: 'Glob/Grep',  safety: '只读操作', concurrent: '可并发' },
  { tool: 'Edit 文件',  safety: '修改状态', concurrent: '必须串行' },
  { tool: 'Write 文件', safety: '修改状态', concurrent: '必须串行' },
  { tool: 'Bash 命令',  safety: '看具体命令', concurrent: '需要判断' },
];

console.log('  工具        | 安全性      | 并发策略');
console.log('  -----------|------------|----------');
classification.forEach(c => {
  console.log(`  ${c.tool.padEnd(11)}| ${c.safety.padEnd(11)}| ${c.concurrent}`);
});

// ---- 第二部分：并发读 vs 串行写的计时对比 ----

console.log('\n--- 并发读 vs 串行写 计时对比 ---\n');

// 模拟工具执行（带延迟）
async function mockRead(label, delayMs) {
  const start = Date.now();
  await new Promise(r => setTimeout(r, delayMs));
  return { label, duration: Date.now() - start };
}

async function mockWrite(label, delayMs) {
  const start = Date.now();
  await new Promise(r => setTimeout(r, delayMs));
  return { label, duration: Date.now() - start };
}

async function demo() {
  // 并发读：3 个 read_file 同时执行
  console.log('[场景1] 3 个 read_file 并发执行:');
  const readStart = Date.now();
  const readResults = await Promise.allSettled([
    mockRead('read_file(src/utils.ts)', 100),
    mockRead('read_file(src/index.ts)', 150),
    mockRead('read_file(package.json)', 80),
  ]);
  const readTotal = Date.now() - readStart;
  readResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`  ${r.value.label} 完成 (${r.value.duration}ms)`);
    }
  });
  console.log(`  并发读总耗时: ${readTotal}ms (最慢的那个决定总时间)`);

  // 串行写：2 个 write_file 必须一个接一个
  console.log('\n[场景2] 2 个 write_file 串行执行:');
  const writeStart = Date.now();
  const w1 = await mockWrite('write_file(config.json)', 100);
  console.log(`  ${w1.label} 完成 (${w1.duration}ms)`);
  const w2 = await mockWrite('write_file(data.json)', 120);
  console.log(`  ${w2.label} 完成 (${w2.duration}ms)`);
  const writeTotal = Date.now() - writeStart;
  console.log(`  串行写总耗时: ${writeTotal}ms (所有时间之和)`);

  console.log(`\n  对比: 并发读 ${readTotal}ms vs 串行写 ${writeTotal}ms`);

  // ---- 第三部分：Bash 错误级联 ----
  console.log('\n--- Bash 错误级联规则 ---\n');
  console.log('[规则] Bash 失败时:');
  console.log('  - 同组的其他 Bash 命令 -> 取消执行');
  console.log('  - Read/Grep 类工具 -> 不受影响，继续执行');
  console.log('');

  // 模拟场景：混合 Bash + Read
  console.log('[模拟] 混合工具调用:');
  console.log('  run_bash("npm run build")  -> 失败!');
  console.log('  run_bash("npm run test")   -> 取消 (同类 Bash，兄弟命令)');
  console.log('  read_file("src/index.ts")  -> 照常执行 (Read 类不受影响)');

  // ---- 第四部分：实际工具执行演示 ----
  console.log('\n--- 实际 Mock 工具执行 ---\n');

  // 并发调用真实的 mock 工具
  const t1 = Date.now();
  const [r1, r2, r3] = await Promise.all([
    allTools.read_file.execute({ path: 'src/utils.ts' }),
    allTools.read_file.execute({ path: 'src/index.ts' }),
    allTools.grep_files.execute({ pattern: 'import' }),
  ]);
  const t2 = Date.now();

  console.log(`read_file("src/utils.ts"): ${String(r1).substring(0, 40)}...`);
  console.log(`read_file("src/index.ts"): ${String(r2).substring(0, 40)}...`);
  console.log(`grep_files("import"):     ${String(r3).substring(0, 40)}...`);
  console.log(`并发执行耗时: ${t2 - t1}ms`);

  console.log('\n--- 要点总结 ---');
  console.log('1. Read/Grep 是只读操作，天然安全，可以并发');
  console.log('2. Write/Edit 修改状态，必须串行执行，避免竞态');
  console.log('3. Bash 命令需要看具体命令判断安全性');
  console.log('4. Bash 失败会级联取消兄弟 Bash，但不影响 Read 类工具');
  console.log('5. 正确的并发策略 = 更快的响应 + 更安全的结果');
}

demo().catch(console.error);
