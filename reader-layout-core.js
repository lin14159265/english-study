/* Read-only projections of existing personal records. No new persistence format. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudyReaderLayoutCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const list=v=>Array.isArray(v)?v:[];
  function records(articleKey,learning={},extra={}){
    const cards=list(learning.cards).filter(r=>r.articleKey===articleKey);
    const notes=list(learning.notes).filter(r=>r.articleKey===articleKey);
    const pending=list(extra.pendingSentences).filter(r=>r.articleKey===articleKey&&r.status==='pending');
    const waiting=[...pending.map(record=>({kind:'pending',record})),...notes.filter(r=>!r.resolved).map(record=>({kind:'note',record}))];
    const annotations=[...notes.map(record=>({kind:'note',record})),...pending.map(record=>({kind:'pending',record}))]
      .filter(({record:r})=>String(r.own||'').trim()||String(r.reason||'').trim());
    return {cards,waiting,annotations};
  }
  // A paragraph number alone is never enough to attach an old annotation to revised prose.
  function annotationLocation(article,record){
    if(!article||record.articleKey!==article.key||!Number.isInteger(record.paragraph))return null;
    const quote=record.en||record.context;
    return typeof quote==='string'&&quote.length&&article.plain?.[record.paragraph]?.includes(quote)?record.paragraph:null;
  }
  return {records,annotationLocation};
});
