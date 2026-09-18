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

  /* ---------------- W2：连接与对话 ---------------- */
  /** 连接：列表 / 新增 / 更新 / 删除 / 连通性测试 */
  CONNECTION_LIST: 'connection:list',
  CONNECTION_CREATE: 'connection:create',
  CONNECTION_UPDATE: 'connection:update',
  CONNECTION_DELETE: 'connection:delete',
  CONNECTION_TEST: 'connection:test',
  /** 对话：发起 / 中止 / 读取历史 */
  CHAT_SEND: 'chat:send',
  CHAT_STOP: 'chat:stop',
  CHAT_HISTORY: 'chat:history',
  /** main → renderer：流式事件推送 */
  CHAT_STREAM: 'chat:stream',

  /* ---------------- W3：工作区与权限 ---------------- */
  /** 工作区：读取当前 / 弹出目录选择 / 清除 */
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_PICK: 'workspace:pick',
  WORKSPACE_CLEAR: 'workspace:clear',
  /** main → renderer：请求权限审批（写/执行类工具） */
  PERMISSION_REQUEST: 'permission:request',
  /** renderer → main：回填用户的审批结果 */
  PERMISSION_RESOLVE: 'permission:resolve',
  /** renderer → main：在工作区内执行一个已注册的工具（经权限门） */
  TOOL_RUN: 'tool:run',

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
