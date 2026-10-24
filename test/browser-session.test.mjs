import test from 'node:test';
import assert from 'node:assert/strict';
import {isCourseUrl,selectCoursePage,ensureBrowserPages,showBrowserPage} from '../src/browser-session.mjs';

const config={courseUrl:'https://uai.unipus.cn/app/cmgt/course-management',deepseekUrl:'https://chat.deepseek.com/'};
const login='https://sso.unipus.cn/sso/login?service='+encodeURIComponent(config.courseUrl);
const page=url=>({url:()=>url});

test('course SSO is recognised only when its service belongs to the AI course',()=>{
  assert.equal(isCourseUrl(login),true);
  assert.equal(isCourseUrl(login,{includeLogin:false}),false);
  assert.equal(isCourseUrl('https://sso.unipus.cn/sso/login?service=https://example.com/'),false);
  assert.equal(isCourseUrl('https://uai.unipus.cn.example.com/'),false);
  assert.equal(isCourseUrl('http://uai.unipus.cn/'),false);
});

test('repeated startup preserves original login and DeepSeek tabs without navigation',async()=>{
  const course=page(login),solver=page(config.deepseekUrl);
  const context={pages:()=>[course,solver],newPage:()=>{throw new Error('must not create another tab');}};
  for(let i=0;i<2;i++) {
    const result=await ensureBrowserPages(context,config);
    assert.equal(result.course,course);
    assert.equal(result.solver,solver);
    assert.deepEqual(result.created,[]);
  }
});

test('startup restores missing tabs once even when no page targets remain',async()=>{
  for(const initial of [[],[page(login)],[page(config.deepseekUrl)]]) {
    const pages=[...initial],navigated=[];
    const context={pages:()=>pages,newPage:async()=>{
      let url='about:blank';
      const p={url:()=>url,goto:async target=>{url=target;navigated.push(target);}};
      pages.push(p);return p;
    }};
    const result=await ensureBrowserPages(context,config);
    assert.equal(result.created.length,2-initial.length);
    assert.equal(navigated.length,2-initial.length);
    await ensureBrowserPages(context,config);
    assert.equal(pages.length,2);
  }
});

test('an active course takes priority over stale login tabs',()=>{
  const active=page('https://ucontent.unipus.cn/course#task');
  assert.equal(selectCoursePage([page(login),page(config.courseUrl),active]),active);
});

test('showing a minimized window restores it without closing or navigating tabs',async()=>{
  const commands=[];
  let front=0,detached=0;
  const session={send:async(method,params)=>{
    commands.push({method,params});
    if(method==='Browser.getWindowForTarget')return {windowId:7,bounds:{windowState:'minimized'}};
  },detach:async()=>{detached++;}};
  await showBrowserPage({newCDPSession:async()=>session},{bringToFront:async()=>{front++;}});
  assert.deepEqual(commands.map(x=>x.method),['Browser.getWindowForTarget','Browser.setWindowBounds']);
  assert.deepEqual(commands[1].params,{windowId:7,bounds:{windowState:'normal'}});
  assert.equal(front,1);assert.equal(detached,1);
});
