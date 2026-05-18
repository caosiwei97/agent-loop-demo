import { BookOutlined, RightOutlined } from '@ant-design/icons';

interface TopBarProps {
  selectedCase: { title: string } | null;
  isOverview: boolean;
}

export default function TopBar({ selectedCase, isOverview }: TopBarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', width: '100%' }}>
      {isOverview ? (
        <>
          <span style={{ color: '#888' }}>Agent Loop 教学演示</span>
          <RightOutlined style={{ fontSize: 8, color: '#666' }} />
          <span style={{ color: '#e0e0e0', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <BookOutlined style={{ fontSize: 12, color: '#4ec9b0' }} />
            文章总览
          </span>
        </>
      ) : selectedCase ? (
        <>
          <span style={{ color: '#888' }}>Agent Loop 教学演示</span>
          <RightOutlined style={{ fontSize: 8, color: '#666' }} />
          <span style={{ color: '#e0e0e0', fontWeight: 500 }}>{selectedCase.title}</span>
        </>
      ) : (
        <span style={{ color: '#888' }}>Agent Loop 教学演示</span>
      )}
    </div>
  );
}
