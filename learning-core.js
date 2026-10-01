/* Stable learning records. Snapshots stay usable when source packages change. */
(function (root) {
  'use strict';
  const key = parts => JSON.stringify(parts);
  const categories = ['词义', '句子主干', '否定', '从句', '其他'];
  const ratings = ['known', 'uncertain', 'wrong-sense'];
  function sentences(text) {
    const out = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (!/[.!?]/.test(text[i])) continue;
      let end = i + 1;
      while (/[.!?"”’')\]]/.test(text[end] || '') && end < text.length) end++;
      if (end < text.length && !/\s/.test(text[end])) continue;
      const prefix = text.slice(start, i + 1);
      if (text[i] === '.' && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc)|\b[A-Z]|\be\.g|\bi\.e)\.$/i.test(prefix)) continue;
      const next = text.slice(end).trimStart();
      if (/["”’']/.test(text.slice(i + 1, end)) && /^[a-z]/.test(next)) continue;
      const part = text.slice(start, end).trim();
      if (part) out.push({en:part,start:start + text.slice(start,end).indexOf(part),end});
      start = end; i = end - 1;
    }
    const part = text.slice(start).trim();
    if (part) out.push({en:part,start:start + text.slice(start).indexOf(part),end:text.length});
    return out;
  }
  function contextFor(article, use) {
    const text = article.plain[use.paragraph] || '';
    let offset = use.start;
    if (!Number.isInteger(offset)) {
      const form = use.form.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const match = new RegExp(`\\b${form}\\b`, 'i').exec(text);
      offset = match?.index ?? 0;
    }
    return sentences(text).find(s=>offset>=s.start && offset<s.end)?.en || text;
  }
  function usage(data, wordKey, use) {
    const w = data.words[wordKey], a = use && data.articles.find(a=>a.id===use.article);
    if (!w || !a) return null;
    const context = contextFor(a,use);
    return {id:key(['word',wordKey,use.sense,a.key,use.paragraph,context]),wordKey,word:w.word,
      allowed:w.allowed,sense:use.sense,form:use.form,context,articleKey:a.key,articleTitle:a.title,
      paragraph:use.paragraph,created:0};
  }
  function resolveUse(data,wordKey,{article,paragraph=null,uid,form}) {
    const uses=data.words[wordKey]?.uses || [];
    if(uid)return uses.find(u=>u.article===article && u.uid===uid) || null;
    if(paragraph!==null)return uses.find(u=>u.article===article && u.paragraph===paragraph && (!form || u.form.toLowerCase()===form.toLowerCase())) || null;
    return uses.find(u=>u.article===article) || uses[0] || null;
  }
  function articleSentences(article) {
    return article.plain.flatMap((p,paragraph)=>{
      const supplied = article.sentenceTranslations?.[paragraph];
      const parts = supplied?.length ? supplied : sentences(p);
      return parts.map((s,index)=>({id:key(['sentence',article.key,paragraph,s.en]),articleKey:article.key,
        articleTitle:article.title,paragraph,index,en:s.en,
        reference:s.zh || article.translations[paragraph],referenceKind:s.zh ? 'sentence' : 'paragraph'}));
    });
  }
  function locate(data, snapshot) {
    const a = data.articles.find(a=>a.key===snapshot.articleKey);
    if (!a || !a.plain[snapshot.paragraph]?.includes(snapshot.context || snapshot.en)) return null;
    if(snapshot.wordKey && !data.words[snapshot.wordKey]?.uses.some(u=>u.article===a.id && u.paragraph===snapshot.paragraph && u.sense===snapshot.sense && contextFor(a,u)===snapshot.context))return null;
    return {article:a.id,paragraph:snapshot.paragraph};
  }
  function empty() { return {version:1,cards:[],attempts:{},drafts:{},notes:[],cursor:{},migrated:[],trash:[],guessMode:false}; }
  function load(raw) {
    const s = empty();
    if (!raw || raw.version !== 1) return s;
    const validBase = r=>r && typeof r.id==='string' && typeof r.articleKey==='string' && Number.isInteger(r.paragraph);
    s.cards = Array.isArray(raw.cards) ? raw.cards.filter(r=>validBase(r) && ['word','wordKey','sense','context','allowed'].every(k=>typeof r[k]==='string')) : [];
    s.notes = Array.isArray(raw.notes) ? raw.notes.filter(r=>validBase(r) && ['en','reference','own'].every(k=>typeof r[k]==='string')).map(r=>({...r,categories:Array.isArray(r.categories)?r.categories.filter(c=>categories.includes(c)):[]})) : [];
    s.trash = Array.isArray(raw.trash) ? raw.trash.filter(r=>r && ['word','sentence'].includes(r.kind) && validBase(r.record)).slice(-10) : [];
    for (const prop of ['attempts','drafts','cursor']) if (raw[prop] && typeof raw[prop]==='object' && !Array.isArray(raw[prop])) s[prop] = {...raw[prop]};
    s.migrated = Array.isArray(raw.migrated) ? raw.migrated.filter(x=>typeof x==='string') : [];
    s.guessMode = raw.guessMode===true;
    return s;
  }
  function migrate(state, legacy, data) {
    let changed = false;
    for (const wordKey of legacy) {
      if (state.migrated.includes(wordKey)) continue;
      const use = data.words[wordKey]?.uses[0];
      const card = usage(data,wordKey,use);
      if (!card) continue;
      if (!state.cards.some(c=>c.id===card.id)) state.cards.push({...card,created:Date.now(),legacy:true});
      state.migrated.push(wordKey); changed = true;
    }
    return changed;
  }
  function rate(state, entry, rating, guess) {
    if (!entry || !ratings.includes(rating)) return false;
    state.attempts[entry.id] = {rating,guess:String(guess || '').slice(0,2000),at:Date.now()};
    if (rating!=='known' && !state.cards.some(c=>c.id===entry.id)) state.cards.push({...entry,created:Date.now()});
    return true;
  }
  function saveNote(state, entry, own, tags, reason) {
    if (!entry || !String(own).trim() || !tags.some(c=>categories.includes(c))) return false;
    const before = state.notes.find(n=>n.id===entry.id);
    const note = {...entry,own:String(own).slice(0,5000),categories:tags.filter(c=>categories.includes(c)),
      reason:String(reason || '').slice(0,2000),created:before?.created || Date.now(),updated:Date.now(),resolved:false};
    state.notes = [...state.notes.filter(n=>n.id!==entry.id),note];
    return true;
  }
  const api = {sentences,contextFor,usage,resolveUse,articleSentences,locate,empty,load,migrate,rate,saveNote,categories};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.StudyLearningCore=api;
})(typeof window!=='undefined' ? window : globalThis);
