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

  /* ---------------------------- 生命周期钩子（W5d） ---------------------------- */

  /** 读取当前钩子配置（含校验错误）/ 保存；以及配置文件路径 */
  HOOKS_GET: 'hooks:get',
  HOOKS_SET: 'hooks:set',

  /* ------------------------------ 插件（W11b） ------------------------------ */

  /** 读取插件加载结果（含诊断）；界面用它展示装了什么、贡献了什么、哪里有问题 */
  PLUGINS_GET: 'plugins:get',

  /* ---------------------------- 内置浏览器（M10） ---------------------------- */

  /**
   * 用户从地址栏主动打开/跳转。
   *
   * 为什么 OPEN 与 NAVIGATE 分两条：OPEN 负责"创建受控视图 + 首次加载"，
   * NAVIGATE 负责"视图已存在时按用户意图换页"。两者走**同一条策略判定**
   * （`agent-core` 的 `decideNavigation`），分开只是让界面的意图与主进程的生命周期对齐。
   */
  BROWSER_OPEN: 'browser:open',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_RELOAD: 'browser:reload',
  /** 关闭视图并销毁 webContents（不留后台） */
  BROWSER_CLOSE: 'browser:close',
  /** 读取正文交给模型（**只读**：拿不到 DOM 之外的任何能力） */
  BROWSER_GET_TEXT: 'browser:get-text',
  /** 渲染层上报占位区位置；主进程据此摆放视图（视图浮在渲染层之上，只能由主进程定位） */
  BROWSER_SET_BOUNDS: 'browser:set-bounds',
  /** 查询当前状态 */
  BROWSER_STATE: 'browser:state',
  /** main → renderer：状态变化广播（含"某次导航被策略拒绝"） */
  BROWSER_STATE_CHANGED: 'browser:state-changed',

  /* ---------------------------- git 模块（M8 接线） ---------------------------- */

  /**
   * 三条**只读**通道：status / diff / log —— 权限档"不问"，因为不改任何东西。
   * 与写侧刻意分成三条而不是"一个 GIT_RUN"：
   * 一旦开一条能传任意 git 参数的通道，等于把 `git push -f`、`git reset --hard` 全放进来了，
   * 权限档就没法按动作分级（只读不问 / 暂存软问 / 提交硬问）。
   */
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_LOG: 'git:log',
  /** 暂存 / 取消暂存：**软 ask**（改的是暂存区，可逆） */
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  /** 提交：**硬 ask**（会写入仓库历史，任何「总是允许」都压不掉） */
  GIT_COMMIT: 'git:commit',
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
