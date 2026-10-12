// Real Chromium engine, emulated device geometry. This is not physical Safari QA.
const fs=require('fs'),path=require('path'),http=require('http'),vm=require('vm'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'english-study-devices-'));
fs.mkdirSync(out,{recursive:true});
const C=require('../workspace-core'),P=require('../package-core'),L=require('../learning-core');
const raw={window:{}};vm.runInNewContext(fs.readFileSync(path.join(repo,'content.js'),'utf8'),raw);
const data=C.remapOriginal(P.validate(C.originalPack(raw.window.READING_DATA)).compiled),article=data.articles[1];
const learning=L.empty(),extra=C.emptyExtra();
for(const [key,word] of Object.entries(data.words))for(const use of word.uses.filter(u=>u.article===2)){
 const card=L.usage(data,key,use);if(card&&!learning.cards.some(c=>c.id===card.id))learning.cards.push(card);
}
const note=L.articleSentences(article).find(s=>s.en==='Neither group had universal support.');
L.saveNote(learning,note,'两组都没有获得普遍支持。',['否定'],'注意两组都不，而不是只有一组。');
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/firebase-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.ENGLISH_STUDY_FIREBASE=null;');return;}
 const f=path.resolve(repo,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!f.startsWith(repo+'/')){res.writeHead(403);return res.end();}
 fs.readFile(f,(e,b)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({js:'text/javascript',css:'text/css',html:'text/html',json:'application/json'})[f.split('.').at(-1)]||'application/octet-stream');res.end(b);});
});
let browser,origin;const checks=[],errors=[];
async function ready(p){await p.waitForFunction(()=>window.StudyReaderAPI&&StudyState.status().phase==='saved');await p.waitForTimeout(220);}
async function seed(p){await p.evaluate(async({learning,extra})=>{StudyState.set('learning',learning);StudyState.set('extra',extra);await StudyState.flush();},{learning,extra});
 await p.evaluate(async()=>{const tasks=[];document.dispatchEvent(new CustomEvent('study-state-reloaded',{detail:{waitUntil:t=>tasks.push(t)}}));await Promise.all(tasks);});}
async function check(name,fn){await fn();checks.push({name,pass:true});console.log('PASS',name);}
async function context(viewport,touch=false,scale=touch?2:1){const c=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,deviceScaleFactor:scale,serviceWorkers:'block'}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#article-02');await ready(p);return {c,p};}
async function fit(p){assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');}
async function popFits(p){const r=await p.locator('#wordPopover').boundingBox(),v=await p.evaluate(()=>({top:visualViewport.offsetTop,height:visualViewport.height,width:visualViewport.width}));assert.ok(r&&r.x>=0&&r.y>=v.top&&r.x+r.width<=v.width+1&&r.y+r.height<=v.top+v.height+1,JSON.stringify({r,v}));}
async function anchorTop(p,a){return p.evaluate(a=>{const el=document.querySelector('#paragraph-'+a.paragraph+' > p'),w=document.createTreeWalker(el,4);let n,o=a.offset;while(n=w.nextNode()){if(o<n.length){const r=document.createRange();r.setStart(n,o);r.setEnd(n,o+1);return r.getBoundingClientRect().top;}o-=n.length;}},a);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ENGLISH_STUDY_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const desktop=await context({width:2560,height:1600}),p=desktop.p;await seed(p);
 await check('16:10 desktop at four scaling equivalents keeps both rails beside the paper and old preferences intact',async()=>{
  for(const [width,height] of [[2560,1600],[2048,1280],[1707,1067],[1463,914]]){
   await p.setViewportSize({width,height});await p.waitForTimeout(220);await p.evaluate(()=>scrollTo(0,0));await fit(p);
   const b=await p.evaluate(()=>{const box=id=>document.querySelector(id).getBoundingClientRect().toJSON();return {paper:box('.reading-column'),left:box('#marginLeft'),right:box('#marginRight'),size:getComputedStyle(document.querySelector('.english-body')).fontSize};});
   assert.ok(Math.abs(b.paper.x-(b.left.x+b.left.width)-36)<2,JSON.stringify(b));assert.ok(Math.abs(b.right.x-(b.paper.x+b.paper.width)-36)<2);assert.equal(b.size,'21px');
   if(width===2560)await p.screenshot({path:path.join(out,'desktop-2560x1600.png')});
  }
  await p.setViewportSize({width:1280,height:1000});await p.waitForTimeout(220);await fit(p);assert.equal(await p.locator('#marginLeft').isVisible(),false);
 });
 await check('idle reading prioritizes genuine nearby cards without changing stored cards or full-history access',async()=>{
  await p.setViewportSize({width:1536,height:1024});await p.waitForTimeout(220);await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(400);
  const before=await p.evaluate(()=>JSON.stringify(StudyState.get('learning'))),last=2;
  await p.evaluate(i=>scrollTo(0,scrollY+document.querySelector('#paragraph-'+i).getBoundingClientRect().top-document.querySelector('.topbar').getBoundingClientRect().bottom-14),last);await p.waitForTimeout(500);
  const ids=await p.locator('#marginLeft [data-margin-kind=card]').evaluateAll(bs=>bs.map(b=>b.dataset.marginId));const byId=new Map(learning.cards.map(c=>[c.id,c]));assert.equal(byId.get(ids[0]).paragraph,last);
  assert.equal(await p.evaluate(()=>JSON.stringify(StudyState.get('learning'))),before);await p.locator('#toolsButton').click();await p.locator('#articleRecordsOpen').click();assert.equal(await p.locator('#articleRecordsBody [data-margin-kind=card]').count(),learning.cards.length);await p.locator('#articleRecordsDialog .close-dialog').click();
  await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(350);await p.locator('#paragraph-0 .target').first().click();await p.screenshot({path:path.join(out,'desktop-day-1536.png')});await p.locator('#closeWord').click();
 });
 const phone=await context({width:428,height:926},true,3),m=phone.p;await seed(m);
 await check('iPhone-sized portrait supports touch lookup, consecutive targets, durable collection and accessible translation controls',async()=>{
  await m.locator('#directoryButton').tap();assert.equal(await m.evaluate(()=>document.activeElement.id),'closeDirectory');await m.locator('#closeDirectory').tap();
  const word=m.locator('#paragraph-0 [data-word=renovation]');await word.tap();await popFits(m);
  const wr=await word.boundingBox(),pr=await m.locator('#wordPopover').boundingBox();assert.ok(pr.y>=wr.y+wr.height||pr.y+pr.height<=wr.y);
  const another=await m.locator('#paragraph-0 .target').evaluateAll((ts,pr)=>ts.find(t=>{const b=t.getBoundingClientRect();return b.top>58&&b.bottom<innerHeight&&(b.bottom<=pr.y||b.top>=pr.y+pr.height)&&t.dataset.word!=='renovation';})?.dataset.word,pr);
  assert.ok(another);await m.locator('#paragraph-0 [data-word="'+another+'"]').first().tap();assert.equal(await m.locator('#popoverWord').innerText(),data.words[another].word);assert.equal(await m.locator('#wordPopover').count(),1);
  await m.locator('#saveWord').tap();await ready(m);assert.equal(await m.locator('#saveWord').getAttribute('aria-pressed'),'false');assert.ok(await m.locator('#toast').innerText().then(t=>t.includes('已移除')));await m.locator('#closeWord').tap();
  const b=await m.locator('[data-translate="0"]').boundingBox();assert.ok(b.width>=44&&b.height>=44);await m.locator('[data-translate="0"]').tap();assert.equal(await m.locator('#inline-translation-0').isVisible(),true);await m.locator('[data-translate="0"]').tap();await fit(m);await m.screenshot({path:path.join(out,'iphone-portrait.png')});
 });
 await check('height-only viewport and keyboard shrink simulations retain lookup, keep input at 16px and fit recovery dialogs',async()=>{
  await m.locator('#settingsButton').tap();await m.locator('#guessMode').check();await m.locator('#settingsDialog .close-dialog').tap();await m.locator('#paragraph-0 .target').first().tap();await m.locator('#wordGuess').fill('暂定理解');
  await m.setViewportSize({width:428,height:520});await m.waitForTimeout(220);assert.equal(await m.locator('#wordPopover').isVisible(),true);assert.equal(await m.locator('#wordGuess').inputValue(),'暂定理解');assert.equal(await m.locator('#wordGuess').evaluate(e=>getComputedStyle(e).fontSize),'16px');await popFits(m);
  await m.setViewportSize({width:428,height:926});await m.waitForTimeout(220);assert.equal(await m.locator('#wordPopover').isVisible(),true);await m.locator('#closeWord').tap();await m.locator('#settingsButton').tap();await m.setViewportSize({width:428,height:520});await m.waitForTimeout(180);const d=await m.locator('#settingsDialog').boundingBox();assert.ok(d.y>=0&&d.y+d.height<=520);await m.locator('#settingsDialog .close-dialog').tap();
  await m.setViewportSize({width:926,height:428});await m.waitForTimeout(250);await fit(m);assert.equal(await m.locator('#marginLeft').isVisible(),false);await m.evaluate(()=>scrollTo(0,0));await m.waitForTimeout(250);await m.locator('#paragraph-0 .target').first().tap();await popFits(m);await m.screenshot({path:path.join(out,'iphone-landscape.png')});await m.locator('#closeWord').tap();
 });
 await check('iPad-sized portrait, landscape and split windows keep touch controls and preserve the semantic sentence after rotation',async()=>{
  const tablet=await context({width:810,height:1080},true),t=tablet.p;await seed(t);
  await t.evaluate(()=>scrollTo(0,520));await t.waitForTimeout(420);const a=await t.evaluate(()=>StudyState.get('reader').anchorKeys['original/2']);assert.ok(a);
  await t.setViewportSize({width:1080,height:810});await t.waitForTimeout(320);assert.ok(Math.abs((await anchorTop(t,a))-a.viewportOffset)<40);assert.equal(await t.locator('#marginLeft').isVisible(),false);
  for(const [width,height,label] of [[810,1080,'portrait'],[1080,810,'landscape'],[535,810,'split'],[375,1080,'narrow-split']]){
   await t.setViewportSize({width,height});await t.waitForTimeout(240);await t.evaluate(()=>scrollTo(0,0));await t.waitForTimeout(220);await fit(t);await t.locator('#paragraph-0 .target').first().tap();await popFits(t);await t.locator('#closeWord').tap();const b=await t.locator('[data-translate="0"]').boundingBox();assert.ok(b.width>=44&&b.height>=44);if(width>=810)await t.screenshot({path:path.join(out,'ipad-'+label+'.png')});
  }
  await tablet.c.close();
 });
 await check('long titles and dense prose wrap, dark text remains readable, and background/reopen retain committed reader state',async()=>{
  await m.setViewportSize({width:428,height:926});await m.waitForTimeout(240);await m.locator('#settingsButton').tap();await m.locator('#guessMode').uncheck();await m.locator('.theme-options label').filter({has:m.locator('[value=dark]')}).tap();await m.locator('#settingsDialog .close-dialog').tap();
  const title=await m.locator('#articleTitle').innerText();await m.locator('#articleTitle').evaluate(e=>e.textContent='How a Neighborhood Can Make Difficult Decisions About the Future of Its Shared Public Spaces');await fit(m);await m.locator('#articleTitle').evaluate((e,title)=>e.textContent=title,title);await m.screenshot({path:path.join(out,'iphone-night.png')});
  const contrasts=await m.evaluate(()=>{const css=getComputedStyle(document.documentElement),lum=s=>{const rgb=s.trim().slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;},bg=lum(css.getPropertyValue('--surface'));return ['--text','--muted'].map(k=>{const fg=lum(css.getPropertyValue(k));return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);});});assert.ok(contrasts.every(r=>r>=4.5));
  await m.evaluate(()=>scrollTo(0,440));await m.waitForTimeout(400);
  const checkpoint=await m.evaluate(async()=>{const old=StudyState.get('reader').anchorKeys['original/2']?.updatedAt;scrollTo(0,scrollY+160);window.dispatchEvent(new Event('scroll'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));await StudyState.flush();delete document.visibilityState;return {old,at:StudyState.get('reader').anchorKeys['original/2']?.updatedAt};});assert.ok(checkpoint.at>checkpoint.old);
  const before=await m.evaluate(()=>({a:StudyState.get('reader').anchorKeys['original/2'],learning:JSON.stringify(StudyState.get('learning')),read:StudyState.get('reader').readKeys}));await m.reload();await ready(m);assert.equal(await m.locator('html').getAttribute('data-theme'),'dark');assert.equal(await m.evaluate(()=>JSON.stringify(StudyState.get('learning'))),before.learning);assert.ok(Math.abs((await anchorTop(m,before.a))-before.a.viewportOffset)<40);await fit(m);
 });
 assert.deepEqual(errors,[]);await desktop.c.close();await phone.c.close();
})().catch(e=>{process.exitCode=1;console.error(e);checks.push({name:'failure',pass:false,error:e.stack});}).finally(async()=>{fs.writeFileSync(path.join(out,'device-results.json'),JSON.stringify({browser:browser?.version(),environment:'Browser plugin not available; existing Playwright + Chromium. Physical iOS Safari not tested.',webkitAvailable:fs.existsSync(webkit.executablePath()),checks,errors},null,2));await browser?.close();server.close();});
