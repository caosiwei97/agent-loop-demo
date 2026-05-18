import { lazy, Suspense } from 'react';

const Case06Heartbeat = lazy(() => import('../demos/Case06Heartbeat'));
const Case07Degradation = lazy(() => import('../demos/Case07Degradation'));
const Case10TokenBudget = lazy(() => import('../demos/Case10TokenBudget'));
const Case11Truncation = lazy(() => import('../demos/Case11Truncation'));
const Case12AgentLoop = lazy(() => import('../demos/Case12AgentLoop'));

const REACT_DEMOS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  '06-heartbeat-watchdog': Case06Heartbeat,
  '07-three-layer-degradation': Case07Degradation,
  '10-token-budget': Case10TokenBudget,
  '11-truncation-recovery': Case11Truncation,
  '12-agent-loop-skeleton': Case12AgentLoop,
};

function LoadingFallback() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#555', fontSize: 13, background: '#1a1a1a',
    }}>
      加载交互演示...
    </div>
  );
}

interface InteractiveTabProps {
  caseId: string;
  interactiveHtml: string | null;
}

export default function InteractiveTab({ caseId, interactiveHtml }: InteractiveTabProps) {
  const DemoComponent = REACT_DEMOS[caseId];

  if (DemoComponent) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#1a1a1a' }}>
        <Suspense fallback={<LoadingFallback />}>
          <DemoComponent />
        </Suspense>
      </div>
    );
  }

  if (!interactiveHtml) {
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#555', fontSize: 13, background: '#1a1a1a',
      }}>
        暂无交互演示内容
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#1a1a1a' }}>
      <iframe
        sandbox="allow-scripts allow-same-origin"
        srcDoc={interactiveHtml}
        style={{ width: '100%', height: '100%', border: 'none', background: '#1a1a1a' }}
        title="Interactive Demo"
      />
    </div>
  );
}
