// Keep course media silent across task changes without changing playback progress.
export async function muteCourse(page) {
  const install = () => {
    if (window.__runnerMuteInstalled) return;
    window.__runnerMuteInstalled = true;
    const silence = () => {
      for (const media of document.querySelectorAll('video,audio')) {
        if (!media.muted) media.muted = true;
      }
    };
    document.addEventListener('play', e => {
      if(e.target.matches?.('video,audio'))e.target.muted=true;
    }, true);
    new MutationObserver(records => {
      for(const record of records)for(const node of record.addedNodes) {
        if(node.nodeType!==1)continue;
        if(node.matches('video,audio'))node.muted=true;
        for(const media of node.querySelectorAll('video,audio'))media.muted=true;
      }
    }).observe(document, {childList:true,subtree:true});
    silence();
  };
  await page.addInitScript(install);
  for (const frame of page.frames()) await frame.evaluate(install);
}
