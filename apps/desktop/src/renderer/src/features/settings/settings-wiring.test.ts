import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS_LABEL, SETTINGS_NAV } from './settings-nav';
import type { SettingsItem } from './settings-nav';
import { NAV_GROUPS, TAB_LABEL } from '../../nav';

/**
 * 设置中心的**接线锁**（R67 · 设置中心）。
 *
 * 为什么立它：设置中心这一轮**搬走了五个面板**（外观 / 权限规则 / 钩子 / 插件 / MCP）
 * —— 而"搬走"这种改动**最容易留下第二处门**：某个面板又被人从左栏直接挂了一次，
 * 于是同一个目的地有两个入口（用户改完设置，回左栏发现还是旧的那页 ⇒ 以为没生效）。
 * 源码里看不出来，界面点几下才发现 ⇒ 只能机器盯。
 *
 * 另外两条也是**搬动**带来的：
 *   ② 设置项**漏进分组** = 左导航里那一项**点不到**（界面上表现为"设置里少了一页"）；
 *   ③ 外观页**没改成一行一条** = 这次搬家的视觉目标没达成（判据按"用了多少行"钉，不按"写得对不对"钉）。
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (...rel: string[]): string => readFileSync(join(here, ...rel), 'utf8');
/** 剥注释（R54 的教训：判据被自己的注释喂饱 ⇒ 假绿） */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const app = strip(read('..', '..', 'App.tsx'));
const center = strip(read('SettingsCenter.tsx'));
const appearance = strip(read('..', 'appearance', 'AppearancePanel.tsx'));

/** 五个设置类面板（搬家清单）—— 每一条都必须**只在设置中心里**被挂载 */
const SETTINGS_PANELS: readonly { readonly file: string; readonly marker: string }[] = [
  { file: 'appearance/AppearancePanel', marker: 'AppearancePanel' },
  { file: 'permissions/PermissionRulesPanel', marker: 'PermissionRulesPanel' },
  { file: 'hooks/HooksPanel', marker: 'HooksPanel' },
  { file: 'plugins/PluginsPanel', marker: 'PluginsPanel' },
  { file: 'mcp/McpPanel', marker: 'McpPanel' },
];

describe('设置中心：入口不许有第二处门', () => {
  it('五个设置类面板**只在设置中心**里被挂载（App.tsx 不许再直接 import 它们）', () => {
    const strays: string[] = [];
    for (const panel of SETTINGS_PANELS) {
      if (app.includes(panel.marker)) strays.push(panel.marker);
      if (!center.includes(panel.marker)) strays.push(`${panel.marker}（设置中心里没挂）`);
    }
    expect(strays).toEqual([]);
  });

  it('左栏不许再出现设置类入口（同一个目的地只有一处门）', () => {
    const railLabels = Object.values(TAB_LABEL);
    const dup = railLabels.filter((label) =>
      (Object.values(SETTINGS_LABEL) as string[]).some((s) => s === label),
    );
    expect(dup).toEqual([]);
  });

  it('左栏的分组里不许混进设置项（`NAV_GROUPS` 只认工作区与工具两类）', () => {
    const allowed = new Set(Object.keys(TAB_LABEL));
    const strays = NAV_GROUPS.flatMap((g) => g.tabs.filter((t) => !allowed.has(t)));
    expect(strays).toEqual([]);
  });
});

describe('设置中心：每一项都要点得到', () => {
  it('每个设置项恰好属于一个分组（漏收 = 左导航里那一项点不到）', () => {
    const all = Object.keys(SETTINGS_LABEL) as SettingsItem[];
    const count = new Map<SettingsItem, number>();
    for (const group of SETTINGS_NAV) {
      for (const item of group.items) count.set(item, (count.get(item) ?? 0) + 1);
    }
    const missing = all.filter((item) => !count.has(item));
    const duplicated = [...count.entries()].filter(([, n]) => n > 1).map(([item]) => item);
    expect({ missing, duplicated }).toEqual({ missing: [], duplicated: [] });
  });

  it('分组不许是空壳，标题不许空或重复', () => {
    expect(SETTINGS_NAV.filter((g) => g.items.length === 0)).toEqual([]);
    const titles = SETTINGS_NAV.map((g) => g.title);
    expect(titles.filter((t) => t.trim() === '')).toEqual([]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('设置项至少 5 项、分组至少 3 组（太密 = 一堆设置挤成一坨）', () => {
    expect(Object.keys(SETTINGS_LABEL).length).toBeGreaterThanOrEqual(5);
    expect(SETTINGS_NAV.length).toBeGreaterThanOrEqual(3);
  });

  it('每个设置项都有显示名（显示名空 = 左导航里是个空按钮）', () => {
    const empty = (Object.keys(SETTINGS_LABEL) as SettingsItem[]).filter(
      (item) => SETTINGS_LABEL[item].trim() === '',
    );
    expect(empty).toEqual([]);
  });
});

describe('设置项：一行一条（R67 的视觉目标）', () => {
  it('外观页的设置项必须走 `SettingRow`（标题在左、控件在右）', () => {
    const uses = (appearance.match(/<SettingRow\b/g) ?? []).length;
    expect(
      uses,
      '外观页一个 `SettingRow` 都没有 ⇒ 那 5 个字段还在老表单网格里（这一轮搬家的视觉目标没达成）',
    ).toBeGreaterThanOrEqual(8);
  });
});

/**
 * **对话页不许被设置中心卸载**（T22 报备 §二：对话页常驻 · 切页签只切可见性、**不卸载**）。
 *
 * 怎么坏的（R67 的 e2e 当场抓到的真回归）：第一版把主区写成
 * 「设置中心开 ⇒ 整段换成设置中心」的**条件分支** ⇒ 打开设置中心会把对话页**一起卸载**
 * ⇒ 它的会话、连接选择、**在飞的流**全丢 ⇒ 用户切回对话页发现对话没了
 * ⇒ 而且这种丢法**界面上看不出是"设置"干的**（只表现为"对话没了"）。
 *
 * ⇒ 修法：正文**藏起来但不卸载**（`hidden`）⇒ 对话页的 state 与流订阅原样留着。
 * ⇒ 这条锁盯的是**形状**：正文容器必须用 `hidden={settingsOpen}`，
 * 且对话页（`<KeepAlive`）必须**在那个容器里面**（⇒ 它的行号在 `hidden=` 之后）。
 */
describe('设置中心：对话页不许被卸载', () => {
  it('正文靠 `hidden={settingsOpen}` 藏起来（不许用条件分支把它拆掉）', () => {
    expect(
      app,
      'App.tsx 里找不到 `hidden={settingsOpen}` ⇒ 正文不是"藏起来"的 ⇒ 打开设置中心会把对话页卸载',
    ).toContain('hidden={settingsOpen}');
  });

  it('对话页（`<KeepAlive`）在那个藏起来的容器**里面**', () => {
    const hiddenAt = app.indexOf('hidden={settingsOpen}');
    const keepAliveAt = app.indexOf('<KeepAlive');
    expect(hiddenAt, 'App.tsx 里找不到 `hidden={settingsOpen}`').toBeGreaterThan(-1);
    expect(keepAliveAt, 'App.tsx 里找不到 `<KeepAlive`（对话页常驻那套不见了）').toBeGreaterThan(-1);
    expect(
      keepAliveAt,
      '对话页（`<KeepAlive`）在 `hidden={settingsOpen}` **外面** ⇒ 打开设置中心会把它卸载 ⇒ 会话与在飞的流全丢（T22）',
    ).toBeGreaterThan(hiddenAt);
  });
});
