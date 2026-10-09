/* Static reader: native selectable text; no remote dictionary or account required. */
(async () => {
  'use strict';
  await window.StudyState.open();
  const data = await window.StudyLibrary.open(window.READING_DATA);
  const $ = id => document.getElementById(id);
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons = {
    book:'<path d="M12 7c-2-2-6-3-10-2v14c4-1 8 0 10 2 2-2 6-3 10-2V5c-4-1-8 0-10 2Z"/><path d="M12 7v14"/>',
    focus:'<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3M9 12h6m-3-3v6"/>',
    moon:'<path d="M20.8 13.4A9 9 0 0 1 10.6 3.2 9 9 0 1 0 20.8 13.4Z"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    settings:'<path d="m9.5 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L3 14.5l2 3 2-.5 2 1 .5 2h5l.5-2 2-1 2 .5 2-3-1.5-1.5v-3L21 8.5l-2-3-2 .5-2-1-.5-2Z"/><circle cx="12" cy="11.5" r="3"/>',
    search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
    left:'<path d="m14 6-6 6 6 6"/>', right:'<path d="m10 6 6 6-6 6"/>',
    x:'<path d="m6 6 12 12M6 18 18 6"/>', plus:'<path d="M12 5v14M5 12h14"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    star:'<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;
  const paintIcons = (root = document) => {
    root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
    root.querySelectorAll('[data-icon-before]').forEach(el => { if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.iconBefore)); });
    root.querySelectorAll('[data-icon-after]').forEach(el => { if (!el.querySelector('svg')) el.insertAdjacentHTML('beforeend', icon(el.dataset.iconAfter)); });
  };
  const KEY = 'english-study.reader.v1';
  const defaults = {theme:'system',fontSize:21,lineHeight:1.95,fontFamily:'serif',highlight:true,focus:false};
  const validId = n => Number.isInteger(n) && n >= 1 && n <= data.articles.length;
  const idForKey = key => data.articles.find(a=>a.key===key)?.id;
  const articleHash = a => a.batch==='original' ? `#article-${String(a.id).padStart(2,'0')}` : `#read=${encodeURIComponent(a.key)}`;
  let raw = {};
  raw = StudyState.get('reader',{});
  const normalizeSettings = saved => ({
      ...saved,
      theme:['system','light','sepia','dark'].includes(saved.theme) ? saved.theme : defaults.theme,
      fontSize:Number.isFinite(saved.fontSize) ? Math.max(16,Math.min(28,saved.fontSize)) : defaults.fontSize,
      lineHeight:Number.isFinite(saved.lineHeight) ? Math.max(1.5,Math.min(2.5,saved.lineHeight)) : defaults.lineHeight,
      fontFamily:saved.fontFamily === 'sans' ? 'sans' : 'serif', highlight:saved.highlight !== false, focus:saved.focus === true
    });
  const saved = raw.settings || {};
  const state = {
    ...raw,
    settings: normalizeSettings(saved),
    current:typeof raw.currentKey==='string' ? (idForKey(raw.currentKey) || 1) : (validId(raw.current) ? raw.current : 1),
    read:Array.isArray(raw.readKeys) ? raw.readKeys.map(idForKey).filter(Boolean) : Array.isArray(raw.read) ? raw.read.filter(validId) : [],
    review:Array.isArray(raw.review) ? [...new Set(raw.review.filter(w => typeof w === 'string'))] : [],
    positions:raw.positionKeys && typeof raw.positionKeys === 'object' ? Object.fromEntries(Object.entries(raw.positionKeys).map(([k,v])=>[idForKey(k),v]).filter(([id])=>id)) : raw.positions && typeof raw.positions === 'object' ? raw.positions : {}
  };
  // Stable keys are the saved records; numeric IDs are only the currently available view.
  state.currentKey = typeof raw.currentKey === 'string' ? raw.currentKey : data.articles[state.current-1].key;
  state.resumeKey = typeof raw.resumeKey === 'string' ? raw.resumeKey : state.currentKey;
  state.readKeys = Array.isArray(raw.readKeys) ? [...new Set(raw.readKeys)] : state.read.map(id=>data.articles[id-1].key);
  state.positionKeys = raw.positionKeys && typeof raw.positionKeys === 'object' ? {...raw.positionKeys} : Object.fromEntries(Object.entries(state.positions).filter(([id])=>validId(Number(id))).map(([id,v])=>[data.articles[Number(id)-1].key,v]));
  state.anchorKeys = raw.anchorKeys && typeof raw.anchorKeys === 'object' ? {...raw.anchorKeys} : {};
  function projectRecords() {
    state.current = idForKey(state.currentKey) || 1;
    state.read = state.readKeys.map(idForKey).filter(Boolean);
    state.positions = Object.fromEntries(Object.entries(state.positionKeys).map(([key,v])=>[idForKey(key),v]).filter(([id])=>id));
  }
  projectRecords();
  let activeTab = 'reading', selectedWord = null, wordTrigger = null, scrollTimer, toastTimer, storageWarned = false, restoring = true;
  let learning, workspace, experience, renderedKey, renderedVersion, lastCheckpoint=Date.now(), resizeTimer;
  const Position=window.StudyPositionCore;
  const current = () => data.articles[state.current - 1];
  const toast = text => { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2500); };
  const persist = () => {
    try { if(StudyState.set('reader',state)===false)throw Error('阅读记录仅在本页暂存，尚未持久保存，请重试。');storageWarned=false;updateContinue();return true; } catch(e) { if (!storageWarned) { storageWarned = true; toast(e.message||'保存失败，本次修改尚未保存，请重试。'); } return false; }
  };
  const paragraphTexts=()=>current().plain||current().paragraphs.map(p=>{const el=document.createElement('div');el.innerHTML=p;return el.textContent;});
  function textRange(paragraph,offset){
    const p=$(`paragraph-${paragraph}`)?.querySelector('p');if(!p||!document.createTreeWalker||!document.createRange)return null;
    const walk=document.createTreeWalker(p,4);let n,remaining=offset,last;
    while((n=walk.nextNode())){last=n;if(remaining<n.textContent.length){const range=document.createRange();range.setStart(n,remaining);range.setEnd(n,remaining+1);return range;}remaining-=n.textContent.length;}
    if(last){const range=document.createRange();range.setStart(last,Math.max(0,last.textContent.length-1));range.setEnd(last,last.textContent.length);return range;}return null;
  }
  function captureAnchor(){
    if(!Position)return null;
    const paragraphs=paragraphTexts(),top=Math.max(70,(document.querySelector('.topbar')?.getBoundingClientRect?.().bottom||50)+12);
    let paragraph=paragraphs.findIndex((_p,i)=>$(`paragraph-${i}`)?.querySelector('p')?.getBoundingClientRect?.().bottom>top);
    if(paragraph<0)paragraph=paragraphs.length-1;
    if(paragraph<0)return null;
    let low=0,high=Math.max(0,paragraphs[paragraph].length-1),range=textRange(paragraph,0);if(!range)return null;
    // Range geometry tracks actual rendered characters, including highlighted inline spans.
    while(low<high){const mid=Math.floor((low+high)/2),rect=textRange(paragraph,mid)?.getBoundingClientRect();if(!rect)return null;if(rect.top<top)low=mid+1;else high=mid;}
    range=textRange(paragraph,low);const rect=range?.getBoundingClientRect();if(!rect)return null;
    return Position.capture({articleKey:state.currentKey,paragraphs,paragraph,offset:low,scrollY:window.scrollY,viewportOffset:rect.top});
  }
  function updateContinue(){
    const button=$('continueReading');if(!button)return;
    const id=idForKey(state.resumeKey);button.hidden=!state.resumeKey;
    button.textContent=id?`继续上次阅读 · ${data.articles[id-1].zhTitle||data.articles[id-1].title}`:'继续上次阅读 · 资料待加载';
    button.setAttribute('aria-label',button.textContent);
  }
  const flushReader=()=>{if(persist())StudyState.flush().catch(e=>toast(e.message||'保存失败，请重试。'));};
  const recordPosition = () => {
    // A temporary fallback must never acquire the missing article's saved position.
    if (!restoring && activeTab === 'reading' && state.currentKey === current().key) {
      state.positions[state.current] = state.positionKeys[state.currentKey] = Math.max(0,window.scrollY);
      const anchor=captureAnchor();if(anchor)state.anchorKeys[state.currentKey]=anchor;
      state.resumeKey = state.currentKey;
      lastCheckpoint=Date.now();return true;
    }
    return false;
  };
  function applySettings() {
    const s = state.settings;
    const theme = s.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--font-size', `${s.fontSize}px`);
    document.documentElement.style.setProperty('--line-height', s.lineHeight);
    document.documentElement.style.setProperty('--reading-font', s.fontFamily === 'sans' ? 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' : 'Georgia,"Times New Roman",serif');
    document.body.classList.toggle('no-highlight', !s.highlight);
    document.body.classList.toggle('focus-mode', s.focus);
    $('focusButton').setAttribute('aria-pressed', String(s.focus));
    $('focusButton').setAttribute('aria-label', s.focus ? '退出专注阅读' : '进入专注阅读');
    $('themeButton').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    $('themeButton').setAttribute('aria-label', theme === 'dark' ? '切换浅色模式' : '切换深色模式');
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    $('fontSize').value = s.fontSize; $('fontSizeValue').textContent = `${s.fontSize} px`;
    $('lineHeight').value = s.lineHeight; $('lineHeightValue').textContent = s.lineHeight.toFixed(2);
    $('fontFamily').value = s.fontFamily; $('highlightWords').checked = s.highlight;
    document.querySelectorAll('input[name=theme]').forEach(el => el.checked = el.value === s.theme);
  }
  function renderDirectory() {
    const query = $('articleSearch').value.trim().toLowerCase();
    const batch = $('batchFilter').value;
    const readFilter=$('readFilter').value,topic=$('topicFilter').value,date=$('dateFilter').value;
    const articles = data.articles.filter(a => (batch==='all'||a.batch===batch) && (readFilter==='all'||state.read.includes(a.id)===(readFilter==='read')) && (topic==='all'||a.topics?.includes(topic)) && (!date||a.date===date) && `${a.id} ${a.title} ${a.zhTitle} ${a.batchTitle}`.toLowerCase().includes(query));
    let lastBatch = null;
    $('articleList').innerHTML = articles.map(a => { const heading = batch==='all'&&lastBatch!==a.batch?`<p class="batch-heading">${escape(a.batchTitle)}</p>`:''; lastBatch=a.batch; return `${heading}<a href="${articleHash(a)}" data-article="${a.id}" ${a.id === state.current ? 'aria-current="page"' : ''}><span class="article-index">${state.read.includes(a.id) ? icon('check') : String(a.id).padStart(2,'0')}</span><span><span class="article-name" lang="en">${escape(a.title)}</span><span class="article-cn">${escape(a.zhTitle)}</span></span></a>`; }).join('') || '<p class="empty-state">没有匹配的文章</p>';
    $('readCount').textContent = `${state.read.length} / ${data.articles.length} 已读`;
  }
  function closeWord(returnFocus = false) { const wasOpen = !$('wordPopover').hidden; $('wordPopover').hidden = true; selectedWord = null; if (returnFocus && wasOpen && wordTrigger?.isConnected) wordTrigger.focus(); }
  function closeDirectory(returnFocus = false) {
    const wasOpen = $('sidebar').classList.contains('directory-open');
    $('sidebar').classList.remove('directory-open'); $('sidebarBackdrop').hidden = true;
    $('reader').inert = false; document.querySelector('.topbar').inert = false;
    $('sidebar').removeAttribute('role'); $('sidebar').removeAttribute('aria-modal');
    document.body.style.overflow = '';
    if (returnFocus && wasOpen) $('directoryButton').focus();
  }
  function openDirectory() {
    if (innerWidth > 800 && !state.settings.focus) { $('articleSearch').focus(); return; }
    closeWord(); $('sidebar').classList.add('directory-open'); $('sidebarBackdrop').hidden = false;
    $('sidebar').setAttribute('role','dialog'); $('sidebar').setAttribute('aria-modal','true');
    $('reader').inert = true; document.querySelector('.topbar').inert = true;
    document.body.style.overflow = 'hidden';
    $('articleSearch').focus();
  }
  function updateNavigation() {
    document.querySelectorAll('.prev-button').forEach(b => b.disabled = state.current === 1);
    document.querySelectorAll('.next-button').forEach(b => b.disabled = state.current === data.articles.length);
    const read = state.read.includes(state.current);
    $('readButton').innerHTML = read ? `${icon('check')}已读 · 取消标记` : '标记已读';
    $('readButton').setAttribute('aria-pressed', String(read));
  }
  function renderArticle() {
    closeWord();
    const a = current(); renderedKey=a.key;renderedVersion=Position?.fingerprint(a.plain||[]);
    document.title = `${a.title} · English Study`;
    $('articleTitle').textContent = a.title;
    $('articleNumber').textContent = `第 ${a.id} 篇 / ${data.articles.length} 篇`;
    $('articleMeta').textContent = `${a.wordCount} 词 · ${a.words.length} 个目标词 · 约 ${Math.max(1,Math.ceil(a.wordCount / 100))} 分钟${a.batch!=='original'?` · ${a.batchTitle}`:''}`;
    $('englishBody').innerHTML = a.paragraphs.map((p,i) => `<div class="paragraph" id="paragraph-${i}" data-paragraph="${i}"><p>${p}</p><button class="paragraph-translate" data-translate="${i}" aria-expanded="false" aria-controls="inline-translation-${i}" aria-label="查看第 ${i+1} 段译文">译</button><button class="paragraph-study text-button" data-study-paragraph="${i}" aria-label="选择第 ${i+1} 段的句子练习">选句</button><p class="inline-translation" id="inline-translation-${i}" lang="zh-CN" hidden>${escape(a.translations[i])}</p></div>`).join('');
    $('translationTitle').textContent = a.zhTitle;
    $('translationBody').innerHTML = a.translations.map((p,i) => `<div class="translation-paragraph"><span class="number">${String(i+1).padStart(2,'0')}</span><div><p>${escape(p)}</p><button class="text-button" data-jump="${i}" data-article="${a.id}">返回这一段英文</button></div></div>`).join('');
    $('wordSearch').value = '';
    $('vocabularyScope').value = 'article';
    renderDirectory(); renderVocabulary(); renderReview(); updateNavigation();
    learning.articleChanged();
    workspace?.articleChanged();
    experience?.changed();
  }
  function restoreReadingPosition(position,anchor=state.anchorKeys[state.currentKey]) {
    restoring = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target=Position?.resolve(anchor,state.currentKey,paragraphTexts()),range=target&&textRange(target.paragraph,target.offset);
      const rect=range?.getBoundingClientRect();
      window.scrollTo(0,rect?Math.max(0,window.scrollY+rect.top-target.viewportOffset):Number.isFinite(position)?position:0);
      // Native scroll events run before the next animation frame. Keep the guard until then,
      // so an explicit link's programmatic restoration is not mistaken for fresh reading.
      requestAnimationFrame(()=>{restoring=false;});
    }));
  }
  function setArticle(id, {push=true, position=null, paragraph=null,resume=true} = {}) {
    if (!validId(id)) return;
    recordPosition(); clearTimeout(scrollTimer);
    state.current = id; state.currentKey = current().key;if(resume)state.resumeKey=state.currentKey;
    activeTab = 'reading';
    renderArticle(); renderTabs(); closeDirectory(); flushReader();
    if (push) history.pushState(null,'',articleHash(current()));
    restoreReadingPosition(position === null ? state.positions[id] : position,position===null?state.anchorKeys[state.currentKey]:null);
    if (paragraph !== null) requestAnimationFrame(() => requestAnimationFrame(() => $(`paragraph-${paragraph}`)?.scrollIntoView({block:'start'})));
  }
  function continueReading({remote=false}={}){
    const key=state.resumeKey,id=idForKey(key);if(!key)return;
    if(id&&!remote){setArticle(id);return;}
    if(!remote)recordPosition();clearTimeout(scrollTimer);
    state.currentKey=state.resumeKey=key;activeTab='reading';projectRecords();renderArticle();renderTabs();closeDirectory();
    if(!remote)flushReader();
    history[remote?'replaceState':'pushState'](null,'',id?articleHash(current()):`#read=${encodeURIComponent(key)}`);
    restoreReadingPosition(id?state.positions[state.current]:0,id?state.anchorKeys[key]:null);
    if(!id)toast('续读文章尚未就绪，历史位置已保留。');
  }
  window.StudyReaderAPI={checkpoint:()=>{recordPosition();if(!persist())return Promise.reject(Error('阅读记录尚未保存，请重试。'));return StudyState.flush();},continueReading,applyRemoteResume:()=>continueReading({remote:true})};
  function renderTabs() {
    ['reading','vocabulary','sentence','translation','review'].forEach(tab => {
      const selected = tab === activeTab;
      $(`panel-${tab}`).hidden = !selected;
      $(`tab-${tab}`).setAttribute('aria-selected',String(selected));
      $(`tab-${tab}`).tabIndex = selected ? 0 : -1;
    });
    $('reviewCount').textContent = learning.count() || '';
  }
  function setTab(tab) {
    if (!['reading','vocabulary','sentence','translation','review'].includes(tab) || activeTab === tab) return;
    recordPosition(); closeWord(); activeTab = tab;
    if (tab === 'review') renderReview();
    renderTabs(); flushReader();
    if (tab === 'reading') restoreReadingPosition(state.positions[state.current]);
    else { restoring = true; requestAnimationFrame(() => { window.scrollTo(0,0); restoring = false; }); }
  }
  function getUsage(lemma, article = state.current, paragraph = null) {
    const uses = data.words[lemma].uses;
    return uses.find(u => u.article === article && u.paragraph === paragraph) || uses.find(u => u.article === article) || uses[0] || null;
  }
  function exampleSentence(u) {
    return u ? StudyLearningCore.contextFor(data.articles[u.article-1],u) : '';
  }
  function wordRow(lemma, review = false) {
    const w = data.words[lemma], u = getUsage(lemma), isSaved = learning.saved(learning.entry(lemma,u));
    return `<div class="word-row" data-row="${escape(lemma)}"><div><h3><button data-word="${escape(lemma)}" lang="en">${escape(w.word)}</button></h3><p class="sense">${u ? escape(u.sense) : '未用于正文'}</p>${u ? `<span class="usage-location">${u.article === state.current ? '本篇用义' : `语境用义 · 第 ${u.article} 篇`} · ${escape(u.form)}</span>` : ''}<details><summary>词表义项与用词语境</summary><p class="allowed">${escape(w.allowed)}</p>${u ? `<p class="example" lang="en">${escape(exampleSentence(u))}</p><button class="jump" data-jump="${u.paragraph}" data-article="${u.article}">定位到第 ${u.article} 篇原文</button>` : `<p class="allowed">${escape(w.omission || '本资料未提供使用记录。')}</p>`}</details></div><button class="icon-button ${isSaved ? 'saved' : ''}" data-save="${escape(lemma)}" aria-label="${isSaved ? '移除本次用义' : '收藏本次用义'} ${escape(w.word)}" aria-pressed="${isSaved}" ${u?'':'disabled'}>${icon('star')}</button></div>`;
  }
  function renderVocabulary() {
    const query = $('wordSearch').value.trim().toLowerCase();
    const scope = $('vocabularyScope').value;
    const words = scope === 'all' ? Object.keys(data.words).sort((a,b)=>data.words[a].id-data.words[b].id) : current().words;
    const filtered = words.filter(k => `${k} ${data.words[k].allowed} ${getUsage(k)?.sense || ''}`.toLowerCase().includes(query));
    $('vocabularyList').innerHTML = filtered.map(k=>wordRow(k)).join('') || '<p class="empty-state">没有匹配的词。可以试试中文释义，或切换到全部词汇。</p>';
  }
  function renderReview() { learning.renderReview(); }
  function toggleSave(lemma) {
    learning.toggle(selectedWord===lemma ? learning.selected() : learning.entry(lemma,getUsage(lemma)));
  }
  function updateSaveWordButton() {
    const saved = learning.saved(learning.selected());
    $('saveWord').innerHTML = `${icon(saved ? 'check' : 'plus')}${saved ? '已收藏本次用义 · 移除' : '收藏本次用义'}`;
    $('saveWord').setAttribute('aria-pressed',String(saved));
  }
  function showWord(lemma, trigger) {
    if (!data.words[lemma]) return;
    const selection = window.getSelection();
    if (trigger.classList.contains('target') && selection && !selection.isCollapsed) return;
    const paragraph = trigger.closest('[data-paragraph]');
    const w = data.words[lemma], u = StudyLearningCore.resolveUse(data,lemma,{article:state.current,paragraph:paragraph ? Number(paragraph.dataset.paragraph) : null,uid:trigger.dataset.use,form:trigger.classList.contains('target')?trigger.textContent:null});
    const missingUse = paragraph && !u;
    selectedWord = lemma; wordTrigger = trigger;
    $('popoverWord').textContent = w.word;
    $('wordPopover').querySelector('.field-label').textContent = u?.article === state.current ? '本篇用义' : u ? `语境用义 · 第 ${u.article} 篇` : missingUse ? '用义记录待补充' : '未使用原因';
    $('popoverSense').textContent = u ? u.sense : missingUse ? '此处未提供独立用义记录，请结合原句查看词表义项。' : '未用于正文';
    $('popoverAllowed').textContent = w.allowed;
    $('allowedDetails').open = false;
    $('popoverContext').textContent = u ? exampleSentence(u) : missingUse ? StudyLearningCore.contextFor(current(),{paragraph:Number(paragraph.dataset.paragraph),form:trigger.textContent}) : w.omission || '本资料未提供使用记录。';
    learning.prepare(lemma,u);
    $('wordPopover').hidden = false; updateSaveWordButton();
    const rect = trigger.getBoundingClientRect(), pop = $('wordPopover');
    const left = Math.max(12,Math.min(innerWidth-pop.offsetWidth-12,rect.left));
    let top = rect.bottom+12;
    if (top+pop.offsetHeight>innerHeight-12) top = Math.max(70,rect.top-pop.offsetHeight-12);
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  }
  function jump(article, paragraph) {
    if (article !== state.current) setArticle(article,{position:0,paragraph});
    else { setTab('reading'); requestAnimationFrame(()=>requestAnimationFrame(()=>$(`paragraph-${paragraph}`)?.scrollIntoView({block:'start'}))); }
  }
  learning = StudyLearning.create({data,current,legacy:state.review,toast,
    changed:()=>{renderVocabulary();if(selectedWord)updateSaveWordButton();experience?.changed();},navigate:(id,p)=>{if(experience)experience.origin(data.articles[id-1].key,p,{activity:'review-list',view:'words'});else jump(id,p);},
    questionCount:()=>workspace?.wrongCount()||0,renderQuestions:()=>workspace?.renderWrongQuestions()||'',undoQuestion:()=>workspace?.undoQuestion(),removedQuestionCount:()=>workspace?.removedQuestionCount()||0,
    openSentence:snapshot=>{
      experience?.remember({activity:'review-list',view:'sentences'});
      const id=idForKey(snapshot.articleKey);if(!id)return;
      if(id!==state.current)setArticle(id,{position:0});
      learning.articleChanged(snapshot.id);setTab('sentence');$('sentenceOwn').focus();
    }
  });
  workspace=StudyWorkspace.create({data,current,persist:()=>{recordPosition();persist();},toast,
    closeAux:()=>{closeWord();closeDirectory();},navigate:(key,paragraph)=>{const id=idForKey(key);if(id)setArticle(id,paragraph===undefined?{}:{position:0,paragraph});},
    selectedWord:()=>learning.selected()||(selectedWord?{word:data.words[selectedWord]?.word,wordKey:selectedWord,form:wordTrigger?.textContent,paragraph:Number(wordTrigger?.closest('[data-paragraph]')?.dataset.paragraph)||0}:null),saveCard:e=>{if(!learning.saved(e))learning.toggle(e);else toast('这张义项卡已收藏');},reviewChanged:()=>{learning.renderReview();renderTabs();},
    markRead
  });window.StudyWorkspaceAPI=workspace;
  function markRead(){if(!state.readKeys.includes(current().key))state.readKeys.push(current().key);state.read=state.readKeys.map(idForKey).filter(Boolean);persist();updateNavigation();renderDirectory();experience?.changed();}
  const captureReader=()=>({key:current().key,tab:activeTab,scroll:Math.max(0,window.scrollY)});
  const restoreReader=r=>{const id=idForKey(r.key);if(!id){toast('原返回位置的文章已移除，保留当前文章。');return;}setArticle(id,{position:r.tab==='reading'?r.scroll:0});if(r.tab!=='reading'){setTab(r.tab);restoreReadingPosition(r.scroll,null);}};
  experience=StudyExperience.create({data,current,toast,closeAux:()=>{closeWord();closeDirectory();},captureReader,restoreReader,
    navigate:(key,p)=>{const id=idForKey(key);if(id)setArticle(id,{position:0,paragraph:p});},
    practiceSentence:s=>{const id=idForKey(s.articleKey);if(id!==state.current)setArticle(id,{position:0});learning.articleChanged(s.id);setTab('sentence');$('sentenceOwn').focus();},
    openReview:view=>{setTab('review');learning.setReviewView(view||'words');},refreshLearning:()=>{learning.reloadState();renderVocabulary();renderTabs();},isRead:()=>state.read.includes(state.current),
    completeAndNext:async()=>{const handled=await workspace.finishAndNext();if(!handled){markRead();await StudyState.flush();if(validId(state.current+1))setArticle(state.current+1,{position:0});else toast('已读到最后一篇，可继续复习或导入新资料。');}}
  });window.StudyExperienceAPI=experience;
  document.addEventListener('study-storage-warning',e=>toast(e.detail));
  paintIcons();
  $('articleSearch').addEventListener('input',renderDirectory);
  $('batchFilter').addEventListener('change',renderDirectory);['readFilter','topicFilter','dateFilter'].forEach(id=>$(id).addEventListener('change',renderDirectory));$('clearFilters').addEventListener('click',()=>{$('articleSearch').value='';$('batchFilter').value='all';$('readFilter').value='all';$('topicFilter').value='all';$('dateFilter').value='';renderDirectory();});
  $('articleList').addEventListener('click',e=>{ const link=e.target.closest('[data-article]'); if (link) {e.preventDefault();setArticle(Number(link.dataset.article));} });
  $('directoryButton').addEventListener('click',openDirectory);
  $('continueReading')?.addEventListener('click',()=>continueReading());
  $('closeDirectory').addEventListener('click',()=>closeDirectory(true));
  $('sidebarBackdrop').addEventListener('click',()=>closeDirectory(true));
  $('sidebar').addEventListener('keydown',e=>{
    if(e.key !== 'Tab' || !$('sidebar').classList.contains('directory-open')) return;
    const items=[...$('sidebar').querySelectorAll('button,a,input')].filter(el=>el.offsetParent !== null);
    const first=items[0],last=items.at(-1);
    if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
  });
  document.querySelectorAll('.prev-button').forEach(b=>b.addEventListener('click',()=>setArticle(state.current-1)));
  document.querySelectorAll('.next-button').forEach(b=>b.addEventListener('click',()=>setArticle(state.current+1)));
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  document.querySelector('.tabs').addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key) || e.altKey) return;
    const tabs=[...document.querySelectorAll('[data-tab]')],i=tabs.indexOf(document.activeElement);
    if(i<0)return;
    e.preventDefault();
    const n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    setTab(tabs[n].dataset.tab);tabs[n].focus();
  });
  document.addEventListener('click',e=>{
    const target=e.target.closest('[data-word]');
    if(target){showWord(target.dataset.word,target);return;}
    const save=e.target.closest('[data-save]');
    if(save){toggleSave(save.dataset.save);return;}
    const jumpButton=e.target.closest('[data-jump]');
    if(jumpButton){experience.origin(data.articles[Number(jumpButton.dataset.article)-1].key,Number(jumpButton.dataset.jump),{activity:'reading'});return;}
    const translate=e.target.closest('[data-translate]');
    if(translate){const p=$(`inline-translation-${translate.dataset.translate}`);p.hidden=!p.hidden;translate.setAttribute('aria-expanded',String(!p.hidden));return;}
    if(!$('wordPopover').contains(e.target))closeWord();
  });
  $('englishBody').addEventListener('keydown',e=>{
    const target=e.target.closest('.target');
    if(target && (e.key==='Enter'||e.key===' ')){e.preventDefault();showWord(target.dataset.word,target);$('closeWord').focus();}
  });
  $('saveWord').addEventListener('click',()=>{if(selectedWord)toggleSave(selectedWord);});
  $('closeWord').addEventListener('click',()=>closeWord(true));
  $('wordSearch').addEventListener('input',renderVocabulary);
  $('vocabularyScope').addEventListener('change',renderVocabulary);
  $('readButton').addEventListener('click',async()=>{const wasRead=state.read.includes(state.current),oldKeys=[...state.readKeys];state.readKeys=wasRead?state.readKeys.filter(key=>key!==current().key):[...state.readKeys,current().key];state.read=state.readKeys.map(idForKey).filter(Boolean);if(!persist()){state.readKeys=oldKeys;state.read=oldKeys.map(idForKey).filter(Boolean);return;}renderDirectory();updateNavigation();experience.changed();try{await StudyState.flush();toast(wasRead?'已取消已读标记':'本篇已标记为已读');}catch(e){toast(e.message);}});
  $('focusButton').addEventListener('click',()=>{closeDirectory();closeWord();changeLayout(()=>state.settings.focus=!state.settings.focus);});
  $('themeButton').addEventListener('click',()=>{state.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applySettings();persist();});
  $('settingsButton').addEventListener('click',()=>{closeWord();applySettings();$('settingsDialog').showModal();});
  $('aboutButton').addEventListener('click',()=>{closeDirectory();$('aboutDialog').showModal();});
  document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  document.querySelectorAll('input[name=theme]').forEach(el=>el.addEventListener('change',()=>{state.settings.theme=el.value;applySettings();persist();}));
  function changeLayout(change){recordPosition();const anchor=state.anchorKeys[state.currentKey],position=state.positions[state.current];change();applySettings();persist();if(activeTab==='reading')restoreReadingPosition(position,anchor);}
  ['fontSize','lineHeight'].forEach(id=>$(id).addEventListener('input',()=>changeLayout(()=>state.settings[id]=Number($(id).value))));
  $('fontFamily').addEventListener('change',()=>changeLayout(()=>state.settings.fontFamily=$('fontFamily').value));
  $('highlightWords').addEventListener('change',()=>{state.settings.highlight=$('highlightWords').checked;applySettings();persist();});
  $('resetSettings').addEventListener('click',()=>{changeLayout(()=>state.settings={...defaults});toast('显示设置已恢复默认');});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.settings.theme==='system')applySettings();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeWord(true);closeDirectory(true);}
    const editable=e.target.closest('input,textarea,select,[contenteditable]');
    if(e.altKey&&!editable&&!document.querySelector('dialog[open]')){
      if(e.key==='ArrowRight'){e.preventDefault();setArticle(state.current+1);}
      if(e.key==='ArrowLeft'){e.preventDefault();setArticle(state.current-1);}
    }
  });
  window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);if(restoring)return;if(Date.now()-lastCheckpoint>=5000&&recordPosition())flushReader();scrollTimer=setTimeout(()=>{if(recordPosition())persist();},200);},{passive:true});
  const lifecycleSave=()=>{clearTimeout(scrollTimer);if(recordPosition())flushReader();};
  window.addEventListener('pagehide',lifecycleSave);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')lifecycleSave();});
  window.addEventListener('resize',()=>{closeWord();if(innerWidth>800)closeDirectory();if(activeTab==='reading'&&state.anchorKeys[state.currentKey]){restoring=true;clearTimeout(scrollTimer);clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>restoreReadingPosition(state.positions[state.current]),120);}});
  function hashArticle() { if(location.hash.startsWith('#read=')){try{return idForKey(decodeURIComponent(location.hash.slice(6)))||null;}catch{return null;}} const match=location.hash.match(/^#(?:article-|en-|zh-)(\d+)$/);return match&&validId(Number(match[1]))?Number(match[1]):null; }
  function pendingHashKey() {if(location.hash.startsWith('#read=')){try{return decodeURIComponent(location.hash.slice(6))||null;}catch{return null;}}return null;}
  function followHash() { const id=hashArticle();if(id){setArticle(id,{push:false,resume:false});if(location.hash.startsWith('#zh-'))setTab('translation');}else if(pendingHashKey()){recordPosition();state.currentKey=pendingHashKey();activeTab='reading';projectRecords();renderArticle();renderTabs();persist();restoreReadingPosition(0,null);toast('目标文章尚未就绪，已保留原记录；资料加载后再打开。');} }
  window.addEventListener('popstate',followHash);
  window.addEventListener('hashchange',()=>{const id=hashArticle();if(id!==state.current||(id&&data.articles[id-1].key!==state.currentKey))followHash();});
  if(hashArticle()){state.current=hashArticle();state.currentKey=current().key;}else if(pendingHashKey()){state.currentKey=pendingHashKey();projectRecords();}else {state.currentKey=state.resumeKey;projectRecords();}
  applySettings();renderArticle();renderTabs();
  if(location.hash.startsWith('#zh-'))setTab('translation');
  else restoreReadingPosition(state.positions[state.current]);
  if(state.currentKey===current().key) history.replaceState(null,'',articleHash(current()));
  else toast('上次阅读的文章尚未就绪，阅读记录已保留。');
  function updateLibraryControls() {
    const selected = $('batchFilter').value,topic=$('topicFilter').value;$('topicFilter').innerHTML='<option value="all">全部主题</option>'+[...new Set(data.articles.flatMap(a=>a.topics||[]))].sort().map(t=>`<option value="${escape(t)}">${escape(t)}</option>`).join('');if([...$('topicFilter').options].some(o=>o.value===topic))$('topicFilter').value=topic;
    $('batchFilter').innerHTML = '<option value="all">全部资料</option><option value="original">原始 1000 词资料</option>'+StudyLibrary.entries().map(r=>`<option value="${escape(r.id)}">${escape(r.title)} · ${r.source==='local'?'本机':'已发布'}</option>`).join('');
    if([...$('batchFilter').options].some(o=>o.value===selected)) $('batchFilter').value=selected;
    $('libraryCount').textContent = `${Object.keys(data.words).length} 个目标词条`;
    $('vocabularyScope').querySelector('[value=all]').textContent = `全部 ${Object.keys(data.words).length} 词条`;
  }
  updateLibraryControls();
  StudyState.onReload(async detail=>{
    clearTimeout(scrollTimer);closeWord();
    const visibleKey=state.currentKey, next=StudyState.get('reader',{});
    Object.keys(state).forEach(key=>delete state[key]);Object.assign(state,next);
    state.settings=normalizeSettings(next.settings||{});state.review=Array.isArray(next.review)?[...next.review]:[];
    state.currentKey=visibleKey; // Refresh records without forcing a different article onto the reader.
    state.readKeys=Array.isArray(next.readKeys)?[...next.readKeys]:(next.read||[]).filter(validId).map(id=>data.articles[id-1].key);
    state.positionKeys=next.positionKeys?{...next.positionKeys}:Object.fromEntries(Object.entries(next.positions||{}).filter(([id])=>validId(Number(id))).map(([id,v])=>[data.articles[Number(id)-1].key,v]));
    state.anchorKeys=next.anchorKeys&&typeof next.anchorKeys==='object'?{...next.anchorKeys}:{};
    state.resumeKey=next.resumeKey||next.currentKey||visibleKey;
    projectRecords();applySettings();learning.reloadState();
    if(detail.packs!==undefined)await StudyLibrary.reload(detail.packs,{token:detail.libraryToken});
    renderDirectory();renderVocabulary();renderTabs();updateNavigation();updateContinue();workspace.reloadState();experience.reloadState();
    if(detail.followResume)continueReading({remote:true});
  });
  await StudyState.refresh();persist();
  StudyLibrary.attach({toast,closeAux:()=>{closeWord();closeDirectory();},beforeChange:()=>{recordPosition();persist();},onChange:({external=false}={})=>{
    const wasMissing=renderedKey!==state.currentKey,oldVersion=renderedVersion;
    projectRecords();
    learning.libraryChanged({external});
    workspace.changed();
    updateLibraryControls(); renderArticle(); renderTabs();updateContinue(); if(!external)persist();
    if(state.currentKey===current().key)history.replaceState(null,'',articleHash(current()));
    if(activeTab==='reading'&&(!external||wasMissing||renderedKey!==state.currentKey||oldVersion!==renderedVersion))restoreReadingPosition(state.positions[state.current]);
  },select:id=>{const a=data.articles.find(a=>a.batch===id);if(a){$('batchFilter').value=id;$('articleSearch').value='';setArticle(a.id,{position:0});}}});
})();
