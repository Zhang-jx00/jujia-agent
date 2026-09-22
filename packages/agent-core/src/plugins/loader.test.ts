import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins, summarizePlugins, validateManifest } from './loader';
import { checkPluginName, expandServerConfig, expandVariables } from './types';

let root = '';
let pluginRoot = '';
let dataRoot = '';
let projectDir = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-plugins-'));
  pluginRoot = join(root, 'plugins');
  dataRoot = join(root, 'data');
  projectDir = join(root, 'ws');
  await mkdir(pluginRoot, { recursive: true });
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 写一个插件（skillsDir 为 true 时同时建一个 skills/ 目录） */
async function writePlugin(
  dirName: string,
  manifest: unknown,
  opts: { skills?: boolean; commands?: boolean; extra?: Record<string, string> } = {},
): Promise<string> {
  const dir = join(pluginRoot, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
  if (opts.skills === true) await mkdir(join(dir, 'skills'), { recursive: true });
  if (opts.commands === true) await mkdir(join(dir, 'commands'), { recursive: true });
  for (const [rel, content] of Object.entries(opts.extra ?? {})) {
    const p = join(dir, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, content, 'utf8');
  }
  return dir;
}

const sources = () => [{ path: pluginRoot, dataRoot, projectDir }];

describe('清单校验', () => {
  it('合法清单通过；name 是唯一必需字段', () => {
    expect(validateManifest({ name: 'my-plugin' }).ok).toBe(true);
    expect(validateManifest({ name: 'Bad Name' }).ok).toBe(false);
    expect(validateManifest({}).ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
    expect(validateManifest('x').ok).toBe(false);
  });

  it('类型不对要报出来（而不是当没写）', () => {
    expect(validateManifest({ name: 'a', skills: 123 }).ok).toBe(false);
    expect(validateManifest({ name: 'a', mcpServers: [] }).ok).toBe(false);
    expect(validateManifest({ name: 'a', userConfig: { k: {} } }).errors[0]).toContain('type');
  });

  it('插件名规则与技能名一致（会进提示与文件路径，字符集必须收窄）', () => {
    expect(checkPluginName('my-plugin')).toBeNull();
    expect(checkPluginName('My-Plugin')).not.toBeNull();
    expect(checkPluginName('含中文')).not.toBeNull();
  });
});

describe('变量展开', () => {
  const ctx = {
    pluginRoot: 'D:/p/root',
    pluginData: 'D:/data/root',
    projectDir: 'D:/ws',
    userConfig: { device: 'iPhone 16' },
    env: { JUJIA_TOKEN: 'tk-1', PATH: 'C:/Windows' } as Record<string, string | undefined>,
  };

  it('内置变量与 user_config 都能展开', () => {
    expect(expandVariables('${JUJIA_PLUGIN_ROOT}/dist', ctx).value).toBe('D:/p/root/dist');
    expect(expandVariables('${JUJIA_PLUGIN_DATA}', ctx).value).toBe('D:/data/root');
    expect(expandVariables('${JUJIA_PROJECT_DIR}', ctx).value).toBe('D:/ws');
    expect(expandVariables('${user_config.device}', ctx).value).toBe('iPhone 16');
    expect(expandVariables('${JUJIA_TOKEN}', ctx).value).toBe('tk-1');
  });

  it('**只认 JUJIA_ 前缀**：别的环境变量一律当缺失（不给插件读宿主环境的口子）', () => {
    const r = expandVariables('${PATH}', ctx);
    expect(r.value).toBe('');
    expect(r.missing).toEqual(['PATH']);
  });

  it('缺失变量会被报出来，而不是留空串蒙混过去', () => {
    expect(expandVariables('${user_config.nope}', ctx).missing).toEqual(['user_config.nope']);
    expect(expandVariables('${JUJIA_NOPE}', ctx).missing).toEqual(['JUJIA_NOPE']);
  });

  it('服务端配置整份展开（command/args/env/cwd 都覆盖）', () => {
    const r = expandServerConfig(
      {
        type: 'stdio',
        command: 'node',
        args: ['${JUJIA_PLUGIN_ROOT}/server.js'],
        cwd: '${JUJIA_PROJECT_DIR}',
        env: { PLUGIN_DATA: '${JUJIA_PLUGIN_DATA}', DEVICE: '${user_config.device}' },
      },
      ctx,
    );
    expect(r.missing).toEqual([]);
    expect(r.config.args).toEqual(['D:/p/root/server.js']);
    expect(r.config.cwd).toBe('D:/ws');
    expect(r.config.env).toEqual({ PLUGIN_DATA: 'D:/data/root', DEVICE: 'iPhone 16' });
  });
});

describe('插件加载（真文件系统）', () => {
  it('完整插件：技能目录 + 命令目录 + MCP 服务端都被识别', async () => {
    await writePlugin(
      'demo',
      {
        name: 'demo',
        version: '1.0.0',
        description: '演示插件',
        skills: 'skills',
        commands: 'commands',
        mcpServers: { files: { type: 'stdio', command: 'node', args: ['${JUJIA_PLUGIN_ROOT}/s.js'] } },
      },
      { skills: true, commands: true },
    );

    const result = await loadPlugins(sources());
    expect(result.plugins).toHaveLength(1);
    const p = result.plugins[0];
    expect(p?.name).toBe('demo');
    expect(p?.skillsDirs).toHaveLength(1);
    expect(p?.commandsDirs).toHaveLength(1);
    expect(p?.mcpServers.map((s) => s.name)).toEqual(['files']);
    // 变量已展开：args 里应是插件根目录下的真实路径（用 basename 判断，避免平台分隔符差异）
    const arg = p?.mcpServers[0]?.config.args?.[0] ?? '';
    expect(arg.endsWith('s.js')).toBe(true);
    expect(arg.startsWith(pluginRoot)).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('缺失变量的 MCP 服务端**被禁用并记错误**，插件其余部分照常可用', async () => {
    await writePlugin(
      'demo',
      {
        name: 'demo',
        skills: 'skills',
        mcpServers: {
          broken: { type: 'stdio', command: 'node', args: ['${user_config.not_set}'] },
          ok: { type: 'stdio', command: 'node' },
        },
      },
      { skills: true },
    );

    const result = await loadPlugins(sources());
    const p = result.plugins[0];
    // 只有能用的那个留下
    expect(p?.mcpServers.map((s) => s.name)).toEqual(['ok']);
    // 技能目录仍然生效（一个坏服务端不该拖垮整个插件）
    expect(p?.skillsDirs).toHaveLength(1);
    const err = p?.diagnostics.find((d) => d.severity === 'error');
    expect(err?.message).toContain('缺失的变量');
    expect(err?.message).toContain('已禁用');
  });

  it('清单坏掉 / JSON 坏掉 / 不成目录 → 记诊断而不是崩', async () => {
    await writePlugin('bad-json', { name: 'x' });
    await writeFile(join(pluginRoot, 'bad-json', 'plugin.json'), '{ 这不是 JSON', 'utf8');
    await writePlugin('bad-name', { name: 'Bad Name' });
    await mkdir(join(pluginRoot, 'just-a-folder'), { recursive: true });

    const result = await loadPlugins(sources());
    expect(result.plugins).toEqual([]);
    expect(result.diagnostics.some((d) => d.message.includes('不是合法 JSON'))).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes('name 不合法'))).toBe(true);
    // 普通目录安静跳过，不该产生诊断
    expect(result.diagnostics.some((d) => d.plugin === 'just-a-folder')).toBe(false);
  });

  it('skills 指向不存在的目录 → 警告并忽略（插件其余部分不受影响）', async () => {
    await writePlugin('demo', { name: 'demo', skills: 'nope' });
    const result = await loadPlugins(sources());
    expect(result.plugins[0]?.skillsDirs).toEqual([]);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(result.diagnostics[0]?.message).toContain('已忽略');
  });

  it('mcpServers 可以指向外部 JSON 文件', async () => {
    await writePlugin('demo', { name: 'demo', mcpServers: 'servers.json' }, {
      extra: { 'servers.json': JSON.stringify({ ext: { type: 'stdio', command: 'node' } }) },
    });
    const result = await loadPlugins(sources());
    expect(result.plugins[0]?.mcpServers.map((s) => s.name)).toEqual(['ext']);
  });

  it('同名插件后者覆盖前者，并记诊断（顺序即优先级）', async () => {
    await mkdir(join(root, 'plugins2'), { recursive: true });
    await writePlugin('first', { name: 'same', description: '第一个' });
    await mkdir(join(root, 'plugins2', 'second'), { recursive: true });
    await writeFile(
      join(root, 'plugins2', 'second', 'plugin.json'),
      JSON.stringify({ name: 'same', description: '第二个' }),
      'utf8',
    );

    const result = await loadPlugins([
      { path: pluginRoot, dataRoot, projectDir },
      { path: join(root, 'plugins2'), dataRoot, projectDir },
    ]);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.manifest.description).toBe('第二个');
    expect(result.diagnostics.some((d) => d.message.includes('同名插件冲突'))).toBe(true);
  });

  it('插件根目录不存在 → 空结果且不报错', async () => {
    const result = await loadPlugins([{ path: join(root, 'nope'), dataRoot, projectDir }]);
    expect(result.plugins).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('结果按插件名排序（贡献物会进系统提示，顺序必须确定）', async () => {
    await writePlugin('z', { name: 'zzz' });
    await writePlugin('a', { name: 'aaa' });
    const result = await loadPlugins(sources());
    expect(result.plugins.map((p) => p.name)).toEqual(['aaa', 'zzz']);
  });

  it('摘要一句话说清加载了什么', async () => {
    await writePlugin('demo', {
      name: 'demo',
      skills: 'skills',
      mcpServers: { s: { type: 'stdio', command: 'node' } },
    }, { skills: true });
    const text = summarizePlugins(await loadPlugins(sources()));
    expect(text).toContain('已加载 1 个插件');
    expect(text).toContain('MCP 服务端 1 个');
  });
});
