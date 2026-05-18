import { useState, useRef, useCallback, useEffect } from 'react';

interface TimelineEvent {
  time: number;
  type: 'data' | 'heartbeat' | 'stop' | 'recovery';
  label: string;
}

const MAX_EVENTS = 60;

const styles = {
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
  },
  h2: { color: '#569cd6', fontSize: 16, margin: 0 },
  controls: {
    display: 'flex',
    gap: 8,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
  },
  btn: (active = false) => ({
    background: active ? '#8b5cf6' : '#0e639c',
    color: '#fff',
    border: 'none',
    padding: '7px 14px',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
  }),
  status: { color: '#6a9955', fontSize: 12 },
  sliders: {
    display: 'flex',
    gap: 16,
    fontSize: 11,
    color: '#858585',
    padding: '8px 0',
    borderTop: '1px solid #333',
  },
  sliderGroup: { display: 'flex', alignItems: 'center' as const, gap: 6 },
  sliderVal: { color: '#dcdcaa', minWidth: 40 },
  main: { display: 'flex', flex: 1, gap: 12, overflow: 'hidden' },
  panel: {
    border: '1px solid #333',
    borderRadius: 6,
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  panelTitle: {
    color: '#569cd6',
    fontSize: 11,
    marginBottom: 8,
    borderBottom: '1px solid #333',
    paddingBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  timeoutBar: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 8,
    padding: 8,
    border: '1px solid #333',
    borderRadius: 4,
    marginTop: 8,
  },
  timeoutFill: {
    flex: 1,
    height: 12,
    background: '#333',
    borderRadius: 6,
    overflow: 'hidden',
  },
  eventLog: { flex: 1, overflowY: 'auto' as const, fontSize: 11 },
};

function LogEntry({ text, cls }: { text: string; cls: string }) {
  const bgMap: Record<string, string> = {
    'log-data': '#1a2a3c',
    'log-heartbeat': '#1a3c1a',
    'log-timeout': '#3c1a1a',
    'log-recovery': '#2a2a1a',
    'log-info': '#252526',
  };
  const colorMap: Record<string, string> = {
    'log-data': '#a5d8ff',
    'log-heartbeat': '#b2f2bb',
    'log-timeout': '#ffc9c9',
    'log-recovery': '#ffd8a8',
    'log-info': '#cccccc',
  };
  return (
    <div
      style={{
        padding: '3px 6px',
        margin: '2px 0',
        borderRadius: 2,
        background: bgMap[cls] || '#252526',
        color: colorMap[cls] || '#cccccc',
      }}
    >
      {text}
    </div>
  );
}

function TimelineSVG({ events, maxTime }: { events: TimelineEvent[]; maxTime: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDims({ w: rect.width, h: rect.height });
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = dims;
  if (w <= 0 || h <= 0) {
    return <svg ref={svgRef} style={{ flex: 1, width: '100%' }} />;
  }

  const margin = { top: 20, right: 20, bottom: 30, left: 50 };
  const iw = w - margin.left - margin.right;
  const ih = h - margin.top - margin.bottom;
  const bandH = ih / 3;
  const xScale = (t: number) => (t / maxTime) * iw;

  return (
    <svg ref={svgRef} style={{ flex: 1, width: '100%' }}>
      <g transform={`translate(${margin.left},${margin.top})`}>
        <line x1={0} x2={iw} y1={bandH} y2={bandH} stroke="#333" strokeDasharray="3,3" />
        <line x1={0} x2={iw} y1={bandH * 2} y2={bandH * 2} stroke="#333" strokeDasharray="3,3" />

        <text x={-5} y={bandH * 0.5} textAnchor="end" fill="#858585" fontSize={9}>数据</text>
        <text x={-5} y={bandH * 1.5} textAnchor="end" fill="#858585" fontSize={9}>心跳</text>
        <text x={-5} y={bandH * 2.5} textAnchor="end" fill="#858585" fontSize={9}>事件</text>

        {Array.from({ length: 7 }, (_, i) => {
          const t = (maxTime / 6) * i;
          const tx = xScale(t);
          return (
            <g key={i}>
              <line x1={tx} x2={tx} y1={ih} y2={ih + 5} stroke="#444" />
              <text x={tx} y={ih + 18} textAnchor="middle" fill="#858585" fontSize={9}>
                {(t / 1000).toFixed(1)}s
              </text>
            </g>
          );
        })}

        {events.map((ev, i) => {
          const cx = xScale(ev.time);
          if (ev.type === 'data') {
            return (
              <rect key={i} x={cx - 3} y={bandH * 0.5 - 4} width={6} height={8} rx={2} fill="#4a9eed" opacity={0.8} />
            );
          }
          if (ev.type === 'heartbeat') {
            return (
              <circle key={i} cx={cx} cy={bandH * 1.5} r={4} fill="#22c55e" opacity={0.7} />
            );
          }
          if (ev.type === 'stop') {
            return (
              <g key={i}>
                <line x1={cx} x2={cx} y1={0} y2={ih} stroke="#ef4444" strokeWidth={2} strokeDasharray="4,2" />
                <text x={cx + 4} y={12} fill="#ef4444" fontSize={9}>停止</text>
              </g>
            );
          }
          if (ev.type === 'recovery') {
            return (
              <g key={i}>
                <line x1={cx} x2={cx} y1={0} y2={ih} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4,2" />
                <text x={cx + 4} y={12} fill="#f59e0b" fontSize={9}>恢复</text>
              </g>
            );
          }
          return null;
        })}
      </g>
    </svg>
  );
}

export default function Case06Heartbeat() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [activeBtn, setActiveBtn] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('选择场景开始模拟');
  const [logEntries, setLogEntries] = useState<{ text: string; cls: string }[]>([]);

  const [heartbeatInterval, setHeartbeatInterval] = useState(1500);
  const [timeoutThreshold, setTimeoutThreshold] = useState(3000);
  const [dataInterval, setDataInterval] = useState(800);

  const [timeoutPct, setTimeoutPct] = useState(0);
  const [timeoutElapsed, setTimeoutElapsed] = useState(0);
  const [connStatus, setConnStatus] = useState('活跃');
  const [connColor, setConnColor] = useState('#22c55e');
  const [lastDataAt, setLastDataAt] = useState('-');

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startTimeRef = useRef(0);
  const lastDataRef = useRef(0);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  const addLog = useCallback((text: string, cls: string) => {
    setLogEntries((prev) => {
      const next = [...prev, { text, cls }];
      if (next.length > 100) next.shift();
      return next;
    });
  }, []);

  const feedData = useCallback(
    (type: TimelineEvent['type'], label: string) => {
      const now = Date.now();
      lastDataRef.current = now;
      setLastDataAt(new Date(now).toLocaleTimeString());
      setEvents((prev) => {
        const next = [...prev, { time: now - startTimeRef.current, type, label }];
        if (next.length > MAX_EVENTS) next.shift();
        return next;
      });
    },
    [],
  );

  const stopAll = useCallback(() => {
    setRunning(false);
    clearTimers();
    setStatusText('已停止');
    setConnStatus('已断开');
    setConnColor('#858585');
  }, [clearTimers]);

  const startCheckLoop = useCallback(
    (active: { current: boolean }) => {
      const check = () => {
        if (!active.current) return;
        const elapsed = Date.now() - lastDataRef.current;
        const pct = Math.min(elapsed / timeoutThreshold, 1);
        setTimeoutPct(pct);
        setTimeoutElapsed(elapsed);

        if (elapsed >= timeoutThreshold) {
          setConnStatus('超时!');
          setConnColor('#ef4444');
        }
        timersRef.current.push(setTimeout(check, 50));
      };
      check();
    },
    [timeoutThreshold],
  );

  const startNormal = useCallback(() => {
    const active = { current: true };
    setRunning(true);
    startTimeRef.current = Date.now();
    lastDataRef.current = Date.now();
    setConnStatus('活跃');
    setConnColor('#22c55e');
    setStatusText('正常运行: 心跳+数据持续推送');
    setActiveBtn('normal');
    setLogEntries([]);
    setEvents([]);
    addLog('连接建立，开始接收数据', 'log-info');

    const dTimer = setInterval(() => {
      if (!active.current) return;
      feedData('data', 'token');
      addLog('收到数据: text_delta', 'log-data');
    }, dataInterval);

    const hTimer = setInterval(() => {
      if (!active.current) return;
      feedData('heartbeat', '♥');
      addLog(': heartbeat (SSE注释帧)', 'log-heartbeat');
    }, heartbeatInterval);

    timersRef.current.push(setTimeout(() => { clearInterval(dTimer); clearInterval(hTimer); active.current = false; }, 15000) as unknown as ReturnType<typeof setTimeout>);
    timersRef.current.push(dTimer as unknown as ReturnType<typeof setTimeout>);
    timersRef.current.push(hTimer as unknown as ReturnType<typeof setTimeout>);

    startCheckLoop(active);
  }, [dataInterval, heartbeatInterval, feedData, addLog, startCheckLoop]);

  const startSilent = useCallback(() => {
    const active = { current: true };
    setRunning(true);
    startTimeRef.current = Date.now();
    lastDataRef.current = Date.now();
    setConnStatus('活跃');
    setConnColor('#22c55e');
    setStatusText('沉默故障: 2s后停止推送，观察超时检测');
    setActiveBtn('silent');
    setLogEntries([]);
    setEvents([]);
    addLog('连接建立', 'log-info');

    const dTimer = setInterval(() => {
      if (!active.current) return;
      feedData('data', 'token');
      addLog('收到数据: text_delta', 'log-data');
    }, dataInterval);

    const hTimer = setInterval(() => {
      if (!active.current) return;
      feedData('heartbeat', '♥');
      addLog(': heartbeat', 'log-heartbeat');
    }, heartbeatInterval);

    timersRef.current.push(dTimer as unknown as ReturnType<typeof setTimeout>);
    timersRef.current.push(hTimer as unknown as ReturnType<typeof setTimeout>);

    const stopTimer = setTimeout(() => {
      clearInterval(dTimer);
      clearInterval(hTimer);
      addLog('*** 服务端停止推送 (网络抖动/进程挂起) ***', 'log-timeout');
      setEvents((prev) => [...prev, { time: Date.now() - startTimeRef.current, type: 'stop', label: '停止' }]);

      const detectTimer = setTimeout(() => {
        if (!active.current) return;
        addLog(`超时检测触发! ${timeoutThreshold}ms 未收到任何数据`, 'log-timeout');
        addLog('判定: 连接失效 (TCP半开状态)', 'log-timeout');
        setStatusText('沉默故障已检测到!');
      }, timeoutThreshold);
      timersRef.current.push(detectTimer);
    }, 2000);
    timersRef.current.push(stopTimer);

    startCheckLoop(active);
  }, [dataInterval, heartbeatInterval, timeoutThreshold, feedData, addLog, startCheckLoop]);

  const startRecovery = useCallback(() => {
    const active = { current: true };
    setRunning(true);
    startTimeRef.current = Date.now();
    lastDataRef.current = Date.now();
    setConnStatus('活跃');
    setConnColor('#22c55e');
    setStatusText('恢复对账: 断开后重连并验证数据');
    setActiveBtn('recovery');
    setLogEntries([]);
    setEvents([]);
    addLog('连接建立', 'log-info');

    let dataCount = 0;
    const dTimer = setInterval(() => {
      if (!active.current) return;
      dataCount++;
      feedData('data', `t${dataCount}`);
      addLog(`收到数据 #${dataCount}`, 'log-data');
    }, dataInterval);

    const hTimer = setInterval(() => {
      if (!active.current) return;
      feedData('heartbeat', '♥');
    }, heartbeatInterval);

    timersRef.current.push(dTimer as unknown as ReturnType<typeof setTimeout>);
    timersRef.current.push(hTimer as unknown as ReturnType<typeof setTimeout>);

    const stopTimer = setTimeout(() => {
      clearInterval(dTimer);
      clearInterval(hTimer);
      addLog('*** 连接中断 ***', 'log-timeout');
      setEvents((prev) => [...prev, { time: Date.now() - startTimeRef.current, type: 'stop', label: '中断' }]);

      const detectTimer = setTimeout(() => {
        if (!active.current) return;
        addLog(`超时检测: ${timeoutThreshold}ms 无数据`, 'log-timeout');
        addLog(`对账: 已收到 ${dataCount} 个数据块`, 'log-recovery');
        addLog('等待 2s 后向服务端确认...', 'log-recovery');

        const recoveryTimer = setTimeout(() => {
          if (!active.current) return;
          addLog('对账完成: 服务端确认全部处理完毕', 'log-recovery');
          addLog('结论: 用服务端持久化数据覆盖前端状态', 'log-recovery');
          feedData('recovery', '✓');
          setConnStatus('已恢复');
          setConnColor('#f59e0b');
          setStatusText('对账恢复完成');
        }, 2000);
        timersRef.current.push(recoveryTimer);
      }, timeoutThreshold);
      timersRef.current.push(detectTimer);
    }, 2500);
    timersRef.current.push(stopTimer);

    startCheckLoop(active);
  }, [dataInterval, heartbeatInterval, timeoutThreshold, feedData, addLog, startCheckLoop]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const maxTime = Math.max(events.length > 0 ? Math.max(...events.map((e) => e.time)) : 3000, 3000);
  const barColor = timeoutPct < 0.5 ? '#22c55e' : timeoutPct < 0.8 ? '#f59e0b' : '#ef4444';

  return (
    <div style={styles.container}>
      <h2 style={styles.h2}>SSE 心跳 + 超时检测 — 实时模拟</h2>
      <div style={styles.controls}>
        <button style={styles.btn(activeBtn === 'normal')} onClick={startNormal}>正常运行</button>
        <button style={styles.btn(activeBtn === 'silent')} onClick={startSilent}>沉默故障</button>
        <button style={styles.btn(activeBtn === 'recovery')} onClick={startRecovery}>恢复对账</button>
        <button style={styles.btn()} onClick={stopAll}>停止</button>
        <span style={styles.status}>{statusText}</span>
      </div>
      <div style={styles.sliders}>
        <div style={styles.sliderGroup}>
          <label>心跳间隔:</label>
          <input
            type="range" min={500} max={3000} value={heartbeatInterval} step={100}
            style={{ width: 100, accentColor: '#569cd6' }}
            onChange={(e) => setHeartbeatInterval(+e.target.value)}
          />
          <span style={styles.sliderVal}>{heartbeatInterval}ms</span>
        </div>
        <div style={styles.sliderGroup}>
          <label>超时阈值:</label>
          <input
            type="range" min={1000} max={6000} value={timeoutThreshold} step={200}
            style={{ width: 100, accentColor: '#569cd6' }}
            onChange={(e) => setTimeoutThreshold(+e.target.value)}
          />
          <span style={styles.sliderVal}>{timeoutThreshold}ms</span>
        </div>
        <div style={styles.sliderGroup}>
          <label>数据间隔:</label>
          <input
            type="range" min={200} max={2000} value={dataInterval} step={100}
            style={{ width: 100, accentColor: '#569cd6' }}
            onChange={(e) => setDataInterval(+e.target.value)}
          />
          <span style={styles.sliderVal}>{dataInterval}ms</span>
        </div>
      </div>
      <div style={styles.main}>
        <div style={{ ...styles.panel, flex: 1.5 }}>
          <div style={styles.panelTitle}>时间轴 — 服务端推送</div>
          <TimelineSVG events={events} maxTime={maxTime} />
        </div>
        <div style={{ ...styles.panel, flex: 1 }}>
          <div style={styles.panelTitle}>客户端状态</div>
          <div style={styles.timeoutBar}>
            <span style={{ fontSize: 11, color: '#858585' }}>超时进度:</span>
            <div style={styles.timeoutFill}>
              <div style={{
                height: '100%',
                borderRadius: 6,
                width: `${timeoutPct * 100}%`,
                background: barColor,
                transition: 'width 0.1s, background 0.3s',
              }} />
            </div>
            <span style={{ fontSize: 11, color: '#858585', minWidth: 80, textAlign: 'right' }}>
              {Math.round(timeoutElapsed)}ms / {timeoutThreshold}ms
            </span>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#858585' }}>
            <div>lastDataAt: <span style={{ color: '#dcdcaa' }}>{lastDataAt}</span></div>
            <div>连接状态: <span style={{ color: connColor }}>{connStatus}</span></div>
          </div>
          <div style={{ ...styles.panelTitle, marginTop: 12 }}>事件日志</div>
          <div style={styles.eventLog}>
            {logEntries.map((entry, i) => (
              <LogEntry key={i} text={entry.text} cls={entry.cls} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
