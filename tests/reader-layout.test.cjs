const test=require('node:test'),assert=require('node:assert/strict'),C=require('../reader-layout-core');
test('margin projections are isolated by stable article key and never create or mutate personal records',()=>{
  const learning={cards:[{id:'c',articleKey:'pack/a'},{id:'other',articleKey:'pack/b'}],notes:[{id:'n',articleKey:'pack/a',own:'我的理解'}]},extra={pendingSentences:[{id:'p',articleKey:'pack/a',status:'pending',reason:'否定句'},{id:'done',articleKey:'pack/a',status:'done',reason:'已完成'}]};
  const before=JSON.stringify({learning,extra}),r=C.records('pack/a',learning,extra);
  assert.deepEqual(r.cards.map(x=>x.id),['c']);assert.deepEqual(r.waiting.map(x=>x.record.id),['p','n']);assert.deepEqual(r.annotations.map(x=>x.record.id),['n','p']);assert.equal(JSON.stringify({learning,extra}),before);assert.equal(r.cards[0],learning.cards[0]);
  assert.deepEqual(C.records('pack/missing',learning,extra),{cards:[],waiting:[],annotations:[]});
});
test('resolved notes remain accessible as annotations but do not re-enter the waiting list',()=>{
  const r=C.records('a',{notes:[{id:'resolved',articleKey:'a',resolved:true,own:'已核对'},{id:'blank',articleKey:'a',own:'  ',reason:''}]});
  assert.deepEqual(r.annotations.map(x=>x.record.id),['resolved']);assert.deepEqual(r.waiting.map(x=>x.record.id),['blank']);
});
test('annotation anchors require genuine saved English text in the same stable article and paragraph',()=>{
  const a={key:'a',plain:['A real sentence. The next sentence.','A different paragraph.']},r={articleKey:'a',paragraph:0,en:'A real sentence.'};
  assert.equal(C.annotationLocation(a,r),0);
  for(const patch of [{articleKey:'b'},{paragraph:1},{paragraph:'0'},{paragraph:-1},{en:'Old removed text.'},{en:''}])assert.equal(C.annotationLocation(a,{...r,...patch}),null);
  assert.equal(C.annotationLocation({...a,plain:['Revised source.']},r),null);
  assert.equal(C.annotationLocation(a,{articleKey:'a',paragraph:0,context:'The next sentence.'}),0);
});
