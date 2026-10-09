// Optional real Chromium layout checks. Run with an installed Playwright and Chromium;
// all records stay in fresh browser contexts on an isolated loopback origin.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'english-study-position-qa-'));
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost'),file=path.resolve(repo,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(repo+'/')){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,body)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'js':'text/javascript','html':'text/html','css':'text/css','json':'application/json'})[file.split('.').at(-1)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(body);});
});
let browser,origin;const checks=[],errors=[];
async function ready(p){await p.waitForFunction(()=>window.StudyReaderAPI&&window.StudyPositionCore&&StudyState.status().phase==='saved');await p.evaluate(()=>new Promise(resolve=>{let frames=4;const next=()=>--frames?requestAnimationFrame(next):resolve();requestAnimationFrame(next);}));}
async function test(name,run){await run();checks.push({name,pass:true});console.log('PASS',name);}
async function rect(p,anchor){return p.evaluate(a=>{
  const paragraph=document.querySelector('#paragraph-'+a.paragraph+' > p'),walk=document.createTreeWalker(paragraph,4);let node,remaining=a.offset;
  while((node=walk.nextNode())){if(remaining<node.textContent.length){const range=document.createRange();range.setStart(node,remaining);range.setEnd(node,remaining+1);return {top:range.getBoundingClientRect().top,scrollY};}remaining-=node.textContent.length;}
  throw Error('Saved anchor character not found in rendered text.');
},anchor);}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.ENGLISH_STUDY_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
  const context=await browser.newContext({viewport:{width:1365,height:900},serviceWorkers:'block'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  let anchor;
  await test('real rendered character is captured with a stable key and text context',async()=>{
    await p.goto(origin+'/#article-07');await ready(p);await p.evaluate(()=>scrollTo(0,820));
    await p.waitForFunction(()=>StudyState.get('reader').anchorKeys?.['original/7']?.scrollY>500&&StudyState.status().phase==='saved');
    anchor=await p.evaluate(()=>StudyState.get('reader').anchorKeys['original/7']);assert.ok(anchor.offset>0);assert.equal(anchor.articleKey,'original/7');assert.ok(anchor.before.length+anchor.after.length>10);
  });
  for(const viewport of [{width:900,height:900},{width:390,height:844}])await test(`semantic character survives viewport ${viewport.width} x ${viewport.height}`,async()=>{
    await p.setViewportSize(viewport);await p.waitForTimeout(500);const actual=await rect(p,anchor);assert.ok(Math.abs(actual.top-anchor.viewportOffset)<35,JSON.stringify({anchor,actual}));
  });
  await test('changed-width reopen and font size change retain the same sentence vicinity',async()=>{
    await p.reload();await ready(p);let actual=await rect(p,anchor);assert.ok(Math.abs(actual.top-anchor.viewportOffset)<35,JSON.stringify({anchor,actual}));
    await p.evaluate(()=>{const size=document.querySelector('#fontSize');size.value='26';size.dispatchEvent(new Event('input'));});await p.waitForTimeout(500);
    actual=await rect(p,anchor);assert.ok(Math.abs(actual.top-anchor.viewportOffset)<35,JSON.stringify({anchor,actual}));
    await p.screenshot({path:path.join(out,'semantic-position-mobile-viewport.png')});
  });
  await test('explicit fixed link restoration keeps another article resume and the continue control returns to it',async()=>{
    // Keep the page's real reload consumers coherent with the synthetic fixture before pagehide.
    await p.evaluate(async()=>{const r=StudyState.get('reader');StudyState.set('reader',{...r,resumeKey:'original/7',positionKeys:{...r.positionKeys,'original/2':320}});await StudyState.flush();const pending=[];document.dispatchEvent(new CustomEvent('study-state-reloaded',{detail:{waitUntil:task=>pending.push(task)}}));await Promise.all(pending);});
    await p.goto(origin+'/#article-02');await ready(p);await p.waitForTimeout(300);
    let r=await p.evaluate(()=>StudyState.get('reader'));assert.equal(r.currentKey,'original/2');assert.equal(r.resumeKey,'original/7');assert.equal(r.positionKeys['original/2'],320);
    assert.equal(await p.locator('#continueReading').isHidden(),false);await p.evaluate(()=>document.querySelector('#continueReading').click());await ready(p);
    r=await p.evaluate(()=>StudyState.get('reader'));assert.equal(r.currentKey,'original/7');assert.equal(r.positionKeys['original/2'],320);const actual=await rect(p,anchor);assert.ok(Math.abs(actual.top-anchor.viewportOffset)<40,JSON.stringify({anchor,actual}));
  });
  assert.deepEqual(errors,[]);await context.close();
  fs.writeFileSync(path.join(out,'reader-position-results.json'),JSON.stringify({browser:browser.version(),origin,checks,errors,anchor},null,2));console.log(JSON.stringify({browser:browser.version(),checks,errors},null,2));
})().catch(e=>{process.exitCode=1;console.error(e);fs.writeFileSync(path.join(out,'reader-position-results.json'),JSON.stringify({checks,errors,error:e.stack},null,2));}).finally(async()=>{await browser?.close();server.close();});
