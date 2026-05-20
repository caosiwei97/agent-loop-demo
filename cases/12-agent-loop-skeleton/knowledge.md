# Agent Loop 完整骨架

## 核心概念

把三层防御和七种退出路径串在一起，就是完整的 Agent Loop。三层防御在循环的不同阶段分别守护不同风险，谁也不碍谁，但加在一起就是一张网。

生产级 Agent 至少有七种退出路径：`completed`（正常完成）、`max_turns`（轮次上限）、`aborted_streaming`（用户中断输出）、`aborted_tools`（用户中断工具）、`hook_stopped`（Hook 阻止）、`blocking_limit`（上下文预检拦截）、`prompt_too_long`（API 返回 413）。

## 关键要点

- 第一层防御（死循环检测）在工具执行后检查——调用指纹 + 结果指纹双重判定
- 第二层防御（Token 预算）在每轮结束后检查——90% nudge + 递减回报检测
- 第三层防御（截断恢复）在检测到 `finishReason === 'length'` 时触发——渐进式恢复
- `max_turns` 的检查时机：工具执行完成后、下一轮 API 调用前
- `blocking_limit` 是客户端预检，`prompt_too_long` 是预检漏掉后的恢复机制
- 不管哪种退出，都得告诉用户三件事：停了、为什么停了、能做什么

## 代码解析

本案例是完整的 Agent Loop 骨架，模拟"移除所有 console.log"任务：

```javascript
for (let t = 1; t <= MAX_TURNS && !stopped; t++) {
  const { text, usage, finishReason } = await consumeResult(result);

  // 第一层防御: 检查工具调用的指纹
  const loopResult = checkLoop(tc.toolName, parsedArgs, toolResult);

  // 第二层防御: 检查 Token 预算
  const budgetCheck = checkBudget(outputThisTurn);

  // 第三层防御: 截断恢复
  if (finishReason === 'length') {
    injectRecoveryMessage();
  }
}
```

核心结构是 `for (turn <= MAX_TURNS)` 循环，每轮依次检查三层防御，任何一层触发都会设置 `stopped = true`。

## 延伸思考

- `max_turns` 设多少合适？太少可能完不成任务，太多浪费 Token。根据任务复杂度怎么设？
