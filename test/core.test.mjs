import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlan,validatePlan,varyChoice,normalizeFillPlan,isSubmitControl,findSubmitControl,answerableFields,decideStalledRecovery,planHasAction,roundSignature,nextStall,actionDelayRange,isUnusableReply,describePlanFailure} from '../src/core.mjs';
test('extract only the reply for the current request despite nested JSON and quoted braces',()=>{
  const p={nonce:'current',actions:[{type:'fill',id:'1',value:'quoted { text }'}]};
  assert.deepEqual(parsePlan('old {"nonce":"old","actions":[]}\n```json\n'+JSON.stringify(p)+'\n```','current'),p);
  assert.equal(parsePlan(JSON.stringify(p),'wrong'),null);
});

test('recover real task 33 metadata key with unescaped array quotes without altering actions',()=>{
  const key='[3,"Section B","Collocation","Practicing","Practicing"]';
  const expected={nonce:'cur33',task:{number:33,total:41,unit:3,path:['Section B','Collocation','Practicing','Practicing'],key,type:'单词 / 短语填空'},reason:'所有控件非空，本轮提交',finished:false,actions:[{type:'click',id:'31'}]};
  const raw=JSON.stringify(expected).replace(JSON.stringify(key),'"'+key+'"');
  assert.throws(()=>JSON.parse(raw));
  assert.deepEqual(parsePlan(raw,'cur33'),expected);
  assert.deepEqual(parsePlan(JSON.stringify(expected),'cur33'),expected);
  assert.equal(parsePlan(raw,'other'),null);
  assert.equal(parsePlan(raw.slice(0,-2),'cur33'),null);
});

test('recover task 35 raw metadata key while preserving judgement choices and validation',()=>{
  const key='[3,"Section C","Stories of China","Understanding","Task 1"]';
  const plan={nonce:'cur35',task:{number:35,key},actions:[{type:'click',id:'106'},{type:'click',id:'107'},{type:'click',id:'110'}]};
  const raw=JSON.stringify(plan).replace(JSON.stringify(key),'"'+key+'"');
  assert.deepEqual(parsePlan(raw,'cur35'),plan);
  assert.throws(()=>validatePlan(parsePlan(raw,'cur35'),[{id:'106',tag:'button'}]));
});

test('reply quoting the textbook with raw double quotes still parses (real failure at Unit3 #22)',()=>{
  // 现场原文：value 里直接写了 and "now is the time to go."，未转义导致 JSON.parse 在第 1104 位失败。
  const raw='{"nonce":"cur","task":"Unit 3 Section B Reading skills Practicing","reason":"three blanks",'
    +'"finished":false,"evidence":"two blanks","actions":[{"type":"fill","value":"..., and "now is the time to go." In other words, the paragraph stresses it.","id":"5"},'
    +'{"type":"fill","value":"He said "hello" twice.","id":"6"}]}';
  assert.throws(()=>JSON.parse(raw),/Expected ',' or '}'/,'原样必须先解析失败');
  const plan=parsePlan(raw,'cur');
  assert.ok(plan,'修好引号后必须能解析出计划');
  assert.equal(plan.actions.length,2);
  assert.equal(plan.actions[0].value,'..., and "now is the time to go." In other words, the paragraph stresses it.');
  assert.equal(plan.actions[1].value,'He said "hello" twice.');
  // 裸换行同样要被修好。
  const withNewline='{"nonce":"n2","actions":[{"type":"fill","id":"1","value":"line1\nline2"}]}';
  assert.equal(parsePlan(withNewline,'n2').actions[0].value,'line1\nline2');
  // 正常的转义不能被破坏。
  const ok={nonce:'n3',actions:[{type:'fill',id:'1',value:'a "b" c\\nd'}]};
  assert.deepEqual(parsePlan(JSON.stringify(ok),'n3'),ok);
  // 真的坏到修不回来时仍然是 null，并给出原因。
  assert.equal(parsePlan('{"nonce":"n4","actions":[','n4'),null);
  assert.match(describePlanFailure('{"nonce":"n5","actions":[','n5'),/没有找到|无法解析/);
  assert.match(describePlanFailure('{"nonce":"other","actions":[]}','n6'),/nonce 不匹配/);
});
test('reject invalid targets, auth controls and arbitrary operations',()=>{
  const controls=[{id:'1',tag:'textarea',text:'answer'},{id:'2',tag:'button',text:'验证码'}];
  assert.throws(()=>validatePlan({actions:[{type:'click',id:'99'}]},controls));
  assert.throws(()=>validatePlan({actions:[{type:'click',id:'2'}]},controls));
  assert.throws(()=>validatePlan({actions:[{type:'evaluate',id:'1'}]},controls));
  assert.throws(()=>validatePlan({actions:[{type:'wait',seconds:301}]},controls));
  validatePlan({actions:[{type:'fill',id:'1',value:'answer'}]},controls);
});
test('choice variation stays within the same radio group and does not alter submit buttons',()=>{
  const cs=[{id:'1',type:'radio',group:'q1'},{id:'2',type:'radio',group:'q1'},{id:'3',type:'radio',group:'q2'},{id:'4',type:'button'}];
  const p={actions:[{type:'click',id:'1'},{type:'click',id:'4'}]};
  const out=varyChoice(p,cs,.1,()=>0);
  assert.equal(out.actions[0].id,'2'); assert.equal(out.actions[1].id,'4');
  assert.equal(p.actions[0].id,'1');
});
test('reject offsite links and actions after navigation',()=>{
  const controls=[{id:'1',tag:'a',href:'https://example.com/',navigation:true},{id:'2',tag:'div',navigation:true},{id:'3',tag:'textarea'}];
  assert.throws(()=>validatePlan({actions:[{type:'click',id:'1'}]},controls));
  assert.throws(()=>validatePlan({actions:[{type:'click',id:'2'},{type:'fill',id:'3',value:'stale'}]},controls));
  validatePlan({actions:[{type:'click',id:'2'}]},controls);
});

test('custom choice decisions survive new control ids and do not reroll',()=>{
  const cs=[{id:'a',choiceGroup:'q0',choiceLabel:'A'},{id:'b',choiceGroup:'q0',choiceLabel:'B'}];
  const decisions={};
  assert.equal(varyChoice({actions:[{type:'click',id:'a'}]},cs,.01,()=>0,decisions).actions[0].id,'b');
  const refreshed=cs.map(c=>({...c,id:c.id+'2'}));
  assert.equal(varyChoice({actions:[{type:'click',id:'a2'}]},refreshed,.01,()=>.9,decisions).actions[0].id,'b2');
  const judgement={};
  assert.equal(varyChoice({actions:[{type:'click',id:'a'}]},cs,0,()=>0,judgement).actions[0].id,'a');
});

test('26-blank plans are accepted while oversized plans and fill-submit batches are rejected',()=>{
  const controls=Array.from({length:26},(_,i)=>({id:String(i),tag:'input',text:'answer'}));
  const actions=controls.map(c=>({type:'fill',id:c.id,value:'word'}));
  validatePlan({actions},controls);
  assert.throws(()=>validatePlan({actions:Array(65).fill(actions[0])},controls));
  controls.push({id:'submit',tag:'button',text:'提交'});
  assert.throws(()=>validatePlan({actions:[...actions,{type:'click',id:'submit'}]},controls));
});
test('fixed prefixes remove repeated letters while suffix and ordinary answers stay intact',()=>{
  const controls=[{id:'1',fixedPrefix:'es'},{id:'2'}];
  const plan={actions:[{type:'fill',id:'1',value:'established'},{type:'fill',id:'1',value:'tablished'},{type:'fill',id:'2',value:'established'}]};
  assert.deepEqual(normalizeFillPlan(plan,controls).actions.map(a=>a.value),['tablished','tablished','established']);
  assert.equal(plan.actions[0].value,'established');
});

// 现场卡死的页面：8 个 textarea 已填满，提交控件是 <a class="btn">提 交</a>，并被标记为 navigation:true。
const stuckControls=[
  ...Array.from({length:8},(_,i)=>({id:String(i+5),tag:'textarea',text:'请输入答案...',navigation:false,disabled:false,value:'answer '+i})),
  {id:'13',tag:'a',text:'提 交',navigation:true,disabled:false,value:'',className:'btn'},
];
test('submit control is recognised by text even when it is flagged as navigation',()=>{
  assert.equal(isSubmitControl({text:'提 交'}),true);
  assert.equal(isSubmitControl({text:'提交答案'}),true);
  assert.equal(isSubmitControl({text:' Submit '}),true);
  assert.equal(isSubmitControl({text:'查看答题小结'}),false);
  assert.equal(isSubmitControl({text:'提交进度'}),false);
  assert.equal(findSubmitControl(stuckControls).id,'13');
});

test('stalled recovery submits only when every answerable control is filled',()=>{
  assert.deepEqual(decideStalledRecovery({controls:stuckControls}),{action:'submit',id:'13',text:'提 交'});
  const empty=stuckControls.map(c=>c.id==='7'?{...c,value:''}:c);
  const blocked=decideStalledRecovery({controls:empty});
  assert.equal(blocked.action,'stop');
  assert.match(blocked.reason,/仍有 1 个作答控件为空/);
  assert.match(blocked.reason,/id: 7/);
});

test('stalled recovery refuses to submit choice questions, unknown pages and empty work',()=>{
  const submit={id:'s',tag:'a',text:'提交',disabled:false};
  assert.match(decideStalledRecovery({controls:[submit],choicesAnswered:false,choiceCount:3}).reason,/没有选中选项/);
  assert.match(decideStalledRecovery({controls:[submit,{id:'a',tag:'input',type:'hidden',value:''}]}).reason,/没有可识别的作答控件/);
  assert.match(decideStalledRecovery({controls:[]}).reason,/没有可识别的提交控件/);
  assert.deepEqual(decideStalledRecovery({controls:[submit],choicesAnswered:true,choiceCount:2}),{action:'submit',id:'s',text:'提交'});
  assert.equal(answerableFields([{id:'1',tag:'input',type:'radio'},{id:'2',tag:'input',type:'text',value:'x'},{id:'3',tag:'div',navigation:true}]).length,1);
});

test('wait-only plans and unchanged pages count as no progress',()=>{
  assert.equal(planHasAction({actions:[{type:'wait',seconds:1}]}),false);
  assert.equal(planHasAction({actions:[{type:'wait',seconds:1},{type:'fill',id:'5',value:'x'}]}),true);
  const base={text:'question 1 ...',controls:stuckControls};
  assert.equal(roundSignature(base),roundSignature({...base,controls:stuckControls.map(c=>({...c}))}));
  assert.notEqual(roundSignature(base),roundSignature({text:base.text,controls:stuckControls.map(c=>c.id==='5'?{...c,value:'new'}:c)}));
  assert.notEqual(roundSignature(base),roundSignature({...base,text:'question 1 ... changed'}));
});

test('the real stuck plan reaches the submit fallback instead of looping forever',()=>{
  // 现场记录（artifacts/deepseek-last-plan.json）：模型每轮都只回一个 wait，并声称"下一轮再提交"。
  const stuckPlan={nonce:'x',reason:'本轮核查8个textarea（id=5至12）均已填写……按规则填写后下一轮才提交，因此本轮不提交，先wait',finished:false,actions:[{type:'wait',seconds:1}]};
  let stall=0;
  const stalls=[];
  for(let round=0;round<3;round++) {
    // 页面在这几轮里完全没有变化，且计划只有 wait。
    stall=nextStall({stall,unchanged:true,plan:stuckPlan});
    stalls.push(stall);
  }
  assert.deepEqual(stalls,[1,2,3]);
  assert.equal(stall>=3,true);
  assert.deepEqual(decideStalledRecovery({controls:stuckControls}),{action:'submit',id:'13',text:'提 交'});
  // 真正产生了填写动作并改变了页面时，计数清零，不会误判为卡死。
  assert.equal(nextStall({stall,unchanged:false,plan:{actions:[{type:'fill',id:'5',value:'new'}]}}),0);
});

test('only fill/select use the short delay so multi-blank questions stop costing ~30s',()=>{
  const cfg={delayMs:[1800,4500],fillDelayMs:[250,600]};
  assert.deepEqual(actionDelayRange({type:'fill'},cfg),[250,600]);
  assert.deepEqual(actionDelayRange({type:'select'},cfg),[250,600]);
  assert.deepEqual(actionDelayRange({type:'click'},cfg),[1800,4500]);
  assert.deepEqual(actionDelayRange({type:'drag'},cfg),[1800,4500]);
  assert.deepEqual(actionDelayRange({type:'fill'},{}),[250,600]);
  assert.deepEqual(actionDelayRange({type:'click'},{}),[1800,4500]);
});

test('a frozen reply that tried to write JSON fails fast instead of burning the whole timeout',()=>{
  const long='{"nonce":"nope","actions":['+'x'.repeat(80);
  assert.equal(isUnusableReply({text:long,unchangedReads:4}),true);
  assert.equal(isUnusableReply({text:long,unchangedReads:3}),false);
  assert.equal(isUnusableReply({text:'正在思考',unchangedReads:9}),false);          // 没有 { 视为仍在思考/输出
  assert.equal(isUnusableReply({text:'{短',unchangedReads:9}),false);              // 太短，可能还在流式输出
  assert.equal(isUnusableReply({text:'',unchangedReads:9}),false);                // 空回复不能误判
});
