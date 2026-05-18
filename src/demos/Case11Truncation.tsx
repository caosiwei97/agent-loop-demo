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

const NODE_W = 90;
const NODE_H = 36;

type FlowNodeId = 'start' | 'step1' | 'step2' | 'step3' | 'done';

const NODE_COLORS: Record<FlowNodeId, string> = {
  start: '#569cd6',
  step1: '#f59e0b',
  step2: '#4a9eed',
  step3: '#ef4444',
  done: '#22c55e',
};

const NODE_DEFS: Array<{ id: FlowNodeId; col: number; label: string }> = [
  { id: 'start', col: 0, label: '请求' },
  { id: 'step1', col: 1, label: '提上限' },
  { id: 'step2', col: 2, label: '恢复消息' },
  { id: 'step3', col: 3, label: '认栽' },
  { id: 'done', col: 4, label: '完成' },
];

const EDGE_DEFS: Array<{ from: FlowNodeId; to: FlowNodeId; label: string; curve?: number }> = [
  { from: 'start', to: 'step1', label: 'length' },
  { from: 'step1', to: 'step2', label: '仍截断' },
  { from: 'step2', to: 'step3', label: '>3次' },
  { from: 'step1', to: 'done', label: '成功', curve: -30 },
  { from: 'step2', to: 'done', label: '成功', curve: 30 },
  { from: 'step3', to: 'done', label: '' },
];

const RECOVERY_MESSAGES = [
  '直接从断点继续——不要道歉，不要回顾。把剩余工作拆成更小的块。',
  '再次被截断。大幅精简，只列关键结论。',
  '第三次截断。如果还说不完，返回已完成的部分结论。',
];

interface FlowNodeData extends Record<string, unknown> {
  label: string;
  color: string;
  active: boolean;
}

function FlowNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { label, color, active } = data;
  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        borderRadius: 6,
        background: active ? color + '26' : '#252526',
        border: `2px solid ${active ? color : '#444'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.3s',
        boxShadow: active ? `0 0 10px ${color}44` : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
      <span style={{ fontSize: 10, color: active ? '#a5d8ff' : '#858585' }}>{label}</span>
    </div>
  );
}

const nodeTypes = { flowNode: FlowNode };

function buildNodes(activeId: FlowNodeId | null): Node<FlowNodeData>[] {
  const cellW = 180;
  const padX = 60;
  return NODE_DEFS.map((n) => ({
    id: n.id,
    type: 'flowNode',
    position: { x: padX + n.col * cellW, y: 30 },
    data: {
      label: n.label,
      color: NODE_COLORS[n.id],
      active: n.id === activeId,
    },
  }));
}

function buildEdges(): Edge[] {
  return EDGE_DEFS.map((e, i) => ({
    id: `e-${i}`,
    source: e.from,
    target: e.to,
    label: e.label,
    labelStyle: { fontSize: 8, fill: '#858585' },
    style: { stroke: '#555', strokeWidth: 1.2 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: '#888' },
    type: e.curve ? 'smoothstep' : 'default',
  }));
}

type BubbleType = 'system' | 'model';

interface OutputLine {
  key: string;
  type: 'bubble' | 'truncated' | 'conclusion';
  text: string;
  bubbleType?: BubbleType;
}

function TruncationFlow() {
  const [activeNode, setActiveNode] = useState<FlowNodeId | null>(null);
  const [step, setStep] = useState(-1);
  const [outputs, setOutputs] = useState<OutputLine[]>([]);
  const [stateVals, setStateVals] = useState({
    maxOutput: '8192',
    maxOutputCls: '',
    recovery: '0 / 3',
    finish: '-',
    finishCls: '',
    accum: '0 字符',
    status: '等待',
    statusCls: 'ok',
  });
  const [statusText, setStatusText] = useState('三步渐进式恢复: 提上限 → 注入恢复消息 → 认栽');
  const runningRef = useRef(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const keyCounter = useRef(0);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(buildNodes(null));
  const [edges, , onEdgesChange] = useEdgesState<Edge>(buildEdges());

  const scrollToBottom = () => {
    setTimeout(() => outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' }), 30);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const setFlowActive = useCallback(
    (id: FlowNodeId | null) => {
      setActiveNode(id);
      setNodes(buildNodes(id));
    },
    [setNodes],
  );

  const addBubble = useCallback((text: string, bubbleType: BubbleType) => {
    setOutputs((prev) => [...prev, { key: `b${keyCounter.current++}`, type: 'bubble', text, bubbleType }]);
    scrollToBottom();
  }, []);

  const addTruncated = useCallback(() => {
    setOutputs((prev) => [...prev, { key: `t${keyCounter.current++}`, type: 'truncated', text: '⚡ 输出被截断 (finishReason: "length")' }]);
    scrollToBottom();
  }, []);

  const addConclusion = useCallback((text: string) => {
    setOutputs((prev) => [...prev, { key: `c${keyCounter.current++}`, type: 'conclusion', text }]);
    scrollToBottom();
  }, []);

  const simulateTyping = useCallback(async (text: string, speed = 15): Promise<number> => {
    const chunkSize = 3;
    let displayed = '';
    for (let i = 0; i < text.length; i += chunkSize) {
      if (!runningRef.current) return text.length;
      displayed += text.slice(i, i + chunkSize);
      const currentDisplay = displayed;
      setOutputs((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === 'typing') {
          return [...prev.slice(0, -1), { ...last, text: currentDisplay }];
        }
        return [...prev, { key: `ty${keyCounter.current++}`, type: 'typing', text: currentDisplay }];
      });
      scrollToBottom();
      await sleep(speed);
    }
    return text.length;
  }, []);

  const resetAll = useCallback(() => {
    runningRef.current = false;
    setOutputs([]);
    setFlowActive(null);
    setStep(-1);
    setStateVals({
      maxOutput: '8192',
      maxOutputCls: '',
      recovery: '0 / 3',
      finish: '-',
      finishCls: '',
      accum: '0 字符',
      status: '等待',
      statusCls: 'ok',
    });
    setStatusText('三步渐进式恢复: 提上限 → 注入恢复消息 → 认栽');
  }, [setFlowActive]);

  const runRecoverySuccess = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    resetAll();
    setStatusText('模拟: 第二次恢复成功');

    const outputTexts = [
      '这是一段非常详细的分析报告。首先，从架构层面来看，该项目采用了模块化设计，包含了以下核心模块：核心引擎、插件系统、配置管理、日志系统。在核心引擎中，我们发现了几处可以优化的地方：1) 缓存策略使用了简单的 LRU，但在高并发场景下性能不足 2) 事件总线采用同步分发...',
      '继续安全审计部分。SQL 注入风险：发现 2 处未参数化的查询。XSS 风险：前端模板引擎未启用自动转义。建议：使用参数化查询，启用 CSP 头。',
    ];

    let totalChars = 0;

    setFlowActive('start');
    setStep(0);
    addBubble('请对这段代码做详细的代码审查', 'system');
    await sleep(500);

    const chars1 = await simulateTyping(outputTexts[0], 15);
    totalChars += chars1;
    addTruncated();
    setStateVals((s) => ({ ...s, finish: 'length', finishCls: 'danger', accum: totalChars + ' 字符' }));
    await sleep(600);

    setFlowActive('step1');
    setStep(1);
    setStateVals((s) => ({ ...s, maxOutput: '8192 → 65536', maxOutputCls: 'warn', status: '静默提高上限', statusCls: 'warn' }));
    addBubble('[系统] 静默提高 max_output_tokens: 8192 → 65536', 'system');
    await sleep(800);

    setFlowActive('step2');
    setStep(2);
    setStateVals((s) => ({ ...s, recovery: '1 / 3', status: '恢复中...', statusCls: 'warn' }));
    addBubble(RECOVERY_MESSAGES[0], 'system');
    await sleep(500);

    const chars2 = await simulateTyping(outputTexts[1], 15);
    totalChars += chars2;
    setStateVals((s) => ({
      ...s,
      accum: totalChars + ' 字符',
      finish: 'stop',
      finishCls: 'ok',
      status: '恢复成功 ✓',
      statusCls: 'ok',
    }));

    setFlowActive('done');
    setStep(3);
    addBubble('✓ 恢复成功 — 模型从断点继续并正常完成', 'model');
    setStatusText('恢复成功: 提高上限 + 1次恢复消息后正常完成');
    runningRef.current = false;
  }, [resetAll, setFlowActive, addBubble, addTruncated, simulateTyping]);

  const runRecoveryFail = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    resetAll();
    setStatusText('模拟: 连续截断3次后认栽');

    const outputTexts = [
      '详细分析报告第一部分：架构分析。项目采用微服务架构，包含 Auth Service、API Gateway、Business Logic Layer、Data Access Layer...',
      '继续第二部分：性能问题。数据库查询未使用索引，N+1 查询问题严重，建议引入 DataLoader 模式...',
      '第三部分精简版：安全漏洞 3 处，性能瓶颈 5 处，代码规范问题 12 处。优先修复：SQL注入(P0)...',
    ];

    let totalChars = 0;

    setFlowActive('start');
    setStep(0);
    addBubble('请对这段代码做详细的代码审查', 'system');
    await sleep(500);

    for (let attempt = 0; attempt < 3; attempt++) {
      if (!runningRef.current) break;

      const chars = await simulateTyping(outputTexts[attempt], 15);
      totalChars += chars;
      addTruncated();
      setStateVals((s) => ({ ...s, finish: 'length', finishCls: 'danger', accum: totalChars + ' 字符' }));
      await sleep(400);

      if (attempt === 0) {
        setFlowActive('step1');
        setStep(1);
        setStateVals((s) => ({ ...s, maxOutput: '8192 → 65536', maxOutputCls: 'warn' }));
        addBubble('[系统] 静默提高 max_output_tokens: 8192 → 65536', 'system');
        await sleep(500);
      }

      setFlowActive('step2');
      setStep(2);
      setStateVals((s) => ({
        ...s,
        recovery: `${attempt + 1} / 3`,
        status: `恢复尝试 ${attempt + 1}/3`,
        statusCls: 'warn',
      }));
      addBubble(RECOVERY_MESSAGES[attempt], 'system');
      await sleep(600);
    }

    setFlowActive('step3');
    setStep(3);
    setStateVals((s) => ({ ...s, status: '认栽 — 返回不完整结果', statusCls: 'danger' }));
    addBubble('3次恢复均失败，返回不完整结果并标记为"输出被截断"', 'model');
    addConclusion('结论: 64K 限制下连续3次说不完 → 任务拆分有问题，需人工介入');
    setStatusText('认栽: 3次恢复均失败，任务需要拆分');
    runningRef.current = false;
  }, [resetAll, setFlowActive, addBubble, addTruncated, addConclusion, simulateTyping]);

  const stateColor = (cls: string) => {
    if (cls === 'ok') return '#22c55e';
    if (cls === 'warn') return '#f59e0b';
    if (cls === 'danger') return '#ef4444';
    return '#dcdcaa';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 10, background: '#1e1e1e', color: '#ccc', fontFamily: "'Courier New', monospace" }}>
      <h2 style={{ color: '#569cd6', fontSize: 16, margin: 0 }}>输出截断恢复模拟器</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={runRecoverySuccess} style={btnStyle}>模拟: 恢复成功</button>
        <button onClick={runRecoveryFail} style={btnStyle}>模拟: 三次都截断(认栽)</button>
        <button onClick={resetAll} style={btnStyle}>重置</button>
        <span style={{ color: '#6a9955', fontSize: 12 }}>{statusText}</span>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: 12, overflow: 'hidden' }}>
        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
          <div style={{ flex: '0 0 auto', border: '1px solid #333', borderRadius: 6, padding: 12, overflow: 'hidden' }}>
            <div style={{ color: '#569cd6', fontSize: 11, marginBottom: 6, borderBottom: '1px solid #333', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>恢复流程</div>
            <div style={{ height: 80 }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                proOptions={{ hideAttribution: true }}
                style={{ background: '#1e1e1e' }}
                minZoom={0.5}
                maxZoom={2}
              >
                <Background color="#333" gap={20} size={1} />
              </ReactFlow>
            </div>
          </div>
          <div style={{ flex: 1, border: '1px solid #333', borderRadius: 6, padding: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: '#569cd6', fontSize: 11, marginBottom: 6, borderBottom: '1px solid #333', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>模型输出 + 恢复对话</div>
            <div ref={outputRef} style={{ flex: 1, overflowY: 'auto', fontSize: 12, lineHeight: 1.6, padding: 4 }}>
              {outputs.map((o) => {
                if (o.type === 'bubble') {
                  const isSystem = o.bubbleType === 'system';
                  return (
                    <div key={o.key} style={{ margin: '6px 0', padding: '8px 12px', borderRadius: 8, fontSize: 11, maxWidth: '90%', background: isSystem ? '#2a2a1a' : '#1a2a3c', color: isSystem ? '#ffd8a8' : '#a5d8ff', border: isSystem ? '1px solid #f59e0b44' : '1px solid #4a9eed44', marginLeft: isSystem ? 'auto' : 0 }}>
                      {o.text}
                    </div>
                  );
                }
                if (o.type === 'truncated') {
                  return <div key={o.key} style={{ color: '#ef4444', borderTop: '2px dashed #ef4444', paddingTop: 4, marginTop: 4 }}>{o.text}</div>;
                }
                if (o.type === 'typing') {
                  return <div key={o.key} style={{ color: '#ccc' }}>{o.text}<span style={{ animation: 'blink 1s infinite' }}>▌</span></div>;
                }
                if (o.type === 'conclusion') {
                  return (
                    <div key={o.key} style={{ marginTop: 8, padding: 8, border: '1px solid #ef4444', borderRadius: 4, background: '#3c1a1a', fontSize: 11 }}>
                      <b style={{ color: '#ef4444' }}>{o.text}</b>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
          <div style={{ flex: '0 0 auto', border: '1px solid #333', borderRadius: 6, padding: 12 }}>
            <div style={{ color: '#569cd6', fontSize: 11, marginBottom: 6, borderBottom: '1px solid #333', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>当前状态</div>
            <div style={{ display: 'flex', gap: 4, margin: '8px 0', alignItems: 'center' }}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', border: `2px solid ${i < step ? '#22c55e' : i === step ? '#569cd6' : '#444'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 'bold',
                    color: i < step ? '#22c55e' : i === step ? '#569cd6' : '#444',
                    background: i < step ? 'rgba(34,197,94,0.1)' : i === step ? 'rgba(86,156,214,0.1)' : 'transparent',
                  }}>{i}</div>
                  {i < 3 && <div style={{ width: 20, height: 2, background: '#444' }} />}
                </span>
              ))}
            </div>
            <div style={{ padding: 8, border: '1px solid #333', borderRadius: 4, background: '#252526', fontSize: 11 }}>
              {[
                { label: 'max_output_tokens:', val: stateVals.maxOutput, cls: stateVals.maxOutputCls },
                { label: '恢复次数:', val: stateVals.recovery, cls: '' },
                { label: 'finishReason:', val: stateVals.finish, cls: stateVals.finishCls },
                { label: '累计输出:', val: stateVals.accum, cls: '' },
                { label: '状态:', val: stateVals.status, cls: stateVals.statusCls },
              ].map((row) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #2a2a2a' }}>
                  <span style={{ color: '#858585' }}>{row.label}</span>
                  <span style={{ color: stateColor(row.cls) }}>{row.val}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, border: '1px solid #333', borderRadius: 6, padding: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: '#569cd6', fontSize: 11, marginBottom: 6, borderBottom: '1px solid #333', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>恢复消息模板</div>
            <div style={{ fontSize: 11, overflowY: 'auto', flex: 1 }}>
              {[
                { n: 1, msg: RECOVERY_MESSAGES[0] },
                { n: 2, msg: RECOVERY_MESSAGES[1] },
                { n: 3, msg: RECOVERY_MESSAGES[2] },
              ].map((t) => (
                <div key={t.n} style={{ marginBottom: 8, padding: 6, borderLeft: '2px solid #f59e0b', background: '#2a2a1a' }}>
                  <b style={{ color: '#f59e0b' }}>第 {t.n} 次:</b><br />{t.msg}
                </div>
              ))}
              <div style={{ padding: 6, borderLeft: '2px solid #858585', color: '#858585' }}>
                <b>设计讲究:</b><br />
                • "不要道歉" — 模型的第一反应<br />
                • "不要回顾" — 模型的第二反应<br />
                • "从断点继续" — 最高效的续写方式
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </div>
  );
}

export default function Case11Truncation() {
  return (
    <ReactFlowProvider>
      <TruncationFlow />
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
