(function(root){
  'use strict';const C=root.StudyWorkspaceCore,S=root.StudyState,P=root.StudyPack,$=id=>document.getElementById(id),esc=s=>P.escape(s??'');
  function download(payload,name){const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function create({data,current,persist,toast,closeAux,navigate,selectedWord,saveCard,reviewChanged,markRead}){
    let incoming=null,restoreDraft=null;
    const base=()=>C.originalPack(root.READING_DATA);
    function snapshot(){persist();return {format:'english-study-backup',version:1,exportedAt:new Date().toISOString(),base:base(),packs:root.StudyLibrary.payloads(),state:C.clone({reader:S.get('reader',{}),learning:S.get('learning',root.StudyLearningCore.empty()),extra:S.get('extra',C.emptyExtra())})};}
    function preview(){
      $('restoreConfirm').disabled=true;restoreDraft=null;if(!incoming)return;
      try{const mode=$('restoreMode').value,plan=C.restorePlan(snapshot(),incoming,mode,$('restorePreference').value);restoreDraft=plan.backup;const s=plan.summary;
        $('restorePreview').innerHTML=`<p><strong>${s.packs} 份新增资料 · ${s.cards} 张义项卡 · ${s.notes} 条错句 · ${s.tasks} 个任务 · ${s.attempts} 次小测</strong></p><p>${mode==='merge'&&$('restorePreference').value==='copy'?'冲突资料将另存为副本，并改写备份记录的来源引用。 ':''}${mode==='replace'?'将完整替换当前学习数据，恢复前版本可回退。':'与当前数据合并，重复记录去重。'} ${plan.conflicts.length?'以下冲突采用所选版本，不按设备时间自动覆盖。':'未发现内容冲突。'}</p>${plan.conflicts.length?`<details open><summary>${plan.conflicts.length} 项冲突</summary><ul>${plan.conflicts.slice(0,100).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}<p>${s.missing?`${s.missing} 条记录的原文章缺失，将保留历史快照，任务可替换来源。`:'记录所需的文章来源均在备份中。'}</p><p class="settings-note">本机修订、草稿和个人记录不会因恢复而上传。缺失的原位置仍保留学习快照。</p>`;
        $('restoreConfirm').disabled=false;
      }catch(e){$('restorePreview').textContent=e.message;}
    }
    function parse(text){const r=C.parseBackup(text);incoming=r.ok?r.backup:null;$('restorePreview').hidden=false;if(!r.ok){restoreDraft=null;$('restoreConfirm').disabled=true;$('restorePreview').textContent=r.errors.join('；');}else preview();}
    $('backupOpen').addEventListener('click',()=>{$('libraryDialog').close();$('backupDialog').showModal();});
    $('backupDownload').addEventListener('click',async()=>{try{const b=snapshot(),r=C.validateBackup(b);if(!r.ok)throw new Error(r.errors[0]);await S.flush().catch(()=>{});download(b,`english-study-backup-${root.StudyToolsCore.day()}.json`);$('backupStatus').textContent='备份已生成，请保留下载的 JSON 文件。';}catch(e){$('backupStatus').textContent=e.message;}});
    $('backupFile').addEventListener('change',async e=>{try{const files=[...e.target.files];if(!files.length)return;const limit=files.length===1?100:200;if(files.reduce((n,f)=>n+f.size,0)>limit*1024*1024)throw new Error(`备份超过 ${limit} MB，未读取或修改记录。`);const texts=await Promise.all(files.map(f=>f.text())),parts=texts.map(t=>JSON.parse(t.replace(/^\uFEFF/,'')));if(parts[0].format==='english-study-backup-part'){incoming=root.StudyToolsCore.joinBackup(parts);const r=C.validateBackup(incoming);if(!r.ok)throw new Error(r.errors[0]);$('restorePreview').hidden=false;preview();}else if(files.length===1)parse(texts[0]);else throw new Error('请选择单个完整备份，或同一次备份的全部分卷。');}catch(err){incoming=null;restoreDraft=null;$('restoreConfirm').disabled=true;$('restorePreview').hidden=false;$('restorePreview').textContent=err.message;}});
    $('backupParse').addEventListener('click',()=>parse($('backupPaste').value));
    $('restoreMode').addEventListener('change',preview);$('restorePreference').addEventListener('change',preview);
    $('restoreConfirm').addEventListener('click',async()=>{if(!restoreDraft)return;$('restoreConfirm').disabled=true;try{await S.restore(restoreDraft,base());$('backupStatus').textContent='恢复成功，正在重新打开阅读器。';location.reload();}catch(e){$('backupStatus').textContent=e.message;$('restoreConfirm').disabled=false;}});
    $('backupRollback').addEventListener('click',async()=>{try{await S.rollback();location.reload();}catch(e){$('backupStatus').textContent=e.message;}});
    const T=root.StudyToolsCore,L=root.StudyLearningCore;
    const extra=()=>C.clone(S.get('extra',C.emptyExtra()));
    const store=x=>S.set('extra',x);
    const run=fn=>async()=>{try{await fn();}catch(e){toast(e.message);}};
    function open(id){document.querySelectorAll('dialog[open]').forEach(d=>d.close());closeAux();$(id).showModal();}
    function refreshReview(){reviewChanged();}
    function toolsHome(){ $('toolsCurrent').textContent=`当前文章：${current().title}`;open('toolsDialog'); }
    $('toolsButton').addEventListener('click',toolsHome);
    $('toolsBackup').addEventListener('click',()=>open('backupDialog'));
    $('wordHistory').addEventListener('click',()=>openSearch(selectedWord()?.word||''));
    $('wordCorrect').addEventListener('click',()=>openEditor(selectedWord()?.paragraph||0));
    $('contextOpen').addEventListener('click',()=>openSearch(''));
    $('editorOpen').addEventListener('click',()=>openEditor());
    $('quizOpen').addEventListener('click',()=>openQuiz());
    $('queueOpen').addEventListener('click',()=>{renderQueue();open('queueDialog');});
    $('backupSplit').addEventListener('click',run(async()=>{const b=snapshot(),checked=C.validateBackup(b);if(!checked.ok)throw new Error(checked.errors[0]);const parts=T.splitBackup(b);for(const p of parts)download(p,`${p.group}-${String(p.index).padStart(3,'0')}-of-${parts.length}.json`);$('backupStatus').textContent=`已生成 ${parts.length} 个分卷。恢复时选择同一备份的全部分卷文件。浏览器如询问连续下载，请允许本次下载。`;}));

    // Editor drafts never replace the reading source until validation and an explicit save.
    let editor=null,paragraphIndex=0,resetArmed=false;
    const input=(label,value,field,type='text')=>`<label>${esc(label)}<input class="learning-input" data-field="${field}" type="${type}" value="${esc(value)}" ${type==='number'?'min="1" step="1"':''}></label>`;
    const textarea=(label,value,field,rows=2)=>`<label>${esc(label)}<textarea class="learning-input" rows="${rows}" data-field="${field}">${esc(value)}</textarea></label>`;
    function openEditor(pi=null){
      const model=root.StudyLibrary.model(current().key);if(!model){toast('找不到可编辑资料');return;}
      const saved=extra().editorDrafts[current().key];editor={...model,key:current().key,before:C.clone(model.payload.articles[model.index]),initial:C.clone(model.payload)};
      if(saved?.payload?.id===model.payload.id && saved.baseHash===C.hash(model.payload)){editor.payload=C.clone(saved.payload);pi=pi??saved.paragraphIndex;}
      paragraphIndex=Math.min(Math.max(0,pi??0),editor.payload.articles[editor.index].paragraphs.length-1);resetArmed=false;
      $('editReviewed').checked=false;$('editReset').textContent='恢复来源版本';$('editorPreview').hidden=true;
      $('editorSource').textContent=`${model.sourceId==='original'?'原始资料':model.payload.title} · 修订只保存在当前浏览器${model.conflict?' · 来源已更新或移除，当前修订仍保留，请对照后再决定。':''}${saved && saved.baseHash!==C.hash(model.payload)?' · 来源已变化，旧草稿保留在备份中，没有自动覆盖新正文。':''}`;
      $('sourceWord').innerHTML=editor.payload.words.map(w=>`<option value="${esc(w.word)}">${esc(w.word)}</option>`).join('');$('sourceAllowed').value=editor.payload.words[0].allowed;$('sourceReason').value='';
      $('editorStatus').textContent=saved?.baseHash===C.hash(model.payload)?'已恢复未提交的草稿。':'修改会暂存草稿，保存前请核查词义。';renderEditor();open('editorDialog');
    }
    function renderEditor(){
      const a=editor.payload.articles[editor.index],p=a.paragraphs[paragraphIndex];
      $('editTitle').value=a.title;$('editZhTitle').value=a.zhTitle;
      $('editParagraph').innerHTML=a.paragraphs.map((p,i)=>`<option value="${i}">第 ${i+1} 段</option>`).join('');$('editParagraph').value=String(paragraphIndex);
      $('editEn').value=p.en;$('editZh').value=p.zh;
      $('editSentences').innerHTML=(p.sentences||[]).map((s,i)=>`<div class="edit-row" data-sentence="${i}">${textarea('本句英文',s.en,'en')}${textarea('本句中文参考',s.zh,'zh')}<button class="text-button" data-remove-sentence="${i}">移除句子对照</button></div>`).join('');
      $('editorWords').innerHTML=editor.payload.words.map(w=>`<option value="${esc(w.word)}"></option>`).join('');
      $('editUses').innerHTML=a.uses.filter(u=>u.paragraph===paragraphIndex+1).map((u,i)=>{
        const w=editor.payload.words.find(w=>w.word.toLowerCase()===u.word.toLowerCase());
        return `<div class="edit-row" data-use-row><div class="edit-grid"><label>目标词<input class="learning-input" data-field="word" list="editorWords" value="${esc(u.word)}"></label>${input('实际词形',u.form,'form')}${input('本段第几次出现',u.occurrence||1,'occurrence','number')}${input('实际中文用义',u.sense,'sense')}</div><p class="settings-note use-allowed">词表允许义项：${esc(w?.allowed||'')}</p><button class="text-button" data-remove-use="${i}">移除用词记录</button></div>`;
      }).join('');
      $('sourceCorrectionHistory').innerHTML=(editor.payload.sourceCorrections||[]).map(c=>`<p class="settings-note">${esc(c.word)}：${esc(c.before)} → ${esc(c.after)} · ${esc(c.reason)}</p>`).join('');
      const unused=editor.payload.words.filter(w=>!editor.payload.articles.some(a=>a.uses.some(u=>u.word.toLowerCase()===w.word.toLowerCase())));
      $('editOmissions').innerHTML=unused.map(w=>`<label class="learning-label">${esc(w.word)} · ${esc(w.allowed)}<input class="learning-input" data-omission="${esc(w.word)}" value="${esc(w.omission||'')}" placeholder="未使用原因，不能用词表之外的含义凑覆盖"></label>`).join('')||'<p class="settings-note">全部目标词已有用词记录。</p>';
      $('editQuestions').innerHTML=(a.questions||[]).map((q,i)=>`<div class="question-editor" data-question="${i}"><small>${esc(q.id)} · ${q.status==='needs-review'?'待复核':'已记录'}</small>${textarea('英文题干',q.prompt,'prompt')}${q.choices.map((c,j)=>input(`选项 ${c.id.toUpperCase()}`,c.text,`choice-${j}`)).join('')}<label>正确答案<select data-field="answer">${q.choices.map(c=>`<option value="${esc(c.id)}" ${q.answer===c.id?'selected':''}>${esc(c.id.toUpperCase())}</option>`).join('')}</select></label>${textarea('解析',q.explanation,'explanation')}${q.evidence.map((e,j)=>`<div data-evidence-row>${input(`证据 ${j+1} 所在段落`,e.paragraph,'evidenceParagraph','number')}${textarea('该段真实原文引文',e.quote,'evidenceQuote')}</div>`).join('')}<button class="text-button" data-remove-question="${i}">移除题目</button></div>`).join('');
    }
    $('sourceWord').addEventListener('change',()=>{$('sourceAllowed').value=editor.payload.words.find(w=>w.word===$('sourceWord').value).allowed;});
    $('sourceApply').addEventListener('click',()=>{const reason=$('sourceReason').value.trim(),after=$('sourceAllowed').value.trim(),w=editor.payload.words.find(w=>w.word===$('sourceWord').value);if(!reason||!after){toast('请填写核实后的义项与来源修正说明。');return;}gatherEditor();editor.payload.sourceCorrections=[...(editor.payload.sourceCorrections||[]),{word:w.word,before:w.allowed,after,reason,at:new Date().toISOString()}];w.allowed=after;renderEditor();draftEditor();$('editorStatus').textContent='来源修正已记入草稿；请继续核查实际用义并保存。';});
    const value=(row,field)=>row.querySelector(`[data-field="${field}"]`).value;
    function gatherEditor(){if(!editor)return;const a=editor.payload.articles[editor.index],p=a.paragraphs[paragraphIndex];
      a.title=$('editTitle').value;a.zhTitle=$('editZhTitle').value;p.en=$('editEn').value;p.zh=$('editZh').value;
      const pairs=[...$('editSentences').querySelectorAll('[data-sentence]')].map(row=>({en:value(row,'en'),zh:value(row,'zh')}));if(pairs.length)p.sentences=pairs;else delete p.sentences;
      a.uses=[...a.uses.filter(u=>u.paragraph!==paragraphIndex+1),...Array.from($('editUses').querySelectorAll('[data-use-row]'),row=>({word:value(row,'word'),form:value(row,'form'),occurrence:Number(value(row,'occurrence')),sense:value(row,'sense'),paragraph:paragraphIndex+1}))];
      $('editOmissions').querySelectorAll('[data-omission]').forEach(el=>{const w=editor.payload.words.find(w=>w.word===el.dataset.omission);w.omission=el.value;});
      for(const w of editor.payload.words)if(editor.payload.articles.some(a=>a.uses.some(u=>u.word.toLowerCase()===w.word.toLowerCase())))delete w.omission;
      a.questions=[...$('editQuestions').querySelectorAll('[data-question]')].map(row=>{const old=a.questions[Number(row.dataset.question)];return {...old,prompt:value(row,'prompt'),choices:old.choices.map((c,j)=>({...c,text:value(row,`choice-${j}`)})),answer:value(row,'answer'),explanation:value(row,'explanation'),evidence:[...row.querySelectorAll('[data-evidence-row]')].map(e=>({paragraph:Number(value(e,'evidenceParagraph')),quote:value(e,'evidenceQuote')}))};});
    }
    function draftEditor(){gatherEditor();const x=extra();x.editorDrafts[editor.key]={payload:C.clone(editor.payload),paragraphIndex,baseHash:C.hash(editor.initial),at:new Date().toISOString()};store(x);$('editorStatus').textContent=S.database()?'草稿已暂存；尚未替换阅读正文。':'草稿仅暂存本次页面，请立即导出。';$('editorPreview').hidden=true;}
    $('editorDialog').addEventListener('input',e=>{if(!editor || !e.target.matches('input,textarea') || ['sourceAllowed','sourceReason'].includes(e.target.id))return;draftEditor();if(e.target.dataset.field==='word'){const w=editor.payload.words.find(w=>w.word.toLowerCase()===e.target.value.toLowerCase());e.target.closest('[data-use-row]').querySelector('.use-allowed').textContent=`词表允许义项：${w?.allowed||'词表中没有这个目标词'}`;}});
    $('editorDialog').addEventListener('change',e=>{if(!editor)return;if(e.target.id==='editParagraph'){gatherEditor();paragraphIndex=Number(e.target.value);renderEditor();draftEditor();}else if(e.target.matches('select') || e.target.dataset.field==='word'){draftEditor();if(e.target.dataset.field==='word'){const w=editor.payload.words.find(w=>w.word.toLowerCase()===e.target.value.toLowerCase());e.target.closest('[data-use-row]').querySelector('.use-allowed').textContent=`词表允许义项：${w?.allowed||'词表中没有这个目标词'}`;}}});
    $('editAddSentence').addEventListener('click',()=>{gatherEditor();const p=editor.payload.articles[editor.index].paragraphs[paragraphIndex];p.sentences=[...(p.sentences||[]),{en:'',zh:''}];renderEditor();draftEditor();});
    $('editAddUse').addEventListener('click',()=>{gatherEditor();const w=editor.payload.words[0];editor.payload.articles[editor.index].uses.push({word:w.word,paragraph:paragraphIndex+1,form:w.word,sense:'',occurrence:1});renderEditor();draftEditor();});
    $('editAddQuestion').addEventListener('click',()=>{gatherEditor();const a=editor.payload.articles[editor.index];a.questions=[...(a.questions||[]),{id:`q-${Date.now()}`,prompt:'',choices:['a','b','c','d'].map(id=>({id,text:''})),answer:'a',explanation:'',evidence:[{paragraph:paragraphIndex+1,quote:''}],status:'needs-review'}];renderEditor();draftEditor();});
    $('editorDialog').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!editor)return;
      if(b.dataset.removeSentence!==undefined){gatherEditor();editor.payload.articles[editor.index].paragraphs[paragraphIndex].sentences.splice(Number(b.dataset.removeSentence),1);if(!editor.payload.articles[editor.index].paragraphs[paragraphIndex].sentences.length)delete editor.payload.articles[editor.index].paragraphs[paragraphIndex].sentences;renderEditor();draftEditor();}
      if(b.dataset.removeUse!==undefined){gatherEditor();const a=editor.payload.articles[editor.index],uses=a.uses.filter(u=>u.paragraph===paragraphIndex+1);uses.splice(Number(b.dataset.removeUse),1);a.uses=[...a.uses.filter(u=>u.paragraph!==paragraphIndex+1),...uses];renderEditor();draftEditor();}
      if(b.dataset.removeQuestion!==undefined){gatherEditor();editor.payload.articles[editor.index].questions.splice(Number(b.dataset.removeQuestion),1);renderEditor();draftEditor();}
    });
    function checkedEditor(){gatherEditor();const payload=T.revise(C.clone(editor.payload),editor.index,editor.before,$('editReviewed').checked),r=P.validate(payload);return {payload,r};}
    $('editPreview').addEventListener('click',()=>{const {payload,r}=checkedEditor(),a=payload.articles[editor.index];$('editorPreview').hidden=false;
      if(!r.ok){$('editorPreview').innerHTML=`<h3>请修正后保存</h3><ul>${r.errors.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`;return;}
      const before=editor.before,changes=[];if(before.title!==a.title||before.zhTitle!==a.zhTitle)changes.push(`<p>标题：${esc(before.title)} → ${esc(a.title)}</p>`);
      a.paragraphs.forEach((p,i)=>{if(JSON.stringify(p)!==JSON.stringify(before.paragraphs[i]))changes.push(`<h4>第 ${i+1} 段</h4><p class="diff-old">原文：${esc(before.paragraphs[i]?.en||'')}</p><p class="diff-new">修订：${esc(p.en)}</p><p>${esc(p.zh)}</p>`);});
      if(JSON.stringify(before.uses)!==JSON.stringify(a.uses))changes.push('<p>用词记录已改动。请逐条确认实际用义属于词表允许义项。</p>');
      $('editorPreview').innerHTML=`<h3>校验通过 · ${a.questions.some(q=>q.status==='needs-review')?'小测待复核':'可保存'}</h3>${changes.join('')||'<p>正文与译文没有变化。</p>'}<details><summary>目标词标注预览</summary><p lang="en" class="preview-english">${r.compiled.articles[editor.index].paragraphs[paragraphIndex]}</p></details><p class="settings-note">检查了词形位置、逐句对照与证据引文。词义准确性和题目合理性仍需人工复核。</p>`;
    });
    $('editSave').addEventListener('click',run(async()=>{const live=root.StudyLibrary.model(editor.key);if(!live||C.hash(live.payload)!==C.hash(editor.initial))throw new Error('编辑期间资料版本已变化；草稿已保留，请重新打开并对照新来源。');const {payload,r}=checkedEditor();if(!r.ok)throw new Error(r.errors[0]);await root.StudyLibrary.saveRevision(editor.sourceId,payload);const x=extra();delete x.editorDrafts[editor.key];store(x);await S.flush();openEditor(paragraphIndex);$('editorStatus').textContent='本机修订已保存。旧收藏、错句和作答快照保持可复习。';}));
    $('editExport').addEventListener('click',run(async()=>{const {payload,r}=checkedEditor();if(!r.ok)throw new Error(r.errors[0]);download(payload,`${payload.id}.json`);$('editorStatus').textContent='已导出完整修订资料。导入到其他浏览器，或上传 GitHub packages 后发布。';}));
    $('editUndo').addEventListener('click',run(async()=>{await root.StudyLibrary.resetRevision(editor.sourceId,true);const x=extra();delete x.editorDrafts[editor.key];store(x);openEditor(paragraphIndex);$('editorStatus').textContent='已撤销上次修订。';}));
    $('editReset').addEventListener('click',run(async()=>{if(!resetArmed){resetArmed=true;$('editReset').textContent='确认恢复来源版本';return;}await root.StudyLibrary.resetRevision(editor.sourceId);const x=extra();delete x.editorDrafts[editor.key];store(x);openEditor(paragraphIndex);$('editorStatus').textContent='已恢复来源版本；可撤销本次恢复。';}));
    $('editDiscard').addEventListener('click',()=>{const x=extra();delete x.editorDrafts[editor.key];store(x);openEditor(paragraphIndex);$('editorStatus').textContent='本篇草稿已丢弃。已保存的修订保留。';});

    let searchRows=[],searchLimit=50;
    function openSearch(query){$('contextQuery').value=query;$('contextBatch').innerHTML='<option value="all">全部资料</option>'+[...new Map(data.articles.map(a=>[a.batch,a.batchTitle])).entries()].map(([id,title])=>`<option value="${esc(id)}">${esc(title)}</option>`).join('');searchLimit=50;renderSearch();open('contextDialog');}
    function renderSearch(){searchRows=T.search(data,S.get('learning',L.empty()),$('contextQuery').value,{batch:$('contextBatch').value,sense:$('contextSense').value.trim(),scope:$('contextScope').value});
      $('contextCount').textContent=$('contextQuery').value.trim()?`${searchRows.length} 条语境 · 当前显示 ${Math.min(searchLimit,searchRows.length)} 条`:'输入词或片段，查找实际使用过的语境。';
      $('contextResults').innerHTML=searchRows.slice(0,searchLimit).map((r,i)=>`<article class="learning-card context-card"><div class="learning-card-heading"><h3>${esc(r.word)}${r.form&&r.form.toLowerCase()!==r.word.toLowerCase()?` · ${esc(r.form)}`:''}</h3><small>${r.kind==='snapshot'?'收藏 / 错句快照':'当前资料'}</small></div><p class="saved-context" lang="en">${esc(r.context)}</p>${r.sense?`<details><summary>查看此处实际用义</summary><p>${esc(r.sense)}</p>${r.allowed?`<small>该批词表允许义项</small><p>${esc(r.allowed)}</p>`:''}</details>`:'<p class="learning-meta">此处用义未记录，不能自动推断为另一处的用义。</p>'}<p class="learning-meta">${esc(r.articleTitle)} · 第 ${r.paragraph+1} 段</p><div class="learning-actions">${r.article?`<button class="text-button" data-context-origin="${i}">回到原句</button><button class="text-button" data-context-queue="${i}">加入阅读队列</button>`:'<span class="learning-meta">原资料已移除或改写，保留历史原句。</span>'}${r.entry?`<button class="text-button" data-context-save="${i}">收藏本次用义</button>`:''}</div></article>`).join('')||($('contextQuery').value.trim()?'<p class="empty-state">没有匹配的记录。可尝试词形或较短片段。</p>':'');$('contextMore').hidden=searchRows.length<=searchLimit;
    }
    ['contextQuery','contextSense'].forEach(id=>$(id).addEventListener('input',()=>{searchLimit=50;renderSearch();}));['contextBatch','contextScope'].forEach(id=>$(id).addEventListener('change',()=>{searchLimit=50;renderSearch();}));$('contextMore').addEventListener('click',()=>{searchLimit+=50;renderSearch();});
    $('contextResults').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.contextOrigin!==undefined){const r=searchRows[Number(b.dataset.contextOrigin)];$('contextDialog').close();navigate(r.articleKey,r.paragraph);}
      if(b.dataset.contextSave!==undefined){const r=searchRows[Number(b.dataset.contextSave)];saveCard(r.entry);}
      if(b.dataset.contextQueue!==undefined){const r=searchRows[Number(b.dataset.contextQueue)],a=data.articles.find(a=>a.key===r.articleKey);try{const x=extra();T.addTask(x,a);store(x);toast('已加入阅读任务队列');}catch(e){toast(e.message);}}
    });

    let quiz=null;
    function draftKey(a,taskId){return JSON.stringify([a.key,a.sourceSignature,a.quizSignature,taskId||'']);}
    function openQuiz(key=current().key){
      const a=data.articles.find(a=>a.key===key);if(!a){toast('原文章已移除，保留作答历史快照。');return;}
      const x=extra(),task=x.queue.find(t=>t.id===x.activeTask&&t.articleKey===a.key&&t.status==='active'&&t.mode==='quiz');
      quiz={article:C.clone(a),taskId:task?.id||null,answers:{},submitted:false};quiz.key=draftKey(a,quiz.taskId);quiz.answers=C.clone(x.quizDrafts[quiz.key]?.answers||{});
      $('quizArticle').textContent=a.title;$('quizStatus').textContent='';$('quizRetry').hidden=true;$('quizSubmit').hidden=!T.canQuiz(a);$('quizWrongLabel').hidden=!T.canQuiz(a);
      if(!a.questions.length)$('quizBody').innerHTML='<p class="empty-state">本篇还没有小测。可在编辑器中添加，或导入带 questions 的资料包；阅读不受影响。</p>';
      else if(!T.canQuiz(a))$('quizBody').innerHTML='<p class="empty-state">正文或用义发生变化，这些题目待复核。请在编辑器中核对答案与证据后启用。</p>';
      else renderQuiz();renderQuizHistory();open('quizDialog');
    }
    function renderQuiz(){const qs=quiz.article.questions;$('quizBody').innerHTML=qs.map((q,i)=>`<fieldset class="quiz-question"><legend lang="en">${i+1}. ${esc(q.prompt)}</legend>${q.choices.map(c=>`<label><input type="radio" name="quiz-${esc(q.id)}" data-question-id="${esc(q.id)}" value="${esc(c.id)}" ${quiz.answers[q.id]===c.id?'checked':''} ${quiz.submitted?'disabled':''}><span lang="en">${esc(c.id.toUpperCase())}. ${esc(c.text)}</span></label>`).join('')}${quiz.submitted?`<div class="quiz-feedback"><strong>${quiz.answers[q.id]===q.answer?'回答正确':'回答有误'} · 正确选项 ${esc(q.answer.toUpperCase())}</strong><p>${esc(q.explanation)}</p>${q.evidence.map(e=>`<small>依据：第 ${e.paragraph} 段</small><blockquote lang="en">${esc(e.quote)}</blockquote>`).join('')}</div>`:''}</fieldset>`).join('');}
    $('quizBody').addEventListener('change',e=>{if(!quiz||quiz.submitted||!e.target.dataset.questionId)return;quiz.answers[e.target.dataset.questionId]=e.target.value;const x=extra();x.quizDrafts[quiz.key]={articleKey:quiz.article.key,sourceSignature:quiz.article.sourceSignature,taskId:quiz.taskId,answers:quiz.answers,at:new Date().toISOString()};store(x);});
    $('quizSubmit').addEventListener('click',run(async()=>{if(!quiz||quiz.submitted)return;const a=data.articles.find(a=>a.key===quiz.article.key);if(!T.canQuiz(a)||(a.sourceSignature!==quiz.article.sourceSignature || a.quizSignature!==quiz.article.quizSignature))throw new Error('资料已变化，请重新打开小测。');const score=T.score(quiz.article.questions,quiz.answers),x=extra(),attempt={id:`quiz-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,articleKey:a.key,articleTitle:a.title,sourceSignature:a.sourceSignature,quizSignature:a.quizSignature,questions:C.clone(quiz.article.questions),answers:C.clone(quiz.answers),score,total:quiz.article.questions.length,at:new Date().toISOString(),taskId:quiz.taskId};
      x.quizAttempts.push(attempt);delete x.quizDrafts[quiz.key];
      if($('quizSaveWrong').checked)for(const q of attempt.questions)if(q.answer!==attempt.answers[q.id]){const id=JSON.stringify([a.key,a.sourceSignature,a.quizSignature,q.id]),old=x.wrongQuestions.find(r=>r.id===id),r={id,articleKey:a.key,articleTitle:a.title,sourceSignature:a.sourceSignature,quizSignature:a.quizSignature,question:C.clone(q),chosen:attempt.answers[q.id],resolved:false,at:attempt.at};if(old)Object.assign(old,r);else x.wrongQuestions.push(r);}
      store(x);await S.flush();quiz.submitted=true;renderQuiz();$('quizSubmit').hidden=true;$('quizWrongLabel').hidden=true;$('quizRetry').hidden=false;$('quizStatus').textContent=`已保存作答：${score} / ${attempt.total} 题正确${quiz.taskId?' · 返回任务后可确认完成':''}`;renderQuizHistory();refreshReview();articleChanged();}));
    $('quizRetry').addEventListener('click',()=>{const key=quiz.article.key;const x=extra();delete x.quizDrafts[quiz.key];store(x);openQuiz(key);});
    $('quizEdit').addEventListener('click',()=>{if(quiz.article.key!==current().key)navigate(quiz.article.key,0);openEditor();});
    function attemptHTML(a){return `<details><summary>${esc(new Date(a.at).toLocaleString())} · ${a.score} / ${a.total} · ${a.sourceSignature===quiz.article.sourceSignature&&a.quizSignature===quiz.article.quizSignature?'当前正文与题目':'历史题目快照'}</summary>${a.questions.map(q=>`<p lang="en">${esc(q.prompt)}</p><p>我的答案：${esc(a.answers[q.id]?.toUpperCase()||'未答')} · 正确答案：${esc(q.answer.toUpperCase())}</p><p>${esc(q.explanation)}</p>${q.evidence.map(e=>`<blockquote lang="en">${esc(e.quote)}</blockquote>`).join('')}`).join('')}</details>`;}
    function renderQuizHistory(){$('quizHistory').innerHTML=extra().quizAttempts.filter(a=>a.articleKey===quiz.article.key).reverse().map(attemptHTML).join('')||'<p class="settings-note">尚未提交过本篇小测。</p>';}
    function wrongCount(){return extra().wrongQuestions.length;}
    function renderWrongQuestions(){return extra().wrongQuestions.slice().reverse().map(r=>{const a=data.articles.find(a=>a.key===r.articleKey),currentVersion=a&&a.sourceSignature===r.sourceSignature&&a.quizSignature===r.quizSignature;return `<article class="learning-card"><div class="learning-card-heading"><h3 lang="en">${esc(r.question.prompt)}</h3><button class="text-button" data-remove-question-record="${esc(r.id)}">移除</button></div><p class="learning-meta">${esc(r.articleTitle)} · ${r.resolved?'已理解':'待复习'}${currentVersion?'':' · 历史题目快照'}</p><details><summary>核对答案、解析与原文依据</summary><p>我的答案：${esc(r.chosen?.toUpperCase()||'')} · 正确答案：${esc(r.question.answer.toUpperCase())}</p>${r.question.choices.map(c=>`<p lang="en">${esc(c.id.toUpperCase())}. ${esc(c.text)}</p>`).join('')}<p>${esc(r.question.explanation)}</p>${r.question.evidence.map(e=>`<small>第 ${e.paragraph} 段</small><blockquote lang="en">${esc(e.quote)}</blockquote>`).join('')}</details><div class="learning-actions"><button class="text-button" data-resolve-question="${esc(r.id)}">${r.resolved?'仍需复习':'标记已理解'}</button><button class="text-button" data-repeat-question="${esc(r.id)}">重做此题</button>${currentVersion?`<button class="text-button" data-question-origin="${esc(r.id)}">回到证据原文</button>`:''}</div><div class="wrong-retry" hidden></div></article>`;}).join('')||'<p class="empty-state">还没有阅读错题。小测可选，不影响正常阅读。</p>';}
    $('reviewList').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.resolveQuestion||b.dataset.removeQuestionRecord||b.dataset.repeatQuestion||b.dataset.questionOrigin;if(!id)return;const x=extra(),r=x.wrongQuestions.find(r=>r.id===id);if(!r)return;
      if(b.dataset.resolveQuestion){r.resolved=!r.resolved;store(x);refreshReview();}
      if(b.dataset.removeQuestionRecord){x.removedQuestions=[...(x.removedQuestions||[]),r].slice(-10);x.wrongQuestions=x.wrongQuestions.filter(q=>q.id!==id);store(x);refreshReview();toast('已移除错题，可在复习页撤销。');}
      if(b.dataset.questionOrigin)navigate(r.articleKey,r.question.evidence[0].paragraph-1);
      if(b.dataset.repeatQuestion){const box=b.closest('article').querySelector('.wrong-retry');box.hidden=false;box.innerHTML=`<p class="settings-note">按保存时的题目与原文证据重做。</p>${r.question.choices.map(c=>`<label class="switch-row"><span lang="en">${esc(c.text)}</span><input type="radio" name="retry-${esc(r.question.id)}" value="${esc(c.id)}"></label>`).join('')}<button class="secondary-button" data-check-retry="${esc(r.id)}">核对重做答案</button><p role="status"></p>`;}
    });
    $('reviewList').addEventListener('click',e=>{const b=e.target.closest('[data-check-retry]');if(!b)return;const r=extra().wrongQuestions.find(r=>r.id===b.dataset.checkRetry),box=b.closest('.wrong-retry'),chosen=box.querySelector('input:checked');box.querySelector('[role=status]').textContent=!chosen?'请先选择答案。':chosen.value===r.question.answer?'回答正确，可标记已理解。':`回答有误，正确答案 ${r.question.answer.toUpperCase()}。${r.question.explanation}`;});

    function renderQueue(){const x=extra(),tasks=x.queue.filter(t=>$('queueDay').value!=='today'||t.createdDay===T.day());$('queueCurrent').textContent=`本篇：${current().title}`;$('queueUndo').hidden=!x.removedTasks.length;$('queueMode').querySelector('[value=quiz]').disabled=!T.canQuiz(current());if(!T.canQuiz(current())&&$('queueMode').value==='quiz')$('queueMode').value='reading';const status={pending:'待阅读',active:'进行中',done:'已完成',skipped:'已跳过'};
      $('queueStatus').textContent=`${x.queue.filter(t=>t.status==='pending').length} 个待办 · ${x.queue.filter(t=>t.status==='active').length} 个进行中 · ${x.queue.filter(t=>t.status==='done').length} 个已完成`;
      $('queueList').innerHTML=tasks.map(t=>{const a=data.articles.find(a=>a.key===t.articleKey),stale=t.mode==='quiz'&&(!T.canQuiz(a)||a.sourceSignature!==t.sourceSignature);return `<article class="learning-card queue-row"><div><h3 lang="en">${esc(t.title)}</h3><p class="learning-meta">${esc(status[t.status])} · ${t.mode==='quiz'?'阅读 + 小测':'仅阅读'} · ${esc(t.createdDay)}${t.completedDay?` · 完成于 ${esc(t.completedDay)}`:''}</p>${!a?'<p class="learning-meta">原文章已移除，可替换任务文章或保留历史。</p>':stale?'<p class="learning-meta">正文或题目版本已改变；完成时须通过当前小测。</p>':''}</div><div class="learning-actions">${a&&['pending','active'].includes(t.status)?`<button class="text-button" data-task-start="${esc(t.id)}">${t.status==='active'?'继续阅读':'开始阅读'}</button>`:''}${a&&['done','skipped'].includes(t.status)?`<button class="text-button" data-task-reread="${esc(t.id)}">再次阅读</button>`:''}${['pending','active'].includes(t.status)?`<button class="text-button" data-task-up="${esc(t.id)}" aria-label="上移任务">上移</button><button class="text-button" data-task-down="${esc(t.id)}" aria-label="下移任务">下移</button><button class="text-button" data-task-skip="${esc(t.id)}">跳过</button>${t.mode==='quiz'?`<button class="text-button" data-task-reading="${esc(t.id)}">改为仅阅读</button>`:''}${!a?`<button class="text-button" data-task-replace="${esc(t.id)}">替换为当前文章</button>`:''}`:''}<button class="text-button" data-task-remove="${esc(t.id)}">移除</button></div></article>`;}).join('')||'<p class="empty-state">还没有任务。加入文章，安排自己的下一轮阅读。</p>';}
    function startTask(id){const x=extra(),t=x.queue.find(t=>t.id===id),a=t&&data.articles.find(a=>a.key===t.articleKey);if(!a)throw new Error('文章已移除，请先替换任务。');for(const item of x.queue)if(item.status==='active')item.status='pending';t.status='active';t.startedAt=new Date().toISOString();x.activeTask=t.id;store(x);$('queueDialog').close();navigate(t.articleKey);articleChanged();}
    $('queueAdd').addEventListener('click',run(async()=>{const x=extra();T.addTask(x,current(),$('queueMode').value);store(x);renderQueue();}));
    $('queueNext').addEventListener('click',run(async()=>{const t=extra().queue.find(t=>t.status==='pending');if(!t)throw new Error('没有待办任务。');startTask(t.id);}));
    $('queueDay').addEventListener('change',renderQueue);
    $('queueUndo').addEventListener('click',()=>{const x=extra(),t=x.removedTasks.pop();if(t&&!x.queue.some(v=>v.id===t.id)){if(t.status==='active'){t.status='pending';}x.queue.push(t);}store(x);renderQueue();articleChanged();});
    $('queueList').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const field=Object.keys(b.dataset).find(k=>k.startsWith('task'));if(!field)return;const id=b.dataset[field],x=extra(),t=x.queue.find(t=>t.id===id);if(!t)return;try{
      if(field==='taskStart'){startTask(id);return;}if(field==='taskReread'){T.addTask(x,data.articles.find(a=>a.key===t.articleKey),t.mode);}
      if(field==='taskUp'||field==='taskDown'){const i=x.queue.indexOf(t),j=i+(field==='taskUp'?-1:1);if(j>=0&&j<x.queue.length)[x.queue[i],x.queue[j]]=[x.queue[j],x.queue[i]];}
      if(field==='taskSkip'){t.status='skipped';if(x.activeTask===id)x.activeTask=null;}
      if(field==='taskReading')t.mode='reading';
      if(field==='taskReplace'){t.articleKey=current().key;t.title=current().title;t.sourceSignature=current().sourceSignature;if(!T.canQuiz(current()))t.mode='reading';}
      if(field==='taskRemove'){x.removedTasks=[...x.removedTasks,t].slice(-10);x.queue=x.queue.filter(r=>r.id!==id);if(x.activeTask===id)x.activeTask=null;}
      store(x);renderQueue();articleChanged();
    }catch(err){toast(err.message);}});
    function articleChanged(){const x=extra(),active=x.queue.find(t=>t.id===x.activeTask&&t.status==='active'),recent=x.queue.find(t=>t.id===x.lastTask),t=(active?.articleKey===current().key?active:null)||(!active&&recent?.articleKey===current().key&&x.queue.some(v=>v.status==='pending')?recent:null);
      $('activeTask').hidden=!t;if(!t)return;const doing=t.status==='active';$('activeTask').innerHTML=`<small class="field-label">本轮阅读任务 · ${doing?(t.mode==='quiz'?'阅读 + 小测':'仅阅读'):(t.status==='done'?'已完成':'已跳过')}</small><div class="learning-actions">${doing?`${t.mode==='quiz'?'<button class="secondary-button" data-active-quiz>进行本轮小测</button>':''}<button class="primary-button" data-active-complete>确认本轮完成</button><button class="text-button" data-active-skip>跳过本轮</button>`:'<button class="secondary-button" data-active-next>下一待办</button>'}</div>`;}
    $('activeTask').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const x=extra(),t=x.queue.find(t=>t.id===x.activeTask)||x.queue.find(t=>t.id===x.lastTask);if(!t)return;try{
      if(b.hasAttribute('data-active-quiz')){openQuiz();return;}
      if(b.hasAttribute('data-active-complete')){T.completeTask(x,t,current());x.lastTask=t.id;store(x);markRead();toast('本轮任务已完成。');}
      if(b.hasAttribute('data-active-skip')){t.status='skipped';x.activeTask=null;x.lastTask=t.id;store(x);}
      if(b.hasAttribute('data-active-next')){const next=x.queue.find(t=>t.status==='pending');if(next)startTask(next.id);return;}
      articleChanged();
    }catch(err){toast(err.message);}});
    function undoQuestion(){const x=extra(),r=(x.removedQuestions||[]).pop();if(r&&!x.wrongQuestions.some(q=>q.id===r.id))x.wrongQuestions.push(r);store(x);refreshReview();}
    return {snapshot,articleChanged,changed(){articleChanged();if($('contextDialog').open)renderSearch();if($('queueDialog').open)renderQueue();},renderWrongQuestions,wrongCount,undoQuestion,removedQuestionCount:()=>extra().removedQuestions?.length||0};
  }
  root.StudyWorkspace={create,download};
})(window);
