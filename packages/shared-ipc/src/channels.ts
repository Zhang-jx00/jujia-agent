/**
 * IPC 通道常量。
 * 约定：所有跨进程通道必须在此登记，禁止在 main/preload/renderer 里写裸字符串。
 */
export const IPC = {
  /** renderer → main：读取应用与运行时信息（P0 冒烟用） */
  APP_INFO: 'app:info',
  /** main → renderer：应用状态变化广播（预留） */
  APP_STATE_CHANGED: 'app:state-changed',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** 安全基线快照，用于自检「安全开关是否被误改」。 */
export const SECURITY_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
} as const;
