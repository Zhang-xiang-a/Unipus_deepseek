// 网络与浏览器连接的健壮性封装：超时、有限重试、随机间隔。
// 只包装页面导航与 CDP 连接；不改变原有业务逻辑与选择器。
import {chromium} from 'playwright';
import {logger} from './log.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 在 [lo, hi] 毫秒之间取随机整数，用于请求/导航之间的节流。 */
export function between(lo, hi) {
  const low = Number.isFinite(lo) ? lo : 0;
  const high = Number.isFinite(hi) ? hi : low;
  return Math.floor(low + Math.random() * Math.max(0, high - low));
}

/**
 * 有限次重试。fn 抛错时按 retryDelayMs 退避，超过次数后抛出最后一次错误，
 * 并在错误信息里注明尝试次数，避免"静默失败"。
 */
export async function withRetry(fn, {retries = 2, retryDelayMs = 1500, label = '操作', log = logger, onRetry} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      log.warn(`${label}失败（第 ${attempt + 1}/${retries + 1} 次）：${error.message}；${retryDelayMs}ms 后重试`);
      if (onRetry) await onRetry(attempt, error);
      await sleep(retryDelayMs);
    }
  }
  const suffix = retries > 0 ? `（已重试 ${retries} 次）` : '';
  throw new Error(`${label}失败${suffix}：${lastError?.message || '未知错误'}`);
}

/**
 * 连接已启动的 Edge 调试端口。
 * 9028/9228 端口在 Edge 刚启动时可能还没就绪，因此这里是"连接级"重试，
 * 而不是让脚本直接崩溃。
 */
export async function connectBrowser(endpoint, {retries = 3, retryDelayMs = 1500, timeoutMs = 15000, log = logger} = {}) {
  return withRetry(
    async () => chromium.connectOverCDP(endpoint, {timeout: timeoutMs}),
    {
      retries,
      retryDelayMs,
      label: `连接浏览器 ${endpoint}`,
      log,
      onRetry: async () => { await sleep(between(300, 900)); },
    }
  );
}

/** 页面跳转带超时与重试；用于目录页、课件页的重新载入。 */
export async function gotoWithRetry(page, url, {
  retries = 2,
  retryDelayMs = 1500,
  timeoutMs = 30000,
  waitUntil = 'domcontentloaded',
  log = logger,
} = {}) {
  return withRetry(
    async () => {
      const response = await page.goto(url, {waitUntil, timeout: timeoutMs});
      // 5xx 视为可重试；4xx 一般是地址或权限问题，直接抛出更清晰。
      if (response && response.status() >= 500) {
        throw new Error(`页面返回 HTTP ${response.status()}`);
      }
      return response;
    },
    {retries, retryDelayMs, label: `打开页面 ${url}`, log}
  );
}