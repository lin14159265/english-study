const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../tools-core'),P=require('../package-core'),C=require('../workspace-core'),L=require('../learning-core');
const example=JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8'));
const compiled=p=>{const r=P.validate(p);assert.equal(r.ok,true,r.errors?.join(';'));return {articles:r.compiled.articles,words:r.compiled.words};};
function question(a){return {id:'detail',prompt:'What did the team measure?',choices:[{id:'a',text:'The water.'},{id:'b',text:'The air.'},{id:'c',text:'The road.'},{id:'d',text:'The price.'}],answer:'a',explanation:'The evidence records the measurement.',evidence:[{paragraph:1,quote:a.paragraphs[0].en}]};}
const withQuiz=()=>{const p=T.clone(example);p.articles[0].questions=[question(p.articles[0])];return p;};
test('question import validates option IDs, exact evidence and backward compatibility',()=>{
 const p=withQuiz(),r=P.validate(p);assert.equal(r.ok,true);assert.equal(T.canQuiz(r.compiled.articles[0]),true);
 p.articles[0].questions[0].answer='e';assert.equal(P.validate(p).ok,false);p.articles[0].questions[0].answer='a';p.articles[0].questions[0].evidence[0].quote='Invented evidence.';assert.equal(P.validate(p).ok,false);
 const legacy=T.clone(example);delete legacy.articles[0].questions;assert.equal(P.validate(legacy).ok,true);assert.equal(T.canQuiz(P.validate(legacy).compiled.articles[0]),false);
});
test('changed source and question content invalidate scoring until explicit recheck',()=>{
 const p=withQuiz(),before=T.clone(p.articles[0]);p.articles[0].paragraphs[0].en+=' This was useful.';delete p.articles[0].paragraphs[0].sentences;
 T.revise(p,0,before);let r=P.validate(p);assert.equal(r.ok,true);assert.equal(T.canQuiz(r.compiled.articles[0]),false);
 T.revise(p,0,before,true);r=P.validate(p);assert.equal(r.ok,true);assert.equal(T.canQuiz(r.compiled.articles[0]),true);
 const old=T.clone(p.articles[0]);p.articles[0].questions[0].answer='b';T.revise(p,0,old);assert.equal(T.canQuiz(P.validate(p).compiled.articles[0]),false);
});
test('Chinese translation changes and annotation array order do not invalidate source signature',()=>{
 const p=withQuiz(),before=T.clone(p.articles[0]);p.articles[0].paragraphs[0].zh+='（修订）';p.articles[0].uses.reverse();
 assert.equal(P.signature(p.articles[0]),P.signature(before));T.revise(p,0,before);assert.equal(T.canQuiz(P.validate(p).compiled.articles[0]),true);
});
test('invalid target positions and mismatched sentence translations reject formal revisions',()=>{
 const p=T.clone(example);p.articles[0].uses[0].form='absent';assert.equal(P.validate(p).ok,false);
 const q=T.clone(example);q.articles[0].paragraphs[0].en+=' Extra text.';assert.equal(P.validate(q).ok,false);
});
test('search joins measured with its recorded lemma and keeps exact senses across batches',()=>{
 const a=compiled(example),b=T.clone(example);b.id='second-batch';b.words.find(w=>w.word==='measure').allowed='n. 措施';b.articles[0].uses.filter(u=>u.word==='measure').forEach(u=>u.sense='措施');const other=compiled(b),offset=a.articles.length;
 other.articles.forEach(a=>a.id+=offset);Object.values(other.words).forEach(w=>w.uses.forEach(u=>u.article+=offset));const d={articles:[...a.articles,...other.articles],words:{...a.words,...other.words}};
 const rows=T.search(d,L.empty(),'measured');assert.ok(rows.length>=2);assert.ok(rows.some(r=>r.sense==='测量'));assert.ok(rows.some(r=>r.sense==='措施'));
 assert.ok(T.search(d,L.empty(),'measure',{batch:'second-batch'}).every(r=>r.batch==='second-batch'));
});
test('a recorded inflection finds different forms of the same lemma in another batch',()=>{
 const a=compiled(example),b=T.clone(example);b.id='second-form';const p=b.articles[0].paragraphs[0];p.en=p.en.replace('measured','measures');delete p.sentences;delete b.articles[0].questions;b.articles[0].uses.find(u=>u.word==='measure').form='measures';
 const d=compiled(b);d.articles.forEach(x=>x.id+=a.articles.length);Object.values(d.words).forEach(w=>w.uses.forEach(u=>u.article+=a.articles.length));
 const rows=T.search({articles:[...a.articles,...d.articles],words:{...a.words,...d.words}},L.empty(),'measured');assert.ok(rows.some(r=>r.batch==='second-form'&&r.form==='measures'&&r.allowed===b.words.find(w=>w.word==='measure').allowed));
});
test('search preserves deleted context snapshots and leaves unaudited occurrences unlabeled',()=>{
 const d=compiled(example),w=Object.entries(d.words).find(([k,w])=>w.word==='measure'),entry=L.usage(d,w[0],w[1].uses[0]),s=L.empty();s.cards.push(entry);
 assert.ok(T.search({articles:[],words:{}},s,'measure').some(r=>r.kind==='snapshot'&&!r.article));
 d.articles[0].plain[0]+=' They measured again.';const rows=T.search(d,s,'measured',{scope:'current'});assert.ok(rows.some(r=>!r.sense));
 assert.equal(T.search(d,s,'measurement',{scope:'current'}).length,0);
});
test('scores use stable option IDs and require complete answers',()=>{const q=question(example.articles[0]);assert.equal(T.score([q],{detail:'a'}),1);assert.equal(T.score([q],{detail:'b'}),0);assert.throws(()=>T.score([q],{detail:'missing'}));assert.equal(T.score([{...q,choices:[...q.choices].reverse()}],{detail:'a'}),1);});
test('task rereads are independent and quiz completion requires a task-bound current question set',()=>{
 const a=P.validate(withQuiz()).compiled.articles[0],x=C.emptyExtra(),t=T.addTask(x,a,'quiz');assert.throws(()=>T.addTask(x,a));t.status='active';x.activeTask=t.id;assert.throws(()=>T.completeTask(x,t,a));
 x.quizAttempts.push({taskId:t.id,articleKey:a.key,sourceSignature:a.sourceSignature,quizSignature:a.quizSignature});T.completeTask(x,t,a);assert.equal(t.status,'done');assert.equal(x.activeTask,null);
 const second=T.addTask(x,a);assert.notEqual(second.id,t.id);assert.equal(second.status,'pending');
 const q=T.addTask(C.emptyExtra(),a,'quiz'),changed={...a,quizSignature:'updated'};assert.throws(()=>T.completeTask({...x,queue:[q]},q,changed));
});
test('split backup reassembles in any order and rejects missing mixed or duplicate parts',()=>{
 const b={format:'fixture',text:'文'.repeat(500)},parts=T.splitBackup(b,100);assert.deepEqual(T.joinBackup([...parts].reverse()),b);assert.throws(()=>T.joinBackup(parts.slice(1)));assert.throws(()=>T.joinBackup([...parts.slice(1),parts[1]]));const mixed=T.clone(parts);mixed[0].group='other';assert.throws(()=>T.joinBackup(mixed));
});
test('starter questions really quote original paragraphs and original export preserves stable article keys',()=>{
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),ctx);vm.runInNewContext(fs.readFileSync(__dirname+'/../practice-content.js','utf8'),ctx);
 const p=C.originalPack(ctx.window.READING_DATA,ctx.window.StudySampleQuestions),r=P.validate(p);assert.equal(r.ok,true,r.errors?.join(';'));assert.equal(r.compiled.articles[0].questions.length,3);assert.equal(C.remapOriginal(r.compiled).articles[0].key,'original/1');
 p.articles[0].id='changed';assert.equal(P.validate(p).ok,false);
});
