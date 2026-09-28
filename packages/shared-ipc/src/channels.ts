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
  /** 会话清单（6a 持久化后才有磁盘事实可列） */
  CHAT_LIST: 'chat:list',
  /** main → renderer：流式事件推送 */
  CHAT_STREAM: 'chat:stream',

  /* ---------------- 6b：会话压缩与「结束记要点」 ----------------
   *
   * 三条规矩决定通道形状：
   * - **阈值只提示**：`COMPACT_STATUS` 只回答"该不该问用户"，主进程没有任何自动压缩路径；
   * - **落盘前必须预览**：`PREVIEW` 与 `APPLY` 是两次调用，第一次**什么都不写**；
   * - **B 不在退出时写盘**：`CHAT_END` 只记账，`PENDING_RESOLVE` 才是唯一能进长期记忆的那一下。
   */
  CHAT_COMPACT_STATUS: 'chat:compact-status',
  CHAT_COMPACT_PREVIEW: 'chat:compact-preview',
  CHAT_COMPACT_APPLY: 'chat:compact-apply',
  CHAT_END: 'chat:end',
  CHAT_PENDING_LIST: 'chat:pending-list',
  CHAT_PENDING_PREVIEW: 'chat:pending-preview',
  CHAT_PENDING_RESOLVE: 'chat:pending-resolve',

  /* ---------------- W3：工作区与权限 ---------------- */
  /** 工作区：读取当前 / 弹出目录选择 / 清除 */
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_PICK: 'workspace:pick',
  WORKSPACE_CLEAR: 'workspace:clear',
  /** main → renderer：请求权限审批（写/执行类工具） */
  PERMISSION_REQUEST: 'permission:request',
  /** renderer → main：回填用户的审批结果 */
  PERMISSION_RESOLVE: 'permission:resolve',
  /**
   * main → renderer：某个审批请求**已经在主进程侧结束**（超时 / 窗口销毁 / 被取消）。
   *
   * 为什么必须有它（外部审查 T9）：主进程 120 秒超时后会按"超时未响应"继续走，
   * 而渲染层的弹窗是靠自己排队显示的 —— 没有这条通知时它还挂着，
   * 用户随后点"允许"，决定落进一个已经不存在的需求里（点了等于没点，且没有任何提示）。
   * 载荷带**请求 id**：只关对应那一张，不能一把全关（同一时刻可能有多个请求在排队）。
   */
  PERMISSION_EXPIRED: 'permission:expired',
  /** renderer → main：在工作区内执行一个已注册的工具（经权限门） */
  TOOL_RUN: 'tool:run',

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
  /**
   * 取出当前"待你批准"的接入计划（外部审查 T9）。
   * 计划一直存在主进程（`session.pendingPlan`），以前只随 `mcp:connect` 的回包出来一次 ——
   * 界面把它存组件 state，切个页签就没了，用户只能重新连一次（等于真的再起一个第三方进程）。
   */
  MCP_PENDING_PLAN: 'mcp:pending-plan',
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
   * 打开一个网址。**只有一个入口**（M10 收尾时把原先的 `browser:open` / `browser:navigate`
   * 两条并进这一条）：三档"交给谁打开"授权强度不同（内置不问、外部两档每次硬 ask），
   * 如果界面还能绕过选档直接调"内置打开"，那"要不要问"就变成由调用方决定 —— 那不对。
   * 视图已存在时换页还是首次加载，由主进程按当前状态判断，渲染层不必区分。
   */
  BROWSER_OPEN_WITH: 'browser:open-with',
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

  /**
   * 自选程序路径的三条（M10 收尾）。
   *
   * 为什么路径**只能经 PICK 写入**：这个值决定"启动哪个本机进程"。
   * 开一条"界面塞个路径进来"的通道，等于把选程序的授权转移给渲染层 ——
   * 一旦渲染层被注入，"打开网页"就会变成"执行攻击者指定的 exe"。
   * 所以 SET 只接受清空（见 `browserExeClearSchema` 的 `.strict()` + 只收 null）。
   */
  BROWSER_EXE_PICK: 'browser:exe-pick',
  /** 查询当前自选程序路径与它还能不能用 */
  BROWSER_EXE_GET: 'browser:exe-get',
  /** 清除自选程序 */
  BROWSER_EXE_SET: 'browser:exe-set',

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
