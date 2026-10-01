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
  const saved = raw.settings || {};
  const state = {
    settings: {
      theme:['system','light','sepia','dark'].includes(saved.theme) ? saved.theme : defaults.theme,
      fontSize:Number.isFinite(saved.fontSize) ? Math.max(16,Math.min(28,saved.fontSize)) : defaults.fontSize,
      lineHeight:Number.isFinite(saved.lineHeight) ? Math.max(1.5,Math.min(2.5,saved.lineHeight)) : defaults.lineHeight,
      fontFamily:saved.fontFamily === 'sans' ? 'sans' : 'serif', highlight:saved.highlight !== false, focus:saved.focus === true
    },
    current:typeof raw.currentKey==='string' ? (idForKey(raw.currentKey) || 1) : (validId(raw.current) ? raw.current : 1),
    read:Array.isArray(raw.readKeys) ? raw.readKeys.map(idForKey).filter(Boolean) : Array.isArray(raw.read) ? raw.read.filter(validId) : [],
    review:Array.isArray(raw.review) ? [...new Set(raw.review.filter(w => typeof w === 'string' && data.words[w]))] : [],
    positions:raw.positionKeys && typeof raw.positionKeys === 'object' ? Object.fromEntries(Object.entries(raw.positionKeys).map(([k,v])=>[idForKey(k),v]).filter(([id])=>id)) : raw.positions && typeof raw.positions === 'object' ? raw.positions : {}
  };
  let activeTab = 'reading', selectedWord = null, wordTrigger = null, scrollTimer, toastTimer, storageWarned = false, restoring = false;
  let learning, workspace;
  const current = () => data.articles[state.current - 1];
  const toast = text => { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2500); };
  const persist = () => {
    state.currentKey = current().key;
    state.readKeys = state.read.map(id=>data.articles[id-1]?.key).filter(Boolean);
    state.positionKeys = Object.fromEntries(Object.entries(state.positions).filter(([id])=>validId(Number(id))).map(([id,v])=>[data.articles[Number(id)-1].key,v]));
    try { StudyState.set('reader',state); } catch { if (!storageWarned) { storageWarned = true; toast('浏览器未允许保存，设置仅在本次打开期间生效'); } }
  };
  const recordPosition = () => { if (!restoring && activeTab === 'reading') state.positions[state.current] = Math.max(0,window.scrollY); };
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
    const articles = data.articles.filter(a => (batch==='all'||a.batch===batch) && `${a.id} ${a.title} ${a.zhTitle} ${a.batchTitle}`.toLowerCase().includes(query));
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
    const a = current();
    document.title = `${a.title} · English Study`;
    $('articleTitle').textContent = a.title;
    $('articleNumber').textContent = `第 ${a.id} 篇 / ${data.articles.length} 篇`;
    $('articleMeta').textContent = `${a.wordCount} 词 · ${a.words.length} 个目标词 · 约 ${Math.max(1,Math.ceil(a.wordCount / 100))} 分钟${a.batch!=='original'?` · ${a.batchTitle}`:''}`;
    $('englishBody').innerHTML = a.paragraphs.map((p,i) => `<div class="paragraph" id="paragraph-${i}" data-paragraph="${i}"><p>${p}</p><button class="paragraph-translate" data-translate="${i}" aria-expanded="false" aria-controls="inline-translation-${i}" aria-label="查看第 ${i+1} 段译文">译</button><p class="inline-translation" id="inline-translation-${i}" lang="zh-CN" hidden>${escape(a.translations[i])}</p></div>`).join('');
    $('translationTitle').textContent = a.zhTitle;
    $('translationBody').innerHTML = a.translations.map((p,i) => `<div class="translation-paragraph"><span class="number">${String(i+1).padStart(2,'0')}</span><div><p>${escape(p)}</p><button class="text-button" data-jump="${i}" data-article="${a.id}">返回这一段英文</button></div></div>`).join('');
    $('wordSearch').value = '';
    $('vocabularyScope').value = 'article';
    renderDirectory(); renderVocabulary(); renderReview(); updateNavigation();
    learning.articleChanged();
    workspace?.articleChanged();
  }
  function restoreReadingPosition(position) {
    restoring = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo(0,Number.isFinite(position) ? position : 0);
      restoring = false;
    }));
  }
  function setArticle(id, {push=true, position=null, paragraph=null} = {}) {
    if (!validId(id)) return;
    recordPosition(); clearTimeout(scrollTimer);
    state.current = id;
    activeTab = 'reading';
    renderArticle(); renderTabs(); closeDirectory(); persist();
    if (push) history.pushState(null,'',articleHash(current()));
    restoreReadingPosition(position === null ? state.positions[id] : position);
    if (paragraph !== null) requestAnimationFrame(() => requestAnimationFrame(() => $(`paragraph-${paragraph}`)?.scrollIntoView({block:'start'})));
  }
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
    renderTabs(); persist();
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
    changed:()=>{renderVocabulary();if(selectedWord)updateSaveWordButton();},navigate:jump,
    questionCount:()=>workspace?.wrongCount()||0,renderQuestions:()=>workspace?.renderWrongQuestions()||'',undoQuestion:()=>workspace?.undoQuestion(),removedQuestionCount:()=>workspace?.removedQuestionCount()||0,
    openSentence:snapshot=>{
      const id=idForKey(snapshot.articleKey);if(!id)return;
      if(id!==state.current)setArticle(id,{position:0});
      learning.articleChanged(snapshot.id);setTab('sentence');$('sentenceOwn').focus();
    }
  });
  workspace=StudyWorkspace.create({data,current,persist:()=>{recordPosition();persist();},toast,
    closeAux:()=>{closeWord();closeDirectory();},navigate:(key,paragraph)=>{const id=idForKey(key);if(id)setArticle(id,paragraph===undefined?{}:{position:0,paragraph});},
    selectedWord:()=>learning.selected()||(selectedWord?{word:data.words[selectedWord]?.word,paragraph:Number(wordTrigger?.closest('[data-paragraph]')?.dataset.paragraph)||0}:null),saveCard:e=>{if(!learning.saved(e))learning.toggle(e);else toast('这张义项卡已收藏');},reviewChanged:()=>{learning.renderReview();renderTabs();},
    markRead:()=>{if(!state.read.includes(state.current))state.read.push(state.current);persist();updateNavigation();renderDirectory();}
  });
  document.addEventListener('study-storage-warning',e=>toast(e.detail));
  paintIcons();
  $('articleSearch').addEventListener('input',renderDirectory);
  $('batchFilter').addEventListener('change',renderDirectory);
  $('articleList').addEventListener('click',e=>{ const link=e.target.closest('[data-article]'); if (link) {e.preventDefault();setArticle(Number(link.dataset.article));} });
  $('directoryButton').addEventListener('click',openDirectory);
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
    if(jumpButton){jump(Number(jumpButton.dataset.article),Number(jumpButton.dataset.jump));return;}
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
  $('readButton').addEventListener('click',()=>{const wasRead=state.read.includes(state.current);state.read=wasRead?state.read.filter(n=>n!==state.current):[...state.read,state.current];persist();renderDirectory();updateNavigation();toast(wasRead?'已取消已读标记':'本篇已标记为已读');});
  $('focusButton').addEventListener('click',()=>{recordPosition();state.settings.focus=!state.settings.focus;closeDirectory();closeWord();applySettings();persist();});
  $('themeButton').addEventListener('click',()=>{state.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applySettings();persist();});
  $('settingsButton').addEventListener('click',()=>{closeWord();applySettings();$('settingsDialog').showModal();});
  $('aboutButton').addEventListener('click',()=>{closeDirectory();$('aboutDialog').showModal();});
  document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  document.querySelectorAll('input[name=theme]').forEach(el=>el.addEventListener('change',()=>{state.settings.theme=el.value;applySettings();persist();}));
  ['fontSize','lineHeight'].forEach(id=>$(id).addEventListener('input',()=>{state.settings[id]=Number($(id).value);applySettings();persist();}));
  $('fontFamily').addEventListener('change',()=>{state.settings.fontFamily=$('fontFamily').value;applySettings();persist();});
  $('highlightWords').addEventListener('change',()=>{state.settings.highlight=$('highlightWords').checked;applySettings();persist();});
  $('resetSettings').addEventListener('click',()=>{state.settings={...defaults};applySettings();persist();toast('显示设置已恢复默认');});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.settings.theme==='system')applySettings();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeWord(true);closeDirectory(true);}
    const editable=e.target.closest('input,textarea,select,[contenteditable]');
    if(e.altKey&&!editable&&!document.querySelector('dialog[open]')){
      if(e.key==='ArrowRight'){e.preventDefault();setArticle(state.current+1);}
      if(e.key==='ArrowLeft'){e.preventDefault();setArticle(state.current-1);}
    }
  });
  window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{recordPosition();persist();},200);},{passive:true});
  window.addEventListener('pagehide',()=>{recordPosition();persist();});
  window.addEventListener('resize',()=>{closeWord();if(innerWidth>800)closeDirectory();});
  function hashArticle() { if(location.hash.startsWith('#read=')){try{return idForKey(decodeURIComponent(location.hash.slice(6)))||null;}catch{return null;}} const match=location.hash.match(/^#(?:article-|en-|zh-)(\d+)$/);return match&&validId(Number(match[1]))?Number(match[1]):null; }
  function followHash() { const id=hashArticle();if(id){setArticle(id,{push:false});if(location.hash.startsWith('#zh-'))setTab('translation');} }
  window.addEventListener('popstate',followHash);
  window.addEventListener('hashchange',()=>{if(hashArticle()!==state.current)followHash();});
  if(hashArticle())state.current=hashArticle();
  applySettings();renderArticle();renderTabs();
  if(location.hash.startsWith('#zh-'))setTab('translation');
  else restoreReadingPosition(state.positions[state.current]);
  if(!location.hash.startsWith('#read=') || hashArticle()) history.replaceState(null,'',articleHash(current()));
  function updateLibraryControls() {
    const selected = $('batchFilter').value;
    $('batchFilter').innerHTML = '<option value="all">全部资料</option><option value="original">原始 1000 词资料</option>'+StudyLibrary.entries().map(r=>`<option value="${escape(r.id)}">${escape(r.title)} · ${r.source==='local'?'本机':'已发布'}</option>`).join('');
    if([...$('batchFilter').options].some(o=>o.value===selected)) $('batchFilter').value=selected;
    $('libraryCount').textContent = `${Object.keys(data.words).length} 个目标词条`;
    $('vocabularyScope').querySelector('[value=all]').textContent = `全部 ${Object.keys(data.words).length} 词条`;
  }
  updateLibraryControls(); persist();
  StudyLibrary.attach({toast,closeAux:()=>{closeWord();closeDirectory();},beforeChange:()=>{recordPosition();persist();},onChange:()=>{
    state.current = hashArticle() || idForKey(state.currentKey) || 1;
    state.read = state.readKeys.map(idForKey).filter(Boolean);
    state.positions = Object.fromEntries(Object.entries(state.positionKeys).map(([k,v])=>[idForKey(k),v]).filter(([id])=>id));
    learning.libraryChanged();
    workspace.changed();
    updateLibraryControls(); renderArticle(); renderTabs(); persist();
    history.replaceState(null,'',articleHash(current()));
    if(activeTab==='reading')restoreReadingPosition(state.positions[state.current]);
  },select:id=>{const a=data.articles.find(a=>a.batch===id);if(a){$('batchFilter').value=id;$('articleSearch').value='';setArticle(a.id,{position:0});}}});
})();
