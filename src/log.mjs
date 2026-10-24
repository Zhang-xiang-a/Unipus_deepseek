// 关键步骤的文本日志：logs/run-YYYY-MM-DD.log。
// 原有的 artifacts/*.jsonl 仍然保留，这里补一份人可读的流水，方便出问题后直接翻。
import fs from 'node:fs';
import path from 'node:path';
import {LOGS_DIR} from './paths.mjs';

const LEVELS = {debug: 10, info: 20, warn: 30, error: 40};

function stamp(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function createLogger({dir = LOGS_DIR, level = 'info', echo = true, prefix = 'run'} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const file = path.join(dir, `${prefix}-${new Date().toISOString().slice(0, 10)}.log`);
  let ready = false;
  const ensure = () => {
    if (ready) return;
    fs.mkdirSync(dir, {recursive: true});
    ready = true;
  };
  const write = (name, args) => {
    if ((LEVELS[name] ?? 0) < threshold) return;
    const message = args.map(value => value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
    const line = `[${stamp(new Date())}] ${name.toUpperCase()} ${message}\n`;
    try { ensure(); fs.appendFileSync(file, line, 'utf8'); } catch { /* 日志失败不应中断主流程 */ }
    if (!echo) return;
    const sink = name === 'error' ? console.error : name === 'warn' ? console.warn : console.log;
    sink(`${name === 'info' ? '' : `[${name}] `}${message}`);
  };
  return {
    file,
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  };
}

// 默认实例：所有模块共用同一个日志文件。
export const logger = createLogger();