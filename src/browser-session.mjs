// 课程标签页的识别、补建与登录态检查。
// 域名与 SSO 主机来自课程配置（login.courseHosts / login.ssoHost），
// 旧调用不传 hosts 时仍按内置的 U 校园域名判断。
export const DEFAULT_COURSE_HOSTS = ['uai.unipus.cn', 'ucontent.unipus.cn'];
export const DEFAULT_SSO_HOST = 'sso.unipus.cn';

export function isCourseUrl(value, {includeLogin = true, hosts = DEFAULT_COURSE_HOSTS, ssoHost = DEFAULT_SSO_HOST} = {}) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (hosts.includes(url.hostname)) return true;
    if (!includeLogin || url.hostname !== ssoHost) return false;
    const service = url.searchParams.get('service');
    return !!service && isCourseUrl(service, {includeLogin: false, hosts, ssoHost});
  } catch { return false; }
}

export function isLoginPage(page, {ssoHost = DEFAULT_SSO_HOST} = {}) {
  try { return new URL(page.url()).hostname === ssoHost; } catch { return false; }
}

/**
 * 登录态失效时给出可执行的提示，而不是让后续操作在登录页上莫名失败。
 * 返回 true 表示已登录；抛错表示需要人工重新登录。
 */
export function assertCourseLoggedIn(page, course = {}) {
  const ssoHost = course.login?.ssoHost || DEFAULT_SSO_HOST;
  if (isLoginPage(page, {ssoHost})) {
    const error = new Error(
      `课程标签目前停在登录页（${ssoHost}），登录态已过期或尚未登录。\n` +
      '处理方式：执行 npm run browser 显示专用 Edge，在原课程标签完成登录后重新运行；' +
      '脚本不会自动填写账号密码。'
    );
    error.fatal = true;
    throw error;
  }
  return true;
}

export function selectCoursePage(pages, options = {}) {
  const hosts = options.hosts || DEFAULT_COURSE_HOSTS;
  const hostOf = page => { try { return new URL(page.url()).hostname; } catch { return ''; } };
  // 优先选课件页（ucontent），没有课件页再退回目录页 / 登录页。
  const coursewareHost = hosts.find(host => /ucontent/i.test(host));
  return (coursewareHost && pages.find(page => hostOf(page) === coursewareHost))
    || pages.find(p => isCourseUrl(p.url(), {...options, hosts, includeLogin: false}))
    || pages.find(p => isCourseUrl(p.url(), {...options, hosts}));
}

export async function ensureBrowserPages(context, config) {
  // SSO is still the original course tab; never replace or duplicate it.
  const hosts = config.login?.courseHosts || DEFAULT_COURSE_HOSTS;
  const ssoHost = config.login?.ssoHost || DEFAULT_SSO_HOST;
  let course = selectCoursePage(context.pages(), {hosts, ssoHost});
  const solverHost = (() => { try { return new URL(config.deepseekUrl).hostname; } catch { return 'chat.deepseek.com'; } })();
  let solver = context.pages().find(p => {
    try { return new URL(p.url()).hostname === solverHost; } catch { return false; }
  });
  const created = [];
  const timeout = config.network?.gotoTimeoutMs ?? 30000;
  for (const [name, target] of [['course', config.courseUrl], ['deepseek', config.deepseekUrl]]) {
    if (name === 'course' ? course : solver) continue;
    const page = await context.newPage();
    if (name === 'course') course = page; else solver = page;
    await page.goto(target, {waitUntil: 'domcontentloaded', timeout});
    created.push(name);
  }
  return {course, solver, created};
}

export async function showBrowserPage(context, page) {
  const session = await context.newCDPSession(page);
  try {
    const {windowId, bounds} = await session.send('Browser.getWindowForTarget');
    if (bounds.windowState === 'minimized') await session.send('Browser.setWindowBounds', {windowId, bounds: {windowState: 'normal'}});
    await page.bringToFront();
  } finally { await session.detach(); }
}