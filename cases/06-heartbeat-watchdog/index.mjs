/**
 * @title SSE 心跳 + 超时检测
 * @group 容错机制
 * @description 演示如何检测"沉默的杀手"——连接没断但不再推送数据
 */

import { createMockModel } from '../../lib/mock-model.mjs';
import { streamText } from 'ai';

console.log('=== Case 06: SSE 心跳 + 超时检测 ===\n');

console.log('[概念] TCP 连接还活着，但服务器不再推送数据');
console.log('[概念] 这比直接断开更危险 —— 客户端以为一切正常，实际已经"死"了');
console.log('');

// ---- 模拟器 ----
// 用简化的方式模拟服务端心跳和客户端超时检测

class HeartbeatServer {
  constructor(heartbeatInterval, label) {
    this.heartbeatInterval = heartbeatInterval;
    this.label = label;
    this.listeners = [];
    this.running = false;
    this.dataInterval = null;
    this.heartbeatTimer = null;
  }

  onData(fn) { this.listeners.push(fn); }

  start(dataChunks, chunkInterval, stopAfterMs) {
    this.running = true;
    let chunkIdx = 0;
    const startTime = Date.now();

    // 发送数据
    this.dataInterval = setInterval(() => {
      if (!this.running) return;
      if (chunkIdx < dataChunks.length) {
        const msg = dataChunks[chunkIdx++];
        this.listeners.forEach(fn => fn({ type: 'data', data: msg, time: Date.now() - startTime }));
      }
    }, chunkInterval);

    // 发送心跳
    this.heartbeatTimer = setInterval(() => {
      if (!this.running) return;
      this.listeners.forEach(fn => fn({ type: 'heartbeat', time: Date.now() - startTime }));
    }, this.heartbeatInterval);

    // 可选：在指定时间后停止发送
    if (stopAfterMs) {
      setTimeout(() => {
        clearInterval(this.dataInterval);
        clearInterval(this.heartbeatTimer);
        this.dataInterval = null;
        this.heartbeatTimer = null;
        this.running = false;
        this.listeners.forEach(fn => fn({ type: 'stopped', time: Date.now() - startTime }));
      }, stopAfterMs);
    }

    return this;
  }

  stop() {
    this.running = false;
    clearInterval(this.dataInterval);
    clearInterval(this.heartbeatTimer);
  }
}

class TimeoutDetector {
  constructor(timeout, checkInterval) {
    this.timeout = timeout;
    this.checkInterval = checkInterval;
    this.lastDataAt = Date.now();
    this.alive = true;
    this.timer = null;
    this.onTimeout = null;
  }

  feed() {
    this.lastDataAt = Date.now();
  }

  start() {
    this.timer = setInterval(() => {
      const elapsed = Date.now() - this.lastDataAt;
      if (elapsed > this.timeout && this.alive) {
        this.alive = false;
        clearInterval(this.timer);
        if (this.onTimeout) this.onTimeout(elapsed);
      }
    }, this.checkInterval);
    return this;
  }

  stop() {
    clearInterval(this.timer);
  }
}

// ---- 场景 1：正常运行 ----

async function scenario1() {
  console.log('--- Scenario 1: 正常运行 (心跳保活) ---\n');

  const server = new HeartbeatServer(500, 'S1');
  const detector = new TimeoutDetector(1500, 200);
  detector.onTimeout = (elapsed) => {
    console.log(`  [超时检测] 超时! ${elapsed}ms 没有收到数据`);
  };
  detector.start();

  server.onData((event) => {
    detector.feed();
    if (event.type === 'data') {
      console.log(`  [${event.time}ms] 收到数据: "${event.data}"`);
    } else if (event.type === 'heartbeat') {
      console.log(`  [${event.time}ms] 收到心跳 (连接保活)`);
    }
  });

  server.start(
    ['token-1', 'token-2', 'token-3', 'token-4', 'token-5'],
    300,   // 每 300ms 发一个数据
    null   // 不停止
  );

  await new Promise(r => setTimeout(r, 2500));
  server.stop();
  detector.stop();
  console.log(`  结果: 超时检测状态 = ${detector.alive ? '正常' : '超时'} (预期: 正常)\n`);
}

// ---- 场景 2：服务器停止发送 ----

async function scenario2() {
  console.log('--- Scenario 2: 服务器停止发送 (超时检测) ---\n');

  const server = new HeartbeatServer(500, 'S2');
  const detector = new TimeoutDetector(1500, 200);
  let detectedAt = null;
  detector.onTimeout = (elapsed) => {
    detectedAt = Date.now();
    console.log(`  [超时检测] 检测到沉默! ${elapsed}ms 没有收到任何数据或心跳`);
  };
  detector.start();

  server.onData((event) => {
    detector.feed();
    if (event.type === 'data') {
      console.log(`  [${event.time}ms] 收到数据: "${event.data}"`);
    } else if (event.type === 'heartbeat') {
      console.log(`  [${event.time}ms] 收到心跳`);
    } else if (event.type === 'stopped') {
      console.log(`  [${event.time}ms] *** 服务器停止发送 (心跳+数据全部停止) ***`);
    }
  });

  server.start(
    ['token-1', 'token-2', 'token-3'],
    200,   // 每 200ms 发一个数据
    800    // 800ms 后停止一切发送
  );

  await new Promise(r => setTimeout(r, 3000));
  server.stop();
  detector.stop();
  console.log(`  结果: 超时检测到断开 = ${detectedAt ? '是' : '否'} (预期: 是)\n`);
}

// ---- 场景 3：恢复 + "对账" ----

async function scenario3() {
  console.log('--- Scenario 3: 恢复 + "对账" ---\n');

  const server = new HeartbeatServer(500, 'S3');
  const detector = new TimeoutDetector(1500, 200);
  let receivedAfterRecovery = [];

  detector.onTimeout = (elapsed) => {
    console.log(`  [超时检测] 检测到沉默! 开始恢复流程...`);
    console.log(`  [对账]  检查已收到的数据，确认丢失了哪些 token`);
    console.log(`  [对账]  已收到: ${receivedAfterRecovery.join(', ')}`);
    console.log(`  [恢复]  重新建立连接，从断点继续...`);

    // 模拟重新连接
    setTimeout(() => {
      console.log(`  [恢复]  连接重建，继续接收...`);
      server.running = true;
      detector.feed(); // 重置检测器
      detector.alive = true;
      detector.start();
    }, 300);
  };
  detector.start();

  server.onData((event) => {
    detector.feed();
    if (event.type === 'data') {
      receivedAfterRecovery.push(event.data);
      console.log(`  [${event.time}ms] 收到: "${event.data}"`);
    } else if (event.type === 'heartbeat') {
      console.log(`  [${event.time}ms] 心跳`);
    } else if (event.type === 'stopped') {
      console.log(`  [${event.time}ms] *** 服务器停止 ***`);
    }
  });

  server.start(
    ['token-1', 'token-2', 'token-3', 'token-4', 'token-5', 'token-6'],
    200,
    800
  );

  await new Promise(r => setTimeout(r, 4000));
  server.stop();
  detector.stop();
  console.log(`  结果: 最终收到 ${receivedAfterRecovery.length} 个 token\n`);
}

// ---- 运行所有场景 ----

async function main() {
  await scenario1();
  await scenario2();
  await scenario3();

  console.log('--- 要点总结 ---');
  console.log('1. SSE 心跳: 服务器定期发送 ": heartbeat" 注释帧，保持连接活跃');
  console.log('2. 客户端超时检测: 定期检查最后收到数据的时间，超时则判定连接失效');
  console.log('3. 心跳间隔 < 超时阈值: 确保正常情况下检测器不会被误触');
  console.log('4. 检测到断开后需要"对账": 确认哪些数据已收到，哪些需要重传');
  console.log('5. 典型参数: 心跳 15s, 超时 30s, 检查间隔 5s');
}

main().catch(console.error);
