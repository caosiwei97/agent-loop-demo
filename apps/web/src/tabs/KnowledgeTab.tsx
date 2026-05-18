import { useEffect, useState, useRef, useCallback } from 'react';
import { Spin, Button } from 'antd';
import {
  ReadOutlined,
  PartitionOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons';
import { marked } from 'marked';
import { fetchFile } from '../api';

declare global {
  interface Window {
    markmap?: {
      Transformer: new () => {
        transform: (md: string) => { root: unknown };
      };
      Markmap: {
        create: (
          el: SVGSVGElement,
          opts: Record<string, unknown>,
          root: unknown,
        ) => unknown;
      };
    };
  }
}

interface KnowledgeTabProps {
  caseId: string;
  hasMindmap?: boolean;
}

let markmapLoaded = false;
let markmapLoadPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

function loadD3(): Promise<void> {
  if ((window as unknown as Record<string, unknown>).d3) return Promise.resolve();
  return fetch('/vendor/d3.js')
    .then((r) => r.text())
    .then((code) => {
      const fn = new Function('define', 'exports', 'module', code);
      fn.call(window, undefined, undefined, undefined);
    });
}

function loadMarkmap(): Promise<void> {
  if (markmapLoaded) return Promise.resolve();
  if (markmapLoadPromise) return markmapLoadPromise;
  markmapLoadPromise = loadD3()
    .then(() => loadScript('/vendor/markmap-lib.js'))
    .then(() => loadScript('/vendor/markmap-view.js'))
    .then(() => { markmapLoaded = true; });
  return markmapLoadPromise;
}

const MARKMAP_COLORS = ['#4fc3f7', '#81c784', '#ffd54f', '#ff8a65', '#ba68c8', '#4dd0e1'];

export default function KnowledgeTab({ caseId, hasMindmap = false }: KnowledgeTabProps) {
  const [mode, setMode] = useState<'markdown' | 'mindmap'>('markdown');
  const [html, setHtml] = useState<string | null>(null);
  const [mdError, setMdError] = useState(false);
  const [mmLoading, setMmLoading] = useState(false);
  const [mmError, setMmError] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Load markdown
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setMdError(false);
    fetchFile(`cases/${caseId}/knowledge.md`)
      .then((md) => {
        if (!cancelled) setHtml(marked.parse(md) as string);
      })
      .catch(() => { if (!cancelled) setMdError(true); });
    return () => { cancelled = true; };
  }, [caseId]);

  // Load mindmap when switching to mindmap mode
  useEffect(() => {
    if (mode !== 'mindmap' || !hasMindmap) return;
    let cancelled = false;
    setMmLoading(true);
    setMmError(false);
    transformRef.current = { scale: 1, tx: 0, ty: 0 };

    loadMarkmap()
      .then(() => {
        if (cancelled) return;
        return fetchFile(`cases/${caseId}/mindmap.md`);
      })
      .then((md) => {
        if (cancelled || !md || !svgRef.current) return;
        const markmap = window.markmap;
        if (!markmap) { setMmError(true); return; }

        svgRef.current.innerHTML = '';
        const transformer = new markmap.Transformer();
        const result = transformer.transform(md);
        markmap.Markmap.create(svgRef.current, {
          color: (node: unknown) => {
            const n = node as { state?: { depth?: number } };
            return MARKMAP_COLORS[(n.state?.depth ?? 0) % MARKMAP_COLORS.length];
          },
          paddingX: 16,
          autoFit: true,
          duration: 300,
        }, result.root);
        setMmLoading(false);
      })
      .catch(() => { if (!cancelled) setMmError(true); });

    return () => { cancelled = true; };
  }, [caseId, mode, hasMindmap]);

  // Mindmap pan/zoom
  const applyTransform = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { scale, tx, ty } = transformRef.current;
    svg.style.transform = `scale(${scale}) translate(${tx}px, ${ty}px)`;
    svg.style.transformOrigin = '0 0';
  }, []);

  const clampScale = (s: number) => Math.min(5, Math.max(0.1, s));

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mode !== 'mindmap') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      transformRef.current.scale = clampScale(transformRef.current.scale + (e.deltaY > 0 ? -0.1 : 0.1));
      applyTransform();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [applyTransform, mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mode !== 'mindmap') return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      draggingRef.current = true;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      container.style.cursor = 'grabbing';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      const s = transformRef.current.scale;
      transformRef.current.tx += dx / s;
      transformRef.current.ty += dy / s;
      applyTransform();
    };
    const onMouseUp = () => {
      if (draggingRef.current) { draggingRef.current = false; container.style.cursor = 'grab'; }
    };
    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [applyTransform, mode]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Toggle button
  const toggleBtn = hasMindmap ? (
    <div style={{
      position: 'absolute', top: 8, right: 12, zIndex: 10,
      display: 'flex', background: '#2d2d2d', borderRadius: 4, border: '1px solid #444',
    }}>
      <button
        onClick={() => setMode('markdown')}
        style={{
          padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: '3px 0 0 3px',
          background: mode === 'markdown' ? '#0e639c' : 'transparent',
          color: mode === 'markdown' ? '#fff' : '#999',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <ReadOutlined /> 知识点
      </button>
      <button
        onClick={() => setMode('mindmap')}
        style={{
          padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: '0 3px 3px 0',
          background: mode === 'mindmap' ? '#0e639c' : 'transparent',
          color: mode === 'mindmap' ? '#fff' : '#999',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <PartitionOutlined /> 思维导图
      </button>
    </div>
  ) : null;

  // Markdown view
  if (mode === 'markdown') {
    if (mdError) {
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
          暂无知识点内容
        </div>
      );
    }
    if (html === null) {
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
          <Spin size="small" style={{ marginRight: 8 }} />
          加载中...
        </div>
      );
    }
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#1e1e1e' }}>
        {toggleBtn}
        <div
          className="markdown-body"
          style={{ paddingTop: hasMindmap ? 40 : 0 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  // Mindmap view
  if (mmError) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
        {toggleBtn}
        暂无思维导图内容
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#1a1a2e', cursor: 'grab' }}
    >
      {toggleBtn}
      <svg
        ref={svgRef}
        key={`mindmap-${caseId}`}
        style={{ width: '100%', height: '100%', overflow: 'hidden', transformOrigin: '0 0' }}
      />

      {/* mindmap toolbar */}
      <div style={{ position: 'absolute', top: 44, right: 12, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 10 }}>
        <Button size="small" icon={<ZoomInOutlined />} onClick={() => { transformRef.current.scale = clampScale(transformRef.current.scale + 0.2); applyTransform(); }} style={toolbarButtonStyle} />
        <Button size="small" icon={<ZoomOutOutlined />} onClick={() => { transformRef.current.scale = clampScale(transformRef.current.scale - 0.2); applyTransform(); }} style={toolbarButtonStyle} />
        <Button size="small" icon={<ReloadOutlined />} onClick={() => { transformRef.current = { scale: 1, tx: 0, ty: 0 }; applyTransform(); }} style={toolbarButtonStyle} />
        <Button size="small" icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={handleFullscreen} style={toolbarButtonStyle} />
      </div>

      {mmLoading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ color: '#666', fontSize: 13 }}>加载中...</span>
        </div>
      )}
    </div>
  );
}

const toolbarButtonStyle: React.CSSProperties = {
  background: 'rgba(26, 26, 46, 0.9)',
  border: '1px solid #3a3a5c',
  color: '#aaa',
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
};
