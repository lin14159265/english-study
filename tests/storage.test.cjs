const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../workspace-core'),L=require('../learning-core');
const content={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),content);const base=C.originalPack(content.window.READING_DATA),pack=JSON.parse(fs.readFileSync(__dirname+'/../downloads/pack-template.json','utf8'));
function fakeDatabase(){
 const stores=new Map([['packs',new Map()]]),state={fail:false,failRead:false,openedVersions:[],packReads:0,reads:[],puts:[]};
 const db={close(){},objectStoreNames:{contains:k=>stores.has(k)},createObjectStore:k=>stores.set(k,new Map()),transaction(names,mode){
  const active=new Map(names.map(n=>[n,new Map([...stores.get(n)].map(([k,v])=>[k,structuredClone(v)]))])),requests=[],tx={error:null,aborted:false,abort(){this.aborted=true;this.error=new Error('transaction aborted');},objectStore(n){const map=active.get(n);return {get(k){state.reads.push([n,k]);const q={};requests.push(()=>{q.result=structuredClone(map.get(k));q.onsuccess?.();});return q;},getAll(){if(n==='packs')state.packReads++;const q={};requests.push(()=>{q.result=structuredClone([...map.values()]);q.onsuccess?.();});return q;},put(v){state.puts.push([n,v.key,JSON.stringify(v).length]);map.set(v.key,structuredClone(v));return {};},delete:k=>map.delete(k),clear:()=>map.clear()};}};
  setTimeout(()=>{if(mode==='readonly'&&state.failRead){state.failRead=false;tx.error=new Error('simulated read failure');tx.onabort?.();return;}if(mode==='readwrite'&&state.fail){state.fail=false;tx.error=new Error('simulated quota failure');tx.onabort?.();return;}while(requests.length&&!tx.aborted)requests.shift()();if(tx.aborted){tx.onabort?.();return;}if(mode==='readwrite')for(const[n,m]of active)stores.set(n,m);tx.oncomplete?.();},0);return tx;
 }};
 return {stores,state,indexedDB:{open(name,version){state.openedVersions.push(version);const q={result:db};setTimeout(()=>{q.onupgradeneeded?.();q.onsuccess?.();},0);return q;}}};
}
async function setup(options={}){
 const f=options.database||fakeDatabase(),legacy=options.legacy||new Map([['english-study.reader.v1',JSON.stringify({readKeys:['original/1']})]]),events=[],windowEvents={},listeners={};
 const ctx={window:{StudyWorkspaceCore:C,StudyLearningCore:L,...(options.SyncCore?{StudySyncCore:options.SyncCore}:{}),addEventListener:(n,fn)=>windowEvents[n]=fn},indexedDB:options.noDatabase?{open(){throw Error('storage disabled');}}:f.indexedDB,localStorage:{getItem:k=>legacy.get(k),setItem:(k,v)=>legacy.set(k,v)},document:{addEventListener:(n,fn)=>(listeners[n]??=[]).push(fn),removeEventListener:(n,fn)=>listeners[n]=listeners[n]?.filter(x=>x!==fn),dispatchEvent:e=>{events.push(e);listeners[e.type]?.forEach(fn=>fn(e));}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},setTimeout,clearTimeout,...(options.BroadcastChannel?{BroadcastChannel:options.BroadcastChannel}:{}),...(options.Date?{Date:options.Date}:{})};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../workspace-store.js','utf8'),ctx);await ctx.window.StudyState.open();if(!options.noConsumer)ctx.window.StudyState.onReload(()=>{});return {...f,S:ctx.window.StudyState,legacy,events,windowEvents};
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
 const {S,stores,state}=await setup({database:f,legacy});assert.deepEqual(plain(S.get('reader')),raw);assert.deepEqual(stores.get('packs').get('local:a'),record);assert.deepEqual(state.openedVersions,[3]);assert.equal(stores.get('workspace').get('current').data.reader.currentKey,'missing/story');
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
 const {S,stores,events}=await setup(),saved=stores.get('workspace').get('current');saved.token=saved.libraryToken='with-pack';saved.data.reader={readKeys:[pack.id+'/'+pack.articles[0].id]};stores.get('packs').set('local:a',{key:'local:a',source:'local',payload:pack});
 await S.refresh();const event=events.find(e=>e.type==='study-state-reloaded');assert.deepEqual(event.detail.packs[0].payload,pack);assert.deepEqual(plain(S.get('reader').readKeys),[pack.id+'/'+pack.articles[0].id]);
});
test('successful refresh with unchanged head clears a transient read error without writing',async()=>{
 const {S,state,stores,windowEvents}=await setup(),head=stores.get('workspace').get('current').token;state.failRead=true;await windowEvents.focus();assert.equal(S.status().phase,'error');await S.retry();assert.equal(S.status().phase,'saved');assert.equal(stores.get('workspace').get('current').token,head);
});
test('package commit tokens stay unique even when the browser clock does not advance',async()=>{
 class FrozenDate extends Date{static now(){return 12345;}}
 const {S,stores}=await setup({Date:FrozenDate});await S.writePacks(p=>p.put({key:'local:a',payload:pack}));const first=stores.get('workspace').get('current').token;await S.writePacks(p=>p.delete('local:a'));assert.notEqual(stores.get('workspace').get('current').token,first);
});
test('reading-only foreign commits and unchanged focus never fetch full packages',async()=>{
 const {S,stores,state,events}=await setup(),saved=stores.get('workspace').get('current'),version=saved.libraryToken;
 stores.get('packs').set('local:large',{key:'local:large',payload:{text:'x'.repeat(1000000)}});const before=state.packReads;
 saved.token='reader-only';saved.data.reader.currentKey='original/3';await S.refresh();await S.refresh();
 assert.equal(state.packReads,before);assert.equal(S.libraryVersion(),version);assert.equal(events.find(e=>e.type==='study-state-reloaded').detail.packs,undefined);
 S.set('reader',{...S.get('reader'),currentKey:'original/4'});await S.flush();assert.equal(stores.get('workspace').get('current').libraryToken,version);
});
test('package and revision updates change the committed library token but unrelated extra fields do not',async()=>{
 const {S,stores}=await setup(),first=S.libraryVersion();S.set('extra',{...C.emptyExtra(),lastBackupAt:'2026-10-09T00:00:00Z'});await S.flush();assert.equal(S.libraryVersion(),first);
 const x=plain(S.get('extra'));x.edits[pack.id]={payload:pack};S.set('extra',x);await S.flush();const second=S.libraryVersion();assert.notEqual(second,first);
 await S.writePacks(p=>p.put({key:'local:a',payload:pack}));assert.notEqual(S.libraryVersion(),second);assert.equal(stores.get('workspace').get('current').libraryToken,S.libraryVersion());
});
test('legacy writers without library metadata conservatively read packages in the workspace snapshot',async()=>{
 const {S,stores,state,events}=await setup(),saved=stores.get('workspace').get('current');saved.token='legacy';delete saved.libraryToken;stores.get('packs').set('local:a',{key:'local:a',source:'local',payload:pack});const before=state.packReads;
 await S.refresh();assert.equal(state.packReads,before+1);assert.equal(events.find(e=>e.type==='study-state-reloaded').detail.packs[0].payload.id,pack.id);
 S.set('reader',{currentKey:'original/3'});await S.flush();assert.equal(typeof stores.get('workspace').get('current').libraryToken,'string');
});
test('a failed consumer blocks partial UI writes and retries the same head without another package read',async()=>{
 const {S,stores,state}=await setup();let fail=true,first=0,second=0,shown;
 S.onReload(()=>{first++;shown=S.get('reader').currentKey;});S.onReload(()=>{second++;if(fail)throw Error('consumer crashed');});
 const saved=stores.get('workspace').get('current');saved.token=saved.libraryToken='foreign-pack';saved.data.reader.currentKey='original/8';stores.get('packs').set('local:a',{key:'local:a',payload:pack});
 await assert.rejects(S.refresh(),/consumer crashed/);assert.equal(S.status().phase,'error');assert.equal(shown,'original/8');assert.throws(()=>S.set('reader',{currentKey:'original/1'}),/刷新未完成/);await assert.rejects(S.flush(),/刷新未完成/);
 const reads=state.packReads;fail=false;await S.retry();assert.equal(S.status().phase,'saved');assert.equal(first,2);assert.equal(second,2);assert.equal(state.packReads,reads);assert.equal(stores.get('workspace').get('current').token,'foreign-pack');
 S.set('reader',{...S.get('reader'),currentKey:'original/9'});await S.flush();assert.equal(stores.get('workspace').get('current').data.reader.currentKey,'original/9');
});
test('repeated consumer failures remain blocked and reopening reads the actual committed snapshot',async()=>{
 const database=fakeDatabase(),{S,stores}=await setup({database});S.onReload(()=>{throw Error('always fails');});const saved=stores.get('workspace').get('current');saved.token='remote';saved.data.reader.currentKey='original/12';
 await assert.rejects(S.refresh());await assert.rejects(S.retry());assert.throws(()=>S.set('reader',{currentKey:'original/2'}));
 const reopened=await setup({database});assert.equal(reopened.S.get('reader').currentKey,'original/12');assert.equal(stores.get('workspace').get('current').data.reader.currentKey,'original/12');
});
test('foreign commits received during startup are replayed once a consumer registers',async()=>{
 const {S,stores,state}=await setup({noConsumer:true}),saved=stores.get('workspace').get('current');saved.token=saved.libraryToken='startup';saved.data.reader.currentKey='late/story';stores.get('packs').set('local:a',{key:'local:a',payload:pack});
 await S.refresh();assert.throws(()=>S.set('reader',{}),/刷新未完成/);let received;S.onReload(d=>received=d);const reads=state.packReads;await S.refresh();assert.equal(received.packs[0].payload.id,pack.id);assert.equal(state.packReads,reads);assert.equal(S.status().phase,'saved');
});
test('retry after a UI failure adopts a newer head and replays its required library snapshot',async()=>{
 const {S,stores,state}=await setup();let fail=true,seen=[];S.onReload(d=>{seen.push(d.packs?.[0]?.payload.id);if(fail)throw Error('failed');});
 const saved=stores.get('workspace').get('current');saved.token=saved.libraryToken='packages';stores.get('packs').set('local:a',{key:'local:a',payload:pack});await assert.rejects(S.refresh());const reads=state.packReads;
 saved.token='newer-reader';saved.data.reader.currentKey='original/10';fail=false;await S.retry();assert.equal(state.packReads,reads);assert.deepEqual(seen,[pack.id,pack.id]);assert.equal(S.get('reader').currentKey,'original/10');
});
test('all acknowledged consumers settle before a failed refresh can be retried',async()=>{
 const {S,stores}=await setup();let started,finish;const began=new Promise(r=>started=r);S.onReload(()=>{throw Error('fast failure');});S.onReload(()=>new Promise(r=>{finish=r;started();}));
 stores.get('workspace').get('current').token='new-head';let settled=false;const refresh=S.refresh().catch(e=>{settled=true;return e;});await began;await Promise.resolve();assert.equal(settled,false);assert.equal(S.status().phase,'loading');assert.throws(()=>S.set('reader',{}),/刷新未完成/);finish();assert.match((await refresh).message,/fast failure/);assert.equal(S.status().phase,'error');
});

test('every business commit atomically stores a durable sequence and queue hint, aborts allocate nothing',async()=>{
 const {S,stores,state,events}=await setup();let view=await S.readSync();assert.equal(view.meta.seq,1);assert.equal(view.pending[0].operationId,view.meta.deviceId+':1');assert.equal(view.pending[0].token,view.token);
 const before=plain(view);state.fail=true;S.set('reader',{currentKey:'original/5'});await assert.rejects(S.flush(),/quota/);view=await S.readSync();assert.equal(view.token,before.token);assert.equal(view.meta.seq,before.meta.seq);assert.deepEqual(view.pending,before.pending);
 await S.flush();view=await S.readSync();assert.equal(view.meta.seq,2);assert.equal(view.pending.length,2);assert.equal(view.pending[1].token,view.token);assert.ok(events.some(e=>e.type==='study-local-commit'&&e.detail.operationId===view.pending[1].operationId));
 await assert.rejects(S.writePacks(()=>{throw Error('action aborted');}),/action aborted/);const aborted=await S.readSync();assert.equal(aborted.meta.seq,2);assert.equal(stores.get('packs').size,0);
});
test('reopening preserves the device ID and increasing operation sequence',async()=>{
 const database=fakeDatabase(),first=await setup({database});const a=await first.S.readSync();const second=await setup({database});second.S.set('reader',{currentKey:'original/6'});await second.S.flush();const b=await second.S.readSync();assert.equal(a.meta.deviceId,b.meta.deviceId);assert.equal(b.meta.seq,a.meta.seq+1);assert.notEqual(a.pending[0].operationId,b.pending.at(-1).operationId);
});
test('restore and rollback write durable outbox hints in their business transactions',async()=>{
 const {S,state}=await setup();await S.restore(incoming(),base);const restored=await S.readSync();assert.equal(restored.pending.at(-1).kind,'restore');assert.equal(restored.rollback.data.reader.readKeys[0],'original/1');state.fail=true;await assert.rejects(S.rollback());const failed=await S.readSync();assert.equal(failed.meta.seq,restored.meta.seq);assert.deepEqual(failed.rollback,restored.rollback);await S.rollback();const result=await S.readSync();assert.equal(result.pending.at(-1).kind,'rollback');assert.equal(result.rollback,null);
});
test('a persistent account binding rejects a different Google account without changing local records',async()=>{
 const database=fakeDatabase(),{S}=await setup({database});await S.bindUid('owner');await S.bindUid('owner');const before=await S.readSync();await assert.rejects(S.bindUid('stranger'),/另一账号/);assert.deepEqual(await S.readSync(),before);const reopen=await setup({database});await assert.rejects(reopen.S.bindUid('stranger'));assert.equal((await reopen.S.readSync()).meta.boundUid,'owner');
});
test('persisted immutable flight and its exact acknowledgement IDs survive reopening',async()=>{
 const database=fakeDatabase(),{S}=await setup({database});await S.bindUid('owner');const before=await S.readSync(),payload={expectedVersion:0,snapshot:{reader:'immutable'}};const flight=await S.saveFlight({uid:'owner',expectedToken:before.token,payload});payload.snapshot.reader='changed';assert.equal(flight.payload.snapshot.reader,'immutable');assert.deepEqual(flight.ackIds,before.pending.map(p=>p.key));assert.ok(flight.operationId.endsWith('_'+String(before.meta.seq+1)));
 const reopen=await setup({database}),read=await reopen.S.readSync();assert.deepEqual(read.meta.flight,flight);const same=await reopen.S.saveFlight({uid:'owner',expectedToken:read.token,payload:{replacement:true}});assert.deepEqual(same,flight);
});
test('unconfirmed flights cannot be discarded, explicit backend conflict rejection can abandon without acknowledgement',async()=>{
 const {S}=await setup();await S.bindUid('owner');const view=await S.readSync(),flight=await S.saveFlight({uid:'owner',expectedToken:view.token,payload:{v:1}});await assert.rejects(S.abandonFlight({uid:'owner',operationId:flight.operationId}),/确认/);assert.equal((await S.readSync()).meta.flight.operationId,flight.operationId);await assert.rejects(S.abandonFlight({uid:'stranger',operationId:flight.operationId,reason:'remote-conflict'}));await S.abandonFlight({uid:'owner',operationId:flight.operationId,reason:'remote-conflict'});const result=await S.readSync();assert.equal(result.meta.flight,undefined);assert.deepEqual(result.pending,view.pending);
});
test('cloud apply acknowledges only flight IDs, preserves newer commits and published cache, and avoids queue echo',async()=>{
 const {S,events}=await setup();await S.bindUid('owner');await S.writePacks(p=>p.put({key:'published:public',source:'published',payload:pack}));const start=await S.readSync(),flight=await S.saveFlight({uid:'owner',expectedToken:start.token,payload:{snapshot:'first'}});S.set('reader',{currentKey:'original/9'});await S.flush();const current=await S.readSync(),newest=current.pending.at(-1);let detail;S.onReload(d=>detail=d);const count=events.filter(e=>e.type==='study-local-commit').length;
 await S.applySync({uid:'owner',expectedToken:current.token,state:current.state,packs:[{key:'local:private',source:'local',payload:pack}],remoteVersion:1,base:{snapshot:1},ackIds:flight.ackIds,conflicts:[],followResume:true});const result=await S.readSync();assert.equal(result.meta.remoteVersion,1);assert.equal(result.meta.flight,undefined);assert.deepEqual(result.pending,[newest]);assert.equal(result.packs.length,2);assert.equal(detail.packs.length,2);assert.equal(detail.followResume,true);assert.equal(detail.source,'cloud');assert.equal(events.filter(e=>e.type==='study-local-commit').length,count);assert.equal(result.meta.recovery.state.reader.currentKey,'original/9');
});
test('cloud transaction failure keeps business state, packs, flight, acknowledgements and base unchanged',async()=>{
 const {S,state}=await setup();await S.bindUid('owner');const start=await S.readSync(),flight=await S.saveFlight({uid:'owner',expectedToken:start.token,payload:{v:1}});const before=await S.readSync();state.fail=true;await assert.rejects(S.applySync({uid:'owner',expectedToken:before.token,state:before.state,packs:[],remoteVersion:1,base:{v:1},ackIds:flight.ackIds}));assert.deepEqual(await S.readSync(),before);
});
test('cloud apply commits acknowledgement before consumers and safely replays a failed UI refresh',async()=>{
 const database=fakeDatabase(),{S}=await setup({database});await S.bindUid('owner');const start=await S.readSync(),flight=await S.saveFlight({uid:'owner',expectedToken:start.token,payload:{v:1}});let failed=true,calls=0;S.onReload(()=>{calls++;if(failed)throw Error('cloud consumer failed');});const next=plain(start.state);next.reader.currentKey='original/11';await assert.rejects(S.applySync({uid:'owner',expectedToken:start.token,state:next,packs:[],remoteVersion:1,base:{v:1},ackIds:flight.ackIds}),/cloud consumer/);const stored=await S.readSync();assert.equal(stored.state.reader.currentKey,'original/11');assert.equal(stored.pending.length,0);assert.equal(stored.meta.flight,undefined);assert.equal(stored.meta.remoteVersion,1);assert.throws(()=>S.set('reader',{}),/刷新未完成/);failed=false;await S.retry();assert.equal(calls,2);assert.equal(S.status().phase,'saved');assert.equal((await S.readSync()).token,stored.token);const reopen=await setup({database});assert.equal(reopen.S.get('reader').currentKey,'original/11');
});
test('cloud apply refuses stale heads, dirty state, mismatched accounts and invented acknowledgements',async()=>{
 const {S,stores}=await setup();await S.bindUid('owner');const start=await S.readSync(),args={uid:'owner',expectedToken:start.token,state:start.state,packs:[],remoteVersion:1,base:{v:1}};await assert.rejects(S.applySync({...args,uid:'stranger'}),/未绑定/);await assert.rejects(S.applySync({...args,ackIds:['invented']}),/确认操作/);S.set('reader',{currentKey:'local/pending'});await assert.rejects(S.applySync(args),/已有新记录/);assert.equal(S.get('reader').currentKey,'local/pending');await S.flush();const current=await S.readSync();stores.get('workspace').get('current').token='foreign';await assert.rejects(S.applySync({...args,expectedToken:current.token}));assert.equal(stores.get('workspace').get('current').token,'foreign');
});
test('remote rollback record is synced without overwriting it with pre-cloud recovery data',async()=>{
 const {S}=await setup();await S.bindUid('owner');await S.restore(incoming(),base);const view=await S.readSync(),remoteUndo={key:'rollback',data:plain(view.state),packs:[]};remoteUndo.data.reader.currentKey='remote/undo';await S.applySync({uid:'owner',expectedToken:view.token,state:view.state,packs:[],remoteVersion:2,base:{v:2},rollback:remoteUndo});const result=await S.readSync();assert.equal(result.rollback.data.reader.currentKey,'remote/undo');assert.equal(result.meta.recovery.rollback.data.reader.readKeys[0],'original/1');assert.equal(result.pending.length,view.pending.length);await S.rollback();assert.equal(S.get('reader').currentKey,'remote/undo');
});
test('conflicts persist without clearing queued records or changing business head',async()=>{
 const {S}=await setup();await S.bindUid('owner');const before=await S.readSync();await S.writeConflicts({uid:'owner',expectedToken:before.token,conflicts:[{path:'notes/a',local:1,remote:2}]});const after=await S.readSync();assert.equal(after.token,before.token);assert.deepEqual(after.pending,before.pending);assert.equal(after.meta.conflicts.length,1);
});
test('an empty flight is not acknowledged by an unrelated cloud pull and requires its confirmed operation ID',async()=>{
 const {S}=await setup();await S.bindUid('owner');const initial=await S.readSync(),first=await S.saveFlight({uid:'owner',expectedToken:initial.token,payload:{v:1}});await S.applySync({uid:'owner',expectedToken:initial.token,state:initial.state,packs:[],remoteVersion:1,base:{v:1},ackIds:first.ackIds});const clean=await S.readSync();assert.equal(clean.pending.length,0);const empty=await S.saveFlight({uid:'owner',expectedToken:clean.token,payload:{v:2}});assert.equal(empty.ackIds.length,0);await S.applySync({uid:'owner',expectedToken:clean.token,state:clean.state,packs:[],remoteVersion:1,base:{v:1},ackIds:[]});const pull=await S.readSync();assert.equal(pull.meta.flight.operationId,empty.operationId);await assert.rejects(S.applySync({uid:'owner',expectedToken:pull.token,state:pull.state,packs:[],remoteVersion:2,base:{v:2},ackOperationId:'invented'}),/操作确认/);await S.applySync({uid:'owner',expectedToken:pull.token,state:pull.state,packs:[],remoteVersion:2,base:{v:2},ackOperationId:empty.operationId});assert.equal((await S.readSync()).meta.flight,undefined);
});
test('a database versionchange closes the old writer and makes cloud sync unavailable',async()=>{
 const {S}=await setup();S.database().onversionchange();assert.equal(S.database(),null);assert.equal(S.canSync(),false);S.set('reader',{currentKey:'original/12'});await assert.rejects(S.flush(),/暂存/);assert.equal(S.status().phase,'error');
});
test('cloud UI lock begins before the transaction and remains until every acknowledged consumer settles',async()=>{
 const {S,events}=await setup();await S.bindUid('owner');const before=await S.readSync();let begun,finish;const started=new Promise(r=>begun=r);S.onReload(()=>new Promise(r=>{finish=r;begun();}));const applied=S.applySync({uid:'owner',expectedToken:before.token,state:before.state,packs:[],remoteVersion:1,base:{v:1}});await started;
 const locks=events.filter(e=>e.type==='study-sync-applying');assert.equal(locks[0].detail.active,true);assert.equal(locks.at(-1).detail.active,true);assert.equal(S.canSync(),false);assert.throws(()=>S.set('reader',{currentKey:'typed/draft'}),/云端记录/);assert.equal(S.get('reader').currentKey,undefined);finish();await applied;assert.equal(events.filter(e=>e.type==='study-sync-applying').at(-1).detail.active,false);assert.equal(S.canSync(),true);
});
test('a failed cloud UI consumer keeps the edit lock active until explicit successful retry',async()=>{
 const {S,events}=await setup();await S.bindUid('owner');const before=await S.readSync();let fail=true;S.onReload(()=>{if(fail)throw Error('draft UI failed');});await assert.rejects(S.applySync({uid:'owner',expectedToken:before.token,state:before.state,packs:[],remoteVersion:1,base:{v:1}}));let last=events.filter(e=>e.type==='study-sync-applying').at(-1).detail;assert.equal(last.active,true);assert.equal(last.pendingReload,true);fail=false;await S.retry();last=events.filter(e=>e.type==='study-sync-applying').at(-1).detail;assert.equal(last.active,false);assert.equal(last.pendingReload,false);
});
test('full sync boundary validation rejects unsafe state, malformed rollback and invalid merge base before writes',async()=>{
 const {S}=await setup({SyncCore:require('../sync-core')});await S.bindUid('owner');const before=await S.readSync(),args={uid:'owner',expectedToken:before.token,state:before.state,packs:[],remoteVersion:1,base:{state:before.state,packs:[]}};
 const malicious=JSON.parse(JSON.stringify(before.state));malicious.reader.future=JSON.parse('{"constructor":{"polluted":true}}');await assert.rejects(S.applySync({...args,state:malicious}),/不安全/);assert.deepEqual(await S.readSync(),before);
 await assert.rejects(S.applySync({...args,rollback:{data:before.state,packs:[{key:'published:x',source:'published',payload:pack}]}}),/私人资料/);assert.deepEqual(await S.readSync(),before);
 await assert.rejects(S.applySync({...args,base:{invalid:true}}),/结构无效/);assert.deepEqual(await S.readSync(),before);await S.applySync(args);assert.equal((await S.readSync()).meta.remoteVersion,1);
});
test('cloud flight IDs satisfy the Firebase document and rules grammar',async()=>{
 const {S}=await setup();await S.bindUid('owner');const view=await S.readSync(),flight=await S.saveFlight({uid:'owner',expectedToken:view.token,payload:{v:1}});assert.match(flight.operationId,/^[A-Za-z0-9_-]{8,160}$/);assert.equal(flight.operationId.includes(':'),false);assert.equal(view.pending[0].operationId.includes(':'),true);
});
test('existing v2 workspace upgrade initializes persistent metadata without rewriting business data or queueing',async()=>{
 const database=fakeDatabase(),old={key:'current',token:'existing-v2',libraryToken:'library-v2',savedAt:42,data:{reader:{currentKey:'missing/old'},learning:L.empty(),extra:C.emptyExtra()}};database.stores.set('workspace',new Map([['current',structuredClone(old)]]));const {S}=await setup({database}),view=await S.readSync();assert.equal(view.token,old.token);assert.deepEqual(view.state,old.data);assert.equal(view.meta.seq,0);assert.equal(view.meta.boundUid,null);assert.match(view.meta.deviceId,/^[A-Za-z0-9_-]{8,130}$/);assert.equal(view.pending.length,0);const reopened=await setup({database});assert.equal((await reopened.S.readSync()).meta.deviceId,view.meta.deviceId);
});
test('invalid persisted device identifiers are rejected rather than silently resetting idempotency identity',async()=>{
 const {S,stores}=await setup();const meta=stores.get('syncMeta').get('current');meta.deviceId='bad/path';await assert.rejects(S.bindUid('owner'),/设备标识/);assert.equal(stores.get('syncMeta').get('current').deviceId,'bad/path');assert.equal(stores.get('syncMeta').get('current').seq,1);
});
test('large synchronization payloads survive reopen while ordinary save allocates only light metadata',async()=>{
 const {S,stores,state,indexedDB}=await setup();await S.bindUid('owner');const header=stores.get('syncMeta').get('current');header.base={padding:'x'.repeat(1000000)};header.recovery={retained:true}; // earlier embedded development format
 const before=await S.readSync(),reopened=await setup({database:{stores,state,indexedDB}});assert.deepEqual(await reopened.S.readSync(),before);assert.equal(Object.hasOwn(stores.get('syncMeta').get('current'),'base'),false);assert.equal((await S.readSync()).meta.base.padding.length,1000000);
 const heavy=JSON.stringify(stores.get('syncMeta').get('payload:base'));state.reads=[];state.puts=[];S.set('reader',{...S.get('reader'),currentKey:'original/7'});await S.flush();
 assert.equal(state.reads.some(([n,k])=>n==='syncMeta'&&k.startsWith('payload:')),false);assert.equal(state.puts.some(([n,k])=>n==='syncMeta'&&k.startsWith('payload:')),false);assert.ok(state.puts.filter(([n])=>n==='syncMeta').every(([,k,size])=>size<1000));assert.equal(JSON.stringify(stores.get('syncMeta').get('payload:base')),heavy);
});
test('metadata-only receipt confirmation keeps packs, library token, head and UI intact',async()=>{
 const {S,stores,state,events}=await setup({SyncCore:require('../sync-core')});await S.bindUid('owner');await S.writePacks(p=>p.put({key:'local:'+pack.id,source:'local',payload:pack}));const before=await S.readSync(),flight=await S.saveFlight({uid:'owner',expectedToken:before.token,payload:{snapshot:{state:before.state,packs:before.packs}}});
 S.set('reader',{...S.get('reader'),currentKey:'original/8'});await S.flush();const current=await S.readSync(),library=S.libraryVersion();state.puts=[];state.reads=[];const count=events.filter(e=>e.type==='study-state-reloaded').length;
 await S.confirmSync({uid:'owner',expectedToken:current.token,base:flight.payload.snapshot,remoteVersion:1,ackIds:flight.ackIds,ackOperationId:flight.operationId});
 assert.equal(S.libraryVersion(),library);assert.equal(stores.get('workspace').get('current').token,current.token);assert.equal(state.puts.some(([n])=>n==='packs'||n==='workspace'),false);assert.equal(state.reads.some(([n])=>n==='packs'),false);assert.equal(events.filter(e=>e.type==='study-state-reloaded').length,count);
 const after=await S.readSync();assert.equal(after.pending.length,1);assert.equal(after.meta.flight,undefined);assert.equal(after.state.reader.currentKey,'original/8');assert.equal(after.meta.remoteVersion,1);assert.deepEqual(after.meta.base,flight.payload.snapshot);
});
test('receipt-only transaction abort and unknown acknowledgement never alter records or clear queue',async()=>{
 const {S,state}=await setup();await S.bindUid('owner');const before=await S.readSync(),flight=await S.saveFlight({uid:'owner',expectedToken:before.token,payload:{v:1}}),flightView=await S.readSync(),args={uid:'owner',expectedToken:before.token,base:{v:1},remoteVersion:1,ackIds:flight.ackIds,ackOperationId:flight.operationId};
 state.fail=true;await assert.rejects(S.confirmSync(args),/quota/);assert.deepEqual(await S.readSync(),flightView);
 await assert.rejects(S.confirmSync({...args,ackOperationId:'unknown_operation'}),/确认/);assert.deepEqual(await S.readSync(),flightView);
});
