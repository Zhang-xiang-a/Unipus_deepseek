import test from 'node:test';
import assert from 'node:assert/strict';
import {currentReplyText,createReplyReader,normalizeReplyPlan} from '../src/deepseek-reply.mjs';

const controls=[{id:'104',choiceGroup:'q1',choiceLabel:'True'},{id:'105',choiceGroup:'q1',choiceLabel:'False'},{id:'106',choiceGroup:'q1',choiceLabel:'Not given'},
  {id:'f',tag:'input',writable:true},{id:'submit',tag:'button',text:'提交'},{id:'nav',tag:'a',navigation:true}];
const plan={nonce:'current',finished:false,actions:[{type:'click',id:'106'}]};

test('new reply is read when DeepSeek replaces markdown nodes without increasing message count',()=>{
  const baseline=['old answer','thinking'];
  const text=currentReplyText(['old answer',JSON.stringify(plan)],baseline);
  assert.equal(text,JSON.stringify(plan));
  const reader=createReplyReader('current',controls);
  assert.equal(reader(text),null);
  assert.deepEqual(reader(text),plan);
});

test('collapsed history still reads current reply; unchanged history and stale nonces cannot execute',()=>{
  const baseline=['first','second','third'];
  assert.equal(currentReplyText(baseline,baseline),'');
  assert.equal(currentReplyText([JSON.stringify(plan)],baseline),JSON.stringify(plan));
  const reader=createReplyReader('next',controls);
  for(let i=0;i<3;i++)assert.equal(reader(JSON.stringify(plan)),null);
});

test('reader waits for a complete stable plan and resets stability across incomplete reads',()=>{
  const reader=createReplyReader('current',controls),body=JSON.stringify(plan);
  assert.equal(reader(body.slice(0,-2)),null);
  assert.equal(reader(body),null);
  assert.equal(reader(body.slice(0,-1)),null);
  assert.equal(reader(body),null);
  assert.deepEqual(reader(body),plan);
});

test('omitted type is recovered only for explicit editable fields or choice targets',()=>{
  const missing={nonce:'current',actions:[{id:'f',value:'text'},{id:106}]};
  assert.deepEqual(normalizeReplyPlan(missing,controls).actions,[{id:'f',value:'text',type:'fill'},{id:'106',type:'click'}]);
  assert.equal(missing.actions[0].type,undefined);
  for(const id of ['submit','nav','unknown']) {
    const reader=createReplyReader('current',controls),text=JSON.stringify({nonce:'current',actions:[{id}]});
    assert.equal(reader(text),null);assert.throws(()=>reader(text));
  }
  const bad=createReplyReader('current',controls),text=JSON.stringify({nonce:'current',actions:[{type:'evaluate',id:'f'}]});
  bad(text);assert.throws(()=>bad(text),/Unsupported/);
});

test('current raw-key judgement reply is repaired then validated without changing its answer',()=>{
  const text='{"nonce":"current","task":{"key":"[3,"Section C","Understanding","Task 1"]"},"actions":[{"type":"click","id":"106"}]}';
  const reader=createReplyReader('current',controls);
  assert.equal(reader(text),null);
  assert.deepEqual(reader(text).actions,plan.actions);
});
