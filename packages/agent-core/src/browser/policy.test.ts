import { describe, expect, it } from 'vitest';
import {
  decideNavigation,
  decideProgrammaticNavigation,
  decideUserNavigation,
  decideWindowOpen,
  isLoopbackHost,
  normalizeInputUrl,
} from './policy';

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

describe('decideUserNavigation（用户主动导航：只过协议策略）', () => {
  it('放行 http/https 并回传规范化后的地址', () => {
    const r = decideUserNavigation('https://example.com/a');
    expect(r.allow).toBe(true);
    if (r.allow) expect(r.url).toBe('https://example.com/a');
  });

  it('只输域名时补 https（复用 normalizeInputUrl，不是另写一套）', () => {
    const r = decideUserNavigation('example.com');
    expect(r.allow).toBe(true);
    // 断言写死字面量真值，不用 normalizeInputUrl 自己证明自己（自引用断言踩过多次）
    if (r.allow) expect(r.url).toBe('https://example.com/');
  });

  it('危险协议一律拒绝并给出理由（不是空返回）', () => {
    const r = decideUserNavigation('file:///C:/Windows/win.ini');
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toContain('file');
  });

  it('带空白的输入被拒（用户粘贴时常见的看不见的坑）', () => {
    const r = decideUserNavigation('https://exa mple.com');
    expect(r.allow).toBe(false);
  });
});

describe('decideProgrammaticNavigation（页面自己跳：协议 + 不得越站）', () => {
  it('同站跳转放行', () => {
    expect(decideProgrammaticNavigation('https://example.com', 'https://example.com/next').allow).toBe(true);
  });

  it('跨站跳转被拒，且理由里写明两侧 origin（用户看得懂为什么没跳过去）', () => {
    const r = decideProgrammaticNavigation('https://example.com', 'https://evil.test/');
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.reason).toContain('example.com');
      expect(r.reason).toContain('evil.test');
    }
  });

  it('userOrigin 为 null 时一律拒绝：还没有用户意志可言', () => {
    expect(decideProgrammaticNavigation(null, 'https://example.com/').allow).toBe(false);
  });

  it('协议策略先于 origin 判定：同站的 file: 也照样拒', () => {
    const r = decideProgrammaticNavigation('https://example.com', 'file:///C:/x');
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toContain('页面跳转被拒');
  });

  it('大小写与默认端口不算跨站（URL.origin 已规范化）', () => {
    // 用户打开 https://Example.com，页面跳 https://example.com/x —— 这是同站，不该误拦
    expect(decideProgrammaticNavigation('https://example.com', 'https://EXAMPLE.com/x').allow).toBe(true);
    // 而显式带 443 端口同样视为同源（origin 会去掉默认端口）
    expect(decideProgrammaticNavigation('https://example.com', 'https://example.com:443/x').allow).toBe(true);
  });

  it('子域不是同站（example.com 的页面不能跳到 intranet.example.com）', () => {
    expect(decideProgrammaticNavigation('https://example.com', 'https://intranet.example.com/').allow).toBe(false);
  });

  it('跳到本机地址一律要单独授权（防"网页拿来打本机服务"）', () => {
    // 用户打开公网页 → 页面跳 127.0.0.1:随机端口，这是内网探测的经典路径
    expect(decideProgrammaticNavigation('https://example.com', 'http://127.0.0.1:9999/').allow).toBe(false);
  });
});
