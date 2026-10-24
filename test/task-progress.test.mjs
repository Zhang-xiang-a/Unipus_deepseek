import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTaskProgress} from '../src/task-progress.mjs';
const task={url:'https://ucontent.unipus.cn/pc.html#/course/unit/tab/task35'};
const response=pass=>({code:0,rt:{leafs:{task35:{state:{pass,pass2:pass,perm:1},strategies:{required:true}}}}});

test('persisted progress verifies the requested task even when practice opens blank',()=>{
  for(const pass of [1,2])assert.equal(verifyTaskProgress(task,response(pass)).courseCompletionVerified,true);
  for(const pass of [0,undefined,99])assert.equal(verifyTaskProgress(task,response(pass)).courseCompletionVerified,false);
});
test('a different task, failed response or missing progress cannot certify completion',()=>{
  for(const data of [{}, {...response(1),code:1},{code:0,rt:{leafs:{other:{state:{pass:1}}}}}])assert.equal(verifyTaskProgress(task,data).courseCompletionVerified,false);
  assert.equal(verifyTaskProgress(task,response(1)).leafId,'task35');
});
