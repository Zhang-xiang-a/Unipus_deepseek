// 从 start 处的 "{" 取出到匹配 "}" 的片段；括号不平衡（被截断）时返回 null。
export function balancedJsonSlice(text, start) {
  const body = String(text ?? '');
  let depth = 0, quoted = false, escaped = false;
  for (let end = start; end < body.length; end++) {
    const c = body[end];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return body.slice(start, end + 1);
  }
  return null;
}

// 模型常在值里直接引用原文而留下未转义的双引号（或裸换行），导致 JSON.parse 失败；
// 这里在字符串内部把这类字符补上转义，再交给 JSON.parse。
export function repairJsonText(slice) {
  // Only repair the known metadata shape: key is a serialized JSON array.
  // Validate that inner array before escaping it; never recover actions by guessing.
  const body = String(slice ?? '').replace(/("key"\s*:\s*)"(\[[^\r\n]*?\])"(?=\s*[,}])/g,(match,prefix,inner)=>{
    try {
      const key=JSON.parse(inner);
      if(!Array.isArray(key)||!key.length||!key.every(x=>typeof x==='string'||typeof x==='number'))return match;
      return prefix+JSON.stringify(inner);
    } catch {return match;}
  });
  const out = [];
  let quoted = false, escaped = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (!quoted) {
      out.push(c);
      if (c === '"') quoted = true;
      continue;
    }
    if (escaped) { out.push(c); escaped = false; continue; }
    if (c === '\\') { out.push(c); escaped = true; continue; }
    if (c === '\n') { out.push('\\n'); continue; }
    if (c === '\r') { out.push('\\r'); continue; }
    if (c === '\t') { out.push('\\t'); continue; }
    if (c === '"') {
      // 只有后面紧跟 , } ] : 或已到结尾，才算这个字符串真正的收尾引号。
      const rest = body.slice(i + 1);
      if (/^\s*[,}\]:]/.test(rest) || rest.trim() === '') { out.push(c); quoted = false; continue; }
      out.push('\\"');
      continue;
    }
    out.push(c);
  }
  return out.join('');
}

function parseSlice(slice) {
  try { return JSON.parse(slice); }
  catch { try { return JSON.parse(repairJsonText(slice)); } catch { return null; } }
}

export function parsePlan(text, nonce) {
  const body = String(text ?? '');
  for (let start = body.lastIndexOf('{'); start >= 0; start = start === 0 ? -1 : body.lastIndexOf('{', start - 1)) {
    const slice = balancedJsonSlice(body, start);
    if (!slice) continue;
    const plan = parseSlice(slice);
    if (plan && plan.nonce === nonce && Array.isArray(plan.actions)) return plan;
  }
  return null;
}

// 解析失败时给出可读原因，写进 events.jsonl，避免下次还要人工去 DeepSeek 标签里翻原文。
export function describePlanFailure(text, nonce) {
  const body = String(text ?? '');
  for (let start = body.lastIndexOf('{'); start >= 0; start = start === 0 ? -1 : body.lastIndexOf('{', start - 1)) {
    const slice = balancedJsonSlice(body, start);
    if (!slice) continue;
    if (!slice.includes('"nonce"') && !slice.includes('"actions"')) continue;
    let error = '';
    try { JSON.parse(slice); } catch (e) { error = e.message; }
    const plan = parseSlice(slice);
    if (!plan) return `JSON 无法解析（长度 ${slice.length}）：${error || '未知错误'}`;
    if (plan.nonce !== nonce) return `nonce 不匹配：收到 ${JSON.stringify(plan.nonce)}`;
    if (!Array.isArray(plan.actions)) return 'actions 不是数组';
  }
  return '没有找到含 nonce/actions 的完整 JSON 对象（可能被截断）';
}

export function validatePlan(plan, controls, {allowedHosts = ['uai.unipus.cn', 'ucontent.unipus.cn'], submitTexts} = {}) {
  if (!plan || !Array.isArray(plan.actions) || plan.actions.length > 64) throw new Error('Invalid action list');
  const ids = new Map(controls.map(c => [c.id, c]));
  // 提交判定保持"文字里含提交字样"的宽松语义；配置了 submitTexts 时按课程文案判断。
  const submitting = plan.actions.some(a => {
    const text = ids.get(a.id)?.text || '';
    if (Array.isArray(submitTexts) && submitTexts.length) {
      return submitTexts.some(pattern => {
        const value = String(pattern).trim();
        if (!value) return false;
        return value.startsWith('^') ? new RegExp(value, 'i').test(text) : text.toLowerCase().includes(value.toLowerCase());
      });
    }
    return /提\s*交|Submit/i.test(text);
  });
  if (submitting && plan.actions.some(a => ['fill', 'select', 'drag'].includes(a.type))) throw new Error('填写与提交必须分轮');
  for (const [index, a] of plan.actions.entries()) {
    if (!['click', 'fill', 'select', 'drag', 'wait'].includes(a.type)) throw new Error(`Unsupported action: ${a.type}`);
    if (a.type === 'wait') {
      if (!Number.isFinite(a.seconds) || a.seconds < 1 || a.seconds > 300) throw new Error('Invalid wait');
      continue;
    }
    const control = ids.get(a.id);
    if (!control || control.disabled) throw new Error('Missing or disabled control');
    if (control.href) {
      let url;
      try { url = new URL(control.href); } catch { throw new Error('Invalid link'); }
      if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname)) throw new Error('Link outside course scope');
    }
    if (a.type === 'click' && control.navigation && index !== plan.actions.length - 1) throw new Error('Navigation must be the last action; take a new snapshot first');
    if (a.type === 'drag' && !ids.has(a.to)) throw new Error('Missing drag target');
    if (['fill', 'select'].includes(a.type) && (typeof a.value !== 'string' || a.value.length > 12000)) throw new Error('Invalid field value');
    if (a.type === 'fill' && !['input', 'textarea'].includes(control.tag) && !control.editable) throw new Error('Target is not editable');
    if (a.type === 'select' && control.tag !== 'select') throw new Error('Target is not a select');
    if (/验证码|captcha|密码|password|支付|购买|删除/i.test(control.text + ' ' + control.type)) throw new Error('Authentication or unrelated consequential control');
  }
  return plan;
}

// A submit control may be an <a class="btn">提交</a>; some pages mark it navigation:true,
// so识别必须只依赖文字，且在提交前把它保留在可点击列表里。
// submitTexts 来自课程配置；不传时沿用内置文案，保证旧调用与测试不受影响。
export function isSubmitControl(control, {submitTexts} = {}) {
  const text = String(control?.text ?? '').trim();
  if (!text) return false;
  if (Array.isArray(submitTexts) && submitTexts.length) {
    return submitTexts.some(pattern => {
      const value = String(pattern).trim();
      if (!value) return false;
      if (value.startsWith('^')) return new RegExp(value, 'i').test(text);
      return text.toLowerCase() === value.toLowerCase();
    });
  }
  return /^(提\s*交|提\s*交答案|提交答案|submit)$/i.test(text);
}

export function findSubmitControl(controls, options = {}) {
  return (controls || []).find(c => !c.disabled && isSubmitControl(c, options)) || null;
}

export function answerableFields(controls) {
  return (controls || []).filter(c => !c.disabled && !c.navigation &&
    (['input','textarea','select'].includes(c.tag) || c.editable === true) &&
    !['radio','checkbox','hidden','button','submit','file','image','reset'].includes(String(c.type || '').toLowerCase()));
}

export function planHasAction(plan) {
  return (plan?.actions || []).some(a => a.type !== 'wait');
}

// 页面指纹没变，或计划里只有 wait，都算这一轮没有进展；有实际动作且页面变化才清零。
export function nextStall({stall = 0, unchanged = false, plan} = {}) {
  return (unchanged || !planHasAction(plan)) ? stall + 1 : 0;
}

// 连续填多个空时不需要按 click 的节奏等待；只有会改变页面状态的 click/drag 才用较长的拟人延迟。
export function actionDelayRange(action, {delayMs = [1800, 4500], fillDelayMs = [250, 600]} = {}) {
  return ['fill', 'select'].includes(action?.type) ? fillDelayMs : delayMs;
}

// DeepSeek 已经不再输出、且明显尝试写过 JSON（含 {）却始终解析不出计划 → 不必再等满 responseTimeoutMs。
export function isUnusableReply({text, unchangedReads, minReads = 4} = {}) {
  const body = String(text ?? '');
  return unchangedReads >= minReads && body.length > 40 && body.includes('{');
}

// 用「页面文字 + 全部作答控件取值」作为进展指纹；指纹不变或计划里只有 wait 视为没有进展。
export function roundSignature(state) {
  const fields = (state?.controls || []).filter(c => ['input','textarea','select'].includes(c.tag) || c.editable || c.choiceGroup || c.type==='radio')
    .map(c => `${c.id}:${String(c.value ?? '').trim()}:${c.checked ? '1' : '0'}`);
  return JSON.stringify([String(state?.text || ''), fields]);
}

// 模型连续返回无进展计划时使用的兜底判定：只有确认页面上每个作答控件都已填写且存在提交控件才允许脚本直接提交。
export function decideStalledRecovery({controls, choicesAnswered = true, choiceCount = 0, submitTexts} = {}) {
  const submit = findSubmitControl(controls, {submitTexts});
  if (!submit) return {action: 'stop', reason: '页面没有可识别的提交控件'};
  const fields = answerableFields(controls);
  if (!fields.length && !choiceCount) return {action: 'stop', reason: '页面上没有可识别的作答控件，无法确认是否已作答'};
  if (!choicesAnswered) return {action: 'stop', reason: `仍有 ${choiceCount} 处选择题没有选中选项`};
  const empty = fields.filter(c => String(c.value ?? '').trim() === '');
  if (empty.length) return {action: 'stop', reason: `仍有 ${empty.length} 个作答控件为空（id: ${empty.map(c => c.id).join(', ')}）`};
  return {action: 'submit', id: submit.id, text: String(submit.text || '').trim()};
}

export function normalizeFillPlan(plan, controls) {
  const out=structuredClone(plan);
  for(const action of out.actions) {
    const control=controls.find(c=>c.id===action.id);
    const prefix=control?.fixedPrefix;
    if(action.type==='fill' && prefix && action.value.length>prefix.length &&
       action.value.toLowerCase().startsWith(prefix.toLowerCase())) action.value=action.value.slice(prefix.length);
  }
  return out;
}

export function varyChoice(plan, controls, rate, random = Math.random, decisions = {}) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.3) throw new Error('incorrectChoiceRate must be between 0 and 0.3');
  const out = structuredClone(plan);
  for (const a of out.actions) {
    const c = controls.find(c => c.id === a.id);
    const group=c?.choiceGroup || (c?.type==='radio'?c.group:'');
    if(a.type!=='click'||!group)continue;
    let decision=decisions[group];
    if(decision && !decision.varied) decision.label=c.choiceLabel||c.id;
    if(!decision) {
      const alternatives=controls.filter(x=>!x.disabled && x.id!==c.id &&
        (c.choiceGroup?x.choiceGroup===group:x.type==='radio'&&x.group===group));
      const varied=rate>0 && random()<rate && alternatives.length>0;
      const target=varied?alternatives[Math.floor(random()*alternatives.length)]:c;
      decision=decisions[group]={label:target.choiceLabel||target.id,varied:!!varied};
    }
    const target=controls.find(x=>(c.choiceGroup?x.choiceGroup===group:x.group===group) &&
      (x.choiceLabel||x.id)===decision.label);
    if(!target)throw new Error('已保存选择无法对应当前选项，停止避免重复随机');
    a.id=target.id;a.varied=decision.varied;
  }
  return out;
}
