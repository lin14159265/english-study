/* One IndexedDB transaction owns restore: packages, state and rollback snapshot. */
window.StudyState=(()=>{
  'use strict';const C=window.StudyWorkspaceCore;
  let db=null,value=null,timer,writing=Promise.resolve(),revision=0,written=0,warning='',restoring=false;
  const legacy={reader:'english-study.reader.v1',learning:'english-study.learning.v1'};
  function readLegacy(k,fallback){try{return JSON.parse(localStorage.getItem(legacy[k])||'null')||fallback;}catch{return fallback;}}
  const defaults=()=>({reader:readLegacy('reader',{}),learning:window.StudyLearningCore.load(readLegacy('learning',null)),extra:C.emptyExtra()});
  async function open(){
    if(value)return;value=defaults();
    db=await new Promise(resolve=>{let settled=false;const done=v=>{if(settled){v?.close();return;}settled=true;clearTimeout(t);resolve(v);};const t=setTimeout(()=>done(null),4000);try{
      const q=indexedDB.open('english-study.packages.v1',2);
      q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('packs'))q.result.createObjectStore('packs',{keyPath:'key'});if(!q.result.objectStoreNames.contains('workspace'))q.result.createObjectStore('workspace',{keyPath:'key'});};
      q.onsuccess=()=>{q.result.onversionchange=()=>q.result.close();done(q.result);};q.onerror=q.onblocked=()=>done(null);
    }catch{done(null);}});
    if(db)try{const saved=await transaction(['workspace'],'readonly',tx=>tx.objectStore('workspace').get('current'));if(saved?.data){value=saved.data;value.extra={...C.emptyExtra(),...value.extra};}else{revision++;await flush();}}catch{warning='统一数据读取或迁移失败，旧记录仍保留。';}
  }
  function transaction(stores,mode,action){return new Promise((resolve,reject)=>{if(!db){reject(new Error('浏览器未允许 IndexedDB 保存，请保留备份文件。'));return;}try{const tx=db.transaction(stores,mode);let result;const req=action(tx);if(req)req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||new Error('保存事务失败，原记录保持不变。'));}catch(e){reject(e);}});}
  function get(k,fallback){return value?.[k]??fallback;}
  function set(k,v){if(restoring)return;value[k]=C.clone(v);revision++;
    if(legacy[k])try{localStorage.setItem(legacy[k],JSON.stringify(v));}catch{}
    clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),120);return !!db;
  }
  function flush(){clearTimeout(timer);writing=writing.catch(()=>{}).then(async()=>{if(written===revision)return;if(!db){throw new Error('浏览器未允许持久保存，记录仅暂存在本页。');}const target=revision,snapshot=C.clone(value);await transaction(['workspace'],'readwrite',tx=>tx.objectStore('workspace').put({key:'current',data:snapshot}));written=target;});writing.catch(e=>{warning=e.message;document.dispatchEvent(new CustomEvent('study-storage-warning',{detail:warning}));});return writing;}
  async function packs(){return await transaction(['packs'],'readonly',tx=>tx.objectStore('packs').getAll());}
  async function restore(backup,base){
    if(restoring)throw new Error('正在恢复，请稍候。');const valid=C.validateBackup(backup);if(!valid.ok)throw new Error(valid.errors[0]);await flush();restoring=true;
    try{const before=await packs(),data=C.clone(backup.state);if(C.hash(base)!==C.hash(backup.base))data.extra.edits.original={payload:C.clone(backup.base),baseHash:C.hash(base),restored:true,at:Date.now()};
      await transaction(['packs','workspace'],'readwrite',tx=>{const p=tx.objectStore('packs'),w=tx.objectStore('workspace');w.put({key:'rollback',data:C.clone(value),packs:before});p.clear();backup.packs.forEach(payload=>p.put({key:`local:${payload.id}`,source:'local',payload:C.clone(payload)}));w.put({key:'current',data});});
      value=data;revision++;written=revision;for(const k of Object.keys(legacy))try{localStorage.setItem(legacy[k],JSON.stringify(value[k]));}catch{}
    }finally{restoring=false;}
  }
  async function rollback(){await flush();const old=await transaction(['workspace'],'readonly',tx=>tx.objectStore('workspace').get('rollback'));if(!old)throw new Error('没有可回退的恢复记录。');restoring=true;try{await transaction(['packs','workspace'],'readwrite',tx=>{const p=tx.objectStore('packs');p.clear();old.packs.forEach(r=>p.put(r));tx.objectStore('workspace').put({key:'current',data:old.data});tx.objectStore('workspace').delete('rollback');});value=old.data;revision++;written=revision;}finally{restoring=false;}}
  window.addEventListener('pagehide',()=>flush().catch(()=>{}));
  return {open,get,set,flush,restore,rollback,packs,transaction,database:()=>db,warning:()=>warning};
})();
