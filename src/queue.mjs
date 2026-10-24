// manualTypes / skipTypes 来自课程配置：不同教材里"手动任务""默认跳过题"的名称可能不同。
// 不传时保持旧默认，测试与旧调用不受影响。
export function selectQueue(inventory,types,{unit,type,skipBankedCloze=false,
  manualTypes=['项目作品上传','复习自评'],skipTypes=[]}={}) {
  const manual=new Set(manualTypes);
  const skip=new Set(skipTypes);
  return inventory.map(t=>({...t,path:[...t.path,t.task],type:types.get(t.key)}))
    .filter(t=>!manual.has(t.type)&&!skip.has(t.type))
    .filter(t=>unit===undefined||t.unit===unit)
    .filter(t=>!type||t.type===type)
    .filter(t=>!skipBankedCloze||!t.path.some(p=>/^banked\s+cloze$/i.test(p.trim())));
}

export function queueLabel(task) {
  return `Unit ${task.unit} / ${task.path.join(' / ')}`;
}

export function formatQueue(queue, progress = {}) {
  if (!queue.length) return '当前筛选没有任务；检查 --unit / --type / --skip-banked-cloze。';
  const width = String(queue.length).length;
  return queue.map((t, i) => {
    const status = progress.tasks?.[t.key]?.status || '未开始';
    return `${String(i + 1).padStart(width, ' ')}. ${queueLabel(t)}  [${t.type || '未知题型'}]  ${status}`;
  }).join('\n');
}

// --from 支持三种写法：1 基序号（先用 --list 查看）、任务 key（JSON 数组）、Unit/路径片段。
export function sliceFrom(queue, selector) {
  const value = String(selector ?? '').trim();
  if (!value) throw new Error('--from 需要一个任务序号或 Unit/路径片段');
  if (/^\d+$/.test(value)) {
    const index = Number(value);
    if (index < 1 || index > queue.length) throw new Error(`--from ${index} 超出范围：当前队列共 ${queue.length} 个任务；先运行 node src/runner.mjs --list 查看序号`);
    return {index: index - 1, task: queue[index - 1]};
  }
  const normalize = text => String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const segments = text => normalize(text).split('/').map(s => s.trim()).filter(Boolean);
  // 页面目录会把同一层级重复一次（如 Section C / Translation / Translation / Task 1），
  // 所以含 "/" 的写法按顺序匹配层级片段，而不是整串子串。
  const orderedMatch = (label, needle) => {
    let at = 0;
    for (const part of segments(label)) {
      if (at < needle.length && part.includes(needle[at])) at++;
    }
    return at === needle.length;
  };
  const matches = value.startsWith('[')
    ? queue.map((t, i) => ({t, i})).filter(x => x.t.key === value)
    : (() => {
        const needle = value.includes('/') ? segments(value) : normalize(value);
        return queue.map((t, i) => ({t, i})).filter(x => {
          const label = `${queueLabel(x.t)} / ${x.t.type || ''}`;
          return Array.isArray(needle) ? orderedMatch(label, needle) : normalize(label).includes(needle);
        });
      })();
  if (!matches.length) throw new Error(`--from 未匹配到任务：${value}；先运行 node src/runner.mjs --list 查看可选任务`);
  if (matches.length > 1) throw new Error(`--from 匹配到 ${matches.length} 个任务，请写得更具体：\n`
    + matches.map(x => ` ${x.i + 1}. ${queueLabel(x.t)}`).join('\n'));
  return {index: matches[0].i, task: matches[0].t};
}
