# 知识卡 005 · Skills ≠ MCP

## 结论

| | MCP | Agent Skills |
|--|-----|--------------|
| 本质 | 连接器协议（工具/资源） | 过程知识包（SKILL.md） |
| 加载 | 连接后暴露 tools | 启动只注入 name+description，匹配后再读正文 |
| 安全 | Host 同意后 tools/call | 只装信任源；脚本审计；远程 archive 默认不执行 |
| 关系 | 提供能力 | 教「何时/如何」使用能力 |

## 代码落点（Phase 3）

```
JuJiaData/skills/<id>/
  SKILL.md          # frontmatter: name, description
  scripts/          # 可选，执行前确认
  references/
```

系统提示只含技能目录元数据；`load_skill` 工具读取正文。

## 风险

- 启动注入全部技能正文 → 上下文爆炸  
- 自动执行不可信脚本 → RCE  

来源：agentskills.io、Anthropic Agent Skills、MCP spec（findings F3）
