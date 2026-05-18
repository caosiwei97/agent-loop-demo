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

type GroupId = 'core' | 'fuse' | 'exit' | 'tool' | 'fault';

const GROUP_COLORS: Record<GroupId, string> = {
  core: '#569cd6',
  fuse: '#ef4444',
  exit: '#f59e0b',
  tool: '#22c55e',
  fault: '#8b5cf6',
};

interface GraphNodeDef {
  id: string;
  label: string;
  group: GroupId;
  desc: string;
  size: number;
  sector: number;
  ring: number;
}

const GRAPH_NODES: GraphNodeDef[] = [
  { id: 'loop', label: 'Agent Loop', group: 'core', desc: 'while(true) 主循环。每轮：检测→调用模型→处理输出→执行工具→检查退出条件。', size: 28, sector: 0, ring: 0 },
  { id: 'model', label: '调用模型', group: 'core', desc: '发送 messages 给 LLM API，获取流式响应。容错机制在此生效。', size: 20, sector: 0, ring: 1 },
  { id: 'toolexec', label: '工具执行器', group: 'tool', desc: '解析工具调用，判断并发安全性（读并发/写串行），执行工具并收集结果。', size: 20, sector: 1, ring: 1 },
  { id: 'streaming', label: '流式解析', group: 'tool', desc: '从 SSE 流中拼接 JSON 碎片，识别完整的 tool_use 块。边解析边触发执行。', size: 18, sector: 1.5, ring: 2 },
  { id: 'concurrency', label: '并发调度', group: 'tool', desc: 'Read/Glob/Grep 可并发，Edit 独占执行，Bash 按具体命令判断。', size: 18, sector: 2, ring: 2 },
  { id: 'fuse1', label: '死循环检测', group: 'fuse', desc: '四种检测器：通用重复(10次告警)、无进展轮询、Ping-Pong交替、全局熔断(30次强停)。', size: 20, sector: 3, ring: 1 },
  { id: 'fuse2', label: 'Token预算', group: 'fuse', desc: '90%时注入nudge消息"继续工作不要总结"。检测递减回报：连续两轮<500Token则停止。', size: 20, sector: 3.5, ring: 2 },
  { id: 'fuse3', label: '截断恢复', group: 'fuse', desc: '三步恢复：提高上限(8K→64K)→注入恢复消息(最多3次)→认栽返回不完整结果。', size: 20, sector: 4, ring: 1 },
  { id: 'retry', label: '重试+退避', group: 'fault', desc: '指数退避(500ms×2^n)+随机抖动。优先使用 Retry-After 头。最多10次。', size: 18, sector: 5, ring: 2 },
  { id: 'degrade', label: '三层降级', group: 'fault', desc: '流式→非流式→换模型。失败预算连续，不是各算各的。', size: 18, sector: 5.5, ring: 1 },
  { id: 'exit_completed', label: 'completed', group: 'exit', desc: 'end_turn: 模型认为任务完成。', size: 14, sector: 6, ring: 2 },
  { id: 'exit_maxturns', label: 'max_turns', group: 'exit', desc: '跑满轮次上限。检查发生在工具执行完成后。', size: 14, sector: 6.3, ring: 3 },
  { id: 'exit_abort_s', label: 'abort_stream', group: 'exit', desc: '用户按Esc(模型输出时)。保留已收到文本。', size: 14, sector: 6.6, ring: 2 },
  { id: 'exit_abort_t', label: 'abort_tools', group: 'exit', desc: '用户按Esc(工具执行时)。等正在跑的工具完成。', size: 14, sector: 6.9, ring: 3 },
  { id: 'exit_hook', label: 'hook_stopped', group: 'exit', desc: '自定义Hook阻止。如CI环境中lint不通过。', size: 14, sector: 7.2, ring: 2 },
  { id: 'exit_block', label: 'blocking_limit', group: 'exit', desc: '上下文快满，发请求前预检拦截。', size: 14, sector: 7.5, ring: 3 },
  { id: 'exit_long', label: 'prompt_too_long', group: 'exit', desc: 'API返回413。先尝试Context Collapse和Reactive Compact。', size: 14, sector: 7.8, ring: 2 },
];

const GRAPH_LINKS: Array<{ source: string; target: string }> = [
  { source: 'loop', target: 'model' },
  { source: 'model', target: 'streaming' },
  { source: 'model', target: 'retry' },
  { source: 'model', target: 'degrade' },
  { source: 'streaming', target: 'toolexec' },
  { source: 'toolexec', target: 'concurrency' },
  { source: 'toolexec', target: 'loop' },
  { source: 'loop', target: 'fuse1' },
  { source: 'loop', target: 'fuse2' },
  { source: 'model', target: 'fuse3' },
  { source: 'loop', target: 'exit_completed' },
  { source: 'loop', target: 'exit_maxturns' },
  { source: 'loop', target: 'exit_abort_s' },
  { source: 'loop', target: 'exit_abort_t' },
  { source: 'loop', target: 'exit_hook' },
  { source: 'loop', target: 'exit_block' },
  { source: 'loop', target: 'exit_long' },
];

const RING_RADII = [0, 120, 210, 280];
const CENTER_X = 400;
const CENTER_Y = 300;
const SECTOR_COUNT = 8;

function computeNodePosition(n: GraphNodeDef): { x: number; y: number } {
  if (n.ring === 0) return { x: CENTER_X, y: CENTER_Y };
  const angle = (n.sector / SECTOR_COUNT) * Math.PI * 2 - Math.PI / 2;
  const radius = RING_RADII[n.ring];
  return {
    x: CENTER_X + Math.cos(angle) * radius,
    y: CENTER_Y + Math.sin(angle) * radius,
  };
}

interface AgentNodeData extends Record<string, unknown> {
  label: string;
  group: GroupId;
  size: number;
  active: boolean;
  dimmed: boolean;
  onClick: (id: string) => void;
  onHover: (id: string | null) => void;
}

function AgentNode({ id, data }: NodeProps<Node<AgentNodeData>>) {
  const { label, group, size, active, dimmed, onClick, onHover } = data;
  const color = GROUP_COLORS[group];
  const nodeSize = size * 2;

  return (
    <div
      onClick={() => onClick(id)}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      style={{
        width: nodeSize,
        height: nodeSize,
        borderRadius: '50%',
        background: active ? color + '44' : color + '22',
        border: `2px solid ${active ? color : color}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        opacity: dimmed ? 0.15 : 1,
        transition: 'opacity 0.3s, border-width 0.3s, background 0.3s',
        borderWidth: active ? 3.5 : 2,
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
      <span style={{ fontSize: size > 20 ? 8 : 7, color: '#ccc', textAlign: 'center', lineHeight: 1.1, padding: '0 2px' }}>{label}</span>
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode };

type SimCls = 'sim-active' | 'sim-fuse' | 'sim-ok';

const SIM_STYLES: Record<SimCls, { bg: string; border: string; color: string }> = {
  'sim-active': { bg: '#1a2a3c', border: '#4a9eed', color: '#a5d8ff' },
  'sim-fuse': { bg: '#3c1a1a', border: '#ef4444', color: '#ffc9c9' },
  'sim-ok': { bg: '#1a3c1a', border: '#22c55e', color: '#b2f2bb' },
};

const SIMULATION_STEPS: Array<{ nodes: string[]; msg: string; cls: SimCls }> = [
  { nodes: ['loop', 'fuse1'], msg: '保险丝1: 检查是否有重复调用...正常', cls: 'sim-active' },
  { nodes: ['loop', 'model'], msg: '调用模型 API (流式)', cls: 'sim-active' },
  { nodes: ['model', 'streaming'], msg: '流式解析: 收到 text + tool_use', cls: 'sim-active' },
  { nodes: ['streaming', 'toolexec'], msg: '工具执行器: read_file(src/index.ts)', cls: 'sim-ok' },
  { nodes: ['toolexec', 'concurrency'], msg: '并发调度: Read → 可并发', cls: 'sim-ok' },
  { nodes: ['toolexec', 'loop'], msg: '结果返回，进入下一轮', cls: 'sim-active' },
  { nodes: ['loop', 'fuse1'], msg: '保险丝1: 检查...同一文件读第2次', cls: 'sim-fuse' },
  { nodes: ['loop', 'fuse2'], msg: '保险丝2: Token 65% (9750/15000)', cls: 'sim-active' },
  { nodes: ['loop', 'model'], msg: '调用模型 (第3轮)', cls: 'sim-active' },
  { nodes: ['model', 'fuse3'], msg: '输出正常 (finishReason: stop)', cls: 'sim-ok' },
  { nodes: ['loop', 'exit_completed'], msg: '退出: end_turn → completed ✓', cls: 'sim-ok' },
];

function AgentLoopGraph() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'fuse' | 'exit'>('all');
  const [simLogs, setSimLogs] = useState<Array<{ msg: string; cls: SimCls }>>([]);
  const [statusText, setStatusText] = useState('拖拽节点、悬停查看详情、点击按钮聚焦不同子系统');
  const simRunningRef = useRef(false);
  const simLogRef = useRef<HTMLDivElement>(null);

  const handleNodeClick = useCallback((id: string) => setDetailId(id), []);
  const handleNodeHover = useCallback((id: string | null) => setHoverId(id), []);

  const highlightedSet = useMemo(() => {
    if (viewMode === 'fuse') return new Set(['loop', 'fuse1', 'fuse2', 'fuse3']);
    if (viewMode === 'exit') {
      const exitIds = GRAPH_NODES.filter((n) => n.group === 'exit').map((n) => n.id);
      return new Set([...exitIds, 'loop']);
    }
    return null;
  }, [viewMode]);

  const activeSimNodesRef = useRef<Set<string>>(new Set());

  const buildNodes = useCallback(
    (): Node<AgentNodeData>[] =>
      GRAPH_NODES.map((n) => {
        const pos = computeNodePosition(n);
        const dimmed = highlightedSet !== null && !highlightedSet.has(n.id) && activeSimNodesRef.current.size === 0;
        const isActive = activeSimNodesRef.current.has(n.id);
        return {
          id: n.id,
          type: 'agentNode',
          position: pos,
          data: {
            label: n.label,
            group: n.group,
            size: n.size,
            active: isActive,
            dimmed,
            onClick: handleNodeClick,
            onHover: handleNodeHover,
          },
        };
      }),
    [highlightedSet, handleNodeClick, handleNodeHover],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>(buildNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    GRAPH_LINKS.map((l, i) => ({
      id: `e-${i}`,
      source: l.source,
      target: l.target,
      style: { stroke: '#444', strokeWidth: 1.2 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: '#666' },
    })),
  );

  const refreshNodes = useCallback(() => {
    setNodes(buildNodes());
  }, [setNodes, buildNodes]);

  const refreshEdges = useCallback(
    (activeIds: Set<string>) => {
      setEdges((eds) =>
        eds.map((e) => {
          const isActive = activeIds.has(e.source) && activeIds.has(e.target);
          return {
            ...e,
            style: {
              stroke: isActive ? '#4a9eed' : '#444',
              strokeWidth: isActive ? 2.5 : 1.2,
              filter: isActive ? 'drop-shadow(0 0 3px #4a9eed)' : 'none',
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 10,
              height: 10,
              color: isActive ? '#4a9eed' : '#666',
            },
          };
        }),
      );
    },
    [setEdges],
  );

  const showAll = useCallback(() => {
    setViewMode('all');
    activeSimNodesRef.current = new Set();
    refreshNodes();
    refreshEdges(new Set());
    setStatusText('全景视图: 拖拽探索 Agent Loop 架构');
  }, [refreshNodes, refreshEdges]);

  const highlightFuses = useCallback(() => {
    setViewMode('fuse');
    activeSimNodesRef.current = new Set();
    refreshNodes();
    refreshEdges(new Set());
    setStatusText('三根保险丝: 死循环检测 + Token预算 + 截断恢复');
  }, [refreshNodes, refreshEdges]);

  const highlightExits = useCallback(() => {
    setViewMode('exit');
    activeSimNodesRef.current = new Set();
    refreshNodes();
    refreshEdges(new Set());
    setStatusText('七种退出路径: completed/max_turns/abort/hook/blocking/prompt_too_long');
  }, [refreshNodes, refreshEdges]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runSimulation = useCallback(async () => {
    if (simRunningRef.current) return;
    simRunningRef.current = true;
    setSimLogs([]);
    setViewMode('all');
    setStatusText('模拟 Agent Loop 执行过程...');

    for (const step of SIMULATION_STEPS) {
      if (!simRunningRef.current) break;
      const activeIds = new Set(step.nodes);
      activeSimNodesRef.current = activeIds;
      refreshNodes();
      refreshEdges(activeIds);

      setSimLogs((prev) => [...prev, { msg: step.msg, cls: step.cls }]);
      setTimeout(() => simLogRef.current?.scrollTo({ top: simLogRef.current.scrollHeight, behavior: 'smooth' }), 50);
      await sleep(800);
    }

    activeSimNodesRef.current = new Set();
    refreshNodes();
    refreshEdges(new Set());
    setStatusText('模拟完成: 3轮循环后正常退出 (completed)');
    simRunningRef.current = false;
  }, [refreshNodes, refreshEdges]);

  const detailNode = detailId ? GRAPH_NODES.find((n) => n.id === detailId) : null;
  const hoveredNode = hoverId ? GRAPH_NODES.find((n) => n.id === hoverId) : null;
  const displayNode = hoveredNode || detailNode;

  const legends: Array<{ color: string; label: string }> = [
    { color: '#569cd6', label: '核心循环' },
    { color: '#ef4444', label: '保险丝' },
    { color: '#f59e0b', label: '退出路径' },
    { color: '#22c55e', label: '工具系统' },
    { color: '#8b5cf6', label: '容错' },
  ];

  const activeBtnStyle = (mode: 'all' | 'fuse' | 'exit'): React.CSSProperties => ({
    ...btnStyle,
    background: viewMode === mode ? '#8b5cf6' : '#0e639c',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 10, background: '#1e1e1e', color: '#ccc', fontFamily: "'Courier New', monospace" }}>
      <h2 style={{ color: '#569cd6', fontSize: 16, margin: 0 }}>Agent Loop 架构 — 力导向交互图</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={showAll} style={activeBtnStyle('all')}>全景</button>
        <button onClick={highlightFuses} style={activeBtnStyle('fuse')}>三根保险丝</button>
        <button onClick={highlightExits} style={activeBtnStyle('exit')}>七种退出</button>
        <button onClick={runSimulation} style={btnStyle}>模拟执行</button>
        <button onClick={showAll} style={btnStyle}>重置高亮</button>
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
          <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 10, fontSize: 9, color: '#858585' }}>
            {legends.map((l) => (
              <div key={l.color} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 0.8, border: '1px solid #333', borderRadius: 6, padding: 12, overflowY: 'auto', fontSize: 11 }}>
          <div style={{ color: '#569cd6', fontSize: 11, marginBottom: 6, borderBottom: '1px solid #333', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>节点详情</div>
          {displayNode ? (
            <div style={{ padding: 8, border: '1px solid #333', borderRadius: 4, background: '#252526', marginBottom: 8 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 3, color: GROUP_COLORS[displayNode.group] }}>{displayNode.label}</div>
              <div style={{ color: '#ccc', marginTop: 4 }}>{displayNode.desc}</div>
              <div style={{ color: '#858585', marginTop: 4, fontSize: 10 }}>分组: {displayNode.group}</div>
            </div>
          ) : (
            <div style={{ color: '#858585' }}>点击或悬停节点查看详情</div>
          )}
          <div style={{ color: '#569cd6', fontSize: 11, marginTop: 12, marginBottom: 6, borderBottom: '1px solid #333', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>模拟日志</div>
          <div ref={simLogRef} style={{ maxHeight: 200, overflowY: 'auto' }}>
            {simLogs.map((l, i) => (
              <div key={i} style={{ padding: '3px 6px', margin: '2px 0', borderRadius: 2, fontSize: 10, background: SIM_STYLES[l.cls].bg, borderLeft: `2px solid ${SIM_STYLES[l.cls].border}`, color: SIM_STYLES[l.cls].color }}>
                {l.msg}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Case12AgentLoop() {
  return (
    <ReactFlowProvider>
      <AgentLoopGraph />
    </ReactFlowProvider>
  );
}

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
