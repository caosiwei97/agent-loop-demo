import { useEffect, useState, useRef, useCallback } from 'react';
import { Spin, Button } from 'antd';
import {
  FullscreenOutlined,
  FullscreenExitOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import mermaid from 'mermaid';

interface DiagramTabProps {
  diagramMmd: string | null;
}

let mermaidInitialized = false;
let mermaidCounter = 0;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    themeVariables: {
      primaryColor: '#4ec9b0',
      primaryTextColor: '#e0e0e0',
      lineColor: '#888',
      background: '#1e1e1e',
      mainBkg: '#2d2d2d',
      nodeBorder: '#4ec9b0',
      nodeTextColor: '#e0e0e0',
      clusterBkg: '#252526',
      titleColor: '#e0e0e0',
      edgeLabelBackground: '#2d2d2d',
    },
  });
  mermaidInitialized = true;
}

export default function DiagramTab({ diagramMmd }: DiagramTabProps) {
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const applyTransform = useCallback(() => {
    const { scale, tx, ty } = transformRef.current;
    if (contentRef.current) {
      contentRef.current.style.transform = `scale(${scale}) translate(${tx}px, ${ty}px)`;
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    transformRef.current.scale = Math.min(5, Math.max(0.1, transformRef.current.scale + delta));
    applyTransform();
  }, [applyTransform]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    if (containerRef.current) {
      containerRef.current.style.cursor = 'grabbing';
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    transformRef.current.tx += dx / transformRef.current.scale;
    transformRef.current.ty += dy / transformRef.current.scale;
    applyTransform();
  }, [applyTransform]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    if (containerRef.current) {
      containerRef.current.style.cursor = 'grab';
    }
  }, []);

  const handleZoomIn = useCallback(() => {
    transformRef.current.scale = Math.min(5, transformRef.current.scale + 0.2);
    applyTransform();
  }, [applyTransform]);

  const handleZoomOut = useCallback(() => {
    transformRef.current.scale = Math.max(0.1, transformRef.current.scale - 0.2);
    applyTransform();
  }, [applyTransform]);

  const handleReset = useCallback(() => {
    transformRef.current = { scale: 1, tx: 0, ty: 0 };
    applyTransform();
  }, [applyTransform]);

  const handleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (diagramMmd === null) {
      setError(true);
      return;
    }
    let cancelled = false;
    const code = diagramMmd;

    async function render() {
      try {
        ensureMermaidInit();
        if (cancelled) return;

        mermaidCounter++;
        const svgId = `mermaid-svg-${mermaidCounter}-${Date.now()}`;
        let result;
        try {
          const { svg } = await mermaid.render(svgId, code.trim());
          result = svg;
        } catch (renderErr) {
          const errorEl = document.getElementById('d' + svgId);
          if (errorEl) errorEl.remove();
          throw renderErr;
        }
        const wrapperEl = document.getElementById('d' + svgId);
        if (wrapperEl) wrapperEl.remove();
        if (cancelled) return;

        setSvgHtml(result);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    render();
    return () => { cancelled = true; };
  }, [diagramMmd]);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  if (error) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13, overflow: 'auto' }}>
        暂无流程图内容
      </div>
    );
  }

  if (svgHtml === null) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e1e1e', overflow: 'auto' }}>
        <Spin />
      </div>
    );
  }

  const toolbarStyle: React.CSSProperties = {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    display: 'flex',
    gap: 4,
    background: 'rgba(30, 30, 30, 0.9)',
    border: '1px solid #333',
    borderRadius: 6,
    padding: '4px 6px',
  };

  const btnStyle: React.CSSProperties = {
    color: '#ccc',
    borderColor: '#444',
    background: 'transparent',
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: '#1e1e1e',
        cursor: 'grab',
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div style={toolbarStyle}>
        <Button
          size="small"
          icon={<ZoomOutOutlined />}
          style={btnStyle}
          onClick={handleZoomOut}
        />
        <Button
          size="small"
          icon={<ZoomInOutlined />}
          style={btnStyle}
          onClick={handleZoomIn}
        />
        <Button
          size="small"
          icon={<ReloadOutlined />}
          style={btnStyle}
          onClick={handleReset}
        />
        <Button
          size="small"
          icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          style={btnStyle}
          onClick={handleFullscreen}
        />
      </div>
      <div
        ref={contentRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: 200,
          transformOrigin: 'center center',
          transition: 'transform 0.05s linear',
        }}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
    </div>
  );
}
