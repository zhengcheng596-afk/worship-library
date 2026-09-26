// Run against a disposable browser profile only. Never points to a personal song library.
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright' : 'playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context = await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
 if(process.env.QA_FONT_CSS) { const css=await fs.readFile(process.env.QA_FONT_CSS,'utf8'); await context.addInitScript(css=>{document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent=css;document.head.append(style)})},css); }
 const page = await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const output=process.env.TEST_OUTPUT || '/tmp/worship-test';await fs.mkdir(output,{recursive:true});
 const url=process.env.TEST_URL || 'http://127.0.0.1:4173/';
 const visible=async text=>{await page.getByText(text,{exact:true}).first().waitFor()};
 const confirm=async()=>page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
 try {
 await page.goto(url);await visible('还没有歌曲');await page.screenshot({path:path.join(output,'home-empty.png'),fullPage:true});
 await page.getByRole('button',{name:'新增第一首歌'}).click();
 await page.getByLabel('歌名 *',{exact:true}).fill('测试歌曲（非真实资料）');
 await page.getByLabel('歌手',{exact:true}).fill('测试歌手');await page.getByLabel('版本',{exact:true}).fill('测试版');
 await page.getByLabel('调性 Key').fill('G');await page.getByLabel('分类',{exact:true}).fill('赞美');await page.getByLabel('主题标签').fill('信靠、恩典');
 await page.getByLabel('中文歌词',{exact:true}).fill('用于验证的中文文本\n第二行测试');await page.getByLabel('英文歌词',{exact:true}).fill('Synthetic test content');
 const wav=Buffer.alloc(16044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
 const fixtures=[{name:'test.wav',mimeType:'audio/wav',buffer:wav},{name:'test.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSynthetic test attachment\n%%EOF')},{name:'test.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.from('Synthetic attachment bytes')}];
 await page.getByLabel('添加附件').setInputFiles(fixtures);await page.getByLabel('test.pdf 类型').selectOption('score');await page.getByRole('button',{name:'保存歌曲',exact:true}).click();await page.getByRole('heading',{name:'测试歌曲（非真实资料）'}).waitFor();
 await page.locator('audio').waitFor();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=1);await page.locator('audio').evaluate(a=>a.play());assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
 await page.getByRole('button',{name:'双语',exact:true}).click();await visible('Synthetic test content');await page.screenshot({path:path.join(output,'song-mobile.png'),fullPage:true});
 // Cancelled attachment deletion must not take effect.
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'移除',exact:true}).first().click();await page.getByRole('button',{name:'取消',exact:true}).click();await confirm();await page.getByRole('button',{name:'下载 test.wav',exact:true}).waitFor();
 await page.getByRole('button',{name:'返回曲库'}).click();await page.getByLabel('搜索歌曲',{exact:true}).fill('第二行测试');await visible('测试歌曲（非真实资料）');await page.getByLabel('分类筛选').selectOption('赞美');await page.getByLabel('主题筛选').selectOption('信靠');await visible('测试歌曲（非真实资料）');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(output,'home-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'备份与恢复',exact:true}).click();const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'导出 .wlib 备份'}).click();const dl=await downloadEvent;const backupPath=path.join(output,'test.wlib');await dl.saveAs(backupPath);const original=await fs.readFile(backupPath);assert.equal(original.subarray(0,8).toString(),'WLIBBK01');
 await page.getByRole('button',{name:'返回曲库'}).click();await page.getByText('测试歌曲（非真实资料）',{exact:true}).click();await page.getByRole('button',{name:'删除歌曲',exact:true}).click();await confirm();await visible('还没有歌曲');
 await page.getByRole('button',{name:'备份与恢复',exact:true}).click();await page.getByLabel('选择备份文件').setInputFiles(backupPath);await page.getByRole('button',{name:'恢复并替换'}).click();await confirm();await visible('恢复完成，歌曲与附件已重新加载。');
 await page.getByRole('button',{name:'返回曲库'}).click();await page.getByText('测试歌曲（非真实资料）',{exact:true}).click();
 for(const fixture of fixtures){const event=page.waitForEvent('download');await page.getByRole('button',{name:`下载 ${fixture.name}`,exact:true}).click();const d=await event;const file=await d.path();assert.deepEqual(await fs.readFile(file),fixture.buffer)}
 // Corrupt payload, retain a valid manifest: CRC failure must leave library intact.
 const corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=255;await page.getByRole('button',{name:'备份与恢复',exact:true}).click();await page.getByLabel('选择备份文件').setInputFiles({name:'corrupt.wlib',mimeType:'application/octet-stream',buffer:corrupt});await page.getByRole('button',{name:'恢复并替换'}).click();await confirm();await page.getByRole('alert').filter({hasText:'校验失败'}).waitFor();
 await page.getByRole('button',{name:'返回曲库'}).click();await page.getByText('测试歌曲（非真实资料）',{exact:true}).click();await page.getByRole('button',{name:'下载 test.pptx',exact:true}).waitFor();
 // A failed OPFS restore write must not replace existing songs or attachments.
 await page.getByRole('button',{name:'备份与恢复',exact:true}).click();await page.getByLabel('选择备份文件').setInputFiles(backupPath);
 await page.evaluate(()=>{window.originalWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=async()=>{throw new DOMException('Injected test quota failure','QuotaExceededError')}});
 await page.getByRole('button',{name:'恢复并替换'}).click();await confirm();await page.getByRole('alert').filter({hasText:'设备存储空间不足'}).waitFor();
 await page.evaluate(()=>{FileSystemFileHandle.prototype.createWritable=window.originalWritable});
 await page.getByRole('button',{name:'返回曲库'}).click();await page.getByText('测试歌曲（非真实资料）',{exact:true}).click();await page.getByRole('button',{name:'下载 test.pptx',exact:true}).waitFor();
 // Successful edit and deferred attachment deletion.
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('备注',{exact:true}).fill('已修改备注');await page.getByRole('button',{name:'移除',exact:true}).last().click();await page.getByRole('button',{name:'保存歌曲',exact:true}).click();await page.getByRole('heading',{name:'测试歌曲（非真实资料）'}).waitFor();await visible('已修改备注');assert.equal(await page.locator('.asset-row').count(),2);
 await page.reload();await page.getByRole('heading',{name:'测试歌曲（非真实资料）'}).waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'测试歌曲（非真实资料）'}).waitFor();await context.setOffline(false);
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks:['empty library','create song','multiple attachments and kinds','audio playback','bilingual lyrics','cancel edit preserves attachment','lyric search and filters','mobile overflow','export backup','delete song','restore backup','restored attachment byte equality','corrupt backup preserves library','reload persistence','offline production app','failed restore write preserves library','edit and deferred attachment deletion'],browser:await browser.version()},null,2));console.log('PASS: 17 browser checks; screenshots and result in '+output);
 }catch(e){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});console.error(errors);throw e}finally{await browser.close()}
})();
