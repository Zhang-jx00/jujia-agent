import { safeStorage } from 'electron';

/**
 * 密钥保护：优先用 Electron `safeStorage`（Windows 走 DPAPI，绑定当前用户账户），
 * 不可用时退化为明文并在 UI 明确标注，绝不假装安全。
 *
 * 复核纪律：渲染层永远拿不到明文；只有 main 侧发请求时才解密。
 */
export interface ProtectedSecret {
  scheme: 'safeStorage' | 'plain';
  value: string;
}

export function protectSecret(plain: string): ProtectedSecret {
  if (plain === '') return { scheme: 'plain', value: '' };
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { scheme: 'safeStorage', value: safeStorage.encryptString(plain).toString('base64') };
    }
  } catch (err) {
    console.warn('[secret] safeStorage 不可用，退化为明文存储:', err instanceof Error ? err.message : err);
  }
  return { scheme: 'plain', value: plain };
}

export function revealSecret(secret: ProtectedSecret | null): string {
  if (!secret) return '';
  if (secret.scheme === 'plain') return secret.value;
  try {
    return safeStorage.decryptString(Buffer.from(secret.value, 'base64'));
  } catch (err) {
    console.error('[secret] 解密失败（换机/换用户后无法解密，需要重新填写密钥）:', err);
    return '';
  }
}

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** 生成 `sk-…c3f9` 形式的提示串，供 UI 让用户确认填的是哪一把密钥 */
export function hintOf(plain: string): string | null {
  if (!plain) return null;
  if (plain.length <= 8) return '****';
  return `${plain.slice(0, 4)}…${plain.slice(-4)}`;
}
