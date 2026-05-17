/**
 * Mock 工具集
 *
 * 为教学案例提供模拟的工具定义，包括文件操作、搜索、天气查询等。
 * 所有工具都是纯函数，不涉及真实 I/O。
 */

import { tool } from 'ai';
import { z } from 'zod';

// --- 模拟文件系统 ---
const mockFileSystem = {
  'src/utils.ts': `import moment from 'moment';

export function formatDate(date: Date): string {
  return moment(date).format('YYYY-MM-DD');
}

export function debounce(fn: Function, ms: number): Function {
  let timer: any;
  return (...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
`,
  'src/index.ts': `import { formatDate } from './utils';

console.log(formatDate(new Date()));
`,
  'package.json': `{
  "name": "demo-project",
  "dependencies": {
    "moment": "^2.29.0"
  }
}`,
  'src/components/Button.tsx': `import React from 'react';

export function Button({ label, onClick }) {
  return <button onClick={onClick}>{label}</button>;
}
`,
};

// --- 工具定义 ---

export const getWeather = tool({
  description: '查询指定城市的天气信息',
  parameters: z.object({
    city: z.string().describe('城市名称，如"北京"、"上海"'),
  }),
  execute: async ({ city }) => {
    const mockWeather = {
      '北京': '晴，15-25°C，东南风 2 级',
      '上海': '多云，18-22°C，西南风 3 级',
      '深圳': '阵雨，22-28°C，南风 2 级',
    };
    return mockWeather[city] || `${city}：暂无天气数据`;
  },
});

export const calculator = tool({
  description: '计算数学表达式的结果',
  parameters: z.object({
    expression: z.string().describe('数学表达式，如 "2 + 3 * 4"'),
  }),
  execute: async ({ expression }) => {
    try {
      const result = new Function(`return ${expression}`)();
      return `${expression} = ${result}`;
    } catch {
      return `无法计算: ${expression}`;
    }
  },
});

export const readFile = tool({
  description: '读取文件内容',
  parameters: z.object({
    path: z.string().describe('文件路径'),
  }),
  execute: async ({ path }) => {
    const content = mockFileSystem[path];
    if (content) return content;
    return `错误：文件 ${path} 不存在`;
  },
});

export const writeFile = tool({
  description: '写入文件内容',
  parameters: z.object({
    path: z.string().describe('文件路径'),
    content: z.string().describe('文件内容'),
  }),
  execute: async ({ path, content }) => {
    mockFileSystem[path] = content;
    return `已成功写入 ${path} (${content.length} 字符)`;
  },
});

export const grepFiles = tool({
  description: '在文件中搜索文本',
  parameters: z.object({
    pattern: z.string().describe('搜索的正则表达式模式'),
    path: z.string().optional().describe('限定搜索路径'),
  }),
  execute: async ({ pattern }) => {
    const results = [];
    const regex = new RegExp(pattern, 'g');
    for (const [file, content] of Object.entries(mockFileSystem)) {
      const matches = content.match(regex);
      if (matches) {
        results.push(`${file}: 找到 ${matches.length} 处匹配`);
      }
    }
    return results.length > 0
      ? results.join('\n')
      : `未找到匹配 "${pattern}" 的内容`;
  },
});

export const runBash = tool({
  description: '执行 Bash 命令',
  parameters: z.object({
    command: z.string().describe('要执行的 shell 命令'),
  }),
  execute: async ({ command }) => {
    // 模拟几个常用命令
    if (command.includes('ls') || command.includes('find')) {
      return Object.keys(mockFileSystem).join('\n');
    }
    if (command.includes('mkdir')) {
      return `目录已创建`;
    }
    if (command.includes('npm install') || command.includes('pnpm install')) {
      return `added 88 packages in 2s`;
    }
    return `(mock) 命令执行完成: ${command}`;
  },
});

// 工具集合（方便整体导入）
export const allTools = {
  get_weather: getWeather,
  calculator,
  read_file: readFile,
  write_file: writeFile,
  grep_files: grepFiles,
  run_bash: runBash,
};
