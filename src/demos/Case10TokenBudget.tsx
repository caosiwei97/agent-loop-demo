import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Gauge, Line } from '@ant-design/charts';

// ─── Types ──────────────────────────────────────────────────────────────────

type LogType = 'turn' | 'nudge' | 'diminish' | 'ok';
type PointStatus = 'normal' | 'below' | 'diminishing';

interface TurnDataPoint {
  turn: number;
  output: number;
  diminishing: boolean;
  status: PointStatus;
}

interface LogEntry {
  id: number;
  text: string;
  type: LogType;
}

interface ChartPoint {
  turn: number;
  value: number;
  series: string;
  status: PointStatus;
}

// ─── Inline style objects ───────────────────────────────────────────────────

const S = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    padding: 16,
    gap: 10,
    background: '#1e1e1e',
    color: '#cccccc',
    fontFamily: "'Courier New', monospace",
    overflow: 'hidden',
    boxSizing: 'border-box' as const,
  },
  title: { color: '#569cd6', fontSize: 16, margin: 0 },
  controls: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  btn: (disabled: boolean): React.CSSProperties => ({
    background: disabled ? '#333' : '#0e639c',
    color: disabled ? '#777' : '#fff',
    border: 'none',
    padding: '7px 14px',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
  }),
  status: { color: '#6a9955', fontSize: 12 },
  config: {
    display: 'flex',
    gap: 12,
    fontSize: 11,
    color: '#858585',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  cfgLabel: { display: 'flex', alignItems: 'center', gap: 4 },
  cfgInput: {
    background: '#252526',
    color: '#dcdcaa',
    border: '1px solid #444',
    borderRadius: 3,
    padding: '3px 6px',
    width: 70,
    fontFamily: 'inherit',
    fontSize: 11,
  },
  main: { display: 'flex', flex: 1, gap: 12, overflow: 'hidden', minHeight: 0 },
  left: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 10, minWidth: 0 },
  right: { flex: 1.2, display: 'flex', flexDirection: 'column' as const, gap: 10, minWidth: 0 },
  panel: {
    border: '1px solid #333',
    borderRadius: 6,
    padding: 12,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  panelTitle: {
    color: '#569cd6',
    fontSize: 11,
    marginBottom: 6,
    borderBottom: '1px solid #333',
    paddingBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  gaugeWrap: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
    minHeight: 180,
  },
  gaugeOverlay: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -40%)',
    textAlign: 'center' as const,
    pointerEvents: 'none' as const,
    zIndex: 1,
  },
  logArea: {
    flex: 1,
    overflowY: 'auto' as const,
    fontSize: 11,
    minHeight: 0,
  },
  costBox: {
    fontSize: 12,
    padding: 8,
    border: '1px solid #333',
    borderRadius: 4,
    background: '#252526',
  },
  costRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 0',
  },
  costVal: { color: '#dcdcaa' },
};

const LOG_BG: Record<LogType, React.CSSProperties> = {
  turn: { background: '#1a2a3c', color: '#a5d8ff', borderLeft: '2px solid #4a9eed' },
  nudge: { background: '#2a2a1a', color: '#ffd8a8', borderLeft: '2px solid #f59e0b' },
  diminish: { background: '#3c1a1a', color: '#ffc9c9', borderLeft: '2px solid #ef4444' },
  ok: { background: '#1a3c1a', color: '#b2f2bb', borderLeft: '2px solid #22c55e' },
};

// ─── Component ──────────────────────────────────────────────────────────────

const Case10TokenBudget: React.FC = () => {
  // ── config ──
  const [budget, setBudget] = useState(15000);
  const [threshold, setThreshold] = useState(500);
  const [streakLimit, setStreakLimit] = useState(2);

  // ── display state ──
  const [turnData, setTurnData] = useState<TurnDataPoint[]>([]);
  const [totalOutput, setTotalOutput] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [statusText, setStatusText] = useState('选择场景模拟 Token 消耗');
  const [running, setRunning] = useState(false);

  // ── mutable refs for animation loops ──
  const runningRef = useRef(false);
  const totalRef = useRef(0);
  const turnsRef = useRef<TurnDataPoint[]>([]);
  const logIdRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  // ── helpers ──
  const sleep = useCallback((ms: number) => new Promise<void>((r) => setTimeout(r, ms)), []);

  const addLog = useCallback((text: string, type: LogType) => {
    logIdRef.current += 1;
    setLogs((prev) => [...prev, { id: logIdRef.current, text, type }]);
  }, []);

  const sync = useCallback(() => {
    setTotalOutput(totalRef.current);
    setTurnData([...turnsRef.current]);
  }, []);

  const resetAll = useCallback(() => {
    runningRef.current = false;
    totalRef.current = 0;
    turnsRef.current = [];
    logIdRef.current = 0;
    setRunning(false);
    setTotalOutput(0);
    setTurnData([]);
    setLogs([]);
    setStatusText('选择场景模拟 Token 消耗');
  }, []);

  // auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // ── derived values ──
  const pct = budget > 0 ? Math.min(totalOutput / budget, 1) : 0;
  const gaugeColor = pct < 0.7 ? '#22c55e' : pct < 0.9 ? '#f59e0b' : '#ef4444';

  const inputEst = totalOutput * 15;
  const outFee = (totalOutput / 1e6) * 15;
  const inFee = (inputEst / 1e6) * 3;
  const totalFee = outFee + inFee;
  const feeColor = totalFee > 1 ? '#ef4444' : totalFee > 0.1 ? '#f59e0b' : '#dcdcaa';

  // ── chart data ──
  const chartData: ChartPoint[] = useMemo(() => {
    if (turnData.length === 0) return [];
    const pts: ChartPoint[] = [];
    for (const d of turnData) {
      pts.push({ turn: d.turn, value: d.output, series: 'output', status: d.status });
      pts.push({ turn: d.turn, value: threshold, series: 'threshold', status: 'normal' });
    }
    return pts;
  }, [turnData, threshold]);

  // ── scenarios ──
  const runNormal = useCallback(async () => {
    if (runningRef.current) return;
    resetAll();
    await sleep(30);
    runningRef.current = true;
    setRunning(true);
    setStatusText('正常任务: 逐步消耗 Token，在预算内完成');

    const outputs = [3000, 2500, 2000, 1500, 1000, 800];
    let nudged = false;

    for (let i = 0; i < outputs.length; i++) {
      if (!runningRef.current) break;
      const out = outputs[i];
      totalRef.current += out;
      const cur = totalRef.current;
      const curPct = cur / budget;

      turnsRef.current = [
        ...turnsRef.current,
        { turn: i + 1, output: out, diminishing: false, status: curPct >= 0.9 ? 'below' : 'normal' },
      ];

      addLog(`Turn ${i + 1}: 输出 ${out} Token (累计: ${cur.toLocaleString()})`, 'turn');
      if (!nudged && curPct >= 0.9) {
        nudged = true;
        addLog(
          `⚠ 90% nudge: "已完成 Token 目标的 ${Math.round(curPct * 100)}%。继续工作——不要总结。"`,
          'nudge',
        );
      }
      sync();
      await sleep(600);
    }

    addLog('✓ 任务正常完成', 'ok');
    setStatusText('正常完成: Token 在预算范围内');
    runningRef.current = false;
    setRunning(false);
  }, [budget, resetAll, addLog, sync, sleep]);

  const runRunaway = useCallback(async () => {
    if (runningRef.current) return;
    resetAll();
    await sleep(30);
    runningRef.current = true;
    setRunning(true);
    setStatusText('失控场景: 模型无限续写，烧穿预算');

    let nudged = false;
    for (let i = 0; i < 20; i++) {
      if (!runningRef.current) break;
      const out = 800 + Math.floor(Math.random() * 400);
      totalRef.current += out;
      const cur = totalRef.current;
      const curPct = cur / budget;

      turnsRef.current = [
        ...turnsRef.current,
        { turn: i + 1, output: out, diminishing: false, status: 'normal' },
      ];

      addLog(`Turn ${i + 1}: 输出 ${out} Token (累计: ${cur.toLocaleString()})`, 'turn');
      if (!nudged && curPct >= 0.9) {
        nudged = true;
        addLog('⚠ 90% nudge 注入', 'nudge');
      }

      sync();
      if (curPct >= 1.0) {
        addLog(`🚫 超出预算! ${cur.toLocaleString()} > ${budget.toLocaleString()}`, 'diminish');
        addLog('如果没有预算控制，这里会继续烧钱...', 'diminish');
        break;
      }
      await sleep(350);
    }

    const ft = totalRef.current;
    const ff = (ft / 1e6) * 15 + ((ft * 15) / 1e6) * 3;
    setStatusText(`失控! 消耗 ${ft.toLocaleString()} Token，费用 $${ff.toFixed(2)}`);
    runningRef.current = false;
    setRunning(false);
  }, [budget, resetAll, addLog, sync, sleep]);

  const runDiminishing = useCallback(async () => {
    if (runningRef.current) return;
    resetAll();
    await sleep(30);
    runningRef.current = true;
    setRunning(true);
    setStatusText('递减回报: 输出越来越少，检测到无效循环');

    const outputs = [3000, 2500, 2000, 400, 300, 200];
    let lowStreak = 0;

    for (let i = 0; i < outputs.length; i++) {
      if (!runningRef.current) break;
      const out = outputs[i];
      totalRef.current += out;
      const cur = totalRef.current;
      const isDim = cur > 5000 && out < threshold;

      turnsRef.current = [
        ...turnsRef.current,
        {
          turn: i + 1,
          output: out,
          diminishing: isDim,
          status: isDim ? 'diminishing' : out < threshold ? 'below' : 'normal',
        },
      ];

      addLog(`Turn ${i + 1}: +${out} Token (累计输出: ${cur.toLocaleString()})`, 'turn');

      if (cur > 5000) {
        if (out < threshold) {
          lowStreak++;
          addLog(`  → 增量 < ${threshold}, lowStreak = ${lowStreak}/${streakLimit}`, 'nudge');
          if (lowStreak >= streakLimit) {
            addLog(`🚫 连续 ${lowStreak} 次递减，检测到无效循环！停止续写`, 'diminish');
            sync();
            break;
          }
        } else {
          lowStreak = 0;
          addLog('  → 正常输出', 'ok');
        }
      } else {
        addLog('  → 总输出 < 5000，跳过递减检测', 'ok');
      }

      sync();
      await sleep(600);
    }

    setStatusText(`递减回报检测: 在第 ${turnsRef.current.length} 轮停止，节省了后续无效消耗`);
    runningRef.current = false;
    setRunning(false);
  }, [threshold, streakLimit, resetAll, addLog, sync, sleep]);

  // ── "递减!" label positions for overlay ──
  const diminishLabels = useMemo(() => {
    return turnData.filter((d) => d.diminishing);
  }, [turnData]);

  // ── render ──
  return (
    <div style={S.container}>
      <h2 style={S.title}>Token 预算控制模拟器</h2>

      {/* ── Controls ── */}
      <div style={S.controls}>
        <button style={S.btn(running)} disabled={running} onClick={runNormal}>
          正常任务
        </button>
        <button style={S.btn(running)} disabled={running} onClick={runRunaway}>
          失控场景
        </button>
        <button style={S.btn(running)} disabled={running} onClick={runDiminishing}>
          递减回报
        </button>
        <button style={S.btn(false)} onClick={resetAll}>
          重置
        </button>
        <span style={S.status}>{statusText}</span>
      </div>

      {/* ── Config ── */}
      <div style={S.config}>
        <label style={S.cfgLabel}>
          TOKEN_BUDGET:{' '}
          <input
            style={S.cfgInput}
            type="number"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value) || 15000)}
          />
        </label>
        <label style={S.cfgLabel}>
          递减阈值:{' '}
          <input
            style={S.cfgInput}
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value) || 500)}
          />
        </label>
        <label style={S.cfgLabel}>
          lowStreak限制:{' '}
          <input
            style={S.cfgInput}
            type="number"
            value={streakLimit}
            onChange={(e) => setStreakLimit(Number(e.target.value) || 2)}
          />
        </label>
      </div>

      {/* ── Main area ── */}
      <div style={S.main}>
        {/* Left column */}
        <div style={S.left}>
          {/* Gauge panel */}
          <div style={{ ...S.panel, flex: '0 0 auto', minHeight: 220 }}>
            <div style={S.panelTitle}>Token 预算仪表盘</div>
            <div style={S.gaugeWrap}>
              <div style={{ width: '100%', height: '100%', maxWidth: 300, maxHeight: 180 }}>
                <Gauge
                  data={{
                    target: Math.min(totalOutput, budget),
                    total: budget,
                    name: 'Token Budget',
                  }}
                  autoFit
                  style={{ fill: gaugeColor }}
                  scale={{
                    color: {
                      type: 'threshold',
                      domain: [0.7, 0.9],
                      range: ['#22c55e', '#f59e0b', '#ef4444'],
                    },
                  }}
                />
              </div>
              {/* Custom overlay text */}
              <div style={S.gaugeOverlay}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: gaugeColor }}>
                  {Math.round(pct * 100)}%
                </div>
                <div style={{ fontSize: 11, color: '#858585' }}>
                  {totalOutput.toLocaleString()} / {budget.toLocaleString()}
                </div>
                {pct >= 0.9 && (
                  <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠ 90% nudge 触发</div>
                )}
              </div>
            </div>
          </div>

          {/* Line chart panel */}
          <div style={{ ...S.panel, flex: 1, minHeight: 120 }}>
            <div style={S.panelTitle}>每轮输出趋势</div>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              {chartData.length > 0 ? (
                <>
                  <Line
                    data={chartData}
                    xField="turn"
                    yField="value"
                    seriesField="series"
                    smooth
                    style={{ lineWidth: 2 }}
                    scale={{
                      color: {
                        type: 'ordinal',
                        domain: ['output', 'threshold'],
                        range: ['#4a9eed', '#f59e0b'],
                      },
                    }}
                    axis={{
                      x: {
                        labelFormatter: (v: string) => `#${v}`,
                        style: { labelFill: '#858585', labelFontSize: 9 },
                      },
                      y: {
                        labelFormatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`),
                        style: { labelFill: '#858585', labelFontSize: 9 },
                        tickCount: 5,
                      },
                    }}
                    point={{
                      colorField: 'status',
                      scale: {
                        color: {
                          type: 'ordinal',
                          domain: ['normal', 'below', 'diminishing'],
                          range: ['#4a9eed', '#f59e0b', '#ef4444'],
                        },
                      },
                    }}
                    legend={false}
                    tooltip={false}
                  />
                  {/* Diminishing labels rendered as overlay badges */}
                  {diminishLabels.map((d) => (
                    <div
                      key={`dim-${d.turn}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        fontSize: 10,
                        color: '#ef4444',
                        background: 'rgba(60,26,26,0.85)',
                        padding: '1px 6px',
                        borderRadius: 3,
                        margin: 2,
                        pointerEvents: 'none',
                      }}
                    >
                      #{d.turn} 递减!
                    </div>
                  ))}
                </>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: '#555',
                    fontSize: 12,
                  }}
                >
                  运行场景后显示趋势图
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={S.right}>
          {/* Log panel */}
          <div style={{ ...S.panel, flex: 1 }}>
            <div style={S.panelTitle}>执行日志</div>
            <div ref={logRef} style={S.logArea}>
              {logs.map((l) => (
                <div
                  key={l.id}
                  style={{
                    padding: '4px 8px',
                    margin: '2px 0',
                    borderRadius: 2,
                    animation: 'fadeIn 0.3s',
                    ...LOG_BG[l.type],
                  }}
                >
                  {l.text}
                </div>
              ))}
            </div>
          </div>

          {/* Cost panel */}
          <div style={{ ...S.panel, flex: '0 0 auto' }}>
            <div style={S.panelTitle}>费用估算</div>
            <div style={S.costBox}>
              <div style={S.costRow}>
                <span>累计输出 Token:</span>
                <span style={S.costVal}>{totalOutput.toLocaleString()}</span>
              </div>
              <div style={S.costRow}>
                <span>估算输入 Token (15x):</span>
                <span style={S.costVal}>{inputEst.toLocaleString()}</span>
              </div>
              <div style={S.costRow}>
                <span>输出费用 ($15/M):</span>
                <span style={S.costVal}>${outFee.toFixed(4)}</span>
              </div>
              <div style={S.costRow}>
                <span>输入费用 ($3/M):</span>
                <span style={S.costVal}>${inFee.toFixed(4)}</span>
              </div>
              <div
                style={{
                  ...S.costRow,
                  borderTop: '1px solid #333',
                  paddingTop: 4,
                  marginTop: 4,
                }}
              >
                <span>
                  <b>总费用:</b>
                </span>
                <span style={{ ...S.costVal, color: feeColor }}>${totalFee.toFixed(4)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fade-in keyframes injected once */}
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  );
};

export default Case10TokenBudget;
