import { useMemo } from 'react';
import { Tabs, Empty } from 'antd';
import {
  CodeOutlined,
  ReadOutlined,
  ApartmentOutlined,
  DesktopOutlined,
  BorderOutlined,
} from '@ant-design/icons';
import type { FullCaseData } from '@/lib/types';
import CodeTab from '../tabs/CodeTab';
import ExcalidrawTab from '../tabs/ExcalidrawTab';
import KnowledgeTab from '../tabs/KnowledgeTab';
import DiagramTab from '../tabs/DiagramTab';
import InteractiveTab from '../tabs/InteractiveTab';

interface ContentAreaProps {
  selectedCase: FullCaseData | null;
  selectedFile: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onSelectFile: (path: string, name: string) => void;
  overviewScene: Record<string, unknown> | null;
  getFileSource: (filePath: string) => string | null;
  libData: Record<string, string>;
}

const TAB_DEFS = [
  { id: 'knowledge', label: '知识点', icon: <ReadOutlined /> },
  { id: 'excalidraw', label: '全景图', icon: <BorderOutlined /> },
  { id: 'diagram', label: '流程图', icon: <ApartmentOutlined /> },
  { id: 'interactive', label: '交互演示', icon: <DesktopOutlined /> },
  { id: 'code', label: '代码', icon: <CodeOutlined /> },
];

const OVERVIEW_CASE_ID = '__overview__';

export default function ContentArea({
  selectedCase,
  selectedFile,
  activeTab,
  onTabChange,
  onSelectFile,
  overviewScene,
  getFileSource,
  libData,
}: ContentAreaProps) {
  const isOverview = selectedCase?.id === OVERVIEW_CASE_ID;

  const visibleTabs = useMemo(() => {
    if (!selectedCase) return [];
    if (isOverview) {
      return TAB_DEFS.filter((t) => t.id === 'excalidraw');
    }
    const content = selectedCase.content;
    return TAB_DEFS.filter((t) => {
      if (t.id === 'code') return true;
      if (t.id === 'knowledge') return content.knowledge || content.mindmap;
      if (t.id === 'diagram') return content.diagram;
      if (t.id === 'interactive') return content.interactive;
      if (t.id === 'excalidraw') return content.excalidraw;
      return false;
    });
  }, [selectedCase, isOverview]);

  if (!selectedCase) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e1e1e' }}>
        <Empty
          image={<ReadOutlined style={{ fontSize: 48, color: '#333' }} />}
          description={<span style={{ color: '#666', fontSize: 13 }}>从左侧选择一个知识点开始学习</span>}
        />
      </div>
    );
  }

  const tabItems = visibleTabs.map((tab) => ({
    key: tab.id,
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {tab.icon}
        {tab.label}
      </span>
    ),
    children: (
      <div style={{ height: 'calc(100vh - 40px - 46px)', overflow: 'hidden', position: 'relative' }}>
        {tab.id === 'code' && selectedFile && (
          <CodeTab selectedCase={selectedCase} selectedFile={selectedFile} onSelectFile={onSelectFile} getFileSource={getFileSource} libData={libData} />
        )}
        {tab.id === 'excalidraw' && (
          <ExcalidrawTab sceneData={isOverview ? overviewScene : selectedCase.excalidrawScene} />
        )}
        {tab.id === 'knowledge' && !isOverview && (
          <KnowledgeTab knowledgeMd={selectedCase.knowledgeMd} mindmapMd={selectedCase.mindmapMd} />
        )}
        {tab.id === 'diagram' && !isOverview && (
          <DiagramTab diagramMmd={selectedCase.diagramMmd} diagramHtml={selectedCase.diagramHtml} />
        )}
        {tab.id === 'interactive' && !isOverview && (
          <InteractiveTab caseId={selectedCase.id} interactiveHtml={selectedCase.interactiveHtml} />
        )}
      </div>
    ),
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1e1e1e' }}>
      <Tabs
        activeKey={activeTab}
        onChange={onTabChange}
        items={tabItems}
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        tabBarStyle={{ margin: 0, padding: '0 12px', background: '#252526', borderBottom: '1px solid #333', minHeight: 38 }}
      />
    </div>
  );
}
