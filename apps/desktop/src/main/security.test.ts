import { describe, expect, it } from 'vitest';
import { SECURITY_BASELINE } from '@jujia/shared-ipc';
import {
  assertBaselineConstantIntact,
  assertSecureWebPreferences,
  isAllowedNavigation,
  safeProtocol,
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

describe('isAllowedNavigation', () => {
  it('放行 file:// 与 dev server 同源', () => {
    expect(isAllowedNavigation('file:///D:/app/index.html')).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/x', 'http://localhost:5173')).toBe(true);
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
