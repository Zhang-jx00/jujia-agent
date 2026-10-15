import { describe, expect, it } from 'vitest';
import { SECURITY_BASELINE } from '@jujia/shared-ipc';
import {
  assertBaselineConstantIntact,
  assertSecureWebPreferences,
  isAllowedNavigation,
  isTrustedSenderUrl,
  safeProtocol,
  secureWebPreferences,
} from './security';

const preload = 'C:/app/out/preload/index.js';

describe('SECURITY_BASELINE 字面量真值守卫', () => {
  // 复核发现（第二遍）：断言若复用常量本身会形成自引用校验，常量被改坏时不报错。
  // 此用例把真值写死，任何把常量改成不安全值的改动都会在此失败。
  it('常量必须与字面量真值完全一致', () => {
    expect(SECURITY_BASELINE).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    });
    expect(() => assertBaselineConstantIntact()).not.toThrow();
  });
});

describe('assertSecureWebPreferences（安全基线 fail-closed）', () => {
  it('默认模板通过自检', () => {
    expect(() =>
      assertSecureWebPreferences({
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        preload,
      }),
    ).not.toThrow();
  });

  it.each([
    ['contextIsolation 被关闭', { contextIsolation: false }],
    ['sandbox 被关闭', { sandbox: false }],
    ['nodeIntegration 被打开', { nodeIntegration: true }],
    ['webSecurity 被关闭', { webSecurity: false }],
    ['webviewTag 被打开', { webviewTag: true }],
    ['缺少 preload 桥', { preload: undefined }],
  ])('%s → 必须抛错', (_name, override) => {
    const base = {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      preload,
    } as Record<string, unknown>;
    expect(() => assertSecureWebPreferences({ ...base, ...override } as never)).toThrow(
      /\[security\]/,
    );
  });
});

describe('secureWebPreferences 的唯一可选位 offscreen（R32 展示页截图）', () => {
  /**
   * 这一位是"没人看也要画"的开关：截图模式靠它，日常窗口**绝不允许**带上它
   * （带上的症状是双击图标什么都没发生）。所以两侧都要锁：给了才有、没给就整个键都不存在。
   *
   * **红证说明（复核 089）**：这两条是 R32 代码写完、给变异 M310 做首校时补的断言 ——
   * 补的判据必须当场能红，否则等于没有。证据 = M310 把那一行 spread 摘掉之后这两条一起失败
   * （不是"看着绿"），详见 review/REVIEW-LOG.md 复核 089 的变异首校段。
   */
  it('显式要 offscreen 才有这一位，且不破坏安全基线', () => {
    const wp = secureWebPreferences(preload, { offscreen: true });
    expect(wp.offscreen).toBe(true);
    expect(() => assertSecureWebPreferences(wp)).not.toThrow();
  });

  it('不给选项 / 给 false 时，这一位整个不存在（日常窗口不 offscreen）', () => {
    expect('offscreen' in secureWebPreferences(preload)).toBe(false);
    expect('offscreen' in secureWebPreferences(preload, { offscreen: false })).toBe(false);
  });
});

describe('isAllowedNavigation', () => {
  it('放行渲染层目录内的 file:// 与 dev server 同源', () => {
    expect(
      isAllowedNavigation('file:///D:/app/out/renderer/index.html', undefined, 'D:/app/out/renderer'),
    ).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/x', 'http://localhost:5173')).toBe(true);
  });

  it('**file: 不再无条件放行**：渲染层目录之外一律拦截（2026-09-23 收紧）', () => {
    // 此前任何 file: 都被当成"应用自身"，于是 file:///C:/任意本地页 也能占住主窗口
    expect(isAllowedNavigation('file:///C:/evil.html', undefined, 'D:/app/out/renderer')).toBe(false);
    expect(
      isAllowedNavigation('file:///D:/app/out/renderer/../../secret.html', undefined, 'D:/app/out/renderer'),
    ).toBe(false);
  });

  it('没给渲染层目录基线时 file: 一律不放行（fail closed）', () => {
    expect(isAllowedNavigation('file:///D:/app/out/renderer/index.html')).toBe(false);
  });

  it('子目录（渲染层资源）仍然放行', () => {
    expect(
      isAllowedNavigation('file:///D:/app/out/renderer/assets/index.js', undefined, 'D:/app/out/renderer'),
    ).toBe(true);
  });

  it('拦截外部站点与非法 URL', () => {
    expect(isAllowedNavigation('https://evil.example.com')).toBe(false);
    expect(isAllowedNavigation('http://localhost:9999', 'http://localhost:5173')).toBe(false);
    expect(isAllowedNavigation('not a url')).toBe(false);
  });
});

describe('safeProtocol', () => {
  it('仅识别合法 scheme', () => {
    expect(safeProtocol('https://a.com')).toBe('https:');
    expect(safeProtocol('javascript:alert(1)')).toBe('javascript:');
    expect(safeProtocol('###')).toBe('');
  });
});

describe('isTrustedSenderUrl（IPC 发送方校验）', () => {
  const RENDERER = 'D:/app/out/renderer';

  it('放行应用自身渲染层（file: 且落在渲染层目录内）', () => {
    expect(isTrustedSenderUrl('file:///D:/app/out/renderer/index.html', undefined, RENDERER)).toBe(true);
  });

  it('放行开发模式的 dev server 源', () => {
    expect(
      isTrustedSenderUrl('http://localhost:5173/index.html', 'http://localhost:5173', RENDERER),
    ).toBe(true);
  });

  it('拦截其他本地文件、外部站点、以及空来源（fail closed）', () => {
    expect(isTrustedSenderUrl('file:///C:/evil.html', undefined, RENDERER)).toBe(false);
    expect(isTrustedSenderUrl('https://evil.example.com/', undefined, RENDERER)).toBe(false);
    expect(isTrustedSenderUrl('', undefined, RENDERER)).toBe(false);
    expect(isTrustedSenderUrl('about:blank', undefined, RENDERER)).toBe(false);
  });

  it('开发者工具自身的调用放行（否则调试时工具链会失灵）', () => {
    expect(isTrustedSenderUrl('devtools://devtools/bundled/panel.html', undefined, RENDERER)).toBe(true);
  });
});
