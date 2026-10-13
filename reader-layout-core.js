/* Read-only projections and display preferences for personal reading records. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudyReaderLayoutCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const list=v=>Array.isArray(v)?v:[];
  function highlightMode(settings={}){
    return ['all','saved','none'].includes(settings.highlightMode)?settings.highlightMode:settings.highlight===false?'none':'all';
  }
  function recentArticles(articles,reader={},limit=5){
    const times=new Map();
    for(const [key,anchor] of Object.entries(reader.anchorKeys||{}))if(Number.isFinite(anchor?.updatedAt)&&anchor.updatedAt>=0)times.set(key,anchor.updatedAt);
    for(const [key,at] of Object.entries(reader.visitKeys||{}))if(Number.isFinite(at)&&at>=0)times.set(key,Math.max(times.get(key)||0,at));
    // Old pixel-only records have no visit time. Preserve the known resume entry
    // without inventing a chronological order for the remaining old positions.
    if(typeof reader.resumeKey==='string'&&reader.resumeKey&&!times.has(reader.resumeKey))times.set(reader.resumeKey,0);
    const byKey=new Map(articles.map(a=>[a.key,a]));
    return [...times].sort(([ak,at],[bk,bt])=>bt-at||ak.localeCompare(bk)).slice(0,limit).map(([key,at])=>({key,at,article:byKey.get(key)||null}));
  }
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
  function nearbyCards(article,cards,paragraph,limit=5){
    return list(cards).filter(r=>r.articleKey===article?.key).map((record,index)=>({record,index,p:annotationLocation(article,record)}))
      .sort((a,b)=>{
        const rank=x=>Number.isInteger(paragraph)&&x.p!==null&&Math.abs(x.p-paragraph)<=1?Math.abs(x.p-paragraph):Infinity;
        const ar=rank(a),br=rank(b);return ar===br?b.index-a.index:ar<br?-1:1;
      }).slice(0,limit).map(x=>x.record);
  }
  // Visual viewport coordinates are CSS pixels, independent of panel DPI or device name.
  function overlayPlacement({viewport,rect,width,header=70,insets={}}){
    const v=viewport,edge=12,safe=k=>Math.max(edge,Number(insets[k])||0),leftEdge=v.left+safe('left'),rightEdge=v.left+v.width-safe('right');
    const topEdge=v.top+header+edge,bottomEdge=v.top+v.height-safe('bottom'),available=Math.max(48,bottomEdge-topEdge);
    const r=rect||{left:leftEdge,top:topEdge,bottom:topEdge};
    const below=Math.max(0,bottomEdge-Math.max(topEdge,r.bottom+edge));
    const above=Math.max(0,Math.min(bottomEdge,r.top-edge)-topEdge);
    const lower=below>=Math.min(200,available*.45)||below>=above;
    const height=Math.min(available,Math.max(96,Math.min(available*.62,lower?below:above)));
    const panelWidth=Math.min(width,Math.max(24,rightEdge-leftEdge));
    const left=Math.max(leftEdge,Math.min(rightEdge-panelWidth,r.left));
    const top=Math.max(topEdge,Math.min(bottomEdge-height,lower?r.bottom+edge:r.top-edge-height));
    return {left,top,width:panelWidth,maxHeight:height};
  }
  return {highlightMode,recentArticles,records,annotationLocation,nearbyCards,overlayPlacement};
});
