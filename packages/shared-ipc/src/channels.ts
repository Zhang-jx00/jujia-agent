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

  /* ---------------------------- 内置终端（W9b） ---------------------------- */

  /** 新建终端会话（**会先弹权限审批**） */
  TERMINAL_START: 'terminal:start',

  /** 向终端写入输入 */
  TERMINAL_INPUT: 'terminal:input',

  /** 调整终端尺寸 */
  TERMINAL_RESIZE: 'terminal:resize',

  /** 结束终端会话 */
  TERMINAL_KILL: 'terminal:kill',

  /** main → renderer：终端数据与退出事件 */
  TERMINAL_STREAM: 'terminal:stream',

  /** 渲染层首帧回报（M18 启动性能实测） */
  PERF_FIRST_PAINT: 'perf:first-paint',

  /* ---------------------------- MCP（W10e） ---------------------------- */

  /** MCP 服务端：读取列表 / 新增或更新 / 删除 */
  MCP_SERVER_LIST: 'mcp:server-list',
  MCP_SERVER_SAVE: 'mcp:server-save',
  MCP_SERVER_DELETE: 'mcp:server-delete',
  /** 发起连接：启动子进程 → 握手 → 列工具 → 返回**待用户批准的计划** */
  MCP_CONNECT: 'mcp:connect',
  /** 回填用户的批准选择（逐工具） */
  MCP_APPROVE: 'mcp:approve',
  /** 断开：摘掉工具并退掉子进程 */
  MCP_DISCONNECT: 'mcp:disconnect',
  /** main → renderer：MCP 状态变化广播（进程退出、握手失败等） */
  MCP_STATE_CHANGED: 'mcp:state-changed',

  /* ---------------------------- 权限规则表（W5c） ---------------------------- */

  /** 权限规则：读取 / 新增 / 删除 / 启用开关 */
  PERMISSION_RULES_LIST: 'permission:rules-list',
  PERMISSION_RULES_ADD: 'permission:rules-add',
  PERMISSION_RULES_REMOVE: 'permission:rules-remove',
  PERMISSION_RULES_TOGGLE: 'permission:rules-toggle',
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
