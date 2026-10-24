import fs from 'node:fs/promises';
import path from 'node:path';
import {gotoWithRetry} from './net.mjs';

// Read only rendered directory entries and visit required task pages; never submit.
export async function crawlRequired({context, overview, solver, config, output, gate, wait, snapshot}) {
  const dir = path.join(output, 'inventory');
  await fs.mkdir(dir, {recursive:true});
  const uiTexts = config.uiTexts || {};
  // 目录页会异步渲染；导航带超时与重试，失败时给出可读原因而不是直接崩。
  await gotoWithRetry(overview, config.courseUrl, {
    timeoutMs: config.network?.gotoTimeoutMs ?? 30000,
    retries: config.network?.retries ?? 2,
    retryDelayMs: config.network?.retryDelayMs ?? 1500,
  });
  await wait(3500);
  const unitTabs = overview.locator('[class*="unipus-tabs_unitTabItemContainer"]');
  const unitCount = await unitTabs.count();
  if (!unitCount) throw new Error('未找到目录单元，无法确认必修范围');
  const manifest = [];
  for (let ui=0;ui<unitCount;ui++) {
    await gate(); await unitTabs.nth(ui).click(); await wait(900);
    for (let n=0;n<8;n++) {
      const collapsed = overview.locator('[class*="courseDetailNodeCollapseContainer"] .ant-collapse-header[aria-expanded=false]');
      if (!await collapsed.count()) break;
      await collapsed.first().click(); await wait(150); n--;
    }
    const tasks = await overview.evaluate(() => Array.from(document.querySelectorAll('[class*="courses-unit_taskItemContainer"]')).filter(e=>e.getBoundingClientRect().height>0).map(e => {
      const chain=[];
      for(let p=e.parentElement;p;p=p.parentElement) {
        if(p.classList.contains('ant-collapse-item')) {
          const h=p.querySelector(':scope > .ant-collapse-header .ant-collapse-header-text');
          if(h) chain.unshift(h.innerText.trim());
        }
      }
      return {path:chain,task:e.querySelector('[class*="taskTypeName"]')?.innerText.trim(),required:!!e.querySelector('[class*="taskRequireIcon"]'),status:e.querySelector('[class*="taskStateContainer"]')?.innerText.trim()};
    }));
    manifest.push(...tasks.map(t=>({...t,unit:ui+1,key:JSON.stringify([ui+1,...t.path,t.task])})));
    await fs.writeFile(path.join(dir,`directory-unit-${ui+1}.html`),await overview.content());
    console.log(`目录 Unit ${ui+1}: ${tasks.filter(t=>t.required).length}/${tasks.length} 必修`);
  }
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
  const startPattern = new RegExp(`^(${uiTexts.startLearning || '开始学习'}|${uiTexts.continueLearning || '继续学习'})$`);
  await overview.getByRole('button',{name:startPattern}).click(); await wait(2000);
  const coursewareHost = (config.login?.courseHosts || []).find(host => /ucontent/i.test(host)) || 'ucontent.unipus.cn';
  const course=context.pages().filter(p=>p!==solver && (() => { try { return new URL(p.url()).hostname === coursewareHost; } catch { return false; } })()).at(-1);
  if(!course) throw new Error('课件标签未打开');
  const dismissText = uiTexts.dismiss || '我知道了';
  let notices=[];
  await course.addLocatorHandler(course.getByRole('button',{name:dismissText,exact:true}),async locator=>{
    notices.push(await course.locator('.ant-modal-wrap:visible').innerText());
    await locator.click();
  });
  async function dismiss() {
    const text=await course.evaluate(dismissLabel=>{
      const modal=Array.from(document.querySelectorAll('.ant-modal-wrap')).find(e=>e.getBoundingClientRect().height>0);
      if(!modal)return '';
      const button=Array.from(modal.querySelectorAll('button')).find(e=>e.innerText.trim()===dismissLabel);
      if(!button)return '';
      const text=modal.innerText;button.click();return text;
    },dismissText);
    if(text){notices.push(text);await wait(350);}
  }
  await wait(1500); await dismiss();
  const menus=await course.locator('.pc-menu-node-name').evaluateAll(es=>es.map((e,index)=>{
    let section='',unit='';
    for(let p=e.parentElement;p;p=p.parentElement) {
      const s=p.querySelector(':scope > [data-role="section"]');
      const u=p.querySelector(':scope > [data-role="unit"]');
      if(s && !section) section=s.innerText.trim();
      if(u && !unit) unit=u.innerText.trim();
    }
    return {index,name:e.innerText.trim(),section,unit:Number(unit.match(/Unit\s+(\d+)/)?.[1])};
  }));
  await fs.writeFile(path.join(dir,'menus.json'),JSON.stringify(menus,null,2));
  let inventory=[];
  try { inventory=JSON.parse(await fs.readFile(path.join(dir,'required-tasks.json'),'utf8')); } catch(e) {if(e.code!=='ENOENT')throw e;}
  const seen=new Set(inventory.map(t=>t.key));
  for(const m of menus) {
    const targets=manifest.filter(t=>t.required && t.unit===m.unit && t.path[0]===m.section && (t.path[1]===m.name || (t.path.length===1 && m.name===m.section)));
    if(!targets.some(t=>!seen.has(t.key))) continue;
    await gate(); await dismiss();
    await course.locator('.pc-menu-node-name').nth(m.index).click(); await wait(1400); await dismiss();
    for(const t of targets) {
      if(seen.has(t.key))continue;
      await gate(); notices=[]; await dismiss();
      const tabName=t.path[2] || t.path[1];
      const tab=course.locator('.pc-tab-view-container').filter({hasText:new RegExp('^'+tabName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
      if(await tab.count()!==1)throw new Error(`页签无法唯一定位 ${t.key}`);
      await tab.click(); await wait(1400); await dismiss();
      const task=course.locator('.pc-task').filter({hasText:new RegExp('^'+t.task.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
      if(await task.count()!==1)throw new Error(`任务无法唯一定位 ${t.key}`);
      await task.click(); await wait(1600); await dismiss();
      const state=await snapshot(course);
      const text=await course.locator('main').innerText();
      const record={...state,...t,text,evidence:notices};
      await fs.writeFile(path.join(dir,`task-${inventory.length+1}.html`),await course.locator('main').evaluate(e=>e.outerHTML));
      inventory.push(record);seen.add(t.key);
      await fs.writeFile(path.join(dir,'required-tasks.json'),JSON.stringify(inventory,null,2));
      console.log(`必修遍历 ${inventory.length}: Unit ${t.unit} / ${t.path.join(' / ')} / ${t.task}`);
    }
  }
  const missing=manifest.filter(t=>t.required && !seen.has(t.key));
  await fs.writeFile(path.join(dir,'missing.json'),JSON.stringify(missing,null,2));
  console.log(`必修遍历 ${inventory.length}/${manifest.filter(t=>t.required).length}；缺失 ${missing.length}`);
  if(missing.length)throw new Error('仍有必修任务未定位，详见 inventory/missing.json');
}
