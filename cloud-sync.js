/* Local-first controller. Immutable flights survive crashes; receipt confirmation is exact. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./sync-status-core'):root.StudySaveStatus);if(typeof module==='object'&&module.exports)module.exports=api;else root.StudyCloudSync=api;
})(typeof window!=='undefined'?window:globalThis,function(Status){
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
    const defaults={theme:'system',fontSize:21,lineHeight:1.95,fontFamily:'serif',highlight:true,highlightMode:'all',focus:false};
    return !!r.settings&&Object.entries(r.settings).some(([k,v])=>defaults[k]!==v);
  }
  function create({store:S,core:C,adapter:A,allowedUid,onStatus=()=>{},followResume=()=>false,online=()=>true,clock=()=>Date.now(),delay=5000,slowAfter=20000,autoSchedule=true}){
    let user=null,epoch=0,active=false,running=false,again=false,timer=null,periodic=null,stopAuth=null,stopRemote=null,lastRun=0,retry=0,closed=false,status={phase:'signed-out',message:'未登录；学习记录保存在本机。'};
    let stage=null,stageAt=0,cycleAt=0,slowTimer=null,lastSynced=null,quietCheck=false,localDirty=true,nextRetryAt=null,lastErrorCode=null,lastFailureStage=null;
    const emit=(phase,message,more={})=>{status={phase,message,uid:user?.uid||null,lastConfirmedAt:lastSynced?.at||null,localDirty,...more};if(['conflict','error','quota','auth-required','local-pending'].includes(phase)){clearTimeout(timer);timer=null;nextRetryAt=null;}onStatus(status);return status;};
    const paused=()=>['conflict','error','quota','auth-required','local-pending'].includes(status.phase);
    function networkError(error){const issue=Status.error(error,online());lastErrorCode=issue.code;lastFailureStage=stage?.code||null;emit(issue.phase,issue.advice+' '+error.message,{errorCode:issue.code,autoRetry:issue.autoRetry});return issue;}
    function localChanged(committed=false){
      if(!active||closed)return;localDirty=true;quietCheck=false;
      if(running&&status.phase==='checking')emit('syncing','本机出现新修改，正在等待保存与云端确认。',{stage:stage?.code});
      else if(running||paused()||['offline','timeout','network-error','waiting'].includes(status.phase))emit(status.phase,status.message,{...status,localDirty:true});
      else emit('pending',committed?'本机已提交新记录，等待云端确认。':'当前修改正在本机保存，尚未获得云端确认。');
      if(committed)schedule();
    }
    function localReady(){if(active&&status.phase==='local-pending'&&S.canSync()){emit('pending','本机保存和页面刷新已恢复，等待重新同步。');schedule(0);}}
    const unchanged=record=>{const local=S.status?.();return !local||!Object.hasOwn(local,'token')||local.token===record.token;};
    function slow(){
      if(running&&active&&stage&&clock()-stageAt>=slowAfter)
        emit('waiting',`同步等待较久：${stage.message} 已提交的本机记录保持不变；当前请求完成或超时后可重试。`,{stage:stage.code,elapsedMs:clock()-stageAt});
    }
    function step(code,message){
      stage={code,message};stageAt=clock();clearTimeout(slowTimer);
      if(quietCheck&&!localDirty&&['cloud-head','local-save'].includes(code))emit('checking','上次记录已同步；正在检查其他设备更新…',{...lastSynced,stage:code});
      else emit('syncing',message+' 本机阅读可继续。',{stage:code});
      slowTimer=setTimeout(slow,slowAfter);slowTimer.unref?.();
    }
    const stopProgress=A.onProgress?.(value=>{if(running&&active)step(value.stage,value.message);});
    function stop(){active=false;epoch++;stopRemote?.();stopRemote=null;clearTimeout(timer);timer=null;nextRetryAt=null;clearInterval(periodic);periodic=null;}
    function check(session){if(closed||!active||epoch!==session||!user||A.user()?.uid!==user.uid)throw fail('session-changed','登录状态已改变；本机记录保留。');}
    async function identity(next,error){
      stop();lastSynced=null;localDirty=true;user=next;if(error)networkError(error);
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
      active=true;retry=0;emit('pending','正在检查本机记录与云端版本。');listen();
      periodic=setInterval(()=>schedule(),60000);periodic.unref?.();schedule(0);
    }
    function listen(){
      if(stopRemote||!active||!online())return;const session=epoch;let failed=false,handle;
      try{
        handle=A.subscribe(head=>{
          if(epoch!==session||!active)return;
          if(head.error){failed=true;handle?.();stopRemote=null;if(!running)networkError(head.error);schedule();}
          else{
            if(lastSynced&&head.version>lastSynced.version){
              localDirty=true;quietCheck=false;
              if(!running&&!paused())emit('pending','检测到其他设备更新，等待下载和应用。');
            }
            schedule();
          }
        });
        if(failed)handle?.();else stopRemote=handle;
      }catch(error){networkError(error);}
    }
    function schedule(wait){
      if(!active||closed||!autoSchedule||paused())return;if(running){again=true;return;}if(timer){if(wait!==0)return;clearTimeout(timer);timer=null;}
      const ms=wait??Math.max(0,delay-(clock()-lastRun));nextRetryAt=clock()+ms;timer=setTimeout(()=>{timer=null;nextRetryAt=null;syncNow().catch(()=>{});},ms);timer.unref?.();
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
      let receipt;step('cloud-upload','正在上传或核对待确认批次…');
      try{receipt=await A.commit({operationId:flight.operationId,expectedVersion:flight.payload.expectedVersion,snapshot:flight.payload.snapshot});}
      catch(error){
        check(session);
        if(error.code==='remote-conflict'){await S.abandonFlight({uid:user.uid,operationId:flight.operationId,reason:'remote-conflict'});again=true;emit('pending','另一设备已提交新版本，稍后重新比较；本机记录保留。');return;}
        throw error; // Unknown network outcome: retain flight and retry SAME operationId.
      }
      check(session);step('local-confirm','正在保存云端确认到本机…');await S.refresh?.();await S.flush();const record=await S.readSync();check(session);
      const result=C.merge(flight.payload.localBase,wire(record),flight.payload.snapshot);
      if(result.conflicts.length)return saveConflict(record,result,{phase:'ack',remoteSnapshot:flight.payload.snapshot,remoteVersion:receipt.version,flight,followResume:flight.payload.followResume});
      await apply(record,result.snapshot,flight.payload.snapshot,receipt.version,{ackIds:flight.ackIds,ackOperationId:flight.operationId,followResume:flight.payload.followResume===true});
      const latest=await S.readSync();check(session);
      if(S.canSync()&&unchanged(latest)&&!latest.pending.length&&!latest.meta.flight&&C.equal(wire(latest),flight.payload.snapshot)){
        retry=0;lastErrorCode=null;localDirty=false;lastSynced={version:receipt.version,at:clock()};
        emit('synced','云端已确认本机记录。',{...lastSynced});
      }else if(!S.canSync())emit('local-pending','云端确认后本机保存或页面刷新未完成，请先重试本机保存。');
      else emit('pending','本批记录已获云端确认，较新的本机修改仍在等待同步。');
      again=true;
    }
    async function cycle(session){
      if(!online())return emit('offline','当前离线；本机学习会继续，联网后自动同步。');
      listen();quietCheck=!!lastSynced&&!localDirty;
      step('local-save','正在检查本机保存…');
      await S.refresh?.();await S.flush();check(session);if(!S.canSync())return emit('local-pending','本机状态尚未安全保存或刷新，请先处理本机保存提示。');
      let record=await S.readSync();check(session);
      const context=record.meta.conflicts?.[0];
      if(context){
        if(context.localToken!==record.token&&context.phase!=='ack'){await S.writeConflicts({uid:user.uid,expectedToken:record.token,conflicts:[]});record=await S.readSync();}
        else return emit('conflict',`有 ${context.result?.conflicts?.length||1} 处两端修改需要选择。`,{conflicts:context.result?.conflicts||[]});
      }
      quietCheck=!!lastSynced&&!localDirty&&!record.meta.flight&&!record.pending.length;
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
      if(!unchanged(latest)||latest.pending.length||latest.meta.flight){again=true;emit('pending','较新的本机修改仍在等待云端确认。');return;}
      retry=0;lastErrorCode=null;localDirty=false;lastSynced={version:remote.version,at:clock()};emit('synced','云端已同步。',{...lastSynced});
    }
    async function syncNow(){
      if(!active&&!closed&&user?.uid===allowedUid&&['error','local-pending'].includes(status.phase))await identity(user);
      if(!active||closed)return status;if(running){again=true;return status;}
      clearTimeout(timer);timer=null;nextRetryAt=null;
      running=true;again=false;lastRun=cycleAt=clock();const session=epoch;
      try{await cycle(session);}
      catch(error){
        if(error.code==='session-changed'||epoch!==session||closed)return status;
        const current=S.status?.();
        if(current?.phase==='loading'||current?.phase==='conflict'||current?.phase==='error')emit('local-pending',current.message||error.message);
        else networkError(error);
        retry=Math.min(retry+1,6);
      }finally{
        clearTimeout(slowTimer);slowTimer=null;stage=null;running=false;quietCheck=false;
        if(active&&epoch===session&&!paused()){
          if(retry)schedule(Math.min(60000,5000*2**(retry-1)));else if(again)schedule(delay);
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
        }else{await S.writeConflicts({uid:user.uid,expectedToken:record.token,conflicts:[]});emit('pending','本机记录已变化，正在重新比较；请在新预览后选择。');schedule(0);return status;}
      }
      const result=C.resolve(context.result,choice);
      if(result.conflicts.length)throw fail('unresolved','还有未选择的冲突。');
      await apply(record,result.snapshot,context.remoteSnapshot,context.remoteVersion,{conflicts:[],...(context.phase==='ack'?{ackIds:context.flight.ackIds,ackOperationId:context.flight.operationId}:{}),followResume:context.followResume===true});
      emit('syncing','选择已保存在本机，正在同步。');schedule(0);return status;
    }
    stopAuth=A.onAuth((next,error)=>{identity(next,error).catch(error=>emit('error',error.message));});
    return {syncNow,enable,resolve,schedule,localChanged,localReady,wake(){slow();schedule(0);},status:()=>status,diagnostics:()=>({running,cycleElapsedMs:running?clock()-cycleAt:0,stage:stage?.code||null,stageAt,elapsedMs:stage?clock()-stageAt:0,lastSynced,retry,nextRetryAt,lastErrorCode,lastFailureStage,localDirty}),signIn:()=>A.signIn(),signOut:async()=>{stop();lastSynced=null;localDirty=true;await A.signOut();user=null;emit('signed-out','已退出登录；本机记录保留。');},close(){closed=true;stop();clearTimeout(slowTimer);stopAuth?.();stopProgress?.();},wire,meaningful};
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
      if(active)window.StudyReaderAPI?.closeDirectory();
      for(const el of document.querySelectorAll('#sidebar,#reader,dialog:not(#saveDialog):not(#cloudDialog):not(#backupDialog):not(#toolsDialog)'))el.inert=active;
      for(const el of document.querySelectorAll('#backupDialog input,#backupDialog textarea,#backupDialog select,#backupDialog button:not(.close-dialog):not(#backupDownload):not(#backupSplit)'))el.inert=active;
      for(const el of document.querySelectorAll('.topbar button:not(#saveStatus):not(#cloudButton):not(#toolsButton),#toolsDialog button:not(#saveStatus):not(#cloudButton)'))el.inert=active;
      const notice=$('syncApplyingNotice');if(notice){notice.hidden=!active;notice.textContent=event.detail.pendingReload?'页面刷新未完成，请打开保存状态重试。':'正在应用已合并记录，请稍候…';}
    });
    const Status=window.StudySaveStatus;
    let controller=null,adapter=null,loading=null,bootRetryTimer=null,bootFailures=0,summary=null,summaryRequest=null,summaryAgain=false,lastStatus={phase:'configuration',message:'尚未配置云同步；本机阅读与 JSON 备份可用。'};
    const time=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无确认';
    function evidence(){
      const local=S.status(),view=Status.local(local),cloud=Status.cloud(lastStatus,local,summary),d=controller?.diagnostics();
      $('cloudStatus').textContent=cloud.name;$('cloudState').textContent=cloud.message;
      $('cloudLocalState').textContent=view.name+(view.ready?'':' · '+view.message);
      $('cloudLocalTime').textContent='上次本机提交：'+time(view.savedAt);
      $('cloudConfirmedTime').textContent='上次云端确认（本次打开）：'+time(lastStatus.lastConfirmedAt);
      $('cloudQueue').textContent=(summary?`待同步本机提交：${summary.pendingOperations} 次${summary.hasFlight?' · 有待确认上传批次':''}（提交次数不是生词或资料数量）`:'待同步数量：尚未检查')+(local.dirty?'；本页尚有未提交修改，未计入次数。':'');
      const stages={'local-save':'检查本机保存','cloud-head':'检查云端版本','cloud-download':'下载云端资料','cloud-encode':'校验待上传资料','cloud-receipt':'核对操作回执','cloud-upload':'上传记录','cloud-confirm':'等待云端提交确认','local-queue':'准备持久批次','local-confirm':'保存云端确认','local-apply':'应用云端记录'};
      $('cloudStage').textContent=d?.running?`当前阶段：${stages[d.stage]||d.stage||'检查中'} · 本轮 ${Math.max(0,Math.floor(d.cycleElapsedMs/1000))} 秒`:d?.lastErrorCode&&d?.lastFailureStage?`上次停止阶段：${stages[d.lastFailureStage]||d.lastFailureStage}；当前没有运行中的请求。`:'当前没有运行中的同步请求。';
      const localProblem=['error','conflict'].includes(local.phase)||local.pendingReload;
      $('cloudRecovery').hidden=!localProblem&&!['waiting','offline','timeout','network-error','error','quota','auth-required','local-pending'].includes(cloud.phase);
      $('cloudRepairLocal').hidden=!localProblem&&cloud.phase!=='local-pending';
      $('cloudRelogin').hidden=cloud.phase!=='auth-required';
      $('cloudReopen').hidden=cloud.phase!=='waiting'&&!local.pendingReload;
      $('cloudReopen').disabled=!local.durable||local.dirty;
      $('cloudRecoveryHint').textContent=localProblem?(local.phase==='conflict'?'先导出本页备份，保留未提交修改，再重新打开异常页面；不会自动覆盖另一标签页。':'先重试本机保存。若页面仍未恢复，可在没有未提交修改时重新打开页面；已提交记录保留。'):!controller?'登录组件尚未就绪；可点“重试连接”。本机保存与阅读继续可用。':cloud.phase==='waiting'?'当前请求仍在等待。“立即同步”只安排本轮结束后重试。没有未提交修改时也可重新打开页面，待确认记录会继续按原批次核对。':cloud.phase==='auth-required'?'重新登录同一账号后继续原待同步批次；退出登录保留本机记录。':cloud.phase==='quota'?'自动重试已暂停；稍后点“立即同步”检查。无需为此清理本机数据或重新导入资料。':cloud.phase==='error'?'自动重试已暂停；请按上方原因核对权限或配置，并导出同步诊断。修正后可点“立即同步”。':cloud.phase==='offline'?'恢复网络后自动重试；请以“本机已保存”确认离线修改已经提交。':'连接恢复后会重试原待确认批次。网络连通不代表云服务一定可达；无需重新导入资料。';
      $('cloudRetryTime').textContent=d?.nextRetryAt?`下一次检查约在 ${Math.max(0,Math.ceil((d.nextRetryAt-Date.now())/1000))} 秒后；后台计时可能延后。`:d?.running?'等待当前请求完成或超时。':'可按提示处理后手动重试。';
    }
    function refreshSummary(){
      if(!dialog.open||!S.syncSummary)return;if(summaryRequest){summaryAgain=true;return;}
      summaryAgain=false;summaryRequest=S.syncSummary().then(value=>{summary=value;evidence();}).catch(()=>{summary=null;evidence();}).finally(()=>{summaryRequest=null;if(summaryAgain)refreshSummary();});
    }
    function show(status){
      lastStatus=status;evidence();refreshSummary();
      $('cloudAccount').textContent=adapter?.user()?.email||'';$('cloudUid').textContent=status.uid?'UID：'+status.uid:'';
      $('cloudLogin').disabled=!adapter||!!adapter.user();$('cloudLogout').hidden=!adapter?.user();
      $('cloudMigration').hidden=status.phase!=='migration';$('cloudConflicts').hidden=status.phase!=='conflict';
      $('cloudNow').textContent=controller?'立即同步':'重试连接';
      $('cloudNow').disabled=controller?(!adapter?.user()||['migration','configuration','blocked'].includes(status.phase)):!window.ENGLISH_STUDY_FIREBASE||status.phase==='loading-sdk';
      const list=$('cloudConflictList');list.replaceChildren();
      for(const conflict of (status.conflicts||[]).slice(0,20)){
        const row=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=conflict.path||conflict.id;details.append(summary);
        details.addEventListener('toggle',()=>{if(!details.open||details.children.length>1)return;for(const side of ['local','remote']){const p=document.createElement('p'),value=conflict[side+'Missing']?'（删除）':JSON.stringify(conflict[side],null,2);p.textContent=(side==='local'?'本机：':'云端：')+(value?.length>4000?value.slice(0,4000)+'…（完整内容可导出双方副本）':value);details.append(p);}});row.append(details);list.append(row);
      }
    }
    async function boot(){
      if(loading)return loading;clearTimeout(bootRetryTimer);bootRetryTimer=null;
      const config=window.ENGLISH_STUDY_FIREBASE;if(!config){show(lastStatus);return;}
      show({phase:'loading-sdk',message:'正在加载登录组件；本机阅读可继续。'});
      loading=(async()=>{
        await S.open();adapter=await window.StudyFirebaseAdapter.create(config);
        // Wait for the acknowledged reader consumer before restoring a new device.
        while(!window.StudyReaderAPI)await new Promise(resolve=>setTimeout(resolve,50));
        controller=window.StudyCloudSync.create({store:S,core:C,adapter,allowedUid:config.allowedUid,onStatus:show,followResume:()=>!cloudEntryHadHash,online:()=>navigator.onLine});
        bootFailures=0;window.StudyCloudAPI=controller;
      })().catch(error=>{loading=null;const issue=Status.error(error,navigator.onLine);show({...issue,message:issue.advice+' '+error.message+' 本机阅读可继续。'});
        if(issue.autoRetry){bootFailures++;bootRetryTimer=setTimeout(()=>{bootRetryTimer=null;if(navigator.onLine)boot();},Math.min(60000,5000*2**Math.min(bootFailures-1,4)));}
      });
      return loading;
    }
    async function action(fn){try{await fn();}catch(error){
      if(['backup-required','busy','unresolved'].includes(error.code)){show({...lastStatus,message:error.message});return;}
      if(controller&&['error','conflict','loading'].includes(S.status().phase)){show({...lastStatus,phase:'local-pending',message:error.message});return;}
      const issue=Status.error(error,navigator.onLine);show({...lastStatus,...issue,message:issue.advice+' '+error.message});
    }}
    $('cloudButton').addEventListener('click',()=>{window.StudyPanels.open(dialog);evidence();refreshSummary();if(!controller)boot();});
    $('cloudLogin').addEventListener('click',()=>action(()=>controller?controller.signIn():adapter.signIn()));
    $('cloudLogout').addEventListener('click',()=>action(()=>controller.signOut()));
    $('cloudNow').addEventListener('click',()=>action(()=>{if(!controller)return boot();const running=controller.diagnostics().running;$('cloudActionStatus').textContent=running?'已安排本轮结束后重试；当前批次保持不变。':'';return controller.syncNow();}));
    $('cloudRepairLocal').addEventListener('click',()=>action(async()=>{await S.retry();$('cloudActionStatus').textContent='本机保存和页面刷新已重试；正在重新检查云端。';if(controller)await controller.syncNow();evidence();refreshSummary();}));
    $('cloudRelogin').addEventListener('click',()=>action(async()=>{await controller.signOut();await controller.signIn();}));
    $('cloudReopen').addEventListener('click',()=>action(()=>{const local=S.status();if(!local.durable||local.dirty)throw fail('unsaved-reload','当前还有未提交修改，请先保存或导出本页备份。');window.location.reload();}));
    $('cloudRecoveryBackup').addEventListener('click',()=>window.StudyWorkspaceAPI?.openBackup());
    $('cloudEnable').addEventListener('click',()=>action(()=>controller.enable($('cloudBackupConfirmed').checked)));
    $('cloudKeepLocal').addEventListener('click',()=>action(()=>controller.resolve('local')));
    $('cloudKeepRemote').addEventListener('click',()=>action(()=>controller.resolve('remote')));
    $('cloudConflictExport').addEventListener('click',()=>action(async()=>{const record=await S.readSync(),conflicts=record.meta?.conflicts||[];if(!conflicts.length)return;const url=URL.createObjectURL(new Blob([JSON.stringify({format:'english-study-sync-conflict',version:1,conflicts},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='english-study-conflict-copies.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
    $('cloudBackup').addEventListener('click',()=>window.StudyWorkspaceAPI?.openBackup());
    $('cloudDiagnosticExport')?.addEventListener('click',()=>action(async()=>{
      const counts=await S.syncSummary(),local=S.status(),report={format:'english-study-sync-diagnostics',version:1,appVersion:'20261014-v32',createdAt:new Date().toISOString(),environment:{userAgent:navigator.userAgent,online:navigator.onLine,visibility:document.visibilityState},phase:lastStatus.phase,controller:controller?.diagnostics()||null,local:{phase:local.phase,dirty:local.dirty,durable:local.durable,pendingReload:local.pendingReload,savedAt:local.savedAt,...counts,hasConflicts:lastStatus.phase==='conflict'}};
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='english-study-sync-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('cloudDiagnosticStatus').textContent='诊断已导出；不包含账号标识、文章、作答或私人学习内容。';
    }));

    document.addEventListener('study-save-state',event=>{if(['saving','error','conflict'].includes(event.detail.phase))controller?.localChanged();else if(event.detail.phase==='saved')controller?.localReady();evidence();refreshSummary();});
    document.addEventListener('study-local-commit',()=>{controller?.localChanged(true);evidence();refreshSummary();});
    setInterval(()=>{if(dialog.open)evidence();},1000);
    window.addEventListener('online',()=>{if(controller)controller.schedule(0);else boot();});
    window.addEventListener('offline',()=>{if(controller)controller.wake();evidence();});
    window.addEventListener('focus',()=>{if(controller)controller.wake();else boot();});
    window.addEventListener('pageshow',()=>{if(controller)controller.wake();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(controller)controller.wake();else boot();}});
    show(lastStatus);boot();
  });
}
