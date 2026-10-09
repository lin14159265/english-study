const {test}=require('node:test'),assert=require('node:assert/strict');
const Cloud=require('../cloud-sync'),Core=require('../sync-core'),W=require('../workspace-core'),L=require('../learning-core');
const copy=x=>structuredClone(x),wait=()=>new Promise(r=>setImmediate(r));
const fresh=()=>({state:{reader:{currentKey:'original/1',resumeKey:'original/1',readKeys:[],positionKeys:{},settings:{theme:'system',fontSize:21,lineHeight:1.95,fontFamily:'serif',highlight:true,focus:false}},learning:L.empty(),extra:W.emptyExtra()},packs:[],rollback:null});
function backend(initial=null){
  const db={version:initial?1:0,snapshot:copy(initial),receipts:new Map(),commits:[],beforeCommit:null,loseReceipt:false};
  db.adapter=()=>{let user={uid:'owner',email:'owner@test'},auth;
    return {user:()=>user,onAuth(fn){auth=fn;queueMicrotask(()=>fn(user));return ()=>{};},signIn:async()=>{user={uid:'owner'};auth(user);},signOut:async()=>{user=null;auth(null);},subscribe:()=>()=>{},pull:async()=>({version:db.version,snapshot:copy(db.snapshot)}),
      commit:async request=>{db.commits.push(copy(request));if(db.beforeCommit){const fn=db.beforeCommit;db.beforeCommit=null;await fn(request);}
        const prior=db.receipts.get(request.operationId);if(prior){assert.ok(Core.equal(prior.snapshot,request.snapshot));return {version:prior.version};}
        if(db.version!==request.expectedVersion)throw Object.assign(Error('stale'),{code:'remote-conflict'});
        db.version++;db.snapshot=copy(request.snapshot);db.receipts.set(request.operationId,{version:db.version,snapshot:copy(request.snapshot)});
        if(db.loseReceipt){db.loseReceipt=false;throw Object.assign(Error('lost acknowledgement'),{code:'unavailable'});}
        return {version:db.version};}
    };
  };return db;
}
function store(initial=fresh(),bound=null){
  const r={token:'t0',state:copy(initial.state),packs:copy(initial.packs),rollback:copy(initial.rollback),pending:[],meta:{boundUid:bound,base:null,remoteVersion:0,seq:0,conflicts:[]}};
  let seq=0,healthy=true,applyError=null;const applied=[],confirmed=[];
  return {r,applied,confirmed,status:()=>({phase:healthy?'saved':'loading',message:healthy?'':'UI refresh failed'}),flush:async()=>{},readSync:async()=>copy(r),canSync:()=>healthy,
    bindUid:async uid=>{if(r.meta.boundUid&&r.meta.boundUid!==uid)throw Error('different account');r.meta.boundUid=uid;},
    saveFlight:async({uid,expectedToken,payload})=>{assert.equal(r.token,expectedToken);assert.equal(uid,r.meta.boundUid);return copy(r.meta.flight||= {operationId:'test_device_'+(++r.meta.seq),payload:copy(payload),ackIds:r.pending.map(p=>p.key)});},
    writeConflicts:async({expectedToken,conflicts})=>{assert.equal(r.token,expectedToken);r.meta.conflicts=copy(conflicts);},
    abandonFlight:async({operationId,reason})=>{assert.equal(reason,'remote-conflict');assert.equal(operationId,r.meta.flight.operationId);delete r.meta.flight;},
    applySync:async arg=>{assert.equal(arg.expectedToken,r.token);assert.equal(arg.uid,r.meta.boundUid);const flight=r.meta.flight;applied.push(copy(arg));r.state=copy(arg.state);r.packs=copy(arg.packs);r.rollback=copy(arg.rollback);r.meta.base=copy(arg.base);r.meta.remoteVersion=arg.remoteVersion;r.meta.conflicts=copy(arg.conflicts||[]);r.pending=r.pending.filter(p=>!arg.ackIds?.includes(p.key));if(arg.ackOperationId){assert.equal(arg.ackOperationId,flight.operationId);delete r.meta.flight;}r.token='t'+(++seq);if(applyError){healthy=false;throw applyError;}},
    confirmSync:async arg=>{assert.equal(arg.expectedToken,r.token);assert.equal(arg.uid,r.meta.boundUid);confirmed.push(copy(arg));if(arg.ackOperationId)assert.equal(arg.ackOperationId,r.meta.flight.operationId);r.meta.base=copy(arg.base);r.meta.remoteVersion=arg.remoteVersion;r.meta.conflicts=copy(arg.conflicts||[]);r.pending=r.pending.filter(p=>!arg.ackIds?.includes(p.key));if(arg.ackOperationId)delete r.meta.flight;},
    change:fn=>{fn(r);r.token='t'+(++seq);r.pending.push({key:'hint_'+seq});},breakUI:()=>{applyError=Error('UI refresh failed');},repairUI:()=>{healthy=true;applyError=null;}
  };
}
async function controller(s,b,options={}){const statuses=[];const c=Cloud.create({store:s,core:Core,adapter:b.adapter(),allowedUid:'owner',onStatus:value=>statuses.push(value),delay:100000,autoSchedule:false,...options});await wait();await wait();return {c,statuses};}
async function drain(c,count=4){for(let i=0;i<count;i++)await c.syncNow();}
test('fresh default reader is automatically restored, including private state and settings',async t=>{
  const remote=fresh();remote.state.reader.resumeKey='missing/story';remote.state.reader.positionKeys['missing/story']=500;remote.state.reader.settings.fontSize=25;remote.state.extra.personalFuture={notes:['private']};
  const b=backend(remote),s=store();assert.equal(Cloud.meaningful(fresh()),false);const {c}=await controller(s,b,{followResume:()=>true});t.after(()=>c.close());await drain(c);assert.deepEqual(Cloud.wire(s.r),remote);assert.equal(s.applied[0].followResume,true);assert.equal(s.r.meta.boundUid,'owner');
});
test('meaningful preferences and migration history count as existing personal data',()=>{
  let x=fresh();x.state.learning.guessMode=true;assert.equal(Cloud.meaningful(x),true);x=fresh();x.state.learning.migrated=['old-card'];assert.equal(Cloud.meaningful(x),true);x=fresh();x.state.reader.settings.theme='dark';assert.equal(Cloud.meaningful(x),true);x=fresh();x.state.reader.resumeKey='original/7';assert.equal(Cloud.meaningful(x),true);
});
test('first existing local account requires confirmed backup and blank cloud retains all state',async t=>{
  const x=fresh();x.state.extra.personalFuture={note:'keep'};const s=store(x),b=backend(),{c}=await controller(s,b);t.after(()=>c.close());assert.equal(c.status().phase,'migration');await c.syncNow();assert.equal(b.commits.length,0);await assert.rejects(c.enable(false),{code:'backup-required'});await c.enable(true);await drain(c);assert.deepEqual(b.snapshot,x);assert.equal(s.r.pending.length,0);assert.equal(s.r.meta.flight,undefined);assert.equal(c.status().phase,'synced');
});
test('persistent unknown-outcome flight retries exact op ID after page/controller restart',async t=>{
  const s=store(fresh(),'owner'),b=backend();s.change(r=>r.state.extra.personalFuture={note:'offline'});b.loseReceipt=true;let {c}=await controller(s,b);await c.syncNow();assert.ok(s.r.meta.flight);const id=s.r.meta.flight.operationId;c.close();({c}=await controller(s,b));t.after(()=>c.close());await drain(c);assert.equal(b.version,1);assert.equal(b.commits[0].operationId,id);assert.equal(b.commits[1].operationId,id);assert.equal(s.r.meta.flight,undefined);assert.equal(s.r.pending.length,0);
});
test('local changes during upload are preserved and newer hints remain for next flight',async t=>{
  const s=store(fresh(),'owner'),b=backend();s.change(r=>r.state.extra.personalFuture={first:true});b.beforeCommit=async()=>s.change(r=>r.state.extra.newField={second:true});const {c}=await controller(s,b);t.after(()=>c.close());await c.syncNow();assert.equal(s.r.state.extra.newField.second,true);assert.equal(s.r.pending.length,1);await drain(c);assert.equal(b.snapshot.state.extra.newField.second,true);assert.equal(s.r.pending.length,0);
});
test('definitive remote CAS rejection abandons only rejected flight and recomputes merge',async t=>{
  const s=store(fresh(),'owner'),b=backend();s.change(r=>r.state.extra.localOnly={a:1});b.beforeCommit=async()=>{b.snapshot=fresh();b.snapshot.state.extra.remoteOnly={b:2};b.version=1;};const {c}=await controller(s,b);t.after(()=>c.close());await drain(c,5);assert.equal(b.snapshot.state.extra.localOnly.a,1);assert.equal(b.snapshot.state.extra.remoteOnly.b,2);assert.notEqual(b.commits[0].operationId,b.commits[1].operationId);
});
test('simultaneous draft edit retains alternatives until explicit conflict selection',async t=>{
  const base=fresh();base.state.extra.personalFuture={note:'base'};const s=store(base,'owner'),remote=copy(base);s.r.meta.base=copy(base);s.r.meta.remoteVersion=1;s.change(r=>r.state.extra.personalFuture.note='local');remote.state.extra.personalFuture.note='cloud';const b=backend(remote),{c}=await controller(s,b);t.after(()=>c.close());await c.syncNow();assert.equal(c.status().phase,'conflict');assert.equal(s.r.meta.conflicts[0].result.conflicts[0].remote,'cloud');assert.equal(b.commits.length,0);await c.resolve('local');await drain(c);assert.equal(b.snapshot.state.extra.personalFuture.note,'local');assert.equal(s.r.meta.conflicts.length,0);
});
test('offline edits continue locally and sync on later request without data loss',async t=>{
  const s=store(fresh(),'owner'),b=backend();let connected=false;const {c}=await controller(s,b,{online:()=>connected});t.after(()=>c.close());s.change(r=>r.state.extra.offlineDraft='my work');await c.syncNow();assert.equal(c.status().phase,'offline');assert.equal(b.version,0);connected=true;await drain(c);assert.equal(b.snapshot.state.extra.offlineDraft,'my work');
});
test('signout keeps local records and prevents further automatic cloud writes',async t=>{
  const s=store(fresh(),'owner'),b=backend(),{c}=await controller(s,b);t.after(()=>c.close());await drain(c);const version=b.version;await c.signOut();s.change(r=>r.state.extra.afterLogout='private');await c.syncNow();assert.equal(b.version,version);assert.equal(s.r.state.extra.afterLogout,'private');assert.equal(s.r.meta.boundUid,'owner');
});
test('UI consumer failure after durable ack is shown as pending and can safely retry',async t=>{
  const remote=fresh();remote.state.extra.reloaded='cloud field';const s=store(fresh(),'owner'),b=backend(remote);s.change(r=>r.state.extra.saved='keep');s.breakUI();const {c}=await controller(s,b);t.after(()=>c.close());await c.syncNow();assert.equal(c.status().phase,'local-pending');assert.equal(b.version,2);assert.equal(s.r.meta.flight,undefined);assert.equal(s.r.pending.length,0);s.repairUI();await drain(c);assert.equal(c.status().phase,'synced');assert.equal(b.version,2);
});
test('auth-only bootstrap and a different bound account never access personal cloud data',async t=>{
  const s=store(fresh(),'previous'),b=backend(),{c}=await controller(s,b);t.after(()=>c.close());assert.equal(c.status().phase,'blocked');await c.syncNow();assert.equal(b.version,0);
  const other=await controller(store(),b,{allowedUid:''});t.after(()=>other.c.close());assert.equal(other.c.status().phase,'configuration');await other.c.syncNow();assert.equal(b.version,0);
});
test('conflict choices from a stale upload acknowledgement preview require recheck before applying',async t=>{
  const base=fresh(),remote=copy(base);remote.state.extra.cloudOnly='cloud value';const s=store(base,'owner');s.r.meta.base=copy(base);s.change(r=>r.state.extra.localOnly='keep');const b=backend(remote);
  b.beforeCommit=async()=>s.change(r=>r.state.extra.cloudOnly='local value');const {c}=await controller(s,b);t.after(()=>c.close());await c.syncNow();assert.equal(c.status().phase,'conflict');assert.equal(s.r.meta.conflicts[0].phase,'ack');
  s.change(r=>{r.state.extra.cloudOnly='new local value';r.state.extra.later='preserve';});const applications=s.applied.length;await c.resolve('remote');assert.equal(s.applied.length,applications);assert.equal(s.r.state.extra.cloudOnly,'new local value');assert.equal(s.r.meta.conflicts[0].localToken,s.r.token);
  await c.resolve('local');await drain(c);assert.equal(b.snapshot.state.extra.cloudOnly,'new local value');assert.equal(b.snapshot.state.extra.later,'preserve');
});
test('logout during an in-flight upload retains its exact receipt retry for the same account',async t=>{
  const s=store(fresh(),'owner'),b=backend(),{c}=await controller(s,b);t.after(()=>c.close());s.change(r=>r.state.extra.private='keep');b.beforeCommit=async()=>c.signOut();await c.syncNow();assert.equal(c.status().phase,'signed-out');assert.ok(s.r.meta.flight);assert.equal(b.version,1);assert.equal(s.r.state.extra.private,'keep');await c.signIn();await wait();await drain(c);assert.equal(b.version,1);assert.equal(s.r.meta.flight,undefined);
});
test('own already-committed upload is acknowledged without reloading packs or the running reader',async t=>{
 const s=store(fresh(),'owner'),b=backend();s.change(r=>r.state.extra.ownDraft='keep');const token=s.r.token,{c}=await controller(s,b);t.after(()=>c.close());await drain(c);
 assert.equal(s.applied.length,0);assert.equal(s.confirmed.length,1);assert.equal(s.r.token,token);assert.equal(s.r.pending.length,0);assert.equal(s.r.meta.flight,undefined);assert.equal(c.status().phase,'synced');
});
test('durable upload acknowledgement shows success before a second cloud pull',async t=>{
 const s=store(fresh(),'owner'),b=backend();s.change(r=>r.state.extra.note='saved');const {c}=await controller(s,b);t.after(()=>c.close());
 await c.syncNow();assert.equal(c.status().phase,'synced');assert.equal(s.r.pending.length,0);assert.equal(s.r.meta.flight,undefined);assert.equal(b.version,1);
});
test('a stalled pull reports its stage, never runs a concurrent cycle, and recovers on completion',async t=>{
 const s=store(fresh(),'owner'),b=backend(),adapter=b.adapter();let finish,pulls=0;
 adapter.pull=()=>{pulls++;return new Promise(resolve=>finish=resolve);};
 const {c}=await controller(s,{adapter:()=>adapter},{slowAfter:15});t.after(()=>c.close());
 const pending=c.syncNow();await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(c.status().phase,'waiting');assert.equal(c.diagnostics().stage,'cloud-head');
 await c.syncNow();c.wake();assert.equal(pulls,1);assert.equal(c.diagnostics().running,true);
 finish({version:0,snapshot:null});await pending;assert.equal(c.diagnostics().running,false);assert.equal(c.status().phase,'synced');
});
test('a timeout retains the exact durable flight, releases the cycle and permits retry',async t=>{
 const s=store(fresh(),'owner'),b=backend(),adapter=b.adapter(),commit=adapter.commit;let fail=true;
 adapter.commit=request=>{if(fail){fail=false;return Promise.reject(Object.assign(Error('wait timed out'),{code:'sync-timeout'}));}return commit(request);};
 s.change(r=>r.state.extra.note='retain');const {c}=await controller(s,{adapter:()=>adapter});t.after(()=>c.close());
 await c.syncNow();const id=s.r.meta.flight.operationId;assert.equal(c.status().phase,'offline');assert.equal(c.diagnostics().running,false);assert.equal(s.r.pending.length,1);
 await c.syncNow();assert.equal(b.commits[0].operationId,id);assert.equal(c.status().phase,'synced');assert.equal(s.r.pending.length,0);
});
test('idle version checks retain a distinct acknowledged status while waiting for the server',async t=>{
 const s=store(fresh(),'owner'),b=backend(),adapter=b.adapter();const {c}=await controller(s,{adapter:()=>adapter});t.after(()=>c.close());await drain(c);
 let finish;adapter.pull=()=>new Promise(resolve=>finish=resolve);const pending=c.syncNow();await wait();
 assert.equal(c.status().phase,'checking');assert.ok(c.status().at);finish({version:b.version,snapshot:copy(b.snapshot)});await pending;assert.equal(c.status().phase,'synced');
});
test('late network failure after logout cannot replace the signed-out state',async t=>{
 const s=store(fresh(),'owner'),b=backend(),adapter=b.adapter();let reject;adapter.pull=()=>new Promise((_,no)=>reject=no);
 const {c}=await controller(s,{adapter:()=>adapter});t.after(()=>c.close());const pending=c.syncNow();await wait();await c.signOut();
 reject(Object.assign(Error('late timeout'),{code:'sync-timeout'}));await pending;assert.equal(c.status().phase,'signed-out');
});
