import test from 'node:test';
import assert from 'node:assert/strict';
import {choiceSubmitPlan,executeChoice} from '../src/choice.mjs';
import {roundSignature} from '../src/core.mjs';

test('only verified complete choices can move straight to a separate submit round',()=>{
  const controls=[{id:'a',choiceGroup:'q1',checked:true},{id:'b',choiceGroup:'q1',checked:false},{id:'c',choiceGroup:'q2',checked:true},{id:'s',text:'提交',navigation:true}];
  assert.deepEqual(choiceSubmitPlan(controls).actions,[{type:'click',id:'s'}]);
  assert.equal(choiceSubmitPlan(controls.map(c=>c.id==='c'?{...c,checked:false}:c)),null);
  assert.equal(choiceSubmitPlan([...controls,{id:'f',tag:'input',value:''}]),null);
  assert.equal(choiceSubmitPlan([{id:'s',text:'提交'}]),null);
  assert.equal(choiceSubmitPlan(controls.filter(c=>c.id!=='s')),null);
});

test('choice state participates in progress fingerprint even when page text stays identical',()=>{
  const controls=[{id:'a',tag:'span',choiceGroup:'q1',checked:false}];
  assert.notEqual(roundSignature({text:'same',controls}),roundSignature({text:'same',controls:[{...controls[0],checked:true}]}));
});

test('caption clicks its option ancestor and verifies selection without fixed 1.5 second wait',async()=>{
  let checked=false,clicks=0;
  const waits=[];
  const target={evaluate:async fn=>fn.name==='domChoiceSelected'?checked:{caption:true,native:false},
    locator:selector=>{assert.match(selector,/ancestor/);return {click:async()=>{clicks++;checked=true;}};}};
  await executeChoice({target,gate:async()=>{},wait:async ms=>waits.push(ms)});
  assert.equal(clicks,1);assert.deepEqual(waits,[]);
});

test('native radio uses check; already selected options are preserved without clicking',async()=>{
  let checked=false,checks=0;
  const target={evaluate:async fn=>fn.name==='domChoiceSelected'?checked:{native:true,caption:false},check:async()=>{checked=true;checks++;}};
  const args={target,gate:async()=>{},wait:async()=>{}};
  await executeChoice(args);await executeChoice(args);
  assert.equal(checks,1);
});

test('failed selection stops rather than waiting indefinitely or submitting unanswered work',async()=>{
  let polls=0;
  const target={evaluate:async fn=>fn.name==='domChoiceSelected'?false:{native:false,caption:false},click:async()=>{}};
  await assert.rejects(executeChoice({target,gate:async()=>{},wait:async()=>{polls++;}}),/未确认选中/);
  assert.equal(polls,10);
});
