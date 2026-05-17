# Tool Call 流式解析
## 问题：参数是碎片
### 模型自回归生成 → JSON 不完整
### content_block_start 时 input 为空
### 后续 delta 逐片推送 JSON 碎片
### 过早解析 = 崩溃
## 碎片拼接过程
### '{"ci' → 不合法
### 'ty":"' → 不合法
### '北京"' → 不合法
### '}' → ✅ JSON.parse 成功
## AI SDK 的处理
### 框架内部自动拼接碎片
### tool-call 事件给出完整参数对象
### 开发者无需手动拼 JSON
## 不同 Provider 差异
### Anthropic: input_json_delta
### OpenAI: tool_calls[].function.arguments
### Google: 不同的字段路径
