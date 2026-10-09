// Optional real-rules acceptance: needs local Firebase emulator, never a production project.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const resolve=name=>require(process.env.ENGLISH_STUDY_FIREBASE_MODULES?path.join(process.env.ENGLISH_STUDY_FIREBASE_MODULES,name):name);
const {initializeTestEnvironment,assertFails,assertSucceeds}=resolve('@firebase/rules-unit-testing');
const F=resolve('firebase/firestore'),Auth=resolve('firebase/auth');
const A=require('../firebase-adapter');
const Cloud=require('../cloud-sync'),Core=require('../sync-core'),W=require('../workspace-core'),L=require('../learning-core');
let env;
const uid='test-owner',projectId='demo-english-study';
const host=process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8080';
before(async()=>{
  const [hostname,port]=host.split(':');
  env=await initializeTestEnvironment({projectId,firestore:{host:hostname,port:Number(port),rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8').replaceAll('REPLACE_WITH_YOUR_UID',uid)}});
});
after(async()=>{await env?.cleanup();});
const db=(identity=uid,provider='google.com')=>identity?env.authenticatedContext(identity,{firebase:{sign_in_provider:provider}}).firestore():env.unauthenticatedContext().firestore();
const ref=(database,group,id)=>F.doc(database,'users',uid,group,id);
const hash='a'.repeat(64),otherHash='b'.repeat(64),chunk={schema:1,text:'private',bytes:7};
const manifest={schema:1,digest:hash,bytes:7,chunks:[hash]};
const h=(operationId,version,manifestId=hash)=>({schema:1,operationId,version,manifestId,digest:manifestId});
const receipt=(operationId,expectedVersion,manifestId=hash)=>({schema:1,operationId,expectedVersion,version:expectedVersion+1,manifestId,digest:manifestId});
test('Firestore rules deny anonymous, another UID, and password provider reads and writes',async()=>{
  for(const database of [db(null),db('another'),db(uid,'password')]){
    await assertFails(F.getDoc(ref(database,'control','head')));
    await assertFails(F.setDoc(ref(database,'chunks',hash),chunk));
  }
});
test('Firestore rules admit owner immutable chunks and manifests, reject oversize and mutation',async()=>{
  const database=db();
  await assertSucceeds(F.setDoc(ref(database,'chunks',hash),chunk));
  await assertSucceeds(F.setDoc(ref(database,'chunks',hash),chunk));
  await assertFails(F.setDoc(ref(database,'chunks',hash),{...chunk,text:'modified',bytes:8}));
  await assertFails(F.setDoc(ref(database,'chunks',otherHash),{schema:1,text:'x'.repeat(A.CHUNK_BYTES+1),bytes:A.CHUNK_BYTES+1}));
  await assertFails(F.deleteDoc(ref(database,'chunks',hash)));
  await assertSucceeds(F.setDoc(ref(database,'manifests',hash),manifest));
  await assertFails(F.setDoc(ref(database,'manifests',hash),{...manifest,bytes:8}));
});
test('Firestore rules require version CAS and atomic head plus persistent immutable receipt',async()=>{
  const database=db(),head=ref(database,'control','head'),id='atomic_owner_001';
  await assertFails(F.setDoc(head,h(id,1)));
  await assertFails(F.setDoc(ref(database,'receipts',id),receipt(id,0)));
  let batch=F.writeBatch(database);batch.set(head,h(id,1));batch.set(ref(database,'receipts',id),receipt(id,0));await assertSucceeds(batch.commit());
  await assertFails(F.deleteDoc(ref(database,'receipts',id)));
  await assertFails(F.setDoc(ref(database,'receipts',id),receipt(id,1)));
  const stale='atomic_stale_001';batch=F.writeBatch(database);batch.set(head,h(stale,1));batch.set(ref(database,'receipts',stale),receipt(stale,0));await assertFails(batch.commit());
  const next='atomic_owner_002';batch=F.writeBatch(database);batch.set(head,h(next,2));batch.set(ref(database,'receipts',next),receipt(next,1));await assertSucceeds(batch.commit());
  assert.equal((await F.getDoc(ref(database,'receipts',id))).data().version,1);
});
test('Actual modular Firestore SDK adapter round trips huge private pack and persistent operation receipt',async()=>{
  // Test-env issues a Google-provider mock token; real client SDK executes real Rules.
  const database=db();
  const auth={currentUser:{uid,providerData:[{providerId:'google.com'}]}},sdk={...F,
    getApps:()=>[],initializeApp:()=>({}),getAuth:()=>auth,getFirestore:()=>database,
    browserLocalPersistence:{},setPersistence:async()=>{},getRedirectResult:async()=>null,onAuthStateChanged:()=>()=>{},signOut:async()=>{},
    GoogleAuthProvider:Auth.GoogleAuthProvider,signInWithPopup:async()=>({user:auth.currentUser})};
  const config={apiKey:'mock-public',projectId,appId:'mock-public',authDomain:'localhost',allowedUid:uid};
  const adapter=await A.create(config,{loadSDK:async()=>sdk});
  const snapshot={state:{reader:{currentKey:'private/story'},learning:{cards:[{note:'私人生词'}]},extra:{edits:{note:'修订'}}},packs:[{key:'local:huge',payload:{text:'中文😀'.repeat(150000)}}],rollback:{state:{reader:{currentKey:'old'}},packs:[]}};
  const first=await adapter.commit({operationId:'adapter_large_001',expectedVersion:2,snapshot});assert.equal(first.version,3);
  assert.deepEqual((await adapter.pull()).snapshot,snapshot);
  const second={...snapshot,state:{...snapshot.state,reader:{currentKey:'private/new'}}};
  await adapter.commit({operationId:'adapter_large_002',expectedVersion:3,snapshot:second});
  const old=await adapter.commit({operationId:'adapter_large_001',expectedVersion:2,snapshot});assert.equal(old.alreadyCommitted,true);assert.equal(old.version,3);
  await assert.rejects(adapter.commit({operationId:'adapter_stale_001',expectedVersion:2,snapshot}),{code:'remote-conflict'});
  assert.equal((await adapter.pull()).version,4);adapter.close();
});
test('actual Firestore controller handles migration, lost ack, full new-device recovery and disjoint two-device edits',async t=>{
  await env.clearFirestore();
  const copy=x=>structuredClone(x),wait=()=>new Promise(resolve=>setImmediate(resolve));
  const fresh=()=>({state:{reader:{currentKey:'original/1',resumeKey:'original/1',readKeys:[],positionKeys:{},settings:{theme:'system',fontSize:21,lineHeight:1.95,fontFamily:'serif',highlight:true,focus:false}},learning:L.empty(),extra:W.emptyExtra()},packs:[],rollback:null});
  const card=id=>({id,articleKey:'original/1',paragraph:0,word:'measure',wordKey:'measure',sense:'测量',context:'We measure it.',allowed:'测量',created:0});
  function localStore(initial=fresh()){
    const r={token:'t0',state:copy(initial.state),packs:copy(initial.packs),rollback:copy(initial.rollback),pending:[],meta:{boundUid:null,base:null,remoteVersion:0,seq:0,conflicts:[]}};
    let seq=0;const deviceId='device-1700000000000-'+Math.random().toString(36).slice(2),metrics={applied:0,confirmed:0};
    return {r,metrics,status:()=>({phase:'saved'}),flush:async()=>{},readSync:async()=>copy(r),canSync:()=>true,
      bindUid:async identity=>{assert.ok(!r.meta.boundUid||r.meta.boundUid===identity);r.meta.boundUid=identity;},
      saveFlight:async({expectedToken,payload})=>{assert.equal(expectedToken,r.token);return copy(r.meta.flight||={operationId:deviceId+'_'+(++r.meta.seq),payload:copy(payload),ackIds:r.pending.map(item=>item.key)});},
      writeConflicts:async({expectedToken,conflicts})=>{assert.equal(expectedToken,r.token);r.meta.conflicts=copy(conflicts);},
      abandonFlight:async({operationId,reason})=>{assert.equal(reason,'remote-conflict');assert.equal(operationId,r.meta.flight.operationId);delete r.meta.flight;},
      applySync:async arg=>{
        metrics.applied++;
        assert.equal(arg.expectedToken,r.token);assert.equal(arg.uid,r.meta.boundUid);const flight=r.meta.flight;
        r.state=copy(arg.state);r.packs=copy(arg.packs);r.rollback=copy(arg.rollback);r.meta.base=copy(arg.base);r.meta.remoteVersion=arg.remoteVersion;r.meta.conflicts=copy(arg.conflicts||[]);
        r.pending=r.pending.filter(item=>!arg.ackIds?.includes(item.key));
        if(arg.ackOperationId){assert.equal(arg.ackOperationId,flight.operationId);delete r.meta.flight;}
        r.token='t'+(++seq);
      },
      confirmSync:async arg=>{
        assert.equal(arg.expectedToken,r.token);assert.equal(arg.uid,r.meta.boundUid);metrics.confirmed++;
        const flight=r.meta.flight;r.meta.base=copy(arg.base);r.meta.remoteVersion=arg.remoteVersion;r.meta.conflicts=copy(arg.conflicts||[]);
        r.pending=r.pending.filter(item=>!arg.ackIds?.includes(item.key));
        if(arg.ackOperationId){assert.equal(arg.ackOperationId,flight.operationId);delete r.meta.flight;}
      },
      change(fn){fn(r);r.token='t'+(++seq);r.pending.push({key:deviceId+':'+seq});}
    };
  }
  async function realAdapter(){
    const database=db(),auth={currentUser:{uid,providerData:[{providerId:'google.com'}]}};
    const sdk={...F,getApps:()=>[],initializeApp:()=>({}),getAuth:()=>auth,getFirestore:()=>database,browserLocalPersistence:{},setPersistence:async()=>{},getRedirectResult:async()=>null,onAuthStateChanged:()=>()=>{},signOut:async()=>{},GoogleAuthProvider:Auth.GoogleAuthProvider};
    return A.create({apiKey:'mock',projectId,appId:'mock',authDomain:'localhost',allowedUid:uid},{loadSDK:async()=>sdk});
  }
  async function control(store,adapter){const result=Cloud.create({store,core:Core,adapter,allowedUid:uid,autoSchedule:false});await wait();await wait();return result;}
  async function drain(controller){for(let cycle=0;cycle<4;cycle++)await controller.syncNow();assert.equal(controller.status().phase,'synced');}
  const initial=fresh(),payload=JSON.parse(fs.readFileSync(path.join(__dirname,'../downloads/pack-template.json'),'utf8'));
  payload.personalExtension='中文😀'.repeat(150000);initial.packs=[{key:'local:'+payload.id,source:'local',payload}];
  initial.state.reader.readKeys=['missing/story'];initial.state.reader.positionKeys={'missing/story':750};
  initial.state.learning.cards=[card('initial-card')];initial.state.extra.personalFuture={note:'private full state'};
  initial.rollback={data:copy(initial.state),packs:copy(initial.packs)};
  assert.equal(Core.validateSnapshot(initial).ok,true);
  const firstStore=localStore(initial),firstAdapter=await realAdapter(),commit=firstAdapter.commit;
  let loseAck=true;const operationIds=[];
  firstAdapter.commit=async request=>{operationIds.push(request.operationId);const receipt=await commit(request);if(loseAck){loseAck=false;throw Object.assign(Error('lost acknowledgement after real transaction'),{code:'unavailable'});}return receipt;};
  let firstController=await control(firstStore,firstAdapter);t.after(()=>{firstController.close();firstAdapter.close();});
  assert.equal(firstController.status().phase,'migration');await firstController.enable(true);await firstController.syncNow();
  assert.ok(firstStore.r.meta.flight);const inFlight=firstStore.r.meta.flight.operationId;
  firstController.close();firstController=await control(firstStore,firstAdapter);await drain(firstController);
  assert.equal(operationIds[0],inFlight);assert.equal(operationIds[1],inFlight);assert.equal((await firstAdapter.pull()).version,1);
  assert.ok(firstStore.metrics.confirmed>0);assert.equal(firstStore.metrics.applied,0);assert.equal(firstStore.r.token,'t0');
  const secondStore=localStore(),secondAdapter=await realAdapter(),secondController=await control(secondStore,secondAdapter);
  t.after(()=>{secondController.close();secondAdapter.close();});await drain(secondController);
  assert.deepEqual(Cloud.wire(secondStore.r),initial);
  firstStore.change(record=>record.state.learning.cards.push(card('desktop-card')));await drain(firstController);
  secondStore.change(record=>record.state.learning.cards.push(card('mobile-card')));await drain(secondController);await drain(firstController);
  const final=(await firstAdapter.pull()).snapshot;
  assert.deepEqual(new Set(final.state.learning.cards.map(value=>value.id)),new Set(['initial-card','desktop-card','mobile-card']));
  assert.equal(final.packs[0].payload.personalExtension,payload.personalExtension);assert.deepEqual(final.rollback,initial.rollback);
  assert.equal(firstStore.r.pending.length,0);assert.equal(secondStore.r.pending.length,0);
});
