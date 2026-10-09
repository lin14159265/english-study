// Optional full-page Chromium integration. Firebase adapter/auth are replaced only by
// this isolated HTTP server; production reader, sync controller and native IndexedDB run unchanged.
// This is a synthetic shared cloud, not Google OAuth or a Firestore network acceptance test.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'english-study-cloud-qa-'));
const C=require('../workspace-core'),L=require('../learning-core'),P=require('../package-core'),E=require('../experience-core'),Position=require('../position-core');
const clone=x=>JSON.parse(JSON.stringify(x));fs.mkdirSync(out,{recursive:true});
const pack=JSON.parse(fs.readFileSync(path.join(repo,'downloads/pack-template.json')));pack.id='qa-private';pack.title='Synthetic private pack';pack.articles[0].paragraphs[0].en+=' The students carefully discussed the practical result.'.repeat(50);delete pack.articles[0].paragraphs[0].sentences;
const revised=clone(pack);revised.articles[0].title='A Privately Revised Reading Project';revised.articles[0].zhTitle='私人修订阅读项目';
const compiled=P.validate(revised);assert.equal(compiled.ok,true);const data=compiled.compiled,article=data.articles[0],key=article.key,[wordKey,word]=Object.entries(data.words)[0],card=L.usage(data,wordKey,word.uses[0]),sentence=L.articleSentences(article)[0];
const learning=L.empty();learning.cards.push(card);L.rate(learning,card,'wrong-sense','a synthetic guess');L.saveNote(learning,sentence,'合成错句理解',['词义'],'合成说明');learning.drafts[sentence.id]={own:'合成理解草稿',reason:'草稿理由',categories:['词义']};learning.cursor[key]=1;learning.futurePersonal={setting:'retained'};
const extra=C.emptyExtra(),question=article.questions[0];E.capture(extra,sentence);extra.lookupWords.push({id:'qa-lookup',text:'measured',articleKey:key,paragraph:0,context:sentence.en,note:'private lookup note'});extra.queue.push({id:'qa-task',articleKey:key,mode:'reading',status:'pending'});
extra.edits[pack.id]={payload:revised,baseHash:C.hash(pack),at:1};extra.editorDrafts[key]={payload:clone(revised),baseHash:C.hash(revised),paragraphIndex:0};extra.quizDrafts[key]={articleKey:key,sourceSignature:article.sourceSignature,answers:{[question.id]:question.answer}};
extra.quizAttempts.push({id:'qa-quiz',articleKey:key,questions:[question],answers:{[question.id]:question.answer},score:1,total:1});extra.wrongQuestions.push({id:'qa-wrong-question',articleKey:key,question});extra.difficulty[key]={level:'hard',sourceSignature:article.sourceSignature};extra.verifications[key]={signature:C.hash(revised),at:new Date(0).toISOString()};extra.customPersistent={themePreference:'qa'};
const round=E.buildRound(data,learning,extra,{limit:1});E.recordResult(round,{rating:'known',guess:'reviewed'});extra.reviewRounds.push(round);extra.reviewSession=E.buildRound(data,learning,extra,{limit:1});
const state={reader:{currentKey:key,resumeKey:key,readKeys:[key,'original/2'],positionKeys:{[key]:450},anchorKeys:{[key]:Position.capture({articleKey:key,paragraphs:article.plain,paragraph:0,offset:350,scrollY:450,viewportOffset:82,updatedAt:1})},settings:{theme:'dark',fontSize:22,lineHeight:2,fontFamily:'sans',highlight:true,focus:false},futureSetting:true},learning,extra};
assert.deepEqual(C.validateState(state),[]);const seedPacks=[{key:'local:'+pack.id,source:'local',payload:pack}];
const cloud={version:0,snapshot:null,receipts:new Map(),attempts:new Map(),writes:0,loseAckFor:null};
const adapterSource=`window.StudyFirebaseAdapter={async create(config){
 const user={uid:'owner',email:'synthetic-owner@example.test',providerData:[{providerId:'google.com'}]},callbacks=new Set();let current=localStorage.getItem('qa-auth')?user:null;
 const client=localStorage.getItem('qa-client')||crypto.randomUUID();localStorage.setItem('qa-client',client);window.__qaClient=client;
 async function request(method,body){const response=await fetch('/__qa/'+method,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify({...body,client}):undefined});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message),{code:value.code});return value;}
 const adapter={onAuth(fn){callbacks.add(fn);queueMicrotask(()=>fn(current));return()=>callbacks.delete(fn);},async signIn(){current=user;localStorage.setItem('qa-auth','owner');for(const fn of callbacks)fn(current);return user;},async signOut(){current=null;localStorage.removeItem('qa-auth');for(const fn of callbacks)fn(null);},user:()=>current,pull:()=>request('pull'),commit:value=>request('commit',value),subscribe(fn){let last=-1;const poll=()=>request('head').then(head=>{if(last!==head.version){last=head.version;fn(head);}}).catch(error=>fn({error}));const timer=setInterval(poll,250);poll();return()=>clearInterval(timer);},close(){callbacks.clear();}};window.__qaAdapter=adapter;return adapter;
}};`;
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-cache'});res.end(JSON.stringify(value));}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/__qa/seed'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic fixture seed</title>');return;}
  if(url.pathname==='/__qa/head'){json(res,{version:cloud.version});return;}
  if(url.pathname==='/__qa/pull'){json(res,{version:cloud.version,snapshot:cloud.snapshot});return;}
  if(url.pathname==='/__qa/commit'){
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body),digest=crypto.createHash('sha256').update(JSON.stringify(input.snapshot)).digest('hex');cloud.attempts.set(input.operationId,(cloud.attempts.get(input.operationId)||0)+1);
    const prior=cloud.receipts.get(input.operationId);if(prior){if(prior.digest!==digest){json(res,{code:'operation-mismatch',message:'Synthetic receipt payload differs'},409);return;}json(res,{...prior,alreadyCommitted:true});return;}
    if(input.expectedVersion!==cloud.version){json(res,{code:'remote-conflict',message:'Synthetic cloud head advanced'},409);return;}
    const valid=require('../sync-core').validateSnapshot(input.snapshot);if(!valid.ok){json(res,{code:'invalid-snapshot',message:valid.errors.join(';')},400);return;}
    cloud.version++;cloud.writes++;cloud.snapshot=clone(input.snapshot);const receipt={operationId:input.operationId,version:cloud.version,digest};cloud.receipts.set(input.operationId,receipt);
    if(cloud.loseAckFor===input.client){cloud.loseAckFor=null;json(res,{code:'unavailable',message:'Injected lost acknowledgement after durable commit'},503);return;}
    json(res,{...receipt,alreadyCommitted:false});return;
  }
  if(url.pathname==='/firebase-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.ENGLISH_STUDY_FIREBASE={apiKey:"qa",authDomain:"localhost",projectId:"synthetic-qa",appId:"synthetic",allowedUid:"owner"};');return;}
  if(url.pathname==='/firebase-adapter.js'){res.setHeader('Content-Type','text/javascript');res.end(adapterSource);return;}
  if(url.pathname==='/packages/index.json'){json(res,{files:[]});return;}
  const file=path.resolve(repo,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(repo+'/')){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,body)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'js':'text/javascript','html':'text/html','css':'text/css','json':'application/json'})[file.split('.').at(-1)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(body);});
});
let browser,origin;const checks=[],errors=[];let desktop,mobile,a,b;
async function watch(p,label){p.on('pageerror',error=>errors.push({label,message:error.message}));}
async function ready(p){await p.waitForFunction(()=>window.StudyReaderAPI&&window.StudyCloudAPI&&StudyState.status().phase==='saved');await p.waitForTimeout(150);}
async function signIn(p){await p.locator('#cloudButton').click();await p.locator('#cloudLogin').click();}
async function phase(p,name){await p.waitForFunction(name=>StudyCloudAPI.status().phase===name,name,{timeout:20000});}
async function settle(p){for(let i=0;i<50;i++){await p.evaluate(()=>StudyCloudAPI.syncNow());const s=await p.evaluate(async()=>({phase:StudyCloudAPI.status().phase,record:await StudyState.readSync()}));if(s.phase==='synced'&&!s.record.pending.length&&!s.record.meta.flight)return s.record;if(['conflict','error','blocked','migration'].includes(s.phase)&&i>5)throw Error('Unexpected sync status '+s.phase+' '+await p.locator('#cloudState').textContent());await p.waitForTimeout(150);}throw Error('Sync did not settle: '+await p.locator('#cloudState').textContent());}
async function test(name,run){const start=Date.now();try{await run();checks.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(error){checks.push({name,pass:false,error:error.message});throw error;}}
async function ackMemory(p,packs=false){await p.evaluate(async includePacks=>{const tasks=[],detail={waitUntil:p=>tasks.push(p)};if(includePacks){detail.packs=await StudyState.packs();detail.libraryToken=StudyState.libraryVersion();}document.dispatchEvent(new CustomEvent('study-state-reloaded',{detail}));await Promise.all(tasks);},packs);}
async function mutate(p,kind){await p.evaluate(async kind=>{
  if(kind==='mobile'){
    const l=structuredClone(StudyState.get('learning'));l.drafts['mobile-draft']={own:'phone understanding',reason:'phone note',categories:['词义']};StudyState.set('learning',l);
    const x=structuredClone(StudyState.get('extra')),id='qa-private';x.lookupWords.push({id:'mobile-lookup',text:'practical',articleKey:'qa-private/campus-project',paragraph:0,context:'A phone lookup.',note:'phone note'});x.edits[id].payload.articles[0].title='Revised on a Phone';StudyState.set('extra',x);
  }else if(kind==='desktop'||kind==='second-tab'){
    const x=structuredClone(StudyState.get('extra'));x.queue.push({id:kind==='desktop'?'desktop-new-task':'second-tab-task',articleKey:'qa-private/campus-project',mode:'reading',status:'pending'});StudyState.set('extra',x);
  }else if(kind==='offline'){
    const l=structuredClone(StudyState.get('learning'));l.drafts['offline-draft']={own:'offline learning continued',reason:'',categories:[]};StudyState.set('learning',l);
  }else if(kind==='failed-refresh'){
    const l=structuredClone(StudyState.get('learning'));l.drafts['consumer-recovery']={own:'durably committed before failed UI refresh',reason:'',categories:[]};StudyState.set('learning',l);
  }else if(kind==='conflict-local'||kind==='conflict-remote'){
    const l=structuredClone(StudyState.get('learning'));l.notes[0].own=kind;StudyState.set('learning',l);
  }else if(kind==='unknown'){
    const l=structuredClone(StudyState.get('learning'));l.drafts['unknown-receipt']={own:'server received once',reason:'',categories:[]};StudyState.set('learning',l);
  }else if(kind==='advance'){
    const l=structuredClone(StudyState.get('learning'));l.drafts['later-device']={own:'head advanced later',reason:'',categories:[]};StudyState.set('learning',l);
  }
  await StudyState.flush();
},kind);await ackMemory(p,kind==='mobile');}
async function seed(p){await p.goto(origin+'/__qa/seed');await p.evaluate(async fixture=>{
  await new Promise((resolve,reject)=>{const q=indexedDB.open('english-study.packages.v1',3);q.onupgradeneeded=()=>{for(const name of ['workspace','packs','syncOutbox','syncMeta'])q.result.createObjectStore(name,{keyPath:'key'});};q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction(['workspace','packs'],'readwrite');tx.objectStore('workspace').put({key:'current',token:'qa-seed',libraryToken:'qa-library',data:fixture.state,savedAt:1});for(const record of fixture.packs)tx.objectStore('packs').put(record);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
},{state,packs:seedPacks});}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.ENGLISH_STUDY_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
  desktop=await browser.newContext({viewport:{width:1365,height:900},serviceWorkers:'block',acceptDownloads:true});mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  a=await desktop.newPage();await watch(a,'desktop');await seed(a);await a.goto(origin+'/');await ready(a);
  await test('first migration requires backup acknowledgement and exports a complete valid personal JSON',async()=>{
    await signIn(a);await phase(a,'migration');assert.equal(cloud.version,0);await a.locator('#cloudEnable').click();assert.equal(cloud.version,0);assert.equal(await a.locator('#cloudMigration').isHidden(),false);
    await a.locator('#cloudBackup').click();const downloading=a.waitForEvent('download');await a.locator('#backupDownload').click();const download=await downloading,file=path.join(out,'synthetic-personal-backup.json');await download.saveAs(file);const backup=JSON.parse(fs.readFileSync(file));assert.equal(C.validateBackup(backup).ok,true);assert.equal(backup.packs.length,1);assert.equal(backup.state.learning.notes.length,1);assert.equal(backup.state.extra.quizAttempts.length,1);assert.equal(backup.state.extra.reviewRounds.length,1);
    await a.locator('#backupDialog .close-dialog').click();await a.locator('#cloudButton').click();await a.locator('#cloudBackupConfirmed').check();await a.locator('#cloudEnable').click();await settle(a);assert.equal(cloud.snapshot.packs.length,1);assert.equal(cloud.snapshot.state.extra.edits['qa-private'].payload.articles[0].title,revised.articles[0].title);
  });
  b=await mobile.newPage();await watch(b,'mobile viewport');await b.goto(origin+'/');await ready(b);
  await test('new independent browser login automatically restores all private packs, revisions, learning and resume',async()=>{
    await signIn(b);await phase(b,'synced');const record=await b.evaluate(()=>StudyState.readSync());assert.equal(record.state.reader.resumeKey,key);assert.equal(record.state.reader.currentKey,key);assert.equal(await b.locator('#articleTitle').textContent(),revised.articles[0].title);
    assert.equal(record.packs.filter(p=>p.source==='local').length,1);for(const field of ['cards','notes','migrated','trash'])assert.deepEqual(record.state.learning[field],cloud.snapshot.state.learning[field]);assert.deepEqual(record.state.learning.attempts,learning.attempts);assert.deepEqual(record.state.learning.drafts,learning.drafts);assert.deepEqual(record.state.learning.futurePersonal,learning.futurePersonal);
    for(const field of ['queue','quizAttempts','wrongQuestions','quizDrafts','editorDrafts','reviewRounds','reviewSession','pendingSentences','lookupWords','difficulty','verifications','customPersistent'])assert.deepEqual(record.state.extra[field],cloud.snapshot.state.extra[field]);assert.equal(record.state.reader.settings.theme,'dark');assert.equal(record.state.reader.futureSetting,true);assert.ok(record.state.reader.readKeys.includes('original/2'));assert.ok(record.state.reader.anchorKeys[key]);
    await b.locator('#cloudDialog .close-dialog').click();await b.screenshot({path:path.join(out,'new-device-private-reading.png')});
  });
  await test('mobile and desktop automatically exchange new learning, tasks and private article revisions',async()=>{
    await mutate(b,'mobile');await a.waitForFunction(()=>StudyState.get('learning').drafts['mobile-draft']?.own==='phone understanding'&&document.querySelector('#articleTitle').textContent==='Revised on a Phone',null,{timeout:20000});let record=await a.evaluate(()=>StudyState.readSync());assert.equal(record.state.learning.drafts['mobile-draft'].own,'phone understanding');assert.equal(record.state.extra.lookupWords.find(w=>w.id==='mobile-lookup').note,'phone note');assert.equal(await a.locator('#articleTitle').textContent(),'Revised on a Phone');
    await mutate(a,'desktop');await b.waitForFunction(()=>StudyState.get('extra').queue.some(t=>t.id==='desktop-new-task'),null,{timeout:20000});record=await b.evaluate(()=>StudyState.readSync());assert.ok(record.state.extra.queue.some(t=>t.id==='desktop-new-task'));
  });
  await test('offline learning is durable locally and reconnect automatically clears the pending queue',async()=>{
    await mobile.setOffline(true);await mutate(b,'offline');await b.evaluate(()=>StudyCloudAPI.syncNow());await phase(b,'offline');let record=await b.evaluate(()=>StudyState.readSync());assert.ok(record.pending.length);assert.equal(record.state.learning.drafts['offline-draft'].own,'offline learning continued');assert.equal(cloud.snapshot.state.learning.drafts['offline-draft'],undefined);
    await mobile.setOffline(false);await phase(b,'synced');record=await b.evaluate(()=>StudyState.readSync());assert.equal(record.pending.length,0);await settle(a);assert.equal((await a.evaluate(()=>StudyState.get('learning'))).drafts['offline-draft'].own,'offline learning continued');
  });
  await test('cloud UI consumer failure retains committed head and base, blocks editing, then safely replays the same head',async()=>{
    // Keep this page focused so clicking its toolbar does not trigger an independent focus retry first.
    if(await a.locator('#cloudDialog').evaluate(el=>el.open))await a.locator('#cloudDialog .close-dialog').click();await a.bringToFront();await settle(a);
    const before=await a.evaluate(()=>StudyState.readSync());
    await a.evaluate(()=>{let failed=false;window.__qaStopConsumer=StudyState.onReload(detail=>{if(detail.cloud&&!failed){failed=true;throw Error('injected cloud UI consumer failure');}});});
    await mutate(b,'failed-refresh');await settle(b);
    await a.waitForFunction(()=>document.querySelector('#reader').inert&&['error','loading'].includes(StudyState.status().phase),null,{timeout:20000});
    const failed=await a.evaluate(()=>StudyState.readSync());assert.notEqual(failed.token,before.token);assert.equal(failed.state.learning.drafts['consumer-recovery'].own,'durably committed before failed UI refresh');assert.equal(failed.meta.base.state.learning.drafts['consumer-recovery'].own,'durably committed before failed UI refresh');assert.equal(failed.meta.flight,undefined);
    assert.equal(await a.locator('#sidebar').evaluate(el=>el.inert),true);assert.equal(await a.locator('#syncApplyingNotice').isHidden(),false);assert.equal(await a.locator('#saveStatus').evaluate(el=>el.inert),false);assert.equal(await a.locator('#cloudButton').evaluate(el=>el.inert),false);
    const rejected=await a.evaluate(()=>{try{StudyState.set('learning',{...StudyState.get('learning'),testForbidden:true});return false;}catch{return true;}});assert.equal(rejected,true);
    const box=await a.locator('#saveStatus').boundingBox();await a.mouse.click(box.x+box.width/2,box.y+box.height/2);assert.equal(await a.locator('#saveRetry').isHidden(),false);await a.locator('#saveRetry').click();
    await a.waitForFunction(()=>StudyState.status().phase==='saved'&&!document.querySelector('#reader').inert);const recovered=await a.evaluate(()=>StudyState.readSync());assert.equal(recovered.token,failed.token);assert.deepEqual(recovered.state.learning.drafts['consumer-recovery'],failed.state.learning.drafts['consumer-recovery']);assert.equal(recovered.meta.flight,undefined);assert.equal(recovered.pending.length,failed.pending.length);assert.equal(await a.locator('#syncApplyingNotice').isHidden(),true);
    await a.evaluate(()=>window.__qaStopConsumer());await a.locator('#saveDialog .close-dialog').click();await settle(a);assert.equal((await a.evaluate(()=>StudyState.get('learning'))).drafts['consumer-recovery'].own,'durably committed before failed UI refresh');
  });
  await test('two clean desktop tabs adopt committed remote learning without a permanent conflict',async()=>{
    const second=await desktop.newPage();await watch(second,'desktop second tab');await second.goto(origin+'/');await ready(second);await phase(second,'synced');await mutate(b,'second-tab');await settle(b);await settle(a);await second.waitForFunction(()=>StudyState.get('extra').queue.filter(t=>t.id==='second-tab-task').length===1&&StudyState.status().phase==='saved');assert.notEqual(await second.evaluate(()=>StudyState.status().phase),'conflict');await second.close();await settle(a);
  });
  await test('concurrent private note conflicts survive reopening and an explicit choice restores consistent memory',async()=>{
    await desktop.setOffline(true);await mobile.setOffline(true);await mutate(a,'conflict-local');await mutate(b,'conflict-remote');await desktop.setOffline(false);await settle(a);await mobile.setOffline(false);await b.evaluate(()=>StudyCloudAPI.syncNow());await phase(b,'conflict');let record=await b.evaluate(()=>StudyState.readSync());assert.ok(record.meta.conflicts.length);assert.equal(record.state.learning.notes[0].own,'conflict-remote');
    await b.reload();await ready(b);await phase(b,'conflict');record=await b.evaluate(()=>StudyState.readSync());assert.ok(record.meta.conflicts[0].result.conflicts.length);await b.locator('#cloudButton').click();await b.locator('#cloudKeepLocal').click();await settle(b);await settle(a);assert.equal((await a.evaluate(()=>StudyState.get('learning'))).notes[0].own,'conflict-remote');assert.equal((await b.evaluate(()=>StudyState.readSync())).meta.conflicts.length,0);await b.locator('#cloudDialog .close-dialog').click();
  });
  await test('a lost acknowledgement retries a persistent operation ID after reopening and a later cloud head',async()=>{
    cloud.loseAckFor=await a.evaluate(()=>window.__qaClient);await mutate(a,'unknown');await a.evaluate(()=>StudyCloudAPI.syncNow());await phase(a,'offline');const pending=await a.evaluate(()=>StudyState.readSync()),operation=pending.meta.flight.operationId,receipt=cloud.receipts.get(operation);assert.ok(receipt);await a.close();
    await settle(b);await mutate(b,'advance');await settle(b);assert.ok(cloud.version>receipt.version);a=await desktop.newPage();await watch(a,'desktop receipt restart');await a.goto(origin+'/');await ready(a);
    // An old durable receipt can confirm this device before its automatic next
    // check downloads a later device's head. Await that actual business update.
    await a.waitForFunction(()=>StudyState.get('learning').drafts['later-device']?.own==='head advanced later'&&StudyCloudAPI.status().phase==='synced',null,{timeout:20000});
    const restored=await a.evaluate(()=>StudyState.readSync());assert.equal(restored.meta.flight,undefined);assert.equal(restored.pending.length,0);assert.ok(cloud.attempts.get(operation)>=2);assert.equal(cloud.receipts.get(operation).version,receipt.version);assert.equal(restored.state.learning.drafts['unknown-receipt'].own,'server received once');assert.equal(restored.state.learning.drafts['later-device'].own,'head advanced later');
  });
  await test('a durable upload acknowledgement immediately updates the visible saved status without another pull',async()=>{
    await settle(a);const before=cloud.writes;
    await a.evaluate(async()=>{
      const learning=structuredClone(StudyState.get('learning'));learning.drafts['immediate-ack']={own:'acknowledged in the same cycle',reason:'',categories:[]};StudyState.set('learning',learning);await StudyState.flush();
    });
    await ackMemory(a);await a.evaluate(()=>StudyCloudAPI.syncNow());
    const record=await a.evaluate(()=>StudyState.readSync());assert.equal(record.pending.length,0);assert.equal(record.meta.flight,undefined);assert.equal(cloud.writes,before+1);
    assert.equal(await a.evaluate(()=>StudyCloudAPI.status().phase),'synced');assert.equal(await a.locator('#cloudStatus').textContent(),'已同步');
  });
  await test('a stalled update check shows its stage, survives return events without duplicate pulls and safely recovers',async()=>{
    await a.evaluate(()=>{
      window.__qaOriginalPull=__qaAdapter.pull;window.__qaStalledPulls=0;
      __qaAdapter.pull=()=>{window.__qaStalledPulls++;return new Promise((resolve,reject)=>{window.__qaRejectPull=reject;});};
      window.__qaStalledRun=StudyCloudAPI.syncNow();
    });
    await phase(a,'checking');assert.equal(await a.locator('#cloudStatus').textContent(),'已同步 · 检查更新');
    const before=await a.evaluate(()=>StudyState.readSync());
    if(!await a.locator('#cloudDialog').evaluate(el=>el.open))await a.locator('#cloudButton').click();
    await a.waitForFunction(()=>StudyCloudAPI.status().phase==='waiting',null,{timeout:30000});
    assert.equal(await a.locator('#cloudStatus').textContent(),'同步等待较久');assert.match(await a.locator('#cloudState').textContent(),/检查云端版本/);
    assert.equal(await a.locator('#reader').evaluate(el=>el.inert),false);await a.screenshot({path:path.join(out,'stalled-cloud-stage.png')});
    await a.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('focus'));});
    await a.locator('#cloudNow').click();assert.equal(await a.evaluate(()=>window.__qaStalledPulls),1);
    await a.evaluate(async()=>{__qaAdapter.pull=window.__qaOriginalPull;window.__qaRejectPull(Object.assign(Error('Injected SDK deadline'),{code:'sync-timeout'}));await window.__qaStalledRun;});
    await phase(a,'offline');assert.match(await a.locator('#cloudState').textContent(),/本机记录已保留/);
    const failed=await a.evaluate(()=>StudyState.readSync());assert.deepEqual(failed.state,before.state);assert.equal(failed.pending.length,before.pending.length);assert.equal(failed.meta.flight,before.meta.flight);
    await a.locator('#cloudNow').click();await phase(a,'synced');assert.equal(await a.locator('#reader').evaluate(el=>el.inert),false);await a.screenshot({path:path.join(out,'stalled-cloud-recovered.png')});await a.locator('#cloudDialog .close-dialog').click();
  });
  assert.deepEqual(errors,[]);await desktop.close();await mobile.close();
  fs.writeFileSync(path.join(out,'cloud-browser-results.json'),JSON.stringify({browser:browser.version(),backend:'synthetic HTTP adapter, not Google OAuth/Firestore',origin,checks,errors,cloud:{version:cloud.version,writes:cloud.writes,receiptCount:cloud.receipts.size}},null,2));console.log(JSON.stringify({checks,errors,version:cloud.version},null,2));
})().catch(async error=>{console.error(error);console.error('DEBUG',await Promise.all([a,b].map(p=>p&&!p.isClosed()?p.evaluate(async()=>({ui:StudyCloudAPI?.status(),storage:StudyState?.status(),record:await StudyState?.readSync()})).catch(()=>null):null)));fs.writeFileSync(path.join(out,'cloud-browser-results.json'),JSON.stringify({checks,errors,error:error.stack,cloudVersion:cloud.version},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
