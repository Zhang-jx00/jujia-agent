import { describe, expect, it } from 'vitest';
import { decideNavigation, decideWindowOpen, isLoopbackHost, normalizeInputUrl } from './policy';

/**
 * 内置浏览器的导航策略（轨道扩容计划 1 · M10）。
 *
 * 这是本项目**攻击面最大的功能**：它要在应用里跑第三方网页，而渲染层手里有整套 IPC 桥。
 * 因此"什么能开"必须是确定性规则 —— 这些用例就是那条规则的边界。
 */

describe('normalizeInputUrl', () => {
  it('只输域名时补 https（不补 http，默认走加密）', () => {
    expect(normalizeInputUrl('example.com')).toBe('https://example.com/');
  });

  it('已有协议就原样保留', () => {
    expect(normalizeInputUrl('http://localhost:8080/a')).toBe('http://localhost:8080/a');
  });

  it('空串 / 不可解析 → null（不猜）', () => {
    expect(normalizeInputUrl('')).toBeNull();
    expect(normalizeInputUrl('   ')).toBeNull();
    expect(normalizeInputUrl('http://')).toBeNull();
  });
});

describe('decideNavigation：允许什么', () => {
  it('http / https 允许', () => {
    expect(decideNavigation('https://example.com').allow).toBe(true);
    expect(decideNavigation('http://example.com').allow).toBe(true);
  });

  it('本机地址允许（本地开发服务是正当用途，e2e 的真实加载验证也靠它）', () => {
    expect(decideNavigation('http://localhost:5173').allow).toBe(true);
    expect(decideNavigation('http://127.0.0.1:8080/index.html').allow).toBe(true);
  });
});

describe('decideNavigation：拒绝什么（每一条都给得出理由）', () => {
  const denied = [
    ['file:///C:/Windows/System32/drivers/etc/hosts', 'file:'],
    ['file:///D:/secret.txt', 'file:'],
    ['javascript:alert(1)', 'javascript:'],
    ['data:text/html,<script>alert(1)</script>', 'data:'],
    ['about:blank', 'about:'],
    ['chrome://settings', 'chrome:'],
    ['devtools://devtools/bundled/inspector.html', 'devtools:'],
    ['blob:https://x/abc', 'blob:'],
    ['filesystem:https://x/temporary/a', 'filesystem:'],
  ] as const;

  for (const [url, scheme] of denied) {
    it(`拒绝 ${scheme}（理由是这句话，不是"不支持"）`, () => {
      const d = decideNavigation(url);
      expect(d.allow).toBe(false);
      if (!d.allow) {
        expect(d.reason).toContain(scheme);
        expect(d.reason.length).toBeGreaterThan(6); // 不是空话
      }
    });
  }

  it('缺少主机名的不放行', () => {
    expect(decideNavigation('http:///path').allow).toBe(false);
  });

  it('**大小写与空白不能绕过**：`FILE:`、`  javascript:` 一样拒', () => {
    expect(decideNavigation('FILE:///C:/x').allow).toBe(false);
    expect(decideNavigation('  javascript:alert(1)  ').allow).toBe(false);
    expect(decideNavigation('JavaScript:alert(1)').allow).toBe(false);
  });

  it('畸形输入不抛异常、一律拒绝（fail closed）', () => {
    expect(decideNavigation('ht!tp://x').allow).toBe(false);
    expect(decideNavigation('://').allow).toBe(false);
  });
});

describe('decideWindowOpen：弹窗一律不在这里开', () => {
  it('合法链接：拒绝开新窗口，但标记"可交给系统浏览器"（由调用方问用户）', () => {
    const d = decideWindowOpen('https://example.com');
    expect(d.action).toBe('deny');
    expect(d.forwardToSystem).toBe(true);
  });

  it('危险链接：连系统浏览器都不转交（避免把危险 scheme 递给外部程序）', () => {
    const d = decideWindowOpen('file:///C:/x');
    expect(d.action).toBe('deny');
    expect(d.forwardToSystem).toBe(false);
  });
});

describe('isLoopbackHost（界面标注"本地服务"用）', () => {
  it('识别本机地址的几种写法', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('example.com')).toBe(false);
    // 陷阱：127.0.0.1.evil.com 不是本机（前缀相似而已）
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
  });
});
