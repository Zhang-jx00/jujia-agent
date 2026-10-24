import { lazy, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { ThemePack } from '@jujia/ui-tokens';
import { IconGear, IconSearch } from '../../ui/icons';
import { SETTINGS_LABEL, SETTINGS_NAV } from './settings-nav';
import type { SettingsItem } from './settings-nav';

/**
 * 设置中心（R67）。
 *
 * 形态：**整页覆盖主区**（左导航 + 右侧内容），不是页签、不是弹窗。
 * 为什么：设置是一类**"配一次、之后不用天天看"**的东西 —— 把它和"工作区"（天天用的）
 * 混在同一排页签里，结果是**左栏越列越长、设置越埋越深**。
 * ⇒ 左栏只留干活的入口（11 项）+ 底部的齿轮；设置类面板全部收进这里。
 *
 * 分组的口径与左栏**不同**：左栏按"用得多不多"排，设置按"**是什么东西**"排
 * （偏好 / 规则与安全 / 扩展）—— 用户来设置中心时脑子里的分类就是这个。
 */
export { SETTINGS_LABEL, SETTINGS_NAV } from './settings-nav';
export type { SettingsItem } from './settings-nav';

/** 面板一律**懒加载**（首屏 chunk 不许因为设置中心变大 —— 见 PERF-BUDGET） */
const AppearancePanel = lazy(() =>
  import('../appearance/AppearancePanel').then((m) => ({ default: m.AppearancePanel })),
);
const PermissionRulesPanel = lazy(() =>
  import('../permissions/PermissionRulesPanel').then((m) => ({ default: m.PermissionRulesPanel })),
);
const HooksPanel = lazy(() => import('../hooks/HooksPanel').then((m) => ({ default: m.HooksPanel })));
const PluginsPanel = lazy(() =>
  import('../plugins/PluginsPanel').then((m) => ({ default: m.PluginsPanel })),
);
const McpPanel = lazy(() => import('../mcp/McpPanel').then((m) => ({ default: m.McpPanel })));

export interface SettingsCenterProps {
  /** 当前样式包（外观页要用）；为空 = 还没解析出来 ⇒ 那一项显示占位 */
  pack: ThemePack | null;
  /** 保存样式包（写配置） */
  onSavePack: (pack: ThemePack) => void | Promise<void>;
  /** 回到应用（关掉设置中心） */
  onClose: () => void;
}

export function SettingsCenter({ pack, onSavePack, onClose }: SettingsCenterProps): ReactElement {
  const [item, setItem] = useState<SettingsItem>('appearance');
  const [query, setQuery] = useState('');

  /**
   * 搜索框是**真的**：按设置名过滤左导航（不是摆设）。
   *
   * 为什么值得做：设置项一多，"找那个开关"就会变成翻列表 ⇒ 参考界面里都有这一格。
   * 过滤后的分组如果**一项都不剩**，整个分组一起隐藏（不留下一个空标题）。
   */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return SETTINGS_NAV;
    return SETTINGS_NAV.map((group) => ({
      ...group,
      items: group.items.filter((it) => SETTINGS_LABEL[it].toLowerCase().includes(q)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <div className="jj-settings">
      <nav className="jj-settings-nav" aria-label="设置导航">
        <button type="button" className="jj-settings-back jj-transition" onClick={onClose}>
          <IconGear size={14} />
          <span>返回应用</span>
        </button>

        <div className="jj-settings-search">
          <IconSearch size={13} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索设置"
            aria-label="搜索设置"
          />
        </div>

        {groups.map((group) => (
          <div className="jj-settings-group" key={group.title}>
            <div className="jj-settings-group-title">{group.title}</div>
            {group.items.map((it) => (
              <button
                key={it}
                type="button"
                className={it === item ? 'jj-settings-item jj-settings-item-on' : 'jj-settings-item'}
                aria-current={it === item ? 'page' : undefined}
                onClick={() => setItem(it)}
              >
                {SETTINGS_LABEL[it]}
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="p0-subtitle jj-settings-empty">没有匹配「{query}」的设置项</p>}
      </nav>

      <main className="jj-settings-main">
        <header className="jj-settings-head">
          <h1 className="jj-settings-title">{SETTINGS_LABEL[item]}</h1>
        </header>
        <div className="jj-settings-body">
          {item === 'appearance' &&
            (pack === null ? (
              <p className="p0-subtitle">样式包还没解析出来，稍等一下…</p>
            ) : (
              <AppearancePanel pack={pack} onSave={onSavePack} />
            ))}
          {item === 'permissions' && <PermissionRulesPanel />}
          {item === 'hooks' && <HooksPanel />}
          {item === 'plugins' && <PluginsPanel />}
          {item === 'mcp' && <McpPanel />}
        </div>
      </main>
    </div>
  );
}

/** 懒加载占位（与外壳那一份同形） */
export const SETTINGS_FALLBACK = (
  <div className="jj-skeleton" aria-busy="true">
    <div className="jj-skeleton-line" />
    <div className="jj-skeleton-line" />
    <div className="jj-skeleton-line" />
  </div>
);
