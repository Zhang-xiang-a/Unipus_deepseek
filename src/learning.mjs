// 学习类任务（视频/阅读/词汇卡片）。阅读秒数与词汇按钮文案由调用方从配置传入，
// 这里不再反向读取 config.json。
export async function learnTask({page,type,gate,wait,config,readingSeconds=10,uiTexts={},onProgress}) {
  const start=page.url();
  const check=async()=>{
    await gate();
    if(page.url()!==start)throw new Error('学习期间页面已切换，保留任务断点');
  };
  if(type==='音视频学习') {
    const media=page.locator('main video,main audio').first();
    if(!await media.count())throw new Error('学习页没有可播放媒体');
    await media.evaluate(m=>{m.muted=true;return m.play();});
    let lastTime=-1,stalled=0;
    while(true) {
      // Pausing the runner pauses playback as well.
      if(await config.readCommand()==='pause')await media.evaluate(m=>m.pause());
      await check();
      let state=await media.evaluate(m=>({time:m.currentTime,duration:m.duration,ended:m.ended,paused:m.paused,error:m.error?.message}));
      if(state.error)throw new Error(state.error);
      if(state.ended)return state;
      if(state.paused)await media.evaluate(m=>m.play());
      stalled=state.time===lastTime?stalled+1:0;lastTime=state.time;
      if(stalled>120)throw new Error('媒体停滞超过两分钟');
      await onProgress(state);await wait(1000);
    }
  }
  if(type==='词汇卡片') {
    for(let i=0;i<500;i++) {
      await check();
      const text=await page.locator('main').innerText();
      const counter=text.match(/(\d+)\s*\/\s*(\d+)/);
      if(!counter)throw new Error('未识别词汇卡片计数，停止避免盲目点击');
      await onProgress({card:Number(counter[1]),total:Number(counter[2])});
      const finalCard=Number(counter[1])===Number(counter[2]);
      const complete=page.locator('main .swiper-slide-active').filter({hasText:/已学完全部/});
      if(finalCard && await complete.count())return {cards:Number(counter[2]),completionPage:true};
      const nextLabel = uiTexts.vocabularyNext || '下一个';
      const next=page.locator(`main [title="${nextLabel}"],main [aria-label="${nextLabel}"],main .next`).filter({visible:true});
      if(await next.count()!==1)throw new Error('需现场适配词汇下一个按钮');
      await next.click();await wait(350);
      if(finalCard) {
        if(await page.locator('main .swiper-slide-active').filter({hasText:/已学完全部/}).count())return {cards:Number(counter[2]),completionPage:true};
        throw new Error('最后词汇卡片后未出现学习完成页');
      }
    }
    throw new Error('词汇卡片循环超限');
  }
  let elapsed=0;
  let required=Number(readingSeconds)||10;
  while(true) {
    required=config.readReadingSeconds?await config.readReadingSeconds():required;
    if(!Number.isInteger(required)||required<1||required>3600)throw new Error('阅读停留时间必须为1至3600秒');
    if(elapsed>=required)break;
    await check();await wait(1000);elapsed++;
    await onProgress({elapsed,required});
    if(elapsed%5===0||elapsed===required)console.log(`阅读停留：${elapsed}/${required}秒`);
  }
  return {elapsedSeconds:elapsed,requiredSeconds:required};
}
