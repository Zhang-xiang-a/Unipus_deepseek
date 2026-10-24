// 单独监控当前课件视频播放进度（调试用）：只读播放状态，不答题、不提交。
// 原来的写法直接在 finally 里 b.close()，会把用户正在使用的 Edge 关掉；这里改为只断开连接。
import fs from 'node:fs/promises';
import path from 'node:path';
import {muteCourse} from './mute.mjs';
import {loadConfig} from './config.mjs';
import {courseOutputDir} from './paths.mjs';
import {connectBrowser} from './net.mjs';

const config = loadConfig();
const output = courseOutputDir(config.course.key);
const browser = await connectBrowser(config.browserEndpoint, {
  retries: config.network.retries,
  retryDelayMs: config.network.retryDelayMs,
  timeoutMs: config.network.connectTimeoutMs,
});
const coursewareHost = config.login?.courseHosts?.find(host => /ucontent/i.test(host)) || 'ucontent.unipus.cn';
const page = browser.contexts()[0].pages().find(p => {
  try { return new URL(p.url()).hostname === coursewareHost; } catch { return false; }
});
if (!page) throw new Error('未找到课程课件标签；请先 npm run browser 并打开一个视频任务');
await muteCourse(page);
const start = page.url();
await page.bringToFront();
await page.locator('video').evaluate(video => video.play());
let pausedByUs = false;
let last = -1;
try {
  while (true) {
    let command = 'resume';
    try { command = JSON.parse(await fs.readFile(path.join(output, 'control.json'), 'utf8')).command; } catch { /* 未运行 runner 时按 resume 处理 */ }
    if (page.url() !== start) throw new Error('用户已切换页面，停止视频监控');
    if (command === 'stop') { await page.locator('video').evaluate(video => video.pause()); break; }
    if (command === 'pause') { await page.locator('video').evaluate(video => video.pause()); pausedByUs = true; }
    else if (pausedByUs) { await page.locator('video').evaluate(video => video.play()); pausedByUs = false; }
    const state = await page.locator('video').evaluate(video => ({
      time: video.currentTime, duration: video.duration, ended: video.ended, paused: video.paused, error: video.error?.message,
    }));
    if (Math.floor(state.time / 30) !== last) { console.log(JSON.stringify(state)); last = Math.floor(state.time / 30); }
    await fs.writeFile(path.join(output, 'video-status.json'), JSON.stringify(state, null, 2));
    if (state.error) throw new Error(state.error);
    if (state.ended) { console.log('视频正常播放结束'); break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // 结束 Node 进程即可断开 CDP，不发送 Browser.close。
  process.exit(process.exitCode ?? 0);
}