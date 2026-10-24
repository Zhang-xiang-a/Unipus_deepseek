import fs from 'node:fs/promises';
import path from 'node:path';
import {courseOutputDir} from './paths.mjs';
import {loadConfig} from './config.mjs';
// 只统计当前课程自己的 artifacts/<courseKey>/，避免四门课的数据混在一起。
const config=loadConfig({validate:false});
const dir=courseOutputDir(config.course.key);
// 答题小结文案来自配置，平台改词时审计逻辑不用改。
const summaryText=config.uiTexts?.answerSummary || '答题小结';
const unit=Number(process.argv[2]||1);
const tasks=JSON.parse(await fs.readFile(path.join(dir,'inventory','required-tasks.json'),'utf8')).filter(t=>t.unit===unit);
const excluded=process.argv.includes('--skip-banked-cloze')?tasks.filter(t=>/^banked\s+cloze$/i.test(t.task)):[];
const selected=tasks.filter(t=>!excluded.includes(t));
let progress={tasks:{}};
try{progress=JSON.parse(await fs.readFile(path.join(dir,'answer-progress.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const records=[];
let subjective='';
try{subjective=await fs.readFile(path.join(dir,'subjective-result.txt'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
for(const t of selected){
  const entry=progress.tasks[t.key];
  const legacyVerified=unit===1&&[...t.path,t.task].join('/')==='Section B/Reading skills/Practicing/Practicing'&&
    subjective.includes(summaryText)&&subjective.includes('主观题已作答 (2/2)');
  const evidence=legacyVerified?subjective:entry?.evidence||null;
  const score=typeof evidence==='string'?Number(evidence.match(/(\d+(?:\.\d+)?)分/)?.[1] ?? NaN):NaN;
  const executionVerified=entry?.status==='learned'&&(entry.evidence?.ended===true||entry.evidence?.elapsedSeconds>=(entry.evidence?.requiredSeconds??300)||entry.evidence?.cards>0);
  records.push({key:t.key,path:[...t.path,t.task],status:entry?.status||'pending',
    verified:legacyVerified||(entry?.status==='submitted'&&!!entry.evidence?.includes(summaryText)),
    executionVerified:!!executionVerified, score:Number.isFinite(score)?score:null, courseCompletionVerified:false,
    evidence});
}
const result={unit,total:records.length,excluded:excluded.map(t=>({key:t.key,reason:'用户要求不测试Banked cloze'})),verified:records.filter(t=>t.verified).length,
  executed:records.filter(t=>t.verified||t.executionVerified).length,
  allExecuted:records.every(t=>t.verified||t.executionVerified),
  allSubmitted:records.every(t=>t.verified),
  allCourseCompleted:records.every(t=>t.courseCompletionVerified),tasks:records};
await fs.writeFile(path.join(dir,`unit-${unit}-audit.json`),JSON.stringify(result,null,2));
console.log(`Unit ${unit}: ${result.verified}/${result.total} 有答题提交证据；学习执行${records.filter(t=>t.executionVerified).length}项；课程全部完成=${result.allCourseCompleted}`);
