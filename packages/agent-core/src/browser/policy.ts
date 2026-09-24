/**
 * 内置浏览器的**导航策略**（轨道扩容计划 1 · M10）。
 *
 * 为什么先写它、且做成纯函数：内置浏览器是本项目**攻击面最大**的一个功能 ——
 * 它要在应用里跑第三方网页，而这个应用的渲染层手里有整套 IPC 桥。
 * 所以"什么能开、什么绝不能开"必须是**确定性规则 + 可单测 + 可变异**，
 * 而不是散在 Electron 回调里的 if。
 *
 * 只读逻辑：这里不引入 electron，纯字符串判断，可以在任何环境跑测试。
 */

export type NavigationDecision =
  | { allow: true; reason: string }
  | { allow: false; reason: string };

/** 允许的协议：**只有 http/https**。 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * 明确点名的危险协议 —— 单独列出是为了给出**可读的拒绝理由**（而不是笼统的"不支持"）。
 * 这些协议一旦被导航加载，等于让网页内容直接碰本机资源或执行脚本。
 */
const DANGEROUS_PROTOCOLS: Record<string, string> = {
  'file:': '本地文件协议（会读到磁盘上的任意文件）',
  'javascript:': 'javascript 伪协议（等于执行脚本）',
  'data:': 'data 伪协议（内容内联，无法按站点隔离）',
  'about:': 'about 协议（内部页面，不属于网页）',
  'chrome:': '浏览器内部协议',
  'devtools:': '开发者工具协议',
  'blob:': 'blob 协议（来源不可核查）',
  'filesystem:': '文件系统 API',
};

/** 输入是不是一个"能当 URL 看待"的字符串 */
export function normalizeInputUrl(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  // 用户往往只输域名：补 https（**不补 http**：默认走加密）
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 判定一次导航是否允许。
 *
 * 说明：**允许 localhost / 127.0.0.1** —— 本地开发服务是最常见的正当用途
 * （而且 e2e 正是靠它做端到端的真实加载验证）。公网域名同样允许，
 * 因为"在应用里看网页"就是这个功能本身。
 */
export function decideNavigation(rawUrl: string): NavigationDecision {
  const text = rawUrl.trim();

  // **输入里不允许空白**：WHATWG 解析会静默剥掉首尾空白，而"带空白的网址"几乎总是构造出来的
  if (/\s/.test(text)) {
    return { allow: false, reason: '网址里含有空白字符，已拒绝' };
  }

  /**
   * **先对原始输入做结构校验，再交给 URL 解析**。
   *
   * 为什么顺序重要（实测踩过）：`http:///path` 会被 URL 解析器"修好"——
   * `path` 被提升成主机名，等解析完再检查就查不出来了。原始输入不会撒谎。
   */
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (schemeMatch !== null) {
    const scheme = schemeMatch[1]?.toLowerCase() ?? '';
    const dangerous = DANGEROUS_PROTOCOLS[`${scheme}:`] ?? null;
    if (dangerous !== null) {
      return { allow: false, reason: `已拒绝 ${scheme}: —— ${dangerous}` };
    }
    // http/https **必须**是 `scheme://主机` 形态（这是 URL 规范，也是防"缺主机"的关键）
    if (scheme === 'http' || scheme === 'https') {
      const after = text.slice(schemeMatch[0].length);
      if (!after.startsWith('//')) {
        return { allow: false, reason: `${scheme}: 后缺少 //主机` };
      }
      const hostPart = after.slice(2).split(/[/?#]/)[0] ?? '';
      if (hostPart === '') {
        return { allow: false, reason: '缺少主机名（// 后面直接是路径）' };
      }
    }
  }

  const normalized = normalizeInputUrl(text);
  if (normalized === null) {
    return { allow: false, reason: '这不是一个合法的网址（也补不出协议）' };
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return { allow: false, reason: '网址解析失败' };
  }

  const protocol = url.protocol.toLowerCase();
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    return { allow: false, reason: `只允许 http/https，收到的是 ${protocol}` };
  }

  // **主机字符集收窄**：WHATWG 允许主机里出现 `!` 这类字符（实测 `https://ht!tp://x` 的主机是 `ht!tp`），
  // 这不是用户想要的网址，却能让"看起来像网址"的输入通过。只放行 域名/IP 形态。
  const host = url.hostname.toLowerCase();
  const isIpv6 = /^\[[0-9a-f:]+\]$/.test(host);
  const hostOk = isIpv6 || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*$/.test(host);
  if (host === '' || !hostOk) {
    return { allow: false, reason: `主机名不合法：${host === '' ? '(空)' : host}` };
  }

  return { allow: true, reason: 'http/https 网页' };
}

/** 这个主机是不是本机（用于界面上标注"本地服务"） */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/** 新窗口/弹窗的处理决定：**一律不开新窗口**，交给系统浏览器由调用方决定 */
export function decideWindowOpen(rawUrl: string): { action: 'deny'; forwardToSystem: boolean; reason: string } {
  const decision = decideNavigation(rawUrl);
  return {
    action: 'deny',
    forwardToSystem: decision.allow,
    reason: decision.allow
      ? '不在这里开新窗口（保持只有一个受控视图）；如需外部打开，询问用户'
      : `连外部打开都不做：${decision.reason}`,
  };
}

/**
 * **用户主动**导航的判定：只过协议策略，并回传规范化后的地址。
 *
 * 单独成一个函数，是为了让"用户点的"与"页面自己跳的"是两条**明确不同**的路径 ——
 * 前者是用户意志（地址是他敲的），后者不是。把两者混成一个判断，等于让页面冒用用户的授权。
 *
 * 规范化**复用本文件的 `normalizeInputUrl`**：调用方不要自己再补一遍协议。
 * 两处各写一次，早晚会漂成两套规则。
 */
export function decideUserNavigation(
  rawUrl: string,
): { allow: true; url: string } | { allow: false; reason: string } {
  const decision = decideNavigation(rawUrl);
  if (!decision.allow) return { allow: false, reason: decision.reason };
  const normalized = normalizeInputUrl(rawUrl);
  if (normalized === null) return { allow: false, reason: '网址无法规范化' };
  return { allow: true, url: normalized };
}

/**
 * **页面发起**的导航（重定向 / meta refresh / 脚本改 `location`）：
 * 除协议策略外，还必须**留在用户所打开的那个站点（origin）内**。
 *
 * 为什么需要这一层：`decideNavigation` 只回答"这是不是合法的 http(s) 网址"，
 * 它不知道**用户本意要看的是哪儿**。放任页面任意跳，等于把"用户点了 example.com"
 * 这张通行证发给整个网络 —— 跳到钓鱼页、跳到 `127.0.0.1:<随机端口>` 打本机服务，
 * 都排在这个口子后面。
 *
 * `userOrigin === null` 时**一律拒绝**：那时还没有任何用户意志可言。
 */
export function decideProgrammaticNavigation(
  userOrigin: string | null,
  targetUrl: string,
): { allow: true } | { allow: false; reason: string } {
  const decision = decideNavigation(targetUrl);
  if (!decision.allow) return { allow: false, reason: `页面跳转被拒：${decision.reason}` };

  if (userOrigin === null) {
    return { allow: false, reason: '页面在没有用户打开任何地址时试图导航，已拒绝' };
  }
  let targetOrigin: string;
  try {
    // `URL.origin` 自带规范化（主机小写、去默认端口），所以比较不会被输入形态糊弄
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    return { allow: false, reason: '页面跳转的目标不是合法网址，已拒绝' };
  }
  if (targetOrigin !== userOrigin) {
    return {
      allow: false,
      reason: `页面试图跳出用户打开的站点（${userOrigin} → ${targetOrigin}），已拒绝`,
    };
  }
  return { allow: true };
}
