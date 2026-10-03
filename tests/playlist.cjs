const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
 const context = await browser.newContext({viewport:{width:390,height:844}});
 const page = await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const wav=Buffer.alloc(160044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(160000,40);
 const url=process.env.TEST_URL || 'http://127.0.0.1:4173/';
 const active=()=>page.locator('.now-playing strong').innerText();
 const ready=()=>page.waitForFunction(()=>{const a=document.querySelector('audio');return a?.readyState>=2&&!a.paused});
 const end=async()=>{await ready();await page.locator('audio').evaluate(a=>{a.currentTime=a.duration-.08});};
 try {
 await page.goto(url);await page.getByText('还没有歌曲',{exact:true}).waitFor();
 for(const name of ['测试甲','测试乙','测试丙']){
  await page.getByRole('button',{name:'新增歌曲',exact:true}).click();await page.getByLabel('歌名 *',{exact:true}).fill(name);
  await page.getByLabel('添加附件').setInputFiles({name:name+'.wav',mimeType:'audio/wav',buffer:wav});await page.getByRole('button',{name:'保存歌曲',exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();await page.getByRole('button',{name:'加入播放列表',exact:true}).click();
 }
 await page.getByRole('button',{name:'播放列表',exact:true}).click();await page.getByRole('heading',{name:'播放列表',exact:true}).waitFor();assert.equal(await page.locator('.playlist-items li').count(),3);
 await page.getByRole('button',{name:'播放列表',exact:true}).last().click();await ready();assert.equal(await active(),'测试甲');
 await page.getByRole('button',{name:'返回曲库'}).click();assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
 await end();await page.waitForFunction(()=>document.querySelector('.now-playing strong')?.textContent==='测试乙');await ready();
 await page.getByRole('button',{name:'下一首',exact:true}).click();await ready();assert.equal(await active(),'测试丙');
 await page.getByRole('button',{name:'上一首',exact:true}).click();await ready();assert.equal(await active(),'测试乙');
 await page.getByRole('button',{name:'播放列表',exact:true}).first().click();await page.getByRole('button',{name:'上移 测试丙'}).click();assert.equal(await page.locator('.playlist-items li strong').nth(1).innerText(),'测试丙');
 await page.getByLabel('播放方式').first().selectOption('shuffle');await page.getByRole('button',{name:'播放列表',exact:true}).last().click();await ready();const heard=[await active()];
 for(let i=0;i<2;i++){await end();await page.waitForFunction(old=>document.querySelector('.now-playing strong')?.textContent!==old,heard.at(-1));await ready();heard.push(await active());}
 assert.equal(new Set(heard).size,3);await end();await page.getByText('播放列表已播放完毕，点击“播放列表”可重新开始。',{exact:true}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'播放列表',exact:true}).waitFor();assert.equal(await page.locator('.playlist-items li').count(),3);assert.equal(await page.getByLabel('播放方式').first().inputValue(),'shuffle');assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
 await page.getByRole('button',{name:'播放 测试甲 测试甲.wav',exact:true}).click();await ready();await page.getByRole('button',{name:'移除 测试甲 测试甲.wav',exact:true}).click();assert.equal(await page.locator('.global-player').isVisible(),false);assert.equal(await page.locator('.playlist-items li').count(),2);
 await page.getByLabel('播放方式').first().selectOption('order');await page.getByRole('button',{name:'播放列表',exact:true}).last().click();await ready();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/worship-playlist-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'返回曲库'}).click();await page.getByRole('link').filter({hasText:'测试甲'}).click();await page.getByRole('heading',{name:'测试甲',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: queue add/order/remove, actual audio playback, route persistence, natural ended transition, previous/next, shuffle without repeats, end-of-list stop, reload persistence, removal preserves song, mobile layout.');
 }finally{await browser.close();}
})();
