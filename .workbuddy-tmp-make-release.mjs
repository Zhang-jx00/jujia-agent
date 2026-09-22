#!/usr/bin/env node
/** 临时脚本：创建 GitHub Release（把 v0.9.0 之后的更新记录补到 GitHub 侧）。用完即删。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const home = process.env['APPDATA'] ?? '';
const token = readFileSync(join(home, 'jujia-agent', '.token'), 'utf8').trim();

const body = `## 这一程做了什么（v0.9.0 → v0.14.4）

### MCP 能力面打通（W10a–e）
- stdio 真子进程传输：行缓冲 / UTF-8 断切 / stderr 隔离 / Windows 进程树清理（\`taskkill /T\`）等七个坑全部落成用例
- **连接同意界面**：逐字展示将执行的命令与风险提示，工具默认全不勾选，逐工具批准；未批准的工具不进注册表（没有调用路径）
- 工具桥走同一套权限门：exec 类工具被拒绝时，**远端一次都没被调用**（stderr 副作用证据断言）
- 端到端 3 例（真子进程）：全链路通 · 拒绝零调用 · 拒绝后进程真被退掉
- 首连超时修复：握手独立 60s（npx 首跑要下载包，实测 55.2s），超时报错带可操作提示

### 自定义权限规则表（W5c / M15）
- \`allow / deny / ask\` + 工具名 glob；deny 与 ask 绝对生效（连全部放行模式也让路）
- **激活了此前是死代码的策略层**：5 种权限模式（plan / acceptEdits / dontAsk / bypassPermissions）真正作用于执行路径
- 「权限」设置页：模式切换（bypass 需显式确认）、规则增删启停、deny 一切时醒目警告

### 稳定性
- 修复 dev 模式黑屏（\`@vitejs/plugin-react\` 6 与 vite 7 版本错配 → 降级到 5.2）
- 新增无头 dev 管线探针 \`verify-dev-transform\`（构建绿 ≠ dev 能用）

### 质量底线
- 全量 **486 项测试**；每轮复核两遍（变异测试累计 40+ 例全部被拦，详见 \`review/REVIEW-LOG.md\`）
- 开源就绪：LICENSE / SECURITY.md / CONTRIBUTING.md / 第三方声明齐备

**回退**：任一阶段可用标签回退（\`git checkout <tag>\`），标签从 \`v0.9.0-w9a\` 到 \`v0.14.4-mcpfix\`。`;

const res = await fetch('https://api.github.com/repos/Zhang-jx00/jujia-agent/releases', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'jujia-agent-release-script',
  },
  body: JSON.stringify({
    tag_name: 'v0.14.4-mcpfix',
    name: '俱佳Agent v0.14.0 — MCP 打通 · 权限规则表 · dev 修复',
    body,
    draft: false,
    prerelease: false,
  }),
});

const json = (await res.json()) as { html_url?: string; message?: string };
if (res.ok) {
  console.log(`Release 创建成功: ${json.html_url}`);
} else {
  console.error(`Release 创建失败（HTTP ${res.status}）: ${json.message ?? '未知错误'}`);
  process.exit(1);
}
