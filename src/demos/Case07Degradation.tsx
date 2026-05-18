import { useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
  Background,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const NODE_W = 140;
const NODE_H = 52;

const COLORS = {
  request: '#4a9eed',
  stream: '#8b5cf6',
  backoff: '#8b5cf6',
  nonstream: '#f59e0b',
  backoff2: '#f59e0b',
  modelswitch: '#ef4444',
  success: '#22c55e',
} as const;

type NodeId = keyof typeof COLORS;

const NODE_DEFS: Array<{
  id: NodeId;
  col: number;
  row: number;
  label: string;
  sub: string;
}> = [
  { id: 'request', col: 0, row: 1, label: '请求', sub: 'API Call' },
  { id: 'stream', col: 1, row: 0, label: '流式请求', sub: 'stream: true' },
  { id: 'backoff', col: 2, row: 0, label: '指数退避', sub: '500ms×2^n' },
  { id: 'nonstream', col: 1, row: 2, label: '非流式请求', sub: 'timeout:120s' },
  { id: 'backoff2', col: 2, row: 2, label: '退避重试', sub: '继承失败预算' },
  { id: 'modelswitch', col: 3, row: 1, label: '模型降级', sub: 'Opus→Sonnet' },
  { id: 'success', col: 4, row: 1, label: '成功', sub: '返回结果' },
];

const NODE_DETAILS: Record<NodeId, string> = {
  request: '发起 API 请求。默认使用流式模式。',
  stream: '通过 SSE 建立长连接。流式需要维持连接池，对服务端压力更大。',
  backoff: '基础退避 500ms，每次翻倍。加随机抖动防止"重试风暴"。最多重试 10 次。优先使用 Retry-After 头。',
  nonstream: '切换为一次性请求-响应。变成短连接，对服务端更友好。超时 120 秒。',
  backoff2: '继承 Layer 1 的失败次数。两层的失败预算是连续的，不是各算各的。',
  modelswitch: '不同模型通常有独立的算力配额。Opus 过载不代表 Sonnet 也过载。只改 model 字段，上下文不需要重建。',
  success: '请求成功返回。可能来自任何一层。',
};

interface EdgeDef {
  from: NodeId;
  to: NodeId;
  label: string;
  loop?: boolean;
}

const EDGE_DEFS: EdgeDef[] = [
  { from: 'request', to: 'stream', label: '' },
  { from: 'stream', to: 'backoff', label: '429/529' },
  { from: 'backoff', to: 'stream', label: '重试', loop: true },
  { from: 'backoff', to: 'success', label: '成功' },
  { from: 'backoff', to: 'nonstream', label: '连续失败' },
  { from: 'nonstream', to: 'backoff2', label: '529' },
  { from: 'backoff2', to: 'nonstream', label: '重试', loop: true },
  { from: 'backoff2', to: 'modelswitch', label: '3次529' },
  { from: 'nonstream', to: 'success', label: '成功' },
  { from: 'modelswitch', to: 'success', label: '' },
];

type LogCls = 'log-l1' | 'log-l2' | 'log-l3' | 'log-ok' | 'log-info';

const LOG_STYLES: Record<LogCls, { bg: string; border: string; color: string }> = {
  'log-l1': { bg: 'rgba(139,92,246,0.1)', border: '#8b5cf6', color: '#c4b5fd' },
  'log-l2': { bg: 'rgba(245,158,11,0.1)', border: '#f59e0b', color: '#ffd8a8' },
  'log-l3': { bg: 'rgba(239,68,68,0.1)', border: '#ef4444', color: '#ffc9c9' },
  'log-ok': { bg: 'rgba(34,197,94,0.1)', border: '#22c55e', color: '#b2f2bb' },
  'log-info': { bg: 'rgba(86,156,214,0.1)', border: '#4a9eed', color: '#a5d8ff' },
};

/* ------------------------------------------------------------------ */
/*  Custom Node Component                                              */
/* ------------------------------------------------------------------ */

interface DagNodeData extends Record<string, unknown> {
  label: string;
  sub: string;
  color: string;
  active: boolean;
  onClick: (id: string) => void;
}

function DagNode({ id, data }: NodeProps<Node<DagNodeData>>) {
  const { label, sub, color, active, onClick } = data;
  return (
    <div
      onClick={() => onClick(id)}
      style={{
        width: NODE_W,
        height: NODE_H,
        borderRadius: 8,
        background: active ? color + '33' : '#252526',
        border: `2px solid ${active ? color : '#444'}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'background 0.5s, border-color 0.5s',
        boxShadow: active ? `0 0 12px ${color}44` : 'none',
        animation: active ? 'pulse 1.5s infinite' : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
      <span style={{ fontSize: 11, color: '#ccc', lineHeight: 1.2 }}>{label}</span>
      <span style={{ fontSize: 9, color: '#858585', lineHeight: 1.2 }}>{sub}</span>
    </div>
  );
}

const nodeTypes = { dagNode: DagNode };

/* ------------------------------------------------------------------ */
/*  Position helpers                                                   */
/* ------------------------------------------------------------------ */

const CELL_W = 160;
const CELL_H = 100;
const PAD_X = 40;
const PAD_Y = 30;

function nodePosition(col: number, row: number): { x: number; y: number } {
  return {
    x: PAD_X + col * CELL_W,
    y: PAD_Y + row * CELL_H,
  };
}

function buildInitialNodes(onClick: (id: string) => void): Node<DagNodeData>[] {
  return NODE_DEFS.map((n) => {
    const pos = nodePosition(n.col, n.row);
    return {
      id: n.id,
      type: 'dagNode',
      position: pos,
      data: {
        label: n.label,
        sub: n.sub,
        color: COLORS[n.id],
        active: false,
        onClick,
      },
    };
  });
}

function buildInitialEdges(): Edge[] {
  return EDGE_DEFS.map((e, i) => {
    const fromDef = NODE_DEFS.find((n) => n.id === e.from)!;
    const toDef = NODE_DEFS.find((n) => n.id === e.to)!;

    let style: React.CSSProperties = { stroke: '#555', strokeWidth: 1.5 };
    const labelStyle: React.CSSProperties = {
      fontSize: 9,
      fill: '#858585',
      fontWeight: 400,
    };

    if (e.loop) {
      const isTop = fromDef.row === 0;
      const offsetY = isTop ? -50 : 50;
      return {
        id: `e-${i}`,
        source: e.from,
        target: e.to,
        label: e.label,
        labelStyle,
        style,
        type: 'smoothstep',
        pathOptions: { offset: offsetY, borderRadius: 16 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#555' },
      };
    }

    return {
      id: `e-${i}`,
      source: e.from,
      target: e.to,
      label: e.label,
      labelStyle,
      style,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#555' },
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Inner Flow component (must be inside ReactFlowProvider)            */
/* ------------------------------------------------------------------ */

function DegradationFlow() {
  const [logs, setLogs] = useState<Array<{ text: string; cls: LogCls }>>([]);
  const [detailId, setDetailId] = useState<NodeId | null>(null);
  const [statusText, setStatusText] = useState('点击节点查看详情，或触发故障观察降级路径');
  const animRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const handleNodeClick = useCallback((id: string) => {
    setDetailId(id as NodeId);
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DagNodeData>>(
    buildInitialNodes(handleNodeClick),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(buildInitialEdges());

  const highlightNodes = useCallback(
    (ids: NodeId[]) => {
      const activeSet = new Set(ids);
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: { ...n.data, active: activeSet.has(n.id as NodeId) },
        })),
      );
      setEdges((eds) =>
        eds.map((e) => {
          const srcActive = activeSet.has(e.source as NodeId);
          const tgtActive = activeSet.has(e.target as NodeId);
          const bothActive = srcActive && tgtActive;
          return {
            ...e,
            style: {
              stroke: bothActive ? '#4a9eed' : '#555',
              strokeWidth: bothActive ? 2.5 : 1.5,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: bothActive ? '#4a9eed' : '#555',
            },
            labelStyle: {
              fontSize: 9,
              fill: bothActive ? '#a5d8ff' : '#858585',
            },
          };
        }),
      );
    },
    [setNodes, setEdges],
  );

  const addLog = useCallback((text: string, cls: LogCls) => {
    setLogs((prev) => [...prev, { text, cls }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const triggerFailure = useCallback(async () => {
    if (animRef.current) return;
    animRef.current = true;
    setLogs([]);
    setStatusText('模拟持续故障，观察三层降级...');

    highlightNodes(['request', 'stream']);
    addLog('发起流式请求...', 'log-info');
    await sleep(500);

    for (let i = 1; i <= 4; i++) {
      highlightNodes(['stream', 'backoff']);
      const delay = 500 * Math.pow(2, i - 1);
      addLog(`[L1] 第 ${i} 次: 529 Overloaded → 退避 ${delay}ms`, 'log-l1');
      await sleep(400);
    }

    addLog('[L1] 连续失败 → 升级到 Layer 2', 'log-l1');
    await sleep(300);

    highlightNodes(['backoff', 'nonstream']);
    addLog('[L2] 切换非流式请求 (短连接，对服务端更友好)', 'log-l2');
    await sleep(500);

    for (let i = 1; i <= 3; i++) {
      highlightNodes(['nonstream', 'backoff2']);
      addLog(`[L2] 非流式第 ${i} 次: 529 Site Overloaded`, 'log-l2');
      await sleep(400);
    }

    addLog('[L2] 连续 3 次 529 → 升级到 Layer 3', 'log-l2');
    await sleep(300);

    highlightNodes(['backoff2', 'modelswitch']);
    addLog('[L3] 切换模型: Opus → Sonnet', 'log-l3');
    addLog('[L3] 保留完整上下文，只改 model 字段', 'log-l3');
    await sleep(600);

    highlightNodes(['modelswitch', 'success']);
    addLog('[L3] Sonnet 响应成功! ✓', 'log-ok');
    await sleep(300);

    highlightNodes(['success']);
    setStatusText('三层降级完成: L1流式重试→L2非流式→L3模型降级→成功');
    animRef.current = false;
  }, [highlightNodes, addLog]);

  const triggerSuccess = useCallback(async () => {
    if (animRef.current) return;
    animRef.current = true;
    setLogs([]);
    setStatusText('模拟偶发故障，Layer 1 重试成功...');

    highlightNodes(['request', 'stream']);
    addLog('发起流式请求...', 'log-info');
    await sleep(500);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 第 1 次: 429 Too Many Requests → 退避 500ms', 'log-l1');
    await sleep(500);

    highlightNodes(['backoff', 'stream']);
    addLog('[L1] 重试...', 'log-l1');
    await sleep(400);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 第 2 次: 429 → 退避 1000ms', 'log-l1');
    await sleep(500);

    highlightNodes(['backoff', 'success']);
    addLog('[L1] 第 3 次: 成功! ✓', 'log-ok');
    addLog('偶发故障通过 Layer 1 重试解决，无需降级', 'log-ok');
    await sleep(300);

    highlightNodes(['success']);
    setStatusText('Layer 1 重试成功: 偶发故障不需要降级');
    animRef.current = false;
  }, [highlightNodes, addLog]);

  const resetAll = useCallback(() => {
    animRef.current = false;
    setLogs([]);
    setDetailId(null);
    setStatusText('点击节点查看详情，或触发故障观察降级路径');
    highlightNodes([]);
  }, [highlightNodes]);

  const detailNode = detailId ? NODE_DEFS.find((n) => n.id === detailId) : null;

  const legends = [
    { color: '#8b5cf6', label: 'Layer 1: 流式重试' },
    { color: '#f59e0b', label: 'Layer 2: 非流式' },
    { color: '#ef4444', label: 'Layer 3: 模型降级' },
    { color: '#22c55e', label: '成功' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 10, background: '#1e1e1e', color: '#ccc', fontFamily: "'Courier New', monospace" }}>
      <style>{`@keyframes pulse{0%,100%{box-shadow:0 0 8px rgba(74,158,237,0.2)}50%{box-shadow:0 0 20px rgba(74,158,237,0.6)}}`}</style>

      <h2 style={{ color: '#569cd6', fontSize: 16, margin: 0 }}>三层降级链 — DAG 拓扑图</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={triggerFailure} style={btnStyle}>触发持续故障</button>
        <button onClick={triggerSuccess} style={btnStyle}>触发偶发故障(重试成功)</button>
        <button onClick={resetAll} style={btnStyle}>重置</button>
        <span style={{ color: '#6a9955', fontSize: 12 }}>{statusText}</span>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: 12, overflow: 'hidden' }}>
        <div style={{ flex: 2, border: '1px solid #333', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15, minZoom: 0.5 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.5}
            maxZoom={2}
            style={{ background: '#1e1e1e' }}
          >
            <Background color="#333" gap={20} size={1} />
          </ReactFlow>
          <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 12, fontSize: 10, color: '#858585' }}>
            {legends.map((l) => (
              <div key={l.color} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, border: '1px solid #333', borderRadius: 6, padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: '#569cd6', fontSize: 11, borderBottom: '1px solid #333', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>执行日志</div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {logs.map((l, i) => (
              <div key={i} style={{ padding: '4px 8px', margin: '2px 0', borderRadius: 2, fontSize: 11, background: LOG_STYLES[l.cls].bg, borderLeft: `2px solid ${LOG_STYLES[l.cls].border}`, color: LOG_STYLES[l.cls].color }}>
                {l.text}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
          {detailNode && (
            <div style={{ padding: 8, border: '1px solid #444', borderRadius: 4, background: '#252526', fontSize: 11 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 4, color: COLORS[detailId] }}>{detailNode.label}</div>
              <div style={{ color: '#858585', marginTop: 4 }}>{NODE_DETAILS[detailId]}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Default export — wrapped in ReactFlowProvider                      */
/* ------------------------------------------------------------------ */

export default function Case07Degradation() {
  return (
    <ReactFlowProvider>
      <DegradationFlow />
    </ReactFlowProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
/* ------------------------------------------------------------------ */

const btnStyle: React.CSSProperties = {
  background: '#0e639c',
  color: '#fff',
  border: 'none',
  padding: '7px 14px',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
};
