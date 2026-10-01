/* Local packages live in IndexedDB; published packages come from a build-time static catalog. */
window.StudyLibrary = (() => {
  'use strict';
  const $ = id => document.getElementById(id), escape = window.StudyPack.escape;
  const DB = 'english-study.packages.v1';
  let db = null, original, data, hooks, draft = null, busy = false, removePending = null;
  const local = new Map(), published = new Map();
  let status = '正在检查已发布资料…', storageStatus = '';
  function openDB() {
    if(window.StudyState)return Promise.resolve(window.StudyState.database());
    return new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } else value?.close(); };
      const timer = setTimeout(()=>finish(null),4000);
      try {
        const req = indexedDB.open(DB,1);
        req.onupgradeneeded = () => req.result.createObjectStore('packs',{keyPath:'key'});
        req.onsuccess = () => { clearTimeout(timer); req.result.onversionchange = () => req.result.close(); finish(req.result); };
        req.onerror = req.onblocked = () => { clearTimeout(timer); finish(null); };
      } catch { clearTimeout(timer); finish(null); }
    });
  }
  function transaction(mode, action) {
    return new Promise((resolve,reject) => {
      if (!db) { reject(new Error('浏览器未允许本机保存')); return; }
      try {
        const tx = db.transaction('packs',mode), store = tx.objectStore('packs');
        let value;
        const req = action(store);
        if (req) req.onsuccess = () => { value = req.result; };
        tx.oncomplete = () => resolve(value);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('本机保存失败'));
      } catch (e) { reject(e); }
    });
  }
  function rawEffective() {
    return [...new Map([...published,...local]).values()].sort((a,b)=>a.payload.date.localeCompare(b.payload.date) || a.payload.id.localeCompare(b.payload.id));
  }
  const extra = () => window.StudyState?.get('extra',StudyWorkspaceCore.emptyExtra()) || StudyWorkspaceCore.emptyExtra();
  function effective() {
    const records = new Map(rawEffective().map(r=>[r.payload.id,r]));
    for(const [id,e] of Object.entries(extra().edits)) {
      if(id==='original')continue;
      const checked=StudyPack.validate(e.payload);
      if(checked.ok)records.set(id,{...(records.get(id)||{source:'local'}),payload:e.payload,compiled:checked.compiled,revised:true});
    }
    return [...records.values()];
  }
  function originalSource() {return rawEffective().find(r=>r.payload.id==='original-baseline')?.payload || StudyWorkspaceCore.originalPack(original);}
  function rebuild() {
    const source=originalSource(), edit=extra().edits.original, result=StudyPack.validate(edit?.payload || source);
    const mapped=StudyWorkspaceCore.remapOriginal(result.compiled);
    const revised=!!edit || source!==undefined && rawEffective().some(r=>r.payload.id==='original-baseline');
    const articles = revised ? mapped.articles : original.articles.map((a,i)=>({...a,key:`original/${a.id}`,batch:'original',batchTitle:'原始 1000 词资料',questions:mapped.articles[i].questions,sourceSignature:mapped.articles[i].sourceSignature,quizSignature:mapped.articles[i].quizSignature}));
    const words = Object.assign(Object.create(null),revised?mapped.words:original.words);
    if (words.desirability && !words.desirability.uses.length) words.desirability = {...words.desirability,omission:'原词表“愿望，欲求”释义存疑，不能直接当作 desire 使用。'};
    effective().filter(r=>r.payload.id!=='original-baseline').forEach(record => {
      const pack = record.compiled, offset = articles.length;
      pack.articles.forEach(a=>articles.push({...a,id:a.id+offset}));
      Object.entries(pack.words).forEach(([k,w])=>{ words[k] = {...w,uses:w.uses.map(u=>({...u,article:u.article+offset}))}; });
    });
    data.articles = articles; data.words = words;
  }
  function model(key) {
    const id=key.startsWith('original/')?'original':key.split('/')[0];
    const raw=id==='original'?originalSource():rawEffective().find(r=>r.payload.id===id)?.payload;
    const edit=extra().edits[id], payload=edit?.payload || raw;
    if(!payload)return null;
    const index=id==='original'?Number(key.split('/')[1])-1:payload.articles.findIndex(a=>`${id}/${a.id}`===key);
    return index<0?null:{sourceId:id,payload:StudyWorkspaceCore.clone(payload),baseHash:raw?StudyWorkspaceCore.hash(raw):null,index,conflict:!!edit && (!raw || edit.baseHash!==StudyWorkspaceCore.hash(raw))};
  }
  async function saveRevision(id,payload) {
    const result=StudyPack.validate(payload);if(!result.ok)throw new Error(result.errors.join('；'));
    if(id==='original' && (payload.id!=='original-baseline' || payload.articles.length!==25 || payload.articles.some((a,i)=>a.id!==`article-${String(i+1).padStart(2,'0')}`)))throw new Error('原始资料修订需保留 25 篇文章及其原 ID。');
    const x=extra(), old=x.edits[id], raw=id==='original'?originalSource():rawEffective().find(r=>r.payload.id===id)?.payload;
    x.editUndo={sourceId:id,edit:old||null};
    x.edits[id]={payload:StudyWorkspaceCore.clone(payload),baseHash:old?.baseHash || (raw?StudyWorkspaceCore.hash(raw):null),at:new Date().toISOString()};
    window.StudyState.set('extra',x);await window.StudyState.flush();changed();
  }
  async function resetRevision(id,undo=false) {
    const x=extra();if(undo){if(x.editUndo?.sourceId!==id)throw new Error('没有可撤销的修订');const previous=x.editUndo.edit;delete x.editUndo;if(previous)x.edits[id]=previous;else delete x.edits[id];}
    else {x.editUndo={sourceId:id,edit:x.edits[id]||null};delete x.edits[id];}
    window.StudyState.set('extra',x);await window.StudyState.flush();changed();
  }
  async function open(base) {
    original = base; data = {...base}; db = await openDB();
    if (db) {
      try {
        const records = await transaction('readonly',store=>store.getAll());
        records.forEach(record=>{
          const result = StudyPack.validate(record.payload);
          if (!result.ok) { storageStatus = '部分旧资料格式无效，未加载；可重新导入。'; return; }
          (record.source==='local'?local:published).set(record.payload.id,{...record,compiled:result.compiled});
        });
      } catch { storageStatus = '本机缓存读取失败，仍可阅读原始资料。'; }
    } else storageStatus = '浏览器未允许本机保存。导入只能用于本次打开，请保留 JSON 文件。';
    rebuild(); return data;
  }
  const entries = () => effective().filter(r=>r.payload.id!=='original-baseline').map(r=>({id:r.payload.id,title:r.payload.title,date:r.payload.date,source:r.source,articles:r.compiled.articles.length,words:r.payload.words.length,used:r.payload.words.length-r.compiled.unused.length,override:r.source==='local'&&published.has(r.payload.id)}));
  function renderManager() {
    $('publishedStatus').textContent = status;
    $('storageStatus').textContent = storageStatus;
    $('storageStatus').hidden = !storageStatus;
    $('refreshPublished').disabled = busy;
    $('packageList').innerHTML = entries().map(r=>`<div class="package-card"><div><h4>${escape(r.title)}</h4><p>${escape(r.date)} · ${r.articles} 篇 · ${r.used}/${r.words} 词覆盖</p><small>${r.source==='local'?(r.override?'本机版本 · 同 ID 已有发布':'本机导入'):'已发布 · 所有设备可读'}</small></div><div class="package-actions"><button class="text-button" data-open-pack="${escape(r.id)}">阅读</button><button class="text-button" data-export-pack="${escape(r.id)}">导出</button>${r.source==='local'?`<button class="text-button" data-remove-pack="${escape(r.id)}">${removePending===r.id?'确认移除':'移除本机版本'}</button>`:''}</div></div>`).join('') || '<p class="manager-empty">还没有新增资料。原始 25 篇文章一直可读。</p>';
  }
  function changed() { hooks?.beforeChange(); rebuild(); hooks?.onChange(); renderManager(); }
  async function fetchJSON(url) {
    const response = await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    if (source.length > 10000000) throw new Error('文件超过 10 MB 文本限制');
    return source;
  }
  async function refresh() {
    if (busy) return;
    busy = true; status = '正在检查已发布资料…'; renderManager();
    try {
      const catalog = JSON.parse(await fetchJSON(`packages/index.json?t=${Date.now()}`));
      if (!Array.isArray(catalog.files) || catalog.files.length > 1000) throw new Error('目录格式无效');
      const records = [], issues = [], ids = new Set();
      const base = new URL('./',location.href), root = new URL('packages/',base);
      for (const file of catalog.files) {
        if (!file || typeof file.path !== 'string') { issues.push('目录包含无效条目'); continue; }
        const url = new URL(file.path,base);
        if (url.origin !== base.origin || !url.pathname.startsWith(root.pathname) || !url.pathname.endsWith('.json') || url.pathname === `${root.pathname}index.json`) { issues.push('目录包含无效路径'); continue; }
        const cached = [...published.values()].find(r=>r.path===file.path);
        if (cached && cached.updated===file.updated) {
          if (ids.has(cached.payload.id)) issues.push(`资料包 ID ${cached.payload.id} 重复，请保留一个文件`);
          else { records.push(cached); ids.add(cached.payload.id); }
          continue;
        }
        try {
          url.searchParams.set('v',file.updated || '1');
          const source = await fetchJSON(url.href), result = StudyPack.parse(source);
          if (!result.ok) throw new Error(result.errors[0]);
          const payload = JSON.parse(source.replace(/^\uFEFF/,''));
          if (ids.has(payload.id)) throw new Error(`资料包 ID ${payload.id} 重复，请保留一个文件`);
          ids.add(payload.id);
          records.push({key:`published:${payload.id}`,source:'published',payload,compiled:result.compiled,path:file.path,updated:file.updated});
        } catch (e) { issues.push(`${url.pathname.split('/').at(-1)}：${e.message}`); if (cached && !ids.has(cached.payload.id)) { records.push(cached); ids.add(cached.payload.id); } }
      }
      if (db) {
        try {
          await transaction('readwrite',store=>{ published.forEach(r=>store.delete(r.key)); records.forEach(({compiled,...r})=>store.put(r)); });
        } catch { storageStatus = '已发布资料可读，但浏览器未能保存离线缓存。'; }
      }
      const before = JSON.stringify([...published.values()].map(r=>[r.payload.id,r.path,r.updated]));
      const after = JSON.stringify(records.map(r=>[r.payload.id,r.path,r.updated]));
      published.clear(); records.forEach(r=>published.set(r.payload.id,r));
      status = issues.length ? `有 ${issues.length} 份资料未更新，保留上次有效版本（如有）。${issues.slice(0,3).join('；')}` : `已检查发布目录 · ${published.size} 份新增资料`;
      if (before!==after) changed();
    } catch (e) { status = `暂时无法检查发布目录（${e.message}）。已缓存的资料仍可读，也可本机导入。`; }
    finally { busy = false; renderManager(); }
  }
  function preview(source) {
    draft = null;
    const result = StudyPack.parse(source), box = $('importPreview');
    box.hidden = false;
    $('confirmImport').disabled = !result.ok;
    if (!result.ok) { box.innerHTML = `<h3>请修正后重新导入</h3><ul>${result.errors.map(e=>`<li>${escape(e)}</li>`).join('')}</ul>`; return; }
    const payload = JSON.parse(source.replace(/^\uFEFF/,''));
    draft = {payload,result};
    const duplicate = local.has(payload.id) || published.has(payload.id) || payload.id==='original-baseline';
    $('confirmImport').textContent = db ? (duplicate?'更新本机版本':'确认导入到本机') : '本次打开使用（无法保存）';
    const s = result.summary, first = result.compiled.articles[0];
    box.innerHTML = `<h3>${escape(payload.title)}</h3><p>${s.articles} 篇文章 · ${s.words} 个目标词 · 覆盖 ${s.used} 词${s.unused?` · ${s.unused} 词注明未用原因`:''}</p>${payload.id==='original-baseline'?'<p class="import-notice">这是原始 25 篇的修订文件；确认后保留原文章关联并使用此版本。</p>':''}${duplicate?'<p class="import-notice">同 ID 资料已存在。这次确认将保存为本机版本，仅当前浏览器生效；移除本机版本后会恢复已发布版本（如有）。</p>':''}${result.warnings.map(w=>`<p class="import-notice">${escape(w)}</p>`).join('')}<h4 lang="en">${escape(first.title)}</h4><p class="preview-english" lang="en">${escape(first.plain[0])}</p><p class="settings-note">已检查格式、段落对应、用词位置和覆盖记录。词义是否与词表一致、表达是否自然，仍需核查。</p>`;
  }
  function download(payload) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = `${payload.id}.json`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function attach(callbacks) {
    hooks = callbacks;
    $('importButton').addEventListener('click',()=>{ hooks.closeAux(); removePending = null; renderManager(); $('libraryDialog').showModal(); });
    $('packFile').addEventListener('change',async e=>{
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 10*1024*1024) { preview(''); $('importPreview').textContent = '文件超过 10 MB，请拆分成多个资料包。'; return; }
      try { preview(await file.text()); } catch { preview(''); $('importPreview').textContent = '无法读取这个文件，请重新选择。'; }
    });
    $('previewPasted').addEventListener('click',()=>preview($('packPaste').value));
    $('confirmImport').addEventListener('click',async()=>{
      if (!draft) return;
      const {payload,result} = draft, record = {key:`local:${payload.id}`,source:'local',payload,compiled:result.compiled};
      $('confirmImport').disabled = true;
      try {
        if (db) { const {compiled,...stored} = record; await transaction('readwrite',store=>store.put(stored)); }
        local.set(payload.id,record); changed();
        draft = null; $('packFile').value = ''; $('packPaste').value = ''; $('importPreview').hidden = true;
        $('libraryDialog').close(); hooks.select(payload.id);
        hooks.toast(db?'资料已保存到当前浏览器':'资料仅用于本次打开，请保留 JSON 文件');
      } catch { $('confirmImport').disabled = false; hooks.toast('保存失败，未替换原资料。请保留 JSON 文件后重试。'); }
    });
    $('refreshPublished').addEventListener('click',refresh);
    $('packageList').addEventListener('click',async e=>{
      const open = e.target.closest('[data-open-pack]');
      if (open) { $('libraryDialog').close(); hooks.select(open.dataset.openPack); return; }
      const exported = e.target.closest('[data-export-pack]');
      if (exported) { download(effective().find(r=>r.payload.id===exported.dataset.exportPack).payload); return; }
      const remove = e.target.closest('[data-remove-pack]');
      if (!remove) return;
      const id = remove.dataset.removePack;
      if (removePending !== id) { removePending = id; renderManager(); return; }
      try {
        if (db) await transaction('readwrite',store=>store.delete(`local:${id}`));
        local.delete(id); removePending = null; changed(); hooks.toast('本机版本已移除；原始和已发布资料仍保留');
      } catch { hooks.toast('移除失败，请重试'); }
    });
    renderManager(); refresh();
  }
  return {open,attach,entries,model,saveRevision,resetRevision,payloads:()=>rawEffective().map(r=>StudyWorkspaceCore.clone(r.payload))};
})();
