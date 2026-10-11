/* Build isolated UI previews using public repository files only. Never publishes live. */
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..');
function build(output=path.join(repo,'.reader-v2-preview')){
  const index=fs.readFileSync(path.join(repo,'index.html'),'utf8'),publicDir=path.join(output,'public');
  const scripts=[...index.matchAll(/<script defer src="([^"?]+)(?:\?[^"\n]*)?"><\/script>/g)].map(m=>m[1]);
  const styles=[...index.matchAll(/<link rel="stylesheet" href="([^"?]+)(?:\?[^"\n]*)?">/g)].map(m=>m[1]);
  const support=['index.html','service-worker.js','packages/index.json','docs/firebase-setup.md','downloads/pack-template.json','downloads/article-generation-prompt.txt','downloads/article-generation-prompt.md'];
  const files=[...new Set([...support,...styles,...scripts])];
  // Validate everything before creating output. No pack exports or browser profiles are read.
  for(const file of files)if(!fs.statSync(path.join(repo,file)).isFile())throw Error('Missing public asset: '+file);
  fs.mkdirSync(publicDir,{recursive:true});
  for(const file of files){const target=path.join(publicDir,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);}
  fs.writeFileSync(path.join(publicDir,'firebase-config.js'),'window.ENGLISH_STUDY_FIREBASE=null;\n');
  fs.writeFileSync(path.join(publicDir,'packages/index.json'),JSON.stringify({files:[]}));
  const config=path.join(output,'firebase.json');
  fs.writeFileSync(config,JSON.stringify({hosting:{site:'wowlin-english-study',public:'public',ignore:['**/.*','**/node_modules/**']}},null,2));
  const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
  const assets=Object.fromEntries(support.filter(p=>p.startsWith('downloads/')||p.startsWith('docs/')).map(p=>[p,fs.readFileSync(path.join(repo,p),'utf8')]));
  const bootstrap=`window.StudyEntryHash=location.hash;const previewAssets=${JSON.stringify(assets)};const nativeFetch=window.fetch.bind(window);window.fetch=(url,options)=>String(url).includes('packages/index.json')?Promise.resolve(new Response(JSON.stringify({files:[]}),{headers:{'Content-Type':'application/json'}})):nativeFetch(url,options);document.addEventListener('DOMContentLoaded',()=>{for(const a of document.querySelectorAll('a[href]')){const file=a.getAttribute('href');if(previewAssets[file]!==undefined)a.href=URL.createObjectURL(new Blob([previewAssets[file]],{type:file.endsWith('.json')?'application/json':'text/plain;charset=utf-8'}));}document.querySelector('#cloudDialog .settings-note').textContent='这是独立界面预览，云同步未启用。不会读取正式网站或云端的学习资料。';});`;
  const offline=`window.StudyOffline={describe(){document.querySelector('#offlineDetail').textContent='这是独立单文件预览，可直接离线打开。正式网站的缓存更新请在网站中操作。';},async prepare(){this.describe();},async update(){this.describe();}};`;
  let portable=index.replace(/<script defer src="[^"\n]+"><\/script>\n?/g,'').replace(/<link rel="stylesheet" href="[^"\n]+">/g,'');
  // Separate local data even when opened as file:// next to another local study copy.
  portable=portable.replaceAll('english-study.','english-study-v2-preview.');
  const css=styles.map(p=>fs.readFileSync(path.join(repo,p),'utf8')).join('\n');
  const js=scripts.map(p=>p==='firebase-config.js'?'window.ENGLISH_STUDY_FIREBASE=null;':p==='offline.js'?offline:fs.readFileSync(path.join(repo,p),'utf8').replaceAll('english-study.','english-study-v2-preview.')).map(s=>'<script>'+escapeScript(s)+'</script>').join('\n');
  portable=portable.replace('</head>','<style>'+css+'</style></head>').replace('</body>','<script>'+escapeScript(bootstrap)+'</script>\n'+js+'\n</body>');
  const single=path.join(output,'English-Study-V2-preview.html');fs.writeFileSync(single,portable);
  return {publicDir,config,single,files:files.length};
}
module.exports={build};
if(require.main===module)console.log(JSON.stringify(build(process.argv[2]?path.resolve(process.argv[2]):undefined),null,2));
