// Optional real Chromium acceptance for dynamic module retry and public SDK cache.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {chromium}=require(process.env.ENGLISH_STUDY_PLAYWRIGHT_PATH||'playwright');
const repo=path.resolve(__dirname,'..'),out=process.env.ENGLISH_STUDY_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'english-study-sdk-'));
const version='13.0.0',prefix='https://www.gstatic.com/firebasejs/'+version+'/',appURL=prefix+'firebase-app.js';
const modules={
  app:'const apps=[];export function getApps(){return apps;}export function initializeApp(config,name){const app={config,name};apps.push(app);return app;}',
  auth:`import{getApps}from${JSON.stringify(appURL)};export function getAuth(){return {registry:getApps()};}`,
  firestore:`import{getApps}from${JSON.stringify(appURL)};export function getFirestore(){return {registry:getApps()};}`
};
const server=http.createServer((req,res)=>{
  if(req.url==='/firebase-adapter.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(repo,'firebase-adapter.js')));}
  else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><script src="/firebase-adapter.js"></script><p>isolated SDK retry fixture</p>');}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({...(process.env.ENGLISH_STUDY_CHROMIUM?{executablePath:process.env.ENGLISH_STUDY_CHROMIUM}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext(),checks=[],counts={app:0,auth:0,firestore:0};let failApp=true,blocked=false,real=false;
  const sourceDirectory=process.env.ENGLISH_STUDY_QA_FIREBASE_SOURCES;
  try{
    await context.route(prefix+'**',async route=>{
      const name=route.request().url().match(/firebase-(app|auth|firestore)\.js$/)?.[1];assert.ok(name,'Unexpected SDK dependency URL');counts[name]++;
      if(blocked)return route.abort('internetdisconnected');
      if(name==='app'&&failApp){failApp=false;return route.fulfill({status:503,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:'unavailable'});}
      const source=real?fs.readFileSync(path.join(sourceDirectory,'firebase-'+name+'-cdn.js'),'utf8'):modules[name];
      await route.fulfill({status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:source});
    });
    const first=await context.newPage();await first.goto(origin);
    const failure=await first.evaluate(()=>StudyFirebaseAdapter.loadSDK().then(()=>null,error=>({code:error.code,message:error.message})));
    assert.equal(failure.code,'sdk-unavailable');
    const success=await first.evaluate(async()=>{
      const sdk=await StudyFirebaseAdapter.loadSDK(),app=sdk.initializeApp({},'shared');
      return {same:sdk.getAuth(app).registry===sdk.getApps()&&sdk.getFirestore(app).registry===sdk.getApps(),apps:sdk.getApps().length};
    });
    assert.equal(success.same,true);assert.equal(success.apps,1);assert.deepEqual(counts,{app:2,auth:1,firestore:1});
    checks.push({name:'first 503 then successful retry in same document; one shared app module registry',passed:true,requests:{...counts}});
    blocked=true;const reopened=await context.newPage();await reopened.goto(origin);
    const before={...counts};assert.equal(await reopened.evaluate(async()=>(await StudyFirebaseAdapter.loadSDK()).getApps().length),0);assert.deepEqual(counts,before);
    checks.push({name:'new document loads previously cached public SDK graph without network requests',passed:true});
    blocked=false;
    await reopened.evaluate(async url=>{const cache=await caches.open('english-study-firebase-sdk-13.0.0');await cache.put(url,new Response('export const broken = ;',{headers:{'Content-Type':'text/javascript'}}));},appURL);
    const corrupted=await context.newPage();await corrupted.goto(origin);
    assert.equal(await corrupted.evaluate(()=>StudyFirebaseAdapter.loadSDK().then(()=>false,()=>true)),true);
    assert.equal(await corrupted.evaluate(async()=>(await StudyFirebaseAdapter.loadSDK()).getApps().length),0);
    checks.push({name:'syntax-corrupted cached source invalidated and fresh Blob graph retries successfully',passed:true});
    if(sourceDirectory){
      real=true;await corrupted.evaluate(()=>caches.delete('english-study-firebase-sdk-13.0.0'));
      const actual=await context.newPage();await actual.goto(origin);
      const result=await actual.evaluate(async()=>{
        const sdk=await StudyFirebaseAdapter.loadSDK(),app=sdk.initializeApp({apiKey:'isolated-public-fixture',projectId:'demo-english-study',appId:'isolated-public-fixture'},'qa-actual-sdk');
        const auth=sdk.getAuth(app),database=sdk.getFirestore(app);return {version:sdk.SDK_VERSION,authSharesApp:auth.app===app,firestoreSharesApp:database.app===app};
      });
      assert.equal(result.version,version);assert.equal(result.authSharesApp,true);assert.equal(result.firestoreSharesApp,true);
      checks.push({name:'actual official CDN Firebase 13.0.0 source graph loads with shared app Auth and Firestore',passed:true});
    }
    fs.mkdirSync(out,{recursive:true});const report={browser:browser.version(),origin,checks};fs.writeFileSync(path.join(out,'firebase-loader-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
