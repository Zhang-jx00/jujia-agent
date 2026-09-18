/**
 * IPC 通道常量。
 * 约定：所有跨进程通道必须在此登记，禁止在 main/preload/renderer 里写裸字符串。
 */
export const IPC = {
  /** renderer → main：读取应用与运行时信息（P0 冒烟用） */
  APP_INFO: 'app:info',
  /** renderer → main：读取应用配置（W1 打通原子存储在真实运行时的读写） */
  CONFIG_GET: 'config:get',
  /** renderer → main：改写应用配置 */
  CONFIG_SET: 'config:set',
  /** main → renderer：应用状态变化广播（预留） */
  APP_STATE_CHANGED: 'app:state-changed',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** 安全基线快照，用于自检「安全开关是否被误改」。字段与 apps/desktop 的 REQUIRED_SECURE 一一对应。 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
} as const;
