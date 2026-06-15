---

## name: retro-toolkit
description: >-
  Shared retro analysis methodology and reusable scripts for Gatehouse build-root / build-coordinator retro sessions.
  Use during mission retro when analyzing context/ dumps and promoting reusable retro tools.
metadata:
  gatehouse-kind: toolkit
  gatehouse-role: exec
disable-model-invocation: true

# Retro 工具库 · retro-toolkit

本 skill 补充 retro kickoff 未涵盖的**可复用工具方法论**。分析步骤见 kickoff 消息；此处聚焦工具目录约定与问题分类。

先复用 `.gatehouse/skills/retro-toolkit/tools/*/SKILL.md`，再按需扩展。

## 新工具目录约定

```
.gatehouse/skills/retro-toolkit/tools/<verb-noun>/
  SKILL.md          # 用途、输入输出、示例命令、适用问题类
  analyze.py        # 或其它脚本（可多文件）
```

`SKILL.md` 必含：**解决哪类效率问题**、**读取哪些 context 路径**、**如何运行**、**输出字段含义**。

## 分析问题类（启发，非穷举）

- 上下文压缩频率与后续行为异常
- todo 阶段 token 消耗与产出比
- 编排等待 / `execution_complete` / `execution_rework` 协调缺口
- tool 反复失败与重试
- 用户中途介入与 prompt 约束不足
- 所辖分支内节点间职责重叠

