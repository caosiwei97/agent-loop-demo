# 并发安全调度

## 核心概念

不是所有工具都能"边说边执行"。Claude Code 的处理很讲究：**每个工具、对于每一次具体的输入，都要判断它能不能安全地跟其他工具并发执行。** 这个判断不是按工具类型写死的，而是根据具体输入来决定。

**能并发的尽量并发，不能并发的坚决串行。** 这是安全和性能之间找平衡的核心原则。

## 关键要点

- **Read 文件 / Glob / Grep**：只读不写，天然安全，可并发
- **Edit / Write 文件**：写操作，必须独占执行，等前面所有并发工具完成后再执行
- **Bash 命令**：需要看具体命令判断（`ls` 安全，`npm install` 不安全）
- 结果按模型原始调用顺序返回（A→B→C），而非完成顺序
- **Bash 工具的错误会级联取消兄弟 Bash 命令**，但不影响 Read 类工具

## 代码解析

本案例对比了两种场景的耗时：

**并发读**：3 个 `read_file` 通过 `Promise.all` 同时执行，总耗时 = 最慢的那个：
```javascript
const readResults = await Promise.allSettled([
  mockRead('read_file(src/utils.ts)', 100),
  mockRead('read_file(src/index.ts)', 150),
  mockRead('read_file(package.json)', 80),
]);
```

**串行写**：2 个 `write_file` 必须一个接一个，总耗时 = 所有时间之和。

**级联规则**：`run_bash("npm run build")` 失败 → `run_bash("npm run test")` 被取消 → `read_file` 照常执行。

## 延伸思考

- 同样是 Bash 工具，如何设计规则自动判断 `cat README.md`（安全）和 `npm install`（不安全）？
- 如果工具 A 的输出是工具 B 的输入，怎么在流式过程中自动发现这种依赖关系？
