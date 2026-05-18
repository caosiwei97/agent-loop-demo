import { useState, useEffect, useCallback, useMemo } from 'react';
import { Layout } from 'antd';
import type { CaseData } from './api';
import { fetchCases } from './api';
import TopBar from './components/TopBar';
import KnowledgeTree from './components/KnowledgeTree';
import ContentArea from './components/ContentArea';

const { Header, Sider, Content } = Layout;

const OVERVIEW_CASE_ID = '__overview__';

export default function App() {
  const [cases, setCases] = useState<CaseData[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseData | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('knowledge');

  const overviewCase = useMemo<CaseData>(() => ({
    id: OVERVIEW_CASE_ID,
    title: '文章总览',
    group: '',
    section: '',
    description: '',
    entryFile: '',
    files: [],
    content: { knowledge: false, diagram: false, interactive: false, mindmap: false, excalidraw: true },
  }), []);

  useEffect(() => {
    fetchCases().then(setCases).catch(() => {});
  }, []);

  const handleSelectOverview = useCallback(() => {
    setSelectedCase(overviewCase);
    setSelectedFile(null);
    setActiveTab('excalidraw');
  }, [overviewCase]);

  const handleSelectCase = useCallback(
    (caseId: string) => {
      const c = cases.find((x) => x.id === caseId);
      if (!c) return;
      setSelectedCase(c);
      setSelectedFile(`cases/${c.id}/${c.entryFile}`);
      const defaultTab = c.content?.excalidraw ? 'excalidraw' : 'knowledge';
      setActiveTab(defaultTab);
    },
    [cases],
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
    <Layout style={{ height: '100vh', background: '#1e1e1e' }}>
      <Header style={{ height: 40, lineHeight: '40px', padding: '0 16px', background: '#252526', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center' }}>
        <TopBar selectedCase={selectedCase} isOverview={isOverview} />
      </Header>
      <Layout style={{ flex: 1, overflow: 'hidden' }}>
        <Sider width={300} style={{ background: '#252526', borderRight: '1px solid #333', overflow: 'hidden' }}>
          <KnowledgeTree
            cases={cases}
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
          />
        </Content>
      </Layout>
    </Layout>
  );
}
