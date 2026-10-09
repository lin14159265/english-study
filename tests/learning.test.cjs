const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../learning-core.js');
const pack=require('../package-core.js');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),ctx);
const source=ctx.window.READING_DATA;
const data={words:source.words,articles:source.articles.map(a=>({...a,key:`original/${a.id}`}))};
const originalCard=i=>C.usage(data,'value',data.words.value.uses[i]);
test('same lemma saves separate senses and immutable original contexts',()=>{
  const a=originalCard(0),b=originalCard(1);
  assert.equal(a.sense,'价值');assert.equal(b.sense,'重视');assert.notEqual(a.id,b.id);
  assert.match(a.context,/value/);assert.match(b.context,/value/);
  const s=C.empty();C.rate(s,a,'uncertain','价值观');C.rate(s,b,'wrong-sense','价值');
  assert.equal(s.cards.length,2);assert.equal(s.attempts[b.id].guess,'价值');
  C.rate(s,b,'uncertain','重视');assert.equal(s.cards.length,2);
  assert.equal(s.attempts[b.id].rating,'uncertain');
  assert.equal(C.load(JSON.parse(JSON.stringify(s))).cards[1].context,b.context);
});
test('migration occurs once and does not re-add a deliberately removed old favorite',()=>{
  const s=C.empty();assert.equal(C.migrate(s,['value','portable'],data),true);
  assert.equal(s.cards.length,2);assert.equal(s.cards[0].legacy,true);
  s.cards=[];assert.equal(C.migrate(s,['value','portable'],data),false);
  assert.equal(s.cards.length,0);
});
test('source reorder uses stable article keys and deletion or rewrite retains snapshot without wrong jump',()=>{
  const card=originalCard(1);
  const reordered=[...data.articles].reverse().map((a,i)=>({...a,id:i+1}));
  const remap=new Map(data.articles.map(a=>[a.id,reordered.find(b=>b.key===a.key).id]));
  const changed={words:Object.fromEntries(Object.entries(data.words).map(([k,w])=>[k,{...w,uses:w.uses.map(u=>({...u,article:remap.get(u.article)}))}])),articles:reordered};
  assert.equal(C.locate(changed,card).article,12);
  const removed={...changed,articles:changed.articles.filter(a=>a.key!==card.articleKey)};
  assert.equal(C.locate(removed,card),null);
  const rewritten={...data,articles:data.articles.map(a=>a.key===card.articleKey?{...a,plain:a.plain.map(()=> 'New text.')}:a)};
  assert.equal(C.locate(rewritten,card),null);assert.equal(card.sense,'重视');
});
test('specific occurrence context handles repeated forms, abbreviations, decimals and quoted speech',()=>{
  const en='Dr. Lee measured 3.5 units. "Is it enough?" she asked. They measured again.';
  const list=C.sentences(en);assert.equal(list.length,3);
  assert.equal(list[0].en,'Dr. Lee measured 3.5 units.');
  assert.equal(list[1].en,'"Is it enough?" she asked.');
  assert.equal(C.contextFor({plain:[en]},{paragraph:0,form:'measured',start:en.lastIndexOf('measured')}),'They measured again.');
});
test('sentence references distinguish supplied sentence translations from legacy paragraph references',()=>{
  const p=JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8'));
  const a=pack.validate(p).compiled.articles[0];
  const rows=C.articleSentences(a);assert.equal(rows.length,7);
  assert.equal(rows[1].referenceKind,'sentence');assert.equal(rows[1].reference,a.sentenceTranslations[0][1].zh);
  delete a.sentenceTranslations;const old=C.articleSentences(a);
  assert.equal(old[1].referenceKind,'paragraph');assert.equal(old[1].reference,a.translations[0]);
  assert.equal(old[1].id,rows[1].id);
});
test('wrong sentences require own attempt and category, update without duplicates and persist source snapshot',()=>{
  const s=C.empty(),row=C.articleSentences(data.articles[0])[0];
  assert.equal(C.saveNote(s,row,'', ['词义'],''),false);
  assert.equal(C.saveNote(s,row,'我的理解', [],''),false);
  assert.equal(C.saveNote(s,row,'我的理解',['词义','否定'],'忽略了 not'),true);
  C.saveNote(s,row,'修改后的理解',['从句'],'重新分析');
  assert.equal(s.notes.length,1);assert.equal(s.notes[0].own,'修改后的理解');
  const reloaded=C.load(JSON.parse(JSON.stringify(s)));
  assert.equal(reloaded.notes[0].en,row.en);assert.deepEqual(reloaded.notes[0].categories,['从句']);
  assert.equal(reloaded.notes[0].referenceKind,'paragraph');
});
test('knowing a word records self-assessment without adding a card or accepting unrecognized ratings',()=>{
  const s=C.empty(),a=originalCard(0);C.rate(s,a,'known','价值');
  assert.equal(s.cards.length,0);assert.equal(s.attempts[a.id].rating,'known');
  assert.equal(C.rate(s,a,'automatic-correct',''),false);
});
test('imported occurrence and same lemma from another batch use independent stable cards',()=>{
  const p=JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8'));
  let a=pack.validate(p).compiled;
  const first=C.usage(a,p.id+'::measure',a.words[p.id+'::measure'].uses[0]);
  p.id='another-batch';p.words[0].allowed='v. 测量（另一个词表）';a=pack.validate(p).compiled;
  const second=C.usage(a,p.id+'::measure',a.words[p.id+'::measure'].uses[0]);
  assert.notEqual(first.id,second.id);assert.notEqual(first.allowed,second.allowed);
  assert.equal(first.context,p.articles[0].paragraphs[0].sentences[1].en);
});
test('a legacy annotation without an exact use never borrows another articles answer',()=>{
  assert.equal(C.resolveUse(data,'one',{article:1,paragraph:3,form:'One'}),null);
  const exact=C.resolveUse(data,'value',{article:1,paragraph:2,form:'value'});
  assert.equal(exact.sense,'价值');assert.equal(exact.article,1);
  assert.equal(C.resolveUse(data,'value',{article:14,paragraph:3,form:'value'}).sense,'重视');
});
test('recently removed records remain available after reload for undo',()=>{
  const s=C.empty(),card=originalCard(0);s.trash.push({kind:'word',record:card});
  assert.equal(C.load(JSON.parse(JSON.stringify(s))).trash[0].record.sense,'价值');
});

test('a corrected sense cannot silently reattach a saved old sense to the same sentence',()=>{const card=originalCard(0),changed={...data,words:{...data.words,value:{...data.words.value,uses:data.words.value.uses.map(u=>({...u,sense:'来源已修正'}))}}};assert.equal(C.locate(changed,card),null);assert.equal(card.sense,'价值');});
test('forward-compatible personal learning fields survive loading and known-record updates',()=>{
  const raw={...C.empty(),futurePersonal:{notes:['private'],setting:true}};
  const loaded=C.load(raw);assert.deepEqual(loaded.futurePersonal,raw.futurePersonal);loaded.futurePersonal.notes.push('later');assert.equal(raw.futurePersonal.notes.length,1);
});
