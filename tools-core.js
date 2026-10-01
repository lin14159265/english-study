/* Deterministic search, revision and quiz operations; no network or AI requests. */
(function(root){
  'use strict';
  const node=typeof module!=='undefined'&&module.exports,P=node?require('./package-core.js'):root.StudyPack,L=node?require('./learning-core.js'):root.StudyLearningCore;
  const clone=x=>JSON.parse(JSON.stringify(x));
  function revise(payload,index,previous,reviewed=false){
    const a=payload.articles[index], changed=P.signature(a)!==P.signature(previous);
    for(const q of a.questions||[]){if(reviewed){q.sourceSignature=P.signature(a);q.status='ready';}else if(changed || JSON.stringify(q)!==JSON.stringify(previous.questions?.find(old=>old.id===q.id))){q.sourceSignature=q.sourceSignature||P.signature(previous);q.status='needs-review';}}
    return payload;
  }
  const day=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const contextAt=(text,start)=>L.sentences(text).find(s=>start>=s.start&&start<s.end)?.en || text;
  function search(data,learning,query,{batch='all',sense='',scope='all'}={}){
    const q=query.trim().toLowerCase(), result=[];if(!q)return result;
    const wordEntries=Object.entries(data.words).filter(([key,w])=>w.word.toLowerCase()===q || w.uses.some(u=>u.form.toLowerCase()===q));
    const byLemma=wordEntries.length>0;
    if(scope!=='snapshots')for(const a of data.articles){
      if(batch!=='all'&&a.batch!==batch)continue;
      a.plain.forEach((p,pi)=>{
        const matches=[];
        if(byLemma){for(const [key,w] of wordEntries){
          const forms=new Set([w.word,...w.uses.map(u=>u.form)]);for(const form of forms)for(const m of P.matches(p,form)){
            if(matches.some(r=>r.start===m.start && r.end===m.end))continue;
            // A batch's word definition cannot establish a use in another batch.
            const own=Object.entries(data.words).find(([k,v])=>v.word.toLowerCase()===w.word.toLowerCase()&&(a.batch==='original'?!k.includes('::'):k.startsWith(a.batch+'::')));
            const use=own?.[1].uses.find(u=>u.article===a.id&&u.paragraph===pi&&(Number.isInteger(u.start)?u.start===m.start:u.form.toLowerCase()===m.form.toLowerCase()&&P.matches(p,u.form).length===1));
            const context=contextAt(p,m.start), entry=use?L.usage(data,own[0],use):null;
            matches.push({id:`${a.key}:${pi}:${m.start}`,word:w.word,form:m.form,sense:use?.sense||'',context,paragraph:pi,articleKey:a.key,articleTitle:a.title,batch:a.batch,article:a.id,entry,kind:'current',start:m.start,end:m.end});
          }
        }}else{
          const chinese=/[\u3400-\u9fff]/.test(q);
          if(chinese){for(const [key,w]of Object.entries(data.words))for(const use of w.uses.filter(u=>u.article===a.id&&u.paragraph===pi&&u.sense.toLowerCase().includes(q))){const entry=L.usage(data,key,use);if(entry)matches.push({id:entry.id,word:w.word,form:use.form,sense:use.sense,context:entry.context,paragraph:pi,articleKey:a.key,articleTitle:a.title,batch:a.batch,article:a.id,entry,kind:'current'});}}
          else {const start=p.toLowerCase().indexOf(q);if(start>=0)matches.push({id:`${a.key}:${pi}:fragment`,word:'句子片段',sense:'',context:contextAt(p,start),paragraph:pi,articleKey:a.key,articleTitle:a.title,batch:a.batch,article:a.id,kind:'current'});}
        }
        result.push(...matches.filter(r=>!sense || r.sense.includes(sense)));
      });
    }
    if(scope!=='current')for(const record of [...learning.cards,...learning.notes]){
      const text=[record.word,record.form,record.sense,record.context,record.en,record.own].filter(Boolean).join(' ').toLowerCase();
      if(!text.includes(q)&&!(byLemma&&wordEntries.some(([k,w])=>w.word.toLowerCase()===record.word?.toLowerCase())))continue;
      const b=record.articleKey.split('/')[0];if(batch!=='all'&&b!==batch)continue;if(sense&&!record.sense?.includes(sense))continue;
      const where=L.locate(data,record);
      result.push({id:`snapshot:${record.id}`,word:record.word||'错句快照',form:record.form,sense:record.sense||'',context:record.context||record.en,articleTitle:record.articleTitle,articleKey:record.articleKey,paragraph:record.paragraph,batch:b,article:where?.article,kind:'snapshot',locatable:!!where});
    }
    return result;
  }
  function score(questions,answers){if(!questions.length||questions.some(q=>!q.choices.some(c=>c.id===answers[q.id])))throw new Error('请完成每一道题后再提交。');return questions.reduce((n,q)=>n+(q.answer===answers[q.id]?1:0),0);}
  function canQuiz(a){return !!a?.questions?.length && a.questions.every(q=>q.status==='ready'&&q.sourceSignature===a.sourceSignature);}
  function addTask(extra,article,mode='reading'){
    if(mode==='quiz'&&!canQuiz(article))throw new Error('本篇暂没有已复核的小测，请选仅阅读或先补充题目。');
    if(extra.queue.some(t=>t.articleKey===article.key&&['pending','active'].includes(t.status)))throw new Error('本篇已经在待办队列中。完成后可创建新的重读任务。');
    const task={id:`task-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,articleKey:article.key,title:article.title,mode,status:'pending',createdDay:day(),createdAt:new Date().toISOString(),sourceSignature:article.sourceSignature};extra.queue.push(task);return task;
  }
  function completeTask(extra,task,article){
    if(task.mode==='quiz' && (!canQuiz(article)||!extra.quizAttempts.some(a=>a.taskId===task.id&&a.articleKey===article.key&&a.sourceSignature===article.sourceSignature&&a.quizSignature===article.quizSignature)))throw new Error('此任务需要完成当前版本的小测；正文改动后请先复核题目。');
    task.status='done';task.completedAt=new Date().toISOString();task.completedDay=day();if(extra.activeTask===task.id)extra.activeTask=null;
  }
  const digest=s=>{let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return `${s.length}-${a>>>0}-${b>>>0}`;};
  function splitBackup(backup,size=2*1024*1024){const raw=JSON.stringify(backup),group=`backup-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,total=Math.ceil(raw.length/size);return Array.from({length:total},(_,i)=>({format:'english-study-backup-part',version:1,group,index:i+1,total,checksum:digest(raw),partChecksum:digest(raw.slice(i*size,(i+1)*size)),data:raw.slice(i*size,(i+1)*size)}));}
  function joinBackup(parts){if(!parts.length||parts.length>1000)throw new Error('请选择全部分卷。');const a=parts[0];if(parts.some(p=>p.format!=='english-study-backup-part'||p.version!==1||p.group!==a.group||p.total!==a.total||p.checksum!==a.checksum||!Number.isInteger(p.index)||typeof p.data!=='string'||p.partChecksum!==digest(p.data))||parts.length!==a.total||new Set(parts.map(p=>p.index)).size!==a.total||parts.some(p=>p.index<1||p.index>a.total))throw new Error('分卷缺失、重复或属于不同备份。');const raw=[...parts].sort((a,b)=>a.index-b.index).map(p=>p.data).join('');if(digest(raw)!==a.checksum)throw new Error('分卷校验失败，未修改记录。');if(raw.length>200*1024*1024)throw new Error('分卷合计超过 200 MB，请分开备份资料与学习记录。');return JSON.parse(raw);}
  const api={clone,revise,day,search,score,canQuiz,addTask,completeTask,splitBackup,joinBackup};if(node)module.exports=api;else root.StudyToolsCore=api;
})(typeof window!=='undefined'?window:globalThis);
