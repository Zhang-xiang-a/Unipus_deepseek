import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {COURSE_KEYS, isPlaceholder, listCourses, loadConfig, resolveConfig, resolveCourse} from '../src/config.mjs';

const examplePath = new URL('../config.example.json', import.meta.url);
const example = async () => JSON.parse(await fs.readFile(examplePath, 'utf8'));

test('示例配置包含 course1 ~ course4 四个分组，且课程字段齐全', async () => {
  const raw = await example();
  for (const key of COURSE_KEYS) {
    const course = raw.courses[key];
    assert.ok(course, `缺少 ${key}`);
    for (const field of ['label', 'textbook', 'courseId', 'courseUrl', 'unitCount', 'answerSource',
      'submitTexts', 'manualTaskTypes', 'skipTaskTypes', 'listeningKeywords']) {
      assert.ok(course[field] !== undefined, `${key} 缺少 ${field}`);
    }
    assert.equal(course.courseUrl.includes('{courseId}'), true, `${key} 的 courseUrl 应使用 {courseId} 模板`);
  }
});

test('示例配置里的课程 ID 全部是占位符', async () => {
  const raw = await example();
  for (const key of COURSE_KEYS) {
    assert.equal(isPlaceholder(raw.courses[key].courseId), true, `${key} 不应包含真实课程 ID`);
  }
});

test('占位符未替换时给出可执行的错误提示', async () => {
  const raw = await example();
  assert.throws(() => resolveConfig(raw, {argv: ['node'], env: {}}), /courseId 仍是占位符/);
});

test('填入 courseId 后自动替换 {courseId}，且可用 --course 切换', async () => {
  const raw = await example();
  raw.courses.course2.courseId = '10000000002';
  raw.activeCourse = 'course1';
  raw.courses.course1.courseId = '10000000001';
  const course = resolveCourse(raw, 'course2');
  assert.equal(course.courseUrl, 'https://uai.unipus.cn/app/cmgt/resource-detail/10000000002');
  const config = resolveConfig(raw, {argv: ['node', '--course', 'course2'], env: {}});
  assert.equal(config.course.key, 'course2');
  assert.equal(config.courseUrl, 'https://uai.unipus.cn/app/cmgt/resource-detail/10000000002');
});

test('环境变量可覆盖课程 ID、浏览器端口与 DeepSeek 地址', async () => {
  const raw = await example();
  raw.courses.course1.courseId = '10000000001';
  const config = resolveConfig(raw, {
    argv: ['node'],
    env: {UNIPUS_COURSE_ID: '88888888888', UNIPUS_BROWSER_ENDPOINT: 'http://127.0.0.1:9333', DEEPSEEK_URL: 'https://chat.example.test/'},
  });
  assert.equal(config.course.courseId, '88888888888');
  assert.match(config.courseUrl, /88888888888$/);
  assert.equal(config.browserEndpoint, 'http://127.0.0.1:9333');
  assert.equal(config.deepseekUrl, 'https://chat.example.test/');
});

test('未知课程分组报错并列出可用分组', async () => {
  const raw = await example();
  assert.throws(() => resolveCourse(raw, 'course9'), /没有课程分组 "course9".*course1/s);
});

test('旧配置的 delayMs / readingSeconds 会迁移到新结构', async () => {
  const raw = await example();
  raw.courses.course1.courseId = '10000000001';
  raw.delayMs = [100, 200];
  raw.choiceDelayMs = [10, 20];
  raw.readingSeconds = [7, 7];
  const config = resolveConfig(raw, {argv: ['node'], env: {}});
  assert.deepEqual(config.delayMs, [100, 200]);
  assert.deepEqual(config.choiceDelayMs, [10, 20]);
  assert.equal(config.learningPolicy.readingSeconds, 7);
});

test('示例配置不含账号、密码、cookie、token 之类字段', async () => {
  const raw = await example();
  const keys = [];
  const walk = value => {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key.toLowerCase());
      if (child && typeof child === 'object' && !Array.isArray(child)) walk(child);
    }
  };
  walk(raw);
  for (const word of ['password', 'passwd', 'cookie', 'token', 'username', 'account', '密码', '账号']) {
    assert.equal(keys.some(key => key.includes(word)), false, `示例配置不应出现 ${word} 字段`);
  }
});

test('listCourses 汇总四门课，未填写的标记为不可运行', async () => {
  const raw = await example();
  const rows = listCourses(raw);
  assert.deepEqual(rows.map(r => r.key), COURSE_KEYS);
  assert.equal(rows.every(r => r.ready === false), true);
});

test('配置文件不存在时提示先复制示例配置', async () => {
  const missing = path.join(os.tmpdir(), `unipus-missing-${Date.now()}.json`);
  assert.throws(() => loadConfig({file: missing, argv: ['node'], env: {}}), /config\.example\.json/);
});