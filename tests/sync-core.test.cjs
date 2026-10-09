const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const S=require('../sync-core.js'),C=require('../workspace-core.js'),L=require('../learning-core.js');
const Position=require('../position-core.js');
const template=JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8'));
const fresh=()=>({state:{reader:{currentKey:'original/1',resumeKey:'original/1',readKeys:[],positionKeys:{},settings:{}},learning:L.empty(),extra:C.emptyExtra()},packs:[]});
const copy=x=>structuredClone(x);
const card=id=>({id,articleKey:'original/1',paragraph:0,word:'measure',wordKey:'measure',sense:'测量',context:'We measure it.',allowed:'测量',created:0});
const pack=()=>({key:`local:${template.id}`,source:'local',payload:copy(template)});
const anchor=(articleKey,paragraph,offset)=>Position.capture({articleKey,paragraphs:Array(6).fill('A complete sentence for testing semantic reading positions and cloud merge.'),paragraph,offset,scrollY:100,viewportOffset:90,updatedAt:1});
test('empty cloud never deletes local learning or private packages, even with an old base',()=>{
  const local=fresh();local.state.learning.cards=[card('a')];local.packs=[pack()];
  for(const base of [null,fresh()]){const result=S.merge(base,local,null);assert.deepEqual(result.snapshot,local);assert.equal(result.conflicts.length,0);assert.equal(result.changed,false);}
});
test('first login unions IDs, maps and string memberships without treating absence as deletion',()=>{
  const local=fresh(),remote=fresh();local.state.learning.cards=[card('local')];remote.state.learning.cards=[card('remote')];
  local.state.reader.readKeys=['original/1'];remote.state.reader.readKeys=['missing/story'];remote.state.learning.migrated=['remote'];
  local.state.learning.drafts.a={own:'local',reason:'',categories:[]};remote.state.learning.drafts.b={own:'remote',reason:'',categories:[]};
  const result=S.merge(null,local,remote);assert.equal(result.conflicts.length,0);assert.deepEqual(result.snapshot.state.learning.cards.map(c=>c.id),['local','remote']);
  assert.deepEqual(result.snapshot.state.reader.readKeys,['original/1','missing/story']);assert.deepEqual(Object.keys(result.snapshot.state.learning.drafts),['a','b']);assert.deepEqual(result.snapshot.state.learning.migrated,['remote']);
});
test('three-way deletions propagate only when the other side did not edit the record',()=>{
  const base=fresh();base.state.learning.cards=[card('a'),card('b')];base.state.reader.readKeys=['original/1','original/2'];
  const local=copy(base),remote=copy(base);local.state.learning.cards.shift();remote.state.learning.cards[1].context='Remote edit.';local.state.reader.readKeys.shift();remote.state.reader.readKeys.push('original/3');
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,0);assert.deepEqual(result.snapshot.state.learning.cards,[remote.state.learning.cards[1]]);assert.deepEqual(result.snapshot.state.reader.readKeys,['original/2','original/3']);
});
test('delete-versus-edit preserves both alternatives and can resolve a missing local array record',()=>{
  const base=fresh();base.state.learning.cards=[card('a')];const local=copy(base),remote=copy(base);local.state.learning.cards=[];remote.state.learning.cards[0].context='Remote changed.';
  const result=S.merge(base,local,remote),conflict=result.conflicts[0];assert.equal(conflict.kind,'delete-edit');assert.equal(conflict.localMissing,true);assert.equal(conflict.remote.context,'Remote changed.');assert.equal(conflict.base.context,'We measure it.');
  const persistent=JSON.parse(JSON.stringify(result));const resolved=S.resolve(persistent,'remote');assert.equal(resolved.conflicts.length,0);assert.deepEqual(resolved.snapshot.state.learning.cards,remote.state.learning.cards);
  assert.equal(S.resolve(result,'local').snapshot.state.learning.cards.length,0);
});
test('disjoint fields on a learning record merge without losing edits',()=>{
  const base=fresh();base.state.learning.cards=[card('a')];const local=copy(base),remote=copy(base);local.state.learning.cards[0].context='Local context.';remote.state.learning.cards[0].created=100;
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,0);assert.equal(result.snapshot.state.learning.cards[0].context,'Local context.');assert.equal(result.snapshot.state.learning.cards[0].created,100);
});
test('same-field concurrent learning edits create stable conflict IDs and never guess from device clocks',()=>{
  const base=fresh();base.state.learning.cards=[card('a')];const local=copy(base),remote=copy(base);local.state.learning.cards[0].context='Local';remote.state.learning.cards[0].context='Remote';
  const result=S.merge(base,local,remote);assert.equal(result.snapshot.state.learning.cards[0].context,'Local');assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].id,S.merge(copy(base),copy(local),copy(remote)).conflicts[0].id);
  assert.equal(S.resolve(result,{[result.conflicts[0].id]:'remote'}).snapshot.state.learning.cards[0].context,'Remote');
  assert.equal(S.resolve(result,{}).conflicts.length,1);
});
test('packs, revision payloads and editor drafts stay indivisible on concurrent changes',()=>{
  const base=fresh();base.packs=[pack()];const id=template.id;base.state.extra.edits[id]={payload:copy(template),baseHash:'hash'};base.state.extra.editorDrafts[id+'/campus-project']={payload:copy(template),baseHash:'hash',paragraphIndex:0};
  const local=copy(base),remote=copy(base);for(const item of [local.packs[0].payload,local.state.extra.edits[id].payload,local.state.extra.editorDrafts[id+'/campus-project'].payload])item.title='Local title';
  for(const item of [remote.packs[0].payload,remote.state.extra.edits[id].payload,remote.state.extra.editorDrafts[id+'/campus-project'].payload])item.zhTitle='Remote title';
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,3);assert.deepEqual(result.snapshot,local);assert.deepEqual(S.resolve(result,'remote').snapshot,remote);
});
test('cursor changes merge automatically while retaining every distinct stable article checkpoint',()=>{
  const base=fresh();base.state.reader.positionKeys={'original/1':0};const local=copy(base),remote=copy(base);
  Object.assign(local.state.reader,{currentKey:'original/2',resumeKey:'original/2',current:2,read:[2],positions:{2:500},review:['a'],anchorKeys:{'original/1':anchor('original/1',1,10)}});local.state.reader.positionKeys={'original/1':100,'missing/local':200};
  Object.assign(remote.state.reader,{currentKey:'original/3',resumeKey:'original/3',current:3,read:[3],positions:{3:600},review:['b'],anchorKeys:{'original/1':anchor('original/1',3,40),'missing/remote':anchor('missing/remote',5,20)}});remote.state.reader.positionKeys={'original/1':300,'missing/remote':400};
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,0);const r=result.snapshot.state.reader;assert.equal(r.currentKey,'original/2');assert.equal(r.positionKeys['original/1'],100);assert.equal(r.positionKeys['missing/remote'],400);assert.deepEqual(r.anchorKeys['original/1'],local.state.reader.anchorKeys['original/1']);assert.deepEqual(r.anchorKeys['missing/remote'],remote.state.reader.anchorKeys['missing/remote']);
});
test('unchanged local cursor adopts the remote move and untouched checkpoints cannot cause a write conflict',()=>{
  const base=fresh(),remote=copy(base);remote.state.reader.currentKey='original/7';remote.state.reader.positionKeys['original/7']=500;const result=S.merge(base,copy(base),remote);assert.deepEqual(result.snapshot,remote);assert.equal(result.conflicts.length,0);
});
test('all unknown state, snapshot fields and private record metadata roundtrip without mutation',()=>{
  const local=fresh();local.state.extra.futureData={zero:0,off:false,empty:'',nested:[{id:'future',value:'yes'}]};local.state.learning.future='keep';local.custom={enabled:true};local.packs=[{...pack(),ownerLabel:'mine',compiled:{derived:true}}];
  const normalized=S.snapshot(local.state,local.packs);assert.equal(normalized.packs[0].compiled,undefined);assert.equal(normalized.packs[0].ownerLabel,'mine');assert.deepEqual(normalized.state,local.state);
  const before=JSON.stringify(local),result=S.merge(null,local,fresh());assert.equal(JSON.stringify(local),before);assert.deepEqual(result.snapshot.custom,{enabled:true});assert.deepEqual(result.snapshot.state.extra.futureData,local.state.extra.futureData);
});
test('rollback is preserved and conflicting rollback snapshots are explicit atomic alternatives',()=>{
  const base=fresh();base.rollback=null;const local=copy(base),remote=copy(base);local.rollback={data:copy(base.state),packs:[pack()]};remote.rollback={data:copy(base.state),packs:[]};remote.rollback.data.reader.currentKey='original/4';
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].path,'/rollback');assert.deepEqual(S.resolve(result,'remote').snapshot.rollback,remote.rollback);
});
test('invalid or prototype-bearing cloud inputs are rejected before merge',()=>{
  const local=fresh(),bad=copy(local);bad.state.learning.version=2;assert.throws(()=>S.merge(null,local,bad),/版本/);
  const poisoned=JSON.parse(JSON.stringify(local).replace('"extra":{','"extra":{"__proto__":{"polluted":true},'));assert.equal(S.validateSnapshot(poisoned).ok,false);assert.throws(()=>S.merge(null,local,poisoned),/不安全/);assert.equal({}.polluted,undefined);
  for(const key of ['constructor','prototype']){const poisoned=copy(local);poisoned.state.extra[key]={value:1};assert.equal(S.validateSnapshot(poisoned).ok,false);}
});
test('published material, duplicate private keys and invalid package payloads cannot enter the wire',()=>{
  const value=fresh();value.packs=[pack()];value.packs[0].source='published';assert.equal(S.validateSnapshot(value).ok,false);assert.equal(S.snapshot(value.state,value.packs).packs.length,0);
  value.packs=[pack(),pack()];assert.equal(S.validateSnapshot(value).ok,false);value.packs=[pack()];value.packs[0].key='wrong';assert.equal(S.validateSnapshot(value).ok,false);value.packs=[pack()];value.packs[0].payload.words=[];assert.equal(S.validateSnapshot(value).ok,false);
});
test('map deletions and empty strings survive three-way merge and conflict resolution',()=>{
  const base=fresh();base.state.extra.future={remove:'old',edit:'base',keep:0};const local=copy(base),remote=copy(base);delete local.state.extra.future.remove;local.state.extra.future.edit='';remote.state.extra.future.remove='remote';remote.state.extra.future.edit='remote';
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,2);assert.equal(result.snapshot.state.extra.future.edit,'');assert.equal(Object.hasOwn(result.snapshot.state.extra.future,'remove'),false);
  const resolved=S.resolve(result,'remote');assert.deepEqual(resolved.snapshot.state.extra.future,remote.state.extra.future);
});
test('canonical ordering does not create conflicts for object field ordering',()=>{
  assert.equal(S.canonical({b:2,a:1}),S.canonical({a:1,b:2}));const base=fresh(),local=copy(base),remote=copy(base);local.state.extra.future={a:1,b:2};remote.state.extra.future={b:2,a:1};assert.equal(S.merge(base,local,remote).conflicts.length,0);
});
test('merging undo bins beyond existing ten-record capacity preserves alternatives instead of truncating',()=>{
  const local=fresh(),remote=fresh();local.state.learning.trash=Array.from({length:7},(_,i)=>({kind:'word',record:card('local'+i)}));remote.state.learning.trash=Array.from({length:7},(_,i)=>({kind:'word',record:card('remote'+i)}));
  const result=S.merge(null,local,remote);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].path,'/state/learning/trash');assert.equal(result.conflicts[0].local.length,7);assert.equal(result.conflicts[0].remote.length,7);assert.equal(S.validateSnapshot(result.snapshot).ok,true);assert.equal(S.validateSnapshot(S.resolve(result,'remote').snapshot).ok,true);
});
test('a union beyond an existing schema limit becomes an explicit whole-state conflict',()=>{
  const local=fresh(),remote=fresh();for(const [side,label] of [[local,'local'],[remote,'remote']])side.state.extra.lookupWords=Array.from({length:5001},(_,i)=>({id:label+i,text:'word',articleKey:'original/1',paragraph:0,context:'A sentence.'}));
  const result=S.merge(null,local,remote);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].kind,'incompatible-merge');assert.equal(result.conflicts[0].local.extra.lookupWords.length,5001);assert.equal(result.conflicts[0].remote.extra.lookupWords.length,5001);assert.equal(S.validateSnapshot(result.snapshot).ok,true);
});
test('remote queue reorder survives an independent local task edit',()=>{
  const base=fresh();base.state.extra.queue=['a','b','c'].map(id=>({id,articleKey:'original/1',mode:'reading',status:'pending'}));const local=copy(base),remote=copy(base);local.state.extra.queue[0].label='Local task label';remote.state.extra.queue.reverse();
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,0);assert.deepEqual(result.snapshot.state.extra.queue.map(t=>t.id),['c','b','a']);assert.equal(result.snapshot.state.extra.queue[2].label,'Local task label');
});
test('incompatible concurrent queue reorders preserve complete alternatives',()=>{
  const base=fresh();base.state.extra.queue=['a','b','c'].map(id=>({id,articleKey:'original/1',mode:'reading',status:'pending'}));const local=copy(base),remote=copy(base);local.state.extra.queue=[local.state.extra.queue[1],local.state.extra.queue[0],local.state.extra.queue[2]];remote.state.extra.queue.reverse();
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].path,'/state/extra/queue');assert.deepEqual(S.resolve(result,'remote').snapshot.state.extra.queue,remote.state.extra.queue);
});
test('concurrent starts preserve coherent task states and never silently demote either active task',()=>{
  const base=fresh();base.state.extra.queue=['a','b'].map(id=>({id,articleKey:'original/1',mode:'reading',status:'pending'}));const local=copy(base),remote=copy(base);local.state.extra.queue[0].status='active';local.state.extra.activeTask='a';remote.state.extra.queue[1].status='active';remote.state.extra.activeTask='b';
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].kind,'task-state-conflict');assert.equal(result.conflicts[0].path,'/state/extra');
  for(const choice of ['local','remote']){const resolved=S.resolve(result,choice),x=resolved.snapshot.state.extra;assert.equal(resolved.conflicts.length,0);assert.equal(x.queue.filter(t=>t.status==='active').length,1);assert.equal(x.queue.find(t=>t.status==='active').id,x.activeTask);assert.deepEqual(x,(choice==='local'?local:remote).state.extra);}
});
test('concurrent task completion and replacement cannot leave activeTask pointing to a completed task',()=>{
  const base=fresh();base.state.extra.queue=[{id:'a',articleKey:'original/1',mode:'reading',status:'active'},{id:'b',articleKey:'original/2',mode:'reading',status:'pending'}];base.state.extra.activeTask='a';const local=copy(base),remote=copy(base);local.state.extra.queue[0].status='done';local.state.extra.activeTask=null;remote.state.extra.queue[0].status='pending';remote.state.extra.queue[1].status='active';remote.state.extra.activeTask='b';
  const result=S.merge(base,local,remote);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].kind,'task-state-conflict');assert.deepEqual(S.resolve(result,'remote').snapshot.state.extra,remote.state.extra);
});
