const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../package-core.js');
const example = JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8'));
const copy = () => { const p=structuredClone(example);p.articles.forEach(a=>a.paragraphs.forEach(p=>delete p.sentences));return p; };
function invalid(mutate, pattern) {
  const pack = copy(); mutate(pack);
  const result = core.validate(pack);
  assert.equal(result.ok,false);
  assert.match(result.errors.join(' '),pattern);
}
test('example compiles exact paragraphs, inflections, alignment and first target highlights',()=>{
  const result = core.validate(example); assert.equal(result.ok,true);
  assert.deepEqual(result.summary,{articles:1,words:3,used:3,unused:0});
  const article = result.compiled.articles[0];
  assert.equal(article.plain[0],example.articles[0].paragraphs[0].en);
  assert.equal(article.translations[1],example.articles[0].paragraphs[1].zh);
  assert.equal(article.key,'2026-10-01-example/campus-project');
  assert.match(article.paragraphs[0],/data-word="2026-10-01-example::measure"[^>]*>measured<\/strong>/);
  assert.equal(result.compiled.words['2026-10-01-example::measure'].uses[0].paragraph,0);
});
test('rejects malformed JSON, fences, unsupported schema and bad source count',()=>{
  assert.equal(core.parse('```json\n{}\n```').ok,false);
  invalid(p=>p.version=2,/version/);
  invalid(p=>p.sourceCount=2,/sourceCount/);
});
test('rejects duplicate words, article ids, reserved ids and invalid calendar dates',()=>{
  invalid(p=>p.words.push({...p.words[0],word:'Measure'}),/重复/);
  invalid(p=>p.articles.push(structuredClone(p.articles[0])),/id/);
  invalid(p=>p.id='original',/id/);
  invalid(p=>p.date='2026-02-30',/date/);
});
test('requires allowed meanings and paragraph translations',()=>{
  invalid(p=>delete p.words[0].allowed,/allowed/);
  invalid(p=>delete p.articles[0].paragraphs[0].zh,/en 和 zh/);
});
test('rejects unlisted words, wrong paragraph and non-occurring forms',()=>{
  invalid(p=>p.articles[0].uses[0].word='unknown',/不存在/);
  invalid(p=>p.articles[0].uses[0].paragraph=0,/从 1/);
  invalid(p=>p.articles[0].uses[0].form='measuring',/找不到/);
  invalid(p=>p.articles[0].uses[0].occurrence=2,/找不到/);
});
test('whole-word matching excludes substring while allowing punctuation and case',()=>{
  assert.deepEqual(core.matches('Immeasured MEASURED, measured.', 'measured').map(m=>m.start),[11,21]);
  assert.equal(core.matches('A practical-solution is practical.', 'practical').length,2);
});
test('a missing target requires an explicit omission and cannot also claim use',()=>{
  invalid(p=>p.articles[0].uses.shift(),/measure 未用于/);
  const p=copy(); p.articles[0].uses.shift(); p.words[0].omission='示例：词义存疑，待核对';
  const r=core.validate(p); assert.equal(r.ok,true); assert.equal(r.summary.unused,1); assert.equal(r.warnings.length,1);
  invalid(p=>p.words[0].omission='未出现',/冲突/);
});
test('rejects overlapping and duplicate annotations',()=>{
  invalid(p=>p.articles[0].uses.push({...p.articles[0].uses[0]}),/重叠/);
});
test('multiple occurrences retain separate meanings and only the first is strong',()=>{
  const p=copy(); p.articles[0].paragraphs[0].en += ' They measured it again.';
  p.articles[0].uses.push({...p.articles[0].uses[0],occurrence:2,sense:'测量（再次）'});
  const r=core.validate(p); assert.equal(r.ok,true);
  const w=r.compiled.words[p.id+'::measure']; assert.equal(w.uses.length,2); assert.notEqual(w.uses[0].uid,w.uses[1].uid);
  assert.equal(w.uses[1].start,p.articles[0].paragraphs[0].en.lastIndexOf('measured'));
  assert.match(r.compiled.articles[0].paragraphs[0],/<span class="target target-repeat"/);
});
test('rejects executable markup and escapes other imported text',()=>{
  invalid(p=>p.articles[0].paragraphs[0].en+='<script>alert(1)</script>',/纯文本/);
  const p=copy(); p.articles[0].paragraphs[0].en += ' A < B & C.';
  const r=core.validate(p); assert.equal(r.ok,true);
  assert.match(r.compiled.articles[0].paragraphs[0],/A &lt; B &amp; C\./);
});
test('batch scoping keeps a repeated lemma and its different meanings independent',()=>{
  const a=core.validate(example), p=copy(); p.id='2026-10-02-test'; p.words[0].allowed='n. 措施';
  p.articles[0].paragraphs[0].en='The measure helped.'; p.articles[0].uses[0].form='measure'; p.articles[0].uses[0].sense='措施';
  const b=core.validate(p); assert.equal(b.ok,true);
  const combined={...a.compiled.words,...b.compiled.words};
  assert.equal(combined[example.id+'::measure'].allowed,'v. 测量');
  assert.equal(combined[p.id+'::measure'].allowed,'n. 措施');
});
test('legacy material remains intact when browser storage is unavailable',async()=>{
  const base={window:{}}; vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),base);
  const before=JSON.stringify(base.window.READING_DATA);
  const ctx={window:{StudyPack:core},document:{getElementById:()=>null},setTimeout,clearTimeout,indexedDB:{open(){throw new Error('disabled');}}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../imports.js','utf8'),ctx);
  const data=await ctx.window.StudyLibrary.open(base.window.READING_DATA);
  assert.equal(data.articles.length,25); assert.equal(Object.keys(data.words).length,1000);
  assert.equal(data.articles[0].key,'original/1');
  assert.equal(JSON.stringify(base.window.READING_DATA),before);
});
test('optional sentence pairs preserve exact source and reject omitted or rewritten English',()=>{
  const r=core.validate(example);assert.equal(r.ok,true);
  assert.equal(r.compiled.articles[0].sentenceTranslations[0][1].zh,example.articles[0].paragraphs[0].sentences[1].zh);
  const p=structuredClone(example);p.articles[0].paragraphs[0].sentences.pop();
  assert.equal(core.validate(p).ok,false);
  p.articles[0].paragraphs[0].sentences=[];
  assert.match(core.validate(p).errors.join(' '),/逐句译文/);
  const q=structuredClone(example);q.articles[0].paragraphs[0].sentences[0].en='Different sentence.';
  assert.match(core.validate(q).errors.join(' '),/拼接/);
  assert.equal(core.validate(copy()).ok,true);
  assert.equal(core.validate(copy()).compiled.articles[0].sentenceTranslations[0],null);
});
