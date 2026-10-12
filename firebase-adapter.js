(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyFirebaseAdapter=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const SDK_VERSION='13.0.0',CHUNK_BYTES=180*1024,BATCH_BYTES=6*1024*1024;
  const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const fault=(code,message)=>Object.assign(new Error(message),{code});
  const plain=x=>JSON.parse(JSON.stringify(x));
  // A timeout does not cancel an SDK write. Retain the underlying request and
  // reuse it on retry; the controller retains its durable operationId flight.
  function deadline(promise,ms,label){
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(fault('sync-timeout',label+'超过等待时间；联网后会自动重试。')),ms);
    })]).finally(()=>clearTimeout(timer));
  }
  function canonical(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(v=>canonical(v)??'null').join(',')+']';
    return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  }
  async function digest(text){
    const bytes=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(text));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function split(text){
    const bytes=encoder.encode(text),pieces=[];
    for(let start=0;start<bytes.length;){
      let end=Math.min(start+CHUNK_BYTES,bytes.length);
      while(end<bytes.length&&(bytes[end]&192)===128)end--;
      pieces.push(decoder.decode(bytes.subarray(start,end)));start=end;
    }
    return pieces.length?pieces:[''];
  }
  async function encodeSnapshot(snapshot){
    if(!snapshot||typeof snapshot!=='object'||!snapshot.state||!Array.isArray(snapshot.packs))throw fault('invalid-snapshot','学习快照格式无效。');
    const chunks=new Map(),entries=[];
    async function part(path,value){
      const text=canonical(value),hash=await digest(text),ids=[];
      for(const piece of split(text)){
        const id=await digest(piece);ids.push(id);
        chunks.set(id,{schema:1,text:piece,bytes:encoder.encode(piece).length});
      }
      entries.push({path,digest:hash,bytes:encoder.encode(text).length,chunks:ids});
    }
    for(const key of Object.keys(snapshot).sort()){
      if(key==='packs')continue;
      if(key==='state')for(const name of Object.keys(snapshot.state).sort())await part(['state',name],snapshot.state[name]);
      else await part([key],snapshot[key]);
    }
    const seen=new Set();
    for(const pack of [...snapshot.packs].sort((a,b)=>String(a.key).localeCompare(String(b.key)))){
      if(typeof pack.key!=='string'||seen.has(pack.key))throw fault('invalid-snapshot','私人资料包键缺失或重复。');
      seen.add(pack.key);await part(['packs',pack.key],pack);
    }
    const manifestText=canonical({schema:1,entries}),manifestId=await digest(manifestText),manifestChunks=[];
    for(const piece of split(manifestText)){
      const id=await digest(piece);manifestChunks.push(id);chunks.set(id,{schema:1,text:piece,bytes:encoder.encode(piece).length});
    }
    if(manifestChunks.length>1024)throw fault('resource-exhausted','云端清单超过单次安全上传上限；本地记录已保留。');
    return {chunks,manifestId,manifest:{schema:1,digest:manifestId,bytes:encoder.encode(manifestText).length,chunks:manifestChunks},digest:manifestId};
  }
  const SDK_PREFIX='https://www.gstatic.com/firebasejs/'+SDK_VERSION+'/',SDK_CACHE='english-study-firebase-sdk-'+SDK_VERSION;
  let sdkPromise=null;
  const sourceValid=source=>typeof source==='string'&&source.length>20&&!source.trimStart().startsWith('<')&&/\bexport[\s{]/.test(source);
  function rewriteAppImport(source,appURL){
    const official=SDK_PREFIX+'firebase-app.js';
    const imports=[...source.matchAll(/(?:^|;|\n)\s*(?:import|export)\s*(?:\{[^}]*\}\s*from\s*)?["']([^"']+)["']/g)];
    if(imports.some(match=>match[1]!==official)||/\bimport\s*\(/.test(source))throw fault('sdk-module-graph','Firebase SDK 模块依赖发生变化，请更新登录组件。');
    return source.replaceAll(JSON.stringify(official),JSON.stringify(appURL)).replaceAll("'"+official+"'",JSON.stringify(appURL));
  }
  function loadSDK(){
    if(sdkPromise)return sdkPromise;
    sdkPromise=(async()=>{
      let cache=null;try{cache=await globalThis.caches?.open(SDK_CACHE);}catch{}
      const urls=['app','auth','firestore'].map(name=>SDK_PREFIX+'firebase-'+name+'.js');
      async function source(url){
        try{const cached=await cache?.match(url);if(cached){const text=await cached.text();if(sourceValid(text))return text;await cache.delete(url);}}catch{}
        const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);
        try{
          const response=await fetch(url,{credentials:'omit',mode:'cors',cache:'no-cache',signal:abort.signal});
          if(!response.ok)throw fault('sdk-unavailable','登录组件暂时无法下载（HTTP '+response.status+'），联网后将自动重试。');
          const text=await response.text();if(!sourceValid(text))throw fault('sdk-unavailable','登录组件下载内容无效，联网后将自动重试。');
          try{await cache?.put(url,new Response(text,{headers:{'Content-Type':'text/javascript'}}));}catch{}
          return text;
        }finally{clearTimeout(timeout);}
      }
      // Fetch is retryable. A failed direct import() URL is permanently cached by
      // Chromium, so each complete attempt imports a fresh Blob module graph.
      const fetched=await Promise.allSettled(urls.map(source));
      const downloadError=fetched.find(result=>result.status==='rejected');if(downloadError)throw downloadError.reason;
      const codes=fetched.map(result=>result.value),blobs=[];
      try{
        const appURL=URL.createObjectURL(new Blob([codes[0]],{type:'text/javascript'}));blobs.push(appURL);
        const moduleURLs=[appURL,...codes.slice(1).map(code=>{const url=URL.createObjectURL(new Blob([rewriteAppImport(code,appURL)],{type:'text/javascript'}));blobs.push(url);return url;})];
        const loaded=await Promise.allSettled(moduleURLs.map(url=>import(url)));
        const moduleError=loaded.find(result=>result.status==='rejected');if(moduleError)throw moduleError.reason;
        return Object.assign({},...loaded.map(result=>result.value));
      }catch(error){
        // A stale/corrupted source cache must not make all later attempts fail.
        await Promise.allSettled(urls.map(url=>cache?.delete(url)));throw error;
      }finally{blobs.forEach(url=>URL.revokeObjectURL(url));}
    })();
    sdkPromise.catch(()=>{sdkPromise=null;});return sdkPromise;
  }
  async function create(config,options={}){
    if(!config||!config.apiKey||!config.projectId||!config.appId||!config.authDomain)throw fault('configuration-required','请先配置 Firebase 网页项目。');
    const sdk=await (options.loadSDK||loadSDK)();
    const appName='english-study-'+config.projectId;
    const app=sdk.getApps().find(a=>a.name===appName)||sdk.initializeApp(Object.fromEntries(['apiKey','authDomain','projectId','appId','messagingSenderId','storageBucket'].filter(k=>config[k]).map(k=>[k,config[k]])),appName);
    const auth=sdk.getAuth(app),db=sdk.getFirestore(app);
    await sdk.setPersistence(auth,sdk.browserLocalPersistence);
    let current=null,closed=false,authError=null,authStop=null;
    const authCallbacks=new Set(),subscriptions=new Set(),known=new Set(),immutable=new Map(),joined=new Map();
    const progressCallbacks=new Set(),requests=new Map();
    const requestTimeout=options.requestTimeoutMs??30000;
    function progress(stage,message){for(const callback of progressCallbacks)callback({stage,message});}
    function network(key,work,label){
      let pending=requests.get(key);
      if(!pending){
        pending=Promise.resolve().then(work);requests.set(key,pending);
        const clear=()=>{if(requests.get(key)===pending)requests.delete(key);};pending.then(clear,clear);
      }
      return deadline(pending,requestTimeout,label);
    }
    const read=(group,id,label)=>network('read:'+group+'/'+id,()=>sdk.getDocFromServer(ref(group,id)),label);
    const CACHE_BYTES=48*1024*1024;let immutableBytes=0,joinedBytes=0,lastPull=null;
    function clearCaches(){known.clear();immutable.clear();joined.clear();immutableBytes=0;joinedBytes=0;lastPull=null;}
    function remember(map,key,value,bytes,kind){
      if(bytes>CACHE_BYTES)return;
      if(map.has(key))return;
      map.set(key,{value:plain(value),bytes});
      if(kind==='immutable')immutableBytes+=bytes;else joinedBytes+=bytes;
      while((kind==='immutable'?immutableBytes:joinedBytes)>CACHE_BYTES){
        const first=map.keys().next().value,old=map.get(first);map.delete(first);
        if(kind==='immutable')immutableBytes-=old.bytes;else joinedBytes-=old.bytes;
      }
    }
    const ref=(group,id)=>sdk.doc(db,'users',config.allowedUid,group,id);
    const headRef=()=>ref('control','head');
    const assertOwner=()=>{if(closed||!config.allowedUid||config.allowedUid==='REPLACE_WITH_YOUR_UID'||!current||current.uid!==config.allowedUid)throw fault('permission-denied','请先将本人 UID 填入配置及安全规则，再使用本人 Google 账号登录。');};
    async function checked(user){
      if(user&&((config.allowedUid&&config.allowedUid!=='REPLACE_WITH_YOUR_UID'&&user.uid!==config.allowedUid)||!user.providerData?.some(p=>p.providerId==='google.com'))){
        current=null;authError=fault('permission-denied','此 Google 账号未获授权，已退出登录。');clearCaches();
        await sdk.signOut(auth);return null;
      }
      if(current?.uid!==user?.uid)clearCaches();current=user;return user;
    }
    try{await sdk.getRedirectResult(auth);}catch(error){authError=error;}
    await checked(auth.currentUser);
    authStop=sdk.onAuthStateChanged(auth,user=>{
      checked(user).then(value=>{if(!closed)for(const fn of authCallbacks)fn(value,authError);authError=null;}).catch(error=>{for(const fn of authCallbacks)fn(null,error);});
    });
    async function readImmutable(group,id){
      assertOwner();const cached=immutable.get(group+'/'+id);if(cached)return plain(cached.value);
      const doc=await read(group,id,'读取云端资料');
      if(!doc.exists())throw fault('cloud-corrupt','云端资料缺失，本机记录未改动。');
      return doc.data();
    }
    async function join(metadata){
      if(metadata.schema!==1||!Array.isArray(metadata.chunks)||metadata.chunks.length>100000)throw fault('cloud-corrupt','云端资料结构无效。');
      const cacheKey=canonical({digest:metadata.digest,bytes:metadata.bytes,chunks:metadata.chunks}),cached=joined.get(cacheKey);
      if(cached)return plain(cached.value);
      const texts=[];
      for(let offset=0;offset<metadata.chunks.length;offset+=16){
        const pieces=await Promise.all(metadata.chunks.slice(offset,offset+16).map(async id=>{
          if(!/^[a-f0-9]{64}$/.test(id))throw fault('cloud-corrupt','云端分块标识无效。');
          const data=await readImmutable('chunks',id);
          if(typeof data.text!=='string'||encoder.encode(data.text).length!==data.bytes||await digest(data.text)!==id)throw fault('cloud-corrupt','云端资料校验失败，本机记录未改动。');
          remember(immutable,'chunks/'+id,data,data.bytes,'immutable');
          known.add('chunks/'+id);return data.text;
        }));texts.push(...pieces);
      }
      const text=texts.join('');
      if(encoder.encode(text).length!==metadata.bytes||await digest(text)!==metadata.digest)throw fault('cloud-corrupt','云端完整性校验失败，本机记录未改动。');
      const value=JSON.parse(text);remember(joined,cacheKey,value,metadata.bytes,'joined');return value;
    }
    async function pull(){
      assertOwner();progress('cloud-head','正在检查云端版本…');const doc=await read('control','head','检查云端版本');
      if(!doc.exists())return {version:0,snapshot:null};
      const head=doc.data();
      if(!Number.isSafeInteger(head.version)||head.version<1||!/^[a-f0-9]{64}$/.test(head.manifestId)||head.digest!==head.manifestId)throw fault('cloud-corrupt','云端版本记录无效。');
      if(lastPull&&lastPull.version===head.version&&lastPull.manifestId===head.manifestId&&lastPull.digest===head.digest)return plain({...head,snapshot:lastPull.snapshot});
      const metadata=await readImmutable('manifests',head.manifestId);
      if(metadata.digest!==head.digest)throw fault('cloud-corrupt','云端清单校验失败。');
      const manifest=await join(metadata),snapshot={state:{},packs:[]},paths=new Set();
      remember(immutable,'manifests/'+head.manifestId,metadata,encoder.encode(canonical(metadata)).length,'immutable');
      if(manifest.schema!==1||!Array.isArray(manifest.entries))throw fault('cloud-corrupt','云端清单格式无效。');
      let completed=0;
      for(const entry of manifest.entries){
        progress('cloud-download',`正在读取云端资料（${completed+1}/${manifest.entries.length}）…`);
        const path=entry.path;
        if(!Array.isArray(path)||path.length<1||path.length>2||path.some(x=>typeof x!=='string'||['__proto__','constructor','prototype'].includes(x)))throw fault('cloud-corrupt','云端记录路径无效。');
        const identity=canonical(path);if(paths.has(identity))throw fault('cloud-corrupt','云端记录路径重复。');paths.add(identity);
        const value=await join({schema:1,...entry});
        if(path[0]==='packs'&&path.length===2){if(value.key!==path[1])throw fault('cloud-corrupt','资料包键校验失败。');snapshot.packs.push(value);}
        else if(path[0]==='state'&&path.length===2)snapshot.state[path[1]]=value;
        else if(path.length===1&&path[0]!=='state'&&path[0]!=='packs')snapshot[path[0]]=value;
        else throw fault('cloud-corrupt','云端记录路径无效。');
        completed++;
      }
      known.add('manifests/'+head.manifestId);
      lastPull={version:head.version,manifestId:head.manifestId,digest:head.digest,snapshot:plain(snapshot)};
      return {...head,snapshot};
    }
    async function ensureImmutable(items){
      const missing=[];
      for(let offset=0;offset<items.length;offset+=16)await Promise.all(items.slice(offset,offset+16).map(async item=>{
        const identity=item.group+'/'+item.id;if(known.has(identity))return;
        const existing=await read(item.group,item.id,'检查云端分块');
        if(existing.exists()){
          if(canonical(existing.data())!==canonical(item.data))throw fault('cloud-corrupt','云端不可变资料发生冲突。');
          known.add(identity);
          remember(immutable,identity,item.data,encoder.encode(canonical(item.data)).length,'immutable');
        }else missing.push(item);
      }));
      for(let offset=0;offset<missing.length;){
        const batch=sdk.writeBatch(db),sent=[];let bytes=0;
        while(offset<missing.length&&sent.length<32){
          const item=missing[offset],size=encoder.encode(canonical(item.data)).length;
          if(sent.length&&bytes+size>BATCH_BYTES)break;
          batch.set(ref(item.group,item.id),item.data);sent.push(item);bytes+=size;offset++;
        }
        assertOwner();const batchKey='batch:'+sent.map(item=>item.group+'/'+item.id).sort().join(',');
        await network(batchKey,()=>batch.commit(),'上传云端资料');sent.forEach(item=>{const identity=item.group+'/'+item.id;known.add(identity);remember(immutable,identity,item.data,encoder.encode(canonical(item.data)).length,'immutable');});
      }
    }
    async function commit({operationId,expectedVersion,snapshot}){
      assertOwner();
      if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,160}$/.test(operationId)||!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw fault('invalid-operation','同步操作标识或基础版本无效。');
      progress('cloud-encode','正在校验待上传资料…');
      const encoded=await encodeSnapshot(snapshot),receiptRef=ref('receipts',operationId);
      // Durable receipts are checked even when later devices have advanced the head.
      progress('cloud-receipt','正在核对云端操作回执…');
      const prior=await read('receipts',operationId,'核对云端操作回执');
      if(prior.exists()){
        const data=prior.data();if(data.digest!==encoded.digest)throw fault('operation-mismatch','同步操作标识已被不同内容使用。');
        return {...data,alreadyCommitted:true};
      }
      progress('cloud-upload','正在上传变更资料…');
      await ensureImmutable([...encoded.chunks].map(([id,data])=>({group:'chunks',id,data})));
      await ensureImmutable([{group:'manifests',id:encoded.manifestId,data:encoded.manifest}]);
      assertOwner();
      progress('cloud-confirm','正在等待云端提交确认…');
      return network('transaction:'+operationId+':'+encoded.digest,()=>sdk.runTransaction(db,async transaction=>{
        const receipt=await transaction.get(receiptRef),head=await transaction.get(headRef());
        if(receipt.exists()){
          const data=receipt.data();if(data.digest!==encoded.digest)throw fault('operation-mismatch','同步操作标识已被不同内容使用。');
          return {...data,alreadyCommitted:true};
        }
        const version=head.exists()?head.data().version:0;
        if(version!==expectedVersion)throw fault('remote-conflict','其他设备已提交更新，请先合并。');
        const next={schema:1,operationId,expectedVersion,version:version+1,manifestId:encoded.manifestId,digest:encoded.digest};
        transaction.set(receiptRef,next);
        transaction.set(headRef(),{schema:1,operationId,version:next.version,manifestId:next.manifestId,digest:next.digest});
        return {...next,alreadyCommitted:false};
      }),'等待云端提交确认');
    }
    return {
      onAuth(callback){authCallbacks.add(callback);queueMicrotask(()=>{if(authCallbacks.has(callback))callback(current,authError);});return ()=>authCallbacks.delete(callback);},
      async signIn(){
        const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
        try{const result=await sdk.signInWithPopup(auth,provider);return await checked(result.user);}
        catch(error){
          if(error.code==='auth/popup-blocked'&&config.redirectReady===true)return sdk.signInWithRedirect(auth,provider);
          if(error.code==='auth/popup-blocked')throw fault('auth/popup-blocked','浏览器阻止了登录窗口。请允许本站弹出窗口后再次点击 Google 登录。');
          throw error;
        }
      },
      async signOut(){for(const stop of subscriptions)stop();subscriptions.clear();clearCaches();await sdk.signOut(auth);current=null;},
      user:()=>current,pull,commit,
      onProgress(callback){progressCallbacks.add(callback);return()=>progressCallbacks.delete(callback);},
      subscribe(callback){
        assertOwner();let last=null;const stop=sdk.onSnapshot(headRef(),{includeMetadataChanges:true},snapshot=>{
          if(snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)return;
          const head=snapshot.exists()?snapshot.data():{version:0},signature=canonical(head);
          if(signature===last)return;last=signature;callback(head);
        },error=>callback({error}));subscriptions.add(stop);return ()=>{stop();subscriptions.delete(stop);};
      },
      close(){closed=true;authStop?.();for(const stop of subscriptions)stop();subscriptions.clear();authCallbacks.clear();progressCallbacks.clear();clearCaches();}
    };
  }
  return {create,SDK_VERSION,CHUNK_BYTES,canonical,split,encodeSnapshot,loadSDK,rewriteAppImport};
});
