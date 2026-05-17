# Tool Call 流式解析：拼碎片

## 核心概念

当模型决定调用工具时，它会输出一个 `tool_use` 类型的内容块。但因为模型是自回归生成的——一个 token 一个 token 蹦——所以你收到的不是一个完整的 JSON，而是一堆 **JSON 碎片**。

`content_block_start` 时 `input` 是空对象 `{}`，真正的参数内容通过后续的 `input_json_delta` 一片一片推过来。每一片都不是合法的 JSON，必须把所有碎片攒起来，等 `content_block_stop` 事件到来时，才能拼成完整的参数对象。

**过早解析 = 崩溃。** 等全部输出完再解析确实安全，但太慢——这就引出了"边说边执行"的优化。

## 关键要点

- 工具调用参数在流式传输中被拆成多个碎片，每个碎片单独看不是合法 JSON
- `content_block_start` 只是个占位符，真正的参数通过后续 delta 推送
- AI SDK 等框架内部自动拼接碎片，在 `tool-call` 事件中给出完整参数对象
- 如果自己解析原始流，必须等所有碎片到齐后再 `JSON.parse()`

## 代码解析

本案例分两部分演示：

**Part 1** 手动展示碎片拼接过程：
```
片段 1: '{"ci'         → 解析失败
片段 2: 'ty":"'        → 解析失败
片段 3: '北京"'        → 解析失败
片段 4: '}'            → 解析成功! city="北京"
```

**Part 2** 使用 `streamText` 展示实际 tool call 流。AI SDK 帮我们处理了拼接，`tool-call` 事件中的 `args` 已经是解析好的对象：

```javascript
case 'tool-call':
  console.log(event.args.city); // 直接可用，无需手动拼接
```

## 延伸思考

- 不同 Provider 的碎片格式不同（Anthropic 用 `input_json_delta`，OpenAI 用 `tool_calls[].function.arguments`），如何设计统一的抽象层？
- 能否在碎片未完全到达时就"预测"完整参数并提前执行工具？风险是什么？
