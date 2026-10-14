const {test}=require('node:test'),assert=require('node:assert/strict'),V=require('../sync-status-core');
const saved={phase:'saved',durable:true,dirty:false,savedAt:100};
test('local commit evidence never claims persistence for dirty, failed or unavailable storage',()=>{
 assert.equal(V.local(saved).ready,true);assert.equal(V.local({...saved,phase:'error',dirty:true}).ready,false);assert.equal(V.local({...saved,dirty:true}).name,'本机保存中');
 assert.equal(V.local({...saved,durable:false}).name,'仅本页暂存');assert.equal(V.local({...saved,pendingReload:true}).name,'页面待恢复');
 assert.equal(V.local({...saved,pendingReload:true}).ready,false);assert.equal(V.local({...saved,phase:'error'}).savedAt,100);
});
test('old cloud success is withdrawn for a new unsaved mutation, pending hint or unconfirmed flight',()=>{
 const cloud={phase:'synced',message:'previous receipt',lastConfirmedAt:10};
 assert.equal(V.cloud(cloud,saved,{pendingOperations:0,hasFlight:false}).phase,'synced');
 for(const [local,summary] of [[{...saved,dirty:true},null],[{...saved,phase:'error'},null],[saved,{pendingOperations:1,hasFlight:false}],[saved,{pendingOperations:0,hasFlight:true}]])assert.equal(V.cloud(cloud,local,summary).phase,'pending');
 assert.equal(V.cloud({...cloud,localDirty:true},saved).phase,'pending');assert.equal(V.cloud({phase:'conflict'},saved,{pendingOperations:1}).phase,'conflict');
});
test('connected network failures and timeouts do not masquerade as browser offline',()=>{
 assert.equal(V.error({code:'unavailable'},true).phase,'network-error');assert.equal(V.error({code:'sync-timeout'},true).phase,'timeout');
 assert.equal(V.error({code:'unavailable'},false).phase,'offline');assert.equal(V.error({code:'unexpected'},true).phase,'error');
});
test('permission, quota and expired credentials require distinct actions without automatic retry',()=>{
 for(const [code,phase] of [['permission-denied','error'],['firestore/permission-denied','error'],['resource-exhausted','quota'],['unauthenticated','auth-required'],['auth/user-token-expired','auth-required'],['cloud-corrupt','error']]){
  const issue=V.error({code},true);assert.equal(issue.phase,phase);assert.equal(issue.autoRetry,false);
 }
});
