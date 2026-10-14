/* Display evidence separately: a local commit is not a cloud receipt. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudySaveStatus=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function local(s={}){
    const ready=s.phase==='saved'&&s.durable!==false&&!s.dirty&&!s.pendingReload;
    const name=s.pendingReload?'页面待恢复':s.phase==='loading'?'正在读取':s.durable===false?'仅本页暂存':s.dirty&&s.phase==='saved'?'本机保存中':({saved:'本机已保存',saving:'本机保存中',conflict:'本机版本冲突',error:'本机未保存'})[s.phase]||'本机未保存';
    const message=s.message||(ready?'当前记录已成功写入此浏览器。':s.pendingReload?'记录已提交，但页面刷新未完成；请重试本机保存。':s.durable===false?'浏览器暂未允许持久保存；请先导出完整备份。':'当前修改尚未确认写入，请保留本页并重试保存。');
    return {ready,name,message,savedAt:s.savedAt||null};
  }
  function error(error={},connected=true){
    const code=String(error.code||'unknown').replace(/^firestore\//,'');
    if(!connected)return {phase:'offline',code,autoRetry:true,advice:'当前网络已离线；本机提交成功的记录将在联网后重试。'};
    if(['unauthenticated','auth/user-token-expired','auth/invalid-user-token','auth/requires-recent-login'].includes(code))return {phase:'auth-required',code,autoRetry:false,advice:'登录凭据需要更新，请重新登录同一账号。'};
    if(code==='resource-exhausted')return {phase:'quota',code,autoRetry:false,advice:'云端配额或服务资源受限；本机仍可保存，请稍后检查再重试。'};
    if(code==='permission-denied')return {phase:'error',code,autoRetry:false,advice:'云端拒绝访问，请核对本人账号及数据库安全规则。'};
    if(['sync-timeout','deadline-exceeded'].includes(code))return {phase:'timeout',code,autoRetry:true,advice:'等待云端确认超时；稍后自动重试，尚未确认的记录会按原批次重试。'};
    if(['unavailable','network-request-failed','auth/network-request-failed','sdk-unavailable'].includes(code))return {phase:'network-error',code,autoRetry:true,advice:'网络已连接，但云服务暂不可达；稍后自动重试。'};
    return {phase:'error',code,autoRetry:false,advice:'同步未完成，请保留备份并查看诊断后重试。'};
  }
  function cloud(s={},localState={},summary=null){
    let phase=s.phase||'configuration';
    if(['synced','checking'].includes(phase)&&(s.localDirty||!local(localState).ready||(summary&&(summary.pendingOperations>0||summary.hasFlight))))phase='pending';
    const name=({'loading-sdk':'加载登录组件',synced:'已同步',checking:'已同步 · 检查更新',pending:'等待同步',syncing:'同步中',waiting:'同步等待较久',offline:'离线待同步',timeout:'云端确认超时','network-error':'连接待恢复',quota:'云端配额受限','auth-required':'需要重新登录',conflict:'同步有冲突',migration:'备份后启用',error:'同步异常','local-pending':'待本机保存','signed-out':'未登录',configuration:'待配置',blocked:'账号未授权'})[phase]||'云同步';
    const message=phase==='pending'&&phase!==s.phase?'当前有未确认的修改；上次成功不代表本次已同步。':s.message||'请查看本机保存和云端确认状态。';
    return {phase,name,message};
  }
  return {local,cloud,error};
});
