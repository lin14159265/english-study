/* V3.1 private book metadata, local search and source-constrained sense comparisons. */
(function(root,factory){const node=typeof module==='object'&&module.exports,api=factory(node?require('./learning-core'):root.StudyLearningCore,node?require('./study-core'):root.StudyCore);if(node)module.exports=api;else root.StudyLibraryToolsCore=api;})(typeof window==='object'?window:globalThis,function(L,C){
 'use strict';
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),list=v=>Array.isArray(v)?v:[],clone=v=>JSON.parse(JSON.stringify(v));
 const norm=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim(),lower=v=>norm(v).toLowerCase(),str=(v,n)=>typeof v==='string'&&v.length<=n,date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 function preferences(book,prefs={}){const p=prefs[book.id]||{};return {...book,title:p.title||book.title,sourceTitle:book.title,collection:p.collection||'',pinned:p.pinned===true,archived:p.archived===true,cover:p.cover>=0?p.cover:book.cover};}
 function organize(books,{section='active',collection='all',sort='source'}={}){
  const out=books.filter(b=>(section==='all'||section==='archived'?section==='all'||b.archived:!b.archived)&&(collection==='all'||b.collection===collection));
  return out.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(sort==='recent'?b.recentAt-a.recentAt:sort==='title'?a.title.localeCompare(b.title,'zh-CN'):0));
 }
 function validBinding(b){return object(b)&&['catalogId','namespace','wordId','senseId','pos','word','definition','fingerprint'].every(k=>str(b[k],k==='definition'?10000:200)&&b[k].length)&&str(b.dictionaryId,160);}
 function validItem(i){return object(i)&&str(i.id,50000)&&str(i.word,160)&&str(i.wordKey,500)&&str(i.sense,10000)&&str(i.articleKey,500)&&str(i.articleTitle,500)&&str(i.context,50000)&&i.context.length>0&&Number.isInteger(i.paragraph)&&i.paragraph>=0&&str(i.contentVersion,200)&&str(i.sourceRecordId,50000)&&Array.isArray(i.choices)&&i.choices.length>=2&&i.choices.length<=4&&i.choices.every(b=>validBinding(b)&&lower(b.word)===lower(i.word))&&new Set(i.choices.map(C.identity)).size===i.choices.length&&new Set(i.choices.map(b=>norm(b.definition))).size===i.choices.length&&i.choices.some(b=>C.identity(b)===i.answer);}
 function validate(extra){
  const errors=[];
  if(extra.bookSettings!==undefined){if(!object(extra.bookSettings)||Object.keys(extra.bookSettings).length>10000)errors.push('书架私人设置无效。');else for(const [key,p]of Object.entries(extra.bookSettings))if(!str(key,200)||!key||!object(p)||!str(p.title,200)||!str(p.collection,80)||typeof p.pinned!=='boolean'||typeof p.archived!=='boolean'||!Number.isInteger(p.cover)||p.cover<-1||p.cover>4||!date(p.at)){errors.push('书籍显示设置无效。');break;}}
  if(extra.senseSession!==undefined&&extra.senseSession!==null){const s=extra.senseSession;if(!object(s)||!str(s.id,200)||!s.id||!date(s.at)||!Array.isArray(s.items)||!s.items.length||s.items.length>10||!s.items.every(validItem)||!Number.isInteger(s.index)||s.index<0||s.index>s.items.length||!object(s.draft)||!str(s.draft.choice,50000)||!['sure','unsure'].includes(s.draft.confidence)||s.draft.choice&&(s.index>=s.items.length||!s.items[s.index].choices.some(b=>C.identity(b)===s.draft.choice)))errors.push('义项辨析回合无效。');}
  if(extra.senseAttempts!==undefined){if(!object(extra.senseAttempts)||Object.keys(extra.senseAttempts).length>200000)errors.push('义项辨析记录无效。');else for(const [key,a]of Object.entries(extra.senseAttempts))if(!object(a)||a.id!==key||!str(key,250)||!str(a.sessionId,200)||!validItem(a.item)||!date(a.at)||!str(a.choice,50000)||!['sure','unsure'].includes(a.confidence)||!['match','different','uncertain','skipped'].includes(a.outcome)||['match','different'].includes(a.outcome)&&(!a.item.choices.some(b=>C.identity(b)===a.choice)||(a.choice===a.item.answer)!==(a.outcome==='match'))){errors.push('义项辨析作答无效。');break;}}
  return errors;
 }
 function searchIndex(data,learning={},extra={},books=[]){
  const out=[],titles=new Map(books.map(b=>[b.id,b.title])),byKey=new Map(data.articles.map(a=>[a.key,a]));
  function add(kind,id,title,text,articleKey,paragraph=0,quote='',more=''){
   const a=byKey.get(articleKey),bookTitle=titles.get(a?.batch)||a?.batchTitle||'历史资料';
   out.push({kind,id,title,text:String(text||''),articleKey,paragraph,quote,articleTitle:a?.title||more||'历史文章',bookTitle,searchText:lower([title,text,bookTitle,a?.batchTitle,a?.title,a?.zhTitle,more].join(' '))});
  }
  for(const a of data.articles){add('article','title:'+a.key,a.title,a.zhTitle||'',a.key);a.plain.forEach((p,i)=>add('article','paragraph:'+a.key+':'+i,a.title,p+'\n'+(a.translations[i]||''),a.key,i,p));}
  for(const r of list(learning.cards))add('word',r.id,r.word+' · '+r.sense,r.context,r.articleKey,r.paragraph,r.context,r.articleTitle);
  for(const r of list(learning.notes))add('sentence',r.id,r.en,[r.own,r.reason,r.reference].filter(Boolean).join('\n'),r.articleKey,r.paragraph,r.en,r.articleTitle);
  for(const r of list(extra.lookupWords))add('note',r.id,r.text||r.word||r.query||'待查笔记',[r.note,r.notes,r.context].filter(Boolean).join('\n'),r.articleKey,r.paragraph||0,r.context||'',r.articleTitle);
  for(const r of list(extra.pendingSentences))add('note',r.id,r.en||'疑句笔记',[r.own,r.reason,r.note,r.reference].filter(Boolean).join('\n'),r.articleKey,r.paragraph||0,r.en||'',r.articleTitle);
  for(const r of list(extra.wrongQuestions))add('quiz',r.id,r.question.prompt,r.question.explanation,r.articleKey,Math.max(0,(r.question.evidence[0]?.paragraph||1)-1),r.question.evidence[0]?.quote||'',r.articleTitle);
  for(const r of list(extra.queue))add('task',r.id,r.title||r.articleTitle||'阅读任务',r.status+' '+r.mode,r.articleKey,0,'',r.articleTitle);
  return out;
 }
 function search(index,query,{kind='all',book='all',limit=50}={}){const q=lower(query);if(!q)return {total:0,rows:[]};const tokens=q.split(' '),matched=index.filter(r=>(kind==='all'||kind===r.kind)&&(book==='all'||r.articleKey?.startsWith(book+'/'))&&tokens.every(t=>r.searchText.includes(t)));return {total:matched.length,rows:matched.slice(0,limit)};}
 function snippet(text,query,max=220){const s=String(text),tokens=lower(query).split(' ').filter(Boolean),found=tokens.map(t=>lower(s).indexOf(t)).filter(i=>i>=0),start=Math.max(0,(found.length?Math.min(...found):0)-65);return (start?'…':'')+s.slice(start,start+max)+(start+max<s.length?'…':'');}
 function locate(data,row){const a=data.articles.find(a=>a.key===row.articleKey);if(!a)return null;if(!row.quote)return {key:a.key,paragraph:row.paragraph<a.plain.length?row.paragraph:0};if(a.plain[row.paragraph]?.includes(row.quote))return {key:a.key,paragraph:row.paragraph};const hits=a.plain.flatMap((p,i)=>p.includes(row.quote)?[i]:[]);return hits.length===1?{key:a.key,paragraph:hits[0]}:null;}
 function candidates(data,learning={},extra={}){
  const rows=C.catalogRows(extra.studyLexicons),saved=new Set(list(learning.cards).map(r=>r.id)),items=[],seen=new Set();
  for(const [key,w]of Object.entries(data.words))for(const u of w.uses){
   const r=L.usage(data,key,u);if(!r)continue;const a=C.association(r,extra,rows);if(!['exact','manual'].includes(a.status)||!a.binding)continue;
   const other=(rows.byWord.get(lower(r.word))||[]).filter(b=>b.catalogId===a.binding.catalogId&&b.wordId===a.binding.wordId&&b.namespace===a.binding.namespace);
   // Keep complete definitions. Inclusive or identical translations cannot serve as
   // objectively distinct options; do not split commas or infer missing senses.
   const defs=new Map();for(const b of other)if(!defs.has(norm(b.definition)))defs.set(norm(b.definition),b);
   const answer=a.binding,distinct=[...defs.values()].filter(b=>C.identity(b)!==C.identity(answer)&&norm(b.definition)!==norm(answer.definition)&&!norm(b.definition).includes(norm(answer.definition))&&!norm(answer.definition).includes(norm(b.definition)));
   if(!distinct.length)continue;
   // Two uses of the same lemma with different annotated senses in one sentence
   // require token-level disambiguation beyond this conservative first version.
   if(w.uses.some(v=>v.article===u.article&&v.paragraph===u.paragraph&&v.sense!==u.sense&&L.contextFor(data.articles.find(a=>a.id===u.article),v)===r.context))continue;
   const id=JSON.stringify([r.id,C.identity(answer)]);if(seen.has(id))continue;seen.add(id);
   const choices=[answer,...distinct.slice(0,3)],item={id,word:r.word,wordKey:r.wordKey,sense:r.sense,allowed:r.allowed,articleKey:r.articleKey,articleTitle:r.articleTitle,paragraph:r.paragraph,context:r.context,form:r.form,contentVersion:data.articles.find(a=>a.id===u.article).sourceSignature||'',sourceRecordId:r.id,choices:clone(choices),answer:C.identity(answer),saved:saved.has(r.id)};
   items.push(item);
  }
  return items.sort((a,b)=>Number(b.saved)-Number(a.saved));
 }
 function session(data,learning,extra,{limit=5,now=Date.now(),random=Math.random}={}){
  const all=candidates(data,learning,extra),history=Object.values(extra.senseAttempts||{}),last=new Map();for(const a of history)last.set(a.item.id,Math.max(last.get(a.item.id)||0,Date.parse(a.at)));
  all.sort((a,b)=>(last.get(a.id)||0)-(last.get(b.id)||0)||Number(b.saved)-Number(a.saved));
  const items=all.slice(0,Math.max(1,Math.min(10,Number(limit)||5))).map(i=>{i=clone(i);for(let j=i.choices.length-1;j>0;j--){const k=Math.min(j,Math.floor(random()*(j+1)));[i.choices[k],i.choices[j]]=[i.choices[j],i.choices[k]];}return i;});
  return items.length?{id:'sense-'+now+'-'+random().toString(36).slice(2,10),at:new Date(now).toISOString(),items,index:0,draft:{choice:'',confidence:'unsure'}}:null;
 }
 function current(data,extra,item){const a=data.articles.find(a=>a.key===item.articleKey);if(!a||a.sourceSignature!==item.contentVersion||!a.plain[item.paragraph]?.includes(item.context))return false;const rows=C.catalogRows(extra.studyLexicons),association=C.association({...item,id:item.sourceRecordId},extra,rows);if(!['exact','manual'].includes(association.status)||!association.binding||C.identity(association.binding)!==item.answer)return false;return item.choices.every(b=>(rows.byWord.get(lower(b.word))||[]).some(r=>C.identity(r)===C.identity(b)&&r.catalogId===b.catalogId&&r.fingerprint===b.fingerprint));}
 function coverage(data,learning={},extra={}){
  const source=C.catalogRows(extra.studyLexicons),key=b=>JSON.stringify([b.catalogId,C.identity(b)]),rows=source.map(b=>({...b,id:key(b),contexts:[],history:[],status:'missing',searchText:lower([b.word,b.pos,b.definition,b.wordId,b.senseId,b.dictionaryId,b.namespace].join(' '))})),byId=new Map(rows.map(r=>[r.id,r])),pending=[],outside=[];
  const seen=new Set(),contextIds=new Map(),historyIds=new Map();
  function attach(record,historical=false){const a=C.association(record,extra,source),row=a.binding&&['exact','manual'].includes(a.status)?byId.get(key(a.binding)):null;
   if(row){const ids=historical?historyIds:contextIds;if(!ids.has(row.id))ids.set(row.id,new Set());if(!ids.get(row.id).has(record.id)){ids.get(row.id).add(record.id);row[historical?'history':'contexts'].push(record);}return;}
   if(historical)return;const targets=source.byWord.get(lower(record.word))||[];(targets.length?pending:outside).push({...record,reason:a.reason});
  }
  for(const [wordKey,w]of Object.entries(data.words))for(const u of w.uses){const r=L.usage(data,wordKey,u);if(r&&!seen.has(r.id)){seen.add(r.id);attach(r);}}
  for(const r of C.pointRecords(data,learning,extra)){if(!L.locate(data,r))attach(r,true);}
  for(const r of rows)r.status=r.contexts.length?'current':r.history.length?'history':'missing';
  const wordKey=r=>JSON.stringify([r.namespace,r.wordId]),current=rows.filter(r=>r.status==='current').length,history=rows.filter(r=>r.status==='history').length;
  return {rows,pending,outside,summary:{words:new Set(rows.map(wordKey)).size,senses:rows.length,current,history,missing:rows.length-current-history,contexts:seen.size,pending:pending.length,outside:outside.length},catalogs:Object.values(extra.studyLexicons||{}).map(c=>({id:c.id,title:c.title,namespace:c.namespace,fingerprint:c.fingerprint}))};
 }
 function coverageFilter(report,{query='',catalog='all',status='all',limit=50}={}){const q=lower(query).split(' ').filter(Boolean),matched=report.rows.filter(r=>(catalog==='all'||r.catalogId===catalog)&&(status==='all'||r.status===status||status==='gap'&&r.status!=='current')&&q.every(t=>r.searchText.includes(t)));return {total:matched.length,rows:matched.slice(0,limit)};}
 function coverageExport(report,now=Date.now()){return {format:'english-study-coverage-gaps',version:1,createdAt:new Date(now).toISOString(),note:'按当前文章与原义项唯一关联统计；不表示词义人工核验或学习掌握。仅历史快照不算当前覆盖。',catalogs:clone(report.catalogs),summary:clone(report.summary),missing:report.rows.filter(r=>r.status!=='current').map(({word,pos,definition,catalogId,namespace,wordId,senseId,dictionaryId,status})=>({word,pos,definition,catalogId,namespace,wordId,senseId,dictionaryId,status}))};}
 return {preferences,organize,validate,searchIndex,search,snippet,locate,candidates,session,current,coverage,coverageFilter,coverageExport};
});
