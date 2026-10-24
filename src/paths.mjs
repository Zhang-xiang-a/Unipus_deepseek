// 统一路径解析：所有脚本都从这里取目录，避免各自用 fileURLToPath 反推、
// 或像旧版 answer.mjs 那样用 '../config.json' 反向读配置。
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** src/ 目录 */
export const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 项目根目录（src 的上一级） */
export const ROOT_DIR = path.resolve(SRC_DIR, '..');

export const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');
export const CONFIG_EXAMPLE_FILE = path.join(ROOT_DIR, 'config.example.json');
export const ARTIFACTS_DIR = path.join(ROOT_DIR, 'artifacts');
export const INVENTORY_DIR = path.join(ARTIFACTS_DIR, 'inventory');
export const LOGS_DIR = path.join(ROOT_DIR, 'logs');
export const BROWSER_PROFILE_DIR = path.join(ROOT_DIR, 'browser-profile');
export const SESSION_FILE = path.join(BROWSER_PROFILE_DIR, 'runner-session.json');

/**
 * 每门课的运行数据单独放一层目录，避免 course1 的采集清单被 course3 的答题队列复用。
 * 切换课程后各自保留进度，互不串题。
 */
export function courseOutputDir(courseKey, base = ARTIFACTS_DIR) {
  return path.join(base, String(courseKey || 'course1'));
}