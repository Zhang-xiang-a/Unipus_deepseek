import test from 'node:test';
import assert from 'node:assert/strict';
import {isListeningTask,planListening} from '../src/answer.mjs';

test('detect listening tasks from type, path, or rendered question text',()=>{
  assert.equal(isListeningTask({type:'听力理解',path:[]},''),true);
  assert.equal(isListeningTask({type:'选择题',path:['Listening','Task 1']},''),true);
  assert.equal(isListeningTask({type:'选择题',path:['Reading']},'Listen to the passage and answer.'),true);
  assert.equal(isListeningTask({type:'选择题',path:['Reading']},'Read the passage.'),false);
});
test('all listening blanks become 1, existing answers are replaced, and submission is separate',()=>{
  const fields=[{id:'a',tag:'input',writable:true,value:''},{id:'b',tag:'textarea',writable:true,value:'old'},{id:'c',tag:'input',type:'radio',writable:true},{id:'s',tag:'a',text:'提 交'}];
  assert.deepEqual(planListening(fields).actions,[{type:'fill',id:'a',value:'1'},{type:'fill',id:'b',value:'1'}]);
  fields[0].value=fields[1].value='1';
  assert.deepEqual(planListening(fields).actions,[{type:'click',id:'s'}]);
  assert.throws(()=>planListening([{tag:'input',type:'radio',writable:true}]));
});

test('listening choice questions select the first option in every group',()=>{
  const controls=[
    {id:'a1',choiceGroup:'q1',choiceLabel:'A',checked:false},
    {id:'a2',choiceGroup:'q1',choiceLabel:'B',checked:false},
    {id:'b1',choiceGroup:'q2',choiceLabel:'A',checked:false},
    {id:'b2',choiceGroup:'q2',choiceLabel:'B',checked:false},
    {id:'s',tag:'button',text:'提交'}
  ];
  assert.deepEqual(planListening(controls,{choicePolicy:'first'}).actions,[{type:'click',id:'a1'},{type:'click',id:'b1'}]);
  controls[0].checked=controls[2].checked=true;
  assert.deepEqual(planListening(controls,{choicePolicy:'first'}).actions,[{type:'click',id:'s'}]);
  controls[0].checked=false;controls[1].checked=true;
  assert.deepEqual(planListening(controls,{choicePolicy:'first'}).actions,[{type:'click',id:'a1'}]);
});

test('native radios use their name groups and fixed plans bypass random variation',()=>{
  const controls=[{id:'a',type:'radio',group:'q1'},{id:'b',type:'radio',group:'q1',checked:true},{id:'s',text:'提交'}];
  const plan=planListening(controls,{choicePolicy:'first'});
  assert.equal(plan.policy,'listening-fixed');
  assert.deepEqual(plan.actions,[{type:'click',id:'a'}]);
  assert.equal(planListening(controls,{choicePolicy:'deepseek'}),null);
  assert.throws(()=>planListening(controls,{choicePolicy:'manual'}),/手动/);
});

test('listening blanks are handled before choices',()=>{
  const controls=[{id:'input',tag:'input',writable:true,value:''},{id:'choice',choiceGroup:'q',checked:false},{id:'submit',text:'提交'}];
  assert.deepEqual(planListening(controls,{choicePolicy:'first'}).actions,[{type:'fill',id:'input',value:'1'}]);
});
