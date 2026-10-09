const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../workspace-core'),L=require('../learning-core'),P=require('../package-core');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),ctx);
const base=C.originalPack(ctx.window.READING_DATA),example=JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8'));
const backup=()=>({format:'english-study-backup',version:1,base:C.clone(base),packs:[C.clone(example)],state:{reader:{currentKey:'original/1',readKeys:['original/1'],positionKeys:{'original/1':200},settings:{theme:'dark'}},learning:L.empty(),extra:C.emptyExtra()}});
test('original snapshot is a validated pure-text package with stable original keys',()=>{
  const r=P.validate(base);assert.equal(r.ok,true);const mapped=C.remapOriginal(r.compiled);
  assert.equal(mapped.articles[0].key,'original/1');assert.ok(mapped.words.value);assert.ok(!mapped.articles[0].paragraphs[0].includes('data-word="original-baseline::'));
});
test('complete backups parse without losing source material, positions or draft text',()=>{
  const b=backup();b.state.learning.drafts.x={own:'我自己的理解',reason:'否定理解错',categories:['否定']};
  const r=C.parseBackup(JSON.stringify(b));assert.equal(r.ok,true);assert.equal(r.backup.state.reader.positionKeys['original/1'],200);assert.equal(r.backup.state.learning.drafts.x.own,'我自己的理解');
});
test('version 1 backup merge retains missing source progress and the selected optional resume key',()=>{
  const a=backup(),b=backup();b.state.reader.currentKey='missing/story';b.state.reader.resumeKey='other-missing/story';b.state.reader.readKeys.push('missing/story');b.state.reader.positionKeys['missing/story']=900;
  const merged=C.restorePlan(a,b,'merge','backup').backup;assert.equal(merged.version,1);assert.equal(merged.state.reader.resumeKey,'other-missing/story');assert.equal(merged.state.reader.positionKeys['missing/story'],900);assert.ok(C.parseBackup(JSON.stringify(merged)).ok);assert.ok(C.validateBackup(a).ok);
});
test('optional resume keys follow article source remapping in independent backup copies',()=>{
  const a=backup(),b=backup();b.base.articles[0].zhTitle='另一个原始版本';b.state.reader.resumeKey='original/1';const copied=C.independentCopies(a,b);assert.match(copied.state.reader.resumeKey,/^original-copy-[^/]+\/article-01$/);assert.ok(C.validateBackup(copied).ok);
});
test('corrupt, unsupported and invalid learning backups are rejected before restoring',()=>{
  assert.equal(C.parseBackup('{no').ok,false);const b=backup();b.version=2;assert.equal(C.validateBackup(b).ok,false);
  b.version=1;b.state.learning.cards=[{id:'broken'}];assert.equal(C.validateBackup(b).ok,false);
  b.state.learning.cards=[];b.packs[0].articles[0].uses[0].form='absent';assert.equal(C.validateBackup(b).ok,false);
});
test('merge is idempotent and preserves current-only records and read marks',()=>{
  const a=backup(),b=backup();b.state.reader.readKeys.push('original/2');b.state.extra.queue.push({id:'task-b',articleKey:'original/2',mode:'reading',status:'pending'});
  const once=C.restorePlan(a,b).backup,twice=C.restorePlan(once,b).backup;
  assert.equal(twice.state.extra.queue.length,1);assert.deepEqual(twice.state.reader.readKeys,['original/1','original/2']);assert.equal(C.validateBackup(twice).ok,true);
});
test('conflicts use explicit preference, never device timestamps',()=>{
  const a=backup(),b=backup();b.packs[0].title='纠错后的资料';b.state.reader.positionKeys['original/1']=500;
  let r=C.restorePlan(a,b,'merge','current');assert.ok(r.conflicts.length);assert.equal(r.backup.packs[0].title,a.packs[0].title);assert.equal(r.backup.state.reader.positionKeys['original/1'],200);
  r=C.restorePlan(a,b,'merge','backup');assert.equal(r.backup.packs[0].title,'纠错后的资料');assert.equal(r.backup.state.reader.positionKeys['original/1'],500);
});
test('replace plan is independent and does not mutate current data',()=>{
  const a=backup(),b=backup();b.state.reader.readKeys=[];const before=JSON.stringify(a);const r=C.restorePlan(a,b,'replace');assert.deepEqual(r.backup.state.reader.readKeys,[]);assert.equal(JSON.stringify(a),before);
});
test('hostile prototype keys and duplicate sources are rejected',()=>{
  const b=backup();b.state.extra.editorDrafts=JSON.parse('{"__proto__":{"x":1}}');assert.equal(C.validateBackup(b).ok,false);
  b.state.extra.editorDrafts={};b.packs.push(C.clone(example));assert.equal(C.validateBackup(b).ok,false);
});
test('independent backup copies preserve both conflicting packages and remap learning references',()=>{
 const a=backup(),b=backup();b.packs[0].title='另一份来源';const d=P.validate(b.packs[0]).compiled,w=Object.entries(d.words)[0],card=L.usage({articles:d.articles,words:d.words},w[0],w[1].uses[0]);b.state.learning.cards.push(card);b.state.extra.queue.push({id:'copy-task',articleKey:card.articleKey,mode:'reading',status:'pending'});
 const r=C.restorePlan(a,b,'merge','copy');assert.equal(r.backup.packs.length,2);const copied=r.backup.packs.find(p=>p.id!==example.id);assert.ok(copied.id.includes('copy'));assert.ok(r.backup.state.learning.cards[0].articleKey.startsWith(copied.id+'/'));assert.ok(r.backup.state.learning.cards[0].wordKey.startsWith(copied.id+'::'));assert.equal(C.validateBackup(r.backup).ok,true);
 const again=C.restorePlan(r.backup,b,'merge','copy');assert.equal(again.backup.packs.length,2);
});
test('independent original revisions keep old cards with the copied original source',()=>{
 const a=backup(),b=backup();b.state.extra.edits.original={payload:C.clone(base),baseHash:C.hash(base)};b.state.extra.edits.original.payload.articles[0].paragraphs[0].zh+='（旧设备修订）';
 const mapped=C.remapOriginal(P.validate(b.state.extra.edits.original.payload).compiled),card=L.usage(mapped,'value',mapped.words.value.uses[0]);b.state.learning.cards.push(card);
 const r=C.restorePlan(a,b,'merge','copy'),copied=r.backup.packs.find(p=>p.id.startsWith('original-copy-'));
 assert.ok(copied);assert.ok(r.backup.state.learning.cards[0].wordKey.startsWith(copied.id+'::'));assert.equal(r.backup.state.learning.cards[0].articleKey,copied.id+'/article-01');assert.equal(C.validateBackup(r.backup).ok,true);
});
test('original conflict copies keep removed cards and revision undo attached to the copy',()=>{
 const a=backup(),b=backup(),revision={payload:C.clone(base),baseHash:C.hash(base)};revision.payload.articles[0].paragraphs[0].zh+='（修订）';b.state.extra.edits.original=revision;b.state.extra.editUndo={sourceId:'original',edit:{payload:C.clone(base),baseHash:C.hash(base)}};
 const mapped=C.remapOriginal(P.validate(revision.payload).compiled),card=L.usage(mapped,'value',mapped.words.value.uses[0]);b.state.learning.trash.push({kind:'word',record:card});b.state.learning.attempts[card.id]={rating:'known',guess:'价值',at:1};
 const r=C.restorePlan(a,b,'merge','copy').backup,id=r.packs.find(p=>p.id.startsWith('original-copy-')).id,removed=r.state.learning.trash[0].record;
 assert.equal(removed.wordKey,id+'::value');assert.equal(removed.articleKey,id+'/article-01');assert.ok(r.state.learning.attempts[removed.id]);assert.equal(r.state.extra.editUndo.sourceId,id);assert.equal(r.state.extra.editUndo.edit.payload.id,id);assert.equal(C.validateBackup(r).ok,true);
});
test('optional semantic anchors round trip version 1 and obey backup conflict choice',()=>{
  const a=backup(),b=backup(),anchor={version:1,articleKey:'missing/story',contentVersion:'body-1',paragraph:3,offset:99,before:'before',after:'after',scrollY:550,viewportOffset:52,updatedAt:123};
  b.state.reader.anchorKeys={'missing/story':anchor};const merged=C.restorePlan(a,b).backup;
  assert.deepEqual(merged.state.reader.anchorKeys['missing/story'],anchor);assert.ok(C.parseBackup(JSON.stringify(merged)).ok);
  a.state.reader.anchorKeys={'missing/story':{...anchor,offset:44}};
  assert.equal(C.restorePlan(a,b,'merge','current').backup.state.reader.anchorKeys['missing/story'].offset,44);
  assert.equal(C.restorePlan(a,b,'merge','backup').backup.state.reader.anchorKeys['missing/story'].offset,99);
  b.state.reader.anchorKeys['missing/story'].articleKey='other';assert.equal(C.validateBackup(b).ok,false);
});
test('backup independent copies rewrite semantic anchor key and embedded article identity',()=>{
  const a=backup(),b=backup();b.base.articles[0].zhTitle='修改';b.state.reader.anchorKeys={'original/1':{version:1,articleKey:'original/1',contentVersion:'v1',paragraph:0,offset:10,before:'a',after:'b',scrollY:300,viewportOffset:52,updatedAt:0}};
  const copy=C.independentCopies(a,b),[key,anchor]=Object.entries(copy.state.reader.anchorKeys)[0];assert.match(key,/^original-copy-/);assert.equal(anchor.articleKey,key);assert.ok(C.validateBackup(copy).ok);
});
