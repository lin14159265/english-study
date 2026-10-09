// Optional native IndexedDB / running-reader benchmark; synthetic isolated data only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {chromium}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'english-study-sync-cost-'));
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),file=path.resolve(repo,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(repo+'/')){res.writeHead(403).end();return;}fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',({js:'text/javascript',json:'application/json',html:'text/html',css:'text/css'})[file.split('.').at(-1)]||'application/octet-stream');res.end(body);});});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({executablePath:process.env.ENGLISH_STUDY_CHROMIUM||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.StudyReaderAPI&&StudyState.status().phase==='saved');
 const result=await page.evaluate(async()=>{
  const S=StudyState,template=await (await fetch('/downloads/pack-template.json')).json(),count=12,padding='x'.repeat(Math.floor(20*1024*1024/count));
  await S.writePacks(store=>{for(let i=0;i<count;i++){const payload=structuredClone(template);payload.id='bench-'+String(i).padStart(2,'0');payload.title='Synthetic cost '+i;payload.qaPadding=padding;store.put({key:'local:'+payload.id,source:'local',payload});}});
  await StudyLibrary.reload(await S.packs(),{token:S.libraryVersion()});await S.flush();await S.bindUid('benchmark_owner');
  let reads=0,writes=0,reloads=0,heavyReads=0,heavyWrites=0;const prototype=IDBObjectStore.prototype,oldAll=prototype.getAll,oldPut=prototype.put,oldGet=prototype.get;
  prototype.getAll=function(...args){if(this.name==='packs')reads++;return oldAll.apply(this,args);};
  prototype.get=function(key,...args){if(this.name==='syncMeta'&&String(key).startsWith('payload:'))heavyReads++;return oldGet.call(this,key,...args);};
  prototype.put=function(value,...args){if(this.name==='packs')writes++;if(this.name==='syncMeta'&&String(value.key).startsWith('payload:'))heavyWrites++;return oldPut.call(this,value,...args);};
  S.onReload(()=>{reloads++;});let sequence=0;
  async function sample(method){
   const reader=structuredClone(S.get('reader'));reader.positionKeys['original/1']=500+(++sequence);S.set('reader',reader);await S.flush();const record=await S.readSync(),wire=StudyCloudSync.wire(record),flight=await S.saveFlight({uid:'benchmark_owner',expectedToken:record.token,payload:{snapshot:wire,localBase:wire,expectedVersion:sequence-1}});
   reads=writes=reloads=heavyReads=heavyWrites=0;const start=performance.now();
   const args={uid:'benchmark_owner',expectedToken:record.token,base:wire,remoteVersion:sequence,ackIds:flight.ackIds,ackOperationId:flight.operationId};
   if(method==='confirmSync')await S.confirmSync(args);else await S.applySync({...args,state:wire.state,packs:wire.packs,rollback:wire.rollback});
   return {ms:performance.now()-start,packsGetAll:reads,packPuts:writes,UIReloads:reloads,heavyReads,heavyWrites};
  }
  const measured={};for(const method of ['applySync','confirmSync']){await sample(method);measured[method]=[];for(let i=0;i<5;i++)measured[method].push(await sample(method));}
  reads=writes=reloads=heavyReads=heavyWrites=0;const start=performance.now();const reader=structuredClone(S.get('reader'));reader.positionKeys['original/1']++;S.set('reader',reader);await S.flush();const localSave={ms:performance.now()-start,packsGetAll:reads,packPuts:writes,UIReloads:reloads,heavyReads,heavyWrites};
  const bytes=(await S.packs()).reduce((n,p)=>n+new TextEncoder().encode(JSON.stringify(p)).length,0);return {bytes,count,warmup:1,samples:5,measured,localSave};
 });
 for(const [method,samples]of Object.entries(result.measured)){const sorted=samples.map(s=>s.ms).sort((a,b)=>a-b);result[method]={medianMs:sorted[Math.floor(sorted.length/2)],minMs:sorted[0],maxMs:sorted.at(-1)};}
 const report={browser:browser.version(),...result,limits:'Same current implementation: full cloud apply versus receipt-only confirmation; includes native IDB + acknowledged UI work, excludes preparation/readSync/flight allocation/cloud network; not phone performance.'};fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'sync-benchmark-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
