/**
 * 共享工具函数
 *
 * 提供指纹计算、流消费、稳定序列化等基础工具。
 */

import { createHash } from 'node:crypto';

/**
 * SHA256 指纹 — 用于工具调用的稳定哈希
 *
 * 关键设计：
 * 1. Object.keys(params).sort() 保证键的顺序不影响结果
 * 2. 只取 SHA256 前 12 位（足够区分，又不会太长）
 *
 * @param {string} name - 工具名
 * @param {object} params - 工具参数
 * @returns {string} 12 位十六进制指纹
 */
export function fingerprint(name, params) {
  const stable = JSON.stringify(params, Object.keys(params || {}).sort());
  return createHash('sha256').update(name + stable).digest('hex').slice(0, 12);
}

/**
 * 计算结果的哈希指纹（用于检测"无进展轮询"）
 *
 * @param {*} result - 工具执行结果
 * @returns {string} 12 位十六进制指纹
 */
export function resultFingerprint(result) {
  const str = JSON.stringify(result);
  return createHash('sha256').update(str).digest('hex').slice(0, 12);
}

/**
 * Sleep 工具函数
 *
 * @param {number} ms - 等待毫秒数
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 安全消费 streamText 结果
 *
 * AI SDK v4 要求先消费流（textStream/fullStream），然后才能 await result.text / result.usage。
 * 此函数封装了这一消费流程。
 *
 * @param {import('ai').StreamTextResult} result - streamText 返回的结果对象
 * @returns {Promise<{text: string, usage: object, finishReason: string}>}
 */
export async function consumeResult(result) {
  let text = '';
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  return {
    text,
    usage: await result.usage,
    finishReason: await result.finishReason,
  };
}

/**
 * 稳定 JSON 序列化（排序键）
 *
 * 保证 {a:1, b:2} 和 {b:2, a:1} 产生相同的字符串。
 *
 * @param {*} value - 要序列化的值
 * @returns {string} 稳定的 JSON 字符串
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
