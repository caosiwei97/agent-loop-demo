import { useEffect, useState } from 'react';
import { fetchFile } from '../api';

interface InteractiveTabProps {
  caseId: string;
}

export default function InteractiveTab({ caseId }: InteractiveTabProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchFile(`cases/${caseId}/interactive.html`)
      .then((content) => {
        if (!cancelled) setHtml(content);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => { cancelled = true; };
  }, [caseId]);

  if (error) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13, background: '#1a1a1a' }}>
        暂无交互演示内容
      </div>
    );
  }

  if (html === null) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13, background: '#1a1a1a' }}>
        加载中...
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#1a1a1a' }}>
      <iframe
        sandbox="allow-scripts allow-same-origin"
        srcDoc={html}
        style={{ width: '100%', height: '100%', border: 'none', background: '#1a1a1a' }}
        title="Interactive Demo"
      />
    </div>
  );
}
