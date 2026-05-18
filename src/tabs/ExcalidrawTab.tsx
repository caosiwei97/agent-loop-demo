import { lazy, Suspense, useCallback, useRef } from 'react';
import { Spin } from 'antd';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';

const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((mod) => ({ default: mod.Excalidraw })),
);

interface ExcalidrawTabProps {
  sceneData: Record<string, unknown> | null;
}

export default function ExcalidrawTab({ sceneData }: ExcalidrawTabProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI>(null);

  const handleAPIReady = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    requestAnimationFrame(() => {
      api.scrollToContent(undefined, { fitToContent: true, animate: true });
    });
  }, []);

  if (!sceneData) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#666',
          fontSize: 13,
          background: '#1e1e1e',
        }}
      >
        暂无画板内容
      </div>
    );
  }

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Suspense
        fallback={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              background: '#1e1e1e',
            }}
          >
            <Spin />
          </div>
        }
      >
        <Excalidraw
          initialData={{ ...sceneData, scrollToContent: true } as any}
          viewModeEnabled={false}
          theme="dark"
          langCode="zh-CN"
          gridModeEnabled={false}
          excalidrawAPI={handleAPIReady}
        />
      </Suspense>
    </div>
  );
}
