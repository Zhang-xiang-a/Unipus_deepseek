import test from 'node:test';
import assert from 'node:assert/strict';
import {selectQueue,formatQueue,sliceFrom,queueLabel} from '../src/queue.mjs';
test('unit scope excludes banked cloze without excluding vocabulary or other units incorrectly',()=>{
  const tasks=[{key:'a',unit:2,path:['Unit test'],task:'Banked cloze'},{key:'b',unit:2,path:['Unit test'],task:'Vocabulary'},{key:'c',unit:1,path:['Unit test'],task:'Reading'}];
  const types=new Map([['a','选词完形填空'],['b','选择题'],['c','选择题']]);
  assert.deepEqual(selectQueue(tasks,types,{unit:2,skipBankedCloze:true}).map(t=>t.key),['b']);
});

const key=i=>JSON.stringify([3,...queue[i].path]);
const queue=[
  {unit:3,path:['Section A','Reading the text','Pre-reading activities','Task 1'],type:'单词 / 短语填空'},
  {unit:3,path:['Section A','Reading comprehension','Understanding the text','Understanding the text'],type:'开放问答 / 讨论'},
  {unit:3,path:['Section C','Translation','Translation','Task 1'],type:'翻译'},
  {unit:3,path:['Section C','Translation','Translation','Task 2'],type:'翻译'},
].map((t,i)=>({...t,key:JSON.stringify([3,...t.path])}));

test('--from accepts a 1-based index from the printed list',()=>{
  assert.deepEqual(sliceFrom(queue,'1').task.key,queue[0].key);
  assert.deepEqual(sliceFrom(queue,'3').task.key,queue[2].key);
  assert.throws(()=>sliceFrom(queue,'0'),/超出范围/);
  assert.throws(()=>sliceFrom(queue,'9'),/超出范围/);
});

test('--from accepts a unique path fragment, a key, and explains ambiguous matches',()=>{
  assert.equal(sliceFrom(queue,'Understanding the text').task.key,key(1));
  assert.equal(sliceFrom(queue,'section c / translation / translation / task 2').task.key,key(3));
  assert.equal(sliceFrom(queue,'Section C/Translation/Task 1').task.key,key(2));
  assert.equal(sliceFrom(queue,'task 2').task.key,key(3));
  assert.equal(sliceFrom(queue,key(3)).task.key,key(3));
  assert.throws(()=>sliceFrom(queue,'Translation'),/匹配到 2 个任务/);
  assert.throws(()=>sliceFrom(queue,'翻译'),/匹配到 2 个任务/);
  assert.throws(()=>sliceFrom(queue,'Section C/Translation'),/匹配到 2 个任务/);
  assert.throws(()=>sliceFrom(queue,'Not here'),/未匹配到任务/);
  assert.throws(()=>sliceFrom(queue,''),/需要/);
});

test('the printed queue shows order, path, type and saved status',()=>{
  const text=formatQueue(queue,{tasks:{[key(0)]:{status:'submitted'},[key(1)]:{status:'in-progress'}}});
  assert.match(text,/^1\. Unit 3 \/ Section A \/ Reading the text \/ Pre-reading activities \/ Task 1 {2}\[单词 \/ 短语填空\] {2}submitted$/m);
  assert.match(text,/2\. Unit 3 .*\[开放问答 \/ 讨论\] {2}in-progress/);
  assert.match(text,/4\. Unit 3 .*未开始/);
  assert.match(formatQueue([],{}),/没有任务/);
  assert.equal(queueLabel(queue[2]),'Unit 3 / Section C / Translation / Translation / Task 1');
});

test('printed numbers are the same numbers --from accepts, so logs and --list agree',()=>{
  const lines=formatQueue(queue,{}).split('\n');
  queue.forEach((t,i)=>{
    assert.match(lines[i],new RegExp(`^${i+1}\\. `));
    assert.equal(sliceFrom(queue,String(i+1)).task.key,t.key);
  });
});
