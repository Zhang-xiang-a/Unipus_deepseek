import {parsePlan,validatePlan} from './core.mjs';

// DeepSeek can rebuild/virtualize markdown nodes; message counts are not stable.
export function currentReplyText(replies, baseline) {
  let first=0;
  while(first<baseline.length && first<replies.length && baseline[first]===replies[first])first++;
  return replies.slice(first).join('\n');
}

export function normalizeReplyPlan(plan, controls) {
  const out=structuredClone(plan);
  for(const action of out.actions || []) {
    if(!action || typeof action!=='object')throw new Error('Invalid action');
    if(typeof action.id==='number' && Number.isInteger(action.id))action.id=String(action.id);
    if(action.type!==undefined)continue;
    const control=controls.find(c=>c.id===action.id);
    if(!control || control.disabled || control.navigation)continue;
    if(typeof action.value==='string' && (control.writable || control.editable || ['input','textarea'].includes(control.tag)) && !['radio','checkbox','hidden','file'].includes(control.type))action.type='fill';
    else if(action.value===undefined && (control.choiceGroup || control.type==='radio' && control.group))action.type='click';
  }
  return out;
}

export function createReplyReader(nonce, controls) {
  let previous='';
  return text=>{
    const parsed=parsePlan(text,nonce);
    if(!parsed){previous='';return null;}
    const serialized=JSON.stringify(parsed);
    const stable=serialized===previous;
    previous=serialized;
    if(!stable)return null;
    return validatePlan(normalizeReplyPlan(parsed,controls),controls);
  };
}
