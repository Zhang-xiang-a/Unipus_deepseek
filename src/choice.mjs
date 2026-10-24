import {answerableFields,findSubmitControl} from './core.mjs';

export function isChoiceControl(c) {
  return !!c && (!!c.choiceGroup || c.type==='radio' && !!c.group);
}

export function choiceSubmitPlan(controls, options = {}) {
  const groups=new Map();
  for(const c of controls.filter(c=>!c.disabled && isChoiceControl(c))) {
    const key=c.choiceGroup || `radio:${c.group}`;
    groups.set(key,(groups.get(key) || false) || c.checked===true);
  }
  const submit=findSubmitControl(controls, options);
  if(!groups.size || [...groups.values()].some(checked=>!checked) || !submit)return null;
  if(answerableFields(controls).some(c=>!String(c.value ?? '').trim()))return null;
  return {actions:[{type:'click',id:submit.id}],reason:'上一轮选项已执行，重新读取确认各题均已选中，单独提交'};
}

export function domChoiceSelected(element) {
  const option=element.closest('.option,[role="radio"]') || element;
  return element.checked===true || element.getAttribute('aria-checked')==='true' || option.getAttribute('aria-checked')==='true' ||
    ['selected','active','checked','isSelected'].some(name=>option.classList.contains(name)) ||
    !!option.querySelector('input[type=radio]:checked');
}

export async function executeChoice({target,gate,wait,timeoutMs=5000}) {
  await gate();
  const selected=()=>target.evaluate(domChoiceSelected);
  if(await selected())return;
  const shape=await target.evaluate(e=>({native:e.matches('input[type=radio]'),caption:e.matches('.caption')}));
  if(shape.native)await target.check({timeout:timeoutMs});
  else if(shape.caption)await target.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," option ")][1]').click({timeout:timeoutMs});
  else await target.click({timeout:timeoutMs});
  for(let i=0;i<10;i++) {
    await gate();
    if(await selected())return;
    await wait(100);
  }
  throw new Error('选项点击后未确认选中，已停止当前动作批次');
}
