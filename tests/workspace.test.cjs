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
