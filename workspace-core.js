/* Pure data operations shared by browser and Node verification. */
(function(root){
  'use strict';
  const P=typeof module!=='undefined'&&module.exports?require('./package-core.js'):root.StudyPack;
  const L=typeof module!=='undefined'&&module.exports?require('./learning-core.js'):root.StudyLearningCore;
  const clone=x=>JSON.parse(JSON.stringify(x));
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':object(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
  function hash(x){const s=canonical(x);let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return `${s.length}-${(a>>>0).toString(16)}-${(b>>>0).toString(16)}`;}
  const articleHash=a=>hash({paragraphs:a.paragraphs.map(p=>p.en),uses:a.uses});
  function originalPack(base,samples=base.sampleQuestions||root.StudySampleQuestions||{}){
    const words=Object.entries(base.words).map(([word,w])=>({word:w.word,allowed:w.allowed,...(!w.uses.length?{omission:w.omission||'原词表义项存疑，暂未用于正文。'}:{})}));
    const articles=base.articles.map(a=>({id:`article-${String(a.id).padStart(2,'0')}`,title:a.title,zhTitle:a.zhTitle,
      paragraphs:a.plain.map((en,i)=>({en,zh:a.translations[i],...(a.sentenceTranslations?.[i]?{sentences:clone(a.sentenceTranslations[i])}:{})})),
      uses:Object.entries(base.words).flatMap(([word,w])=>w.uses.filter(u=>u.article===a.id).map(u=>({word:w.word,paragraph:u.paragraph+1,form:u.form,sense:u.sense,occurrence:Number.isInteger(u.start)?Math.max(1,P.matches(a.plain[u.paragraph],u.form).findIndex(m=>m.start===u.start)+1):1}))),...(samples[a.id]?{questions:clone(samples[a.id])}:{})}));
    return {format:'english-study-pack',version:1,id:'original-baseline',title:'原始 1000 词资料',date:base.date,sourceCount:words.length,words,articles};
  }
  function remapOriginal(compiled){
    const articles=compiled.articles.map(a=>({...a,key:`original/${a.id}`,batch:'original',batchTitle:'原始 1000 词资料',
      words:a.words.map(k=>k.split('::').slice(1).join('::')),paragraphWords:a.paragraphWords.map(ws=>ws.map(k=>k.split('::').slice(1).join('::'))),
      paragraphs:a.paragraphs.map(p=>p.replace(/data-word="original-baseline::/g,'data-word="'))}));
    const words=Object.fromEntries(Object.entries(compiled.words).map(([k,w])=>[k.slice('original-baseline::'.length),w]));
    return {articles,words};
  }
  const emptyExtra=()=>({edits:{},editorDrafts:{},quizDrafts:{},quizAttempts:[],wrongQuestions:[],queue:[],activeTask:null,removedTasks:[]});
  function validateState(s){
    const errors=[];if(!object(s)||!object(s.reader)||!object(s.learning)||!object(s.extra))return ['备份缺少阅读、学习或扩展状态。'];
    const r=s.reader,l=s.learning;
    if(r.readKeys!==undefined&&(!Array.isArray(r.readKeys)||r.readKeys.some(k=>typeof k!=='string')))errors.push('已读文章键无效。');
    if(r.positionKeys!==undefined&&(!object(r.positionKeys)||Object.values(r.positionKeys).some(n=>!Number.isFinite(n)||n<0)))errors.push('阅读位置无效。');
    if(l.version!==1)errors.push('学习记录版本不支持。');
    const loaded=L.load(l);
    for(const k of ['cards','notes','migrated','trash'])if(!Array.isArray(l[k])||loaded[k].length!==l[k].length)errors.push(`学习记录 ${k} 无效。`);
    for(const k of ['attempts','drafts','cursor'])if(!object(l[k]))errors.push(`学习记录 ${k} 无效。`);
    if(object(l.attempts)&&Object.values(l.attempts).some(a=>!object(a)||!['known','uncertain','wrong-sense'].includes(a.rating)||typeof a.guess!=='string'))errors.push('词义自测记录无效。');
    if(object(l.drafts)&&Object.values(l.drafts).some(d=>!object(d)||typeof d.own!=='string'||typeof d.reason!=='string'||!Array.isArray(d.categories)||d.categories.some(c=>!L.categories.includes(c))))errors.push('理解草稿无效。');
    if(object(l.cursor)&&Object.values(l.cursor).some(n=>!Number.isInteger(n)||n<0))errors.push('逐句位置无效。');
    for(const n of l.notes||[])if(!Array.isArray(n.categories)||n.categories.some(c=>!L.categories.includes(c)))errors.push('错句分类无效。');
    const x=s.extra;
    for(const k of ['edits','editorDrafts','quizDrafts'])if(!object(x[k]))errors.push(`扩展状态 ${k} 无效。`);
    for(const k of ['quizAttempts','wrongQuestions','queue','removedTasks'])if(!Array.isArray(x[k]))errors.push(`扩展记录 ${k} 无效。`);
    if(object(x.edits))for(const [id,e]of Object.entries(x.edits))if(!object(e)||!object(e.payload)||!P.validate(e.payload).ok||(id==='original'?e.payload.id!=='original-baseline':id!==e.payload.id))errors.push(`修订资料 ${id} 无效。`);
    if(Array.isArray(x.queue))for(const t of x.queue)if(!object(t)||typeof t.id!=='string'||typeof t.articleKey!=='string'||!['reading','quiz'].includes(t.mode)||!['pending','active','done','skipped'].includes(t.status))errors.push('任务队列记录无效。');
    if(Array.isArray(x.quizAttempts))for(const a of x.quizAttempts)if(!object(a)||typeof a.id!=='string'||typeof a.articleKey!=='string'||!Array.isArray(a.questions)||!a.questions.length||!object(a.answers)||!Number.isInteger(a.score)||a.total!==a.questions.length||a.questions.some(q=>!validQuestionSnapshot(q)||!q.choices.some(c=>c.id===a.answers[q.id]))||a.score!==a.questions.filter(q=>q.answer===a.answers[q.id]).length)errors.push('小测作答记录无效。');
    if(Array.isArray(x.wrongQuestions))for(const q of x.wrongQuestions)if(!object(q)||typeof q.id!=='string'||typeof q.articleKey!=='string'||!validQuestionSnapshot(q.question))errors.push('阅读错题记录无效。');
    if(object(x.editorDrafts))for(const [key,d]of Object.entries(x.editorDrafts))if(!object(d)||!object(d.payload)||!Array.isArray(d.payload.articles)||!Array.isArray(d.payload.words)||typeof d.baseHash!=='string'||!Number.isInteger(d.paragraphIndex)||d.paragraphIndex<0)errors.push('编辑草稿结构无效。');
    if(object(x.quizDrafts))for(const d of Object.values(x.quizDrafts))if(!object(d)||typeof d.articleKey!=='string'||typeof d.sourceSignature!=='string'||!object(d.answers)||Object.values(d.answers).some(v=>typeof v!=='string'))errors.push('小测草稿结构无效。');
    for(const k of ['cards','notes'])if(Array.isArray(l[k])&&new Set(l[k].map(r=>r.id)).size!==l[k].length)errors.push('学习记录存在重复 ID。');
    for(const k of ['quizAttempts','wrongQuestions','queue','removedTasks'])if(Array.isArray(x[k])&&new Set(x[k].map(r=>r.id)).size!==x[k].length)errors.push('扩展记录存在重复 ID。');
    if(x.removedQuestions!==undefined&&(!Array.isArray(x.removedQuestions)||x.removedQuestions.some(r=>!object(r)||typeof r.id!=='string'||!validQuestionSnapshot(r.question))))errors.push('已移除错题记录无效。');
    if(x.editUndo!==undefined&&(!object(x.editUndo)||typeof x.editUndo.sourceId!=='string'||x.editUndo.edit!==null&&(!object(x.editUndo.edit)||!P.validate(x.editUndo.edit.payload).ok)))errors.push('修订撤销记录无效。');
    return [...new Set(errors)];
  }
  function validQuestionSnapshot(q){return object(q)&&typeof q.id==='string'&&typeof q.prompt==='string'&&q.prompt.trim().length>0&&Array.isArray(q.choices)&&q.choices.length===4&&new Set(q.choices.map(c=>c?.id)).size===4&&q.choices.every(c=>object(c)&&typeof c.id==='string'&&typeof c.text==='string'&&c.text.trim().length>0)&&q.choices.some(c=>c.id===q.answer)&&typeof q.explanation==='string'&&q.explanation.trim().length>0&&Array.isArray(q.evidence)&&q.evidence.length>0&&q.evidence.every(e=>object(e)&&Number.isInteger(e.paragraph)&&e.paragraph>0&&typeof e.quote==='string'&&e.quote.trim().length>0);}
  function dangerous(x){if(!object(x)&&!Array.isArray(x))return false;return Object.entries(x).some(([k,v])=>['__proto__','constructor','prototype'].includes(k)||dangerous(v));}
  function validateBackup(b){
    const errors=[];
    if(!object(b)||b.format!=='english-study-backup'||b.version!==1)return {ok:false,errors:['请选择版本 1 的 English Study 学习备份。']};
    if(dangerous(b))return {ok:false,errors:['备份包含不允许的数据键。']};
    if(!Array.isArray(b.packs)||b.packs.length>1000)return {ok:false,errors:['备份资料列表无效或超过 1000 份。']};
    const ids=new Set();for(const p of b.packs){const r=P.validate(p);if(!r.ok)errors.push(`资料 ${p?.id||''}：${r.errors[0]}`);if(ids.has(p?.id))errors.push('备份资料 ID 重复。');ids.add(p?.id);}
    if(!P.validate(b.base).ok||b.base.id!=='original-baseline')errors.push('原始资料快照无效。');
    errors.push(...validateState(b.state));
    const keys=new Set([...Array.from({length:25},(_,i)=>`original/${i+1}`),...b.packs.flatMap(p=>(p.articles||[]).map(a=>`${p.id}/${a.id}`))]);
    const missing=[...(b.state?.learning?.cards||[]),...(b.state?.learning?.notes||[]),...(b.state?.extra?.queue||[])].filter(r=>!keys.has(r.articleKey));
    return {ok:!errors.length,errors,summary:{missing:missing.length,packs:b.packs.length,cards:b.state?.learning?.cards?.length||0,notes:b.state?.learning?.notes?.length||0,tasks:b.state?.extra?.queue?.length||0,attempts:b.state?.extra?.quizAttempts?.length||0}};
  }
  function parseBackup(s){try{if(s.length>100*1024*1024)return {ok:false,errors:['备份超过 100 MB，请使用分卷备份。']};const b=JSON.parse(s.replace(/^\uFEFF/,''));return {...validateBackup(b),backup:b};}catch{return {ok:false,errors:['备份 JSON 格式错误，未修改任何记录。']};}}
  function mergeList(a,b,prefer,conflicts,label,key='id'){
    const m=new Map(a.map(x=>[typeof x==='string'?x:x[key],clone(x)]));
    for(const row of b){const id=typeof row==='string'?row:row[key];if(m.has(id)&&canonical(m.get(id))!==canonical(row)){conflicts.push(`${label}：${row.articleTitle||row.title||row.word||id}`);if(prefer==='backup')m.set(id,clone(row));}else if(!m.has(id))m.set(id,clone(row));}return [...m.values()];
  }
  function mergeMap(a,b,prefer,conflicts,label){const result=clone(a);for(const [k,v]of Object.entries(b)){if(Object.hasOwn(result,k)&&canonical(result[k])!==canonical(v)){conflicts.push(`${label}：${k}`);if(prefer==='backup')result[k]=clone(v);}else result[k]=clone(v);}return result;}
  function independentCopies(current,incoming){
    const copy=clone(incoming), mapping={};
    for(const p of copy.packs){const old=current.packs.find(x=>x.id===p.id),edit=copy.state.extra.edits[p.id],currentEdit=current.state.extra.edits[p.id];
      if(old && (hash(old)!==hash(p) || edit && hash(edit)!==hash(currentEdit||{}))){const oldId=p.id,newId=`${oldId.slice(0,60)}-copy-${hash(edit?.payload||p).split('-')[1]}`;mapping[oldId]=newId;p.id=newId;p.title+='（备份副本）';}
    }
    const originalEdit=copy.state.extra.edits.original,currentOriginal=current.state.extra.edits.original;
    if(hash(current.base)!==hash(copy.base) || originalEdit && hash(originalEdit)!==hash(currentOriginal||{})){
      const p=clone(originalEdit?.payload||copy.base),id=`original-copy-${hash(p).split('-')[1]}`;p.id=id;p.title+='（备份副本）';copy.packs.push(p);mapping.original=id;copy.base=clone(current.base);
    }
    function rewriteString(s){for(const [old,id]of Object.entries(mapping)){
      if(old==='original'){for(let i=1;i<=25;i++){const key=`original/${i}`,replacement=`${id}/article-${String(i).padStart(2,'0')}`;if(s===key)s=replacement;else s=s.split(JSON.stringify(key)).join(JSON.stringify(replacement));}}
      else {if(s===old)s=id;else if(s.startsWith(old+'/')||s.startsWith(old+'::'))s=id+s.slice(old.length);else s=s.split('"'+old+'/').join('"'+id+'/').split('"'+old+'::').join('"'+id+'::');}
    }return s;}
    function rewrite(v){if(typeof v==='string')return rewriteString(v);if(Array.isArray(v))return v.map(rewrite);if(object(v))return Object.fromEntries(Object.entries(v).map(([k,v])=>[rewriteString(k),rewrite(v)]));return v;}
    copy.state=rewrite(copy.state);
    if(mapping.original){const id=mapping.original;delete copy.state.extra.edits.original;const cards=[...copy.state.learning.cards,...copy.state.learning.trash.filter(t=>t.kind==='word').map(t=>t.record)];for(const card of cards)if(card.articleKey.startsWith(id+'/')){const oldId=card.id;card.wordKey=`${id}::${card.wordKey}`;card.id=JSON.stringify(['word',card.wordKey,card.sense,card.articleKey,card.paragraph,card.context]);if(copy.state.learning.attempts[oldId]){copy.state.learning.attempts[card.id]=copy.state.learning.attempts[oldId];delete copy.state.learning.attempts[oldId];}}}
    if(mapping.original){const id=mapping.original,p=copy.packs.find(p=>p.id===id);for(const [key,d]of Object.entries(copy.state.extra.editorDrafts))if(key.startsWith(id+'/')){d.payload.id=id;d.baseHash=hash(p);}}
    for(const [old,id]of Object.entries(mapping)){if(old==='original')continue;const e=copy.state.extra.edits[id];if(e){e.payload.id=id;e.baseHash=hash(copy.packs.find(p=>p.id===id));}}
    const undo=copy.state.extra.editUndo;if(undo){if(mapping.original&&undo.sourceId==='original')undo.sourceId=mapping.original;if(Object.values(mapping).includes(undo.sourceId)&&undo.edit){undo.edit.payload.id=undo.sourceId;undo.edit.baseHash=hash(copy.packs.find(p=>p.id===undo.sourceId));}}
    return copy;
  }
  function restorePlan(current,incoming,mode='merge',prefer='current'){
    const valid=validateBackup(incoming);if(!valid.ok)throw new Error(valid.errors[0]);const conflicts=[];
    if(mode==='replace')return {backup:clone(incoming),conflicts,summary:valid.summary};
    if(prefer==='copy'){incoming=independentCopies(current,incoming);prefer='current';}
    const out=clone(current),a=out.state,b=incoming.state;
    out.packs=mergeList(out.packs,incoming.packs,prefer,conflicts,'资料','id');
    if(hash(out.base)!==hash(incoming.base)){conflicts.push('原始资料版本不同');if(prefer==='backup')out.base=clone(incoming.base);}
    for(const k of ['cards','notes','migrated'])a.learning[k]=mergeList(a.learning[k],b.learning[k],prefer,conflicts,k,k==='trash'?'record.id':'id');
    // Trash has no top-level ID; deduplicate using the preserved record ID.
    a.learning.trash=[...new Map([...current.state.learning.trash,...incoming.state.learning.trash].map(x=>[x.record.id,clone(x)])).values()].slice(-10);
    for(const k of ['attempts','drafts','cursor'])a.learning[k]=mergeMap(a.learning[k],b.learning[k],prefer,conflicts,k);
    a.reader.readKeys=[...new Set([...(a.reader.readKeys||[]),...(b.reader.readKeys||[])])];
    a.reader.positionKeys=mergeMap(a.reader.positionKeys||{},b.reader.positionKeys||{},prefer,conflicts,'阅读位置');
    if(prefer==='backup'){a.reader.settings=clone(b.reader.settings||{});a.reader.currentKey=b.reader.currentKey;a.learning.guessMode=b.learning.guessMode;}
    for(const k of ['edits','editorDrafts','quizDrafts'])a.extra[k]=mergeMap(a.extra[k],b.extra[k],prefer,conflicts,k);
    for(const k of ['quizAttempts','wrongQuestions','queue','removedTasks'])a.extra[k]=mergeList(a.extra[k],b.extra[k],prefer,conflicts,k);
    if(!a.extra.activeTask||prefer==='backup')a.extra.activeTask=b.extra.activeTask;
    const active=a.extra.queue.filter(t=>t.status==='active');if(active.length){if(!active.some(t=>t.id===a.extra.activeTask))a.extra.activeTask=active[0].id;for(const t of active)if(t.id!==a.extra.activeTask)t.status='pending';}else a.extra.activeTask=null;
    if(b.extra.lastTask&&(!a.extra.lastTask||prefer==='backup'))a.extra.lastTask=b.extra.lastTask;
    a.extra.removedQuestions=mergeList(a.extra.removedQuestions||[],b.extra.removedQuestions||[],prefer,conflicts,'移除的错题');
    if(b.extra.editUndo && (!a.extra.editUndo||prefer==='backup'))a.extra.editUndo=clone(b.extra.editUndo);
    const checked=validateBackup(out);if(!checked.ok)throw new Error(checked.errors[0]);
    return {backup:out,conflicts:[...new Set(conflicts)],summary:checked.summary};
  }
  const api={clone,hash,articleHash,originalPack,remapOriginal,emptyExtra,validateState,validateBackup,parseBackup,restorePlan,independentCopies,validQuestionSnapshot};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudyWorkspaceCore=api;
})(typeof window!=='undefined'?window:globalThis);
