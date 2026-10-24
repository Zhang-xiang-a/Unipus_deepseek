import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {answerQueue} from '../src/answer.mjs';
import {DeepSeekReplyError,runnerPolicy} from '../src/policy.mjs';

async function fixture(t,records={}) {
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'unipus-queue-test-'));
  t.after(()=>fs.rm(output,{recursive:true,force:true}));
  const tasks=['one','two'].map((task,i)=>({key:task,unit:3,path:['Section A','Reading','Practice'],task,url:`https://ucontent.unipus.cn/course#${i}`,controls:[]}));
  await fs.mkdir(path.join(output,'inventory'));
  await fs.writeFile(path.join(output,'inventory','required-tasks.json'),JSON.stringify(tasks));
  await fs.writeFile(path.join(output,'inventory','type-report.json'),JSON.stringify({groups:{'单词 / 短语填空':tasks}}));
  await fs.writeFile(path.join(output,'answer-progress.json'),JSON.stringify({tasks:records}));
  let current=-1,submitted=false,value='';
  const visits=[],executed=[];
  const locator=selector=>({
    filter(){return this;},first(){return this;},nth(i){return {...this,click:async()=>{if(selector==='.pc-task'){current=i;submitted=false;value='';visits.push(tasks[i].key);}}};},
    getByText(){return this;},waitFor:async()=>{},count:async()=>0,
    allTextContents:async()=>selector==='.pc-task'?['one','two']:['Practice'],
    innerText:async()=>submitted?'答题小结 答题情况 主观题已作答 (1/1)':'question',
    evaluateAll:async()=>selector==='.pc-menu-node-name'?[{index:0,name:'Reading',section:'Section A',unit:3}]:selector==='.question-common-abs-choice'?0:[],
  });
  const page={url:()=>tasks[0].url,locator,getByText:()=>locator('summary'),evaluate:async()=>{},addInitScript:async()=>{},frames:()=>[],screenshot:async()=>{}};
  const args={context:{pages:()=>[page]},output,gate:async()=>{},wait:async()=>{},setCourse:()=>{},dryRun:false,maxSteps:10,argv:['--unit','3','--text-only'],
    policy:runnerPolicy({runnerPolicy:{skippedTasks:'remember',deepseekFailure:'continue',listeningChoices:'first'}},[]),
    snapshot:async()=>({text:'question',controls:[{id:'f',tag:'input',writable:true,value},{id:'s',tag:'button',text:'提交'}]}),
    execute:async plan=>{executed.push({task:tasks[current].key,plan});for(const a of plan.actions){if(a.type==='fill')value=a.value;if(a.type==='click'&&a.id==='s')submitted=true;}},
  };
  return {args,tasks,visits,executed,readProgress:async()=>JSON.parse(await fs.readFile(path.join(output,'answer-progress.json'),'utf8'))};
}

test('a reply failure preserves state and continues to a later task without submitting the failed task',async t=>{
  const f=await fixture(t);
  f.args.ask=async state=>{if(state.taskScope.key==='one')throw new DeepSeekReplyError('invalid JSON after retry');return {actions:state.controls[0].value?[{type:'click',id:'s'}]:[{type:'fill',id:'f',value:'answer'}]};};
  await answerQueue(f.args);
  const progress=await f.readProgress();
  assert.equal(progress.tasks.one.status,'failed');
  assert.equal(progress.tasks.two.status,'submitted');
  assert.equal(f.executed.some(x=>x.task==='one'),false);
  const failure=JSON.parse(await fs.readFile(progress.tasks.one.failureFile,'utf8'));
  assert.equal(failure.state.taskScope.key,'one');
  const summary=JSON.parse(await fs.readFile(path.join(f.args.output,'last-run-summary.json'),'utf8'));
  assert.equal(summary.allExecuted,false);
  assert.deepEqual(summary.pending.map(x=>x.key),['one']);
});

test('stop or browser errors are not swallowed by failure-continue policy',async t=>{
  const f=await fixture(t);
  f.args.ask=async()=>{throw new Error('用户停止运行');};
  await assert.rejects(answerQueue(f.args),/用户停止运行/);
  assert.deepEqual(f.visits,['one']);
});

test('remembered skips keep list numbers and retry override visits them again',async t=>{
  for(const retry of [false,true]){
    const f=await fixture(t,{one:{status:'skipped'},two:{status:'submitted'}});
    f.args.policy.retrySkipped=retry;
    const numbers=[];
    f.args.ask=async state=>{numbers.push(state.taskScope.number);return {actions:state.controls[0].value?[{type:'click',id:'s'}]:[{type:'fill',id:'f',value:'answer'}]};};
    await answerQueue(f.args);
    assert.deepEqual(f.visits,retry?['one']:[]);
    assert.deepEqual(numbers,retry?[1,1]:[]);
    assert.equal((await f.readProgress()).tasks.two.status,'submitted');
  }
});

test('judgement selection is followed by a verified submit round without a second DeepSeek request',async t=>{
  const f=await fixture(t,{two:{status:'submitted'}});
  let selected=false,requests=0;
  const execute=f.args.execute;
  f.args.snapshot=async()=>({text:'question',controls:[{id:'a',choiceGroup:'q1',checked:selected},{id:'b',choiceGroup:'q1',checked:false},{id:'s',tag:'button',text:'提交'}]});
  f.args.ask=async()=>{requests++;return {actions:[{type:'click',id:'a'}]};};
  f.args.execute=async(plan,...rest)=>{if(plan.actions.some(a=>a.id==='a'))selected=true;await execute(plan,...rest);};
  await answerQueue(f.args);
  assert.equal(requests,1);
  assert.equal((await f.readProgress()).tasks.one.status,'submitted');
  assert.deepEqual(f.executed.map(x=>x.plan.actions),[[{type:'click',id:'a'}],[{type:'click',id:'s'}]]);
});
