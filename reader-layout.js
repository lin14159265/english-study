/* V2 presentation layer: reuse the original controls, records and acknowledged refresh. */
(function(root){
  'use strict';
  const $=id=>document.getElementById(id),C=root.StudyReaderLayoutCore,esc=s=>root.StudyPack.escape(s??'');
  function create(app){
    const {current,data,toast}=app,S=root.StudyState,L=root.StudyLearningCore;
    let rows={cards:[],waiting:[],annotations:[]},lastLearning,lastExtra,lastKey,lastVersion,frame,selectedParagraph=null,wordTrigger=null,readingParagraph=0,scrollIdle,projectionError='';
    const pop=$('wordPopover'),reading=$('panel-reading'),reader=$('reader');
    reader.insertAdjacentHTML('beforeend','<aside id="marginLeft" class="margin-left" aria-label="本篇学习记录"></aside><aside id="marginRight" class="margin-right" aria-label="用义与个人批注"><div id="wordDock"></div><div id="marginNotes"></div></aside>');
    document.body.insertAdjacentHTML('beforeend','<dialog id="articleRecordsDialog" class="settings-dialog workspace-dialog" aria-labelledby="articleRecordsTitle"><div class="dialog-heading"><h2 id="articleRecordsTitle">本篇学习记录</h2><button class="icon-button close-dialog" aria-label="关闭本篇学习记录">×</button></div><div id="articleRecordsBody"></div></dialog>');
    $('toolsCurrent').insertAdjacentHTML('afterend','<button id="articleRecordsOpen" class="text-button">本篇生词与批注</button>');
    const menu=$('toolsDialog');
    menu.querySelector('h2').textContent='更多';
    menu.querySelector('.dialog-heading .field-label')?.remove();
    const tabs=document.querySelector('.tabs');menu.insertBefore(tabs,$('toolsCurrent'));
    const account=document.createElement('div');account.className='menu-device';account.setAttribute('aria-label','资料与设备');
    for(const id of ['importButton','cloudButton','saveStatus','sourceTrust'])account.append($(id));
    menu.append(account);
    const settings=$('settingsDialog');
    const options=document.createElement('div');options.className='settings-shortcuts';options.append($('focusButton'),$('themeButton'),$('guessMode').closest('.reading-practice'));
    for(const button of options.querySelectorAll('button'))button.type='button';
    options.insertAdjacentHTML('afterbegin','<h3 class="panel-section-title">阅读辅助</h3>');
    settings.querySelector('form').insertBefore(options,settings.querySelector('.settings-footer'));
    $('continueReading').classList.add('directory-continue');$('sidebar').insertBefore($('continueReading'),$('articleSearch').closest('label'));
    // One live popover is moved between desktop dock and mobile overlay; never clone IDs/events.
    const detail=document.createElement('details');detail.className='word-details';detail.innerHTML='<summary>自评与更多</summary>';
    for(const node of [$('allowedDetails'),$('rateWord'),pop.querySelector('.quiz-note'),pop.querySelector('.learning-actions')])detail.append(node);
    pop.append(detail);
    pop.insertBefore($('popoverContext'),$('saveWord'));
    $('finishReading').hidden=true;menu.append(document.querySelector('.difficulty-row'));
    // Move the existing live controls; their IDs, handlers, status nodes and locks
    // remain intact. Icons decorate the presentation, never replace control text.
    const menuIcons={book:'<path d="M12 7c-2-2-6-3-10-2v14c4-1 8 0 10 2 2-2 6-3 10-2V5c-4-1-8 0-10 2Z"/><path d="M12 7v14"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',edit:'<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-4-4L5 15l-1 5Z"/>',check:'<path d="m7 12 3 3 7-7"/><rect x="3" y="3" width="18" height="18" rx="3"/>',repeat:'<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',note:'<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M14 3v7h7M7 14h10m-10 3h7"/>',list:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1"/>',chart:'<path d="M4 3v17h17M9 15v-5m5 5V6m5 9v-3"/>',plus:'<path d="M12 4v16M4 12h16"/>',backup:'<path d="M3 10v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M12 3v12m-4-4 4 4 4-4M3 6h4m10 0h4"/>',cloud:'<path d="M7 18h11a4 4 0 0 0 .4-8 6.5 6.5 0 0 0-12.3-1A4.5 4.5 0 0 0 7 18Z"/>',save:'<path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v6h9V3M7 21v-7h10v7"/>'};
    function menuGroup(title,entries){
      const group=document.createElement('section');group.className='panel-menu-group';group.setAttribute('aria-label',title);group.innerHTML=`<h3 class="panel-section-title">${esc(title)}</h3><div class="panel-menu-items"></div>`;
      for(const [id,kind,label]of entries){
        const button=$(id),text=document.createElement('span');text.className='panel-menu-text';
        for(const svg of button.querySelectorAll('svg'))svg.remove();
        const status=label?document.createElement('small'):text;
        if(label){text.textContent=label;status.className='panel-menu-status';text.append(status);}
        while(button.firstChild)status.append(button.firstChild);
        button.classList.add('panel-menu-item');button.append(text);
        button.insertAdjacentHTML('afterbegin',`<svg class="panel-menu-icon" viewBox="0 0 24 24" aria-hidden="true">${menuIcons[kind]}</svg>`);
        button.insertAdjacentHTML('beforeend','<svg class="panel-menu-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>');
        group.querySelector('.panel-menu-items').append(button);
      }
      menu.insertBefore(group,menu.querySelector('.difficulty-row'));
    }
    menuGroup('本篇工具',[['articleRecordsOpen','book'],['contextOpen','search'],['editorOpen','edit'],['quizOpen','check']]);
    menuGroup('学习与复习',[['toolsRound','repeat'],['toolsPending','note'],['toolsLookup','search'],['queueOpen','list'],['toolsInsight','chart']]);
    menuGroup('资料与设备',[['importButton','plus'],['toolsBackup','backup'],['cloudButton','cloud','云同步'],['saveStatus','save','保存与离线'],['sourceTrust','check']]);
    for(const container of menu.querySelectorAll('.tool-menu,.study-shortcuts,.menu-device'))container.remove();
    $('readingEnd').append($('readButton'),$('endQuiz'));
    // Remove only obsolete sequential navigation, not any task-queue operation.
    document.querySelectorAll('.prev-button,.next-button,.nav-divider').forEach(n=>n.remove());
    document.querySelector('.article-footer').hidden=true;
    document.querySelector('.article-navigation').hidden=true;
    document.querySelector('.reading-note').hidden=true;
    $('articleMeta').hidden=true;document.querySelector('.source-trust').hidden=true;
    function openRecords(){
      app.closeWord();renderRecords();root.StudyPanels.open('articleRecordsDialog');
    }
    $('articleRecordsOpen').addEventListener('click',openRecords);
    function sourceLink(kind,r){
      const where=L.locate(data,r),label=kind==='card'?r.word:r.en;
      return `<button class="margin-record" data-margin-kind="${kind}" data-margin-id="${esc(r.id)}" title="${esc(label)}"><span lang="en">${esc(label)}</span>${where?'':'<small>历史快照</small>'}</button>`;
    }
    function renderLeft(){
      const parts=[];
      if(rows.cards.length)parts.push(`<section class="margin-section"><h2>本篇生词</h2>${C.nearbyCards(current(),rows.cards,readingParagraph).map(r=>sourceLink('card',r)).join('')}${rows.cards.length>5?'<button class="text-button" data-records-all>查看全部</button>':''}</section>`);
      if(rows.waiting.length)parts.push(`<section class="margin-section"><h2>待回看</h2>${rows.waiting.slice(-3).reverse().map(({kind,record})=>sourceLink(kind,record)).join('')}${rows.waiting.length>3?'<button class="text-button" data-records-all>查看全部</button>':''}</section>`);
      $('marginLeft').innerHTML=parts.join('');$('marginLeft').hidden=!parts.length||reading.hidden;
    }
    function renderNotes(){
      $('marginNotes').innerHTML=rows.annotations.map(({kind,record:r})=>{
        const p=C.annotationLocation(current(),r);if(p===null)return '';
        return `<section class="margin-note" data-note-paragraph="${p}"><h2>我的批注</h2><details class="annotation-text"><summary><span class="annotation-preview">${esc(r.reason||r.own)}</span><span class="annotation-collapse">收起批注</span></summary><p>${esc(r.own)}</p>${r.reason?`<p>${esc(r.reason)}</p>`:''}<button class="text-button" data-margin-kind="${kind}" data-margin-id="${esc(r.id)}">查看与修改记录</button></details></section>`;
      }).join('');schedule();
    }
    function renderRecords(){
      const snapshot=(kind,r)=>`<article class="record-detail">${sourceLink(kind,r)}<details><summary>查看保存的完整记录</summary>${r.sense?`<p>收藏用义：${esc(r.sense)}</p>`:''}<p lang="en">${esc(r.en||r.context)}</p>${r.own?`<p>我的理解：${esc(r.own)}</p>`:''}${r.reason?`<p>批注：${esc(r.reason)}</p>`:''}${r.allowed?`<p>来源义项：${esc(r.allowed)}</p>`:''}</details></article>`;
      const cards=rows.cards.map(r=>snapshot('card',r)).join('');
      const waiting=rows.waiting.map(({kind,record})=>snapshot(kind,record)).join('');
      const annotations=rows.annotations.filter(({kind,record:r})=>!rows.waiting.some(w=>w.kind===kind&&w.record.id===r.id)).map(({kind,record:r})=>snapshot(kind,r)).join('');
      $('articleRecordsBody').innerHTML=(cards?'<h3>本篇生词</h3>'+cards:'')+(waiting?'<h3>待回看</h3>'+waiting:'')+(annotations?'<h3>我的批注</h3>'+annotations:'')||'<p class="empty-state">本篇还没有个人记录。阅读时可收藏本次用义，或留下疑句。</p>';
    }
    function refresh(force=false){
      const learning=S.get('learning',{}),extra=S.get('extra',{}),a=current();
      if(!force&&learning===lastLearning&&extra===lastExtra&&a.key===lastKey&&a.sourceSignature===lastVersion)return;
      if(a.key!==lastKey)readingParagraph=0;
      rows=C.records(a.key,learning,extra);lastLearning=learning;lastExtra=extra;lastKey=a.key;lastVersion=a.sourceSignature;
      renderLeft();renderNotes();if($('articleRecordsDialog').open)renderRecords();
    }
    function layout(){
      frame=null;
      const wide=getComputedStyle(reader).getPropertyValue('--reader-rails').trim()==='1'&&!reading.hidden&&!document.body.classList.contains('focus-mode'),bodyTop=reader.getBoundingClientRect().top+scrollY;
      document.body.classList.toggle('word-docked',wide);
      document.body.classList.toggle('word-overlay',!wide);
      if(wide){if(pop.parentElement!==$('wordDock'))$('wordDock').append(pop);}
      else if(pop.parentElement!==document.body)document.body.append(pop);
      if(!wide||reading.hidden){
        reader.style.minHeight='';
        if(!pop.hidden){
          const v=root.visualViewport,viewport={left:v?.offsetLeft||0,top:v?.offsetTop||0,width:v?.width||innerWidth,height:v?.height||innerHeight};
          const header=Math.max(0,document.querySelector('.topbar').getBoundingClientRect().bottom-viewport.top);
          const css=getComputedStyle(document.documentElement),insets=Object.fromEntries(['left','right','bottom'].map(k=>[k,parseFloat(css.getPropertyValue('--reader-safe-'+k))||0]));
          const placement=C.overlayPlacement({viewport,rect:wordTrigger?.isConnected?wordTrigger.getBoundingClientRect():null,width:viewport.width<=600?viewport.width-24:360,header,insets});
          for(const [name,value] of Object.entries(placement))pop.style.setProperty('--word-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value+'px');
        }
        return;
      }
      let occupied=0;
      if(!pop.hidden){
        const paragraph=$(`paragraph-${selectedParagraph}`),top=Math.max(110,(paragraph?.getBoundingClientRect().top||bodyTop+250)+scrollY-bodyTop-55);
        $('wordDock').style.top=`${top}px`;occupied=top+pop.offsetHeight+28;
      }
      for(const note of $('marginNotes').children){
        const p=$(`paragraph-${note.dataset.noteParagraph}`);if(!p)continue;
        const top=Math.max(p.getBoundingClientRect().top+scrollY-bodyTop,occupied);
        note.style.top=`${top}px`;occupied=top+note.offsetHeight+28;
      }
      // Keep all annotations inside the document, including those after the final paragraph.
      const base=document.querySelector('.reading-column').getBoundingClientRect().height;
      reader.style.minHeight=`${Math.max(base,occupied+48)}px`;
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(layout);}
    function wordOpened(paragraph,trigger){selectedParagraph=paragraph;wordTrigger=trigger;pop.querySelector('.word-details').open=false;layout();}
    function wordClosed(){schedule();}
    function tabChanged(tab){
      document.body.dataset.readingView=tab;$('backToReading').hidden=tab==='reading';
      $('marginRight').hidden=tab!=='reading';$('marginLeft').hidden=tab!=='reading'||!$('marginLeft').children.length;
      $('readingEnd').hidden=tab!=='reading';$('activeTask').classList.toggle('task-in-reader',tab==='reading');
      reader.style.minHeight='';schedule();
    }
    function status(){
      const s=S.status(),failed=s.phase==='error'||s.phase==='conflict';
      // External reloads refresh through reader.js's acknowledged consumer. A native
      // status event must not swallow that failure or report an unhandled exception.
      if(s.phase==='saved')try{refresh(!!projectionError);projectionError='';}catch(e){projectionError=e.message||'页边记录未能刷新';}
      $('readingSaveNotice').hidden=!failed&&!projectionError;
      $('readingSaveMessage').textContent=failed?(s.message||'本机记录尚未保存，请查看状态并重试。'):projectionError?'记录已保存在本机，页边显示刷新失败：'+projectionError:'';
    }
    $('readingSaveRetry').addEventListener('click',()=>{if(projectionError&&S.status().phase==='saved'){status();return;}$('saveStatus').click();});
    document.addEventListener('study-save-state',status);
    document.addEventListener('click',e=>{
      if(e.target.closest('[data-records-all]')){openRecords();return;}
      const b=e.target.closest('[data-margin-kind]');if(!b)return;
      const kind=b.dataset.marginKind,r=kind==='card'?rows.cards.find(r=>r.id===b.dataset.marginId):[...rows.waiting,...rows.annotations].find(r=>r.kind===kind&&r.record.id===b.dataset.marginId)?.record;
      if(!r)return;
      const where=L.locate(data,r);
      if(!where){openRecords();toast('原文已变化，保留历史快照。请在完整记录中核对。');return;}
      root.StudyPanels.leave();
      if(kind==='pending'){root.StudyExperienceAPI.practice(r);return;}
      if(kind==='note'){app.openNote(r);return;}
      app.navigate(r.articleKey,r.paragraph);
      const targets=[...$(`paragraph-${r.paragraph}`).querySelectorAll('.target')];
      const target=targets.find(t=>{
        if(t.dataset.word!==r.wordKey||t.textContent.toLowerCase()!==r.form?.toLowerCase())return false;
        const use=L.resolveUse(data,r.wordKey,{article:current().id,paragraph:r.paragraph,uid:t.dataset.use,form:t.textContent});
        return use?.sense===r.sense;
      });
      if(target)app.showWord(r.wordKey,target);
    });
    if(root.ResizeObserver){const observer=new ResizeObserver(schedule);observer.observe(document.querySelector('.reading-column'));observer.observe(pop);}
    pop.addEventListener('toggle',schedule,true);$('marginNotes').addEventListener('toggle',schedule,true);
    window.addEventListener('resize',()=>{reader.style.minHeight='';schedule();});
    function viewportChanged(){
      const v=root.visualViewport,style=document.documentElement.style;
      style.setProperty('--visual-height',(v?.height||innerHeight)+'px');style.setProperty('--visual-top',(v?.offsetTop||0)+'px');schedule();
    }
    root.visualViewport?.addEventListener('resize',viewportChanged);root.visualViewport?.addEventListener('scroll',viewportChanged);viewportChanged();
    window.addEventListener('scroll',()=>{
      clearTimeout(scrollIdle);if(reading.hidden||!document.body.classList.contains('word-docked'))return;
      scrollIdle=setTimeout(()=>{
        const top=document.querySelector('.topbar').getBoundingClientRect().bottom+14;
        const next=[...$('englishBody').querySelectorAll('.paragraph')].find(p=>p.querySelector('p').getBoundingClientRect().bottom>top);
        const p=Number(next?.dataset.paragraph);if(!Number.isInteger(p)||p===readingParagraph)return;
        readingParagraph=p;try{renderLeft();}catch(e){projectionError=e.message||'页边记录未能刷新';status();}
      },260);
    },{passive:true});
    refresh(true);status();return {refresh,wordOpened,wordClosed,tabChanged,schedule,openRecords};
  }
  root.StudyReaderLayout={create};
})(window);
