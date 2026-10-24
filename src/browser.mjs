// 启动/复用专用 Edge 窗口。只负责把浏览器拉起来并补建缺失标签，
// 不登录、不答题；登录由用户在窗口里手动完成。
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {ensureBrowserPages, showBrowserPage} from './browser-session.mjs';
import {describeCourse, loadConfig} from './config.mjs';
import {BROWSER_PROFILE_DIR} from './paths.mjs';
import {logger} from './log.mjs';
import {sleep, withRetry} from './net.mjs';

const config = loadConfig();
const endpoint = config.browserEndpoint;
const url = new URL(endpoint);
if (url.hostname !== '127.0.0.1') throw new Error('浏览器调试端口必须限制在本机 127.0.0.1');
logger.info(`当前课程：${describeCourse(config.course)}`);

async function endpointReady() {
  try {
    const response = await fetch(`${endpoint}/json/version`, {signal: AbortSignal.timeout(800)});
    return response.ok;
  } catch { return false; }
}

async function ensurePages() {
  const browser = await chromium.connectOverCDP(endpoint, {timeout: config.network.connectTimeoutMs});
  const context = browser.contexts()[0];
  if (!context) throw new Error('CDP 会话没有可用浏览器上下文');
  const {course, created} = await ensureBrowserPages(context, config);
  await showBrowserPage(context, course);
  console.log(created.length
    ? `已显示专用 Edge，恢复缺失标签：${created.join('、')}。`
    : '已显示并复用专用 Edge，原课程和 DeepSeek 标签均保留。');
  if (course.url().includes(config.login?.ssoHost || 'sso.unipus.cn')) {
    console.log('原课程标签目前是登录页，请在此窗口登录 U 校园后运行答题命令；脚本不会自动填写账号密码。');
  }
  logger.info(`浏览器就绪：${endpoint}，${created.length ? `新建标签 ${created.join('、')}` : '复用已有标签'}`);
}

if (await endpointReady()) {
  await withRetry(ensurePages, {
    retries: config.network.retries,
    retryDelayMs: config.network.retryDelayMs,
    label: '接管现有 Edge 调试会话',
  });
} else {
  const candidates = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(dir => path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  let executable;
  for (const candidate of candidates) {
    try { await fs.access(candidate); executable = candidate; break; } catch { /* 继续找下一个 */ }
  }
  if (!executable) throw new Error('未找到 Microsoft Edge，请先安装 Edge 或修改 config.json 的 channel 设置');
  await fs.mkdir(BROWSER_PROFILE_DIR, {recursive: true});
  const child = spawn(executable, [
    `--remote-debugging-port=${url.port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${BROWSER_PROFILE_DIR}`,
    '--no-first-run',
    '--restore-last-session',
  ], {detached: true, stdio: 'ignore', windowsHide: true});
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  let connected = false;
  for (let i = 0; i < 30; i++) {
    if (await endpointReady()) { connected = true; break; }
    await sleep(500);
  }
  if (!connected) throw new Error('Edge 调试端口未就绪；检查该 profile 是否已被其他 Edge 进程占用');
  await withRetry(ensurePages, {
    retries: config.network.retries,
    retryDelayMs: config.network.retryDelayMs,
    label: '连接新启动的 Edge',
  });
  console.log('Edge 会话已启动。后续脚本复用此窗口，任务退出不会关闭浏览器。');
}

// connectOverCDP 没有公开 disconnect API；让 Node 进程结束即可断开 WebSocket，不能调用 browser.close()，
// 后者会向远端发送 Browser.close 并关闭用户正在使用的 Edge。
process.exit(0);