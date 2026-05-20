import { useState, useCallback, useRef } from 'react';
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

const NODE_W = 180;
const NODE_H = 50;

type NodeId = 'stream' | 'backoff' | 'nonstream' | 'backoff2' | 'modelswitch' | 'success';

const COLORS: Record<NodeId, string> = {
  stream: '#8b5cf6',
  backoff: '#8b5cf6',
  nonstream: '#f59e0b',
  backoff2: '#f59e0b',
  modelswitch: '#ef4444',
  success: '#22c55e',
};

const NODE_DEFS: Array<{ id: NodeId; label: string; sub: string }> = [
  { id: 'stream',      label: '流式请求',   sub: 'stream: true' },
  { id: 'backoff',     label: '指数退避',   sub: '500ms×2^n' },
  { id: 'nonstream',   label: '非流式请求', sub: 'timeout:120s' },
  { id: 'backoff2',    label: '退避重试',   sub: '继承失败预算' },
  { id: 'modelswitch', label: '模型降级',   sub: 'Opus→Sonnet' },
  { id: 'success',     label: '成功',       sub: '返回结果' },
];

const NODE_DETAILS: Record<NodeId, string> = {
  stream: '通过 SSE 建立流式长连接。流式需要维持连接池，但用户体验好（逐字输出）。',
  backoff: '基础退避 500ms，每次翻倍。加随机抖动防止"重试风暴"。最多重试 10 次。优先使用 Retry-After 头。',
  nonstream: '切换为一次性请求-响应。变成短连接，对服务端更友好。超时 120 秒。',
  backoff2: '继承 Layer 1 的失败次数。两层的失败预算是连续的，不是各算各的。',
  modelswitch: '不同模型通常有独立的算力配额。Opus 过载不代表 Sonnet 也过载。只改 model 字段，上下文不需要重建。',
  success: '请求成功返回。可能来自任何一层。',
};

// Vertical layout: all main nodes in one column, "success" on the right
const GAP_Y = 100;
const CENTER_X = 100;
const SUCCESS_X = 380;

function getNodePosition(id: NodeId): { x: number; y: number } {
  const mainOrder: NodeId[] = ['stream', 'backoff', 'nonstream', 'backoff2', 'modelswitch'];
  const idx = mainOrder.indexOf(id);
  if (id === 'success') {
    return { x: SUCCESS_X, y: 2 * GAP_Y };
  }
  return { x: CENTER_X, y: idx * GAP_Y };
}

interface EdgeDef {
  from: NodeId;
  to: NodeId;
  label: string;
  sourceHandle?: string;
  targetHandle?: string;
}

const EDGE_DEFS: EdgeDef[] = [
  { from: 'stream',      to: 'backoff',     label: '429/529',  sourceHandle: 'bottom', targetHandle: 'top' },
  { from: 'backoff',     to: 'nonstream',   label: '连续失败', sourceHandle: 'bottom', targetHandle: 'top' },
  { from: 'nonstream',   to: 'backoff2',    label: '529',      sourceHandle: 'bottom', targetHandle: 'top' },
  { from: 'backoff2',    to: 'modelswitch', label: '3次529',   sourceHandle: 'bottom', targetHandle: 'top' },
  { from: 'modelswitch', to: 'success',     label: '',         sourceHandle: 'right',  targetHandle: 'bottom' },
  { from: 'backoff',     to: 'success',     label: '成功',     sourceHandle: 'right',  targetHandle: 'left' },
  { from: 'nonstream',   to: 'success',     label: '成功',     sourceHandle: 'right',  targetHandle: 'left' },
];

type LogCls = 'log-l1' | 'log-l2' | 'log-l3' | 'log-ok' | 'log-info';

const LOG_STYLES: Record<LogCls, { bg: string; border: string; color: string }> = {
  'log-l1': { bg: 'rgba(139,92,246,0.1)', border: '#8b5cf6', color: '#c4b5fd' },
  'log-l2': { bg: 'rgba(245,158,11,0.1)', border: '#f59e0b', color: '#ffd8a8' },
  'log-l3': { bg: 'rgba(239,68,68,0.1)', border: '#ef4444', color: '#ffc9c9' },
  'log-ok': { bg: 'rgba(34,197,94,0.1)', border: '#22c55e', color: '#b2f2bb' },
  'log-info': { bg: 'rgba(86,156,214,0.1)', border: '#4a9eed', color: '#a5d8ff' },
};

/* ── Custom Node Component (X6 Style) ── */

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
        borderRadius: 6,
        background: active ? color + '18' : '#2d2d2d',
        border: `1px solid ${active ? color : '#3a3a5c'}`,
        borderLeft: `4px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        cursor: 'pointer',
        transition: 'all 0.3s',
        position: 'relative',
      }}
    >
      <Handle id="top" type="target" position={Position.Top} style={portStyle} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={portStyle} />
      <Handle id="left" type="target" position={Position.Left} style={portStyle} />
      <Handle id="right" type="source" position={Position.Right} style={portStyle} />
      <span style={{ fontSize: 14, marginRight: 8, color: '#888' }}>⚙</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: '#e0e0e0', fontWeight: 500, lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 10, color: '#888', lineHeight: 1.3 }}>{sub}</div>
      </div>
      <div style={{
        width: 18, height: 18, borderRadius: '50%',
        border: `1.5px solid ${active ? color : '#555'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 10, color: active ? color : '#555', fontWeight: 'bold' }}>
          {active ? '▶' : '✓'}
        </span>
      </div>
    </div>
  );
}

const portStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  background: '#1e1e1e',
  border: '1.5px solid #555',
};

const nodeTypes = { dagNode: DagNode };

/* ── Build nodes & edges ── */

function buildNodes(onClick: (id: string) => void): Node<DagNodeData>[] {
  return NODE_DEFS.map((n) => ({
    id: n.id,
    type: 'dagNode',
    position: getNodePosition(n.id),
    data: {
      label: n.label,
      sub: n.sub,
      color: COLORS[n.id],
      active: false,
      onClick,
    },
  }));
}

function buildEdges(): Edge[] {
  return EDGE_DEFS.map((e, i) => ({
    id: `e-${i}`,
    source: e.from,
    target: e.to,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.label,
    labelStyle: { fontSize: 10, fill: '#666' },
    labelBgStyle: { fill: '#1e1e1e', fillOpacity: 0.8 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 3,
    style: { stroke: '#555', strokeWidth: 1.5 },
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#555' },
  }));
}

/* ── Main Flow ── */

function DegradationFlow() {
  const [logs, setLogs] = useState<Array<{ text: string; cls: LogCls }>>([]);
  const [detailId, setDetailId] = useState<NodeId | null>(null);
  const [statusText, setStatusText] = useState('点击节点查看详情，或触发故障观察降级路径');
  const animRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const handleNodeClick = useCallback((id: string) => {
    setDetailId(id as NodeId);
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DagNodeData>>(buildNodes(handleNodeClick));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(buildEdges());

  const highlightNodes = useCallback((ids: NodeId[]) => {
    const s = new Set(ids);
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, active: s.has(n.id as NodeId) },
    })));
    setEdges((eds) => eds.map((e) => {
      const active = s.has(e.source as NodeId) && s.has(e.target as NodeId);
      return {
        ...e,
        style: { stroke: active ? '#4a9eed' : '#555', strokeWidth: active ? 2 : 1.5 },
        labelStyle: { fontSize: 10, fill: active ? '#a5d8ff' : '#666' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: active ? '#4a9eed' : '#555' },
      };
    }));
  }, [setNodes, setEdges]);

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

    // Layer 1: 流式请求 + 指数退避重试
    highlightNodes(['stream']);
    addLog('stream: true, model: claude-opus-4', 'log-info');
    addLog('发起流式请求...', 'log-info');
    await sleep(1000);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 响应 529 Site Overloaded', 'log-l1');
    await sleep(600);
    addLog('[L1] 第 1 次重试 → 退避 500ms + jitter(125ms)', 'log-l1');
    await sleep(800);

    highlightNodes(['stream']);
    addLog('[L1] 重试请求...', 'log-l1');
    await sleep(700);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 响应 529 Site Overloaded', 'log-l1');
    await sleep(600);
    addLog('[L1] 第 2 次重试 → 退避 1000ms + jitter(250ms)', 'log-l1');
    await sleep(1000);

    highlightNodes(['stream']);
    addLog('[L1] 重试请求...', 'log-l1');
    await sleep(700);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 响应 529 Site Overloaded', 'log-l1');
    await sleep(600);
    addLog('[L1] 第 3 次重试 → 退避 2000ms + jitter(500ms)', 'log-l1');
    await sleep(1200);

    highlightNodes(['stream']);
    addLog('[L1] 重试请求...', 'log-l1');
    await sleep(700);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 响应 529 Site Overloaded', 'log-l1');
    await sleep(600);
    addLog('[L1] 第 4 次重试 → 退避 4000ms + jitter(1000ms)', 'log-l1');
    await sleep(1400);

    highlightNodes(['stream']);
    addLog('[L1] 重试请求...', 'log-l1');
    await sleep(700);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 响应 529 Site Overloaded — 连续 5 次失败', 'log-l1');
    await sleep(800);
    addLog('[L1] 触发降级阈值 → 升级到 Layer 2', 'log-l1');
    await sleep(1000);

    // Layer 2: 非流式请求
    highlightNodes(['backoff', 'nonstream']);
    addLog('[L2] 切换: stream=false, timeout=120s', 'log-l2');
    addLog('[L2] 发起非流式请求...', 'log-l2');
    await sleep(1200);

    highlightNodes(['nonstream', 'backoff2']);
    addLog('[L2] 响应 529 Site Overloaded', 'log-l2');
    await sleep(600);
    addLog('[L2] 第 1 次重试 → 退避 8000ms（继承 L1 失败计数）', 'log-l2');
    await sleep(1200);

    highlightNodes(['nonstream']);
    addLog('[L2] 重试非流式请求...', 'log-l2');
    await sleep(800);

    highlightNodes(['nonstream', 'backoff2']);
    addLog('[L2] 响应 529 Site Overloaded', 'log-l2');
    await sleep(600);
    addLog('[L2] 第 2 次重试 → 退避 16000ms', 'log-l2');
    await sleep(1200);

    highlightNodes(['nonstream']);
    addLog('[L2] 重试非流式请求...', 'log-l2');
    await sleep(800);

    highlightNodes(['nonstream', 'backoff2']);
    addLog('[L2] 响应 529 Site Overloaded — 连续 3 次', 'log-l2');
    await sleep(800);
    addLog('[L2] 触发模型降级阈值 → 升级到 Layer 3', 'log-l2');
    await sleep(1000);

    // Layer 3: 模型降级
    highlightNodes(['backoff2', 'modelswitch']);
    addLog('[L3] 切换模型: model=claude-sonnet-4（保留完整上下文）', 'log-l3');
    await sleep(800);
    addLog('[L3] 发起请求 (Sonnet)...', 'log-l3');
    await sleep(1500);

    highlightNodes(['modelswitch', 'success']);
    addLog('[L3] 响应 200 OK — Sonnet 返回正常结果 ✓', 'log-ok');
    await sleep(600);
    addLog('总耗时: ~35s（含退避等待），降级路径: 流式→非流式→换模型', 'log-ok');
    await sleep(400);

    highlightNodes(['success']);
    setStatusText('完成: L1 流式(5次失败) → L2 非流式(3次失败) → L3 Sonnet 成功');
    animRef.current = false;
  }, [highlightNodes, addLog]);

  const triggerSuccess = useCallback(async () => {
    if (animRef.current) return;
    animRef.current = true;
    setLogs([]);
    setStatusText('模拟偶发故障，Layer 1 重试后恢复...');

    highlightNodes(['stream']);
    addLog('stream: true, model: claude-opus-4', 'log-info');
    addLog('发起流式请求...', 'log-info');
    await sleep(1000);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 响应 429 Too Many Requests', 'log-l1');
    await sleep(600);
    addLog('[L1] Retry-After: 2（服务端指定，优先于自算退避）', 'log-l1');
    addLog('[L1] 第 1 次重试 → 等待 2000ms', 'log-l1');
    await sleep(1200);

    highlightNodes(['stream']);
    addLog('[L1] 重试请求...', 'log-l1');
    await sleep(800);

    highlightNodes(['stream', 'backoff']);
    addLog('[L1] 响应 429 Too Many Requests', 'log-l1');
    await sleep(600);
    addLog('[L1] 第 2 次重试 → 退避 1000ms + jitter(250ms)', 'log-l1');
    await sleep(1000);

    highlightNodes(['stream']);
    addLog('[L1] 重试请求...', 'log-l1');
    await sleep(1000);

    highlightNodes(['backoff', 'success']);
    addLog('[L1] 响应 200 OK — 流式数据开始推送 ✓', 'log-ok');
    await sleep(600);
    addLog('偶发限流通过退避重试解决，无需降级（总耗时 ~5s）', 'log-ok');
    await sleep(400);

    highlightNodes(['success']);
    setStatusText('Layer 1 重试成功: 429 限流在第 3 次恢复，无需降级');
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 10, background: '#1e1e1e', color: '#ccc', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <h2 style={{ color: '#569cd6', fontSize: 16, margin: 0, fontWeight: 600 }}>三层降级链 — DAG 拓扑图</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={triggerFailure} style={btnStyle}>触发持续故障</button>
        <button onClick={triggerSuccess} style={btnStyle}>触发偶发故障（重试成功）</button>
        <button onClick={resetAll} style={{ ...btnStyle, background: '#333', border: '1px solid #555' }}>重置</button>
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
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.5}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            style={{ background: '#1a1a2e' }}
          >
            <Background color="#2a2a4a" gap={40} size={1} />
          </ReactFlow>
          <div style={{ position: 'absolute', bottom: 10, left: 10, display: 'flex', gap: 14, fontSize: 10, color: '#888' }}>
            {[
              { c: '#8b5cf6', l: 'Layer 1: 流式重试' },
              { c: '#f59e0b', l: 'Layer 2: 非流式' },
              { c: '#ef4444', l: 'Layer 3: 模型降级' },
              { c: '#22c55e', l: '成功' },
            ].map((x) => (
              <span key={x.c} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: x.c, display: 'inline-block' }} />
                {x.l}
              </span>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, border: '1px solid #333', borderRadius: 6, padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
          <div style={{ color: '#569cd6', fontSize: 11, borderBottom: '1px solid #333', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>执行日志</div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {logs.map((l, i) => (
              <div key={i} style={{ padding: '5px 8px', margin: '2px 0', borderRadius: 3, fontSize: 11, fontFamily: 'monospace', background: LOG_STYLES[l.cls].bg, borderLeft: `2px solid ${LOG_STYLES[l.cls].border}`, color: LOG_STYLES[l.cls].color }}>
                {l.text}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
          {detailNode && (
            <div style={{ padding: 10, border: '1px solid #3a3a5c', borderRadius: 6, background: '#252526', fontSize: 11, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: COLORS[detailId!] }}>⚙ {detailNode.label}</div>
              <div style={{ color: '#aaa' }}>{NODE_DETAILS[detailId!]}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Case07Degradation() {
  return (
    <ReactFlowProvider>
      <DegradationFlow />
    </ReactFlowProvider>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#0e639c',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
};
