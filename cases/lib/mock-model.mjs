/**
 * Mock AI SDK 模型工厂
 *
 * 基于 Vercel AI SDK v4 的 MockLanguageModelV1，
 * 为教学案例提供可控的模拟模型。
 */

import { MockLanguageModelV1, simulateReadableStream } from 'ai/test';

/**
 * 创建一个 Mock 模型，返回预设的流式 chunks
 *
 * @param {Array} chunks - 流式响应的 chunks 数组
 * @param {object} [opts] - 可选配置
 * @param {number} [opts.chunkDelay=30] - 每个 chunk 之间的延迟(ms)，模拟流式输出
 *
 * chunk 格式：
 *   { type: 'text-delta', textDelta: '文本' }
 *   { type: 'tool-call', toolCallType: 'function', toolCallId: 'call_1', toolName: '工具名', args: '{"key":"value"}' }
 *   { type: 'finish', finishReason: 'stop'|'tool-calls'|'length', usage: { promptTokens: N, completionTokens: N } }
 */
export function createMockModel(chunks, opts = {}) {
  const { chunkDelay = 30 } = opts;
  return new MockLanguageModelV1({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks, chunkDelayInMs: chunkDelay }),
    }),
  });
}

/**
 * 创建多轮对话 Mock 模型
 *
 * 每次调用 doStream 返回不同的响应，模拟 Agent Loop 中的多轮交互。
 *
 * @param {Array<Array>} scenarios - 每个元素是一轮的 chunks 数组
 *
 * 使用示例：
 *   const model = createMultiTurnModel([
 *     // 第1轮：模型输出文字 + 调用工具
 *     [
 *       { type: 'text-delta', textDelta: '让我查一下...' },
 *       { type: 'tool-call', toolCallType: 'function', toolCallId: 'c1', toolName: 'get_weather', args: '{"city":"北京"}' },
 *       { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 5, completionTokens: 20 } },
 *     ],
 *     // 第2轮：模型根据工具结果输出最终答案
 *     [
 *       { type: 'text-delta', textDelta: '北京今天是晴天...' },
 *       { type: 'finish', finishReason: 'stop', usage: { promptTokens: 15, completionTokens: 30 } },
 *     ],
 *   ]);
 */
export function createMultiTurnModel(scenarios) {
  let callIndex = 0;
  return new MockLanguageModelV1({
    doStream: async () => {
      const chunks = scenarios[Math.min(callIndex, scenarios.length - 1)];
      callIndex++;
      return {
        stream: simulateReadableStream({ chunks, chunkDelayInMs: 30 }),
      };
    },
  });
}

/**
 * 创建会出错的 Mock 模型（用于重试/容错案例）
 *
 * @param {object} opts
 * @param {number} [opts.failCount=2] - 前几次调用会失败
 * @param {Error} [opts.error] - 抛出的错误（默认 429 Too Many Requests）
 * @param {Array} [opts.successChunks] - 成功时返回的 chunks
 */
export function createFailingModel(opts = {}) {
  const {
    failCount = 2,
    error = new Error('429 Too Many Requests'),
    successChunks = [
      { type: 'text-delta', textDelta: '重试成功！这是最终响应。' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 5, completionTokens: 10 } },
    ],
  } = opts;

  let callIndex = 0;
  return new MockLanguageModelV1({
    doStream: async () => {
      callIndex++;
      if (callIndex <= failCount) throw error;
      return {
        stream: simulateReadableStream({ chunks: successChunks, chunkDelayInMs: 30 }),
      };
    },
  });
}

/**
 * 创建模拟截断的 Mock 模型（用于截断恢复案例）
 *
 * @param {object} opts
 * @param {number} [opts.truncateCount=2] - 前几次返回 length 截断
 * @param {string} [opts.truncatedText] - 截断时输出的文本
 * @param {Array} [opts.finalChunks] - 最终正常完成的 chunks
 */
export function createTruncatingModel(opts = {}) {
  const {
    truncateCount = 2,
    truncatedText = '这是一段非常长的输出内容，包含了大量的分析细节...',
    finalChunks = [
      { type: 'text-delta', textDelta: '好的，以下是关键结论：...' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 100 } },
    ],
  } = opts;

  let callIndex = 0;
  return new MockLanguageModelV1({
    doStream: async () => {
      callIndex++;
      if (callIndex <= truncateCount) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-delta', textDelta: truncatedText },
              { type: 'finish', finishReason: 'length', usage: { promptTokens: 5, completionTokens: 8192 } },
            ],
            chunkDelayInMs: 30,
          }),
        };
      }
      return {
        stream: simulateReadableStream({ chunks: finalChunks, chunkDelayInMs: 30 }),
      };
    },
  });
}
