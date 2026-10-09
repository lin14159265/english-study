/* Local-first controller. Immutable flights survive crashes; receipt confirmation is exact. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudyCloudSync=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const fail=(code,message)=>Object.assign(Error(message),{code});
  function wire(record){
    return {state:clone(record.state),packs:clone(record.packs.filter(p=>p.source==='local')),
      rollback:record.rollback?{data:clone(record.rollback.data),packs:clone((record.rollback.packs||[]).filter(p=>p.source==='local'))}:null};
  }
  function meaningful(snapshot){
    if(snapshot.packs.length||snapshot.rollback)return true;
    const {reader:r,learning:l,extra:x}=snapshot.state;
    if((r.resumeKey&&r.resumeKey!=='original/1')||(!r.resumeKey&&r.currentKey&&r.currentKey!=='original/1'))return true;
    if(r.readKeys?.length||r.review?.length||Object.values(r.positionKeys||{}).some(n=>n>0)||Object.values(r.anchorKeys||{}).some(a=>a.paragraph>0||a.offset>0))return true;
    for(const [k,v]of Object.entries(l))if(!['version'].includes(k)&&(Array.isArray(v)?v.length:v&&typeof v==='object'?Object.keys(v).length:v))return true;
    for(const [k,v]of Object.entries(x))if(k!=='lastBackupAt'&&(Array.isArray(v)?v.length:v&&typeof v==='object'?Object.keys(v).length:v))return true;
    const defaults={theme:'system',fontSize:21,lineHeight:1.95,fontFamily:'serif',highlight:true,focus:false};
    return !!r.settings&&Object.entries(r.settings).some(([k,v])=>defaults[k]!==v);
  }
  function create({store:S,core:C,adapter:A,allowedUid,onStatus=()=>{},followResume=()=>false,online=()=>true,clock=()=>Date.now(),delay=5000,slowAfter=20000,autoSchedule=true}){
    let user=null,epoch=0,active=false,running=false,again=false,timer=null,periodic=null,stopAuth=null,stopRemote=null,lastRun=0,retry=0,closed=false,status={phase:'signed-out',message:'未登录；学习记录保存在本机。'};
    const emit=(phase,message,more={})=>{status={phase,message,uid:user?.uid||null,...more};onStatus(status);return status;};
    let stage=null,stageAt=0,slowTimer=null,lastSynced=null,quietCheck=false;
    function slow(){
      if(running&&active&&stage&&clock()-stageAt>=slowAfter)
        emit('waiting',`同步等待较久：${stage.message} 本机记录保留，可继续阅读。`,{stage:stage.code,elapsedMs:clock()-stageAt});
    }
    function step(code,message){
      stage={code,message};stageAt=clock();clearTimeout(slowTimer);
      if(quietCheck&&['cloud-head','local-save'].includes(code))emit('checking','已同步；正在检查其他设备更新…',{...lastSynced,stage:code});
      else emit('syncing',message+' 本机阅读可继续。',{stage:code});
      slowTimer=setTimeout(slow,slowAfter);slowTimer.unref?.();
    }
    const stopProgress=A.onProgress?.(value=>{if(running&&active)step(value.stage,value.message);});
    function stop(){active=false;epoch++;stopRemote?.();stopRemote=null;clearTimeout(timer);timer=null;clearInterval(periodic);periodic=null;}
    function check(session){if(closed||!active||epoch!==session||!user||A.user()?.uid!==user.uid)throw fail('session-changed','登录状态已改变；本机记录保留。');}
    async function identity(next,error){
      stop();lastSynced=null;user=next;if(error)emit('error',error.message);
      if(!next)return emit('signed-out',error?.message||'未登录；学习记录保存在本机。');
      if(!allowedUid||allowedUid==='REPLACE_WITH_YOUR_UID')return emit('configuration','已登录。请将此 UID 填入网页配置和安全规则后再启用同步。');
      if(next.uid!==allowedUid)return emit('blocked','此账号未获授权；本机记录保留。');
      const session=epoch;
      try{
        await S.flush();const record=await S.readSync();if(session!==epoch)return;
        if(record.meta.boundUid&&record.meta.boundUid!==next.uid)return emit('blocked','本机数据已绑定另一账号，不能上传至此账号。请使用独立浏览器个人资料。');
        if(!record.meta.boundUid&&meaningful(wire(record)))return emit('migration','首次同步前，请导出完整 JSON 备份，再勾选下方确认。');
        if(!record.meta.boundUid)await S.bindUid(next.uid);
        if(session!==epoch)return;begin();
      }catch(error){if(session===epoch)emit('error',error.message);}
    }
    function begin(){
      active=true;retry=0;const session=epoch;
      try{stopRemote=A.subscribe(head=>{if(epoch!==session||!active)return;if(head.error){emit('offline',head.error.message);schedule();}else schedule();});}catch(error){emit('offline',error.message);}
      periodic=setInterval(()=>schedule(),60000);periodic.unref?.();schedule(0);
    }
    function schedule(wait){
      if(!active||closed||!autoSchedule)return;if(running){again=true;return;}if(timer)return;
      const ms=wait??Math.max(0,delay-(clock()-lastRun));timer=setTimeout(()=>{timer=null;syncNow().catch(()=>{});},ms);timer.unref?.();
    }
    async function saveConflict(record,result,context){
      const saved={kind:'sync-conflict',localToken:record.token,result:clone(result),...clone(context)};
      await S.writeConflicts({uid:user.uid,expectedToken:record.token,conflicts:[saved]});
      emit('conflict',`有 ${result.conflicts.length} 处两端修改需要选择，双方副本均已保留。`,{conflicts:result.conflicts});
    }
    async function apply(record,snapshot,base,remoteVersion,options={}){
      const valid=C.validateSnapshot(snapshot);if(!valid.ok)throw fail('invalid-snapshot',valid.errors[0]);
      if(S.confirmSync&&C.equal(wire(record),snapshot))return S.confirmSync({uid:user.uid,expectedToken:record.token,base,remoteVersion,...options});
      return S.applySync({uid:user.uid,expectedToken:record.token,state:snapshot.state,packs:snapshot.packs,rollback:snapshot.rollback,base,remoteVersion,...options});
    }
    async function sendFlight(flight,session){
      let receipt;
      try{receipt=await A.commit({operationId:flight.operationId,expectedVersion:flight.payload.expectedVersion,snapshot:flight.payload.snapshot});}
      catch(error){
        check(session);
        if(error.code==='remote-conflict'){await S.abandonFlight({uid:user.uid,operationId:flight.operationId,reason:'remote-conflict'});again=true;return;}
        throw error; // Unknown network outcome: retain flight and retry SAME operationId.
      }
      check(session);step('local-confirm','正在保存云端确认到本机…');await S.refresh?.();await S.flush();const record=await S.readSync();check(session);
      const result=C.merge(flight.payload.localBase,wire(record),flight.payload.snapshot);
      if(result.conflicts.length)return saveConflict(record,result,{phase:'ack',remoteSnapshot:flight.payload.snapshot,remoteVersion:receipt.version,flight,followResume:flight.payload.followResume});
      await apply(record,result.snapshot,flight.payload.snapshot,receipt.version,{ackIds:flight.ackIds,ackOperationId:flight.operationId,followResume:flight.payload.followResume===true});
      const latest=await S.readSync();check(session);
      if(S.canSync()&&!latest.pending.length&&!latest.meta.flight&&C.equal(wire(latest),flight.payload.snapshot)){
        retry=0;lastSynced={version:receipt.version,at:clock()};
        emit('synced','云端已确认本机记录。',{...lastSynced});
      }
      again=true;
    }
    async function cycle(session){
      if(!online())return emit('offline','当前离线；本机学习会继续，联网后自动同步。');
      quietCheck=!!lastSynced;
      step('local-save','正在检查本机保存…');
      await S.refresh?.();await S.flush();check(session);if(!S.canSync())return emit('local-pending','本机状态尚未安全保存或刷新，请先处理本机保存提示。');
      let record=await S.readSync();check(session);
      const context=record.meta.conflicts?.[0];
      if(context){
        if(context.localToken!==record.token&&context.phase!=='ack'){await S.writeConflicts({uid:user.uid,expectedToken:record.token,conflicts:[]});record=await S.readSync();}
        else return emit('conflict',`有 ${context.result?.conflicts?.length||1} 处两端修改需要选择。`,{conflicts:context.result?.conflicts||[]});
      }
      quietCheck=!!lastSynced&&!record.meta.flight&&!record.pending.length;
      if(record.meta.flight){step('cloud-upload','正在上传待同步记录…');return sendFlight(record.meta.flight,session);}
      step('cloud-head','正在检查云端版本…');
      const remote=await A.pull();check(session);
      await S.refresh?.();await S.flush();record=await S.readSync();check(session);if(!S.canSync())return emit('local-pending','本机保存尚未完成，请稍后重试。');
      const local=wire(record),fresh=!record.meta.base&&!meaningful(local),shouldFollow=fresh&&!!remote.snapshot&&followResume();
      let result=fresh&&remote.snapshot?{snapshot:clone(remote.snapshot),conflicts:[]}:C.merge(record.meta.base||null,local,remote.snapshot);
      const valid=C.validateSnapshot(result.snapshot);if(!valid.ok&&!result.conflicts.length)throw fail('invalid-snapshot',valid.errors[0]);
      if(result.conflicts.length)return saveConflict(record,result,{phase:'merge',remoteSnapshot:remote.snapshot,remoteVersion:remote.version,base:record.meta.base||null,followResume:shouldFollow});
      if(!remote.snapshot||!C.equal(result.snapshot,remote.snapshot)||record.pending.length){
        quietCheck=false;step('local-queue','正在准备持久同步批次…');
        const flight=await S.saveFlight({uid:user.uid,expectedToken:record.token,payload:{snapshot:result.snapshot,expectedVersion:remote.version,localBase:local,followResume:shouldFollow}});
        check(session);return sendFlight(flight,session);
      }
      if(!C.equal(local,result.snapshot)||!C.equal(record.meta.base,remote.snapshot)||record.meta.remoteVersion!==remote.version){
        quietCheck=false;step('local-apply','正在将云端记录应用到本机…');
        await apply(record,result.snapshot,remote.snapshot,remote.version,{followResume:shouldFollow});
      }
      const latest=await S.readSync();check(session);
      if(!S.canSync())return emit('local-pending','云端已接收，页面刷新尚未完成；请重试本机保存。');
      if(latest.pending.length||latest.meta.flight){again=true;return;}
      retry=0;lastSynced={version:remote.version,at:clock()};emit('synced','云端已同步。',{...lastSynced});
    }
    async function syncNow(){
      if(!active||closed)return status;if(running){again=true;return status;}
      running=true;again=false;lastRun=clock();const session=epoch;
      try{await cycle(session);}
      catch(error){
        if(error.code==='session-changed'||epoch!==session||closed)return status;
        const current=S.status?.();
        if(current?.phase==='loading'||current?.phase==='conflict'||current?.phase==='error')emit('local-pending',current.message||error.message);
        else emit(error.code==='permission-denied'||error.code==='operation-mismatch'||error.code==='cloud-corrupt'?'error':'offline',error.message+' 本机记录已保留。');
        retry=Math.min(retry+1,6);
      }finally{
        clearTimeout(slowTimer);slowTimer=null;stage=null;running=false;quietCheck=false;
        if(active&&epoch===session&&status.phase!=='conflict'&&status.phase!=='error'){
          if(again)schedule(delay);else if(retry)schedule(Math.min(60000,5000*2**(retry-1)));
        }else if(active&&epoch!==session)schedule(0);
      }
      return status;
    }
    async function enable(backupConfirmed){
      if(!backupConfirmed)throw fail('backup-required','请先导出完整 JSON 备份，再确认。');
      if(!user||user.uid!==allowedUid)throw fail('permission-denied','请先用本人 Google 账号登录。');
      await S.flush();await S.bindUid(user.uid);stop();begin();return status;
    }
    async function resolve(choice){
      if(!active||!user)throw fail('permission-denied','请先登录。');
      if(running)throw fail('busy','正在同步，请稍后处理冲突。');
      await S.flush();let record=await S.readSync(),context=record.meta.conflicts?.[0];
      if(!context)return status;
      if(context.localToken!==record.token){
        if(context.phase==='ack'){
          const result=C.merge(context.flight.payload.localBase,wire(record),context.remoteSnapshot);
          await saveConflict(record,result,{...context,localToken:record.token,result});
          return emit('conflict','本机记录已变化，冲突预览已更新；请核对后再次选择。',{conflicts:result.conflicts});
        }else{await S.writeConflicts({uid:user.uid,expectedToken:record.token,conflicts:[]});schedule(0);return emit('local-pending','本机记录已变化，正在重新比较；请在新预览后选择。');}
      }
      const result=C.resolve(context.result,choice);
      if(result.conflicts.length)throw fail('unresolved','还有未选择的冲突。');
      await apply(record,result.snapshot,context.remoteSnapshot,context.remoteVersion,{conflicts:[],...(context.phase==='ack'?{ackIds:context.flight.ackIds,ackOperationId:context.flight.operationId}:{}),followResume:context.followResume===true});
      emit('syncing','选择已保存在本机，正在同步。');schedule(0);return status;
    }
    stopAuth=A.onAuth((next,error)=>{identity(next,error).catch(error=>emit('error',error.message));});
    return {syncNow,enable,resolve,schedule,wake(){slow();schedule(0);},status:()=>status,diagnostics:()=>({running,stage:stage?.code||null,stageAt,elapsedMs:stage?clock()-stageAt:0,lastSynced,retry}),signIn:()=>A.signIn(),signOut:async()=>{stop();lastSynced=null;await A.signOut();user=null;emit('signed-out','已退出登录；本机记录保留。');},close(){closed=true;stop();clearTimeout(slowTimer);stopAuth?.();stopProgress?.();},wire,meaningful};
  }
  return {create,wire,meaningful};
});

/* The cloud UI is optional; loading Firebase never blocks local reader startup. */
if(typeof window!=='undefined'&&window.StudyCloudSync){
  const cloudEntryHadHash=!!(window.StudyEntryHash??window.location.hash);
  window.addEventListener('DOMContentLoaded',()=>{
    const S=window.StudyState,C=window.StudySyncCore,$=id=>document.getElementById(id),dialog=$('cloudDialog');
    if(!dialog||!S||!C)return;
    document.addEventListener('study-sync-applying',event=>{
      const active=event.detail.active;
      for(const el of document.querySelectorAll('#sidebar,#reader,dialog:not(#saveDialog):not(#cloudDialog):not(#backupDialog)'))el.inert=active;
      for(const el of document.querySelectorAll('#backupDialog input,#backupDialog textarea,#backupDialog select,#backupDialog button:not(.close-dialog):not(#backupDownload):not(#backupSplit)'))el.inert=active;
      for(const el of document.querySelectorAll('.topbar button:not(#saveStatus):not(#cloudButton)'))el.inert=active;
      const notice=$('syncApplyingNotice');if(notice){notice.hidden=!active;notice.textContent=event.detail.pendingReload?'页面刷新未完成，请打开保存状态重试。':'正在应用已合并记录，请稍候…';}
    });
    let controller=null,adapter=null,loading=null,bootRetryTimer=null,bootFailures=0,lastStatus={phase:'configuration',message:'尚未配置云同步；本机阅读与 JSON 备份可用。'};
    function show(status){
      lastStatus=status;$('cloudState').textContent=status.message;
      $('cloudStatus').textContent=({synced:'已同步',checking:'已同步 · 检查更新',syncing:'同步中',waiting:'同步等待较久',offline:'离线待同步',conflict:'同步有冲突',migration:'备份后启用',error:'同步异常','local-pending':'待本机保存','signed-out':'未登录',configuration:'待配置',blocked:'账号未授权'})[status.phase]||'云同步';
      $('cloudAccount').textContent=adapter?.user()?.email||'';$('cloudUid').textContent=status.uid?'UID：'+status.uid:'';
      $('cloudLogin').disabled=!adapter||!!adapter.user();$('cloudLogout').hidden=!adapter?.user();
      $('cloudMigration').hidden=status.phase!=='migration';$('cloudConflicts').hidden=status.phase!=='conflict';
      $('cloudNow').disabled=!controller||!adapter?.user()||['migration','configuration','blocked'].includes(status.phase);
      const list=$('cloudConflictList');list.replaceChildren();
      for(const conflict of (status.conflicts||[]).slice(0,20)){
        const row=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=conflict.path||conflict.id;details.append(summary);
        details.addEventListener('toggle',()=>{if(!details.open||details.children.length>1)return;for(const side of ['local','remote']){const p=document.createElement('p'),value=conflict[side+'Missing']?'（删除）':JSON.stringify(conflict[side],null,2);p.textContent=(side==='local'?'本机：':'云端：')+(value?.length>4000?value.slice(0,4000)+'…（完整内容可导出双方副本）':value);details.append(p);}});row.append(details);list.append(row);
      }
    }
    async function boot(){
      if(loading)return loading;clearTimeout(bootRetryTimer);bootRetryTimer=null;
      const config=window.ENGLISH_STUDY_FIREBASE;if(!config){show(lastStatus);return;}
      show({phase:'syncing',message:'正在加载登录组件；本机阅读可继续。'});
      loading=(async()=>{
        await S.open();adapter=await window.StudyFirebaseAdapter.create(config);
        // Wait for the acknowledged reader consumer before restoring a new device.
        while(!window.StudyReaderAPI)await new Promise(resolve=>setTimeout(resolve,50));
        controller=window.StudyCloudSync.create({store:S,core:C,adapter,allowedUid:config.allowedUid,onStatus:show,followResume:()=>!cloudEntryHadHash,online:()=>navigator.onLine});
        bootFailures=0;window.StudyCloudAPI=controller;show({phase:'signed-out',message:'登录同一 Google 账号，自动同步完整个人资料。'});
      })().catch(error=>{loading=null;show({phase:'offline',message:error.message+' 本机阅读可继续。'});
        if(!['configuration-required','sdk-module-graph'].includes(error.code)){bootFailures++;bootRetryTimer=setTimeout(()=>{bootRetryTimer=null;if(navigator.onLine)boot();},Math.min(60000,5000*2**Math.min(bootFailures-1,4)));}
      });
      return loading;
    }
    async function action(fn){try{await fn();}catch(error){show({...lastStatus,message:error.message});}}
    $('cloudButton').addEventListener('click',()=>{dialog.showModal();boot();});
    $('cloudLogin').addEventListener('click',()=>action(()=>controller?controller.signIn():adapter.signIn()));
    $('cloudLogout').addEventListener('click',()=>action(()=>controller.signOut()));
    $('cloudNow').addEventListener('click',()=>action(()=>controller.syncNow()));
    $('cloudEnable').addEventListener('click',()=>action(()=>controller.enable($('cloudBackupConfirmed').checked)));
    $('cloudKeepLocal').addEventListener('click',()=>action(()=>controller.resolve('local')));
    $('cloudKeepRemote').addEventListener('click',()=>action(()=>controller.resolve('remote')));
    $('cloudConflictExport').addEventListener('click',()=>action(async()=>{const record=await S.readSync(),conflicts=record.meta?.conflicts||[];if(!conflicts.length)return;const url=URL.createObjectURL(new Blob([JSON.stringify({format:'english-study-sync-conflict',version:1,conflicts},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='english-study-conflict-copies.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
    $('cloudBackup').addEventListener('click',()=>{dialog.close();window.StudyWorkspaceAPI?.openBackup();});
    document.addEventListener('study-local-commit',()=>controller?.schedule());
    window.addEventListener('online',()=>{if(controller)controller.schedule(0);else boot();});
    window.addEventListener('focus',()=>{if(controller)controller.wake();else boot();});
    window.addEventListener('pageshow',()=>{if(controller)controller.wake();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(controller)controller.wake();else boot();}});
    show(lastStatus);boot();
  });
}
