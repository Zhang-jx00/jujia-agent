import { access, constants, stat } from 'node:fs/promises';
import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import type { WorkspaceInfo } from '@jujia/shared-ipc';
import { readConfigSnapshot, writeConfig } from './config-store';

/**
 * 工作区管理（W3）。
 *
 * 设计要点：
 * - 工作区路径存在 config.json（原子写），与主题等设置同源；
 * - **选择目录只能由用户通过系统对话框产生**：不接受渲染层传来的任意路径，
 *   否则「工作区」这道边界就形同虚设（渲染层被注入脚本时可直接指定 C:\ ）；
 * - 校验三件事：存在、是目录、可写（不可写则如实告知，写工具会失败）。
 */

export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  const { config } = await readConfigSnapshot();
  const root = config.workspace;
  if (!root) {
    return { root: null, valid: false, writable: false, message: '尚未选择工作区' };
  }

  try {
    const info = await stat(root);
    if (!info.isDirectory()) {
      return { root, valid: false, writable: false, message: '该路径不是目录' };
    }
  } catch {
    return { root, valid: false, writable: false, message: '目录不存在（可能已被移动或删除）' };
  }

  let writable = true;
  try {
    await access(root, constants.W_OK);
  } catch {
    writable = false;
  }

  return {
    root,
    valid: true,
    writable,
    message: writable ? '工作区可用' : '目录存在但不可写（写工具会失败）',
  };
}

/** 弹出系统目录选择框；用户取消则返回当前状态 */
export async function pickWorkspace(parent: BrowserWindow | undefined): Promise<WorkspaceInfo> {
  const options = {
    title: '选择工作区目录',
    properties: ['openDirectory', 'createDirectory'] as const,
    buttonLabel: '设为工作区',
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, { ...options, properties: [...options.properties] })
    : await dialog.showOpenDialog({ ...options, properties: [...options.properties] });

  if (result.canceled || result.filePaths.length === 0) {
    return getWorkspaceInfo();
  }

  const chosen = result.filePaths[0] as string;
  await writeConfig({ workspace: chosen });
  return getWorkspaceInfo();
}

export async function clearWorkspace(): Promise<WorkspaceInfo> {
  await writeConfig({ workspace: null });
  return getWorkspaceInfo();
}
