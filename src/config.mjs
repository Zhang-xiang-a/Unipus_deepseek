// 配置加载与课程解析。
//
// 设计原则：
// 1. 因课而异的参数（课程 ID、章节入口 URL、题型关键词、答案来源、提交按钮文案）
//    全部放在 config.json 的 courses.course1 ~ course4 分组里，代码里不再出现课程名。
// 2. 账号、密码、cookie、token 一律不进入本项目配置：登录态由专用 Edge profile
//    保存，程序通过 CDP 复用已登录页面。
// 3. 只读取本机文件与环境变量，不联网。
import fs from 'node:fs';
import path from 'node:path';
import {CONFIG_FILE, CONFIG_EXAMPLE_FILE} from './paths.mjs';

export const COURSE_KEYS = ['course1', 'course2', 'course3', 'course4'];

// 通用默认值：examples 里没写的字段在这里兜底，保证旧配置仍能运行。
export const DEFAULTS = {
  browserEndpoint: 'http://127.0.0.1:9228',
  channel: 'msedge',
  maxSteps: 1200,
  responseTimeoutMs: 240000,
  incorrectChoiceRate: 0.01,
  uploadScreenshots: true,
  muteCourseMedia: true,
  dryRun: true,
  deepseek: {
    url: 'https://chat.deepseek.com/',
    composer: 'textarea',
    fileInput: 'input[type=file]',
    uploadButton: '',
  },
  login: {
    ssoHost: 'sso.unipus.cn',
    courseHosts: ['uai.unipus.cn', 'ucontent.unipus.cn'],
  },
  uiTexts: {
    submitConfirm: '确定提交吗',
    answerSummary: '答题小结',
    answerSummaryEntry: '查看答题小结',
    dismiss: '我知道了',
    startLearning: '开始学习',
    continueLearning: '继续学习',
    newChat: '开启新对话',
    vocabularyNext: '下一个',
  },
  network: {
    connectTimeoutMs: 15000,
    gotoTimeoutMs: 30000,
    retries: 2,
    retryDelayMs: 1500,
  },
  throttle: {
    actionDelayMs: [1800, 4500],
    fillDelayMs: [250, 600],
    choiceDelayMs: [150, 350],
  },
  logging: {dir: 'logs', level: 'info'},
  answerLoop: {maxStallRounds: 3, maxRoundsPerTask: 12, newChatEveryRounds: 8},
  answerPolicy: {
    objective: 'deepseek_99_other_01',
    judgement: 'deepseek_100',
    subjective: 'deepseek_direct',
    manualTasks: 'project_upload_and_self_review_only',
  },
  runnerPolicy: {
    skippedTasks: 'remember',
    listeningChoices: 'first',
    deepseekFailure: 'continue',
    taskFailure: 'continue',
  },
  learningPolicy: {
    video: 'normal_play_until_ended',
    readingSeconds: 10,
    vocabulary: 'next_until_last_then_quiz',
    subtasks: 'track_full_unit_section_tab_task_path',
  },
  // 题型识别关键词：换教材后如有差异，在课程的 typeRules 里覆盖同名键即可。
  typeRules: {
    manual: ['项目作品上传', '复习自评'],
    projectUpload: {task: '^Unit project$', text: 'upload your work'},
    review: {task: '^Review & check$'},
    choiceCaption: '^[A-Z]$',
    trueFalseText: 'True\\.|False\\.|Not given\\.',
    bankedCloze: 'Banked cloze',
    sentenceStructure: 'Sentence structure',
    translation: 'Translat',
    writing: 'Structured writing|Unit project',
    vocabulary: '^Vocabulary$',
    media: 'Preview|Viewing|Critical thinking skill',
    fallback: '阅读或尚未识别的交互',
  },
};

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** 两层对象合并：对象递归合并，数组与标量整体替换。 */
export function mergeConfig(base, override) {
  const out = {...base};
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeConfig(out[key], value) : value;
  }
  return out;
}

/** `<COURSE_ID_1>`、空串、纯空白都算"还没填"。 */
export function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  const text = String(value).trim();
  return text === '' || /^<.*>$/.test(text) || text === '{}' || text === '[]';
}

export function courseArgFromArgv(argv = process.argv) {
  const index = argv.indexOf('--course');
  if (index >= 0) return argv[index + 1];
  return undefined;
}

/** 只读取原始 JSON，不做课程校验；供题型统计、--list 等只读命令使用。 */
export function loadRawConfig({file = CONFIG_FILE} = {}) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `未找到配置文件 ${file}。\n请先复制示例配置：\n` +
      `  Windows: copy config.example.json config.json\n` +
      `  macOS/Linux: cp config.example.json config.json\n` +
      `然后填写目标课程的 courseId，详见 README 的“配置方法”。`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`配置文件不是合法 JSON：${file}\n${error.message}`);
  }
}

/**
 * 读取配置并解析当前课程。
 * 返回值同时保留 courses/defaults 原文，并把当前课程字段扁平化到顶层，
 * 这样旧脚本里的 config.courseUrl、config.delayMs 之类写法仍然可用。
 */
export function loadConfig({file = CONFIG_FILE, argv = process.argv, env = process.env, validate = true} = {}) {
  return resolveConfig(loadRawConfig({file}), {argv, env, file, validate});
}

export function resolveConfig(raw, {argv = process.argv, env = process.env, validate = true} = {}) {
  const selector = courseArgFromArgv(argv) || env.UNIPUS_PROFILE || raw.activeCourse || COURSE_KEYS[0];
  const course = resolveCourse(raw, selector, env);
  const defaults = mergeConfig(DEFAULTS, raw.defaults || {});
  const flat = {
    ...defaults,
    ...raw,
    // 兼容旧字段名
    deepseekUrl: env.DEEPSEEK_URL || course.deepseek?.url || raw.deepseekUrl || defaults.deepseek.url,
    deepseekComposer: course.deepseek?.composer || raw.deepseekComposer || defaults.deepseek.composer,
    deepseekFileInput: course.deepseek?.fileInput || raw.deepseekFileInput || defaults.deepseek.fileInput,
    deepseekUploadButton: course.deepseek?.uploadButton ?? raw.deepseekUploadButton ?? defaults.deepseek.uploadButton,
    browserEndpoint: env.UNIPUS_BROWSER_ENDPOINT || raw.browserEndpoint || defaults.browserEndpoint,
    courseUrl: course.courseUrl,
    activeCourse: selector,
    course,
    courses: raw.courses || {},
    units: course.unitCount,
    submitTexts: course.submitTexts,
    manualTaskTypes: course.manualTaskTypes,
    skipTaskTypes: course.skipTaskTypes,
    listeningKeywords: course.listeningKeywords,
    typeRules: mergeConfig(defaults.typeRules, course.typeRules || {}),
    uiTexts: mergeConfig(defaults.uiTexts, course.uiTexts || {}),
    network: mergeConfig(defaults.network, course.network || {}),
    throttle: mergeConfig(defaults.throttle, course.throttle || {}),
    answerLoop: mergeConfig(defaults.answerLoop, course.answerLoop || {}),
    learningPolicy: mergeConfig(defaults.learningPolicy, course.learningPolicy || {}),
  };
  // 旧配置用顶层 delayMs / fillDelayMs / choiceDelayMs / readingSeconds，这里迁移到新结构。
  if (raw.delayMs || raw.fillDelayMs || raw.choiceDelayMs) {
    flat.throttle = {
      ...flat.throttle,
      actionDelayMs: raw.delayMs || flat.throttle.actionDelayMs,
      fillDelayMs: raw.fillDelayMs || flat.throttle.fillDelayMs,
      choiceDelayMs: raw.choiceDelayMs || flat.throttle.choiceDelayMs,
    };
  }
  if (raw.readingSeconds) {
    flat.learningPolicy = {
      ...flat.learningPolicy,
      readingSeconds: raw.learningPolicy?.readingSeconds ?? raw.readingSeconds[0] ?? flat.learningPolicy.readingSeconds,
    };
  }
  // 旧代码用 config.delayMs / fillDelayMs / choiceDelayMs，这里保持别名指向 throttle。
  flat.delayMs = flat.throttle.actionDelayMs;
  flat.fillDelayMs = flat.throttle.fillDelayMs;
  flat.choiceDelayMs = flat.throttle.choiceDelayMs;
  if (flat.dryRun && (argv.includes('--execute') || env.UNIPUS_DRY_RUN === '0')) flat.dryRun = false;
  if (!flat.dryRun && (argv.includes('--dry-run') || env.UNIPUS_DRY_RUN === '1')) flat.dryRun = true;
  // --list / --courses 只读命令允许在课程 ID 还没填好时先看队列与分组。
  if (validate) validateConfig(flat);
  return flat;
}

/** 取出某个课程分组并把 defaults 合并进去。 */
export function resolveCourse(raw, selector = COURSE_KEYS[0], env = process.env) {
  const courses = raw.courses || {};
  const keys = Object.keys(courses);
  if (!courses[selector]) {
    throw new Error(
      `config.json 里没有课程分组 "${selector}"。可用分组：${keys.length ? keys.join(' / ') : '（无）'}。\n` +
      `请检查 activeCourse 或 --course 参数，四门课分别对应 course1 ~ course4。`
    );
  }
  const merged = mergeConfig(mergeConfig(DEFAULTS, raw.defaults || {}), courses[selector]);
  const courseId = env.UNIPUS_COURSE_ID || merged.courseId;
  const template = String(merged.courseUrl || '');
  const courseUrl = template.replace(/\{courseId\}/g, String(courseId ?? ''));
  const label = merged.label || selector;
  return {
    ...merged,
    key: selector,
    label,
    courseId,
    courseUrl,
    unitCount: Number(merged.unitCount ?? 6),
    submitTexts: merged.submitTexts || ['提交', '提交答案', 'Submit'],
    manualTaskTypes: merged.manualTaskTypes || ['项目作品上传', '复习自评'],
    skipTaskTypes: merged.skipTaskTypes || [],
    listeningKeywords: merged.listeningKeywords || ['听力', '听写', 'listening', 'dictation'],
    answerSource: merged.answerSource || 'deepseek-web',
    uiTexts: mergeConfig(DEFAULTS.uiTexts, merged.uiTexts || {}),
    network: mergeConfig(DEFAULTS.network, merged.network || {}),
    throttle: mergeConfig(DEFAULTS.throttle, merged.throttle || {}),
    typeRules: mergeConfig(DEFAULTS.typeRules, merged.typeRules || {}),
  };
}

export function describeCourse(course) {
  return `${course.label}（${course.key}，courseId=${isPlaceholder(course.courseId) ? '未填写' : course.courseId}，${course.unitCount} 个单元）`;
}

export function validateConfig(config) {
  const course = config.course;
  if (!course) throw new Error('配置缺少当前课程，请检查 activeCourse');
  const problems = [];
  if (isPlaceholder(course.courseId)) problems.push('courseId 仍是占位符，请填写 U 校园课程 ID');
  if (isPlaceholder(course.courseUrl) || /\{courseId\}/.test(course.courseUrl)) {
    problems.push('courseUrl 无法解析，请填写完整课程入口 URL，或把 courseId 填进 courseUrl 模板');
  } else {
    try {
      const url = new URL(course.courseUrl);
      if (url.protocol !== 'https:') problems.push('courseUrl 必须是 https 地址');
    } catch {
      problems.push('courseUrl 不是合法 URL');
    }
  }
  if (!Number.isInteger(course.unitCount) || course.unitCount < 1 || course.unitCount > 30) {
    problems.push('unitCount 必须是 1~30 的整数');
  }
  if (!Array.isArray(course.submitTexts) || !course.submitTexts.length) {
    problems.push('submitTexts 至少需要一个提交按钮文案');
  }
  if (!['deepseek-web', 'manual'].includes(course.answerSource)) {
    problems.push('answerSource 只能是 deepseek-web 或 manual');
  }
  if (!Array.isArray(course.manualTaskTypes)) problems.push('manualTaskTypes 必须是数组（可以为空数组）');
  const endpoint = String(config.browserEndpoint || '');
  try {
    if (new URL(endpoint).hostname !== '127.0.0.1') problems.push('browserEndpoint 必须指向本机 127.0.0.1');
  } catch {
    problems.push('browserEndpoint 不是合法 URL');
  }
  if (problems.length) {
    throw new Error(
      `课程配置 ${describeCourse(course)} 有 ${problems.length} 处问题：\n` +
      problems.map(text => `  - ${text}`).join('\n') +
      `\n示例配置见 ${path.basename(CONFIG_EXAMPLE_FILE)}，字段说明见 README。`
    );
  }
  return config;
}

/** --list 之类的只读命令用：把四个分组列出来，不要求当前课程已填写完整。 */
export function listCourses(raw) {
  const courses = raw.courses || {};
  return Object.keys(courses).map(key => {
    const course = resolveCourse(raw, key);
    return {
      key,
      label: course.label,
      courseId: isPlaceholder(course.courseId) ? '（未填写）' : course.courseId,
      unitCount: course.unitCount,
      answerSource: course.answerSource,
      ready: !isPlaceholder(course.courseId) && !/\{courseId\}/.test(course.courseUrl),
    };
  });
}