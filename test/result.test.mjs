import test from 'node:test';
import assert from 'node:assert/strict';
import {isAnswerSummary,readAnswerResult} from '../src/result.mjs';

test('analysis links and ordinary question text do not count as submission evidence',()=>{
  assert.equal(isAnswerSummary('查看答题小结 答案解析 参考答案'),false);
  assert.equal(isAnswerSummary('答题小结 答题情况 主观题已作答 (3/3)'),true);
});

test('recover an already graded translation by opening its summary',async()=>{
  let opened=false,clicks=0;
  const summary={filter(){return this;},count:async()=>1,click:async()=>{opened=true;clicks++;}};
  const page={locator:()=>({innerText:async()=>opened?'答题小结 答题情况 主观题已作答 (3/3)':'答案解析 参考答案'}),getByText:()=>summary};
  assert.match(await readAnswerResult({page,gate:async()=>{},wait:async()=>{}}),/答题小结/);
  assert.equal(clicks,1);
});
