// 向正在运行的 runner 发送暂停/恢复/停止/跳过命令。
// 控制文件写在当前课程自己的 artifacts/<courseKey>/ 下，四门课的进度互不影响。
import fs from 'node:fs/promises';
import path from 'node:path';
import {courseOutputDir} from './paths.mjs';
import {loadConfig} from './config.mjs';

const command = process.argv[2];
if (!['pause', 'resume', 'stop', 'skip'].includes(command)) {
  throw new Error('用法：node src/control.mjs pause|resume|stop|skip');
}
// 只读配置即可，不要求 courseId 已填写。
const config = loadConfig({validate: false});
const dir = courseOutputDir(config.course.key);
await fs.mkdir(dir, {recursive: true});
await fs.writeFile(path.join(dir, 'control.json'), JSON.stringify({command, course: config.course.key, time: new Date().toISOString()}));
console.log(`${command}（${config.course.label}）`);