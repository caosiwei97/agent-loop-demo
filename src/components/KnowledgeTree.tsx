import { useMemo } from 'react';
import { Tree } from 'antd';
import { BookOutlined, FolderOutlined, FileTextOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { CaseListItem } from '@/lib/types';

interface KnowledgeTreeProps {
  cases: CaseListItem[];
  selectedCaseId: string | null;
  isOverview: boolean;
  onSelectCase: (caseId: string) => void;
  onSelectOverview: () => void;
}

function numToChinese(n: number): string {
  const chars = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return n <= 10 ? chars[n] : String(n);
}

export default function KnowledgeTree({
  cases,
  selectedCaseId,
  isOverview,
  onSelectCase,
  onSelectOverview,
}: KnowledgeTreeProps) {
  const treeData = useMemo(() => {
    const groups: Record<string, CaseListItem[]> = {};
    const order: string[] = [];
    for (const c of cases) {
      if (!groups[c.group]) {
        groups[c.group] = [];
        order.push(c.group);
      }
      groups[c.group].push(c);
    }

    const overviewNode: DataNode = {
      key: '__overview__',
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          文章总览
        </span>
      ),
      icon: <BookOutlined style={{ fontSize: 14, color: '#4ec9b0' }} />,
    };

    const groupNodes: DataNode[] = order.map((g, gi) => ({
      key: `__group__${g}`,
      title: (
        <span style={{ fontSize: 12, color: '#999', fontWeight: 600 }}>
          {numToChinese(gi + 1)}、{g}
        </span>
      ),
      icon: <FolderOutlined style={{ fontSize: 14, color: '#888' }} />,
      children: groups[g].map((c) => ({
        key: c.id,
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{
              fontSize: 10,
              color: '#555',
              fontWeight: 600,
              minWidth: 24,
              padding: '1px 4px',
              borderRadius: 3,
              background: 'rgba(255,255,255,0.04)',
              textAlign: 'center',
              lineHeight: '16px',
              flexShrink: 0,
            }}>
              {c.section}
            </span>
            <span style={{ fontSize: 13, color: '#bbb' }}>{c.title}</span>
          </span>
        ),
        icon: <FileTextOutlined style={{ fontSize: 14, color: '#666' }} />,
        isLeaf: true,
      })),
    }));

    return [overviewNode, ...groupNodes];
  }, [cases]);

  const selectedKeys = isOverview ? ['__overview__'] : selectedCaseId ? [selectedCaseId] : [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none' }}>
      <div style={{
        height: 35,
        minHeight: 35,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        fontSize: 11,
        fontWeight: 600,
        color: '#aaa',
        letterSpacing: '0.05em',
        borderBottom: '1px solid #333',
        background: '#2d2d2d',
        flexShrink: 0,
        textTransform: 'uppercase',
      }}>
        知识树
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        <Tree
          showIcon
          treeData={treeData}
          selectedKeys={selectedKeys}
          defaultExpandAll
          onSelect={(keys) => {
            const key = keys[0] as string | undefined;
            if (!key) return;
            if (key === '__overview__') {
              onSelectOverview();
            } else if (!key.startsWith('__group__')) {
              onSelectCase(key);
            }
          }}
          style={{ background: 'transparent', color: '#ccc', fontSize: 13 }}
        />
      </div>
    </div>
  );
}
