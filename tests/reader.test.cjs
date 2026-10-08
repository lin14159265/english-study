const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const article=(id,key=`original/${id}`)=>({id,key,batch:key.split('/')[0],batchTitle:'test',title:`Article ${id}`,zhTitle:'测试',paragraphs:['Text.'],plain:['Text.'],translations:['测试。'],words:[],wordCount:1});
function node(){const events={};return {events,value:'all',options:[],dataset:{},style:{},hidden:false,inert:false,innerHTML:'',textContent:'',classList:{toggle(){},contains(){return false;},add(){},remove(){}},setAttribute(){},removeAttribute(){},querySelector:()=>node(),querySelectorAll:()=>[],addEventListener:(n,f)=>events[n]=f,focus(){},scrollIntoView(){}};}
// Execute the actual reader with a minimal DOM, deterministic timers and storage.
// This verifies orchestration, not actual browser layout/IndexedDB behaviour.
async function reader(raw={},hash=''){
 const nodes={},listeners={},documentEvents={},writes=[],timers=new Map();let timerId=0,hooks,stored=clone(raw),learningReloads=0;
 const data={articles:Array.from({length:25},(_,i)=>article(i+1)),words:{}},ui=new Proxy({count:()=>0,reloadState:()=>learningReloads++},{get:(t,k)=>t[k]||(()=>{})});
 const library={open:async()=>data,entries:()=>[],attach:h=>hooks=h,reload:async()=>hooks.onChange({external:true})};
 const S={open:async()=>{},get:()=>clone(stored),set:(k,v)=>{stored=clone(v);writes.push(clone(v));return true;},flush:async()=>{}};
 const context={window:null,document:{getElementById:id=>nodes[id]||(nodes[id]=node()),querySelector:()=>node(),querySelectorAll:()=>[],addEventListener:(n,f)=>documentEvents[n]=f,documentElement:{dataset:{},style:{setProperty(){}}},body:node()},StudyState:S,StudyLibrary:library,StudyLearning:{create:()=>ui},StudyWorkspace:{create:()=>ui},StudyExperience:{create:()=>ui},READING_DATA:data,location:{hash},history:{replaceState(_a,_b,h){context.location.hash=h;},pushState(_a,_b,h){context.location.hash=h;}},getComputedStyle:()=>({getPropertyValue:()=>''}),matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,scrollY:0,requestAnimationFrame:fn=>context.setTimeout(fn,0),setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id),addEventListener:(n,f)=>(listeners[n]??=[]).push(f),scrollTo(_x,y){context.scrollY=y;}};context.window=context;
 function runTimers(limit=0){for(let count=0;count<100;count++){const entry=[...timers].find(([,t])=>t.delay<=limit);if(!entry)return;timers.delete(entry[0]);entry[1].fn();}throw Error('timer loop');}
 await vm.runInNewContext(fs.readFileSync(__dirname+'/../reader.js','utf8'),context);runTimers();
 return {context,nodes,data,writes,runTimers,emit:(event)=>listeners[event]?.forEach(f=>f()),saved:()=>clone(stored),change:fn=>{hooks.beforeChange();fn(data);hooks.onChange();runTimers();},remote:async raw=>{stored=clone(raw);documentEvents['study-state-reloaded']({detail:{}});await Promise.resolve();runTimers();},learningReloads:()=>learningReloads};
}
const missing=()=>({currentKey:'late/story',readKeys:['original/7','late/story'],positionKeys:{'original/7':1321,'late/story':900},review:['late::word'],futureField:{preserve:true}});
test('missing article keys, read marks, positions and unknown reader fields survive startup and fallback scroll',async()=>{
 const r=await reader(missing());assert.equal(r.saved().currentKey,'late/story');assert.deepEqual(r.saved().readKeys,missing().readKeys);assert.deepEqual(r.saved().positionKeys,missing().positionKeys);assert.deepEqual(r.saved().review,['late::word']);assert.deepEqual(r.saved().futureField,{preserve:true});
 r.context.scrollY=345;r.emit('scroll');r.runTimers(200);r.emit('pagehide');assert.deepEqual(r.saved().positionKeys,missing().positionKeys);assert.equal(r.saved().currentKey,'late/story');assert.equal(r.context.location.hash,'');
});
test('delayed articles recover the retained current key, read mark and position after async library change',async()=>{
 const r=await reader(missing());r.change(data=>data.articles.push(article(26,'late/story')));assert.equal(r.nodes.articleTitle.textContent,'Article 26');assert.equal(r.context.scrollY,900);assert.ok(r.saved().read.includes(26));assert.equal(r.saved().positionKeys['late/story'],900);assert.equal(r.context.location.hash,'#read=late%2Fstory');
});
test('a missing direct stable link remains pending until its article loads',async()=>{
 const r=await reader({currentKey:'original/7',positionKeys:{'late/story':456}},'#read=late%2Fstory');assert.equal(r.saved().currentKey,'late/story');assert.equal(r.saved().resumeKey,'original/7');assert.equal(r.context.location.hash,'#read=late%2Fstory');
 r.change(data=>data.articles.push(article(26,'late/story')));assert.equal(r.context.scrollY,456);assert.equal(r.nodes.articleTitle.textContent,'Article 26');
});
test('fixed legacy links still open their article without deleting prior article records',async()=>{
 const r=await reader(missing(),'#article-02');assert.equal(r.nodes.articleTitle.textContent,'Article 2');assert.equal(r.saved().currentKey,'original/2');assert.equal(r.saved().resumeKey,'late/story');assert.deepEqual(r.saved().positionKeys,missing().positionKeys);assert.equal(r.context.location.hash,'#article-02');
});
test('a fixed link to the displayed fallback explicitly replaces a pending missing navigation target',async()=>{
 const r=await reader(missing());r.context.location.hash='#article-01';r.emit('hashchange');r.runTimers();assert.equal(r.saved().currentKey,'original/1');r.change(data=>data.articles.push(article(26,'late/story')));assert.equal(r.saved().currentKey,'original/1');assert.equal(r.nodes.articleTitle.textContent,'Article 1');assert.equal(r.saved().positionKeys['late/story'],900);
});
test('translation links do not replace a saved reading position with startup zero',async()=>{
 const r=await reader({currentKey:'original/7',positionKeys:{'original/2':876}},'#zh-02');assert.equal(r.saved().positionKeys['original/2'],876);assert.equal(r.nodes['panel-translation'].hidden,false);
});
test('legacy numeric progress migrates into stable keys and retains numeric compatibility',async()=>{
 const r=await reader({current:7,read:[2,7],positions:{7:1321}});assert.equal(r.saved().currentKey,'original/7');assert.deepEqual(r.saved().readKeys,['original/2','original/7']);assert.equal(r.saved().positionKeys['original/7'],1321);assert.equal(r.saved().positions['7'],1321);assert.equal(r.context.scrollY,1321);
});
test('marking and cancelling a visible article keeps unavailable read marks',async()=>{
 const r=await reader(missing(),'#article-02');await r.nodes.readButton.events.click();assert.deepEqual(r.saved().readKeys,['original/7','late/story','original/2']);await r.nodes.readButton.events.click();assert.deepEqual(r.saved().readKeys,['original/7','late/story']);
});
test('removing and re-adding a source retains progress instead of moving it to a fallback article',async()=>{
 const r=await reader(missing());r.change(data=>data.articles.push(article(26,'late/story')));r.change(data=>data.articles.pop());assert.equal(r.saved().currentKey,'late/story');assert.equal(r.saved().positionKeys['late/story'],900);r.change(data=>data.articles.push(article(26,'late/story')));assert.equal(r.context.scrollY,900);assert.ok(r.saved().read.includes(26));
});
test('reordered imported articles project saved stable keys onto their new IDs',async()=>{
 const r=await reader(missing());r.change(data=>{data.articles.push(article(26,'other/story'),article(27,'late/story'));});assert.equal(r.saved().positions['27'],900);r.change(data=>{data.articles.splice(25,1);data.articles[25].id=26;});assert.equal(r.saved().positions['26'],900);assert.ok(r.saved().read.includes(26));assert.equal(r.saved().positionKeys['late/story'],900);
});
test('clean external refresh updates cached learning and read marks without a write echo or scroll jump',async()=>{
 const r=await reader({currentKey:'original/7',readKeys:[],positionKeys:{'original/7':100},review:['old::word'],oldExtension:true}),before=r.writes.length;r.context.scrollY=800;
 await r.remote({currentKey:'original/2',readKeys:['original/2','late/story'],positionKeys:{'original/7':333,'late/story':444},settings:{theme:'dark'}});
 assert.equal(r.writes.length,before);assert.equal(r.learningReloads(),1);assert.equal(r.nodes.articleTitle.textContent,'Article 7');assert.equal(r.context.scrollY,800);assert.equal(r.context.document.documentElement.dataset.theme,'dark');
 r.emit('scroll');r.runTimers(200);assert.deepEqual(r.saved().readKeys,['original/2','late/story']);assert.equal(r.saved().positionKeys['late/story'],444);assert.equal(r.saved().positionKeys['original/7'],800);assert.deepEqual(r.saved().review,[]);assert.equal(r.saved().oldExtension,undefined);
});
test('learning cache refresh uses the new legacy list instead of resurrecting removed favorites',()=>{
 const L=require('../learning-core'),P=require('../package-core'),content={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),content);
 const data=content.window.READING_DATA;data.articles=data.articles.map(a=>({...a,key:'original/'+a.id}));const word=Object.keys(data.words).find(k=>data.words[k].uses.length),nodes={},value={reader:{review:[word]},learning:L.empty()},writes=[];
 const ctx={window:{StudyLearningCore:L,StudyPack:P,StudyState:{get:k=>value[k],set:(k,v)=>{value[k]=clone(v);writes.push(k);},flush:async()=>{}}},document:{getElementById:id=>nodes[id]||(nodes[id]=node())}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../learning.js','utf8'),ctx);const ui=ctx.window.StudyLearning.create({data,current:()=>data.articles[0],legacy:[word],toast(){},changed(){},questionCount:()=>0,removedQuestionCount:()=>0});assert.equal(value.learning.cards.length,1);
 value.reader.review=[];value.learning=L.empty();value.learning.guessMode=false;ui.reloadState();ui.libraryChanged();assert.equal(value.learning.cards.length,0);assert.equal(writes.length,1);assert.equal(nodes.guessMode.checked,false);
});
