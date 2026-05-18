import { useState, useRef, useCallback } from 'react';
import { WebContainer } from '@webcontainer/api';
import type { FileSystemTree, WebContainerProcess } from '@webcontainer/api';

export interface ConsoleLine {
  text: string;
  type: 'stdout' | 'stderr' | 'info' | 'exit-ok' | 'exit-err';
}

export interface UseWebContainerReturn {
  booting: boolean;
  running: boolean;
  consoleLines: ConsoleLine[];
  runCase: (caseSource: string, caseId: string, libFiles: Record<string, string>) => Promise<void>;
  clearConsole: () => void;
  error: string | null;
}

// Module-level singleton so the WebContainer persists across re-renders
let wcInstance: WebContainer | null = null;
let wcBooting: Promise<WebContainer> | null = null;

function buildPackageJson(): string {
  return JSON.stringify(
    {
      name: 'case-runner',
      type: 'module',
      dependencies: {
        ai: '^4.1.0',
        zod: '^3.23.0',
      },
    },
    null,
    2,
  );
}

function buildFileTree(
  caseSource: string,
  caseId: string,
  libFiles: Record<string, string>,
): FileSystemTree {
  const libTree: FileSystemTree = {};
  for (const [name, contents] of Object.entries(libFiles)) {
    libTree[name] = { file: { contents } };
  }

  return {
    'package.json': { file: { contents: buildPackageJson() } },
    lib: { directory: libTree },
    cases: {
      directory: {
        lib: { directory: libTree },
        [caseId]: {
          directory: {
            'index.mjs': { file: { contents: caseSource } },
          },
        },
      },
    },
  };
}

async function getOrCreateContainer(): Promise<WebContainer> {
  if (wcInstance) return wcInstance;
  if (wcBooting) return wcBooting;

  wcBooting = WebContainer.boot().then((instance) => {
    wcInstance = instance;
    wcBooting = null;
    return instance;
  });

  return wcBooting;
}

export function useWebContainer(): UseWebContainerReturn {
  const [booting, setBooting] = useState(false);
  const [running, setRunning] = useState(false);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const currentProcessRef = useRef<WebContainerProcess | null>(null);
  const abortRef = useRef(false);

  const addLine = useCallback((text: string, type: ConsoleLine['type']) => {
    setConsoleLines((prev) => [...prev, { text, type }]);
  }, []);

  const clearConsole = useCallback(() => {
    setConsoleLines([]);
    setError(null);
  }, []);

  const pipeOutput = useCallback(
    (process: WebContainerProcess) => {
      const reader = process.output.getReader();
      const pump = () => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) return;
            if (value) {
              const lines = value.split('\n');
              for (const line of lines) {
                if (line) {
                  addLine(line, 'stdout');
                }
              }
            }
            pump();
          })
          .catch(() => {
          });
      };
      pump();
    },
    [addLine],
  );

  const runCase = useCallback(
    async (caseSource: string, caseId: string, libFiles: Record<string, string>) => {
      if (currentProcessRef.current) {
        try {
          currentProcessRef.current.kill();
        } catch {
          // ignore
        }
        currentProcessRef.current = null;
      }

      abortRef.current = false;
      setError(null);
      setConsoleLines([]);
      setRunning(true);

      try {
        if (!wcInstance) {
          setBooting(true);
          addLine('启动 WebContainer...', 'info');
          try {
            await getOrCreateContainer();
          } catch (bootErr: any) {
            addLine(`WebContainer 启动失败: ${bootErr?.message ?? bootErr}`, 'stderr');
            setError(bootErr?.message ?? 'Boot failed');
            setBooting(false);
            setRunning(false);
            return;
          }
          setBooting(false);
        }

        if (abortRef.current) return;

        const wc = wcInstance!;

        addLine('写入文件...', 'info');

        try { await wc.spawn('rm', ['-rf', 'cases', 'lib']).then(p => p.exit); } catch { /* ignore */ }

        const tree = buildFileTree(caseSource, caseId, libFiles);
        await wc.mount(tree);

        if (abortRef.current) return;

        addLine('安装依赖 (npm install)...', 'info');
        const installProcess = await wc.spawn('npm', ['install'], { cwd: '/' });
        currentProcessRef.current = installProcess;
        pipeOutput(installProcess);

        const installExit = await installProcess.exit;
        if (abortRef.current) return;

        if (installExit !== 0) {
          addLine(`npm install 失败 (退出码: ${installExit})`, 'exit-err');
          setRunning(false);
          currentProcessRef.current = null;
          return;
        }

        addLine('依赖安装完成', 'exit-ok');

        if (abortRef.current) return;

        addLine(`运行 node cases/${caseId}/index.mjs ...`, 'info');
        const runProcess = await wc.spawn('node', [`cases/${caseId}/index.mjs`], { cwd: '/' });
        currentProcessRef.current = runProcess;
        pipeOutput(runProcess);

        const runExit = await runProcess.exit;
        if (!abortRef.current) {
          if (runExit === 0) {
            addLine(`进程结束 (退出码: 0)`, 'exit-ok');
          } else {
            addLine(`进程异常退出 (退出码: ${runExit})`, 'exit-err');
          }
        }
      } catch (err: any) {
        if (!abortRef.current) {
          addLine(`执行错误: ${err?.message ?? err}`, 'stderr');
          setError(err?.message ?? 'Unknown error');
        }
      } finally {
        currentProcessRef.current = null;
        setRunning(false);
      }
    },
    [addLine, pipeOutput],
  );

  return { booting, running, consoleLines, runCase, clearConsole, error };
}
