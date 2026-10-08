(function (root) {
  'use strict';
  const C = root.StudyLearningCore, $ = id=>document.getElementById(id);
  const esc = s=>root.StudyPack.escape(s ?? '');
  const labels = {known:'认识',uncertain:'模糊','wrong-sense':'误用了另一个义项'};
  const KEY = 'english-study.learning.v1';
  function create({data,current,legacy,toast,changed,navigate,openSentence,questionCount,renderQuestions,undoQuestion,removedQuestionCount}) {
    const raw=root.StudyState.get('learning',null);
    let state=C.load(raw);
    let selected=null,reviewView='words',hiddenAnswers=false,quizRevealed=false,sentenceList=[],sentenceIndex=0,referenceVisible=false;
    function persist() {
      try {return root.StudyState.set('learning',state);}
      catch {toast('浏览器未能保存学习记录，本次修改仅暂存在页面中');return false;}
    }
    if(C.migrate(state,legacy,data))persist();
    const entry=(word,use)=>C.usage(data,word,use);
    const saved=e=>!!e && state.cards.some(c=>c.id===e.id);
    function stash(kind,record) {state.trash=[...state.trash,{kind,record}].slice(-10);}
    function refresh() {renderReview();changed();}
    function toggle(e) {
      if(!e){toast('该词没有正文用义，暂不能建立语境卡');return;}
      const exists=saved(e);
      if(exists)stash('word',state.cards.find(c=>c.id===e.id));
      state.cards=exists ? state.cards.filter(c=>c.id!==e.id) : [...state.cards,{...e,created:Date.now()}];
      persist();refresh();root.StudyState.flush().then(()=>toast(exists?'已移除这张义项卡':'已收藏本次用义和原句')).catch(e=>toast(e.message));
    }
    function prepare(word,use) {
      selected=entry(word,use);quizRevealed=!state.guessMode || !selected;
      $('wordGuess').value='';$('wordQuizStatus').textContent='';
      $('wordQuiz').hidden=!state.guessMode || !selected;
      $('wordAnswer').hidden=!quizRevealed;
      $('rateWord').hidden=!quizRevealed || !selected;
      $('revealWord').hidden=quizRevealed;
      $('saveWord').disabled=!selected;
      $('wordPopover').querySelector('.quiz-note').hidden=!selected;
      $('wordQuiz').querySelector('label').textContent='这个词在此句是什么意思？';
      $('wordGuess').placeholder='先写下你的判断（也可以心里作答）';
      $('rateWord').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed','false'));
    }
    $('guessMode').checked=state.guessMode;
    $('guessMode').addEventListener('change',()=>{state.guessMode=$('guessMode').checked;persist();});
    $('revealWord').addEventListener('click',()=>{
      quizRevealed=true;$('wordAnswer').hidden=false;$('rateWord').hidden=false;$('revealWord').hidden=true;
      $('rateWord').querySelector('button').focus();
    });
    $('rateWord').addEventListener('click',async e=>{
      const b=e.target.closest('[data-rating]');if(!b || !quizRevealed || !selected)return;
      C.rate(state,selected,b.dataset.rating,$('wordGuess').value);
      const id=selected.id;persist();refresh();
      $('rateWord').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));
      $('wordQuizStatus').textContent='正在保存本次判断…';try{await root.StudyState.flush();if(selected?.id===id)$('wordQuizStatus').textContent=`已记录：${labels[b.dataset.rating]}${b.dataset.rating==='known'?'':' · 已加入义项卡'}`;}catch(e){$('wordQuizStatus').textContent='未保存：'+e.message;}
    });
    function wordCard(card) {
      const where=C.locate(data,card),attempt=state.attempts[card.id];
      return `<article class="learning-card"><div class="learning-card-heading"><h3 lang="en">${esc(card.word)}</h3><button class="text-button" data-remove-card="${esc(card.id)}" aria-label="移除 ${esc(card.word)} 的 ${esc(card.sense)} 义项卡">移除</button></div><p class="card-answer" ${hiddenAnswers?'hidden':''}>${esc(card.sense)}</p><p class="saved-context" lang="en">${esc(card.context)}</p>${hiddenAnswers?`<button class="text-button" data-reveal-card>查看本次用义</button>`:''}<p class="learning-meta">${esc(card.articleTitle)} · 第 ${card.paragraph+1} 段${card.legacy?' · 旧收藏迁移':''}</p>${attempt?`<p class="learning-meta">最近自测：${esc(labels[attempt.rating]||'')}${attempt.guess?` · 我的判断：${esc(attempt.guess)}`:''}</p>`:''}<details><summary>词表允许义项</summary><p>${esc(card.allowed)}</p></details>${where?`<button class="text-button" data-card-origin="${esc(card.id)}">回到原句</button>`:'<p class="learning-meta">原资料已移除或改写，保留收藏时的原句。</p>'}</article>`;
    }
    function noteCard(note) {
      const where=C.locate(data,note);
      return `<article class="learning-card"><div class="learning-card-heading"><span class="learning-meta">${esc(note.articleTitle)} · 第 ${note.paragraph+1} 段</span><button class="text-button" data-remove-note="${esc(note.id)}" aria-label="移除这条错句">移除</button></div><p class="saved-context" lang="en">${esc(note.en)}</p><p class="error-tags">${note.categories.map(esc).join(' · ')}${note.resolved?' · 已理解':''}</p><details><summary>核对我的理解与参考</summary><p class="field-label">我的理解</p><p>${esc(note.own)}</p><p class="field-label">${note.referenceKind==='sentence'?'本句参考译文':'本段参考译文（非逐句答案）'}</p><p>${esc(note.reference)}</p>${note.reason?`<p class="field-label">易错原因</p><p>${esc(note.reason)}</p>`:''}</details><div class="learning-actions"><button class="text-button" data-resolve-note="${esc(note.id)}">${note.resolved?'仍需复习':'标记已理解'}</button>${where?`<button class="text-button" data-edit-note="${esc(note.id)}">再做一次 / 修改记录</button>`:'<span class="learning-meta">原资料已移除或改写，保留错句快照。</span>'}</div></article>`;
    }
    function renderReview() {
      $('reviewWords').setAttribute('aria-pressed',String(reviewView==='words'));
      $('reviewSentences').setAttribute('aria-pressed',String(reviewView==='sentences'));
      $('reviewQuestions').setAttribute('aria-pressed',String(reviewView==='questions'));
      $('hideReviewMeanings').hidden=reviewView!=='words';
      $('undoLearningRemove').hidden=reviewView==='questions'?!removedQuestionCount():!state.trash.length;
      $('reviewSummary').textContent=reviewView==='questions'?`${questionCount()} 道阅读错题`:reviewView==='words'?`${state.cards.length} 张义项卡`:`${state.notes.length} 条错句 · ${state.notes.filter(n=>!n.resolved).length} 条待复习`;
      $('reviewCount').textContent=state.cards.length+state.notes.length+questionCount() || '';
      $('reviewList').innerHTML=reviewView==='questions'?renderQuestions():reviewView==='words'
        ? [...state.cards].reverse().map(wordCard).join('') || '<p class="empty-state">还没有义项卡。点击正文目标词，收藏本次用义和原句。</p>'
        : [...state.notes].reverse().map(noteCard).join('') || '<p class="empty-state">还没有错句。到“逐句练习”写下理解、核对参考，再保存需要复习的句子。</p>';
    }
    $('reviewQuestions').addEventListener('click',()=>{reviewView='questions';renderReview();});
    $('reviewWords').addEventListener('click',()=>{reviewView='words';renderReview();});
    $('reviewSentences').addEventListener('click',()=>{reviewView='sentences';renderReview();});
    $('undoLearningRemove').addEventListener('click',()=>{
      if(reviewView==='questions'){undoQuestion();return;}
      const item=state.trash.pop();if(!item)return;
      const list=item.kind==='word'?state.cards:state.notes;
      if(!list.some(r=>r.id===item.record.id))list.push(item.record);
      persist();refresh();toast('已恢复上次移除的记录');
    });
    $('hideReviewMeanings').addEventListener('click',()=>{
      hiddenAnswers=!hiddenAnswers;$('hideReviewMeanings').textContent=hiddenAnswers?'显示用义':'隐藏用义，自测一下';
      $('hideReviewMeanings').setAttribute('aria-pressed',String(hiddenAnswers));renderReview();
    });
    $('reviewList').addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-reveal-card')){b.closest('article').querySelector('.card-answer').hidden=false;b.hidden=true;return;}
      if(b.dataset.removeCard){stash('word',state.cards.find(c=>c.id===b.dataset.removeCard));state.cards=state.cards.filter(c=>c.id!==b.dataset.removeCard);persist();refresh();}
      if(b.dataset.cardOrigin){const card=state.cards.find(c=>c.id===b.dataset.cardOrigin),where=card&&C.locate(data,card);if(where)navigate(where.article,where.paragraph);}
      if(b.dataset.removeNote){stash('sentence',state.notes.find(n=>n.id===b.dataset.removeNote));state.notes=state.notes.filter(n=>n.id!==b.dataset.removeNote);persist();renderReview();}
      if(b.dataset.resolveNote){const n=state.notes.find(n=>n.id===b.dataset.resolveNote);if(n){n.resolved=!n.resolved;persist();renderReview();}}
      if(b.dataset.editNote){const n=state.notes.find(n=>n.id===b.dataset.editNote);if(n&&C.locate(data,n))openSentence(n);}
    });
    function renderSentence() {
      const s=sentenceList[sentenceIndex];if(!s)return;
      const draft=state.drafts[s.id] || state.notes.find(n=>n.id===s.id) || {};
      $('sentenceNumber').textContent=`第 ${sentenceIndex+1} / ${sentenceList.length} 句 · 第 ${s.paragraph+1} 段`;
      $('sentenceEnglish').textContent=s.en;
      $('sentenceOwn').value=typeof draft.own==='string'?draft.own:'';
      $('sentenceReason').value=typeof draft.reason==='string'?draft.reason:'';
      $('sentenceErrors').querySelectorAll('input').forEach(el=>el.checked=Array.isArray(draft.categories)&&draft.categories.includes(el.value));
      $('sentenceReferenceLabel').textContent=s.referenceKind==='sentence'?'本句参考译文':'本段参考译文（资料未提供逐句译文）';
      $('sentenceReference').textContent=s.reference;$('sentenceAnalysis').innerHTML=root.StudyExperienceAPI?.analysisHTML(s.analysis)||'';
      $('sentenceReferenceBox').hidden=true;referenceVisible=false;
      $('revealSentence').textContent='查看参考译文';$('revealSentence').setAttribute('aria-expanded','false');
      $('sentencePrev').disabled=sentenceIndex===0;$('sentenceNext').disabled=sentenceIndex===sentenceList.length-1;
      $('sentenceSelect').value=String(sentenceIndex);
      $('saveSentence').textContent=state.notes.some(n=>n.id===s.id)?'更新错句记录':'保存到错句本';
      $('sentenceStatus').textContent=draft.own?'已恢复上次记录':'先写下自己的理解，再查看参考。';
    }
    function articleChanged(targetId) {
      sentenceList=C.articleSentences(current());
      const target=targetId?sentenceList.findIndex(s=>s.id===targetId):-1;
      sentenceIndex=target>=0?target:Math.min(Math.max(0,Number(state.cursor[current().key])||0),sentenceList.length-1);
      $('sentenceSelect').innerHTML=sentenceList.map((s,i)=>`<option value="${i}">第 ${i+1} 句 · 第 ${s.paragraph+1} 段</option>`).join('');
      renderSentence();
    }
    function saveDraft() {
      const s=sentenceList[sentenceIndex];if(!s)return;
      state.drafts[s.id]={own:$('sentenceOwn').value,reason:$('sentenceReason').value,categories:[...$('sentenceErrors').querySelectorAll('input:checked')].map(x=>x.value)};
      persist();const id=s.id,own=state.drafts[id].own;$('sentenceStatus').textContent='正在保存理解草稿…';root.StudyState.flush().then(()=>{if(sentenceList[sentenceIndex]?.id===id&&state.drafts[id]?.own===own)$('sentenceStatus').textContent='理解草稿已保存到当前浏览器';}).catch(e=>$('sentenceStatus').textContent='草稿未保存：'+e.message);
    }
    $('sentenceOwn').addEventListener('input',saveDraft);
    $('sentenceReason').addEventListener('input',saveDraft);
    $('sentenceErrors').addEventListener('change',saveDraft);
    function move(index) {
      sentenceIndex=Math.min(Math.max(0,index),sentenceList.length-1);
      state.cursor[current().key]=sentenceIndex;persist();renderSentence();$('sentenceEnglish').focus();
    }
    $('sentencePrev').addEventListener('click',()=>move(sentenceIndex-1));
    $('sentenceNext').addEventListener('click',()=>move(sentenceIndex+1));
    $('sentenceSelect').addEventListener('change',()=>move(Number($('sentenceSelect').value)));
    $('revealSentence').addEventListener('click',()=>{
      referenceVisible=!referenceVisible;$('sentenceReferenceBox').hidden=!referenceVisible;
      $('revealSentence').textContent=referenceVisible?'收起参考译文':'查看参考译文';
      $('revealSentence').setAttribute('aria-expanded',String(referenceVisible));
    });
    $('saveSentence').addEventListener('click',async()=>{
      const s=sentenceList[sentenceIndex],draft=state.drafts[s?.id] || {};
      if(!String(draft.own||'').trim()){$('sentenceStatus').textContent='请先写下自己的理解。';$('sentenceOwn').focus();return;}
      if(!referenceVisible){$('sentenceStatus').textContent='请先查看参考译文，再判断哪里理解有误。';$('revealSentence').focus();return;}
      if(!C.saveNote(state,s,draft.own,draft.categories||[],draft.reason)){$('sentenceStatus').textContent='请选择至少一种易错原因。';$('sentenceErrors').querySelector('input').focus();return;}
      persist();renderReview();$('saveSentence').textContent='更新错句记录';$('sentenceStatus').textContent='正在保存错句…';try{await root.StudyState.flush();if(sentenceList[sentenceIndex]?.id===s.id)$('sentenceStatus').textContent='已保存到复习页的错句本';}catch(e){$('sentenceStatus').textContent='未保存：'+e.message;}
    });
    function libraryChanged() {if(C.migrate(state,legacy,data))persist();articleChanged();renderReview();}
    return {entry,saved,toggle,prepare,renderReview,articleChanged,libraryChanged,
      reloadState:()=>{legacy=root.StudyState.get('reader',{}).review||[];state=C.load(root.StudyState.get('learning',null));selected=null;$('guessMode').checked=state.guessMode;renderReview();articleChanged();},setReviewView:v=>{reviewView=['words','sentences','questions'].includes(v)?v:'words';renderReview();},selected:()=>selected,count:()=>state.cards.length+state.notes.length+questionCount()};
  }
  root.StudyLearning={create};
})(window);
