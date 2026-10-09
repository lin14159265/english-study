const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../firebase-adapter');
const copy=value=>value===undefined?undefined:structuredClone(value);
function harness(options={}){
  const data=options.data||new Map(),metrics={writes:0,reads:0,readPaths:[],batches:[],popup:0,redirect:0,signout:0},listeners=[];
  const auth={currentUser:{uid:'owner',providerData:[{providerId:'google.com'}]}},doc=(...args)=>args.slice(1).join('/');
  const snapshot=key=>({exists:()=>data.has(key),data:()=>copy(data.get(key)),metadata:{fromCache:false,hasPendingWrites:false}});
  const sdk={getApps:()=>[],initializeApp:()=>({}),getAuth:()=>auth,getFirestore:()=>({}),browserLocalPersistence:{},setPersistence:async()=>{},getRedirectResult:async()=>null,
    onAuthStateChanged(a,fn){listeners.push(fn);return ()=>{};},doc,
    getDocFromServer:async key=>{metrics.reads++;metrics.readPaths.push(key);return snapshot(key);},
    writeBatch(){const writes=[];return {set:(key,value)=>writes.push([key,copy(value)]),commit:async()=>{metrics.batches.push(writes.length);for(const[key,value]of writes){data.set(key,value);metrics.writes++;}}};},
    runTransaction:async(db,fn)=>{const writes=[];const result=await fn({get:async key=>snapshot(key),set:(key,value)=>writes.push([key,copy(value)])});for(const[key,value]of writes){data.set(key,value);metrics.writes++;}return result;},
    GoogleAuthProvider:class{setCustomParameters(){}},
    signInWithPopup:async()=>{metrics.popup++;if(options.popupError)throw Object.assign(new Error('blocked'),{code:options.popupError});return {user:auth.currentUser};},
    signInWithRedirect:async()=>{metrics.redirect++;},
    signOut:async()=>{metrics.signout++;auth.currentUser=null;for(const fn of listeners)fn(null);},
    onSnapshot:(key,options,fn)=>{fn(snapshot(key));return ()=>{};}
  };
  const config={apiKey:'public',projectId:'test',appId:'publicapp',authDomain:'test.firebaseapp.com',allowedUid:'owner'};
  return {sdk,config,data,metrics,auth,make:(cfg,options)=>A.create({...config,...cfg},{loadSDK:async()=>sdk,...options})};
}
const sample=(current='original/7')=>({state:{reader:{currentKey:current,readKeys:['missing/story']},learning:{cards:[{note:'中文😀',dueAt:123}]},extra:{edits:{p:{title:'私人修订'}}}},packs:[{key:'local:private',source:'local',payload:{articles:[{en:'private',zh:'私人'}]}}],rollback:{state:{reader:{currentKey:'old/story'}},packs:[]}});
test('SDK service graph rewrites the exact pinned app dependency and rejects unexpected imports',()=>{
  const official='https://www.gstatic.com/firebasejs/'+A.SDK_VERSION+'/firebase-app.js';
  const source='import{getApps}from'+JSON.stringify(official)+';export function registry(){return getApps();}';
  assert.equal(A.rewriteAppImport(source,'blob:shared-app'),'import{getApps}from"blob:shared-app";export function registry(){return getApps();}');
  assert.throws(()=>A.rewriteAppImport('import{x}from"https://unexpected.example/module.js";export{x};','blob:shared'),{code:'sdk-module-graph'});
  assert.throws(()=>A.rewriteAppImport('export function unsafe(){return import("https://unexpected.example/module.js");}','blob:shared'),{code:'sdk-module-graph'});
});
test('Firebase chunks split by UTF-8 bytes and preserve Chinese and supplementary characters',async()=>{
  const text='中文😀abc'.repeat(40000),pieces=A.split(text);
  assert.equal(pieces.join(''),text);assert.ok(pieces.length>1);
  assert.ok(pieces.every(piece=>Buffer.byteLength(piece)<=A.CHUNK_BYTES));
  const encoded=await A.encodeSnapshot({...sample(),packs:[{key:'local:large',payload:{text}}]});
  assert.ok([...encoded.chunks.values()].every(chunk=>Buffer.byteLength(chunk.text)===chunk.bytes&&chunk.bytes<=A.CHUNK_BYTES));
});
test('Firestore full snapshot round trips private records, unknown state components and rollback',async()=>{
  const h=harness(),api=await h.make(),input=sample();input.state.futureData={score:8};
  const result=await api.commit({operationId:'op_device_001',expectedVersion:0,snapshot:input});
  assert.equal(result.version,1);assert.deepEqual((await api.pull()).snapshot,input);
  assert.ok(h.metrics.batches.every(count=>count<=32));api.close();
});
test('reading-only commits reuse private pack chunks and only upload changed components',async()=>{
  const h=harness(),api=await h.make();await api.commit({operationId:'op_device_001',expectedVersion:0,snapshot:sample()});
  const before=new Set([...h.data].filter(([key])=>key.includes('/chunks/')).map(([key])=>key));
  const writes=h.metrics.writes;await api.commit({operationId:'op_device_002',expectedVersion:1,snapshot:sample('original/8')});
  const added=[...h.data].filter(([key])=>key.includes('/chunks/')&&!before.has(key));
  assert.equal(added.length,2);assert.equal(h.metrics.writes-writes,5);api.close();
});
test('persistent operation receipt confirms old retry even after head advanced and client restarted',async()=>{
  const h=harness(),api=await h.make();await api.commit({operationId:'op_device_001',expectedVersion:0,snapshot:sample()});
  await api.commit({operationId:'op_device_002',expectedVersion:1,snapshot:sample('original/8')});api.close();
  const restarted=await h.make(),writes=h.metrics.writes;
  const result=await restarted.commit({operationId:'op_device_001',expectedVersion:0,snapshot:sample()});
  assert.equal(result.version,1);assert.equal(result.alreadyCommitted,true);assert.equal(h.metrics.writes,writes);
  assert.equal((await restarted.pull()).version,2);restarted.close();
});
test('operation ID reused with different content is rejected without touching the head',async()=>{
  const h=harness(),api=await h.make();await api.commit({operationId:'op_device_001',expectedVersion:0,snapshot:sample()});
  await assert.rejects(api.commit({operationId:'op_device_001',expectedVersion:1,snapshot:sample('other')}),{code:'operation-mismatch'});
  assert.equal((await api.pull()).version,1);api.close();
});
test('concurrent stale base refuses to publish prepared content and retains previous committed snapshot',async()=>{
  const h=harness(),api=await h.make();await api.commit({operationId:'op_device_001',expectedVersion:0,snapshot:sample()});
  await assert.rejects(api.commit({operationId:'op_device_002',expectedVersion:0,snapshot:sample('other')}),{code:'remote-conflict'});
  assert.deepEqual((await api.pull()).snapshot,sample());assert.equal(h.data.has('users/owner/receipts/op_device_002'),false);api.close();
});
test('hash corruption rejects cloud pull rather than returning partial personal state',async()=>{
  const h=harness(),api=await h.make();await api.commit({operationId:'op_device_001',expectedVersion:0,snapshot:sample()});
  const [key,value]=[...h.data].find(([key])=>key.includes('/chunks/'));h.data.set(key,{...value,text:value.text+'x'});
  // Production rules prevent mutation; a fresh client also rejects privileged corruption.
  const fresh=await h.make();await assert.rejects(fresh.pull(),{code:'cloud-corrupt'});fresh.close();api.close();
});
test('first authentication with no UID can show UID but cannot read or upload any cloud data',async()=>{
  const h=harness(),api=await h.make({allowedUid:''});assert.equal(api.user().uid,'owner');
  await assert.rejects(api.pull(),{code:'permission-denied'});await assert.rejects(api.commit({operationId:'op_device_001',expectedVersion:0,snapshot:sample()}),{code:'permission-denied'});
  assert.equal(h.metrics.reads,0);assert.equal(h.metrics.writes,0);api.close();
});
test('unauthorized Google account signs out and cannot access configured owner path',async()=>{
  const h=harness();h.auth.currentUser.uid='other';const api=await h.make();
  assert.equal(api.user(),null);assert.equal(h.metrics.signout,1);await assert.rejects(api.pull(),{code:'permission-denied'});api.close();
});
test('GitHub Pages popup block does not use unreliable cross-origin redirect unless explicitly configured',async()=>{
  const h=harness({popupError:'auth/popup-blocked'}),api=await h.make();
  await assert.rejects(api.signIn(),{code:'auth/popup-blocked'});assert.equal(h.metrics.redirect,0);api.close();
  const ready=await h.make({redirectReady:true});await ready.signIn();assert.equal(h.metrics.redirect,1);ready.close();
});
test('cloud subscriber ignores local cache and emits server head errors for orchestrator recovery',async()=>{
  const h=harness();let emit,fail;h.sdk.onSnapshot=(ref,options,fn,error)=>{emit=fn;fail=error;return ()=>{};};
  const api=await h.make(),values=[];api.subscribe(value=>values.push(value));
  emit({metadata:{fromCache:true},exists:()=>true,data:()=>({version:1})});assert.equal(values.length,0);
  emit({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({version:2})});assert.equal(values[0].version,2);
  fail(new Error('network'));assert.equal(values[1].error.message,'network');api.close();
});
test('invalid private pack identity is rejected before immutable cloud upload',async()=>{
  const h=harness(),api=await h.make(),input=sample();input.packs.push(input.packs[0]);
  await assert.rejects(api.commit({operationId:'op_device_001',expectedVersion:0,snapshot:input}),{code:'invalid-snapshot'});
  assert.equal(h.metrics.writes,0);api.close();
});
test('unchanged head requires only fresh server head read and cached snapshots resist caller mutation',async()=>{
  const writer=harness(),source=await writer.make();await source.commit({operationId:'op_device_001',expectedVersion:0,snapshot:sample()});
  const reader=harness({data:writer.data}),target=await reader.make();const first=await target.pull();
  first.snapshot.packs[0].payload.articles[0].zh='caller changed';first.snapshot.state.reader.currentKey='caller changed';
  const before=reader.metrics.reads,second=await target.pull();assert.equal(reader.metrics.reads-before,1);
  assert.equal(second.snapshot.state.reader.currentKey,'original/7');assert.equal(second.snapshot.packs[0].payload.articles[0].zh,'私人');
  source.close();target.close();
});
test('remote reader-only head refresh reuses verified private pack and other state component caches',async()=>{
  const writer=harness(),source=await writer.make(),input=sample();input.packs[0].payload.large='中文😀'.repeat(200000);
  await source.commit({operationId:'op_device_001',expectedVersion:0,snapshot:input});
  const reader=harness({data:writer.data}),target=await reader.make();await target.pull();
  const next=copy(input);next.state.reader.currentKey='original/8';
  await source.commit({operationId:'op_device_002',expectedVersion:1,snapshot:next});
  const before=reader.metrics.reads,paths=reader.metrics.readPaths.length,result=await target.pull();
  assert.equal(result.snapshot.state.reader.currentKey,'original/8');assert.equal(result.snapshot.packs[0].payload.large,input.packs[0].payload.large);
  assert.equal(reader.metrics.reads-before,4); // head, new manifest, manifest text, reader text
  const refreshed=reader.metrics.readPaths.slice(paths);assert.equal(refreshed.filter(path=>path.includes('/chunks/')).length,2);
  source.close();target.close();
});
test('a hung server read times out, retry reuses the request and later recovers without writes',async t=>{
  const h=harness();let finish,calls=0;
  h.sdk.getDocFromServer=()=>{calls++;return new Promise(resolve=>finish=resolve);};
  const api=await h.make(null,{requestTimeoutMs:20});t.after(()=>api.close());
  await assert.rejects(api.pull(),{code:'sync-timeout'});
  await assert.rejects(api.pull(),{code:'sync-timeout'});assert.equal(calls,1);
  const recovered=api.pull();finish({exists:()=>false});
  assert.deepEqual(await recovered,{version:0,snapshot:null});assert.equal(h.metrics.writes,0);
});
test('a late atomic commit is retried with a permanent receipt and publishes once',async t=>{
  const h=harness(),original=h.sdk.runTransaction;let finish,calls=0;
  h.sdk.runTransaction=async(...args)=>{calls++;const result=await original(...args);await new Promise(resolve=>finish=resolve);return result;};
  const api=await h.make(null,{requestTimeoutMs:20});t.after(()=>api.close());
  const request={operationId:'op_timed_out_001',expectedVersion:0,snapshot:sample()};
  await assert.rejects(api.commit(request),{code:'sync-timeout'});
  const retried=await api.commit(request);assert.equal(retried.alreadyCommitted,true);assert.equal(retried.version,1);assert.equal(calls,1);
  finish();assert.equal((await api.pull()).version,1);
});
test('repeated identical server metadata notifications do not schedule another head cycle',async t=>{
  const h=harness();let notify;h.sdk.onSnapshot=(ref,opts,fn)=>{notify=fn;return()=>{};};
  const api=await h.make();t.after(()=>api.close());const heads=[];api.subscribe(value=>heads.push(value));
  const snapshot=()=>({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({version:1,manifestId:'same'})});
  notify(snapshot());notify(snapshot());assert.equal(heads.length,1);
});
