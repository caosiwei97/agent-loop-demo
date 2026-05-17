# Agent Loop 深度分享：流式响应、容错机制与运行时安全

---

## 引子

在几年前经典的 `ReAct` 模式下，假如让 Agent 把项目里的 moment 全部替换成 dayjs，过程是这样：

```
Thought: 先找哪些文件用了 moment
Action:  Grep("moment")
Observation: 找到 12 个文件                     ← 必须等结果回来

Thought: 看第一个文件
Action:  Read("src/index.ts")
Observation: import moment from 'moment'...      ← 必须等结果回来

Thought: 替换
Action:  Edit("src/index.ts", ...)
Observation: 完成                                ← 必须等结果回来
...重复 11 次
```

每一步都在等——等模型想完、等工具返回。串行跑下来，光等待就能吃掉 20 秒。这就是 `ReAct` 的"思考→行动→观察"三段循环，逻辑虽然清晰，但整个流程是串行执行的。

如今用 Claude Code 来做，整个过程非常丝滑：文字流式输出，紧接着就是工具调用，读、改文件、然读下一个文件，几乎感觉不到等待。LLM 还在生成第二个工具调用的参数时，第一个工具可能就已经跑完返回了。

这不是模型变快了，是"边生成边执行"的调度在起作用。流式架构在串行链条的每一段里都插入了并行，把等待时间压到最小。

这段体验的差距，不是模型能力的差距——是 Agent Loop 架构的差距。`ReAct` 是"想一步、做一步、等一步"；而如今的 Agent Loop 是"边想边做、该等的等、不该等的不等"。差距怎么产生的？靠的是三个核心机制：

![Agent Loop 三大核心机制](assets/overview.excalidraw)

1. **流式响应**——怎么让模型和工具"边说边干"？
2. **容错机制**——`API` 挂了怎么办？
3. **运行时安全**——Agent 自己失控了怎么办？

Agent Loop 不只是"循环调模型"——它要管模型和工具怎么协作、`API` 挂了怎么活下来、Agent 自己跑飞了怎么拉回来。这就是我这篇文章要讲述的事情。

---

## 一、流式响应的工程真相

### 为什么是 `SSE`，不是 `WebSocket`？

所有主流 LLM `API` 都用 `SSE` 做流式响应，原因很直接：LLM 流式输出就是服务器往客户端推 `token`，客户端只需要听。**单向推送，`SSE` 天然适合。**

`WebSocket` 是双向管道，对 LLM 场景来说属于杀鸡用牛刀。而且 `SSE` 有几个实在的好处：跑在标准 `HTTP` 上不需要协议升级，自带 `Last-Event-ID` 重连机制，每次请求都可以验证身份。`SSE` 格式也朴素——`event:` 标类型，`data:` 放 `JSON`，空行结束。

### 模型流式输出的时候，你收到的到底是什么？

以 Anthropic 的 `API` 为例，一次完整的流式响应，事件流长这样：

```
1. message_start        → 一条新消息开始了
2. content_block_start  → 一个内容块开始了（文本块 or 工具调用块）
3. content_block_delta  → token 一个个推过来："你" "好" "，" "我" "来" "..."
4. content_block_delta  → 继续推...
5. content_block_stop   → 这个内容块结束了
6. message_delta        → 元信息（为什么停了、用了多少 token）
7. message_stop         → 整条消息结束了
```

如果模型只是回复一段文字，把 delta 里的文本拼起来渲染就完事——你在 ChatGPT 或 Claude 网页版看到的"打字机效果"就是这个原理。

**但 Agent 不只是吐文字——Agent 要调工具。**

### Tool Call 的流式解析：拼碎片

这是流式架构里最有意思的部分。

模型决定调用工具时，会输出一个 `tool_use` 类型的内容块。但模型是自回归生成的，一个 `token` 一个 `token` 蹦，所以你收到的不是完整 `JSON`，而是一堆碎片：

```
content_block_start → {"type": "tool_use", "name": "read_file", "input": {}}

content_block_delta → partial_json: '{"file*'
content_block_delta → partial_json: 'path": "'
content_block_delta → partial_json: 'src/uti'
content_block_delta → partial_json: 'ls.ts"}'

content_block_stop  → （结束）
```

`content_block_start` 时 `input` 是空对象，真正的参数通过后续 delta 一片一片推过来。`'{"file*'` 算什么 `JSON`？什么都不算。必须等 `content_block_stop` 后把碎片拼成完整的 `{"file_path": "src/utils.ts"}`，才能 `JSON.parse()`。

**过早解析 = 崩溃。**

### "边说边执行"

最简单的做法：等整条消息说完再依次执行工具。早期 Agent 大多这么干，逻辑简单不易出错。但生产级 Agent 会做一个关键优化：**工具块一完成就立刻开始执行，不等整条消息说完。**

假设模型一次回复要做三件事：输出文字、`Read` 文件 A、`Read` 文件 B、`Read` 文件 C。

```mermaid
sequenceDiagram
    participant M as 模型
    participant A as Agent Runtime
    participant T1 as Tool: Read A
    participant T2 as Tool: Read B
    participant T3 as Tool: Read C

    Note over M,A: 模型开始流式输出
    M->>A: 文本："好的，我来看看..."

    rect rgb(220, 240, 255)
        Note right of M: 工具块完成即执行
        M-->>A: tool_call_1 完成
        A->>T1: 立即执行 Read A
        M-->>A: tool_call_2 完成
        A->>T2: 立即执行 Read B
        T1-->>A: A 结果返回
        M-->>A: tool_call_3 完成
        A->>T3: 立即执行 Read C
        T2-->>A: B 结果返回
        T3-->>A: C 结果返回
    end

    M->>A: 分析结果，输出总结
```

工具执行和后续调用的生成在时间上**重叠**。读 5 个文件的任务，感知延迟能减 30-50%。

但不是所有工具都能并行——有些之间有依赖关系，比如先 `Read` 才能 `Edit`。所以需要并发安全判断。

#### 并发安全判断

| 工具类型 | 并发策略 | 原因 |
|---------|---------|------|
| `Read` / `Glob` / `Grep` | 可并发 | 只读不写 |
| `Edit` | **独占执行** | 写操作，等所有并发工具完成后再执行 |
| `Bash` | 看具体命令 | `ls` 安全，`npm install` 不安全 |

这个判断不是按工具类型写死的，而是根据具体输入来决定。同一个 `Bash` 工具，`cat README.md` 可以并发，`rm -rf node_modules` 不行。

**能并发的尽量并发，不能并发的坚决串行。**

#### 结果按调用顺序返回

多个工具并发执行时，结果按**模型原始调用顺序**返回，不是按完成顺序。

`Read` A（0.5s）、`Read` B（0.1s）、`Read` C（0.3s），完成顺序 B→C→A，返回顺序 A→B→C。`API` 层面靠 `tool_use_id` 匹配，打乱顺序模型也不会搞混。保持顺序主要是工程层面的好处——日志里调用和结果一一对应，排查问题轻松。

#### `Bash` 工具的错误会级联取消

模型同时调了 `mkdir -p src/components`、`touch src/components/Button.tsx`、`Read package.json`。如果 mkdir 失败，touch 也被取消（依赖 mkdir 创建的目录），但 `Read` 不受影响。

只有 `Bash` 的错误会级联——shell 命令之间常有依赖链（`mkdir → cd → 创建文件`），而读文件、搜索这类操作通常是独立的。

### 工具审批：两次 `SSE` 流之间的空隙

Agent 执行工具前需要用户确认（比如 Claude Code 里改文件前的 y/n 提示），看起来需要双向通信。`SSE` 不是单向的吗？

关键点：**模型调用工具时，流式响应自然就结束了。** `API` 返回 `stop_reason: "tool_use"`，`SSE` 流正常关闭——不是你去"打断"它，是它自己停的。审批发生在两次 `SSE` 流之间的空隙里。

```mermaid
sequenceDiagram
    participant U as 用户
    participant C as 客户端
    participant S as 服务端
    participant API as LLM API

    rect rgb(220, 255, 220)
        Note over C,API: 流式输出
        S->>API: SSE 请求
        API-->>C: SSE 流：文字 + tool_use
        Note over C: stop_reason = "tool_use"<br/>SSE 流自然结束
    end

    rect rgb(255, 248, 220)
        Note over U,C: 审批
        C->>U: "要修改 src/app.ts？"
        U->>C: 允许
    end

    rect rgb(220, 240, 255)
        Note over C,API: 执行 + 新流
        C->>S: HTTP POST（tool_result）
        S->>S: 执行工具
        S->>API: 带工具结果，新 SSE 请求
        API-->>C: 新 SSE 流
    end
```

`SSE` 推数据，`HTTP` `POST` 回传数据——两个单向通道叠起来就是双向通信。从头到尾不需要 `WebSocket`。

`CLI` 场景更简单：工具在本地执行，审批就是读一个键盘输入，连 `HTTP` 请求都不需要。

审批是低频事件——一个会话里可能 80% 的工具调用都自动放行。如果模型一次返回多个工具调用，不需要审批的先并发执行，需要审批的排队等用户逐个确认。

### 流式文本分段推送

模型一个 `token` 一个 `token` 往外蹦，收到一个就推一个会导致消息碎成一个个字，在 Slack、Discord 这类平台上频繁更新还会闪烁。`OpenClaw` 的做法是设缓冲区，攒够一定量后找自然断点切一刀推出去——优先找段落边界，其次找句号，再次找空白处。超过上限（默认 800 字符）强制切，但会先把代码块关上、下一段重新打开，保证两段 `Markdown` 都能正常渲染。

### 不同提供商的流式协议差异

如果你的 Agent 要支持多个模型提供商，各家的流式协议不一样：

- **Anthropic**：带 `event:` 类型，`input_json_delta` 推 `JSON` 碎片，`message_stop` 结束
- **OpenAI**：无 `event:` 行，从 `JSON` 判断类型，`data: [DONE]` 结束
- **Google Gemini**：数据块更大，带额外信息

本质上都是 `JSON` 碎片拼接，但字段路径和事件结构不同。`OpenClaw` 和 `Vercel AI SDK` 都在做同一件事——对每个提供商写流适配器，统一内部格式。

---

## 二、`API` 挂了怎么办

### 错误先分类，再决定怎么处理

不是所有错误都值得重试。`429` 限流等一等就好，`401` 密钥过期等多久都没用。

| 类型 | 状态码 | 怎么办 |
|------|--------|--------|
| **可重试** | `429`、`529`/`503`、`408`、`ECONNRESET` | 指数退避重试 |
| **不可重试** | `400`、`401`/`403`、`402` | 直接报错 |
| **需要降级** | 连续多次 `529`、流式反复断开 | 换策略 |

最差的做法：不分青红皂白 `while + sleep`。`429` 越重试越限流，`401` 重试到天荒地老也没用。

### 指数退避 + 随机抖动

1000 个并发用户同时收到 `429`，如果都等 1 秒后重试——1000 个请求同时打回去，又 `429`。这是**重试风暴**。

指数退避解决"等多久"（500ms → 1s → 2s，翻倍递增），随机抖动解决"别扎堆"（加随机偏移打散请求）。Claude Code 基础退避 500ms，最多重试 10 次。

服务端返回的 `Retry-After` 头比客户端自己算的更准——服务端更清楚自己什么时候能恢复，应该优先使用。

```javascript
function getRetryDelay(attempt) {
  const base = 500;
  const max = 30_000;
  const delay = base * Math.pow(2, attempt);
  const jitter = Math.random() * delay * 0.25;
  return Math.min(delay + jitter, max);
}

async function retryWithBackoff(fn, maxRetries = 10) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      // Retry-After 优先于自己算的退避时间
      const retryAfter = error.headers?.get('retry-after');
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : getRetryDelay(attempt);
      console.log(`Retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

### 沉默的杀手：`SSE` 连接卡住

比 `529` 更让人头疼的故障：连接没报错也没断开，但不再推送数据了。用户看到 AI 输出到一半停住，光标在闪，界面显示"正在生成"——等多久都不会有新内容。

这是 `TCP` 的半开状态。网络抖动后客户端 `TCP` 连接可能已失效，但浏览器不知道。`reader.read()` 一直挂起，`try-catch` 捕获不到任何错误——因为没有错误发生，只是在"等"。

解法：**服务端心跳 + 客户端超时检测**

```javascript
// 服务端：定期发心跳（SSE 注释行，不触发客户端事件）
const heartbeat = setInterval(() => {
  res.write(': heartbeat\n\n');
}, 15_000);

// 客户端：记录最后收到数据的时间，超时则判定失效
const TIMEOUT = 30_000;
let lastDataAt = Date.now();

const timer = setInterval(() => {
  if (Date.now() - lastDataAt > TIMEOUT) {
    clearInterval(timer);
    reader.cancel();
  }
}, 5_000);

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  lastDataAt = Date.now();
}
clearInterval(timer);
```

服务端心跳间隔（15s）必须显著小于客户端超时阈值（30s）。正常情况不误判，断网时最多 30 秒检测到。整个请求生命周期都需要保持心跳——模型推理、工具执行、数据库写入，这些环节都可能有数秒甚至十几秒的静默期。

检测到中断后不要立刻重发请求——服务端可能已经处理完了，只是响应没传回来。正确的恢复流程是先跟持久化层**对账**：等几秒 → 从数据库拉最终状态 → 用数据库数据覆盖前端状态。服务端持久化数据是 `source of truth`，前端流式收到的只是"预览"。

心跳保活、超时检测、对账恢复——三个环节缺一不可。没有心跳，超时检测会在正常的长耗时操作中误判；没有超时检测，半开连接会让用户永久卡住；没有对账，恢复时可能产生重复数据。

### 流式中断后，已接收的内容怎么处理？

连接推了一部分就断了，手里有半成品。处理原则按完整性区分：

| 内容状态 | 处理方式 |
|---------|---------|
| 完整的工具调用（`JSON` 已闭合） | 保留，可正常执行 |
| 不完整的工具调用 | 丢弃，无法解析 |
| 已显示给用户的文本 | 保留，删掉更困惑 |

重试前需要对已执行的工具调用做去重，避免重试时执行两次。

### 三层降级链

光有重试不够。Agent 的容错是分层的——每一层处理不同级别的故障，内层解决不了的才升级到外层。

```mermaid
graph TB
    subgraph L1["Layer 1: 流式重试"]
        L1A[指数退避<br/>最多 10 次]
        L1B{连续失败?}
        L1A --> L1B
    end

    subgraph L2["Layer 2: 非流式降级"]
        L2A[切换非流式请求<br/>超时 120s]
        L2B{连续 3 次 529?}
        L2A --> L2B
    end

    subgraph L3["Layer 3: 模型降级"]
        L3A[Opus → Sonnet<br/>只改 model 字段]
    end

    L1B -->|是| L2A
    L2B -->|是| L3A

    style L1 fill:#e5dbff,stroke:#8b5cf6
    style L2 fill:#fff3bf,stroke:#f59e0b
    style L3 fill:#ffc9c9,stroke:#ef4444
```

偶发的网络错误靠重试消化，持续的流式故障靠协议降级应对，模型级别的过载靠模型切换兜底。

流式失败转非流式为什么有效？流式需要维持长连接，对服务端连接池和内存压力更大。切换到非流式变成一次性请求-响应，对服务端更友好。

模型降级为什么有效？不同模型通常有独立的算力配额——Opus 过载不代表 Sonnet 也过载。同一提供商的模型共享消息格式，换模型只改一个 `model` 字段，上下文完全不需要重建。

Claude Code 有个细节：流式转非流式时会把已积累的 `529` 次数传过去，两层的失败预算是连续的，不是各算各的。

### 多 Provider 容灾

如果你的产品同时接了多家 `API` 提供商，回旋空间就大多了。`OpenClaw` 支持 Anthropic、OpenAI、Google、本地 Ollama 等，几个工程决策值得注意。

**临时故障 vs 持久故障**：限流过载走指数退避（1min → 5min → 25min，封顶 1hr）；账户欠费或密钥失效退避基数直接拉到 5hr——这种故障需要人工介入，拉长冷却避免白白重试。

**兄弟模型 Failover**：

```mermaid
graph LR
    A[Sonnet 4.6 限流] --> B{兄弟模型 Failover}
    B --> C[Sonnet 4.5]
    B --> D[Haiku]
    B --> E{都不行?}
    E --> F[跨 Provider 切换<br/>OpenAI / Google]

    style A fill:#ffc9c9,stroke:#ef4444
    style C fill:#b2f2bb,stroke:#22c55e
    style D fill:#b2f2bb,stroke:#22c55e
    style F fill:#ffd8a8,stroke:#f59e0b
```

Sonnet 4.6 限流了，先试同 Provider 的 Sonnet 4.5 或 Haiku。`API` 速率限制通常按模型区分，Sonnet 4.6 满了不代表 Haiku 也满了。兄弟模型切换成本远低于跨 Provider——消息格式一致，上下文不需要转换。

但只有 `rate_limit` 和 `overloaded` 才值得走兄弟模型。`billing` 和 `auth` 是 Provider 级别的问题，同一家的其他模型也一样不可用。

---

## 三、Agent 自己失控了怎么办

`API` 没挂，但 Agent 自己出问题了。最常见的三种：**死循环、`Token` 烧穿、输出截断。**

假设你让 Agent 把所有 `console.log` 替换成 `logger.info`。它改完一个文件后，发现"还有 console.log"（因为 `logger.info` 这个字符串恰好包含 `log`），于是又改了一遍，然后又读了一遍，又改了一遍……15 分钟后跑了 200 轮，烧了 $50 `Token`，文件面目全非。

这不是假设——是生产环境里 Agent 失控最典型的方式。

### 保险丝 1：死循环检测

死循环最危险的地方在于它**看起来在正常工作**。日志里全是成功的工具调用，你不仔细看根本发现不了在原地踏步。

怎么判断工具调用是否重复？直接比参数太慢（参数可能是整个文件内容），`OpenClaw` 的做法是**哈希指纹**：

```
指纹 = SHA256(工具名 + 稳定序列化(参数))
```

稳定序列化要注意 key 排序——`JavaScript` 里 `{a:1, b:2}` 和 `{b:2, a:1}` 序列化结果可能不同，哈希前必须先排序。

但光看参数相同还不够。读同一个文件 10 次，每次内容不同（有其他进程在改），这不算死循环——每次都有新信息。所以同时记录**调用指纹 + 结果指纹**，只有"同样调用 + 同样结果"才算无进展。

打个比方：打电话给客服 10 次，每次答复都是"正在处理中"——这是死循环。每次得到不同进展信息——这是正常跟进。

```javascript
import { createHash } from 'node:crypto';

function fingerprint(name, params) {
  const stable = JSON.stringify(params, Object.keys(params || {}).sort());
  return createHash('sha256').update(name + stable).digest('hex').slice(0, 12);
}
```

#### 四种检测器

| 检测器 | 抓什么 | 怎么判 |
|--------|-------|--------|
| **通用重复检测** | 同一工具 + 同一参数反复调用 | 超 10 次告警（不阻断，可能合法） |
| **无进展轮询** | 轮询类工具反复查，结果不变 | 参数一样 + 结果也一样 |
| **Ping-Pong** | 两工具交替调用（A→B→A→B） | 双方结果都没变化 |
| **全局熔断** | 任何形式的累计无进展 | 30 次无进展，强制停止 |

通用重复检测只告警不阻断——`read_file` 被相同参数调多次可能只是 Agent 在不同推理步骤重新读取，属于合法场景。所以这个检测器的定位是"提醒"，不是"执法"。

无进展轮询检测更多是防御性设计——比如 Agent 启动了一个后台任务，然后不停地查部署状态、检查健康检查。如果每次查到的状态都一样，这就是无进展的轮询。你不一定会频繁遇到，但一旦遇到（模型误判某个任务没完成，反复查同一个状态），没有这根保险丝就会烧 `Token`。

Ping-Pong 检测最巧妙——开头那个 console.log 例子就是典型的 `read_file → write_file → read_file → write_file`。检测算法从最近的调用往回扫，看是否存在 A→B→A→B 的交替模式。关键判断：两边结果都没变化才算原地打转。如果每次读到的内容不同（写入确实生效了），那是正常的读-改流程。

全局熔断器是最后防线：30 次无进展强制停止，没有例外。即便前三种检测器都被关了或者都没触发，全局熔断器永远在线。

#### 三级响应

```
Warning（10 次）→ 记日志，继续执行
Critical（20 次）→ 阻断工具，Agent 收到错误
Break（30 次）→ 全局熔断，强制停止
```

不在第一次重复就停——误杀代价太大，把正常工作的 Agent 强行停了比多跑几轮更浪费。先告警给 Agent 一个调整策略的机会，20 次基本可以确认是死循环了再动手。还有一个防刷屏的设计：告警不是每次都发，而是每 10 次发一次。第 10 次发一个、第 20 次发一个，不会在 10 到 19 之间每次都发。

### 保险丝 2：`Token` 预算控制

死循环检测管工具层面的重复，但模型无限续写不涉及重复工具调用——Agent 生成了 2000 字还没停，上下文越塞越满。

Claude Code 的做法是设输出 `Token` 预算（比如 30000），做两件事：

**90% 时注入 nudge 消息**："已完成 `Token` 目标的 87%（26,100 / 30,000）。继续工作——不要总结。"

为什么说"不要总结"？模型收到"快到限制"的信号后本能反应就是总结收尾——模型也会"慌"。任务还没完成就总结，反而浪费 `Token`。90% 而不是 100%，是给模型缓冲区收尾。

**检测递减回报**：续写 3 次以上且最近两次增量都不到 500 `Token` → 停止。

```
续写 1：+3000 Token → 正常
续写 2：+2500 Token → 正常
续写 3：+400 Token  → 增量小
续写 4：+300 Token  → 连续递减，停
```

前置条件：只在累计输出 > 5000 `Token` 后才检查，避免小输出场景误触发——总共才 1000 `Token` 时某一轮输出 400 `Token` 并不少。

算笔账：Claude Sonnet 输出 $15/百万 `Token`。200 轮失控 × 1000 `Token` = 200,000 `Token` = $3。看着不多，但**输入才是大头**——每轮都带完整上下文（System Prompt + 对话历史 + 工具定义），200 轮累计输入可能是输出的 10-20 倍。**一次失控 $50-100。**

### 保险丝 3：输出截断恢复

每个模型有 `max_output_tokens` 限制（Claude 默认 8192）。超过就硬截断。问题是**模型不知道自己被截了**——生成确实停止了，它以为自己说完了。

如果截断发生在工具调用 `JSON` 中间 → `JSON` 不完整 → 解析失败 → Agent 不知道该干什么。

Claude Code 分三步递进恢复：

1. **提高上限**：8K → 64K。静默重试，用户无感。很多时候只是碰巧输出多了一点，提高上限就行。
2. **注入恢复消息**（最多 3 次）：
   - 第一次："直接从断点继续——不要道歉，不要回顾。把剩余工作拆成更小的块。"
   - 后续："再次被截断。大幅精简，只列关键结论。"
   
   "不要道歉"——模型第一反应是"抱歉回复被截了"，浪费 `Token`。"不要回顾"——模型第二反应是把前面复述一遍，也浪费 `Token`。
3. **认栽**：3 次都不行 → 返回不完整结果，标记"输出被截断"。64K 限制下连续 3 次说不完，说明任务拆分有问题，人工介入比自动重试更有效。

### Agent 什么时候该停？七种退出路径

生产级 Agent 至少有七种退出方式：

| 退出方式 | 触发条件 | 用户看到 |
|---------|-----------|---------|
| `completed` | `end_turn` | ✅ 完成 |
| `max_turns` | 跑满上限 | ⚠️ 轮次上限 |
| `aborted_streaming` | 用户按 Esc（模型输出时） | 🛑 中断，保留已收到文本 |
| `aborted_tools` | 用户按 Esc（工具执行时） | 🛑 中断，等正在跑的工具完成 |
| `hook_stopped` | 自定义 Hook 阻止 | 🚫 Hook 阻止 |
| `blocking_limit` | 上下文快满，发请求前拦截 | ⚠️ 上下文接近上限 |
| `prompt_too_long` | `API` 返回 `413` | ❌ 输入过长 |

几个值得细说的：

**`max_turns` 的检查时机**发生在工具执行完成后、下一轮 `API` 调用前。这意味着最后一轮的工具会执行完，不会"差一步被硬停"。这个上限既防死循环也控成本——20 轮还没完，说明任务可能需要拆分。

**`aborted_tools` 比 `aborted_streaming` 复杂**——已启动的工具可能还在后台跑（比如编译进程），需要等它完成或超时后再退出。

**`hook_stopped` 允许自定义拦截**——用户可以设置 Hook："每次 Agent 想执行工具的时候，先跑一下我的检查脚本"。典型场景：CI 环境里 Hook 检查代码是否通过 lint，不通过就阻止 Agent 继续。

**`blocking_limit` 和 `prompt_too_long` 是一对配合机制**：`blocking_limit` 是客户端**预检**（上下文超过窗口 - 3000 `Token` 就不发请求，避免用户白等网络往返，还可能被计费），`prompt_too_long` 是预检漏掉后的**恢复**（`API` 返回 `413` 后先做两轮自救：轻量的 `Context Collapse` 把已执行完的工具结果压缩掉，重量级的 `Reactive Compact` 调用模型对早期对话历史做摘要——把几千 `token` 的详细记录缩成几百 `token`。两轮都试过还是太长才真正退出）。

不管哪种退出，都得告诉用户三件事：**停了、为什么停了、能做什么。** 没有 context 的"已停止"是用户体验灾难——用户不知道之前的工作有没有保存，不知道下一步该怎么办。

### 三个保险丝的协作

```mermaid
graph TB
    subgraph Loop["Agent Loop"]
        direction TB
        START([开始]) --> DETECT[保险丝 1: 死循环检测<br/>四种检测器 + 三级响应]
        DETECT --> CALL[调用模型<br/>容错: 退避 + 三层降级]
        CALL --> POST{输出状态}
        POST -->|正常| BUDGET[保险丝 2: Token 预算<br/>90% nudge + 递减回报]
        POST -->|max_tokens| TRUNC[保险丝 3: 截断恢复<br/>提上限 → 注入恢复 → 认栽]
        BUDGET --> CHECK{还有工具?}
        CHECK -->|是| DETECT
        CHECK -->|否| DONE([completed])
        TRUNC --> CALL
    end

    subgraph Guard["全局兜底"]
        MAX[max_turns<br/>上下文检查<br/>用户中断]
    end

    Loop -.->|任何阶段| Guard

    style Loop fill:#e5dbff,stroke:#8b5cf6,opacity:30
    style Guard fill:#ffd8a8,stroke:#f59e0b,opacity:30
    style DETECT fill:#ffc9c9,stroke:#ef4444
    style CALL fill:#a5d8ff,stroke:#4a9eed
    style BUDGET fill:#fff3bf,stroke:#f59e0b
    style TRUNC fill:#ffc9c9,stroke:#ef4444
    style DONE fill:#b2f2bb,stroke:#22c55e
```

它们在 Agent Loop 的不同阶段分别守护不同风险，谁也不碍谁，加在一起就是一张网。就像大楼的消防系统：烟雾报警器、喷淋、防火门、消防栓——各管各的，但一起确保不管哪里出问题都有人管。

---

## 总结

三个话题一条线：**从"Agent 怎么跑起来"到"Agent 怎么跑得稳"。**

流式架构管体验——`SSE` 单向推送、`JSON` 碎片拼装、边说边执行、读操作并发写操作串行、审批靠两次 `SSE` 流之间的空隙。你感受的"快"和"卡"，差异全在这。

容错管命——错误先分类再处理、指数退避加抖动防重试风暴、三层降级链从流式退到非流式再换模型、沉默故障靠心跳 + 超时检测 + 对账恢复。多 Provider 时兄弟模型 `Failover` 比跨 Provider 切换划算。

保险丝管 Agent 自身——死循环靠哈希指纹加四种检测器、`Token` 预算靠 90% nudge 加递减回报、截断靠渐进式恢复指令。这些东西全在代码里硬编码，不是靠 `prompt` 告诉模型"请不要循环"。

**模型是大脑，`Harness` 是身体。没有 `Harness` 的模型看起来能动，遇到真实压力就散架。**

---

## 课后练习

写一个带"保险丝"的简易 Agent Loop 骨架，不需要框架和 `API Key`，用 mock 函数模拟：

```javascript
const MAX_TURNS = 20;
const TOKEN_BUDGET = 15_000;

let turn = 0;
let totalOutput = 0;
let lowStreak = 0;
let recoveryCount = 0;
const callHistory = new Map();

function fingerprint(name, params) {
  const stable = JSON.stringify(params, Object.keys(params || {}).sort());
  const { createHash } = require('crypto');
  return createHash('sha256').update(name + stable).digest('hex').slice(0, 12);
}

while (turn < MAX_TURNS) {
  turn++;
  const response = await callModel(messages);
  totalOutput += response.outputTokens;

  // 保险丝 2：Token 预算（只在输出 > 5000 后检查递减回报）
  if (totalOutput > 5000) {
    if (response.outputTokens < 500) lowStreak++;
    else lowStreak = 0;
    if (lowStreak >= 2) break; // 连续两次递减
  }

  if (totalOutput > TOKEN_BUDGET * 0.9) {
    messages.push({
      role: 'user',
      content: `Token 预算已用 ${Math.round(totalOutput / TOKEN_BUDGET * 100)}%。继续工作——不要总结！`
    });
  }

  if (response.toolCalls) {
    for (const toolCall of response.toolCalls) {
      const fp = fingerprint(toolCall.name, toolCall.params);
      const result = await executeTool(toolCall);

      // 保险丝 1：死循环检测
      const prev = callHistory.get(fp) || { count: 0, lastResult: '' };
      const resultFp = fingerprint('result', result);
      if (prev.lastResult === resultFp) {
        prev.count++;
        if (prev.count >= 20) {
          console.log(`阻断：${toolCall.name} 连续无进展 ${prev.count} 次`);
          break;
        }
      }
      callHistory.set(fp, {
        count: prev.lastResult === resultFp ? prev.count + 1 : 0,
        lastResult: resultFp
      });
    }
  }

  // 保险丝 3：截断恢复（渐进式）
  if (response.stopReason === 'max_tokens') {
    recoveryCount++;
    if (recoveryCount > 3) break; // 认栽
    const msg = recoveryCount === 1
      ? '直接从断点继续——不要道歉，不要回顾。把剩余工作拆成更小的块。'
      : '再次被截断。大幅精简，只列关键结论。';
    messages.push({ role: 'user', content: msg });
    continue;
  }

  if (response.stopReason === 'end_turn') break;
}
```

试试去掉某几根保险丝，看会发生什么。

### 讨论

1. 如果你要**同时让 10 个 Agent 干 10 件不同的事**——一个写代码，一个跑测试，一个查文档，一个做 code review——你怎么管理它们？怎么让它们不互相打架？一个挂了怎么不影响其他？

2. 这些容错和保险丝机制，应该由**框架**来做（比如 `OpenClaw`、`LangGraph`），还是由**开发者**自己在业务层做？各自的优势和风险是什么？

3. 今天讲的"保险丝"都是**反应式**的——出了问题才处理。有没有可能做到**预防式**的——在问题还没发生的时候就预判到？比如通过分析 Agent 的行为模式提前干预。

---

> **下期预告**：Agent 的发动机——`LLM`，你知道多少？后续分享将围绕今天提到的六大支柱（Agent Loop、Tool System、Context Engineering、Memory、Multi-Agent、Harness Engineering）逐一深入。

---

## 参考来源

本文知识主要来自以下公开资料：

### Agent Loop 架构

- **Dive into Claude Code: The Design Space of Today's and Future AI Agent Systems** — Jiacheng Liu et al., 2026. 对 Claude Code 源码（v2.1.88, ~512K 行 `TypeScript`）的系统级架构分析，并与 `OpenClaw` 做了对比。文中关于 Agent Loop、工具并发调度、五层压缩管线、七种退出路径的分析是本文的主要知识来源。
  - 论文：https://arxiv.org/abs/2604.14228
  - GitHub：https://github.com/VILA-Lab/Dive-into-Claude-Code

- **How Claude Code Works** — Anthropic 官方文档。描述了 Agent Loop 的三个阶段（收集上下文 → 执行操作 → 验证结果）和工具分类体系。
  - https://code.claude.com/docs/en/how-claude-code-works.md

- **How the agent loop works** — Claude Code Agent SDK 文档。详细描述了消息生命周期、工具执行（读操作并发、写操作串行）、上下文压缩和流式响应机制。
  - https://code.claude.com/docs/en/agent-sdk/agent-loop

- **Ch 5. The Agent Loop | Claude Code from Source** — 对 Claude Code 核心 `query.ts`（1,730 行）的逐行解读，涵盖 StreamingToolExecutor、并发安全分类、错误恢复、`Token` 预算和退出路径。
  - https://claude-code-from-source.com/ch05-agent-loop/

- **Claude Code Agent Loop: Dissecting the Heart of an AI Coding Assistant** — Vincent Qiao, 2026. 对 Agent Loop 的 `while(true)` 结构、流式工具执行、五层压缩、七种恢复路径的源码级分析。
  - https://blog.vincentqiao.com/en/posts/claude-code-agent-loop/

### `ReAct` 模式

- **ReAct: Synergizing Reasoning and Acting in Language Models** — Shunyu Yao et al., 2022 (ICLR 2023). 提出 `ReAct` 范式的原始论文。
  - 论文：https://arxiv.org/abs/2210.03629

### 流式响应与 `SSE`

- **Anthropic API: Streaming** — Anthropic 官方 `API` 文档。定义了 `SSE` 事件流格式和 `tool_use` 的流式 `JSON` 碎片拼接。
  - https://docs.anthropic.com/en/api/streaming

- **OpenAI API: Streaming** — OpenAI 官方 `API` 文档。描述了 `data: [DONE]` 结束标记和 `tool_calls` 的增量 `JSON` 流式传输。
  - https://platform.openai.com/docs/api-reference/streaming

- **Vercel AI SDK** — 抹平不同 Provider 流式协议差异的 `SDK`。
  - https://sdk.vercel.ai/docs

### 容错机制

- **Exponential Backoff And Jitter** — AWS Architecture Blog, 2015. 解释了为什么固定间隔重试会导致"重试风暴"，以及三种抖动策略的对比。
  - https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

- **Timeouts, retries, and backoff with jitter** — Amazon Builders' Library. 从分布式系统角度解释重试、退避和抖动的工程实践。
  - https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/

### `OpenClaw` 项目

- **OpenClaw Documentation: Pi Integration Architecture** — `OpenClaw` 如何嵌入 pi-coding-agent `SDK`，包括流式事件订阅、工具替换和分段推送。
  - https://documentation.openclaw.ai/pi

- **OpenClaw Documentation: Agent Loop** — `OpenClaw` 的 Agent Loop 生命周期、序列化运行和事件流。
  - https://openclaws.io/docs/concepts/agent-loop

- **OpenClaw GitHub** — 开源多通道 AI Agent 网关项目。
  - https://github.com/openclaw/openclaw

### 综合参考

- **Introducing advanced tool use on the Claude Developer Platform** — Anthropic Engineering Blog, 2025. 介绍了 `Tool Search Tool`、`Programmatic Tool Calling` 等高级工具使用模式。
  - https://www.anthropic.com/engineering/advanced-tool-use

- **Claude Code: Behind-the-Scenes of the Master Agent Loop** — Agents Design. 从架构角度拆解 Claude Code 的单线程 master loop 设计。
  - https://agentsdesign.dev/article/claude-code-master-agent-loop/

- **Agent Loop Architecture | ClaudePedia** — Agent Loop 的通用架构描述，包括 `async generator` 模式、取消处理、`streaming event` 类型系统。
  - https://claudepedia.dev/docs/agent-loop
