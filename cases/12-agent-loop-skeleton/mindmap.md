# Agent Loop 完整骨架
## 三层防御
### 第一层：死循环检测
### 第二层：Token 预算控制
### 第三层：截断恢复
## 防御协作时序
### 工具执行后 → 第一层
### 每轮结束后 → 第二层
### finishReason=length → 第三层
## 七种退出路径
### completed → 正常完成
### max_turns → 轮次上限
### aborted_streaming → 用户中断输出
### aborted_tools → 用户中断工具
### hook_stopped → Hook 阻止
### blocking_limit → 上下文预检
### prompt_too_long → API 413
## 退出时告诉用户
### 停了
### 为什么停了
### 能做什么
## 核心结构
### for (turn <= MAX_TURNS)
### 每轮检查三层防御
### 任何触发 → stopped = true
