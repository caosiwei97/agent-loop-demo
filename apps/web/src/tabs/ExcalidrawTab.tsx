import { lazy, Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { Spin } from 'antd';
import { fetchExcalidraw } from '../api';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';

const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((mod) => ({ default: mod.Excalidraw })),
);

interface ExcalidrawTabProps {
  caseId: string;
}

const OVERVIEW_CASE_ID = '__overview__';

export default function ExcalidrawTab({ caseId }: ExcalidrawTabProps) {
  const [initialData, setInitialData] = useState<
    (Awaited<ReturnType<typeof fetchExcalidraw>>) | null
  >(null);
  const [error, setError] = useState(false);
  const isOverview = caseId === OVERVIEW_CASE_ID;
  const apiRef = useRef<ExcalidrawImperativeAPI>(null);

  useEffect(() => {
    let cancelled = false;
    setInitialData(null);
    setError(false);
    const fetchType = isOverview ? 'overview' : 'case';
    const fetchArg = isOverview ? undefined : caseId;
    fetchExcalidraw(fetchType, fetchArg)
      .then((data) => {
        if (!cancelled) setInitialData(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, isOverview]);

  const handleAPIReady = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    requestAnimationFrame(() => {
      api.scrollToContent(undefined, { fitToContent: true, animate: true });
    });
  }, []);

  if (error) {
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

  if (!initialData) {
    return (
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
          initialData={{ ...initialData, scrollToContent: true }}
          viewModeEnabled={isOverview}
          theme="dark"
          langCode="zh-CN"
          gridModeEnabled={false}
          excalidrawAPI={handleAPIReady}
        />
      </Suspense>
    </div>
  );
}
