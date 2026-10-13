// Isolated native Chromium UI regression. Only public source and synthetic personal records.
const fs=require('fs'),path=require('path'),http=require('http'),vm=require('vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'english-study-v2-'));
const C=require('../workspace-core'),P=require('../package-core'),L=require('../learning-core'),E=require('../experience-core');
const raw={window:{}};vm.runInNewContext(fs.readFileSync(path.join(repo,'content.js'),'utf8'),raw);
const data=C.remapOriginal(P.validate(C.originalPack(raw.window.READING_DATA)).compiled),article=data.articles[1];
const learning=L.empty(),extra=C.emptyExtra();
for(const word of ['collaborative','resident','dispute'])learning.cards.push(L.usage(data,word,data.words[word].uses.find(u=>u.article===2)));
const note=L.articleSentences(article).find(s=>s.en==='Neither group had universal support.');
L.saveNote(learning,note,'两组都没有获得普遍支持。',['否定'],'这里的 neither 表示两者都不，要结合整句理解。');
E.capture(extra,L.articleSentences(article).find(s=>s.paragraph===0));
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/firebase-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.ENGLISH_STUDY_FIREBASE=null;');return;}const f=path.resolve(repo,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!f.startsWith(repo+'/')){res.writeHead(403);return res.end();}fs.readFile(f,(e,b)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({js:'text/javascript',css:'text/css',html:'text/html',json:'application/json'})[f.split('.').at(-1)]||'application/octet-stream');res.end(b);});});
let browser,origin;const checks=[],errors=[];
async function ready(p){await p.waitForFunction(()=>window.StudyReaderAPI&&window.StudyWorkspaceAPI&&StudyState.status().phase==='saved');await p.waitForTimeout(180);}
async function toolbar(p,id){const r=await p.locator('#'+id).boundingBox();assert.ok(r&&r.y>=0);await p.mouse.click(r.x+r.width/2,r.y+r.height/2);}
async function menu(p,id){if(await p.locator('#'+id).isHidden())await p.locator('#toolsButton').click();await p.locator('#'+id).click();}
async function ack(p){await p.evaluate(async()=>{const tasks=[];document.dispatchEvent(new CustomEvent('study-state-reloaded',{detail:{waitUntil:t=>tasks.push(t)}}));await Promise.all(tasks);});}
async function test(name,fn){await fn();checks.push({name,pass:true});console.log('PASS',name);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ENGLISH_STUDY_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1536,height:1024},serviceWorkers:'block'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await test('quiet opening has no persistent directory, footer, private sample records or hidden duplicate controls',async()=>{
  await p.goto(origin+'/#article-02');await ready(p);assert.equal(await p.locator('#sidebar').isVisible(),false);assert.equal(await p.locator('.prev-button,.next-button').count(),0);assert.equal(await p.locator('#marginLeft').isVisible(),false);
  assert.equal(await p.locator('#readButton').evaluate(b=>b.getBoundingClientRect().top>innerHeight),true);assert.equal(await p.locator('#readButton').evaluate(b=>getComputedStyle(b).position),'static');
  assert.equal(await p.locator('.topbar button:visible').count(),4);assert.equal(await p.locator('#saveStatus').count(),1);assert.equal(await p.locator('#wordPopover').count(),1);
  await p.locator('#directoryButton').click();assert.equal(await p.locator('#sidebar').isVisible(),true);await p.keyboard.press('Escape');assert.equal(await p.locator('#sidebar').isVisible(),false);
 });
 await test('existing cards and personal notes project into margins without changing their snapshots',async()=>{
  await p.evaluate(async({learning,extra})=>{StudyState.set('learning',learning);StudyState.set('extra',extra);const r=StudyState.get('reader');StudyState.set('reader',{...r,settings:{...r.settings,theme:'light',fontSize:26,lineHeight:1.85}});await StudyState.flush();},{learning,extra});await ack(p);
  assert.equal(await p.locator('#marginLeft [data-margin-kind=card]').count(),3);assert.equal(await p.locator('.margin-note').count(),1);assert.equal(await p.locator('#marginLeft').innerText().then(s=>s.includes('纠纷')),false);
  await p.locator('#paragraph-0 [data-word=renovation]').click();assert.equal(await p.locator('#wordDock #wordPopover').count(),1);assert.equal(await p.locator('#popoverSense').innerText(),'翻新');
  await p.screenshot({path:path.join(out,'v2-desktop-day.png')});
  await p.locator('#closeWord').click();await p.locator('#marginLeft [data-margin-kind=card]').first().click();assert.equal(await p.locator('#popoverWord').innerText(),'dispute');assert.equal(await p.locator('#popoverSense').innerText(),'纠纷');await p.locator('#closeWord').click();
  await p.locator('.annotation-text summary').click();assert.equal(await p.locator('.annotation-text').evaluate(e=>e.open),true);await p.locator('.annotation-text summary').click();assert.equal(await p.locator('.annotation-text').evaluate(e=>e.open),false);
 });
 await test('night theme preserves anchors and the same single word control',async()=>{
  await p.locator('#settingsButton').click();await p.locator('.theme-options label').filter({has:p.locator('[value=dark]')}).click();await p.locator('#settingsDialog .close-dialog').click();await p.locator('#paragraph-0 [data-word=renovation]').click();await p.screenshot({path:path.join(out,'v2-desktop-night.png')});assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');assert.equal(await p.locator('#wordPopover').count(),1);
  await p.locator('#settingsButton').click();await p.locator('.theme-options label').filter({has:p.locator('[value=light]')}).click();await p.locator('#settingsDialog .close-dialog').click();
 });
 await test('guess-first mode does not reveal the answer and self-rating still persists',async()=>{
  await p.locator('#settingsButton').click();await p.locator('#guessMode').check();await p.locator('#settingsDialog .close-dialog').click();await p.locator('#paragraph-0 [data-word=renovation]').click();assert.equal(await p.locator('#wordAnswer').isVisible(),false);await p.locator('#wordGuess').fill('翻新');await p.locator('#revealWord').click();assert.equal(await p.locator('#wordAnswer').isVisible(),true);await p.locator('.word-details > summary').click();await p.locator('[data-rating=known]').click();await ready(p);const a=await p.evaluate(()=>StudyState.get('learning').attempts);assert.ok(Object.values(a).some(r=>r.guess==='翻新'&&r.rating==='known'));
  await p.locator('#closeWord').click();await p.locator('#settingsButton').click();await p.locator('#guessMode').uncheck();await p.locator('#settingsDialog .close-dialog').click();
 });
 await test('paragraph and whole translations are independent and preserve the English character anchor',async()=>{
  await p.evaluate(()=>scrollTo(0,500));await p.waitForTimeout(450);const before=await p.evaluate(()=>StudyState.get('reader').anchorKeys['original/2']);
  await toolbar(p,'translateAll');await p.waitForTimeout(220);assert.equal(await p.locator('.inline-translation:visible').count(),await p.locator('.paragraph').count());assert.equal(await p.locator('#translateAll').getAttribute('aria-pressed'),'true');
  const after=await p.evaluate(a=>{const p=document.querySelector('#paragraph-'+a.paragraph+' > p'),w=document.createTreeWalker(p,4);let n,offset=a.offset;while(n=w.nextNode()){if(offset<n.length){const r=document.createRange();r.setStart(n,offset);r.setEnd(n,offset+1);return r.getBoundingClientRect().top;}offset-=n.length;}},before);assert.ok(Math.abs(after-before.viewportOffset)<35,JSON.stringify({before,after,scroll:await p.evaluate(()=>scrollY)}));
  await toolbar(p,'translateAll');assert.equal(await p.locator('.inline-translation:visible').count(),0);await p.locator('[data-translate="1"]').click();assert.equal(await p.locator('.inline-translation:visible').count(),1);assert.equal(await p.locator('#translateAll').getAttribute('aria-pressed'),'false');await p.locator('[data-translate="1"]').click();
 });
 await test('margin note edits reuse the old sentence record and return to the same article',async()=>{
  await p.locator('.annotation-text summary').click();await p.locator('.margin-note [data-margin-kind=note]').click();assert.equal(await p.locator('#sentenceEnglish').innerText(),note.en);assert.equal(await p.locator('#sentenceOwn').inputValue(),learning.notes[0].own);await p.locator('#sentenceReason').fill('新的个人批注');await p.locator('#revealSentence').click();await p.locator('#saveSentence').click();await ready(p);await p.locator('#backToReading').click();await p.waitForTimeout(160);assert.ok(await p.locator('#marginNotes').innerText().then(s=>s.includes('新的个人批注')));assert.equal((await p.evaluate(()=>StudyState.get('learning').notes)).length,1);
 });
 await test('historical snapshots stay accessible while orphan notes never attach to unrelated revised text',async()=>{
  await p.evaluate(async()=>{const l=structuredClone(StudyState.get('learning'));l.notes[0].en='A removed sentence.';l.notes[0].id='orphan-note';StudyState.set('learning',l);await StudyState.flush();});await ack(p);assert.equal(await p.locator('.margin-note').count(),0);await menu(p,'articleRecordsOpen');await p.locator('#articleRecordsBody .record-detail').filter({hasText:'A removed sentence.'}).locator('summary').click();assert.ok(await p.locator('#articleRecordsBody').innerText().then(s=>s.includes('新的个人批注')));await p.locator('#articleRecordsDialog .close-dialog').click();assert.equal(await p.locator('#toolsDialog').evaluate(d=>d.open),true);await p.locator('#toolsDialog .close-dialog').click();
 });
 await test('more menu retains import, backup, quiz, task and revision entry points; mark-read does not navigate',async()=>{
  for(const [id,dialog] of [['importButton','libraryDialog'],['toolsBackup','backupDialog'],['editorOpen','editorDialog'],['queueOpen','queueDialog'],['quizOpen','quizDialog'],['toolsLookup','lookupDialog']]){await menu(p,id);assert.equal(await p.locator('#'+dialog).isVisible(),true);await p.locator('#'+dialog+' .close-dialog').click();if(await p.locator('#toolsDialog').evaluate(d=>d.open))await p.locator('#toolsDialog .close-dialog').click();}
  const key=await p.evaluate(()=>StudyState.get('reader').currentKey);await p.locator('#readButton').click();await ready(p);assert.equal(await p.evaluate(()=>StudyState.get('reader').currentKey),key);assert.equal(await p.locator('#readButton').getAttribute('aria-pressed'),'true');await p.screenshot({path:path.join(out,'v2-article-end.png')});
 });
 await test('mobile and tablet retain records in menu, single overlay and no horizontal overflow',async()=>{
  for(const width of [390,360,768,1024]){
   await p.setViewportSize({width,height:844});await p.waitForTimeout(300);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await p.locator('#marginLeft').isVisible(),false);await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(260);await p.locator('#paragraph-0 [data-word=renovation]').click();assert.equal(await p.locator('#wordPopover').evaluate(e=>e.parentElement===document.body),true);assert.equal(await p.locator('#wordPopover').isVisible(),true);await p.locator('#closeWord').click();await menu(p,'articleRecordsOpen');assert.equal(await p.locator('#articleRecordsBody [data-margin-kind=card]').count(),3);await p.locator('#articleRecordsDialog .close-dialog').click();assert.equal(await p.locator('#toolsDialog').evaluate(d=>d.open),true);await p.locator('#toolsDialog .close-dialog').click();
   if(width===390)await p.screenshot({path:path.join(out,'v2-mobile.png')});
  }
 });
 await test('margin reload consumer failure is acknowledged, blocks writes and recovers on retry',async()=>{
  await p.setViewportSize({width:1536,height:1024});const b=await context.newPage();await b.goto(origin+'/#article-07');await ready(b);await p.evaluate(()=>{window.__marginOriginal=StudyReaderLayoutCore.records;StudyReaderLayoutCore.records=()=>{throw Error('injected margin refresh failure');};});await b.locator('#readButton').click();await ready(b);await p.waitForFunction(()=>StudyState.status().phase==='error');assert.equal(await p.locator('#readingSaveNotice').isVisible(),true);assert.equal(await p.evaluate(()=>{try{StudyState.set('reader',{});return false;}catch{return true;}}),true);
  await p.evaluate(()=>StudyReaderLayoutCore.records=window.__marginOriginal);await p.locator('#readingSaveRetry').click();await p.locator('#saveRetry').click();await ready(p);await p.locator('#saveDialog .close-dialog').click();assert.equal(await p.locator('#readingSaveNotice').isVisible(),false);assert.ok(await p.evaluate(()=>StudyState.get('reader').readKeys.includes('original/7')));await b.close();
 });
 await test('local projection failure reports display failure accurately and retries without changing committed data',async()=>{
  const isolated=await browser.newContext({viewport:{width:1536,height:1024},serviceWorkers:'block'}),local=await isolated.newPage();local.on('pageerror',e=>errors.push(e.message));await local.goto(origin+'/#article-02');await ready(local);
  await local.evaluate(async()=>{window.__marginOriginal=StudyReaderLayoutCore.records;StudyReaderLayoutCore.records=()=>{throw Error('injected local margin failure');};const l=structuredClone(StudyState.get('learning'));l.drafts['v2-local-probe']={own:'durable synthetic draft',categories:[]};StudyState.set('learning',l);await StudyState.flush();});
  assert.equal(await local.evaluate(()=>StudyState.status().phase),'saved');assert.ok(await local.locator('#readingSaveMessage').innerText().then(s=>s.includes('记录已保存在本机')));const token=await local.evaluate(async()=>(await StudyState.readSync()).token);await local.evaluate(()=>StudyReaderLayoutCore.records=window.__marginOriginal);await local.locator('#readingSaveRetry').click();assert.equal(await local.locator('#readingSaveNotice').isVisible(),false);assert.equal(await local.evaluate(async()=>(await StudyState.readSync()).token),token);await isolated.close();
 });
 await test('Chromium touch emulation can open directory, check a word and expand a single paragraph',async()=>{
  const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),t=await touch.newPage();t.on('pageerror',e=>errors.push(e.message));await t.goto(origin+'/#article-02');await ready(t);await t.locator('#directoryButton').tap();await t.locator('#closeDirectory').tap();await t.locator('#paragraph-0 [data-word=renovation]').tap();assert.equal(await t.locator('#popoverSense').innerText(),'翻新');await t.locator('#closeWord').tap();await t.locator('[data-translate="0"]').tap();assert.equal(await t.locator('#inline-translation-0').isVisible(),true);assert.ok(await t.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await touch.close();
 });
 assert.deepEqual(errors,[]);await context.close();console.log(JSON.stringify({browser:browser.version(),checks,errors},null,2));
})().catch(e=>{process.exitCode=1;console.error(e);checks.push({name:'failure',pass:false,error:e.stack});}).finally(async()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'v2-results.json'),JSON.stringify({checks,errors},null,2));await browser?.close();server.close();});
