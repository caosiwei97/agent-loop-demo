import { useEffect, useRef, useState, useCallback } from 'react';
import { Tree, Button, Spin } from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  LeftOutlined,
  RightOutlined,
  LockOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { FullCaseData } from '@/lib/types';
import { useWebContainer } from '../hooks/useWebContainer';
import type { ConsoleLine } from '../hooks/useWebContainer';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CodeTabProps {
  selectedCase: FullCaseData | null;
  selectedFile: string | null;
  onSelectFile: (path: string, name: string) => void;
  getFileSource: (filePath: string) => string | null;
  libData: Record<string, string>;
}

const LIB_FILES = [
  'mock-model.mjs',
  'mock-tools.mjs',
  'utils.mjs',
  'retry.mjs',
  'loop-detection.mjs',
];

export default function CodeTab({ selectedCase, selectedFile, onSelectFile, getFileSource, libData }: CodeTabProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<any>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [showExplorer, setShowExplorer] = useState(true);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const { booting, running, consoleLines, runCase, clearConsole } = useWebContainer();

  const toggleExplorer = useCallback(() => {
    setShowExplorer((prev) => {
      const next = !prev;
      setTimeout(() => {
        if (monacoEditorRef.current) monacoEditorRef.current.layout();
      }, 0);
      return next;
    });
  }, []);

  const [showConsole, setShowConsole] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(300);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleRun = useCallback(() => {
    if (!selectedCase || running || booting) return;
    setShowConsole(true);
    runCase(selectedCase.indexSource, selectedCase.id, libData);
  }, [selectedCase, running, booting, runCase, libData]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines]);

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
          children: (selectedCase.files || [])
            .filter((fname) => fname.endsWith('.mjs') || fname.endsWith('.js'))
            .map((fname) => {
              const isEntry = fname === 'index.mjs' || fname === 'index.js';
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
    const content = getFileSource(selectedFile);
    if (content !== null) {
      if (monacoEditorRef.current) {
        monacoEditorRef.current.setValue(content);
        monacoEditorRef.current.revealLine(1);
      }
    } else {
      const msg = `// 加载文件失败: ${selectedFile}`;
      if (monacoEditorRef.current) {
        monacoEditorRef.current.setValue(msg);
      }
    }
  }, [selectedFile, editorReady, getFileSource]);

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
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#666' }}>{selectedFile || ''}</span>
          <Button
            size="small"
            onClick={handleRun}
            disabled={!selectedCase || running || booting}
            style={{
              fontSize: 11,
              height: 24,
              padding: '0 10px',
              borderRadius: 3,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: (running || booting) ? '#2d2d2d' : 'rgba(78,201,176,0.12)',
              color: (running || booting) ? '#666' : '#4ec9b0',
              border: `1px solid ${(running || booting) ? '#333' : 'rgba(78,201,176,0.25)'}`,
            }}
          >
            {(running || booting) ? <LoadingOutlined style={{ fontSize: 11 }} /> : <CaretRightOutlined style={{ fontSize: 11 }} />}
            {booting ? '启动中...' : running ? '运行中...' : '运行'}
          </Button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: showConsole ? '1 1 0' : '1 1 0', overflow: 'hidden', minHeight: 0 }} ref={editorRef}>
            {!editorReady && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 13 }}>
                <Spin size="small" style={{ marginRight: 8 }} />
                加载编辑器...
              </div>
            )}
          </div>

          {showConsole && (
            <div style={{ display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
              <div
                style={{
                  height: 4,
                  cursor: 'ns-resize',
                  background: '#333',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startH = consoleHeight;
                  const onMove = (ev: MouseEvent) => {
                    const delta = startY - ev.clientY;
                    setConsoleHeight(Math.max(120, Math.min(400, startH + delta)));
                  };
                  const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                  };
                  document.body.style.cursor = 'ns-resize';
                  document.body.style.userSelect = 'none';
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
              />
              <div ref={panelRef} style={{ height: consoleHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{
                  height: 28,
                  minHeight: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 8px',
                  background: '#252526',
                  borderBottom: '1px solid #333',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase' }}>控制台</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button type="text" size="small" onClick={clearConsole} style={{ color: '#666', fontSize: 11, padding: '0 4px', height: 20, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <DeleteOutlined style={{ fontSize: 10 }} />
                      清空
                    </Button>
                    <Button type="text" size="small" onClick={() => setShowConsole(false)} style={{ color: '#666', fontSize: 11, padding: '0 4px', height: 20 }}>
                      ✕
                    </Button>
                  </div>
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px', fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace", fontSize: 12, lineHeight: 1.6 }}>
                  {consoleLines.length === 0 && (
                    <div style={{ color: '#555', fontStyle: 'italic' }}>等待运行...</div>
                  )}
                  {consoleLines.map((line: ConsoleLine, idx: number) => (
                    <div key={idx} className={`console-${line.type}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {line.text}
                    </div>
                  ))}
                  <div ref={consoleEndRef} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
