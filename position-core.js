/* Semantic reading positions. Pure functions also used by Node regression tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudyPositionCore=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function fingerprint(paragraphs){const text=JSON.stringify(paragraphs);let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return `${text.length}-${(hash>>>0).toString(16)}`;}
  function valid(a){return !!a&&a.version===1&&typeof a.articleKey==='string'&&typeof a.contentVersion==='string'&&Number.isInteger(a.paragraph)&&a.paragraph>=0&&Number.isInteger(a.offset)&&a.offset>=0&&typeof a.before==='string'&&a.before.length<=32&&typeof a.after==='string'&&a.after.length<=48&&Number.isFinite(a.scrollY)&&a.scrollY>=0&&Number.isFinite(a.viewportOffset)&&Math.abs(a.viewportOffset)<=10000&&Number.isFinite(a.updatedAt);}
  function capture({articleKey,paragraphs,paragraph,offset,scrollY,viewportOffset,updatedAt=Date.now()}){
    const text=paragraphs[paragraph];if(typeof text!=='string')return null;
    offset=Math.max(0,Math.min(text.length,Math.trunc(offset)));
    return {version:1,articleKey,contentVersion:fingerprint(paragraphs),paragraph,offset,before:text.slice(Math.max(0,offset-32),offset),after:text.slice(offset,offset+48),scrollY:Math.max(0,scrollY),viewportOffset,updatedAt};
  }
  function resolve(anchor,articleKey,paragraphs){
    if(!valid(anchor)||anchor.articleKey!==articleKey)return null;
    if(anchor.contentVersion===fingerprint(paragraphs)&&typeof paragraphs[anchor.paragraph]==='string')return {paragraph:anchor.paragraph,offset:Math.min(anchor.offset,paragraphs[anchor.paragraph].length),viewportOffset:anchor.viewportOffset};
    // Context is searched across all paragraphs so an inserted paragraph does not shift the saved sentence.
    const contexts=[{text:anchor.before+anchor.after,shift:anchor.before.length},{text:anchor.after,shift:0},{text:anchor.before,shift:anchor.before.length}];
    for(const {text,shift} of contexts){
      if(text.length<12)continue;
      const found=[];paragraphs.forEach((p,paragraph)=>{let start=0,index;while((index=p.indexOf(text,start))!==-1){found.push({paragraph,offset:index+shift,viewportOffset:anchor.viewportOffset});start=index+1;if(found.length>100)return;}});
      if(found.length===1)return found[0];
      // Repeated generic text is ambiguous after edits: use the compatible pixel position rather than invent a match.
    }
    return null;
  }
  return {fingerprint,valid,capture,resolve};
});
