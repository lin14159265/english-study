const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../workspace-core'),L=require('../learning-core'),E=require('../experience-core'),P=require('../package-core'),T=require('../tools-core');
const clone=x=>JSON.parse(JSON.stringify(x));
function setup(){
 const nodes=new Map(),writes=[],messages=[],content={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),content);
 const payload=JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8')),data=P.validate(payload).compiled;
 const state={reader:{currentKey:data.articles[0].key},learning:L.empty(),extra:C.emptyExtra()};
 function node(id){if(nodes.has(id))return nodes.get(id);const events={},children=new Map(),n={id,events,value:'',hidden:false,disabled:false,checked:false,open:false,dataset:{},innerHTML:'',textContent:'',style:{},classList:{contains:()=>false},setAttribute(){},focus(){},remove(){},insertAdjacentHTML(){},showModal(){this.open=true;},close(){this.open=false;},querySelector:s=>{if(!children.has(s))children.set(s,node(id+' '+s));return children.get(s);},querySelectorAll:()=>[],addEventListener:(event,fn)=>(events[event]??=[]).push(fn)};nodes.set(id,n);return n;}
 const S={get:(k,fallback)=>state[k]??fallback,set:(k,v)=>{state[k]=clone(v);writes.push(k);return true;},flush:async()=>{},status:()=>({phase:'saved'})};
 node('restoreMode').value='merge';node('restorePreference').value='current';
 const context={window:null,READING_DATA:content.window.READING_DATA,StudyWorkspaceCore:C,StudyLearningCore:L,StudyExperienceCore:E,StudyPack:P,StudyToolsCore:T,StudyState:S,
  StudyLibrary:{payloads:()=>[clone(payload)],entries:()=>[],model:key=>key===data.articles[0].key?{key,sourceId:payload.id,payload:clone(payload),index:0,baseHash:C.hash(payload)}:null},
  document:{body:node('body'),getElementById:node,querySelector:s=>s==='dialog[open]'?[...nodes.values()].find(n=>n.open):node(s),querySelectorAll:s=>s==='dialog[open]'?[...nodes.values()].filter(n=>n.open):[],addEventListener(){}},setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),URL,Blob};context.window=context;
 vm.runInNewContext(fs.readFileSync(__dirname+'/../workspace-ui.js','utf8'),context);
 const app={data,current:()=>data.articles[0],persist(){},toast:m=>messages.push(m),closeAux(){},navigate(){},selectedWord(){},saveCard(){},reviewChanged(){},markRead(){},refreshLearning(){},isRead:()=>false};
 const workspace=context.StudyWorkspace.create(app);context.StudyWorkspaceAPI=workspace;
 vm.runInNewContext(fs.readFileSync(__dirname+'/../experience-ui.js','utf8'),context);const experience=context.StudyExperience.create(app);context.StudyExperienceAPI=experience;
 async function fire(id,event,target={}){for(const fn of node(id).events[event]||[])await fn({target:{closest:()=>null,...target}});}
 function remote(extra){state.extra=clone(extra);(workspace.reloadState||workspace.changed)();(experience.reloadState||experience.changed)();}
 const key=Object.keys(data.words).find(k=>data.words[k].uses.length);state.learning.cards=[L.usage(data,key,data.words[key].uses[0])];
 return {state,data,payload,S,workspace,experience,node,fire,remote,writes,messages};
}
test('a completed foreign review cannot be resurrected by an already open round',async()=>{
 const r=setup();r.state.extra.reviewSession=E.buildRound(r.data,r.state.learning,r.state.extra);r.experience.openRound(true);
 const next=clone(r.state.extra),finished=next.reviewSession;E.recordResult(finished,{rating:'known'});next.reviewRounds.push(finished);next.reviewSession=null;r.remote(next);
 const before=r.writes.length;await r.fire('roundBody','input',{id:'roundGuess',value:'old answer'});
 assert.equal(r.state.extra.reviewSession,null);assert.equal(r.state.extra.reviewRounds.length,1);assert.equal(r.writes.length,before);assert.equal(r.node('roundBody').hidden,true);
});
test('an open round adopts the foreign draft before another local answer',async()=>{
 const r=setup();r.state.extra.reviewSession=E.buildRound(r.data,r.state.learning,r.state.extra);r.experience.openRound(true);
 const next=clone(r.state.extra);next.reviewSession.draft.guess='foreign answer';r.remote(next);assert.match(r.node('roundBody').innerHTML,/foreign answer/);
 await r.fire('roundBody','input',{id:'roundGuess',value:'new local answer'});assert.equal(r.state.extra.reviewSession.draft.guess,'new local answer');
});
test('a backup preview based on an earlier workspace cannot confirm after an external commit',async()=>{
 const r=setup(),backup={...r.workspace.snapshot(),state:{reader:{},learning:L.empty(),extra:C.emptyExtra()}};
 r.workspace.openBackup();r.node('backupPaste').value=JSON.stringify(backup);await r.fire('backupParse','click');
 assert.equal(r.node('restoreConfirm').disabled,false);r.remote({...r.state.extra,lastBackupAt:new Date().toISOString()});
 assert.equal(r.node('restoreConfirm').disabled,true);assert.match(r.node('restorePreview').textContent,/重新/);
 await r.fire('restoreMode','change');assert.equal(r.node('restoreConfirm').disabled,false);
});
test('a foreign quiz draft invalidates the old open answer cache without writing it back',async()=>{
 const r=setup();r.workspace.openQuiz();const question=r.data.articles[0].questions[0];await r.fire('quizBody','change',{dataset:{questionId:question.id},value:'a'});
 const next=clone(r.state.extra),key=Object.keys(next.quizDrafts)[0];next.quizDrafts[key].answers[question.id]='b';const before=r.writes.length;r.remote(next);
 assert.equal(r.node('quizDialog').open,false);await r.fire('quizBody','change',{dataset:{questionId:question.id},value:'c'});assert.equal(r.writes.length,before);assert.equal(r.state.extra.quizDrafts[key].answers[question.id],'b');
 r.workspace.openQuiz();assert.match(r.node('quizBody').innerHTML,/value="b" checked/);
});
test('unrelated foreign progress keeps an open quiz and its own saved answer',async()=>{
 const r=setup();r.workspace.openQuiz();const question=r.data.articles[0].questions[0];await r.fire('quizBody','change',{dataset:{questionId:question.id},value:'a'});
 const body=r.node('quizBody').innerHTML,before=r.writes.length;r.remote({...r.state.extra,lastBackupAt:new Date().toISOString()});
 assert.equal(r.node('quizDialog').open,true);assert.equal(r.node('quizBody').innerHTML,body);assert.equal(r.writes.length,before);
 await r.fire('quizBody','change',{dataset:{questionId:question.id},value:'b'});assert.equal(Object.values(r.state.extra.quizDrafts)[0].answers[question.id],'b');
});
test('an externally submitted quiz cannot reuse the old unsubmitted cache',async()=>{
 const r=setup();r.workspace.openQuiz();const q=r.data.articles[0].questions[0];await r.fire('quizBody','change',{dataset:{questionId:q.id},value:'a'});
 const next=clone(r.state.extra);next.quizDrafts={};next.quizAttempts.push({id:'foreign-attempt',articleKey:r.data.articles[0].key});const before=r.writes.length;r.remote(next);
 await r.fire('quizSubmit','click');assert.equal(r.node('quizDialog').open,false);assert.equal(r.state.extra.quizAttempts.length,1);assert.equal(r.writes.length,before);
});
test('a changed foreign editor draft closes the obsolete editor and remains available on reopening',()=>{
 const r=setup(),key=r.data.articles[0].key;r.workspace.openEditor();assert.equal(r.node('editorDialog').open,true);
 const next=clone(r.state.extra),payload=clone(r.payload);payload.articles[0].zhTitle='foreign title';next.editorDrafts[key]={payload,paragraphIndex:0,baseHash:C.hash(r.payload)};const before=r.writes.length;r.remote(next);
 assert.equal(r.node('editorDialog').open,false);assert.equal(r.writes.length,before);assert.equal(r.state.extra.editorDrafts[key].payload.articles[0].zhTitle,'foreign title');
 r.workspace.openEditor();assert.equal(r.node('editZhTitle').value,'foreign title');
});
test('unrelated progress preserves an editor with an already saved draft',()=>{
 const r=setup(),key=r.data.articles[0].key,payload=clone(r.payload);payload.articles[0].zhTitle='saved local draft';r.state.extra.editorDrafts[key]={payload,paragraphIndex:0,baseHash:C.hash(r.payload)};r.workspace.openEditor();
 r.remote({...r.state.extra,lastBackupAt:new Date().toISOString()});assert.equal(r.node('editorDialog').open,true);assert.equal(r.node('editZhTitle').value,'saved local draft');
});
test('unrelated progress keeps a revealed round intact without a write echo',async()=>{
 const r=setup();r.state.extra.reviewSession=E.buildRound(r.data,r.state.learning,r.state.extra);r.experience.openRound(true);
 await r.fire('roundBody','click',{closest:()=>({dataset:{},hasAttribute:k=>k==='data-round-reveal'})});const body=r.node('roundBody').innerHTML,before=r.writes.length;
 r.remote({...r.state.extra,lastBackupAt:new Date().toISOString()});assert.equal(r.node('roundBody').innerHTML,body);assert.equal(r.writes.length,before);assert.equal(r.node('roundDialog').open,true);
});
test('foreign deletion refreshes the open pending and lookup lists and obsolete rows cannot write',async()=>{
 const r=setup(),s=L.articleSentences(r.data.articles[0])[0];E.capture(r.state.extra,s);r.experience.openPending();assert.match(r.node('pendingList').innerHTML,/data-pending-id/);
 r.remote({...r.state.extra,pendingSentences:[]});assert.doesNotMatch(r.node('pendingList').innerHTML,/data-pending-id/);const before=r.writes.length;
 await r.fire('pendingList','input',{closest:()=>({dataset:{pendingId:s.id}})});assert.equal(r.writes.length,before);
 r.state.extra.lookupWords=[{id:'lookup',text:'measured',articleKey:s.articleKey,articleTitle:s.articleTitle,paragraph:0,context:s.en,note:'saved note'}];r.experience.openLookup('measured');assert.match(r.node('lookupSaved').innerHTML,/saved note/);
 r.remote({...r.state.extra,lookupWords:[]});assert.doesNotMatch(r.node('lookupSaved').innerHTML,/saved note/);await r.fire('lookupSaved','input',{closest:()=>({dataset:{lookupId:'lookup'}}),value:'obsolete note'});assert.equal(r.writes.length,before);
});
test('an old pending quiz submission cannot change a newly reopened quiz',async()=>{
 const r=setup();r.workspace.openQuiz();for(const q of r.data.articles[0].questions)await r.fire('quizBody','change',{dataset:{questionId:q.id},value:q.answer});
 const key=Object.keys(r.state.extra.quizDrafts)[0];let finish;r.S.flush=()=>new Promise(resolve=>finish=resolve);const pending=r.fire('quizSubmit','click');
 assert.equal(typeof finish,'function');const next=clone(r.state.extra);next.quizDrafts[key]={answers:{}};r.remote(next);r.workspace.openQuiz();const body=r.node('quizBody').innerHTML;
 finish();await pending;assert.equal(r.node('quizBody').innerHTML,body);assert.equal(r.node('quizSubmit').hidden,false);assert.equal(r.node('quizStatus').textContent,'');
});
