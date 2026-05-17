import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { Spin } from 'antd';
import { fetchFile } from '../api';

interface KnowledgeTabProps {
  caseId: string;
}

export default function KnowledgeTab({ caseId }: KnowledgeTabProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const md = await fetchFile(`cases/${caseId}/knowledge.md`);
        if (cancelled) return;
        setHtml(marked.parse(md) as string);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [caseId]);

  if (error) {
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
      <div
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
