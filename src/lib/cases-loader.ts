import fs from 'node:fs';
import path from 'node:path';

const EXCLUDED_DIRS = new Set(['lib', 'content', 'source', 'assets', 'apps', 'node_modules', 'dist', '.git']);

function resolveCasesDir(): string {
  const candidates = [
    path.resolve(import.meta.dirname, '../../cases'),
    path.resolve(process.cwd(), 'cases'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error('Could not find cases/ directory');
}

function parseMetadata(indexSource: string, fallbackId: string) {
  const title = indexSource.match(/@title\s+(.+)/)?.[1]?.trim() || fallbackId;
  const group = indexSource.match(/@group\s+(.+)/)?.[1]?.trim() || '未分组';
  const description = indexSource.match(/@description\s+(.+)/)?.[1]?.trim() || '';
  return { title, group, description };
}

export async function casesLoader() {
  const casesDir = resolveCasesDir();
  const projectRoot = path.dirname(casesDir);
  const sourceAssetsDir = path.join(projectRoot, 'source', 'assets');

  const entries = fs.readdirSync(casesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && !EXCLUDED_DIRS.has(d.name));

  const groupOrder: string[] = [];
  const groupCounters: Record<string, number> = {};
  const results: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    const caseDir = path.join(casesDir, entry.name);
    const files = fs.readdirSync(caseDir).filter(f => !f.startsWith('_'));
    const indexPath = path.join(caseDir, 'index.mjs');

    if (!fs.existsSync(indexPath)) continue;

    const indexSource = fs.readFileSync(indexPath, 'utf-8');
    const { title, group, description } = parseMetadata(indexSource, entry.name);

    if (!groupOrder.includes(group)) groupOrder.push(group);
    groupCounters[group] = (groupCounters[group] || 0) + 1;
    const section = `${groupOrder.indexOf(group) + 1}.${groupCounters[group]}`;

    const hasFile = (name: string) => files.includes(name);
    const readFile = (name: string) => fs.readFileSync(path.join(caseDir, name), 'utf-8');

    let excalidrawScene: Record<string, unknown> | null = null;
    if (hasFile('overview.excalidraw')) {
      try { excalidrawScene = JSON.parse(readFile('overview.excalidraw')); } catch {}
    } else if (group === '运行时安全') {
      const fallback = path.join(sourceAssetsDir, 'section-3-fuses.excalidraw');
      if (fs.existsSync(fallback)) {
        try { excalidrawScene = JSON.parse(fs.readFileSync(fallback, 'utf-8')); } catch {}
      }
    }

    results.push({
      id: entry.name,
      title,
      group,
      description,
      section,
      files,
      content: {
        knowledge: hasFile('knowledge.md'),
        diagram: hasFile('diagram.mmd'),
        interactive: hasFile('interactive.html'),
        mindmap: hasFile('mindmap.md'),
        excalidraw: !!excalidrawScene,
      },
      indexSource,
      knowledgeMd: hasFile('knowledge.md') ? readFile('knowledge.md') : null,
      diagramMmd: hasFile('diagram.mmd') ? readFile('diagram.mmd') : null,
      mindmapMd: hasFile('mindmap.md') ? readFile('mindmap.md') : null,
      interactiveHtml: hasFile('interactive.html') ? readFile('interactive.html') : null,
      excalidrawScene,
    });
  }

  return results;
}

export async function libLoader() {
  const casesDir = resolveCasesDir();
  const libDir = path.join(casesDir, 'lib');

  if (!fs.existsSync(libDir)) return [];

  const files = fs.readdirSync(libDir).filter(f => f.endsWith('.mjs') || f.endsWith('.js'));
  return files.map(file => ({
    id: file,
    name: file,
    source: fs.readFileSync(path.join(libDir, file), 'utf-8'),
  }));
}

export async function overviewLoader() {
  const casesDir = resolveCasesDir();
  const projectRoot = path.dirname(casesDir);
  const candidates = [
    path.join(projectRoot, 'source', 'assets', 'overview.excalidraw'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return [{ id: 'overview', ...data }];
      } catch {}
    }
  }
  return [];
}
