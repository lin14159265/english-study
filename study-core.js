/* V3 read-only learning projections. Source snapshots never get rewritten. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./learning-core.js'):root.StudyLearningCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.StudyCore=api;})(typeof window==='object'?window:globalThis,function(L){
 'use strict';
 const DAY=86400000,list=v=>Array.isArray(v)?v:[],object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const norm=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim(),lemma=v=>norm(v).toLowerCase();
 const clone=v=>JSON.parse(JSON.stringify(v)),text=(v,n=1000)=>typeof v==='string'&&v.length>0&&v.length<=n;
 const id=v=>typeof v==='number'&&Number.isSafeInteger(v)?String(v):typeof v==='string'&&v.length<=160&&v.trim()?v:null;
 function fingerprint(words){const s=JSON.stringify(words);let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return s.length+'-'+(h>>>0).toString(16);}
 function validateCatalog(c){
  const errors=[];
  if(!object(c)||c.format!=='english-study-lexicon'||c.version!==1||!text(c.id,80)||!/^[a-z0-9][a-z0-9-]*$/.test(c.id)||!text(c.namespace,80)||!text(c.title,200)||!Array.isArray(c.words)||!c.words.length||c.words.length>20000)return ['学习词库结构无效。'];
  const ids=new Set();let senses=0;
  for(const w of c.words){
   if(!object(w)||!text(w.word,160)||!text(w.wordId,160)||ids.has(w.wordId)||!Array.isArray(w.senses)||!w.senses.length){errors.push('学习词库词条或原始 ID 无效。');break;}ids.add(w.wordId);
   const seen=new Set();for(const s of w.senses){const key=JSON.stringify([s?.dictionaryId,s?.id]);if(!object(s)||!text(s.id,160)||typeof s.dictionaryId!=='string'||s.dictionaryId.length>160||!text(s.pos,80)||!text(s.definition,10000)||seen.has(key)){errors.push('学习词库义项、词性或原始 ID 无效。');break;}seen.add(key);senses++;}
   if(errors.length)break;
  }
  if(senses>80000)errors.push('学习词库义项超过 80000 条。');
  if(!errors.length&&c.fingerprint!==fingerprint(c.words))errors.push('学习词库内容标识不一致。');
  return errors;
 }
 function parseLexicon(raw){
  try{
   if(!object(raw))throw Error('请选择词库 JSON 对象。');
   let catalog;
   if(raw.format==='english-study-lexicon')catalog={format:raw.format,version:raw.version,id:raw.id,namespace:raw.namespace,title:raw.title,fingerprint:raw.fingerprint,words:raw.words.map(w=>({word:w.word,wordId:w.wordId,senses:w.senses.map(s=>({id:s.id,dictionaryId:s.dictionaryId,pos:s.pos,definition:s.definition}))}))};
   else {
    if(!object(raw.meta)||!Array.isArray(raw.words)||!raw.words.length||raw.words.length>20000)throw Error('需提供含 meta、words 和 senses 的扇贝词库（最多 20000 词）。');
    const words=raw.words.map(w=>{
     if(!object(w)||!id(w.vocabulary_id)||!Array.isArray(w.senses))throw Error('词条缺少原始 vocabulary_id 或 senses。');
     return {word:w.word,wordId:id(w.vocabulary_id),senses:w.senses.map(s=>{
      if(!object(s)||!id(s.id))throw Error('义项缺少原始 ID。');
      return {id:id(s.id),dictionaryId:s.dictionary_id==null?'':id(s.dictionary_id),pos:s.pos,definition:s.definition_cn};
     })};
    });
    catalog={format:'english-study-lexicon',version:1,id:'shanbay',namespace:'shanbay',title:'我的扇贝词库',words,fingerprint:fingerprint(words)};
   }
   const errors=validateCatalog(catalog);if(errors.length)return {ok:false,errors};
   return {ok:true,catalog,summary:{words:catalog.words.length,senses:catalog.words.reduce((n,w)=>n+w.senses.length,0)}};
  }catch(e){return {ok:false,errors:[e.message]};}
 }
 function validateStudy(extra){
  const errors=[];
  if(extra.studyLexicons!==undefined){if(!object(extra.studyLexicons)||Object.keys(extra.studyLexicons).length>10)errors.push('最多保留 10 份学习词库。');else for(const [key,c]of Object.entries(extra.studyLexicons)){if(key!==c?.id)errors.push('学习词库键不一致。');errors.push(...validateCatalog(c));}}
  if(extra.studyBindings!==undefined){
   if(!object(extra.studyBindings)||Object.keys(extra.studyBindings).length>200000)errors.push('义项关联列表无效。');
   else for(const [key,b]of Object.entries(extra.studyBindings)){
    if(!text(key,50000)||!object(b)||!text(b.at,100)||!Number.isFinite(Date.parse(b.at))){errors.push('义项关联记录无效。');break;}
    if(b.status==='independent')continue;
    if(b.status!=='linked'||!['catalogId','namespace','wordId','senseId','pos','word','definition','fingerprint'].every(k=>text(b[k],k==='definition'?10000:200))||typeof b.dictionaryId!=='string'||b.dictionaryId.length>160){errors.push('义项关联缺少来源、词性或原始 ID。');break;}
   }
  }
  if(extra.studyDeferrals!==undefined){if(!object(extra.studyDeferrals)||Object.keys(extra.studyDeferrals).length>200000)errors.push('复习暂缓列表无效。');else for(const [key,d]of Object.entries(extra.studyDeferrals)){if(!text(key,50000)||!object(d)||!text(d.at,100)||!text(d.until,100)||!Number.isFinite(Date.parse(d.at))||!Number.isFinite(Date.parse(d.until))){errors.push('复习暂缓日期无效。');break;}}}
  return errors;
 }
 const indexes=new Map(),rowSets=new Map();
 function catalogRows(catalogs){
  const values=Object.values(catalogs||{}),setKey=JSON.stringify(values.map(c=>[c.id,c.namespace,c.fingerprint]));if(rowSets.has(setKey))return rowSets.get(setKey);
  const out=[];for(const c of values){
   const cacheKey=c.id+'|'+c.namespace+'|'+c.fingerprint;let rows=indexes.get(cacheKey);
   if(!rows){rows=c.words.flatMap(w=>w.senses.map(s=>({catalogId:c.id,namespace:c.namespace,word:w.word,wordId:w.wordId,senseId:s.id,dictionaryId:s.dictionaryId,pos:s.pos,definition:s.definition,fingerprint:c.fingerprint})));indexes.set(cacheKey,rows);if(indexes.size>20)indexes.delete(indexes.keys().next().value);}
   out.push(...rows);
  }out.byWord=new Map();for(const row of out){const key=lemma(row.word);if(!out.byWord.has(key))out.byWord.set(key,[]);out.byWord.get(key).push(row);}rowSets.set(setKey,out);if(rowSets.size>20)rowSets.delete(rowSets.keys().next().value);return out;
 }
 const identity=b=>JSON.stringify(['sense',b.namespace,b.wordId,b.dictionaryId,b.senseId,norm(b.pos),lemma(b.word),norm(b.definition)]);
 function association(record,extra={},rows=catalogRows(extra.studyLexicons)){
  const candidates=rows.byWord?(rows.byWord.get(lemma(record.word))||[]):rows.filter(r=>lemma(r.word)===lemma(record.word));
  const explicit=extra.studyBindings?.[record.id];
  if(explicit?.status==='independent')return {key:JSON.stringify(['record',record.id]),status:'independent',reason:'已选择保留独立记录',binding:null};
  if(explicit?.status==='linked'){
   const live=candidates.find(r=>r.catalogId===explicit.catalogId&&r.namespace===explicit.namespace&&r.wordId===explicit.wordId&&r.senseId===explicit.senseId&&r.dictionaryId===explicit.dictionaryId&&r.pos===explicit.pos&&r.definition===explicit.definition);
   if(live)return {key:identity(live),status:'manual',reason:'已确认原始词库义项',binding:live};
   return {key:JSON.stringify(['record',record.id]),status:'pending',reason:'来源词库变化或暂不可用，保留原关联快照',binding:explicit};
  }
  const exact=candidates.filter(r=>norm(r.definition)===norm(record.sense));
  const unique=[...new Map(exact.map(r=>[identity(r),r])).values()];
  if(unique.length===1)return {key:identity(unique[0]),status:'exact',reason:'词条与释义唯一精确匹配',binding:unique[0]};
  return {key:JSON.stringify(['record',record.id]),status:'pending',reason:unique.length>1?'同义释义有多个来源或词性，待核查':rows.length?'没有唯一精确匹配，待核查':'导入学习词库后可核对关联',binding:null};
 }
 function pointRecords(data,learning,extra={}){
  const records=new Map(list(learning.cards).map(c=>[c.id,c]));
  for(const recordId of Object.keys(learning.attempts||{})){
   if(records.has(recordId))continue;
   try{const p=JSON.parse(recordId);if(p.length!==6||p[0]!=='word'||typeof p[1]!=='string'||typeof p[2]!=='string'||typeof p[3]!=='string'||!Number.isInteger(p[4])||typeof p[5]!=='string')continue;const w=data.words[p[1]];records.set(recordId,{id:recordId,wordKey:p[1],word:w?.word||p[1].split('::').at(-1),sense:p[2],articleKey:p[3],paragraph:p[4],context:p[5],allowed:w?.allowed||'',articleTitle:data.articles.find(a=>a.key===p[3])?.title||'历史文章',created:0,assessmentOnly:true});}catch{}
  }
  for(const a of Object.values(extra.senseAttempts||{})){const i=a.item;if(i&&!records.has(i.sourceRecordId))records.set(i.sourceRecordId,{id:i.sourceRecordId,wordKey:i.wordKey,word:i.word,sense:i.sense,articleKey:i.articleKey,articleTitle:i.articleTitle,paragraph:i.paragraph,context:i.context,form:i.form||i.word,allowed:i.allowed||'',created:0,assessmentOnly:true});}
  return [...records.values()];
 }
 function eventsFor(learning,extra,now){
  const map=new Map(),add=(id,event)=>{if(!Number.isFinite(event.at)||event.at<=0)return;if(!map.has(id))map.set(id,[]);map.get(id).push({...event,at:Math.min(event.at,now),clockAhead:event.at>now+300000});};
  const results=list(extra.reviewRounds).concat(extra.reviewSession?[extra.reviewSession]:[]).flatMap(round=>list(round.results)),mirrors=new Map();
  for(const r of results){const id=r.snapshot?.id||r.sourceRecordId;if(!mirrors.has(id))mirrors.set(id,[]);mirrors.get(id).push(r);}
  for(const [id,a]of Object.entries(learning.attempts||{}))if(!(mirrors.get(id)||[]).some(r=>r.kind==='word'&&r.rating===a.rating&&(r.guess||'')===(a.guess||'')&&Math.abs(Date.parse(r.at)-Number(a.at))<=2000))add(id,{id:'point-'+id+'-'+a.at,at:Number(a.at),rating:a.rating,kind:'word',mode:'point',guess:a.guess||''});
  for(const r of results)add(r.sourceRecordId,{id:r.id,at:Date.parse(r.at),rating:r.rating,kind:r.kind,mode:r.mode,correct:r.correct,guess:r.guess||'',context:r.snapshot?.context||r.snapshot?.en||'',sense:r.snapshot?.sense||''});
  for(const a of Object.values(extra.senseAttempts||{}))if(['match','different'].includes(a.outcome))add(a.item.sourceRecordId,{id:a.id,at:Date.parse(a.at),rating:a.outcome==='match'?(a.confidence==='sure'?'known':'uncertain'):'wrong-sense',kind:'sense',mode:'comparison',correct:a.outcome==='match',confidence:a.confidence,context:a.item.context,sense:a.item.choices.find(b=>identity(b)===a.item.answer)?.definition||''});
  return map;
 }
 function schedule(events,now){
  const history=[...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  if(!history.length)return {dueAt:now,interval:0,reason:'尚无复习判断，先独立回忆一次',evidence:'未复习',history};
  const last=history.at(-1),known=e=>['question','sense'].includes(e.kind)?e.correct===true&&(e.kind!=='sense'||e.confidence==='sure'):e.rating==='known';
  if(!known(last)){const interval=last.rating==='wrong-sense'||last.kind==='question'||last.kind==='sense'&&last.correct===false?600000:DAY;return {dueAt:last.at+interval,interval,reason:interval===DAY?'最近仍模糊，1 天后再核对':'最近误判，10 分钟后换语境复测',evidence:['question','sense'].includes(last.kind)?'客观作答':'自评',history};}
  let streak=0,previous=Infinity;
  for(let i=history.length-1;i>=0;i--){const e=history[i];if(!known(e))break;if(previous-e.at>=20*3600000){streak++;previous=e.at;}}
  const days=[1,3,7,14,30][Math.min(4,Math.max(0,streak-1))],interval=days*DAY;
  return {dueAt:last.at+interval,interval,reason:`${Math.max(1,streak)} 次间隔至少 20 小时的认识判断，${days} 天后再验证`,evidence:['question','sense'].includes(last.kind)?'客观作答':'自评，尚需新语境验证',history};
 }
 function profiles(data,learning={},extra={},now=Date.now()){
  const rows=catalogRows(extra.studyLexicons),groups=new Map(),events=eventsFor(learning,extra,now);
  for(const r of pointRecords(data,learning,extra)){
   const a=association(r,extra,rows);if(!groups.has(a.key))groups.set(a.key,{id:a.key,word:r.word,sense:a.binding?.definition||r.sense,pos:a.binding?.pos||'',status:a.status,binding:a.binding,reason:a.reason,records:[],events:[]});
   const group=groups.get(a.key);group.records.push(r);group.events.push(...(events.get(r.id)||[]));
  }
  return [...groups.values()].map(g=>({...g,schedule:deferred(schedule(g.events,now),g.id,extra,now),saved:g.records.filter(r=>!r.assessmentOnly).length})).sort((a,b)=>a.schedule.dueAt-b.schedule.dueAt||a.word.localeCompare(b.word)||a.id.localeCompare(b.id));
 }
 function deferred(s,id,extra,now){const d=extra.studyDeferrals?.[id],until=d&&Date.parse(d.until);return until>now&&until>s.dueAt?{...s,dueAt:until,reason:'手动暂缓至 '+new Date(until).toLocaleString('zh-CN')+'；不计作认识或复习',deferred:true}:s;}
 function planned(data,learning={},extra={},now=Date.now()){
  const events=eventsFor(learning,extra,now),out=[];
  for(const group of profiles(data,learning,extra,now)){
   if(!group.saved)continue;const r=group.records.find(r=>!r.assessmentOnly);
   out.push({id:group.id,kind:'word',record:r,profile:group,schedule:group.schedule,due:group.schedule.dueAt<=now});
  }
  for(const r of list(learning.notes).filter(r=>!r.resolved)){const s=deferred(schedule(events.get(r.id)||[],now),r.id,extra,now);out.push({id:r.id,kind:'sentence',record:r,schedule:s,due:s.dueAt<=now});}
  for(const r of list(extra.wrongQuestions).filter(r=>!r.resolved)){const s=deferred(schedule(events.get(r.id)||[],now),r.id,extra,now);out.push({id:r.id,kind:'question',record:r,schedule:s,due:s.dueAt<=now});}
  return out.sort((a,b)=>a.schedule.dueAt-b.schedule.dueAt||a.id.localeCompare(b.id));
 }
 function makeRound(data,learning,extra,{now=Date.now(),limit=5,early=false}={}){
  const rows=catalogRows(extra.studyLexicons),targets=planned(data,learning,extra,now).filter(r=>early||r.due).slice(0,Math.max(1,Math.min(20,Number(limit)||5)));
  const uses=new Map();
  if(targets.some(t=>t.kind==='word'&&t.profile.status!=='pending'&&t.profile.status!=='independent'))for(const [wordKey,w]of Object.entries(data.words))for(const u of w.uses){const r=L.usage(data,wordKey,u);if(!r)continue;const a=association(r,extra,rows);if(['manual','exact'].includes(a.status)){if(!uses.has(a.key))uses.set(a.key,[]);uses.get(a.key).push(r);}}
  const items=targets.map(t=>{const alternate=t.kind==='word'?(uses.get(t.profile.id)||[]).find(r=>r.context!==t.record.context):null;return {id:t.record.id,sourceRecordId:t.record.id,kind:t.kind,snapshot:clone(alternate||t.record),mode:alternate?'transfer':'saved',order:1,at:t.schedule.history.at(-1)?.at||0};});
  return {id:'study-'+now+'-'+Math.random().toString(36).slice(2,8),startedAt:new Date(now).toISOString(),index:0,items,results:[],draft:{}};
 }
 function recommendations(data,learning,extra,reader={},now=Date.now(),limit=3){
  const groups=profiles(data,learning,extra,now),due=new Map(groups.filter(g=>g.saved&&g.schedule.dueAt<=now&&['exact','manual'].includes(g.status)).map(g=>[g.id,g])),rows=catalogRows(extra.studyLexicons),read=new Set(reader.readKeys||[]);
  return data.articles.map(a=>{const matched=new Set();for(const wordKey of a.words||[])for(const u of data.words[wordKey]?.uses||[])if(u.article===a.id){const r=L.usage(data,wordKey,u),key=association(r,extra,rows).key;if(due.has(key))matched.add(key);}
   const count=matched.size,words=[...matched].map(key=>due.get(key).word+' · '+due.get(key).sense);
   return {article:a,count,words,score:count*10+(read.has(a.key)?0:2),reason:count?`再次遇到 ${count} 个待复测义项：${words.slice(0,3).join('；')}`:read.has(a.key)?'重读熟悉文章，重新核对语境。':'从一篇未读文章开始，留下具体用义与难句。'};
  }).sort((a,b)=>b.score-a.score||a.article.id-b.article.id).slice(0,limit);
 }
 function groupShelf(articles,{query='',batch='all',topic='all',read='all',readKeys=[]}={}){
  const seen=new Set(readKeys),groups=new Map();
  for(const a of articles){if(batch!=='all'&&a.batch!==batch||topic!=='all'&&!list(a.topics).includes(topic)||read==='read'&&!seen.has(a.key)||read==='unread'&&seen.has(a.key)||!L.queryMatches(a.title+' '+a.zhTitle+' '+a.batchTitle,query))continue;
   if(!groups.has(a.batch))groups.set(a.batch,{id:a.batch,title:a.batchTitle,articles:[]});groups.get(a.batch).articles.push(a);
  }return [...groups.values()];
 }
 return {DAY,parseLexicon,validateCatalog,validateStudy,catalogRows,identity,association,pointRecords,eventsFor,schedule,profiles,planned,makeRound,recommendations,groupShelf};
});
