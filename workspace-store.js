/* Commit-aware workspace storage with atomic restore and conflict prevention. */
window.StudyState=(()=>{'use strict';const C=window.StudyWorkspaceCore;let db=null,value=null,timer,writing=Promise.resolve(),revision=0,written=0,warning='',restoring=false,phase='loading',savedAt=0,head=null,stale=false,commitSequence=0,libraryHead=null,libraryRevision=0,libraryWritten=0,pendingReload=null,syncApplying=false;const syncStores=['workspace','packs','syncOutbox','syncMeta'];const owner='page-'+Date.now()+'-'+Math.random().toString(36).slice(2),legacy={reader:'english-study.reader.v1',learning:'english-study.learning.v1'},channel=typeof BroadcastChannel==='function'?new BroadcastChannel('english-study.workspace'):null;
const tokenFor=kind=>owner+':'+kind+':'+(++commitSequence);
function report(p,message=''){phase=p;document.dispatchEvent(new CustomEvent('study-save-state',{detail:{phase:p,message,savedAt}}));}function conflict(){stale=true;warning='另一个页面已更新学习数据。请先导出本页未保存内容，再重新打开页面。';report('conflict',warning);}
// A library token is committed with workspace + packs, never trusted from a broadcast.
const libraryVersion=saved=>typeof saved?.libraryToken==='string'?saved.libraryToken:null;
function syncLock(){document.dispatchEvent(new CustomEvent('study-sync-applying',{detail:{active:syncApplying||!!pendingReload,pendingReload:!!pendingReload}}));}
function ensureReady(){if(syncApplying)throw Error('正在应用云端记录，请稍后重试。');if(pendingReload)throw Error('页面状态刷新未完成，请重试保存或重新打开页面；本机已提交记录保持不变。');}
// Register acknowledged consumers: native dispatchEvent does not propagate listener errors.
function onReload(consumer){const listener=e=>e.detail.waitUntil(Promise.resolve().then(()=>consumer(e.detail)));document.addEventListener('study-state-reloaded',listener);return ()=>document.removeEventListener('study-state-reloaded',listener);}
async function applyReload(detail){
 pendingReload=detail;syncLock();report('loading','正在刷新其他页面的记录…');const acknowledgements=[];
 try{document.dispatchEvent(new CustomEvent('study-state-reloaded',{detail:{...detail,waitUntil:p=>acknowledgements.push(Promise.resolve(p))}}));const results=await Promise.allSettled(acknowledgements),failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;if(acknowledgements.length)pendingReload=null;}
 catch(e){throw Error('页面状态刷新失败，请重试保存；若仍失败请重新打开页面。本机记录未改动。'+e.message);}finally{syncLock();}
}
// Notifications are hints; read the committed database head before deciding.
if(channel)channel.onmessage=e=>{if(e.data?.owner && e.data.owner!==owner && e.data.token)refresh().catch(()=>{});};
window.addEventListener('focus',()=>refresh().catch(()=>{}));
function refresh(){
 writing=writing.catch(()=>{}).then(async()=>{
  if(!value||!db)return false;
  let saved,packRecords;
  // Keep both stores in the transaction scope. Queue getAll only if the committed
  // library token changed; its request remains in this same consistent snapshot.
  await transaction(['workspace','packs'],'readonly',tx=>{
   const q=tx.objectStore('workspace').get('current');q.onsuccess=()=>{
    saved=q.result;
    if(saved?.data&&(saved.token||null)!==head&&revision===written&&!restoring&&(!libraryVersion(saved)||libraryVersion(saved)!==libraryHead)){
     const p=tx.objectStore('packs').getAll();p.onsuccess=()=>packRecords=p.result;
    }
   };
  });
  if(!saved?.data)return false;
  const changed=(saved.token||null)!==head;
  if(!changed&&!pendingReload){if(revision===written&&!stale){warning='';report('saved');}return false;}
  if(revision!==written||restoring){conflict();throw Error(warning);}
  const detail={...pendingReload,token:saved.token||null,libraryToken:libraryVersion(saved),packs:packRecords??pendingReload?.packs};
  if(changed){value=C.clone(saved.data);value.extra={...C.emptyExtra(),...value.extra};head=detail.token;libraryHead=detail.libraryToken;savedAt=saved.savedAt||0;stale=false;warning='';mirror(value);}
  await applyReload(detail);
  warning='';report(pendingReload?'loading':'saved');return true;
 });
 writing.catch(failed);return writing;
}
function readLegacy(k,fallback){try{return JSON.parse(localStorage.getItem(legacy[k])||'null')||fallback;}catch{return fallback;}}const defaults=()=>({reader:readLegacy('reader',{}),learning:window.StudyLearningCore.load(readLegacy('learning',null)),extra:C.emptyExtra()});
function mirror(v){for(const k of Object.keys(legacy))try{localStorage.setItem(legacy[k],JSON.stringify(v[k]));}catch{}}
async function open(){if(value)return;value=defaults();db=await new Promise(resolve=>{let settled=false;const done=v=>{if(settled){v?.close();return;}settled=true;clearTimeout(t);resolve(v);},t=setTimeout(()=>done(null),4000);try{const q=indexedDB.open('english-study.packages.v1',3);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('packs'))q.result.createObjectStore('packs',{keyPath:'key'});if(!q.result.objectStoreNames.contains('workspace'))q.result.createObjectStore('workspace',{keyPath:'key'});if(!q.result.objectStoreNames.contains('syncOutbox'))q.result.createObjectStore('syncOutbox',{keyPath:'key'});if(!q.result.objectStoreNames.contains('syncMeta'))q.result.createObjectStore('syncMeta',{keyPath:'key'});};q.onsuccess=()=>{q.result.onversionchange=()=>{q.result.close();db=null;warning='数据结构已更新，请导出本页后重新打开。';report('error',warning);};done(q.result);};q.onerror=q.onblocked=()=>done(null);}catch{done(null);}});if(db)try{const saved=await transaction(['workspace'],'readonly',tx=>tx.objectStore('workspace').get('current'));if(saved?.data){head=saved.token||null;libraryHead=libraryVersion(saved);savedAt=saved.savedAt||0;value=saved.data;value.extra={...C.emptyExtra(),...value.extra};}else{revision++;await flush();}await transaction(['syncMeta'],'readwrite',tx=>mutate(tx,()=>{},{queue:false}));}catch(e){warning='读取或迁移失败，旧记录仍保留。'+e.message;report('error',warning);}if(!db){warning='浏览器未允许持久保存，记录仅在本页暂存。';report('error',warning);}else if(!warning)report('saved');}
function transaction(stores,mode,action){return new Promise((resolve,reject)=>{if(!db){reject(Error('浏览器未允许本机保存，请导出备份。'));return;}try{const tx=db.transaction(stores,mode);let result;const req=action(tx);if(req)req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx._syncFailure||tx.error||Error('保存事务失败，原记录保持不变。'));}catch(e){reject(e);}});}
function guarded(tx,action){const q=tx.objectStore('workspace').get('current');q.onsuccess=()=>{if(stale||(q.result?.token||null)!==head){conflict();tx.abort();return;}action();};}
function get(k,fallback){return value?.[k]??fallback;}function set(k,v){ensureReady();if(restoring)return false;if(JSON.stringify(value[k])===JSON.stringify(v))return !!db;if(k==='extra'&&JSON.stringify(value.extra?.edits||{})!==JSON.stringify(v?.edits||{}))libraryRevision++;value[k]=C.clone(v);revision++;report(stale?'conflict':'saving',warning);clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),120);return !!db;}
function failed(e){warning=stale?warning:e.message;report(stale?'conflict':'error',warning);document.dispatchEvent(new CustomEvent('study-storage-warning',{detail:warning}));}
// Sync metadata and operation IDs are allocated inside the same transaction as
// the business mutation. Aborts roll back the sequence and queue together.
// Large immutable synchronization payloads are separate from the small allocation
// header. Ordinary learning saves never read or rewrite base/flight/recovery.
const heavyMeta=['base','flight','recovery','conflicts'],heavyKey=k=>'payload:'+k;
function mutate(tx,action,{queue=true,kind='state',full=false}={}){
 let result;const store=tx.objectStore('syncMeta'),q=store.get('current');
 const abort=e=>{tx._syncFailure=e;tx.abort();};
 q.onsuccess=()=>{try{
  const meta=q.result||{key:'current',deviceId:'device-'+Date.now()+'-'+Math.random().toString(36).slice(2),seq:0,boundUid:null,generation:0};
  if(typeof meta.deviceId!=='string'||!/^[A-Za-z0-9_-]{8,130}$/.test(meta.deviceId)||!Number.isSafeInteger(meta.seq)||meta.seq<0||meta.seq>=Number.MAX_SAFE_INTEGER)throw Error('同步设备标识或序号无效，请导出备份后检查本机记录。');
  // Compatible with earlier development snapshots embedding payloads in current.
  for(const k of heavyMeta)if(Object.hasOwn(meta,k)){store.put({key:heavyKey(k),data:meta[k]});delete meta[k];}
  const original=new Map();
  function save(){
   const header={...meta};for(const k of heavyMeta){delete header[k];if(full){if(Object.hasOwn(meta,k)){if(!original.has(k)||original.get(k)!==meta[k])store.put({key:heavyKey(k),data:meta[k]});}else if(original.has(k))store.delete(heavyKey(k));}}
   store.put(header);
  }
  function perform(){try{
   if(queue){meta.seq++;const operationId=meta.deviceId+':'+meta.seq;result={key:operationId,operationId,seq:meta.seq,uid:meta.boundUid||null,generation:meta.generation||0,kind,at:Date.now()};tx.objectStore('syncOutbox').put(result);}
   if(action(meta,result,save)!==false)save();
  }catch(e){abort(e);}}
  if(full){const requested=Array.isArray(full)?full:heavyMeta;let remaining=requested.length;if(!remaining)perform();for(const k of requested){const p=store.get(heavyKey(k));p.onsuccess=()=>{if(p.result){meta[k]=p.result.data;original.set(k,meta[k]);}if(!--remaining)perform();};}}
  else perform();
 }catch(e){abort(e);}};
 return ()=>result;
}
function enqueue(action){writing=writing.catch(()=>{}).then(action);writing.catch(failed);return writing;}
function notifyLocal(token,operation){channel?.postMessage({owner,token});document.dispatchEvent(new CustomEvent('study-local-commit',{detail:{token,operationId:operation?.operationId}}));}
function flush(){clearTimeout(timer);return enqueue(async()=>{ensureReady();if(stale)throw Error(warning);if(written===revision)return;if(!db)throw Error('记录仅在本页暂存，未能写入浏览器。');const target=revision,snapshot=C.clone(value),token=tokenFor('state'),libraryTarget=libraryRevision,libraryToken=libraryHead&&libraryWritten===libraryTarget?libraryHead:token,at=Date.now();let operation;report('saving');await transaction(syncStores,'readwrite',tx=>guarded(tx,()=>mutate(tx,(meta,op)=>{operation=op;op.token=token;tx.objectStore('syncOutbox').put(op);tx.objectStore('workspace').put({key:'current',data:snapshot,token,libraryToken,savedAt:at});})));head=token;libraryHead=libraryToken;libraryWritten=libraryTarget;written=target;savedAt=at;warning='';mirror(snapshot);notifyLocal(token,operation);report(written===revision?'saved':'saving');});}
async function packs(){return transaction(['packs'],'readonly',tx=>tx.objectStore('packs').getAll());}
async function writePacks(action){await flush();return enqueue(async()=>{ensureReady();const token=tokenFor('packages'),at=Date.now(),snapshot=C.clone(value),target=revision;let operation;await transaction(syncStores,'readwrite',tx=>guarded(tx,()=>mutate(tx,(meta,op)=>{operation=op;op.token=token;tx.objectStore('syncOutbox').put(op);action(tx.objectStore('packs'));tx.objectStore('workspace').put({key:'current',data:snapshot,token,libraryToken:token,savedAt:at});},{kind:'packages'})));head=token;libraryHead=token;savedAt=at;written=target;notifyLocal(token,operation);report(written===revision?'saved':'saving');});}
async function restore(backup,base){if(restoring)throw Error('正在恢复，请稍候。');const valid=C.validateBackup(backup);if(!valid.ok)throw Error(valid.errors[0]);await flush();return enqueue(async()=>{ensureReady();restoring=true;try{const data=C.clone(backup.state),token=tokenFor('restore'),at=Date.now();let operation;data.extra={...C.emptyExtra(),...data.extra};if(!data.extra.edits.original&&C.hash(base)!==C.hash(backup.base))data.extra.edits.original={payload:C.clone(backup.base),baseHash:C.hash(base),restored:true,at};await transaction(syncStores,'readwrite',tx=>guarded(tx,()=>{const before=tx.objectStore('packs').getAll();before.onsuccess=()=>mutate(tx,(meta,op)=>{operation=op;op.token=token;tx.objectStore('syncOutbox').put(op);const p=tx.objectStore('packs'),w=tx.objectStore('workspace');w.put({key:'rollback',data:C.clone(value),packs:before.result});p.clear();backup.packs.forEach(payload=>p.put({key:'local:'+payload.id,source:'local',payload:C.clone(payload)}));w.put({key:'current',data,token,libraryToken:token,savedAt:at});},{kind:'restore'});}));head=token;libraryHead=token;savedAt=at;value=data;revision++;written=revision;warning='';mirror(value);notifyLocal(token,operation);report('saved');}finally{restoring=false;}});}
async function rollback(){await flush();return enqueue(async()=>{ensureReady();restoring=true;try{let data,operation;const token=tokenFor('rollback'),at=Date.now();await transaction(syncStores,'readwrite',tx=>guarded(tx,()=>{const old=tx.objectStore('workspace').get('rollback');old.onsuccess=()=>{if(!old.result){tx._syncFailure=Error('没有可回退的恢复记录。');tx.abort();return;}mutate(tx,(meta,op)=>{operation=op;op.token=token;tx.objectStore('syncOutbox').put(op);const p=tx.objectStore('packs'),w=tx.objectStore('workspace');data=C.clone(old.result.data);p.clear();old.result.packs.forEach(r=>p.put(r));w.put({key:'current',data,token,libraryToken:token,savedAt:at});w.delete('rollback');},{kind:'rollback'});};}));head=token;libraryHead=token;savedAt=at;value=data;value.extra={...C.emptyExtra(),...value.extra};revision++;written=revision;warning='';mirror(value);notifyLocal(token,operation);report('saved');}finally{restoring=false;}});}
async function readSync(){
 let snapshot={token:null,state:null,packs:[],pending:[],meta:null,rollback:null},payloads={};
 await transaction(syncStores,'readonly',tx=>{
  const w=tx.objectStore('workspace').get('current'),p=tx.objectStore('packs').getAll(),o=tx.objectStore('syncOutbox').getAll(),m=tx.objectStore('syncMeta').get('current'),r=tx.objectStore('workspace').get('rollback');
  for(const key of heavyMeta){const q=tx.objectStore('syncMeta').get(heavyKey(key));q.onsuccess=()=>{if(q.result)payloads[key]=q.result.data;};}
  r.onsuccess=()=>snapshot.rollback=r.result||null;w.onsuccess=()=>{snapshot.token=w.result?.token||null;snapshot.state=w.result?.data||null;};p.onsuccess=()=>snapshot.packs=p.result;o.onsuccess=()=>snapshot.pending=o.result;m.onsuccess=()=>snapshot.meta=m.result||null;
 });if(snapshot.meta)snapshot.meta={...snapshot.meta,...payloads};return C.clone(snapshot);
}
function requireUid(meta,uid){if(typeof uid!=='string'||!uid||meta.boundUid!==uid)throw Error('本机学习数据未绑定此账号，不能同步。请使用原账号。');}
async function bindUid(uid){if(typeof uid!=='string'||!uid)throw Error('账号无效。');return enqueue(async()=>{let answer;await transaction(syncStores,'readwrite',tx=>mutate(tx,meta=>{if(meta.boundUid&&meta.boundUid!==uid)throw Error('本机记录属于另一账号，请使用原账号或独立浏览器。');meta.boundUid=uid;answer=C.clone(meta);},{queue:false}));return answer;});}
async function saveFlight({uid,expectedToken,payload}){
 const immutable=C.clone(payload);return enqueue(async()=>{ensureReady();if(revision!==written||stale||head!==expectedToken)throw Error('同步前本机记录已改变，请重新读取。');let flight;
 await transaction(syncStores,'readwrite',tx=>guarded(tx,()=>mutate(tx,(meta,op,save)=>{requireUid(meta,uid);if(meta.flight){flight=C.clone(meta.flight);return;}const q=tx.objectStore('syncOutbox').getAll();q.onsuccess=()=>{meta.seq++;flight={operationId:meta.deviceId+'_'+meta.seq,uid,generation:meta.generation||0,payload:immutable,ackIds:q.result.map(o=>o.key),expectedToken,at:Date.now()};meta.flight=C.clone(flight);save();};return false;},{queue:false,full:['flight']})));return C.clone(flight);
 });
}
async function applySync({expectedToken,uid,state,packs:records,remoteVersion,base,ackIds=[],ackOperationId=null,conflicts=[],rollback:remoteRollback,followResume=false}){
 const SC=window.StudySyncCore;if(SC){const incoming={state,packs:records};if(remoteRollback!==undefined)incoming.rollback=remoteRollback;for(const snapshot of [incoming,...(base==null?[]:[base])]){const valid=SC.validateSnapshot(snapshot);if(!valid.ok)throw Error(valid.errors[0]);}}
 const errors=C.validateState(state);if(errors.length)throw Error(errors[0]);if(!Array.isArray(records)||records.some(r=>!r||typeof r.key!=='string'||!r.payload||(window.StudyPack?.validate&&!window.StudyPack.validate(r.payload).ok))||new Set(records.map(r=>r.key)).size!==records.length)throw Error('云端资料格式无效。');
 const next=C.clone(state),nextPacks=C.clone(records),nextBase=C.clone(base??null),nextConflicts=C.clone(conflicts),ids=[...new Set(ackIds)],nextRollback=remoteRollback===undefined?undefined:C.clone(remoteRollback);
 let committedPacks;return enqueue(async()=>{ensureReady();if(stale||revision!==written||head!==expectedToken)throw Error('云端合并时本机已有新记录，请重新合并。');const token=tokenFor('cloud'),at=Date.now();syncApplying=true;syncLock();try{
 await transaction(syncStores,'readwrite',tx=>guarded(tx,()=>{const old=tx.objectStore('packs').getAll(),undo=tx.objectStore('workspace').get('rollback');let oldRollback;undo.onsuccess=()=>oldRollback=undo.result||null;old.onsuccess=()=>mutate(tx,meta=>{requireUid(meta,uid);const flight=meta.flight;if(ackOperationId&&flight?.operationId!==ackOperationId)throw Error('云端操作确认与本机待同步批次不一致。');if(ids.length&&(!flight||ids.some(id=>!flight.ackIds.includes(id))))throw Error('云端确认操作不属于当前待同步批次。');const w=tx.objectStore('workspace'),p=tx.objectStore('packs'),o=tx.objectStore('syncOutbox');meta.recovery={token:head,state:C.clone(value),packs:old.result,rollback:oldRollback,at};if(nextRollback===null)w.delete('rollback');else if(nextRollback!==undefined)w.put({...nextRollback,key:'rollback'});committedPacks=[...old.result.filter(r=>r.source==='published'&&!nextPacks.some(n=>n.key===r.key)),...nextPacks];p.clear();committedPacks.forEach(r=>p.put(r));w.put({key:'current',data:next,token,libraryToken:token,savedAt:at});ids.forEach(id=>o.delete(id));meta.remoteVersion=remoteVersion;meta.base=nextBase;meta.conflicts=nextConflicts;if(flight&&(ackOperationId===flight.operationId||flight.ackIds.length>0&&flight.ackIds.every(id=>ids.includes(id))))delete meta.flight;},{queue:false,full:['flight']});}));
 value=next;value.extra={...C.emptyExtra(),...value.extra};head=libraryHead=token;savedAt=at;revision++;written=revision;libraryWritten=libraryRevision;stale=false;warning='';mirror(value);channel?.postMessage({owner,token});
 await applyReload({token,libraryToken:token,packs:committedPacks,cloud:true,source:'cloud',followResume});report(pendingReload?'loading':'saved');return {token};}finally{syncApplying=false;syncLock();}
 });
}
// Only when the caller's merged business snapshot is already the current local
// commit: confirm receipt without touching packs, library version or running UI.
async function confirmSync({expectedToken,uid,base,remoteVersion,ackIds=[],ackOperationId=null,conflicts=[]}){
 const SC=window.StudySyncCore;if(SC&&base!=null){const valid=SC.validateSnapshot(base);if(!valid.ok)throw Error(valid.errors[0]);}
 const nextBase=C.clone(base??null),nextConflicts=C.clone(conflicts),ids=[...new Set(ackIds)];
 return enqueue(async()=>{ensureReady();if(stale||revision!==written||head!==expectedToken)throw Error('确认同步时本机已有新记录，请重新读取。');
  await transaction(syncStores,'readwrite',tx=>guarded(tx,()=>mutate(tx,meta=>{
   requireUid(meta,uid);const flight=meta.flight;
   if(ackOperationId&&flight?.operationId!==ackOperationId)throw Error('云端操作确认与本机待同步批次不一致。');
   if(ids.length&&(!flight||ids.some(id=>!flight.ackIds.includes(id))))throw Error('云端确认操作不属于当前待同步批次。');
   ids.forEach(id=>tx.objectStore('syncOutbox').delete(id));meta.base=nextBase;meta.remoteVersion=remoteVersion;meta.conflicts=nextConflicts;
   if(flight&&(ackOperationId===flight.operationId||flight.ackIds.length>0&&flight.ackIds.every(id=>ids.includes(id))))delete meta.flight;
  },{queue:false,full:['flight']})));warning='';report('saved');return {token:head};
 });
}
async function abandonFlight({uid,operationId,reason}){if(reason!=='remote-conflict')throw Error('仅确认云端拒绝的冲突批次可撤回；未收到确认时必须重试。');return enqueue(async()=>{await transaction(syncStores,'readwrite',tx=>mutate(tx,meta=>{requireUid(meta,uid);if(meta.flight?.operationId!==operationId)throw Error('待同步批次已改变。');delete meta.flight;},{queue:false,full:['flight']}));});}
async function writeConflicts({uid,expectedToken,conflicts}){const saved=C.clone(conflicts);return enqueue(async()=>{ensureReady();if(revision!==written||stale||head!==expectedToken)throw Error('记录已改变，请重新读取。');await transaction(syncStores,'readwrite',tx=>guarded(tx,()=>mutate(tx,meta=>{requireUid(meta,uid);meta.conflicts=saved;},{queue:false,full:[]})));});}
window.addEventListener('pagehide' ,()=>flush().catch(()=>{}));return {open,get,set,flush,restore,rollback,packs,writePacks,transaction,database:()=>db,warning:()=>warning,status:()=>({phase,message:warning,savedAt}),refresh,onReload,readSync,bindUid,saveFlight,applySync,confirmSync,abandonFlight,writeConflicts,canSync:()=>!!db&&!syncApplying&&!restoring&&!pendingReload&&!stale&&revision===written,libraryVersion:()=>libraryHead,retry:async()=>{await refresh();return flush();}};})();
