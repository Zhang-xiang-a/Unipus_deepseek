import fs from 'node:fs/promises';
import path from 'node:path';
import {loadAnswerQueue} from './answer.mjs';
import {verifyTaskProgress} from './task-progress.mjs';
import {loadConfig} from './config.mjs';
import {courseOutputDir} from './paths.mjs';
import {connectBrowser} from './net.mjs';

// Observe progress requested by the existing page; do not answer or submit.
const config=loadConfig();
const output=courseOutputDir(config.course.key);
try {await fs.access(path.join(output,'runner.lock'));throw new Error('runner 正在运行，请结束后再核验，避免改变正在作答的页面');}
catch(error){if(error.code!=='ENOENT')throw error;}
const arg=process.argv.indexOf('--tasks');
const numbers=(process.argv[arg+1] || '').split(',').map(Number);
const {queue,unit}=await loadAnswerQueue({output,unitCount:config.course.unitCount,manualTaskTypes:config.course.manualTaskTypes,skipTaskTypes:config.course.skipTaskTypes});
if(!unit || arg<0 || numbers.some(n=>!Number.isInteger(n)||n<1||n>queue.length))throw new Error('指定 --unit 和 --tasks，例如 --unit 3 --skip-banked-cloze --tasks 33,35,39');
const selected=[...new Set(numbers)].map(number=>({number,task:queue[number-1]}));
const unitIds=new Set(selected.map(({task})=>new URL(task.url).hash.split('/courseware/')[1]?.split('/')[0]));
if(unitIds.size!==1 || unitIds.has(undefined))throw new Error('核验任务不属于同一个课程单元');
const unitId=[...unitIds][0];
const browser=await connectBrowser(config.browserEndpoint,{
  retries:config.network.retries,retryDelayMs:config.network.retryDelayMs,timeoutMs:config.network.connectTimeoutMs});
try {
  const coursewareHost=config.login?.courseHosts?.find(h=>/ucontent/i.test(h)) || 'ucontent.unipus.cn';
  const page=browser.contexts()[0]?.pages().find(p=>{try{return new URL(p.url()).hostname===coursewareHost;}catch{return false;}});
  if(!page)throw new Error('未找到现有课程课件标签；没有新开网页');
  const responsePromise=page.waitForResponse(response=>{
    const url=new URL(response.url());
    return response.ok() && url.pathname.includes('/course_progress/') && url.pathname.split('/').at(-3)===unitId;
  },{timeout:30000});
  const [response]=await Promise.all([responsePromise,page.reload({waitUntil:'domcontentloaded',timeout:config.network.gotoTimeoutMs})]);
  const data=await response.json();
  const saved=JSON.parse(await fs.readFile(path.join(output,'answer-progress.json'),'utf8'));
  const records=selected.map(({number,task})=>{
    const progress=verifyTaskProgress(task,data);
    const evidence=saved.tasks[task.key]?.evidence;
    const score=typeof evidence==='string'?Number(evidence.match(/(?:^|\n)(\d+(?:\.\d+)?)分/)?.[1] ?? NaN):NaN;
    return {number,key:task.key,path:task.path,...progress,
      score:Number.isFinite(score)?score:null,submissionEvidence:evidence ?? null};
  });
  const result={unit,tasks:records,allCourseCompleted:records.every(t=>t.courseCompletionVerified),
    source:'现有课程页面重新载入时收到的 course_progress 响应',checkedAt:new Date().toISOString()};
  await fs.writeFile(path.join(output,'task-verification.json'),JSON.stringify(result,null,2));
  for(const record of records)console.log(`[${record.number}] 课程完成=${record.courseCompletionVerified} state=${JSON.stringify(record.state)} 本次得分=${record.score ?? '未知'}`);
  process.exitCode=result.allCourseCompleted?0:1;
} catch(error) {console.error(error.message);process.exitCode=1;}
// End the connection without closing Edge.
process.exit(process.exitCode || 0);
