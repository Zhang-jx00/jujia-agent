import { describe, expect, it } from 'vitest';
import {
  applyApproval,
  detectRisks,
  isToolEnabled,
  planConnectionApproval,
  toDisplayCommandLine,
  type ConnectionApprovalPlan,
} from './consent';
import { toToolProfiles, type McpServerConfig, type McpToolDescriptor } from './mcp';

/**
 * W10c 验收重点（安全关键）：
 * 1. **默认不放行**：用户拒绝 → 没有任何工具可用；未批准的工具一律不可用；
 * 2. **批准粒度到工具**：可以只启用部分工具，未启用的**彻底不可用**（不是"隐藏"）；
 * 3. **风险提示是人话且不淡化**：npx 自动安装、未锁版本、绝对路径、env 里疑似密钥都要提示；
 * 4. **展示的命令行是真实将要执行的**（含平台适配），且**只列 env 的键、不列值**；
 * 5. 批准了不存在的工具名 → 忽略，不制造"批了不存在的东西"的假记录。
 */

const cfg = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'fs',
  name: '文件系统服务',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\ws'],
  ...over,
});

const descriptors: McpToolDescriptor[] = [
  { name: 'read_file', description: '读文件', annotations: { readOnlyHint: true } },
  { name: 'list_dir', description: '列目录', annotations: { readOnlyHint: true } },
  { name: 'write_file', description: '写文件' },
  { name: 'delete_file', description: '删文件', annotations: { destructiveHint: true } },
];

const plan = (
  config = cfg(),
  tools = toToolProfiles('fs', descriptors),
  platform?: NodeJS.Platform,
): ConnectionApprovalPlan => planConnectionApproval(config, tools, platform);

describe('toDisplayCommandLine：展示真实将执行的命令', () => {
  it('Windows 上展示经批处理包装器转发的完整命令', () => {
    const line = toDisplayCommandLine(cfg(), 'win32');
    expect(line).toContain('cmd');
    expect(line).toContain('npx');
    expect(line).toContain('@modelcontextprotocol/server-filesystem');
  });

  it('含空格的参数加引号，避免用户误读', () => {
    const line = toDisplayCommandLine(cfg({ args: ['--root', 'D:\\my ws'] }), 'linux');
    expect(line).toContain('"D:\\my ws"');
  });

  it('非 Windows 不加包装器', () => {
    expect(toDisplayCommandLine(cfg({ command: 'mcp-server', args: [] }), 'linux')).toBe('mcp-server');
  });
});

describe('detectRisks：风险提示（确定性规则 + 人话）', () => {
  it('npx 自动确认参数 → 提示供应链风险', () => {
    const w = detectRisks(cfg());
    expect(w.map((x) => x.code)).toContain('npx-auto-install');
    expect(w.find((x) => x.code === 'npx-auto-install')?.message).toContain('下载并执行');
  });

  it('未锁版本 → 提示可复现性风险', () => {
    expect(detectRisks(cfg()).map((x) => x.code)).toContain('unpinned-version');
  });

  it('绝对路径 → 提示访问范围', () => {
    const w = detectRisks(cfg({ args: ['pkg', 'D:\\other\\dir'] }));
    expect(w.map((x) => x.code)).toContain('absolute-path');
    expect(w.find((x) => x.code === 'absolute-path')?.message).toContain('D:\\other\\dir');
  });

  it('env 里疑似密钥 → 明确提示（并说明本项目对密钥的约定）', () => {
    const w = detectRisks(cfg({ env: { API_KEY: 'x', FOO: 'y' } }));
    const hit = w.find((x) => x.code === 'secret-in-env');
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('API_KEY');
    expect(hit?.message).toContain('不进模型上下文');
  });

  it('看起来具备写入能力的参数 → 提示（但仍说明逐次确认）', () => {
    const w = detectRisks(cfg({ args: ['pkg', '--allow-write'] }));
    expect(w.map((x) => x.code)).toContain('write-capable');
  });

  it('干净的配置不产生噪声提示', () => {
    const clean = cfg({ command: 'mcp-server', args: ['--root', 'D:\\ws'] });
    const codes = detectRisks(clean).map((x) => x.code);
    expect(codes).not.toContain('npx-auto-install');
  });
});

/**
 * T53（终端与外部件批 · 2026-10-15）：**「只读」这一档是服务端自己说的**，批准界面上必须这么说。
 *
 * 判据在 `mcp.ts` 与 `policy.ts`：`annotations.readOnlyHint === true` → `kind:'read'` → 门直接放行。
 * 而 MCP 工具的参数是**任意 JSON 原样透传**，本机的敏感路径表只认 `path` 这一个键 ——
 * 第三方服务只要自称只读，它那个叫 `file_path` / `target` 的参数就永远碰不到那张表，
 * 于是"读什么都不会问你"是**真实可达**的状态。
 *
 * 收紧这一档（外部工具一律询问，或给档案加 `pathArg` 声明）**改的是信任边界 → 停牌①**，
 * 不由我自行改判定。在所有者定下来之前，界面上不许留"外部工具跟内置工具一样有门"的错觉，
 * 所以这条提示进 `warnings`（批准弹窗本来就渲染这一栏，措辞只有一处定义）。
 */
describe('只读档来自服务端自述，批准前要说出口（T53）', () => {
  const onlyRead = toToolProfiles('fs', [
    { name: 'read_file', description: '读文件', annotations: { readOnlyHint: true } },
  ]);

  it('有只读工具时，warnings 里要有一条说得清"自述"与"不再询问"', () => {
    const p = plan(cfg({ command: 'mcp-server', args: [] }), onlyRead);
    const hit = p.warnings.find((w) => w.code === 'read-only-self-reported');

    expect(hit, JSON.stringify(p.warnings.map((w) => w.code))).toBeDefined();
    expect(hit?.message).toContain('自述');
    expect(hit?.message).toContain('不再问你');
    expect(hit?.message).toContain('1');
  });

  it('反向对照：一个只读工具都没有时不许冒出这条噪声', () => {
    const noRead = toToolProfiles('fs', [
      { name: 'delete_file', description: '删文件', annotations: { destructiveHint: true } },
    ]);
    const p = plan(cfg({ command: 'mcp-server', args: [] }), noRead);

    expect(p.readOnlyCount).toBe(0);
    expect(p.warnings.map((w) => w.code)).not.toContain('read-only-self-reported');
  });

  it('只有"自述只读"这一件事时也要标成需要先看风险（这正是它最容易被跳过去的时候）', () => {
    const p = plan(cfg({ command: 'mcp-server', args: [] }), onlyRead);

    expect(p.alwaysAskCount).toBe(0);
    expect(p.needsExtraAttention).toBe(true);
  });

  it('计数说的是**这一个服务**的只读工具数，不是笼统的一句提醒', () => {
    const two = toToolProfiles('fs', [
      { name: 'read_file', description: '读', annotations: { readOnlyHint: true } },
      { name: 'list_dir', description: '列', annotations: { readOnlyHint: true } },
      { name: 'write_file', description: '写' },
    ]);
    const p = plan(cfg({ command: 'mcp-server', args: [] }), two);

    expect(p.readOnlyCount).toBe(2);
    expect(p.warnings.find((w) => w.code === 'read-only-self-reported')?.message).toContain('2');
  });
});

describe('planConnectionApproval：给 UI 的批准计划', () => {
  it('统计 exec / 只读数量（exec 类要每次询问）', () => {
    const p = plan();
    expect(p.toolCount).toBe(4);
    expect(p.alwaysAskCount).toBe(2); // write_file + delete_file
    expect(p.readOnlyCount).toBe(2); // read_file + list_dir
  });

  it('**只列 env 的键，不列值**（避免密钥出现在 UI 与日志）', () => {
    const p = plan(cfg({ env: { API_KEY: 'super-secret-value' } }));
    expect(p.envKeys).toEqual(['API_KEY']);
    expect(JSON.stringify(p)).not.toContain('super-secret-value');
  });

  it('有 exec 类工具或高风险项时需要额外注意', () => {
    expect(plan().needsExtraAttention).toBe(true);
  });

  it('每个工具都带 kindReason（UI 可解释"为什么每次都问"）', () => {
    expect(plan().tools.every((t) => t.kindReason.length > 0)).toBe(true);
  });

  it('展示的命令行与真实将执行的命令一致（含平台适配）', () => {
    expect(plan(cfg(), toToolProfiles('fs', descriptors), 'win32').commandLine).toContain('cmd');
  });
});

describe('applyApproval：用户决定后的可用工具集合（默认不放行）', () => {
  it('**拒绝 → 零个工具可用**', () => {
    const out = applyApproval(plan(), { action: 'deny' });
    expect(out.approved).toBe(false);
    expect(out.enabledTools).toEqual([]);
    expect(out.note).toContain('拒绝');
  });

  it('全部批准 → 启用全部（并说明 exec 类仍会逐次询问）', () => {
    const out = applyApproval(plan(), { action: 'approve_all' });
    expect(out.approved).toBe(true);
    expect(out.enabledTools).toHaveLength(4);
    expect(out.note).toContain('逐次');
  });

  it('只批准部分 → 其余**彻底不可用**（不是隐藏）', () => {
    const p = plan();
    const out = applyApproval(p, { action: 'approve_partial', toolNames: ['fs__read_file'] });
    expect(out.approved).toBe(true);
    expect(out.enabledTools).toEqual(['fs__read_file']);
    expect(isToolEnabled(out, 'fs__read_file')).toBe(true);
    expect(isToolEnabled(out, 'fs__write_file')).toBe(false);
  });

  it('批准了不存在的工具名 → 忽略它，不产生假记录', () => {
    const out = applyApproval(plan(), {
      action: 'approve_partial',
      toolNames: ['fs__read_file', 'fs__not_exist'],
    });
    expect(out.enabledTools).toEqual(['fs__read_file']);
    expect(out.note).toContain('忽略');
  });

  it('一个都没启用 → 视为未接入', () => {
    const out = applyApproval(plan(), { action: 'approve_partial', toolNames: ['fs__nope'] });
    expect(out.approved).toBe(false);
    expect(out.enabledTools).toEqual([]);
  });

  it('未批准时 isToolEnabled 一律为 false', () => {
    const denied = applyApproval(plan(), { action: 'deny' });
    expect(isToolEnabled(denied, 'fs__read_file')).toBe(false);
    expect(isToolEnabled(applyApproval(plan(), { action: 'approve_partial', toolNames: [] }), 'fs__read_file')).toBe(false);
  });
});
