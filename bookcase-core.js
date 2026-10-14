/* Books are projections of existing stable pack IDs, never new copies of articles. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./learning-core'):root.StudyLearningCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.StudyBookcaseCore=api;})(typeof window==='object'?window:globalThis,function(L){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k),stamp=n=>Number.isFinite(n)&&n>0?n:0;
 function cover(id){if(id==='original')return 0;let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0)%5;}
 function books(articles,metadata=[],reader={}){
  const groups=new Map(),meta=new Map(metadata.map(m=>[m.id,m])),read=new Set(reader.readKeys||[]);
  for(const a of articles){if(!groups.has(a.batch))groups.set(a.batch,{id:a.batch,title:a.batchTitle,date:a.date||'',topics:[],articles:[]});groups.get(a.batch).articles.push(a);}
  return [...groups.values()].map(g=>{
   const m=meta.get(g.id)||{},keys=new Set(g.articles.map(a=>a.key)),topics=[...new Set(g.articles.flatMap(a=>a.topics||[]))],readCount=g.articles.filter(a=>read.has(a.key)).length;
   let recent=null,recentAt=0;
   for(const a of g.articles){const at=Math.max(stamp(reader.visitKeys?.[a.key]),stamp(reader.anchorKeys?.[a.key]?.updatedAt));if(at>recentAt){recent=a;recentAt=at;}}
   const global=g.articles.find(a=>a.key===reader.resumeKey),historical=g.articles.find(a=>own(reader.anchorKeys,a.key)||own(reader.positionKeys,a.key));
   const hasResume=!!(global||recent||historical),target=global||recent||historical||g.articles.find(a=>!read.has(a.key))||g.articles[0];
   return {...g,title:m.title||g.title,date:m.date||g.date,source:m.source||'unknown',revised:!!m.revised,topics,words:Number.isInteger(m.words)?m.words:new Set(g.articles.flatMap(a=>a.words||[])).size,
    total:g.articles.length,readCount,complete:readCount===g.articles.length,started:readCount>0||hasResume,hasResume,recentAt,continueKey:target.key,continueTitle:target.title,
    missingResume:typeof reader.resumeKey==='string'&&reader.resumeKey.startsWith(g.id+'/')&&!keys.has(reader.resumeKey),cover:cover(g.id)};
  });
 }
 function chapters(book,{query='',read='all',readKeys=[]}={}){const seen=new Set(readKeys);return book.articles.filter(a=>(read==='all'||seen.has(a.key)===(read==='read'))&&L.queryMatches(a.title+' '+(a.zhTitle||'')+' '+book.title+' '+(book.sourceTitle||'')+' '+(book.collection||'')+' '+book.topics.join(' '),query));}
 function filter(books,{query='',topic='all',read='all'}={}){
  return books.filter(b=>(topic==='all'||b.topics.includes(topic))&&(read==='all'||read==='read'&&b.complete||read==='unread'&&!b.complete||read==='progress'&&b.started&&!b.complete))
   .map(b=>{const titleMatch=L.queryMatches(b.title+' '+(b.sourceTitle||'')+' '+(b.collection||'')+' '+b.topics.join(' '),query),matches=titleMatch?b.articles:chapters(b,{query});return {...b,titleMatch,matches};}).filter(b=>b.matches.length);
 }
 const action=b=>b.hasResume?'继续阅读':b.complete?'重读本书':b.readCount?'读未读章节':'开始阅读';
 return {books,filter,chapters,cover,action};
});
