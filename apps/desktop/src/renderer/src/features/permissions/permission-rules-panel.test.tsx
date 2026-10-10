// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PermissionRuleView } from '@jujia/shared-ipc';
import { PermissionRulesPanel } from './PermissionRulesPanel';

/**
 * 权限页的组件级断言（M4 收尾 · 其一）。
 *
 * 为什么这个页面值得单独测：它是"用户写下的一条承诺"进入执行路径的唯一入口。
 * 界面上少显示一格、或者把不该发出去的字段发出去，纯函数与接线锁都问不到 ——
 * 而权限规则最怕的正是"看起来配好了，其实没生效"。
 */

function view(over: Partial<PermissionRuleView> = {}): PermissionRuleView {
  return {
    id: 'r1',
    pattern: 'run_command',
    action: 'deny',
    note: null,
    argPrefix: null,
    enabled: true,
    createdAt: '2026-10-09T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
    ...over,
  };
}

const add = vi.fn();
const list = vi.fn();
const auditTail = vi.fn();
const auditExport = vi.fn();

function mount(rules: PermissionRuleView[]): void {
  list.mockResolvedValue(rules);
  render(<PermissionRulesPanel />);
}

beforeEach(() => {
  add.mockReset();
  list.mockReset();
  auditTail.mockReset();
  auditExport.mockReset();
  // 默认给一份空账：审计用例自己覆盖它（写在 mount 里会把用例设的值冲掉，第一次就踩了）
  auditTail.mockResolvedValue(AUDIT_EMPTY);
  add.mockResolvedValue(view());
  vi.stubGlobal('jujia', {
    permissionRulesList: list,
    permissionRulesAdd: add,
    permissionRulesRemove: vi.fn().mockResolvedValue(true),
    permissionRulesToggle: vi.fn().mockResolvedValue(view()),
    configGet: vi.fn().mockResolvedValue({ config: { permissionMode: 'default' } }),
    configSet: vi.fn().mockResolvedValue({ ok: true }),
    auditTail: auditTail,
    auditExport: auditExport,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('权限页 · 命令前缀', () => {
  it('列表把规则的命令前缀显示出来（看不见就等于用户以为没生效）', async () => {
    mount([view({ argPrefix: 'rm -rf' })]);
    expect((await screen.findAllByText(/rm -rf/)).length).toBeGreaterThan(0);
  });

  it('没填前缀的规则不会凭空长出一格「前缀 」', async () => {
    mount([view({ pattern: 'mcp__*', argPrefix: null })]);
    await screen.findByText('mcp__*');
    // 只判列表那一行：表单里本来就有一格叫「命令前缀」，判整页文字会一直红
    const row = document.querySelector('.jj-perm-list');
    expect(row?.textContent ?? '').not.toContain('前缀');
  });

  it('动作选「自动放行」时前缀那一格不出现，并说清为什么', async () => {
    mount([]);
    fireEvent.change(screen.getByLabelText(/匹配模式/), { target: { value: 'run_command' } });
    fireEvent.change(screen.getByLabelText(/^动作/), { target: { value: 'allow' } });
    expect(screen.queryByLabelText(/命令前缀/)).toBeNull();
    expect(document.body.textContent).toContain('以后不再问');
  });

  /**
   * 这一条是本轮自己抓出来的洞：先填了前缀、再把动作切成 allow。
   * 那一格已经不显示了，**状态里的文本却还在** —— 于是提交会带出一个用户在界面上
   * 看不见的 argPrefix，主进程按规矩拒收，报错文案指的是一格根本不存在的位置。
   * 修法不是"提交前偷偷丢掉"（那是把一条会失败的请求改成静默不改），
   * 而是切成 allow 时那一格连同它的内容一起消失。
   */
  it('先填前缀再切成 allow：那一格连同内容一起消失，提交不会带出看不见的字段', async () => {
    mount([]);
    fireEvent.change(screen.getByLabelText(/匹配模式/), { target: { value: 'run_command' } });
    fireEvent.change(screen.getByLabelText(/命令前缀/), { target: { value: 'rm -rf' } });
    expect((screen.getByLabelText(/命令前缀/) as HTMLInputElement).value).toBe('rm -rf');

    fireEvent.change(screen.getByLabelText(/^动作/), { target: { value: 'allow' } });
    expect(screen.queryByLabelText(/命令前缀/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0]?.[0]).toEqual({ pattern: 'run_command', action: 'allow' });
  });

  it('deny + 前缀提交时带上 trimmed 后的前缀；只填空格则整格不发（不留一个空字符串字段）', async () => {
    mount([]);
    fireEvent.change(screen.getByLabelText(/匹配模式/), { target: { value: 'run_command' } });
    fireEvent.change(screen.getByLabelText(/命令前缀/), { target: { value: '  git push  ' } });
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0]?.[0]).toEqual({ pattern: 'run_command', action: 'deny', argPrefix: 'git push' });

    add.mockClear();
    // 提交成功后表单会清空（这是对的行为），所以第二次提交要重新填模式，否则按钮是禁用的
    fireEvent.change(screen.getByLabelText(/匹配模式/), { target: { value: 'run_command' } });
    fireEvent.change(screen.getByLabelText(/命令前缀/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(Object.keys(add.mock.calls[0]?.[0] ?? {})).not.toContain('argPrefix');
  });
});


/**
 * 执行审计卡片（M4 收尾 · 其二）。
 *
 * 这一页是审计**唯一**的出口，所以断言都指着"看得见"：
 * 一条记不上的账和记错了的账一样危险，而一句没人看见的警告等于没有警告。
 */
const AUDIT_EMPTY = {
  records: [],
  total: 0,
  unparsed: 0,
  dropped: 0,
  notice: '',
  file: 'audit/permissions-2026-10-09.jsonl',
  workspaceRoot: 'D:/work/demo',
};

function auditEntry(over: Record<string, unknown> = {}) {
  return {
    ts: '2026-10-09T10:00:00.000Z',
    sessionId: 's-1',
    subject: 'run_command',
    kind: 'exec',
    outcome: 'deny',
    asked: false,
    executed: false,
    reason: '命中你的规则「run_command」（命令前缀：rm -rf）→ 拒绝',
    args: { keys: ['command'], lengths: { command: 12 }, digests: { command: 'abc123def456' }, paths: [], redacted: [], command: 'rm -rf build' },
    ...over,
  };
}

function page(over: Record<string, unknown> = {}) {
  return { ...AUDIT_EMPTY, records: [auditEntry()], ...over };
}

describe('权限页 · 执行审计', () => {
  it('列出今天的判定：做什么、结论、理由都要在界面上', async () => {
    auditTail.mockResolvedValue(page());
    mount([]);
    await screen.findByText('rm -rf build');
    const text = document.body.textContent ?? '';
    expect(text).toContain('run_command');
    expect(text).toContain('命中你的规则');
  });

  it('服务给出的 notice 必须显示（写满了、写坏了不许静默）', async () => {
    auditTail.mockResolvedValue(page({ notice: '今天已到上限，另有 3 条未记（本次运行计数）' }));
    mount([]);
    await screen.findByText(/已到上限/);
  });

  it('规则表当时是降级读出来的，行上要说这句话（T37 的可见面）', async () => {
    auditTail.mockResolvedValue(
      page({ records: [auditEntry({ rules: { source: 'default', count: 0, degraded: true } })] }),
    );
    mount([]);
    await screen.findByText(/规则表当时没读出来/);
  });

  it('导出：成功 / 取消 / 失败三种结果说三种话（取消不是失败）', async () => {
    auditTail.mockResolvedValue(page());
    mount([]);
    await screen.findByText('run_command');

    auditExport.mockResolvedValue({ ok: true, lines: 7, file: 'D:/desk/audit.jsonl' });
    fireEvent.click(screen.getByRole('button', { name: /导出审计/ }));
    await screen.findByText(/已写出 7 行/);

    auditExport.mockResolvedValue({ ok: false, cancelled: true, error: '已取消，没有写出任何文件' });
    fireEvent.click(screen.getByRole('button', { name: /导出审计/ }));
    await screen.findByText(/已取消/);

    auditExport.mockResolvedValue({ ok: false, cancelled: false, error: '导出目标已存在，没有覆盖它' });
    fireEvent.click(screen.getByRole('button', { name: /导出审计/ }));
    await screen.findByText(/没有覆盖它/);
  });

  it('三扇门接完就要把「尚未接入」删掉，同时说出这一轮真没覆盖的那一格', async () => {
    auditTail.mockResolvedValue(page());
    mount([]);
    const scope = await screen.findByText(/覆盖范围/);
    expect(scope.textContent).toContain('git');
    expect(scope.textContent).toContain('外部程序');
    expect(scope.textContent).toContain('钩子配置');
    // 接线不留尾巴：上一轮那句"尚未接入"如果还留着，界面就在宣称一本它其实没记的账
    expect(document.body.textContent).not.toContain('尚未接入');
    // 反过来也不许：内置终端每次都当面问、不经过策略判定，所以它不在判定账里 —— 这句必须说出来
    expect(scope.textContent).toContain('内置终端');
  });
});
