/**
 * Agent Teaching Demo - Hono Server
 * 
 * 提供案例列表、源码查看、在线执行等功能
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Root of the monorepo (two levels up from apps/server/)
const rootDir = join(__dirname, '../..');
const app = new Hono();
const PORT = 38888;

// ============================================================================
// CORS — allow Next.js dev server on port 3000
// ============================================================================
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
});

// ============================================================================
// Vendor routes - 本地 npm 包静态服务
// ============================================================================
app.get('/vendor/marked.js', (c) => {
  const content = readFileSync(join(__dirname, 'node_modules/marked/lib/marked.umd.js'));
  return c.body(content, 200, { 'Content-Type': 'application/javascript' });
});
app.get('/vendor/mermaid.js', (c) => {
  const content = readFileSync(join(__dirname, 'node_modules/mermaid/dist/mermaid.min.js'));
  return c.body(content, 200, { 'Content-Type': 'application/javascript' });
});
app.get('/vendor/d3.js', (c) => {
  const content = readFileSync(join(__dirname, 'node_modules/d3/dist/d3.min.js'));
  return c.body(content, 200, { 'Content-Type': 'application/javascript' });
});
app.get('/vendor/markmap-view.js', (c) => {
  const content = readFileSync(join(__dirname, 'node_modules/markmap-view/dist/browser/index.js'));
  return c.body(content, 200, { 'Content-Type': 'application/javascript' });
});
app.get('/vendor/markmap-lib.js', (c) => {
  const content = readFileSync(join(__dirname, 'node_modules/markmap-lib/dist/browser/index.iife.js'));
  return c.body(content, 200, { 'Content-Type': 'application/javascript' });
});

// ============================================================================
// 安全工具函数
// ============================================================================

/**
 * 检查路径是否在允许的目录内，防止路径穿越攻击
 */
function isPathSafe(requestedPath, allowedBase) {
  const resolved = normalize(join(allowedBase, requestedPath));
  return resolved.startsWith(normalize(allowedBase));
}

// ============================================================================
// GET /api/cases - 返回案例列表
// ============================================================================
app.get('/api/cases', (c) => {
  try {
    const casesDir = join(rootDir, 'cases');
    const entries = readdirSync(casesDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'lib')
      .map(d => d.name)
      .sort();

    // 先收集所有案例的元数据
    const cases = entries.map(caseId => {
      const caseDir = join(casesDir, caseId);
      const indexPath = join(caseDir, 'index.mjs');

      // 解析 JSDoc 元数据
      let title = caseId;
      let group = '未分组';
      let description = '';

      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath, 'utf-8');
        title = (content.match(/@title\s+(.+)/) || [])[1]?.trim() || caseId;
        group = (content.match(/@group\s+(.+)/) || [])[1]?.trim() || '未分组';
        description = (content.match(/@description\s+(.+)/) || [])[1]?.trim() || '';
      }

      // 列出目录中所有文件（排除 _ 开头的临时文件）
      const files = readdirSync(caseDir)
        .filter(f => !f.startsWith('_'))
        .sort();

      // 检测内容文件是否存在
      const hasOwnExcalidraw = existsSync(join(caseDir, 'overview.excalidraw'));
      const content = {
        knowledge: existsSync(join(caseDir, 'knowledge.md')),
        diagram: existsSync(join(caseDir, 'diagram.mmd')),
        interactive: existsSync(join(caseDir, 'interactive.html')),
        mindmap: existsSync(join(caseDir, 'mindmap.md')),
        excalidraw: hasOwnExcalidraw,
      };

      return {
        id: caseId,
        title,
        group,
        description,
        entryFile: 'index.mjs',
        files,
        content,
      };
    });

    // 计算分组编号
    const groupOrder = ['流式响应', '容错机制', '运行时安全'];
    const groupCounters = {};
    for (const c of cases) {
      const groupIndex = groupOrder.indexOf(c.group);
      const groupNum = groupIndex >= 0 ? groupIndex + 1 : 0;
      groupCounters[c.group] = (groupCounters[c.group] || 0) + 1;
      const subNum = groupCounters[c.group];
      c.section = groupNum > 0 ? `${groupNum}.${subNum}` : '';
    }

    return c.json(cases);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ============================================================================
// GET /api/excalidraw/* - 返回 excalidraw 场景文件
// ============================================================================
app.get('/api/excalidraw/overview', (c) => {
  const filepath = join(rootDir, 'source', 'assets', 'overview.excalidraw');
  if (!existsSync(filepath)) return c.json({ error: 'not found' }, 404);
  try {
    return c.json(JSON.parse(readFileSync(filepath, 'utf-8')));
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/excalidraw/cases/:caseId', (c) => {
  const caseId = c.req.param('caseId');
  const caseDir = join(rootDir, 'cases', caseId);
  let filepath = join(caseDir, 'overview.excalidraw');

  // Fallback to section-level diagram if case doesn't have its own
  if (!existsSync(filepath)) {
    const indexContent = existsSync(join(caseDir, 'index.mjs')) ? readFileSync(join(caseDir, 'index.mjs'), 'utf-8') : '';
    const group = (indexContent.match(/@group\s+(.+)/) || [])[1]?.trim() || '';
    if (group === '运行时安全') {
      filepath = join(rootDir, 'source', 'assets', 'section-3-fuses.excalidraw');
    }
  }

  if (!existsSync(filepath)) return c.json({ error: 'not found' }, 404);
  try {
    return c.json(JSON.parse(readFileSync(filepath, 'utf-8')));
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/excalidraw/section/:name', (c) => {
  const name = c.req.param('name');
  const filepath = join(rootDir, 'source', 'assets', name + '.excalidraw');
  if (!existsSync(filepath)) return c.json({ error: 'not found' }, 404);
  try {
    return c.json(JSON.parse(readFileSync(filepath, 'utf-8')));
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ============================================================================
// GET /api/file/cases/:caseId/:file - 返回案例源码
// GET /api/file/lib/:file - 返回共享库源码
// ============================================================================
app.get('/api/file/cases/:caseId/:file', (c) => {
  const caseId = c.req.param('caseId');
  const file = c.req.param('file');
  const casesDir = join(rootDir, 'cases');
  const filepath = join(casesDir, caseId, file);

  if (!isPathSafe(join(caseId, file), casesDir)) {
    return c.json({ error: '禁止访问' }, 403);
  }

  if (!existsSync(filepath)) {
    return c.json({ error: '文件不存在' }, 404);
  }

  try {
    const content = readFileSync(filepath, 'utf-8');
    return c.text(content);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/file/lib/:file', (c) => {
  const file = c.req.param('file');
  const libDir = join(rootDir, 'cases', 'lib');
  const filepath = join(libDir, file);

  if (!isPathSafe(file, libDir)) {
    return c.json({ error: '禁止访问' }, 403);
  }

  if (!existsSync(filepath)) {
    return c.json({ error: '文件不存在' }, 404);
  }

  try {
    const content = readFileSync(filepath, 'utf-8');
    return c.text(content);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ============================================================================
// POST /api/run - 执行案例代码并流式输出
// ============================================================================
app.post('/api/run', async (c) => {
  const body = await c.req.json();
  const { caseId, code } = body;

  if (!caseId) {
    return c.json({ error: '缺少 caseId' }, 400);
  }

  return streamSSE(c, async (stream) => {
    // 跟踪最后一次输出时间，用于判断执行是否完成
    let lastOutputAt = Date.now();

    const send = (type, data) => {
      lastOutputAt = Date.now();
      stream.writeSSE({ data: JSON.stringify({ type, data }) });
    };

    // 劫持 console 方法，将输出推送到 SSE
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;

    console.log = (...args) => {
      send('stdout', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
    };
    console.error = (...args) => {
      send('stderr', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
    };
    console.warn = (...args) => {
      send('stdout', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
    };

    // 用子进程执行案例代码，避免 import() 触发 --watch 重启
    // 同时把相对路径的 import 重写为绝对路径，保证子进程能正确解析模块
    const caseDir = join(rootDir, 'cases', caseId);
    const libDir = join(rootDir, 'cases', 'lib');
    let codeToRun = code || readFileSync(join(caseDir, 'index.mjs'), 'utf-8');

    // 重写相对路径: '../lib/xxx.mjs' → 绝对路径
    codeToRun = codeToRun.replace(
      /from\s+['"](\.\.\/lib\/[^'"]+)['"]/g,
      (_, p) => `from 'file://${join(libDir, p.replace('../lib/', ''))}'`
    );
    codeToRun = codeToRun.replace(
      /from\s+['"](\.\/[^'"]+)['"]/g,
      (_, p) => `from 'file://${join(caseDir, p.replace('./', ''))}'`
    );

    try {
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, ['--input-type=module', '-e', codeToRun], {
        cwd: caseDir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk) => {
        send('stdout', chunk.toString());
      });
      child.stderr.on('data', (chunk) => {
        send('stderr', chunk.toString());
      });

      // 等待子进程退出（超时 60 秒）
      const exitPromise = new Promise((resolve) => {
        child.on('close', (code) => resolve(code ?? 0));
      });
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => { child.kill(); resolve(1); }, 60000);
      });
      const exitCode = await Promise.race([exitPromise, timeoutPromise]);

      // 等待 300ms 让最后一批 stdout/stderr 事件发送完毕
      await new Promise(r => setTimeout(r, 300));
      send('exit', JSON.stringify({ code: exitCode }));
    } catch (err) {
      send('stderr', err.message + '\n');
      if (err.stack) send('stderr', err.stack + '\n');
      send('exit', JSON.stringify({ code: 1 }));
    }

    // 恢复 console
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  });
});

// ============================================================================
// 启动服务器
// ============================================================================
// 防止未捕获异常导致进程崩溃
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Agent Teaching Demo -> http://localhost:${PORT}`));
