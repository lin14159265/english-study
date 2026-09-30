/* Shared, dependency-free JSON validation and safe rendering. Also used by Node checks. */
(function (root) {
  'use strict';
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const slug = s => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(s);
  const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  const wordPattern = /^[a-zA-Z]+(?:[ '-][a-zA-Z]+)*$/;
  function matches(en, form) {
    const pattern = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(pattern, 'gi'), out = [];
    let m;
    while ((m = re.exec(en))) {
      const start = m.index, end = start + m[0].length;
      if (!/[a-zA-Z]/.test(en[start - 1] || '') && !/[a-zA-Z]/.test(en[end] || '')) out.push({start,end,form:m[0]});
    }
    return out;
  }
  function validate(input) {
    const errors = [], warnings = [];
    const fail = message => { if (errors.length < 40) errors.push(message); };
    if (!object(input)) return {ok:false,errors:['资料包必须是一个 JSON 对象。'],warnings};
    if (input.format !== 'english-study-pack' || input.version !== 1) fail('format 必须为 english-study-pack，version 必须为数字 1。');
    if (!slug(input.id) || input.id === 'original') fail('资料包 id 请使用小写字母、数字和短横线（1–80 字符，不能为 original）。');
    if (!text(input.title,200)) fail('资料包 title 必须是非空标题（最多 200 字符）。');
    if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0,10) !== input.date) fail('date 必须是有效的 YYYY-MM-DD 日期。');
    if (!Array.isArray(input.words) || input.words.length < 1 || input.words.length > 5000) fail('words 需包含 1–5000 个目标词。');
    if (!Array.isArray(input.articles) || input.articles.length < 1 || input.articles.length > 100) fail('articles 需包含 1–100 篇文章。');
    if (errors.length) return {ok:false,errors,warnings};
    if (input.sourceCount !== input.words.length) fail(`sourceCount 必须等于去重后的目标词数量（当前为 ${input.words.length}）。`);
    const words = Object.create(null), articles = [], ids = new Set();
    input.words.forEach((w,i) => {
      const label = `words[${i}]`;
      if (!object(w) || !text(w.word,80) || !wordPattern.test(w.word) || w.word !== w.word.trim()) { fail(`${label}.word 需为英文单词或短语。`); return; }
      const lemma = w.word.toLowerCase();
      if (words[lemma]) { fail(`目标词 ${w.word} 重复，请合并原词表的全部义项后保留一条。`); return; }
      if (!text(w.allowed,2000)) fail(`${w.word} 缺少原词表允许义项 allowed。`);
      if (w.omission !== undefined && (typeof w.omission !== 'string' || w.omission.length > 2000)) fail(`${w.word} 的 omission 必须是字符串。`);
      words[lemma] = {id:i+1,word:w.word,allowed:w.allowed,omission:w.omission || '',uses:[]};
    });
    input.articles.forEach((a,ai) => {
      const label = `第 ${ai+1} 篇文章`;
      if (!object(a)) { fail(`${label} 必须是对象。`); return; }
      if (!slug(a.id) || ids.has(a.id)) fail(`${label} 的 id 格式错误或在本资料包内重复。`);
      ids.add(a.id);
      if (!text(a.title,200) || !text(a.zhTitle,200)) fail(`${label} 需有英文 title 和中文 zhTitle。`);
      if (!Array.isArray(a.paragraphs) || !a.paragraphs.length || a.paragraphs.length > 100) { fail(`${label} 需有 1–100 个段落。`); return; }
      const plain = [], translations = [], spans = a.paragraphs.map(()=>[]);
      a.paragraphs.forEach((p,pi) => {
        if (!object(p) || !text(p.en,20000) || !text(p.zh,20000)) { fail(`${label} 第 ${pi+1} 段必须同时有非空 en 和 zh。`); plain.push(''); translations.push(''); return; }
        if (/<\/?[a-z][^>]*>/i.test(p.en) || /\*\*/.test(p.en)) fail(`${label} 第 ${pi+1} 段 en 必须是纯文本，不要 HTML 或 **加粗标记**。`);
        plain.push(p.en); translations.push(p.zh);
      });
      if (!Array.isArray(a.uses) || a.uses.length > 10000) { fail(`${label} uses 必须是用词记录数组（最多 10000 条）。`); return; }
      a.uses.forEach((u,ui) => {
        const where = `${label} uses[${ui}]`;
        if (!object(u) || typeof u.word !== 'string' || !words[u.word.toLowerCase()]) { fail(`${where} 引用了词表中不存在的目标词。`); return; }
        const lemma = u.word.toLowerCase(), occurrence = u.occurrence === undefined ? 1 : u.occurrence;
        if (!Number.isInteger(u.paragraph) || u.paragraph < 1 || u.paragraph > plain.length) { fail(`${where} paragraph 从 1 开始，且必须指向本篇段落。`); return; }
        if (!text(u.form,80) || !wordPattern.test(u.form) || !text(u.sense,1000) || !Number.isInteger(occurrence) || occurrence < 1) { fail(`${where} 需有实际词形 form、中文用义 sense 和正整数 occurrence。`); return; }
        const pi = u.paragraph - 1, match = matches(plain[pi],u.form)[occurrence-1];
        if (!match) { fail(`${where} 在第 ${u.paragraph} 段找不到 ${u.form} 的第 ${occurrence} 次完整出现。`); return; }
        if (spans[pi].some(s=>match.start < s.end && match.end > s.start)) { fail(`${where} 与另一条用词记录重复或重叠。`); return; }
        const uid = `${a.id}:${pi}:${match.start}`;
        spans[pi].push({...match,lemma,uid});
        words[lemma].uses.push({article:ai+1,paragraph:pi,form:match.form,sense:u.sense,uid});
      });
      const seen = new Set(), paragraphWords = [];
      const paragraphs = plain.map((p,pi) => {
        let result = '', cursor = 0;
        const keys = [];
        spans[pi].sort((a,b)=>a.start-b.start).forEach(s => {
          const key = `${input.id}::${s.lemma}`, first = !seen.has(key);
          const tag = first ? 'strong' : 'span';
          result += escape(p.slice(cursor,s.start));
          result += `<${tag} class="target${first?'':' target-repeat'}" tabindex="0" role="button" data-word="${escape(key)}" data-use="${escape(s.uid)}" aria-label="查看 ${escape(words[s.lemma].word)} 的本篇用义">${escape(p.slice(s.start,s.end))}</${tag}>`;
          cursor = s.end; seen.add(key); if (!keys.includes(key)) keys.push(key);
        });
        paragraphWords.push(keys);
        return result + escape(p.slice(cursor));
      });
      articles.push({id:ai+1,key:`${input.id}/${a.id}`,batch:input.id,batchTitle:input.title,title:a.title,zhTitle:a.zhTitle,paragraphs,plain,translations,words:[...seen],paragraphWords,wordCount:plain.join(' ').match(/\b[a-zA-Z]+(?:['’-][a-zA-Z]+)*\b/g)?.length || 0});
    });
    const unused = [];
    Object.values(words).forEach(w=>{
      if (!w.uses.length) {
        unused.push(w.word);
        if (!w.omission.trim()) fail(`${w.word} 未用于正文，请补用词记录，或在 omission 中说明未使用原因。`);
      } else if (w.omission.trim()) fail(`${w.word} 已在正文使用，请删除冲突的 omission 原因。`);
    });
    if (unused.length) warnings.push(`${unused.length} 个目标词未用于正文，已保留原因：${unused.slice(0,8).join('、')}${unused.length>8?'…':''}。`);
    const scoped = Object.create(null);
    Object.entries(words).forEach(([lemma,w])=>scoped[`${input.id}::${lemma}`]=w);
    return {ok:!errors.length,errors,warnings,compiled:{id:input.id,title:input.title,date:input.date,articles,words:scoped,unused},summary:{articles:articles.length,words:input.words.length,used:input.words.length-unused.length,unused:unused.length}};
  }
  function parse(source) {
    if (typeof source !== 'string' || source.length > 10000000) return {ok:false,errors:['资料包超过 10 MB 文本限制，请拆分批次。'],warnings:[]};
    try { return validate(JSON.parse(source.replace(/^\uFEFF/,''))); }
    catch { return {ok:false,errors:['JSON 格式错误。请使用 AI 导出的 .json 文件；不要包含代码围栏、注释或省略号。'],warnings:[]}; }
  }
  const api = {validate,parse,matches,escape};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudyPack = api;
})(typeof window !== 'undefined' ? window : globalThis);
