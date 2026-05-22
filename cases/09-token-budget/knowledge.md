# 四种循环检测器

## 核心概念

光看参数相同还不够。OpenClaw 设计了**四种检测器**来抓不同类型的死循环，共享一套**三级响应机制**。

四种检测器分工明确：通用重复检测（只告警）、无进展轮询检测、Ping-Pong 检测、全局熔断器（最后防线）。三级响应从温和到强硬：Warning → Critical → Break。

## 关键要点

- **通用重复检测**：同一工具 + 同一参数反复调用，超过阈值告警但**不阻断**（有些工具确实会被合法地反复调用）
- **无进展轮询检测**：同参数 + 同结果 = 没有新信息 = 死循环
- **Ping-Pong 检测**：两个工具交替调用（A→B→A→B），关键判断：**两边的结果都没变化**
- **全局熔断器**：累计 30 次无进展调用，强制停止，没有例外——最后防线永远在线
- 三级响应：Warning（10 次，记日志）→ Critical（20 次，阻断工具）→ Break（30 次，全局熔断）
- 告警不是每次都发，而是**每 10 次发一次**，防刷屏

## 代码解析

本案例演示用降低的阈值（5/8/10）方便观察：

```javascript
// Ping-Pong 检测的核心逻辑
const hash1Results = new Set(
  history.filter(h => h.callHash === hash1).map(h => h.resultHash)
);
const hash2Results = new Set(
  history.filter(h => h.callHash === hash2).map(h => h.resultHash)
);
const noChange = hash1Results.size === 1 && hash2Results.size === 1;
```

Ping-Pong 最巧妙：`read_file → write_file → read_file → write_file`，如果读文件内容每次一样，说明写入没生效——这才是真正的乒乓循环。如果内容变了，说明写入生效了，是正常的读-改流程。

## 延伸思考

- 为什么通用重复检测只告警不阻断？什么场景下同一工具会被合法地反复调用？
- 全局熔断器为什么设 30 次？太低容易误杀，太高浪费 Token。如何平衡？
