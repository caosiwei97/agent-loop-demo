import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from 'antd';
import {
  FullscreenOutlined,
  FullscreenExitOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
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

interface MindmapTabProps {
  caseId: string;
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

// Vite injects a global AMD `define` function that confuses d3's UMD wrapper
// into using the AMD branch instead of setting window.d3.
// We evaluate d3 with define/exports/module shadowed so the UMD falls through
// to the global branch and sets globalThis.d3.
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
    .then(() => {
      markmapLoaded = true;
    });

  return markmapLoadPromise;
}

const MARKMAP_COLORS = [
  '#4fc3f7',
  '#81c784',
  '#ffd54f',
  '#ff8a65',
  '#ba68c8',
  '#4dd0e1',
];

export default function MindmapTab({ caseId }: MindmapTabProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const applyTransform = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { scale, tx, ty } = transformRef.current;
    svg.style.transform = `scale(${scale}) translate(${tx}px, ${ty}px)`;
    svg.style.transformOrigin = '0 0';
  }, []);

  const clampScale = (s: number) => Math.min(5, Math.max(0.1, s));

  const handleZoomIn = useCallback(() => {
    transformRef.current.scale = clampScale(transformRef.current.scale + 0.2);
    applyTransform();
  }, [applyTransform]);

  const handleZoomOut = useCallback(() => {
    transformRef.current.scale = clampScale(transformRef.current.scale - 0.2);
    applyTransform();
  }, [applyTransform]);

  const handleReset = useCallback(() => {
    transformRef.current = { scale: 1, tx: 0, ty: 0 };
    applyTransform();
  }, [applyTransform]);

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      transformRef.current.scale = clampScale(transformRef.current.scale + delta);
      applyTransform();
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [applyTransform]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      if (draggingRef.current) {
        draggingRef.current = false;
        container.style.cursor = 'grab';
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [applyTransform]);

  useEffect(() => {
    let cancelled = false;

    transformRef.current = { scale: 1, tx: 0, ty: 0 };
    applyTransform();
    setLoading(true);
    setError(false);

    loadMarkmap()
      .then(() => {
        if (cancelled) return;
        return fetchFile(`cases/${caseId}/mindmap.md`);
      })
      .then((md) => {
        if (cancelled || !md || !svgRef.current) return;

        const markmap = window.markmap;
        if (!markmap) {
          setError(true);
          return;
        }

        const transformer = new markmap.Transformer();
        const result = transformer.transform(md);

        markmap.Markmap.create(svgRef.current, {
          color: (node: unknown) => {
            const n = node as { state?: { depth?: number } };
            const depth = n.state?.depth ?? 0;
            return MARKMAP_COLORS[depth % MARKMAP_COLORS.length];
          },
          paddingX: 16,
          autoFit: true,
          duration: 300,
        }, result.root);

        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => { cancelled = true; };
  }, [caseId, applyTransform]);

  if (error) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13, overflow: 'hidden' }}>
        暂无思维导图内容
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#1a1a2e', cursor: 'grab' }}
    >
      <svg
        ref={svgRef}
        key={`mindmap-${caseId}`}
        style={{ width: '100%', height: '100%', overflow: 'hidden', transformOrigin: '0 0' }}
      />

      {/* toolbar */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          zIndex: 10,
        }}
      >
        <Button
          size="small"
          icon={<ZoomInOutlined />}
          onClick={handleZoomIn}
          style={toolbarButtonStyle}
        />
        <Button
          size="small"
          icon={<ZoomOutOutlined />}
          onClick={handleZoomOut}
          style={toolbarButtonStyle}
        />
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={handleReset}
          style={toolbarButtonStyle}
        />
        <Button
          size="small"
          icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onClick={handleFullscreen}
          style={toolbarButtonStyle}
        />
      </div>

      {loading && (
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
