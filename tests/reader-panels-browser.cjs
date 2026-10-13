// Secondary-surface regression on a fresh loopback origin. Firebase is disabled.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'english-study-panels-'));
fs.mkdirSync(out,{recursive:true});
const routes=[['articleRecordsOpen','articleRecordsDialog'],['contextOpen','contextDialog'],['editorOpen','editorDialog'],['quizOpen','quizDialog'],['toolsRound','roundDialog'],['toolsPending','pendingDialog'],['toolsLookup','lookupDialog'],['queueOpen','queueDialog'],['toolsInsight','insightDialog'],['importButton','libraryDialog'],['toolsBackup','backupDialog'],['cloudButton','cloudDialog'],['saveStatus','saveDialog'],['sourceTrust','trustDialog']];
const errors=[],warnings=[],checks=[];let browser,origin;
const server=http.createServer((q,r)=>{const u=new URL(q.url,'http://localhost');if(u.pathname==='/firebase-config.js'){r.setHeader('Content-Type','text/javascript');return r.end('window.ENGLISH_STUDY_FIREBASE=null;');}if(u.pathname==='/favicon.ico'){r.writeHead(204);return r.end();}const file=path.resolve(repo,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(repo+'/')){r.writeHead(403);return r.end();}fs.readFile(file,(e,b)=>{if(e){r.writeHead(404);return r.end();}r.setHeader('Content-Type',({js:'text/javascript',css:'text/css',html:'text/html',json:'application/json'})[file.split('.').at(-1)]||'application/octet-stream');r.end(b);});});
async function ready(p){await p.waitForFunction(()=>window.StudyReaderAPI&&StudyState.status().phase==='saved');await p.waitForTimeout(120);}
async function observe(p){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});await p.goto(origin+'/#article-02');await ready(p);}
async function open(p,id,dialog){await p.locator('#toolsButton').click();await p.locator('#'+id).click();await p.locator('#'+dialog).waitFor({state:'visible'});assert.equal(await p.locator('dialog[open]').count(),1);}
async function close(p,id){await p.locator('#'+id+' .close-dialog').click();assert.equal(await p.locator('dialog[open]').count(),0);}
async function theme(p,value){await p.locator('#settingsButton').click();await p.locator('.theme-options label').filter({has:p.locator('[value='+value+']')}).click();await close(p,'settingsDialog');await ready(p);}
async function fit(p,dialog){const x=await p.locator('#'+dialog).evaluate(d=>{const r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:d.scrollWidth-d.clientWidth,vw:innerWidth,vh:innerHeight};});assert.ok(x.left>=-1&&x.right<=x.vw+1&&x.top>=-1&&x.bottom<=x.vh+1,JSON.stringify(x));assert.ok(x.overflow<=1,'horizontal dialog overflow '+dialog+' '+JSON.stringify(x));}
async function test(name,fn){await fn();checks.push({name,pass:true});console.log('PASS',name);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ENGLISH_STUDY_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1536,height:1024},serviceWorkers:'block'}),p=await context.newPage();await observe(p);
 await test('all existing secondary tools open the correct native dialog with one live control and no changed learning records',async()=>{
  assert.match(await p.title(),/English Study/);assert.ok((await p.locator('#englishBody').innerText()).length>500);
  const before=await p.evaluate(()=>JSON.stringify({learning:StudyState.get('learning'),extra:StudyState.get('extra')}));
  await p.locator('#toolsButton').click();assert.equal(await p.locator('#toolsDialog .panel-menu-group').count(),3);assert.equal(await p.locator('#toolsDialog .panel-menu-item').count(),14);assert.ok(await p.locator('#cloudButton .panel-menu-text').evaluate(e=>e.clientWidth>100));await p.screenshot({path:path.join(out,'more-desktop.png')});await close(p,'toolsDialog');
  for(const [id,dialog]of routes){assert.equal(await p.locator('#'+id).count(),1);await open(p,id,dialog);await fit(p,dialog);await close(p,dialog);}
  assert.equal(await p.evaluate(()=>JSON.stringify({learning:StudyState.get('learning'),extra:StudyState.get('extra')})),before);
 });
 await test('reading views and existing keyboard navigation retain selected state after menu regrouping',async()=>{
  await p.locator('#toolsButton').click();await p.locator('#tab-vocabulary').click();assert.ok(await p.locator('#panel-vocabulary').isVisible());assert.equal(await p.locator('#tab-vocabulary').getAttribute('aria-selected'),'true');
  await p.locator('#toolsButton').click();await p.locator('#tab-vocabulary').focus();await p.keyboard.press('Home');assert.ok(await p.locator('#panel-reading').isVisible());assert.equal(await p.locator('#tab-reading').getAttribute('aria-selected'),'true');
 });
 await test('Aa auxiliary buttons do not submit the dialog and existing preferences persist',async()=>{
  await p.locator('#settingsButton').click();await p.locator('#themeButton').click();assert.ok(await p.locator('#settingsDialog').isVisible());await p.locator('#focusButton').click();assert.ok(await p.locator('#settingsDialog').isVisible());assert.equal(await p.locator('#focusButton').getAttribute('aria-pressed'),'true');await p.locator('#focusButton').click();await p.locator('#guessMode').check();await p.locator('#highlightWords').selectOption('saved');
  await p.screenshot({path:path.join(out,'aa-desktop-dark.png')});await p.locator('#settingsDialog .settings-footer .primary-button').click();await ready(p);assert.equal(await p.locator('dialog[open]').count(),0);assert.equal(await p.evaluate(()=>StudyState.get('learning').guessMode),true);assert.equal(await p.evaluate(()=>StudyState.get('reader').settings.highlightMode),'saved');
  await p.locator('#settingsButton').click();await p.locator('#guessMode').uncheck();await close(p,'settingsDialog');await theme(p,'light');
 });
 await test('search, editor draft and backup actions retain their real behaviour inside the restyled panels',async()=>{
  await open(p,'contextOpen','contextDialog');await p.locator('#contextQuery').fill('resident');await p.waitForFunction(()=>document.querySelector('#contextResults').textContent.includes('resident'));await p.screenshot({path:path.join(out,'context-desktop.png')});await close(p,'contextDialog');
  await open(p,'editorOpen','editorDialog');const title=await p.locator('#editTitle').inputValue();await p.locator('#editTitle').fill(title+' QA draft');await p.locator('#editPreview').click();assert.ok(await p.locator('#editorPreview').isVisible());assert.equal(await p.locator('#articleTitle').innerText(),title);await p.locator('#editDiscard').click();assert.equal(await p.locator('#editTitle').inputValue(),title);await p.locator('#editorDialog').evaluate(d=>d.scrollTop=0);await p.screenshot({path:path.join(out,'editor-desktop.png')});await close(p,'editorDialog');
  await open(p,'toolsBackup','backupDialog');const download=p.waitForEvent('download');await p.locator('#backupDownload').click();const file=await download;const destination=path.join(out,'synthetic-backup.json');await file.saveAs(destination);const backup=JSON.parse(fs.readFileSync(destination));assert.ok(require('../workspace-core').validateBackup(backup).ok);assert.equal(backup.version,1);await close(p,'backupDialog');
 });
 await test('long panels retain a visible close control and native foldouts work with keyboard',async()=>{
  await open(p,'editorOpen','editorDialog');const summary=p.locator('#editorDialog > details > summary').first();await summary.focus();await p.keyboard.press('Enter');assert.ok(await summary.evaluate(e=>e.parentElement.open));await p.keyboard.press('Enter');assert.equal(await summary.evaluate(e=>e.parentElement.open),false);
  await p.locator('#editorDialog').evaluate(d=>d.scrollTop=d.scrollHeight);const box=await p.locator('#editorDialog .close-dialog').boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=1024);await close(p,'editorDialog');
 });
 await test('phone and tablet light/dark panels fit, retain touch-sized controls and avoid iOS zoom-sized text inputs',async()=>{
  const mobile=await browser.newContext({viewport:{width:428,height:926},isMobile:true,hasTouch:true,serviceWorkers:'block'}),m=await mobile.newPage();await observe(m);
  for(const viewport of [{width:428,height:926},{width:375,height:812},{width:810,height:1080},{width:1080,height:810},{width:926,height:428}]){
   await m.setViewportSize(viewport);await m.waitForTimeout(160);
   for(const t of ['light','dark']){
    await theme(m,t);await m.locator('#settingsButton').click();await fit(m,'settingsDialog');assert.equal(await m.locator('#highlightWords').evaluate(e=>getComputedStyle(e).fontSize),'16px');await close(m,'settingsDialog');
    for(const [id,dialog]of [['toolsBackup','backupDialog'],['contextOpen','contextDialog'],['editorOpen','editorDialog'],['importButton','libraryDialog'],['cloudButton','cloudDialog']]){
     await open(m,id,dialog);await fit(m,dialog);const closeBox=await m.locator('#'+dialog+' .close-dialog').boundingBox();assert.ok(closeBox.width>=44&&closeBox.height>=44);if(viewport.width===428&&t==='dark'&&dialog==='backupDialog')await m.screenshot({path:path.join(out,'backup-phone-dark.png')});await close(m,dialog);
    }
    await m.locator('#toolsButton').click();await fit(m,'toolsDialog');if(viewport.width===428&&t==='light')await m.screenshot({path:path.join(out,'more-phone.png')});await close(m,'toolsDialog');
   }
  }
  await mobile.close();
 });
 await test('reduced motion, narrow desktop and night theme keep legible controls without horizontal scrolling',async()=>{
  await p.emulateMedia({reducedMotion:'reduce'});await p.setViewportSize({width:535,height:800});await theme(p,'dark');await open(p,'toolsRound','roundDialog');await fit(p,'roundDialog');await close(p,'roundDialog');await p.locator('#settingsButton').click();await fit(p,'settingsDialog');assert.ok(await p.locator('#themeButton').evaluate(e=>getComputedStyle(e,'::after').content.includes('浅色')));await close(p,'settingsDialog');
 });
 assert.deepEqual(errors,[]);assert.ok(warnings.every(w=>w.includes('Service Worker registration blocked by Playwright')));fs.writeFileSync(path.join(out,'panels-results.json'),JSON.stringify({origin,checks,errors,warnings,browser:'Chromium; Browser plugin not available'},null,2));console.log(checks.length+' secondary panel browser groups passed');await context.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
