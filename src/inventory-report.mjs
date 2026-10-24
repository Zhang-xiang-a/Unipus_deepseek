// 题型统计：把已采集的必修任务按"题型"分组，供答题队列筛选。
// 题型识别关键词来自配置（defaults.typeRules / 课程 typeRules），
// 换教材后发现分类不准时改配置即可，不用改这里的分支逻辑。
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {courseOutputDir} from './paths.mjs';
import {DEFAULTS, loadConfig} from './config.mjs';

/** 按规则对象/字符串匹配任务。规则为对象时，每个键是一个字段条件。 */
export function ruleMatches(rule, task) {
  if (!rule) return false;
  const pathText = (task.path || []).join('/');
  if (typeof rule === 'string') return new RegExp(rule, 'i').test(pathText);
  return Object.entries(rule).every(([field, pattern]) => {
    const value = field === 'task' ? String(task.task || '')
      : field === 'path' ? pathText
      : field === 'text' ? String(task.text || '')
      : '';
    return new RegExp(pattern, 'i').test(value);
  });
}

export function classifyTask(task, rules = DEFAULTS.typeRules) {
  const inputs = (task.controls || []).filter(c => ['input', 'textarea', 'select'].includes(c.tag));
  const pathText = (task.path || []).join('/');
  const test = (pattern, value) => !!pattern && new RegExp(pattern, 'i').test(value);

  if (ruleMatches(rules.projectUpload, task)) return '项目作品上传';
  if (ruleMatches(rules.review, task)) return '复习自评';
  if ((task.controls || []).some(c => c.className === 'caption' && test(rules.choiceCaption, c.text))) {
    return test(rules.trueFalseText, task.text) ? '三项判断（True / False / Not given）' : '选择题';
  }
  if (inputs.some(c => c.tag === 'select')) return '下拉选择';
  if (inputs.some(c => c.tag === 'input')) {
    return test(rules.bankedCloze, task.task || '') ? '选词完形填空' : '单词 / 短语填空';
  }
  if (inputs.some(c => c.tag === 'textarea' || c.editable)) {
    if (test(rules.sentenceStructure, pathText)) return '句型改写 / 完成句子';
    if (test(rules.translation, `${pathText} ${String(task.text || '').slice(0, 250)}`)) return '翻译';
    if (test(rules.writing, pathText)) return '写作 / 项目';
    return '开放问答 / 讨论';
  }
  if (test(rules.vocabulary, task.task || '')) return '词汇卡片';
  if (task.media?.length && test(rules.media, task.task || '')) return '音视频学习';
  return rules.fallback || '阅读或尚未识别的交互';
}

export async function buildTypeReport({rules = DEFAULTS.typeRules, dir} = {}) {
  if (!dir) throw new Error('buildTypeReport 需要传入 dir（当前课程的 artifacts/<courseKey>/inventory）');
  let tasks;
  try {
    tasks = JSON.parse(await fs.readFile(path.join(dir, 'required-tasks.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`还没有该课程的采集数据：${path.join(dir, 'required-tasks.json')}\n请先运行 npm run crawl 采集必修任务。`);
    throw error;
  }
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).filter(t => t.required);
  const groups = {};
  for (const t of tasks) {
    const type = classifyTask(t, rules);
    (groups[type] ??= []).push({unit: t.unit, path: [...t.path, t.task], key: t.key, url: t.url});
  }
  const seen = new Set(tasks.map(t => t.key));
  const missing = manifest.filter(t => !seen.has(t.key));
  return {total: manifest.length, visited: seen.size, complete: !missing.length, groups, missing};
}

async function main() {
  // 与 runner 用同一套课程解析：--course / UNIPUS_PROFILE / activeCourse 都生效。
  const config = loadConfig({validate: false});
  // 题型报告写进当前课程自己的目录，四门课互不覆盖。
  const dir = path.join(courseOutputDir(config.course.key), 'inventory');
  const report = await buildTypeReport({rules: config.typeRules, dir});
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, 'type-report.json'), JSON.stringify(report, null, 2));
  let md = `# 必修题型采集\n\n已采集 ${report.visited}/${report.total} 个任务。` +
    `${report.complete ? '全部必修任务已逐页采集。' : '尚未完成，题型可能增加。'}\n\n` +
    '以下分类来自页面题干和控件；“阅读或尚未识别”仍需复核。\n\n| 类型 | 任务页数 | 示例 |\n|---|---:|---|\n';
  for (const [type, items] of Object.entries(report.groups)) {
    md += `| ${type} | ${items.length} | Unit ${items[0].unit} / ${items[0].path.join(' / ')} |\n`;
  }
  await fs.writeFile(path.join(dir, 'type-report.md'), md);
  console.log(md);
}

// 仅在直接运行时执行；被测试 import 时不写文件。
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}