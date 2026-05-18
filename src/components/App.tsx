import { useState, useCallback, useMemo } from 'react';
import { Layout, ConfigProvider, theme } from 'antd';
import type { CaseListItem, FullCaseData } from '@/lib/types';
import TopBar from './TopBar';
import KnowledgeTree from './KnowledgeTree';
import ContentArea from './ContentArea';

const { Header, Sider, Content } = Layout;

const OVERVIEW_CASE_ID = '__overview__';

interface AppProps {
  caseList: CaseListItem[];
  caseData: Record<string, FullCaseData>;
  libData: Record<string, string>;
  overviewScene: Record<string, unknown> | null;
}

export default function App({ caseList, caseData, libData, overviewScene }: AppProps) {
  const [selectedCase, setSelectedCase] = useState<FullCaseData | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('knowledge');

  const overviewCase = useMemo<FullCaseData>(() => ({
    id: OVERVIEW_CASE_ID,
    title: '文章总览',
    group: '',
    section: '',
    description: '',
    files: [],
    content: { knowledge: false, diagram: false, interactive: false, mindmap: false, excalidraw: true },
    indexSource: '',
    knowledgeMd: null,
    diagramMmd: null,
    mindmapMd: null,
    interactiveHtml: null,
    excalidrawScene: overviewScene,
  }), [overviewScene]);

  const getFileSource = useCallback((path: string): string | null => {
    if (path.startsWith('cases/')) {
      const rest = path.slice('cases/'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) return null;
      const caseId = rest.slice(0, slashIdx);
      const file = rest.slice(slashIdx + 1);
      const cd = caseData[caseId];
      if (!cd) return null;
      if (file === 'index.mjs') return cd.indexSource;
      return null;
    }
    if (path.startsWith('lib/')) {
      const name = path.slice('lib/'.length);
      return libData[name] ?? null;
    }
    return null;
  }, [caseData, libData]);

  const handleSelectOverview = useCallback(() => {
    setSelectedCase(overviewCase);
    setSelectedFile(null);
    setActiveTab('excalidraw');
  }, [overviewCase]);

  const handleSelectCase = useCallback(
    (caseId: string) => {
      const c = caseData[caseId];
      if (!c) return;
      setSelectedCase(c);
      setSelectedFile(`cases/${c.id}/index.mjs`);
      const defaultTab = c.content?.excalidraw ? 'excalidraw' : 'knowledge';
      setActiveTab(defaultTab);
    },
    [caseData],
  );

  const handleSelectFile = useCallback(
    (path: string, _name: string) => {
      setActiveTab('code');
      setSelectedFile(path);
    },
    [],
  );

  const isOverview = selectedCase?.id === OVERVIEW_CASE_ID;

  return (
    <ConfigProvider theme={{
      algorithm: theme.darkAlgorithm,
      token: {
        colorBgContainer: '#252526',
        colorBgElevated: '#2d2d2d',
        colorBgLayout: '#1e1e1e',
        colorText: '#cccccc',
        colorTextSecondary: '#999999',
        colorPrimary: '#4ec9b0',
        colorBorderSecondary: '#333333',
        borderRadius: 4,
      },
      components: {
        Tree: {
          colorBgContainer: '#252526',
          directoryNodeSelectedBg: 'rgba(78, 201, 176, 0.12)',
          directoryNodeSelectedColor: '#fff',
          nodeSelectedBg: 'rgba(78, 201, 176, 0.12)',
          nodeSelectedColor: '#fff',
          nodeHoverBg: 'rgba(255, 255, 255, 0.06)',
          colorText: '#ccc',
        },
        Tabs: {
          colorBgContainer: '#252526',
          colorText: '#999',
          itemSelectedColor: '#fff',
          itemHoverColor: '#ddd',
          inkBarColor: '#4ec9b0',
          horizontalItemBorderRadius: 0,
        },
        Layout: {
          headerBg: '#252526',
          siderBg: '#252526',
          bodyBg: '#1e1e1e',
        },
      },
    }}>
    <Layout style={{ height: '100vh', background: '#1e1e1e' }}>
      <Header style={{ height: 40, lineHeight: '40px', padding: '0 16px', background: '#252526', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center' }}>
        <TopBar selectedCase={selectedCase} isOverview={isOverview} />
      </Header>
      <Layout style={{ flex: 1, overflow: 'hidden' }}>
        <Sider width={300} style={{ background: '#252526', borderRight: '1px solid #333', overflow: 'hidden' }}>
          <KnowledgeTree
            cases={caseList}
            selectedCaseId={selectedCase?.id ?? null}
            isOverview={isOverview}
            onSelectCase={handleSelectCase}
            onSelectOverview={handleSelectOverview}
          />
        </Sider>
        <Content style={{ overflow: 'hidden', background: '#1e1e1e' }}>
          <ContentArea
            selectedCase={selectedCase}
            selectedFile={selectedFile}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onSelectFile={handleSelectFile}
            overviewScene={overviewScene}
            getFileSource={getFileSource}
            libData={libData}
          />
        </Content>
      </Layout>
      </Layout>
    </ConfigProvider>
  );
}
