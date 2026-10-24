import test from 'node:test';
import assert from 'node:assert/strict';
import {DeepSeekReplyError, runnerPolicy, shouldSkipRecord, canContinueReplyFailure} from '../src/policy.mjs';

test('runner policy persists skipped tasks and exposes explicit retry override',()=>{
  const policy=runnerPolicy({runnerPolicy:{skippedTasks:'remember',listeningChoices:'first',deepseekFailure:'continue'}},[]);
  assert.equal(shouldSkipRecord({status:'submitted'},policy),true);
  assert.equal(shouldSkipRecord({status:'learned'},policy),true);
  assert.equal(shouldSkipRecord({status:'skipped'},policy),true);
  const retry=runnerPolicy({runnerPolicy:{skippedTasks:'remember'}},['--retry-skipped']);
  assert.equal(shouldSkipRecord({status:'skipped'},retry),false);
  assert.equal(shouldSkipRecord({status:'failed'},policy),false);
});

test('only DeepSeek reply failures are allowed to continue',()=>{
  const policy=runnerPolicy({runnerPolicy:{deepseekFailure:'continue'}},[]);
  assert.equal(canContinueReplyFailure(new DeepSeekReplyError('bad'),policy),true);
  assert.equal(canContinueReplyFailure(new Error('bad'),policy),false);
  assert.equal(canContinueReplyFailure(new DeepSeekReplyError('bad'),runnerPolicy({runnerPolicy:{deepseekFailure:'stop'}},[])),false);
});
