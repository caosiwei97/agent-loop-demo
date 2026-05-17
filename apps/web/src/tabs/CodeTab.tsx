import { useEffect, useRef, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Tree, Button, Spin } from 'antd';
import {
  PlayCircleOutlined,
  FolderOutlined,
  FileOutlined,
  LeftOutlined,
  RightOutlined,
  LockOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { CaseData, ConsoleLine } from '../api';
import { fetchFile, runCase } from '../api';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CodeTabProps {
  selectedCase: CaseData | null;
  selectedFile: string | null;
  onSelectFile: (path: string, name: string) => void;
}

const LIB_FILES = [
  'mock-model.mjs',
  'mock-tools.mjs',
  'utils.mjs',
  'retry.mjs',
  'loop-detection.mjs',
];

export default function CodeTab({ selectedCase, selectedFile, onSelectFile }: CodeTabProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<any>(null);
  const consoleBodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [code, setCode] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [consoleHeight, setConsoleHeight] = useState(200);
  const [resizing, setResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(0);
  const [editorReady, setEditorReady] = useState(false);
  const [showExplorer, setShowExplorer] = useState(true);

  const toggleExplorer = useCallback(() => {
    setShowExplorer((prev) => {
      const next = !prev;
      setTimeout(() => {
        if (monacoEditorRef.current) monacoEditorRef.current.layout();
      }, 0);
      return next;
    });
  }, []);

  const fileTreeData: DataNode[] = selectedCase
    ? [
        {
          key: '__lib__',
          title: 'lib/',
          icon: <FolderOutlined style={{ fontSize: 14, color: '#888' }} />,
          children: LIB_FILES.map((name) => ({
            key: `lib/${name}`,
            title: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{
                  fontSize: 9,
                  color: '#dcdcaa',
                  padding: '0 3px',
                  borderRadius: 2,
                  background: 'rgba(220,220,170,0.1)',
                  fontWeight: 600,
                  lineHeight: '14px',
                  flexShrink: 0,
                }}>JS</span>
                <span style={{ color: '#888' }}>{name}</span>
                <LockOutlined style={{ fontSize: 9, color: '#444', marginLeft: 2, flexShrink: 0 }} />
              </span>
            ),
            icon: <FileOutlined style={{ fontSize: 14, color: '#666' }} />,
            isLeaf: true,
          })),
        },
        {
          key: `__case__${selectedCase.id}`,
          title: `cases/${selectedCase.id}/`,
          icon: <FolderOutlined style={{ fontSize: 14, color: '#888' }} />,
          children: (selectedCase.files || [selectedCase.entryFile])
            .filter((fname) => fname.endsWith('.mjs') || fname.endsWith('.js'))
            .map((fname) => {
              const isEntry = fname === selectedCase.entryFile;
              return {
                key: `cases/${selectedCase.id}/${fname}`,
                title: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isEntry ? (
                      <CaretRightOutlined style={{ fontSize: 9, color: '#6a9955', flexShrink: 0 }} />
                    ) : (
                      <span style={{
                        fontSize: 9,
                        color: '#dcdcaa',
                        padding: '0 3px',
                        borderRadius: 2,
                        background: 'rgba(220,220,170,0.1)',
                        fontWeight: 600,
                        lineHeight: '14px',
                        flexShrink: 0,
                      }}>JS</span>
                    )}
                    <span>{fname}</span>
                    {isEntry && (
                      <span style={{
                        fontSize: 9,
                        padding: '0 5px',
                        borderRadius: 3,
                        background: 'rgba(78,201,176,0.12)',
                        color: '#4ec9b0',
                        fontWeight: 600,
                        lineHeight: '14px',
                      }}>
                        entry
                      </span>
                    )}
                  </span>
                ),
                icon: <FileOutlined style={{ fontSize: 14, color: isEntry ? '#6a9955' : '#666' }} />,
                isLeaf: true,
              };
            }),
        },
      ]
    : [];

  useEffect(() => {
    let cancelled = false;
    function initMonaco(monaco: any) {
      if (cancelled || !editorRef.current) return;
      monacoEditorRef.current = monaco.editor.create(editorRef.current, {
        value: '',
        language: 'javascript',
        theme: 'vs-dark',
        fontSize: 13,
        lineNumbers: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        padding: { top: 8, bottom: 8 },
        renderLineHighlight: 'line',
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        wordWrap: 'on',
        readOnly: true,
      });
      setEditorReady(true);
    }

    if (!(window as any).monacoLoading) {
      (window as any).monacoLoading = true;
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js';
      script.onload = () => {
        (window as any).require.config({
          paths: {
            vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs',
          },
        });
        (window as any).require(['vs/editor/editor.main'], (monaco: any) => {
          (window as any).monacoInstance = monaco;
          initMonaco(monaco);
        });
      };
      document.head.appendChild(script);
    } else {
      const check = setInterval(() => {
        if ((window as any).monacoInstance) {
          clearInterval(check);
          initMonaco((window as any).monacoInstance);
        }
      }, 100);
    }

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedFile || !editorReady) return;
    let cancelled = false;
    fetchFile(selectedFile)
      .then((content) => {
        if (cancelled) return;
        setCode(content);
        if (monacoEditorRef.current) {
          monacoEditorRef.current.setValue(content);
          monacoEditorRef.current.revealLine(1);
        }
      })
      .catch(() => {
        if (cancelled) return;
        const msg = `// 加载文件失败: ${selectedFile}`;
        setCode(msg);
        if (monacoEditorRef.current) {
          monacoEditorRef.current.setValue(msg);
        }
      });
    return () => { cancelled = true; };
  }, [selectedFile, editorReady]);

  useEffect(() => {
    if (autoScroll && consoleBodyRef.current) {
      consoleBodyRef.current.scrollTop = consoleBodyRef.current.scrollHeight;
    }
  }, [consoleLines, autoScroll]);

  const handleRun = useCallback(() => {
    if (isRunning || !selectedCase) return;
    const editorCode = monacoEditorRef.current ? monacoEditorRef.current.getValue() : code;

    setIsRunning(true);
    abortRef.current = new AbortController();

    const headerLine: ConsoleLine = {
      type: 'info',
      text: `=== ${selectedCase.title} ===`,
    };
    setConsoleLines([headerLine]);

    runCase(
      selectedCase.id,
      editorCode,
      (line) => {
        // 使用 flushSync 打破 React 18 自动批处理，实现逐行流式渲染
        flushSync(() => setConsoleLines((prev) => [...prev, line]));
      },
      (exitCode) => {
        const exitLine: ConsoleLine = {
          type: exitCode === 0 ? 'exit-ok' : 'exit-err',
          text: `--- Process exited (code: ${exitCode}) ---`,
        };
        flushSync(() => setConsoleLines((prev) => [...prev, exitLine]));
        setIsRunning(false);
        abortRef.current = null;
      },
      abortRef.current.signal,
    );
  }, [isRunning, selectedCase, code]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      setConsoleLines((prev) => [...prev, { type: 'info', text: '--- 已手动停止 ---' }]);
      setIsRunning(false);
      abortRef.current = null;
    }
  }, []);

  const handleClear = useCallback(() => {
    setConsoleLines([]);
  }, []);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setResizing(true);
      resizeStartY.current = e.clientY;
      resizeStartH.current = consoleHeight;
    },
    [consoleHeight],
  );

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartY.current - e.clientY;
      const newH = Math.max(80, Math.min(500, resizeStartH.current + delta));
      setConsoleHeight(newH);
    };
    const handleMouseUp = () => {
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (monacoEditorRef.current) {
        monacoEditorRef.current.layout();
      }
    };

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      {showExplorer && (
        <div style={{ width: 280, minWidth: 280, borderRight: '1px solid #333', background: '#252526', display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none' }}>
          <div style={{
            height: 32,
            minHeight: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
            background: '#2d2d2d',
            borderBottom: '1px solid #333',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase' }}>资源管理器</span>
            <Button type="text" size="small" onClick={toggleExplorer} style={{ color: '#888', fontSize: 11, padding: '0 4px', height: 20, width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <LeftOutlined style={{ fontSize: 10 }} />
            </Button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
            {!selectedCase ? (
              <div style={{ padding: '12px 16px', fontSize: 12, color: '#666', fontStyle: 'italic' }}>
                请从左侧选择知识点
              </div>
            ) : (
              <Tree
                showIcon
                treeData={fileTreeData}
                selectedKeys={selectedFile ? [selectedFile] : []}
                defaultExpandAll
                onSelect={(keys) => {
                  const key = keys[0] as string | undefined;
                  if (!key || key.startsWith('__')) return;
                  const parts = key.split('/');
                  const name = parts[parts.length - 1];
                  onSelectFile(key, name);
                }}
                style={{ background: 'transparent', color: '#ccc', fontSize: 12 }}
              />
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          height: 32,
          minHeight: 32,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          gap: 8,
          background: '#2d2d2d',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}>
          {!showExplorer && (
            <Button type="text" size="small" onClick={toggleExplorer} style={{ color: '#888', fontSize: 11, border: '1px solid #333', borderRadius: 3, padding: '0 8px', height: 24, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <RightOutlined style={{ fontSize: 10 }} />
              资源管理器
            </Button>
          )}
          {isRunning && (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d2691e', animation: 'pulse 1s infinite' }} />
          )}
          {isRunning ? (
            <Button size="small" danger onClick={handleStop} style={{ fontSize: 12 }}>
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              size="small"
              onClick={handleRun}
              disabled={!selectedCase || isRunning}
              icon={<PlayCircleOutlined />}
              style={{ fontSize: 12 }}
            >
              运行
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#666' }}>{selectedFile || ''}</span>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }} ref={editorRef}>
          {!editorReady && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 13 }}>
              <Spin size="small" style={{ marginRight: 8 }} />
              加载编辑器...
            </div>
          )}
        </div>

        <div style={{ height: consoleHeight, display: 'flex', flexDirection: 'column', flexShrink: 0, borderTop: '1px solid #333', background: '#1a1a1a' }}>
          <div
            onMouseDown={handleResizeMouseDown}
            style={{
              height: 4,
              cursor: 'ns-resize',
              flexShrink: 0,
              transition: 'background 0.15s',
              background: resizing ? '#4ec9b0' : 'transparent',
            }}
            onMouseEnter={(e) => { if (!resizing) (e.target as HTMLDivElement).style.background = '#4ec9b0'; }}
            onMouseLeave={(e) => { if (!resizing) (e.target as HTMLDivElement).style.background = 'transparent'; }}
          />
          <div style={{
            height: 28,
            minHeight: 28,
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            gap: 8,
            background: '#2d2d2d',
            borderBottom: '1px solid #333',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase' }}>输出</span>
            {isRunning && (
              <span style={{ fontSize: 11, color: '#888', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Spin size="small" />
                运行中...
              </span>
            )}
            <div style={{ flex: 1 }} />
            <Button
              type="text"
              size="small"
              onClick={() => setAutoScroll(!autoScroll)}
              style={{ fontSize: 11, color: autoScroll ? '#4ec9b0' : '#888', padding: '0 4px' }}
            >
              {autoScroll ? '自动滚动' : '手动滚动'}
            </Button>
            <Button type="text" size="small" onClick={handleClear} style={{ fontSize: 11, color: '#888', padding: '0 4px' }}>
              清空
            </Button>
          </div>
          <div
            ref={consoleBodyRef}
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '8px 12px',
              fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {consoleLines.length === 0 ? (
              <span style={{ color: '#555', fontStyle: 'italic', fontSize: 12 }}>运行案例以查看输出</span>
            ) : (
              consoleLines.map((line, i) => (
                <span
                  key={i}
                  className={`console-${line.type.replace('exit-', 'exit-')}`}
                  style={{ display: 'block' }}
                >
                  {line.text}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
