# 插件（Plugins）

插件解决的是**"整包分发"**问题：技能、命令、MCP 服务端各自都有独立入口，
但要把一套工作方式交给别人，你需要它们**一起装、一起卸、一起带配置**。

**插件不引入任何新能力** —— 它只是把已有能力打包，并把路径与选项**变量化**。

---

## 一、放哪里

| 位置 | 作用范围 | 优先级 |
|------|----------|--------|
| `<数据目录>/plugins/<插件名>/plugin.json` | 你这个用户的所有工作区 | 低 |
| `<工作区>/.jujia/plugins/<插件名>/plugin.json` | 只在这个工作区生效 | **高**（同名时覆盖） |

数据目录在「概览」页能看到。插件在**每次发消息前重新扫描**，装完不用重启。
装了什么、贡献了什么、哪里有问题，都在应用的「**插件**」页里看。

---

## 二、`plugin.json`

```json
{
  "name": "team-workflow",
  "version": "1.0.0",
  "description": "我们团队的提交流程与文档工具",
  "author": "team",
  "skills": "skills",
  "commands": "commands",
  "mcpServers": {
    "docs": {
      "type": "stdio",
      "command": "node",
      "args": ["${JUJIA_PLUGIN_ROOT}/dist/mcp/server.js"],
      "cwd": "${JUJIA_PROJECT_DIR}",
      "env": { "PLUGIN_DATA": "${JUJIA_PLUGIN_DATA}" }
    }
  },
  "userConfig": {
    "default_device": { "type": "string", "default": "iPhone 16", "description": "默认设备" }
  }
}
```

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | ✅ | 只能用小写字母、数字、`-`、`_`，以字母或数字开头 |
| `version` / `description` / `author` / `license` | — | 给人看的元信息 |
| `skills` | — | 技能目录（字符串或数组，相对插件根）。**目录不存在会被记为警告并忽略** |
| `commands` | — | 自定义命令目录（markdown）；**本轮只识别、不执行** |
| `mcpServers` | — | 内联配置对象，或指向一个 JSON 文件的相对路径 |
| `userConfig` | — | 选项默认值，可被 `${user_config.<key>}` 引用 |

推荐目录结构：

```
team-workflow/
  plugin.json
  skills/
    release-check/SKILL.md
  commands/
    deploy.md
  dist/mcp/server.js
```

---

## 三、变量

| 写法 | 含义 |
|------|------|
| `${JUJIA_PLUGIN_ROOT}` | 插件自己的目录 |
| `${JUJIA_PLUGIN_DATA}` | 插件数据目录（**运行时产物写这里**，不要写进插件源码目录） |
| `${JUJIA_PROJECT_DIR}` | 当前工作区 |
| `${user_config.<key>}` | 清单里 `userConfig` 的取值（用户配置优先，其次默认值） |
| `${JUJIA_*}` | **只展开 `JUJIA_` 前缀**的环境变量 |

两条硬规则：

1. **只认 `JUJIA_` 前缀**。写 `${PATH}`、`${HOME}` 这类会被当成"缺失变量"处理 ——
   否则插件可以借环境变量把宿主环境读出来塞进配置，等于开了一条静默的信息通道。
2. **缺失变量 → 禁用受影响的那个 MCP 服务端，并在「插件」页给出错误诊断**，
   而不是拿空串照样启动 —— 配置错误不该变成运行时莫名其妙的行为。

---

## 四、边界（如实说明）

- **插件不能自带权限**：它提供的 MCP 服务端仍然要走「连接 → 看清单 → 逐工具批准」，
  插件只是把"要连什么"替你写好了；
- 插件提供的 MCP 服务端**会出现在 MCP 列表里**（标注来源是插件），
  连接与批准的流程和你自己配的**完全一致**；但**不能在应用里编辑或删除**它 ——
  它由插件清单决定，插件更新后会跟着变；
- **自定义命令目录本轮只识别**（在「插件」页能看到贡献了几个），命令的执行属后续阶段；
- 插件诊断分「错误 / 警告」两级：清单写坏、变量缺失是错误；路径不存在是警告。
  **一个坏服务端不会拖垮整个插件** —— 它的技能目录照常生效。
