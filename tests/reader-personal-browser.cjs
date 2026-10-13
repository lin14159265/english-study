// Isolated Chromium regression: public articles and synthetic personal records only.
const fs=require('fs'),path=require('path'),http=require('http'),vm=require('vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'english-study-personal-'));
fs.mkdirSync(out,{recursive:true});
const C=require('../workspace-core'),P=require('../package-core'),L=require('../learning-core');
const source={window:{}};vm.runInNewContext(fs.readFileSync(path.join(repo,'content.js'),'utf8'),source);
const data=C.remapOriginal(P.validate(C.originalPack(source.window.READING_DATA)).compiled);
const value=data.words.value.uses,card=L.usage(data,'value',value[0]);
const late=JSON.parse(fs.readFileSync(path.join(repo,'downloads/pack-template.json'),'utf8'));late.id='late';late.articles[0].paragraphs[0].en+=' The team discussed their study plans carefully.'.repeat(40);delete late.articles[0].paragraphs[0].sentences;const lateKey='late/'+late.articles[0].id;
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/firebase-config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.ENGLISH_STUDY_FIREBASE=null;');}const f=path.resolve(repo,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!f.startsWith(repo+'/')){res.writeHead(403);return res.end();}fs.readFile(f,(e,b)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({js:'text/javascript',css:'text/css',html:'text/html',json:'application/json'})[f.split('.').at(-1)]||'application/octet-stream');res.end(b);});});
const checks=[],errors=[];let browser,origin;
async function ready(p){await p.waitForFunction(()=>window.StudyReaderAPI&&StudyState.status().phase==='saved');await p.waitForTimeout(200);}
async function ack(p){await p.evaluate(async()=>{const jobs=[];document.dispatchEvent(new CustomEvent('study-state-reloaded',{detail:{waitUntil:job=>jobs.push(job)}}));await Promise.all(jobs);});}
async function mode(p,m){await p.locator('#settingsButton').click();await p.locator('#highlightWords').selectOption(m);await p.locator('#settingsDialog .close-dialog').click();await ready(p);}
async function go(p,id){await p.goto(origin+'/#article-'+String(id).padStart(2,'0'));await ready(p);}
async function decoration(locator){return locator.evaluate(el=>getComputedStyle(el).textDecorationLine);}
async function test(name,fn){await fn();checks.push({name,pass:true});console.log('PASS',name);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ENGLISH_STUDY_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1536,height:1024},serviceWorkers:'block'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await test('three modes render real underlines while unmarked words remain clickable and new saves/removals refresh immediately',async()=>{
  await go(p,2);assert.match(await p.title(),/English Study/);assert.ok(await p.locator('#englishBody').innerText());assert.equal(await p.locator('#sidebar').isVisible(),false);
  assert.equal(await decoration(p.locator('.target').first()),'underline');await mode(p,'saved');assert.equal(await p.locator('.target.my-vocabulary').count(),0);assert.equal(await decoration(p.locator('.target').first()),'none');
  const resident=p.locator('#englishBody .target[data-word=resident]').first();await resident.click();assert.equal(await p.locator('#popoverWord').innerText(),'resident');await p.locator('#saveWord').click();await ready(p);assert.equal(await decoration(resident),'underline');assert.ok(await resident.evaluate(e=>e.classList.contains('my-vocabulary')));
  await p.locator('#saveWord').click();await ready(p);assert.equal(await decoration(resident),'none');await p.locator('#closeWord').click();
  await mode(p,'none');assert.equal(await decoration(p.locator('.target').first()),'none');await p.locator('.target').first().click();assert.ok(await p.locator('#wordPopover').isVisible());await p.locator('#closeWord').click();
 });
 await test('saved senses mark equivalent uses across articles without marking a different meaning; mode survives reopening',async()=>{
  await p.evaluate(async card=>{const learning=StudyState.get('learning');learning.cards=[card];StudyState.set('learning',learning);await StudyState.flush();},card);await ack(p);await mode(p,'saved');
  await go(p,value[0].article);const first=p.locator('#paragraph-'+value[0].paragraph+' .target[data-word=value]').first();assert.equal(await decoration(first),'underline');
  await go(p,value[1].article);const other=p.locator('#paragraph-'+value[1].paragraph+' .target[data-word=value]').first();assert.equal(await decoration(other),'none');assert.equal(await p.evaluate(()=>StudyState.get('reader').settings.highlightMode),'saved');
 });
 await test('recent list is bounded, persists and restores the chosen stable article position without disrupting fixed links or filters',async()=>{
  for(const id of [2,3,4,5,6,7])await go(p,id);
  await p.evaluate(()=>scrollTo(0,520));await p.waitForTimeout(450);await p.evaluate(()=>StudyReaderAPI.checkpoint());const old=await p.evaluate(()=>StudyState.get('reader').positionKeys['original/7']);assert.ok(old>400);
  await go(p,2);assert.match(p.url(),/#article-02$/);assert.equal(await p.evaluate(()=>StudyState.get('reader').positionKeys['original/7']),old);
  await p.locator('#directoryButton').click();assert.equal(await p.locator('#recentReadings a').count(),5);assert.equal(await p.locator('#recentReadings a').first().getAttribute('data-recent-key'),'original/2');await p.screenshot({path:path.join(out,'recent-desktop.png')});
  await p.locator('#recentReadings [data-recent-key="original/7"]').click();await ready(p);assert.match(p.url(),/#article-07$/);assert.ok(Math.abs(await p.evaluate(()=>scrollY)-old)<100);
  await p.locator('#directoryButton').click();await p.locator('#articleSearch').fill('no-such-article');assert.equal(await p.locator('#recentReadings').count(),0);await p.locator('#articleSearch').fill('');assert.equal(await p.locator('#recentReadings a').count(),5);await p.locator('#closeDirectory').click();
 });
 await test('another tab updates saved markers and recent entries without moving the open article',async()=>{
  await go(p,2);const b=await context.newPage();b.on('pageerror',e=>errors.push(e.message));await go(b,2);await b.locator('.target[data-word=resident]').first().click();await b.locator('#saveWord').click();await ready(b);
  await p.waitForFunction(()=>!!document.querySelector('.target[data-word=resident].my-vocabulary'));assert.equal(await decoration(p.locator('.target[data-word=resident]').first()),'underline');
  await go(b,9);await p.waitForFunction(()=>!!StudyState.get('reader').visitKeys['original/9']);assert.match(p.url(),/#article-02$/);await p.locator('#directoryButton').click();assert.ok(await p.locator('#recentReadings [data-recent-key="original/9"]').count());await p.locator('#closeDirectory').click();await b.close();
 });
 await test('missing article history remains visible and becomes actionable after delayed source restoration',async()=>{
  await p.evaluate(async key=>{const reader=StudyState.get('reader');reader.visitKeys={[key]:Date.now()+1000};reader.positionKeys[key]=375;reader.resumeKey=key;StudyState.set('reader',reader);await StudyState.flush();},lateKey);await ack(p);
  await p.locator('#directoryButton').click();assert.ok(await p.locator('.recent-unavailable').count());assert.equal(await p.locator('#recentReadings a[href*="late"]').count(),0);await p.locator('#closeDirectory').click();
  await p.evaluate(async pack=>{await StudyState.writePacks(store=>store.put({key:'local:late',source:'local',payload:pack}));await StudyLibrary.reload(await StudyState.packs(),{token:StudyState.libraryVersion()});},late);await ready(p);
  await p.locator('#directoryButton').click();const link=p.locator('#recentReadings [data-recent-key="'+lateKey+'"]');assert.equal(await link.count(),1);await link.click();await ready(p);assert.ok(p.url().endsWith('#read='+encodeURIComponent(lateKey)));assert.ok(Math.abs(await p.evaluate(()=>scrollY)-375)<10);
 });
 await test('old backup settings and position records still load and remain exportable as version 1',async()=>{
  await p.evaluate(async()=>{const reader=StudyState.get('reader');delete reader.settings.highlightMode;reader.settings.highlight=false;StudyState.set('reader',reader);await StudyState.flush();});await ack(p);assert.equal(await decoration(p.locator('.target').first()),'none');
  await p.evaluate(async()=>{const reader=StudyState.get('reader');delete reader.settings.highlightMode;reader.settings.highlight=true;StudyState.set('reader',reader);await StudyState.flush();});await ack(p);assert.equal(await decoration(p.locator('.target').first()),'underline');
  const backup=await p.evaluate(async()=>({format:'english-study-backup',version:1,base:StudyWorkspaceCore.originalPack(READING_DATA),packs:(await StudyState.packs()).filter(r=>r.source==='local').map(r=>r.payload),state:{reader:StudyState.get('reader'),learning:StudyState.get('learning'),extra:StudyState.get('extra')}}));assert.equal(backup.version,1);assert.ok(C.validateBackup(backup).ok);assert.equal(backup.state.reader.positionKeys[lateKey],375);
 });
 await test('desktop, phone and tablet light/dark controls and drawer fit, with unchanged click targets and no body overflow',async()=>{
  await go(p,2);await mode(p,'saved');
  for(const viewport of [{width:2560,height:1600},{width:428,height:926},{width:810,height:1080},{width:1080,height:810},{width:375,height:800}]){
   await p.setViewportSize(viewport);await p.waitForTimeout(250);
   for(const theme of ['light','dark']){
    await p.locator('#settingsButton').click();await p.locator('.theme-options label').filter({has:p.locator('[value='+theme+']')}).click();assert.ok(await p.locator('#highlightWords').isVisible());assert.ok(await p.locator('#highlightWords').evaluate(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth&&r.left>=0;}));await p.locator('#settingsDialog .close-dialog').click();
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(viewport.width===2560&&theme==='light')await p.screenshot({path:path.join(out,'saved-markers-desktop.png')});await p.locator('#directoryButton').click();await p.waitForTimeout(230);const link=p.locator('#recentReadings a').first();assert.ok((await link.boundingBox()).height>=44);assert.ok(await link.evaluate(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth&&r.left>=0;}));
    if(viewport.width===428&&theme==='dark')await p.screenshot({path:path.join(out,'recent-phone-dark.png')});await p.locator('#closeDirectory').click();
   }
  }
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'personal-results.json'),JSON.stringify({origin,checks,errors,browser:'Chromium; Browser plugin not available'},null,2));
 console.log(checks.length+' personal reading browser groups passed');await context.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
