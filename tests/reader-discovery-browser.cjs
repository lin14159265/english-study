// Find tools and large learning archives on an isolated origin with synthetic data.
// Browser plugin not available; use the project's existing Playwright installation.
const fs=require('fs'),path=require('path'),http=require('http'),vm=require('vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'english-study-discovery-'));
fs.mkdirSync(out,{recursive:true});
const W=require('../workspace-core'),P=require('../package-core'),L=require('../learning-core');
const source={window:{}};vm.runInNewContext(fs.readFileSync(path.join(repo,'content.js'),'utf8'),source);
vm.runInNewContext(fs.readFileSync(path.join(repo,'practice-content.js'),'utf8'),source);
const data=W.remapOriginal(P.validate(W.originalPack(source.window.READING_DATA,source.window.StudySampleQuestions)).compiled),base=L.usage(data,'value',data.words.value.uses[0]),sentence=L.articleSentences(data.articles[0])[0];
const learning=L.empty();learning.cards=Array.from({length:1000},(_,i)=>({...base,id:'qa-card-'+i,articleTitle:'QA Archive '+String(i).padStart(4,'0'),created:i+1}));
learning.notes=Array.from({length:4},(_,i)=>({...sentence,id:'qa-note-'+i,articleKey:i===3?'missing/source':sentence.articleKey,own:'QA interpretation '+i,reason:'忽略否定 QA',categories:['否定'],resolved:i%2===0,created:i+1,updated:i+1}));
const questions=Array.from({length:4},(_,i)=>({id:'qa-question-'+i,articleKey:data.articles[0].key,articleTitle:'QA quiz '+i,sourceSignature:data.articles[0].sourceSignature,quizSignature:data.articles[0].quizSignature,question:JSON.parse(JSON.stringify(data.articles[0].questions[0])),chosen:'b',resolved:i%2===0,at:'2026-10-13T00:00:00.000Z'}));
const errors=[],checks=[];let browser,origin;
const server=http.createServer((q,r)=>{const u=new URL(q.url,'http://localhost');if(u.pathname==='/firebase-config.js'){r.setHeader('Content-Type','text/javascript');return r.end('window.ENGLISH_STUDY_FIREBASE=null;');}if(u.pathname==='/favicon.ico'){r.writeHead(204);return r.end();}const file=path.resolve(repo,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(repo+'/')){r.writeHead(403);return r.end();}fs.readFile(file,(e,b)=>{if(e){r.writeHead(404);return r.end();}r.setHeader('Content-Type',({js:'text/javascript',css:'text/css',html:'text/html',json:'application/json'})[file.split('.').at(-1)]||'application/octet-stream');r.end(b);});});
async function ready(p){await p.waitForFunction(()=>window.StudyReaderAPI&&StudyState.status().phase==='saved');await p.waitForTimeout(100);}
async function observe(p){p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#article-01');await ready(p);}
async function ack(p){await p.evaluate(async()=>{const jobs=[];document.dispatchEvent(new CustomEvent('study-state-reloaded',{detail:{waitUntil:j=>jobs.push(j)}}));await Promise.all(jobs);});}
async function review(p){await p.locator('#toolsButton').click();await p.locator('#tab-review').click();await p.locator('#panel-review').waitFor({state:'visible'});await ready(p);}
async function seed(p){await p.evaluate(async({learning,questions})=>{StudyState.set('learning',learning);const extra=StudyWorkspaceCore.clone(StudyState.get('extra'));extra.wrongQuestions=questions;StudyState.set('extra',extra);await StudyState.flush();},{learning,questions});await ack(p);await ready(p);}
async function theme(p,value){await p.locator('#settingsButton').click();await p.locator('.theme-options label').filter({has:p.locator('[value='+value+']')}).click();await p.locator('#settingsDialog .close-dialog').click();await ready(p);}
async function test(name,fn){await fn();checks.push({name,pass:true});console.log('PASS',name);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ENGLISH_STUDY_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const c=await browser.newContext({viewport:{width:1536,height:1024},serviceWorkers:'block'}),p=await c.newPage();await observe(p);
 await test('tool search finds aliases, retains tabs and guide, and child close restores the filtered menu',async()=>{
  assert.match(await p.title(),/English Study/);assert.ok((await p.locator('#englishBody').innerText()).length>500);
  const before=await p.evaluate(()=>JSON.stringify({learning:StudyState.get('learning'),extra:StudyState.get('extra')}));
  await p.locator('#toolsButton').click();await p.locator('#toolsSearch').fill('错句');assert.ok(await p.locator('#toolsRound').isVisible());assert.ok(await p.locator('#toolsPending').isVisible());assert.equal(await p.locator('#importButton').isVisible(),false);assert.ok(await p.locator('#tab-review').isVisible());assert.ok(await p.locator('#guideOpen').isVisible());
  await p.locator('#toolsPending').click();await p.locator('#pendingDialog .close-dialog').click();assert.equal(await p.locator('#toolsSearch').inputValue(),'错句');
  await p.locator('#toolsSearch').fill('no-tool-matches');assert.equal(await p.locator('#toolsDialog .panel-menu-group:visible').count(),0);assert.match(await p.locator('#toolsSearchStatus').innerText(),/未找到/);assert.ok(await p.locator('#guideOpen').isVisible());
  await p.locator('#toolsDialog .close-dialog').click();await p.locator('#toolsButton').click();assert.equal(await p.locator('#toolsSearch').inputValue(),'');assert.equal(await p.locator('#toolsDialog .panel-menu-item:visible').count(),14);await p.locator('#toolsSearch').fill('备份');await p.screenshot({path:path.join(out,'tools-search-desktop.png')});await p.locator('#toolsDialog .close-dialog').click();
  assert.equal(await p.evaluate(()=>JSON.stringify({learning:StudyState.get('learning'),extra:StudyState.get('extra')})),before);
 });
 await test('one thousand cards render fifty at first, expand on demand and remain fully saved and exportable',async()=>{
  await seed(p);const before=await p.evaluate(()=>JSON.stringify(StudyState.get('learning')));await review(p);assert.equal(await p.locator('#reviewList .learning-card').count(),50);assert.match(await p.locator('#reviewPageStatus').innerText(),/50 \/ 1000/);
  await p.locator('#hideReviewMeanings').click();await p.locator('#reviewList [data-reveal-card]').first().click();await p.locator('#reviewList .learning-card details>summary').first().click();
  await p.locator('#reviewMore').click();assert.equal(await p.locator('#reviewList .learning-card').count(),100);assert.match(await p.locator('#reviewPageStatus').innerText(),/100 \/ 1000/);assert.ok(await p.locator('#reviewList .card-answer').first().isVisible());assert.ok(await p.locator('#reviewList .learning-card details').first().evaluate(d=>d.open));
  assert.equal(await p.evaluate(()=>JSON.stringify(StudyState.get('learning'))),before);const backup=await p.evaluate(()=>StudyWorkspaceAPI.snapshot());assert.ok(W.validateBackup(backup).ok);assert.equal(backup.state.learning.cards.length,1000);
 });
 await test('archive search checks all saved records beyond the rendered page and supports empty results, removal and undo',async()=>{
  await p.locator('#reviewSearch').fill('0042');assert.equal(await p.locator('#reviewList .learning-card').count(),1);assert.ok(await p.locator('[data-remove-card=qa-card-42]').isVisible());assert.match(await p.locator('#reviewSummary').innerText(),/1 \/ 1000/);assert.equal(await p.locator('#reviewMore').isVisible(),false);
  await p.locator('[data-remove-card=qa-card-42]').click();await ready(p);assert.equal(await p.locator('#reviewList .learning-card').count(),0);await p.locator('#undoLearningRemove').click();await ready(p);assert.equal(await p.locator('#reviewList .learning-card').count(),1);
  await p.locator('#reviewSearch').fill('nothing-in-archive');assert.match(await p.locator('#reviewList').innerText(),/没有找到/);await p.locator('#reviewClear').click();assert.equal(await p.locator('#reviewList .learning-card').count(),50);assert.equal(await p.evaluate(()=>StudyState.get('learning').cards.length),1000);
 });
 await test('unresolved notes and question snapshots filter without deleting history or mixing word filters',async()=>{
  await p.locator('#reviewSentences').click();await p.locator('#reviewUnresolved').check();assert.equal(await p.locator('#reviewList .learning-card').count(),2);assert.ok((await p.locator('#reviewList').innerText()).includes('原资料已移除'));
  await p.locator('#reviewSearch').fill('interpretation 3');assert.equal(await p.locator('#reviewList .learning-card').count(),1);await p.locator('#reviewClear').click();assert.equal(await p.locator('#reviewList .learning-card').count(),4);
  await p.locator('#reviewQuestions').click();await p.locator('#reviewUnresolved').check();assert.equal(await p.locator('#reviewList .learning-card').count(),2);await p.locator('#reviewSearch').fill('quiz 1');assert.equal(await p.locator('#reviewList .learning-card').count(),1);await p.locator('#reviewList [data-resolve-question]').click();await ready(p);assert.equal(await p.locator('#reviewList .learning-card').count(),0);
  await p.locator('#reviewClear').click();assert.equal(await p.locator('#reviewList .learning-card').count(),4);await p.locator('#reviewWords').click();assert.equal(await p.locator('#reviewUnresolvedLabel').isVisible(),false);assert.equal(await p.locator('#reviewList .learning-card').count(),50);
 });
 await test('another tab refreshes a filtered archive without resetting the query or writing stale records',async()=>{
  await p.locator('#reviewSearch').fill('remote archive');assert.equal(await p.locator('#reviewList .learning-card').count(),0);await ready(p);
  const b=await c.newPage();await observe(b);await b.evaluate(async base=>{const l=StudyLearningCore.load(StudyState.get('learning'));l.cards.push({...base,id:'qa-remote',articleTitle:'Remote Archive'});StudyState.set('learning',l);await StudyState.flush();},base);await ready(b);
  try{await p.waitForFunction(()=>document.querySelector('#reviewList [data-remove-card="qa-remote"]'));}catch(error){console.error('Cross-tab diagnostics',JSON.stringify(await p.evaluate(()=>({status:StudyState.status(),count:StudyState.get('learning').cards.length,query:document.querySelector('#reviewSearch').value,summary:document.querySelector('#reviewSummary').textContent,list:document.querySelector('#reviewList').textContent.slice(0,500),remote:StudyState.get('learning').cards.find(c=>c.id==='qa-remote')}))));throw error;}
  assert.equal(await p.locator('#reviewSearch').inputValue(),'remote archive');assert.equal(await p.locator('#reviewList .learning-card').count(),1);assert.equal(await p.evaluate(()=>StudyState.get('learning').cards.length),1001);await b.close();
 });
 await test('a short round still starts, reveals and saves a real judgment after selecting from a large archive',async()=>{
  await p.locator('#reviewRound').click();await p.locator('#roundMode').selectOption('words');await p.locator('#roundSize').selectOption('5');await p.locator('#roundTransfer').check();await p.locator('#roundStart').click();await p.locator('#roundGuess').fill('价值');
  await p.locator('#roundBody [data-round-reveal]').click();await p.locator('#roundBody [data-round-rating=known]').click();await ready(p);
  assert.equal(await p.evaluate(()=>StudyState.get('extra').reviewSession.items.length),5);assert.equal(await p.evaluate(()=>StudyState.get('extra').reviewSession.index),1);assert.equal(await p.evaluate(()=>StudyState.get('learning').cards.length),1001);await p.locator('#roundDialog .close-dialog').click();assert.equal(await p.locator('#reviewSearch').inputValue(),'remote archive');
 });
 await test('touch-sized archive controls and tool search fit phone and tablet light and dark views',async()=>{
  const mobile=await browser.newContext({viewport:{width:428,height:926},isMobile:true,hasTouch:true,serviceWorkers:'block'}),m=await mobile.newPage();await observe(m);await seed(m);
  for(const viewport of [{width:428,height:926},{width:375,height:812},{width:810,height:1080},{width:1080,height:810}]){
   await m.setViewportSize(viewport);for(const t of ['light','dark']){
    await theme(m,t);await m.locator('#toolsButton').click();await m.locator('#toolsSearch').fill('导入');assert.ok(await m.locator('#importButton').isVisible());assert.ok(await m.locator('#toolsSearch').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));await m.locator('#toolsDialog .close-dialog').click();await review(m);
    await m.locator('#reviewWords').click();await m.locator('#reviewSearch').fill('');assert.ok(await m.locator('#reviewSearch').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));const more=await m.locator('#reviewMore').boundingBox();assert.ok(more.height>=44);assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await m.locator('#reviewSearch').fill('0042');if(viewport.width===428)await m.screenshot({path:path.join(out,'review-phone-'+t+'.png')});
   }
  }
  await mobile.close();
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'discovery-results.json'),JSON.stringify({origin,checks,errors,initialCardCount:1000,initialRendered:50,browser:'Chromium; Browser plugin not available'},null,2));console.log(checks.length+' discovery browser groups passed');await c.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
