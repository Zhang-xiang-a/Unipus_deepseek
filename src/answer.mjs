import fs from 'node:fs/promises';
import path from 'node:path';
import {learnTask} from './learning.mjs';
import {muteCourse} from './mute.mjs';
import {readAnswerResult} from './result.mjs';
import {selectQueue, sliceFrom} from './queue.mjs';
import {decideStalledRecovery, isSubmitControl, roundSignature, nextStall} from './core.mjs';
import {canContinueReplyFailure, shouldSkipRecord} from './policy.mjs';
import {isChoiceControl,choiceSubmitPlan} from './choice.mjs';

// 听力关键词来自课程配置（course.listeningKeywords）；不传时用内置默认，保持旧行为。
export function isListeningTask(task, text='', keywords) {
  const haystack=[task?.type,task?.task,...(task?.path||[]),text].filter(Boolean).join(' ');
  if (Array.isArray(keywords) && keywords.length) {
    const lower=haystack.toLowerCase();
    return keywords.some(word=>String(word).trim() && lower.includes(String(word).trim().toLowerCase()));
  }
  return /(听力|听写|听力理解|listening|dictation|audio\s*(?:comprehension|exercise)|\blisten\s+to\b)/i.test(haystack);
}

export function planListening(controls, {choicePolicy = 'manual'} = {}) {
  const fields=controls.filter(c=>['input','textarea'].includes(c.tag)&&c.writable&&!c.disabled&&!['radio','checkbox','hidden','button','submit'].includes(c.type));
  const pending=fields.filter(c=>String(c.value||'').trim()!=='1');
  if(pending.length)return {actions:pending.slice(0,64).map(c=>({type:'fill',id:c.id,value:'1'})),reason:'听力填空统一填写1',policy:'listening-fixed'};
  const choices=controls.filter(c=>!c.disabled && (c.choiceGroup || (c.type==='radio' && c.group)));
  if(choices.length && choicePolicy==='manual')throw new Error('听力选择题设为手动处理，请修改 runnerPolicy.listeningChoices');
  if(choices.length && choicePolicy==='deepseek')return null;
  if(choicePolicy==='first' && choices.length) {
    const groups=new Map();
    for(const c of choices) { const group=c.choiceGroup || `radio:${c.group}`; const list=groups.get(group) || []; list.push(c); groups.set(group,list); }
    const pendingChoices=[...groups.values()].map(list=>list[0]).filter(c=>!c.checked);
    if(pendingChoices.length)return {actions:pendingChoices.slice(0,64).map(c=>({type:'click',id:c.id})),reason:'听力选择题每组选择第一项',policy:'listening-fixed'};
  }
  if(!fields.length && !choices.length)throw new Error('听力题没有可填写答题空或选择项');
  const submit=controls.find(c=>!c.disabled && isSubmitControl(c));
  if(!submit)throw new Error('听力题缺少提交控件');
  return {actions:[{type:'click',id:submit.id}],reason:'听力题已完成预设答题，单独提交',policy:'listening-fixed'};
}

async function consumeSkip({page,output,t,progress,save,label}) {
  let command='resume';
  try { command=JSON.parse(await fs.readFile(path.join(output,'control.json'),'utf8')).command; } catch {}
  if(command!=='skip')return false;
  const comments=page.locator('main textarea[placeholder*="评论"],main textarea[placeholder*="评价"],main [contenteditable="true"][aria-label*="评论"],main [contenteditable="true"][data-placeholder*="评论"]').filter({visible:true});
  if(await comments.count())await comments.first().fill('6666');
  progress.tasks[t.key]={...progress.tasks[t.key],status:'skipped',reason:'用户执行 npm run skip',commentFilled:await comments.count()>0?'6666':null,updated:new Date().toISOString()};
  await save();
  await fs.writeFile(path.join(output,'control.json'),JSON.stringify({command:'resume',time:new Date().toISOString()}));
  console.log(`已跳过 ${label || `Unit ${t.unit} / ${t.path.join(' / ')}`}${await comments.count()?'；评论已填写6666':''}`);
  return true;
}

export async function loadAnswerQueue({output, argv = process.argv, unitCount = 6, manualTaskTypes, skipTaskTypes}) {
  const inventory=JSON.parse(await fs.readFile(path.join(output,'inventory','required-tasks.json'),'utf8'));
  const report=JSON.parse(await fs.readFile(path.join(output,'inventory','type-report.json'),'utf8'));
  const types=new Map(Object.entries(report.groups).flatMap(([type,ts])=>ts.map(t=>[t.key,type])));
  let queue=selectQueue(inventory,types,{
    skipBankedCloze:argv.includes('--skip-banked-cloze'),
    manualTypes:manualTaskTypes,
    skipTypes:skipTaskTypes,
  });
  const typeIndex=argv.indexOf('--type');
  if(typeIndex>=0)queue=queue.filter(t=>t.type===argv[typeIndex+1]);
  const unitIndex=argv.indexOf('--unit');
  let unit=null;
  if(unitIndex>=0) {
    unit=Number(argv[unitIndex+1]);
    // 单元上限来自当前课程的 unitCount，不再固定为 6。
    if(!Number.isInteger(unit)||unit<1||unit>unitCount)throw new Error(`--unit 必须为 1~${unitCount}（当前课程配置了 ${unitCount} 个单元）`);
    queue=queue.filter(t=>t.unit===unit);
  }
  return {queue,unit,inventory};
}

export async function unansweredChoices(page) {
  return page.locator('.question-common-abs-choice').evaluateAll(es=>es.filter(e=>!e.querySelector('.option.selected,.option.active,.option.checked,.option.isSelected')).length);
}

// 提交后的确认弹窗与答题小结核验；模型计划和脚本兜底提交共用。
// 弹窗/小结文案来自课程配置 uiTexts，换平台文案时不需要改代码。
export async function finalizeSubmit({page,gate,wait,uiTexts={}}) {
  const summaryEntry = uiTexts.answerSummaryEntry || '查看答题小结';
  const confirmText = uiTexts.submitConfirm || '确定提交吗';
  const modal=page.locator('.ant-modal-wrap:visible');
  for(let i=0;i<5;i++) {
    await gate();
    if(await modal.count() || await page.getByText(summaryEntry,{exact:true}).filter({visible:true}).count())break;
    await wait(500);
  }
  if(await modal.count()) {
    if(!(await modal.innerText()).includes(confirmText))throw new Error('未知提交弹窗，停止核查');
    await gate();
    const ok=modal.locator('button.system-info-cloud-ok-button');
    if(await ok.count())await ok.first().click();
    else {
      const fallback=modal.getByRole('button',{name:/^(确\s*定|确认|提交)$/}).first();
      if(!await fallback.count())throw new Error('提交弹窗没有可识别的确定按钮');
      await fallback.click();
    }
  }
  const result=await readAnswerResult({page,gate,wait,attempts:30,uiTexts});
  if(!result)throw new Error('未出现答题小结，不能标记已提交');
  return result;
}

export async function answerQueue({context,solver,output,gate,wait,snapshot,ask,execute,setCourse,dryRun,maxSteps,maxStallRounds=3,maxRoundsPerTask=12,policy={},argv=process.argv,
  course={},submitTexts,manualTaskTypes,skipTaskTypes,listeningKeywords,uiTexts={},unitCount=6,
  onTaskError='continue',logger}={}) {
  const submitOptions={submitTexts};
  const readingSeconds=course.learningPolicy?.readingSeconds ?? 10;
  const referencePathAlias=course.referencePathAlias || 'Reading the text';
  const courseHosts=course.login?.courseHosts || ['uai.unipus.cn','ucontent.unipus.cn'];
  const coursewareHost=courseHosts.find(h=>/ucontent/i.test(h)) || 'ucontent.unipus.cn';
  const overviewHost=courseHosts.find(h=>/uai/i.test(h)) || 'uai.unipus.cn';
  const dismissText=uiTexts.dismiss || '我知道了';
  const startPattern=new RegExp(`^(${uiTexts.startLearning || '开始学习'}|${uiTexts.continueLearning || '继续学习'})$`);
  const {queue:loaded,unit,inventory}=await loadAnswerQueue({output,argv,unitCount,manualTaskTypes,skipTaskTypes});
  // 编号与 node src/runner.mjs --list 的序号一致，也就是 --from 使用的编号。
  const total=loaded.length;
  let queue=loaded.map((t,position)=>({t,number:position+1}));
  const fromIndex=[argv.indexOf('--from'),argv.indexOf('--from-task')].find(i=>i>=0);
  let startAt=null;
  if(fromIndex>=0) {
    const {index,task}=sliceFrom(loaded,argv[fromIndex+1]);
    queue=queue.slice(index);
    startAt={selector:argv[fromIndex+1],number:index+1,total,key:task.key,path:task.path,unit:task.unit};
    console.log(`从第 ${index+1}/${total} 个任务开始：Unit ${task.unit} / ${task.path.join(' / ')}`);
  }
  if(!queue.length)throw new Error('当前筛选没有任务，请检查 --unit / --type / --from / --skip-banked-cloze，或用 node src/runner.mjs --list 查看队列');
  const currentOnly=argv.includes('--current');
  const file=path.join(output,'answer-progress.json');
  let progress={tasks:{}};
  try{progress=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const save=()=>fs.writeFile(file,JSON.stringify(progress,null,2));
  const logRound=data=>fs.appendFile(path.join(output,'answer-rounds.jsonl'),JSON.stringify({time:new Date().toISOString(),...data})+'\n');
  await fs.writeFile(path.join(output,'last-run-scope.json'),JSON.stringify({unit,skipBankedCloze:argv.includes('--skip-banked-cloze'),startAt,policy,tasks:queue.map(({t,number})=>({number,total,key:t.key,path:t.path,type:t.type})),started:new Date().toISOString()},null,2));
  const hostOf=p=>{try{return new URL(p.url()).hostname;}catch{return '';}};
  let page=context.pages().find(p=>hostOf(p)===coursewareHost);
  if(!page) {
    page=context.pages().find(p=>hostOf(p)===overviewHost);
    if(!page)throw new Error(`缺少现有课程目录标签（${courseHosts.join(' / ')}）；请先执行 npm run browser`);
    await page.evaluate(()=>{window.open=url=>{location.assign(url);return window;};});
    await page.getByRole('button',{name:startPattern}).click();
    await page.waitForURL(`https://${coursewareHost}/**`);await wait(1500);
  }
  await muteCourse(page);
  setCourse(page);
  if(currentOnly) {
    const hash=new URL(page.url()).hash;
    queue=queue.filter(({t})=>new URL(t.url).hash===hash);
    if(queue.length!==1)throw new Error('当前页未对应唯一必修子任务');
  }
  let steps=0;
  for(const {t,number} of queue) {
    const tag=`[${number}/${total}]`;
    const label=`${tag} Unit ${t.unit} / ${t.path.join(' / ')}`;
    // 进度里也带上编号，便于和 --list / --from 的序号对照。
    progress.tasks[t.key]={...progress.tasks[t.key],number,total};
    if(shouldSkipRecord(progress.tasks[t.key],policy)) { console.log(`${label} 保留已有状态 ${progress.tasks[t.key].status}，跳过执行`); continue; }
    await gate();
    const dismiss=async()=>page.evaluate(label=>{
      for(const e of document.querySelectorAll('.ant-modal-wrap button'))if(e.innerText.trim()===label)e.click();
    },dismissText);
    await dismiss();
    if(!currentOnly) {
    const menus=await page.locator('.pc-menu-node-name').evaluateAll(es=>es.map((e,index)=>{
      let section='',unit='';
      for(let p=e.parentElement;p;p=p.parentElement){
        const s=p.querySelector(':scope > [data-role="section"]');
        const u=p.querySelector(':scope > [data-role="unit"]');
        if(s&&!section)section=s.innerText.trim();if(u&&!unit)unit=u.innerText.trim();
      }
      return {index,name:e.innerText.trim(),section,unit:Number(unit.match(/Unit\s+(\d+)/)?.[1])};
    }));
    const target=menus.filter(m=>m.unit===t.unit&&m.section===t.path[0]&&m.name===t.path[1]);
    if(target.length!==1)throw new Error('无法唯一定位任务菜单 '+t.key);
    await page.locator('#root-loading').waitFor({state:'hidden',timeout:15000});
    await dismiss();
    await page.locator('.pc-menu-node-name').nth(target[0].index).click({timeout:5000});await wait(1500);await dismiss();
    const tab=page.locator('.pc-tab-view-container').getByText(t.path[2],{exact:true});
    // Match rendered titles exactly to avoid Critical thinking / skill ambiguity.
    const tabs=page.locator('.pc-tab-view-container');
    const tabIndex=(await tabs.allTextContents()).findIndex(x=>x.trim()===t.path[2]);
    if(tabIndex<0)throw new Error('任务页签不存在');
    await tabs.nth(tabIndex).click();await wait(1500);await dismiss();
    const tasks=page.locator('.pc-task');
    const taskIndex=(await tasks.allTextContents()).findIndex(x=>x.trim()===t.path.at(-1));
    if(taskIndex<0)throw new Error('任务入口不存在');
    await tasks.nth(taskIndex).click();await wait(1500);
    }
    await dismiss(); await wait(500);
    // 单个任务内部的异常在下面统一兜住：记录 failed 后继续下一个任务，
    // 只有 runnerPolicy.taskFailure=stop 时才像旧行为一样整体中断。
    try {
    if(await consumeSkip({page,output,t,progress,save,label}))continue;
    const listeningWithQuestions=isListeningTask(t,await page.locator('main').innerText(),listeningKeywords) && await page.locator('main input:not([type=hidden]),main textarea,main .question-common-abs-choice,main [role=radio]').filter({visible:true}).count()>0;
    const learning=!listeningWithQuestions && ['阅读或尚未识别的交互','音视频学习','词汇卡片'].includes(t.type);
    console.log(`${tag} ${learning?'学习':'答题'}：Unit ${t.unit} / ${t.path.join(' / ')}  [${t.type||'未知题型'}]`);
    if(learning) {
      if(dryRun){console.log('学习任务仅预览，未执行');return;}
      const result=await learnTask({page,type:t.type,gate,wait,readingSeconds,uiTexts,config:{readCommand:async()=>{
        try{return JSON.parse(await fs.readFile(path.join(output,'control.json'),'utf8')).command;}catch(e){if(e.code==='ENOENT')return 'resume';throw e;}
      }},onProgress:async state=>{progress.tasks[t.key]={status:'learning',state};await save();}});
      progress.tasks[t.key]={status:'learned',evidence:result};await save();
      if(++steps>=maxSteps)return;
      continue;
    }
    let round=0,stall=0,previousSignature=null,previousChoiceRound=false;
    while(steps++<maxSteps) {
      await gate();await dismiss();
      if(await consumeSkip({page,output,t,progress,save,label}))break;
      const existingResult=await readAnswerResult({page,gate,wait});
      if(existingResult) {
        progress.tasks[t.key]={...progress.tasks[t.key],status:'submitted',evidence:existingResult,updated:new Date().toISOString()};await save();break;
      }
      round++;
      const state=await snapshot(page);
      const allControls=state.controls;
      state.taskScope={number,total,unit:t.unit,path:t.path,key:t.key,type:t.type};
      state.referenceTexts=inventory.filter(x=>x.unit===t.unit && x.path[0]===t.path[0] &&
        (x.path[1]===t.path[1] || x.path[1]===referencePathAlias) &&
        !x.controls.some(c=>['input','textarea'].includes(c.tag))).map(x=>({path:x.path,text:x.text}));
      // 提交控件有时被标记为 navigation，必须保留，否则模型永远看不到提交入口。
      state.controls=allControls.filter(c=>!c.navigation||isSubmitControl(c,submitOptions));
      state.text=await page.locator('main').innerText();
      if(state.text.includes(uiTexts.answerSummary || '答题小结')) {
        progress.tasks[t.key]={...progress.tasks[t.key],status:'submitted',evidence:state.text,updated:new Date().toISOString()};await save();break;
      }
      const signature=roundSignature({...state,controls:allControls});
      const unchanged=signature===previousSignature;
      previousSignature=signature;
      state.round={number,total,index:round,stalledRounds:stall,unchanged:round>1&&unchanged};
      const listening=isListeningTask(t,state.text,listeningKeywords);
      let screenshot=path.join(output,'answer-current.png');
      if(argv.includes('--text-only'))screenshot=null;
      else try {await page.screenshot({path:screenshot,fullPage:false,timeout:8000});}
      catch {screenshot=null;console.log('截图失败，改用完整题干及控件');}
      const translationFields=state.controls.filter(c=>['textarea','input'].includes(c.tag)&&!c.disabled);
      const submitControl=state.controls.find(c=>isSubmitControl(c,submitOptions));
      const listeningPlan=listening?planListening(state.controls,{choicePolicy:policy.listeningChoices}):null;
      let plan;
      try {
        const readyChoiceSubmit=previousChoiceRound?choiceSubmitPlan(state.controls,submitOptions):null;
        if(readyChoiceSubmit)console.log(`${tag} 所有选择已确认，直接进入提交轮`);
        plan=listeningPlan ?? readyChoiceSubmit ?? (t.type==='翻译' && translationFields.length && translationFields.every(c=>c.value.trim()) && submitControl
          ? {actions:[{type:'click',id:submitControl.id}],reason:'全部译文已填写，单独提交并核验课程结果'}
          : await ask(state,screenshot));
      } catch(error) {
        if(!canContinueReplyFailure(error,policy))throw error;
        await gate();
        const failureFile=path.join(output,`answer-failure-unit-${t.unit}-task-${number}-${Date.now()}.json`);
        await fs.writeFile(failureFile,JSON.stringify({task:t,number,total,round,state,error:{code:error.code,message:error.message,details:error.details},time:new Date().toISOString()},null,2));
        const entry=progress.tasks[t.key] || {};
        progress.tasks[t.key]={...entry,status:'failed',reason:error.message,failureCode:error.code,failureFile,updated:new Date().toISOString()};
        await save();
        await logRound({event:'deepseek-failure-continue',number,total,task:t.key,round,message:error.message});
        console.log(`${label} DeepSeek 重试仍失败，已记录 failed，继续下一任务`);
        break;
      }
      await gate();
      if(await consumeSkip({page,output,t,progress,save,label}))break;
      const navigation=plan.actions.map(a=>state.controls.find(c=>c.id===a.id)).find(c=>c?.navigation);
      if(navigation&&!isSubmitControl(navigation,submitOptions))throw new Error('答题计划不得自行导航');
      await fs.writeFile(path.join(output,'answer-plan.json'),JSON.stringify({task:t,plan},null,2));
      const stampResult=async()=>{try {await page.screenshot({path:path.join(output,`answer-result-${number-1}.png`),timeout:8000});} catch {console.log('结果截图超时，已保存课程文字证据');}};
      if(dryRun){console.log('答案计划已保存，未填写或提交。');return;}
      if(plan.finished){
        // 模型说"已完成"但页面还留着提交控件时，不能把已填好的答案丢掉：改为脚本自己提交并核验。
        const choiceCount=await page.locator('.question-common-abs-choice').count();
        const recovery=decideStalledRecovery({controls:allControls,choicesAnswered:!(await unansweredChoices(page)),choiceCount,submitTexts});
        if(recovery.action==='submit') {
          console.log(`${tag} 模型报告 finished=true 且作答齐全，改为脚本直接提交核验`);
          await logRound({event:'finished-auto-submit',number,total,task:t.key,round,evidence:plan.evidence});
          await execute({actions:[{type:'click',id:recovery.id}],reason:'模型 finished=true，脚本提交核验'},state,t,progress);
          const result=await finalizeSubmit({page,gate,wait,uiTexts});
          progress.tasks[t.key]={...progress.tasks[t.key],status:'submitted',evidence:result,updated:new Date().toISOString()};await save();
          await stampResult(); break;
        }
        progress.tasks[t.key]={status:'needs-review',evidence:plan.evidence};await save();
        throw new Error(`${label} 模型报告完成但无法提交核验（${recovery.reason}），需课程端记录核验后才能计为完成`);
      }
      const submit=plan.actions.some(a=>isSubmitControl(state.controls.find(c=>c.id===a.id),submitOptions));
      if(submit && (listening || t.type==='选择题'||t.type?.startsWith('三项判断'))) {
        if(await unansweredChoices(page))throw new Error('选择状态未全部确认，禁止提交');
      }
      if(submit && plan.actions.some(a=>['fill','select','drag'].includes(a.type)))throw new Error('填写与提交必须分轮');
      if(submit && t.type==='翻译') {
        const inputs=await page.locator('main textarea,main input:not([type=hidden]),main [contenteditable=true]').evaluateAll(es=>es.filter(e=>!e.disabled&&!e.readOnly&&e.getClientRects().length).map(e=>(e.value??e.innerText).trim()));
        if(!inputs.length || inputs.some(v=>!v))throw new Error('翻译输入框未全部填写，禁止提交');
      }
      await execute(plan,state,t,progress);
      previousChoiceRound=plan.actions.length>0 && plan.actions.every(a=>a.type==='click' && isChoiceControl(state.controls.find(c=>c.id===a.id)));
      if(submit) {
        const result=await finalizeSubmit({page,gate,wait,uiTexts});
        progress.tasks[t.key]={...progress.tasks[t.key],status:'submitted',evidence:result,updated:new Date().toISOString()};await save();
        await stampResult(); break;
      }
      progress.tasks[t.key]={...progress.tasks[t.key],status:'in-progress',updated:new Date().toISOString()};await save();
      if(!plan.actions.length)throw new Error('DeepSeek未提供动作');
      // DeepSeek 可能反复返回 wait 或重复同一份填写，导致对同一题无限重复提问；这里记录并兜底。
      stall=nextStall({stall,unchanged,plan});
      await logRound({event:'answer-round',number,total,task:t.key,round,stall,unchanged,actions:plan.actions.map(a=>a.type)});
      if(stall>=maxStallRounds) {
        const choiceCount=await page.locator('.question-common-abs-choice').count();
        const recovery=decideStalledRecovery({controls:allControls,choicesAnswered:!(await unansweredChoices(page)),choiceCount,submitTexts});
        await logRound({event:'stalled',number,total,task:t.key,round,stall,recovery});
        if(recovery.action==='submit') {
          console.log(`${tag} 连续 ${stall} 轮没有进展，改为脚本直接提交（提交控件 id=${recovery.id}）`);
          await execute({actions:[{type:'click',id:recovery.id}],reason:'连续无进展，脚本兜底提交'},state,t,progress);
          const result=await finalizeSubmit({page,gate,wait,uiTexts});
          progress.tasks[t.key]={...progress.tasks[t.key],status:'submitted',evidence:result,updated:new Date().toISOString()};await save();
          await stampResult(); break;
        }
        throw new Error(`${label} 连续 ${stall} 轮没有进展且无法自动提交（${recovery.reason}），已停止避免继续重复请求DeepSeek；详见 artifacts/answer-rounds.jsonl`);
      }
      if(round>=maxRoundsPerTask)throw new Error(`${label} 已进行 ${round} 轮仍未提交，已停止避免继续重复请求DeepSeek；可用 node src/runner.mjs --answer --from ${number} 从该任务继续`);
    }
    if(steps>=maxSteps)return;
    } catch (error) {
      // 控制类错误（停止命令、登录失效、标签关闭）必须中断整轮，不能被"失败后继续"吞掉。
      const fatal=error?.fatal===true || /用户停止运行|登录|标签已关闭|浏览器标签/.test(String(error?.message || ''));
      if(onTaskError==='stop' || fatal)throw error;
      progress.tasks[t.key]={...progress.tasks[t.key],status:'failed',reason:error.message,updated:new Date().toISOString()};
      await save();
      await logRound({event:'task-failure-continue',number,total,task:t.key,message:error.message});
      const sink=logger?.warn ? logger.warn.bind(logger) : console.warn;
      sink(`${label} 执行失败，已记录 failed 并继续下一个任务：${error.message}`);
    }
  }
  const pending=queue.filter(({t})=>!['submitted','learned'].includes(progress.tasks[t.key]?.status)).map(({t,number})=>({number,key:t.key,unit:t.unit,path:t.path,status:progress.tasks[t.key]?.status || 'pending',reason:progress.tasks[t.key]?.reason}));
  await fs.writeFile(path.join(output,'last-run-summary.json'),JSON.stringify({unit,pending,allExecuted:pending.length===0,ended:new Date().toISOString()},null,2));
  console.log(`本次队列结束；仍有 ${pending.length} 项未完成（见 artifacts/last-run-summary.json），submitted 表示已提交，最终进度需核验。`);
}
