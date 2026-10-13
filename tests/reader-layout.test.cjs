const test=require('node:test'),assert=require('node:assert/strict'),C=require('../reader-layout-core');
test('three highlight modes retain legacy all/none defaults and valid saved mode',()=>{
  assert.equal(C.highlightMode({}), 'all');assert.equal(C.highlightMode({highlight:false}), 'none');
  assert.equal(C.highlightMode({highlightMode:'saved',highlight:true}),'saved');assert.equal(C.highlightMode({highlightMode:'invalid',highlight:false}),'none');
});
test('recent articles use stable keys, deduplicate checkpoints, retain missing sources and never invent legacy dates',()=>{
  const articles=[{id:99,key:'a'},{id:1,key:'b'}],reader={resumeKey:'pixel-only',visitKeys:{a:20,b:30,missing:40},anchorKeys:{a:{updatedAt:25},old:{updatedAt:10}},positionKeys:{unordered:123}};
  const rows=C.recentArticles(articles,reader);assert.deepEqual(rows.map(r=>r.key),['missing','b','a','old','pixel-only']);assert.equal(rows[0].article,null);assert.equal(rows[2].article.id,99);assert.equal(rows[2].at,25);assert.deepEqual(reader.visitKeys,{a:20,b:30,missing:40});
  assert.deepEqual(C.recentArticles(articles,{resumeKey:'a',positionKeys:{b:42}}).map(r=>r.key),['a']);
  assert.equal(C.recentArticles(articles,{visitKeys:{a:NaN,b:-1}}).length,0);
});
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
test('nearby cards prefer current valid context and keep every source record untouched',()=>{
  const a={key:'a',plain:['The first sentence.','The nearby sentence.','The final sentence.']};
  const cards=[{id:'current',articleKey:'a',paragraph:0,context:a.plain[0]},{id:'near',articleKey:'a',paragraph:1,context:a.plain[1]},{id:'far',articleKey:'a',paragraph:2,context:a.plain[2]},{id:'old',articleKey:'a',paragraph:0,context:'Removed text.'},{id:'other',articleKey:'b',paragraph:0,context:a.plain[0]}];
  const before=JSON.stringify(cards);assert.deepEqual(C.nearbyCards(a,cards,0).map(r=>r.id),['current','near','old','far']);
  assert.deepEqual(C.nearbyCards(a,cards,2,2).map(r=>r.id),['far','near']);assert.equal(JSON.stringify(cards),before);assert.equal(C.nearbyCards(a,cards,0)[0],cards[0]);
});
test('lookup placement keeps the tapped line visible and stays inside a shrinking visual viewport',()=>{
  for(const viewport of [{left:0,top:0,width:428,height:926},{left:0,top:0,width:428,height:500},{left:0,top:120,width:810,height:550},{left:45,top:80,width:350,height:500}]){
    for(const y of [viewport.top+100,viewport.top+viewport.height-60]){
      const rect={left:viewport.left+viewport.width-35,top:y,bottom:y+24},p=C.overlayPlacement({viewport,rect,width:360,header:58});
      assert.ok(p.left>=viewport.left+12);assert.ok(p.left+p.width<=viewport.left+viewport.width-12);
      assert.ok(p.top>=viewport.top+70);assert.ok(p.top+p.maxHeight<=viewport.top+viewport.height-12);
      assert.ok(p.top>=rect.bottom||p.top+p.maxHeight<=rect.top);
    }
  }
  const p=C.overlayPlacement({viewport:{left:0,top:0,width:926,height:428},rect:{left:880,top:100,bottom:124},width:360,header:58,insets:{left:47,right:47,bottom:34}});
  assert.ok(p.left>=47&&p.left+p.width<=879&&p.top+p.maxHeight<=394);
});
