const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../workspace-core'),L=require('../learning-core');
const content={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),content);const base=C.originalPack(content.window.READING_DATA),pack=JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8'));
function fakeDatabase(){
 const stores=new Map([['packs',new Map()]]),state={fail:false,failRead:false,openedVersions:[]};
 const db={close(){},objectStoreNames:{contains:k=>stores.has(k)},createObjectStore:k=>stores.set(k,new Map()),transaction(names,mode){
  const active=new Map(names.map(n=>[n,new Map([...stores.get(n)].map(([k,v])=>[k,structuredClone(v)]))])),requests=[],tx={error:null,aborted:false,abort(){this.aborted=true;this.error=new Error('transaction aborted');},objectStore(n){const map=active.get(n);return {get(k){const q={};requests.push(()=>{q.result=structuredClone(map.get(k));q.onsuccess?.();});return q;},getAll(){const q={};requests.push(()=>{q.result=structuredClone([...map.values()]);q.onsuccess?.();});return q;},put(v){map.set(v.key,structuredClone(v));return {};},delete:k=>map.delete(k),clear:()=>map.clear()};}};
  setTimeout(()=>{if(mode==='readonly'&&state.failRead){state.failRead=false;tx.error=new Error('simulated read failure');tx.onabort?.();return;}if(mode==='readwrite'&&state.fail){state.fail=false;tx.error=new Error('simulated quota failure');tx.onabort?.();return;}requests.forEach(fn=>fn());if(tx.aborted){tx.onabort?.();return;}if(mode==='readwrite')for(const[n,m]of active)stores.set(n,m);tx.oncomplete?.();},0);return tx;
 }};
 return {stores,state,indexedDB:{open(name,version){state.openedVersions.push(version);const q={result:db};setTimeout(()=>{q.onupgradeneeded?.();q.onsuccess?.();},0);return q;}}};
}
async function setup(options={}){
 const f=options.database||fakeDatabase(),legacy=options.legacy||new Map([['english-study.reader.v1',JSON.stringify({readKeys:['original/1']})]]),events=[],windowEvents={};
 const ctx={window:{StudyWorkspaceCore:C,StudyLearningCore:L,addEventListener:(n,fn)=>windowEvents[n]=fn},indexedDB:options.noDatabase?{open(){throw Error('storage disabled');}}:f.indexedDB,localStorage:{getItem:k=>legacy.get(k),setItem:(k,v)=>legacy.set(k,v)},document:{dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},setTimeout,clearTimeout,...(options.BroadcastChannel?{BroadcastChannel:options.BroadcastChannel}:{}),...(options.Date?{Date:options.Date}:{})};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../workspace-store.js','utf8'),ctx);await ctx.window.StudyState.open();return {...f,S:ctx.window.StudyState,legacy,events,windowEvents};
}
function broadcastHub(){const pages=[];return {pages,BroadcastChannel:class{constructor(){pages.push(this);}postMessage(data){for(const page of pages)if(page!==this)queueMicrotask(()=>page.onmessage?.({data}));}}};}
const plain=x=>JSON.parse(JSON.stringify(x));

const incoming=()=>({format:'english-study-backup',version:1,base:C.clone(base),packs:[C.clone(pack)],state:{reader:{readKeys:['original/2'],settings:{theme:'dark'}},learning:L.empty(),extra:C.emptyExtra()}});
test('storage migrates legacy reader without deleting old keys',async()=>{const {S,legacy,stores}=await setup();assert.deepEqual(JSON.parse(JSON.stringify(S.get('reader').readKeys)),['original/1']);assert.ok(legacy.has('english-study.reader.v1'));assert.ok(stores.get('workspace').has('current'));});
test('failed restore transaction leaves source packages and current state intact',async()=>{const {S,state,stores}=await setup();const before=JSON.stringify(stores.get('workspace').get('current'));state.fail=true;await assert.rejects(S.restore(incoming(),base),/quota/);assert.equal(JSON.stringify(stores.get('workspace').get('current')),before);assert.equal(stores.get('packs').size,0);assert.deepEqual(JSON.parse(JSON.stringify(S.get('reader').readKeys)),['original/1']);assert.equal(stores.get('workspace').has('rollback'),false);});
test('successful restore and rollback atomically swap all packages state and legacy hints',async()=>{const {S,stores,legacy}=await setup();await S.restore(incoming(),base);assert.equal(stores.get('packs').size,1);assert.deepEqual(JSON.parse(JSON.stringify(S.get('reader').readKeys)),['original/2']);assert.ok(stores.get('workspace').has('rollback'));await S.rollback();assert.equal(stores.get('packs').size,0);assert.deepEqual(JSON.parse(JSON.stringify(S.get('reader').readKeys)),['original/1']);assert.deepEqual(JSON.parse(legacy.get('english-study.reader.v1')).readKeys,['original/1']);});
test('restore retains explicit original edits when backup baseline differs',async()=>{const {S}=await setup(),b=incoming();b.base.articles[0].zhTitle='旧基线';b.state.extra.edits.original={payload:C.clone(base),baseHash:C.hash(base)};b.state.extra.edits.original.payload.articles[0].zhTitle='明确修订';await S.restore(b,base);assert.equal(S.get('extra').edits.original.payload.articles[0].zhTitle,'明确修订');});
test('failed write never reports saved or updates legacy hints, and retry commits',async()=>{const {S,state,stores,legacy}=await setup(),before=JSON.stringify(stores.get('workspace').get('current'));state.fail=true;S.set('reader',{readKeys:['original/3']});assert.equal(S.status().phase,'saving');await assert.rejects(S.flush(),/quota/);assert.equal(S.status().phase,'error');assert.equal(JSON.stringify(stores.get('workspace').get('current')),before);assert.deepEqual(JSON.parse(legacy.get('english-study.reader.v1')).readKeys,['original/1']);await S.retry();assert.equal(S.status().phase,'saved');assert.deepEqual(JSON.parse(legacy.get('english-study.reader.v1')).readKeys,['original/3']);});
test('foreign committed head prevents stale page overwrite',async()=>{const {S,stores,legacy}=await setup(),saved=stores.get('workspace').get('current');saved.token='another-page';saved.data.reader={readKeys:['original/4']};S.set('reader',{readKeys:['original/5']});await assert.rejects(S.flush());assert.equal(S.status().phase,'conflict');assert.deepEqual(stores.get('workspace').get('current').data.reader.readKeys,['original/4']);assert.deepEqual(JSON.parse(legacy.get('english-study.reader.v1')).readKeys,['original/1']);});
test('batch quota failure adds no packages, successful retry writes both atomically',async()=>{const {S,state,stores}=await setup();state.fail=true;await assert.rejects(S.writePacks(p=>{p.put({key:'local:a',payload:pack});p.put({key:'local:b',payload:pack});}));assert.equal(stores.get('packs').size,0);await S.writePacks(p=>{p.put({key:'local:a',payload:pack});p.put({key:'local:b',payload:pack});});assert.equal(stores.get('packs').size,2);});
test('v1 package migration retains all existing packs and legacy unknown reading keys without rebuilding the database',async()=>{
 const f=fakeDatabase(),record={key:'local:a',source:'local',payload:pack};f.stores.get('packs').set(record.key,structuredClone(record));
 const raw={currentKey:'missing/story',readKeys:['missing/story'],positionKeys:{'missing/story':700}},legacy=new Map([['english-study.reader.v1',JSON.stringify(raw)]]);
 const {S,stores,state}=await setup({database:f,legacy});assert.deepEqual(plain(S.get('reader')),raw);assert.deepEqual(stores.get('packs').get('local:a'),record);assert.deepEqual(state.openedVersions,[2]);assert.equal(stores.get('workspace').get('current').data.reader.currentKey,'missing/story');
});
test('clean page adopts a foreign commit, notifies consumers and can save again',async()=>{
 const database=fakeDatabase(),hub=broadcastHub(),a=await setup({database,BroadcastChannel:hub.BroadcastChannel}),b=await setup({database,BroadcastChannel:hub.BroadcastChannel});
 b.S.set('reader',{readKeys:['original/4','missing/story'],positionKeys:{'missing/story':700}});await b.S.flush();await new Promise(r=>setTimeout(r,20));
 assert.equal(a.S.status().phase,'saved');assert.deepEqual(plain(a.S.get('reader').readKeys),['original/4','missing/story']);assert.ok(a.events.some(e=>e.type==='study-state-reloaded'));
 a.S.set('reader',{...a.S.get('reader'),currentKey:'original/5'});await a.S.flush();assert.equal(a.S.status().phase,'saved');assert.deepEqual(database.stores.get('workspace').get('current').data.reader.readKeys,['original/4','missing/story']);await b.S.refresh();
});
test('clean page does not become conflicted merely because another page writes packages',async()=>{
 const database=fakeDatabase(),hub=broadcastHub(),a=await setup({database,BroadcastChannel:hub.BroadcastChannel}),b=await setup({database,BroadcastChannel:hub.BroadcastChannel});
 await b.S.writePacks(p=>p.put({key:'local:a',payload:pack}));await a.S.refresh();assert.equal(a.S.status().phase,'saved');assert.equal((await a.S.packs()).length,1);a.S.set('reader',{readKeys:['original/3']});await a.S.flush();await b.S.refresh();
});
test('dirty foreign refresh retains unsaved local records and never overwrites committed data on retry',async()=>{
 const hub=broadcastHub(),{S,stores,legacy}=await setup({BroadcastChannel:hub.BroadcastChannel});S.set('learning',{...L.empty(),drafts:{mine:{own:'本页草稿',reason:'',categories:[]}}});
 const saved=stores.get('workspace').get('current');saved.token='another-page';saved.data.reader={readKeys:['original/4']};hub.pages[0].onmessage({data:{owner:'foreign',token:'another-page'}});
 await assert.rejects(S.refresh(),/另一个页面/);assert.equal(S.get('learning').drafts.mine.own,'本页草稿');assert.equal(S.status().phase,'conflict');await assert.rejects(S.retry());assert.deepEqual(stores.get('workspace').get('current').data.reader.readKeys,['original/4']);assert.deepEqual(JSON.parse(legacy.get('english-study.reader.v1')).readKeys,['original/1']);
});
test('duplicate or irrelevant notifications and unchanged set calls do not create writes or conflict',async()=>{
 const hub=broadcastHub(),{S,stores,events}=await setup({BroadcastChannel:hub.BroadcastChannel}),head=stores.get('workspace').get('current').token;
 S.set('reader',plain(S.get('reader')));await S.flush();hub.pages[0].onmessage({data:{owner:'foreign',token:head}});await S.refresh();hub.pages[0].onmessage({data:{unrelated:true}});
 assert.equal(stores.get('workspace').get('current').token,head);assert.equal(S.status().phase,'saved');assert.equal(events.filter(e=>e.type==='study-state-reloaded').length,0);
});
test('focus reads the committed head when broadcasts are unavailable or missed',async()=>{
 const {S,stores,windowEvents}=await setup(),saved=stores.get('workspace').get('current');saved.token='missed-broadcast';saved.data.reader={readKeys:['missing/story']};windowEvents.focus();await S.refresh();assert.deepEqual(plain(S.get('reader').readKeys),['missing/story']);S.set('reader',{...S.get('reader'),currentKey:'original/7'});await S.flush();assert.equal(S.status().phase,'saved');
});
test('focus with unchanged head does not cancel a pending local save',async()=>{
 const {S,stores,windowEvents}=await setup();S.set('reader',{currentKey:'original/7'});windowEvents.focus();await S.refresh();await new Promise(r=>setTimeout(r,170));assert.equal(S.status().phase,'saved');assert.equal(stores.get('workspace').get('current').data.reader.currentKey,'original/7');
});
test('failed external read preserves the local snapshot and successful retry can refresh cleanly',async()=>{
 const {S,state,stores,legacy}=await setup(),saved=stores.get('workspace').get('current');saved.token='remote';saved.data.reader={readKeys:['original/6']};state.failRead=true;
 await assert.rejects(S.refresh(),/read failure/);assert.deepEqual(plain(S.get('reader').readKeys),['original/1']);assert.deepEqual(JSON.parse(legacy.get('english-study.reader.v1')).readKeys,['original/1']);await S.retry();assert.equal(S.status().phase,'saved');assert.deepEqual(plain(S.get('reader').readKeys),['original/6']);
});
test('unavailable IndexedDB never reports new progress as durably saved or overwrites the legacy mirror',async()=>{
 const {S,legacy}=await setup({noDatabase:true});S.set('reader',{currentKey:'missing/story',positionKeys:{'missing/story':999}});await assert.rejects(S.flush(),/暂存/);assert.equal(S.status().phase,'error');assert.deepEqual(JSON.parse(legacy.get('english-study.reader.v1')).readKeys,['original/1']);assert.equal(S.get('reader').positionKeys['missing/story'],999);
});
test('external refresh exposes the packages and workspace from one readonly transaction',async()=>{
 const {S,stores,events}=await setup(),saved=stores.get('workspace').get('current');saved.token='with-pack';saved.data.reader={readKeys:[pack.id+'/'+pack.articles[0].id]};stores.get('packs').set('local:a',{key:'local:a',source:'local',payload:pack});
 await S.refresh();const event=events.find(e=>e.type==='study-state-reloaded');assert.deepEqual(event.detail.packs[0].payload,pack);assert.deepEqual(plain(S.get('reader').readKeys),[pack.id+'/'+pack.articles[0].id]);
});
test('successful refresh with unchanged head clears a transient read error without writing',async()=>{
 const {S,state,stores,windowEvents}=await setup(),head=stores.get('workspace').get('current').token;state.failRead=true;await windowEvents.focus();assert.equal(S.status().phase,'error');await S.retry();assert.equal(S.status().phase,'saved');assert.equal(stores.get('workspace').get('current').token,head);
});
test('package commit tokens stay unique even when the browser clock does not advance',async()=>{
 class FrozenDate extends Date{static now(){return 12345;}}
 const {S,stores}=await setup({Date:FrozenDate});await S.writePacks(p=>p.put({key:'local:a',payload:pack}));const first=stores.get('workspace').get('current').token;await S.writePacks(p=>p.delete('local:a'));assert.notEqual(stores.get('workspace').get('current').token,first);
});
