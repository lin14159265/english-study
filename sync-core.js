/* Lossless three-way merge of private learning snapshots. No network or storage. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./workspace-core.js'):root.StudyWorkspaceCore,typeof module==='object'&&module.exports?require('./package-core.js'):root.StudyPack);if(typeof module==='object'&&module.exports)module.exports=api;else root.StudySyncCore=api;})(typeof window==='object'?window:globalThis,function(C,P){
  'use strict';
  const missing=Symbol('missing'), own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const unsafe=new Set(['__proto__','constructor','prototype']);
  function canonical(value){
    if(value===missing)return 'missing';
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  const equal=(a,b)=>a===b||canonical(a)===canonical(b);
  const clone=v=>v===missing?missing:JSON.parse(JSON.stringify(v));
  function safe(value,seen=new Set()){
    if(value===null||typeof value==='string'||typeof value==='boolean')return true;
    if(typeof value==='number')return Number.isFinite(value);
    if(typeof value!=='object'||seen.has(value))return false;
    seen.add(value);const ok=Object.entries(value).every(([k,v])=>!unsafe.has(k)&&safe(v,seen));seen.delete(value);return ok;
  }
  function validateSnapshot(snapshot){
    const errors=[];
    if(!safe(snapshot)||!object(snapshot)||!object(snapshot.state)||!Array.isArray(snapshot.packs))return {ok:false,errors:['云同步快照结构无效或包含不安全的数据。']};
    errors.push(...C.validateState(snapshot.state));const keys=new Set(),ids=new Set();
    for(const record of snapshot.packs){
      if(!object(record)||record.source!=='local'||typeof record.key!=='string'||!object(record.payload)){errors.push('私人资料包记录无效。');continue;}
      const checked=P.validate(record.payload);if(!checked.ok)errors.push(`私人资料 ${record.key}：${checked.errors[0]}`);
      if(record.key!==`local:${record.payload.id}`||keys.has(record.key)||ids.has(record.payload.id))errors.push('私人资料包键无效或重复。');
      keys.add(record.key);ids.add(record.payload.id);
    }
    if(snapshot.base!==undefined&&(!P.validate(snapshot.base).ok||snapshot.base.id!=='original-baseline'))errors.push('原始资料快照无效。');
    if(snapshot.rollback!==undefined&&snapshot.rollback!==null){
      if(!object(snapshot.rollback)||!object(snapshot.rollback.data)||!Array.isArray(snapshot.rollback.packs))errors.push('回退快照无效。');
      else {errors.push(...C.validateState(snapshot.rollback.data));const rollbackPacks=validateSnapshot({state:snapshot.rollback.data,packs:snapshot.rollback.packs});errors.push(...rollbackPacks.errors);}
    }
    return {ok:!errors.length,errors:[...new Set(errors)]};
  }
  // Keep private record metadata and all unknown personal-state fields. Compiled render
  // caches are derived locally and must not increase or invalidate cloud snapshots.
  function snapshot(state,packs,base){
    const out={state:clone(state),packs:packs.filter(p=>p.source==='local').map(p=>{const r=clone(p);delete r.compiled;return r;})};
    if(base!==undefined)out.base=clone(base);const result=validateSnapshot(out);if(!result.ok)throw new Error(result.errors.join('；'));return out;
  }
  function pathText(segments){return '/'+segments.map(s=>typeof s==='string'?s.replace(/~/g,'~0').replace(/\//g,'~1'):`[${s.field}=${s.value}]`).join('/');}
  function identity(value,field){return field==='record.id'?value?.record?.id:value?.[field];}
  function arrayField(values){
    const items=values.filter(v=>v!==missing).flat();if(!items.length)return null;
    for(const field of ['id','key','record.id']){
      if(items.every(v=>object(v)&&['string','number'].includes(typeof identity(v,field)))&&values.filter(v=>v!==missing).every(a=>new Set(a.map(v=>String(identity(v,field)))).size===a.length))return field;
    }return null;
  }
  function atomic(path){
    return path[0]==='base'||path[0]==='rollback'||path[0]==='packs'&&path.length===2||path[0]==='state'&&path[1]==='extra'&&(
      ['edits','editorDrafts','quizDrafts','quizAttempts','reviewRounds'].includes(path[2])&&path.length===4||['reviewSession','editUndo'].includes(path[2])&&path.length===3);
  }
  function cursor(path){
    if(path[0]!=='state'||path[1]!=='reader')return false;
    return ['current','currentKey','resumeKey','read','positions','review'].includes(path[2])||['positionKeys','anchorKeys'].includes(path[2])&&path.length===4;
  }
  function merge(base,local,remote){
    for(const value of [base,local,remote])if(value!==null&&value!==undefined){const result=validateSnapshot(value);if(!result.ok)throw new Error(result.errors.join('；'));}
    if(!local)throw new Error('缺少本机同步快照。');
    if(remote===null||remote===undefined)return {snapshot:clone(local),conflicts:[],changed:false};
    const conflicts=[];
    function discardChildren(path){const prefix=JSON.stringify(path).slice(0,-1)+',';for(let i=conflicts.length-1;i>=0;i--)if(conflicts[i].id.startsWith(prefix))conflicts.splice(i,1);}
    function conflict(b,l,r,path){
      const entry={id:JSON.stringify(path),path:pathText(path),segments:clone(path),kind:l===missing||r===missing?'delete-edit':'concurrent-edit',baseMissing:b===missing,localMissing:l===missing,remoteMissing:r===missing};
      if(b!==missing)entry.base=clone(b);if(l!==missing)entry.local=clone(l);if(r!==missing)entry.remote=clone(r);conflicts.push(entry);return clone(l);
    }
    function walk(b,l,r,path){
      if(equal(l,r))return clone(l);
      if(b!==missing&&equal(l,b))return clone(r);
      if(b!==missing&&equal(r,b))return clone(l);
      // A device with no baseline cannot interpret absence as a deletion.
      if(b===missing&&l===missing)return clone(r);
      if(b===missing&&r===missing)return clone(l);
      // A locally moved cursor wins while distinct article entries still merge.
      // These are navigation checkpoints, never a reason to block learning sync.
      if(cursor(path))return clone(l);
      if(l===missing||r===missing)return conflict(b,l,r,path);
      if(atomic(path))return conflict(b,l,r,path);
      if(object(l)&&object(r)&&(b===missing||object(b))){
        const out={};for(const k of new Set([...Object.keys(l),...Object.keys(r),...(b===missing?[]:Object.keys(b))])){
          const value=walk(b!==missing&&own(b,k)?b[k]:missing,own(l,k)?l[k]:missing,own(r,k)?r[k]:missing,[...path,k]);if(value!==missing)out[k]=value;
        }return out;
      }
      if(Array.isArray(l)&&Array.isArray(r)&&(b===missing||Array.isArray(b))){
        const arrays=[b,l,r],values=arrays.filter(a=>a!==missing).flat();
        if(values.every(v=>typeof v==='string')){
          const out=[];for(const value of new Set([...l,...r,...(b===missing?[]:b)])){
            const lp=l.includes(value),rp=r.includes(value),present=b===missing?lp||rp:lp===rp?lp:lp===b.includes(value)?rp:lp;if(present)out.push(value);
          }return out;
        }
        const field=arrayField(arrays);
        if(field){
          const maps=arrays.map(a=>a===missing?null:new Map(a.map(v=>[String(identity(v,field)),v]))),out=[];
          let primary=maps[1],secondary=maps[2];
          if(maps[0]){
            const common=[...maps[0].keys()].filter(id=>maps[1].has(id)&&maps[2].has(id)),ids=new Set(common),order=m=>[...m.keys()].filter(id=>ids.has(id));
            const localOrder=order(maps[1]),remoteOrder=order(maps[2]),localMoved=!equal(localOrder,common),remoteMoved=!equal(remoteOrder,common);
            if(localMoved&&remoteMoved&&!equal(localOrder,remoteOrder)){discardChildren(path);return conflict(b,l,r,path);}
            if(!localMoved&&remoteMoved){primary=maps[2];secondary=maps[1];}
          }
          for(const id of new Set([...primary.keys(),...secondary.keys(),...(maps[0]?maps[0].keys():[])])){
            const value=walk(...maps.map(m=>m?.has(id)?m.get(id):missing),[...path,{field,value:id}]);if(value!==missing)out.push(value);
          }
          // The existing undo-bin loader accepts at most ten records. Never
          // silently truncate a union or submit an invalid state that cannot load.
          if(path.join('/')==='state/learning/trash'&&out.length>10){
            discardChildren(path);
            return conflict(b,l,r,path);
          }
          return out;
        }
      }
      return conflict(b,l,r,path);
    }
    const result=walk(base??missing,local,remote??missing,[]);
    function taskConsistent(extra){
      const active=(extra.queue||[]).filter(t=>t.status==='active');return active.length<=1&&(extra.activeTask==null?active.length===0:active.length===1&&active[0].id===extra.activeTask);
    }
    // Starting a different task on each device changes separate queue records,
    // but the UI contract allows only one activeTask. Preserve each whole task
    // state, including the selected ID, rather than quietly demoting either task.
    if(!taskConsistent(result.state.extra)&&taskConsistent(local.state.extra)&&taskConsistent(remote.state.extra)){
      discardChildren(['state','extra']);result.state.extra=conflict(base?.state.extra??missing,local.state.extra,remote.state.extra,['state','extra']);conflicts.at(-1).kind='task-state-conflict';
    }
    // A structurally valid edit on each device can still form an invalid combined
    // record (for example, a review index and its item list). Keep both complete
    // state alternatives instead of applying or uploading such a combination.
    if(C.validateState(result.state).length){
      for(let i=conflicts.length-1;i>=0;i--)if(conflicts[i].segments[0]==='state')conflicts.splice(i,1);
      result.state=conflict(base?.state??missing,local.state,remote.state,['state']);conflicts.at(-1).kind='incompatible-merge';
    }
    return {snapshot:result,conflicts,changed:!equal(result,local)};
  }
  function resolve(result,choices){
    const out=clone(result.snapshot),remaining=[];
    for(const conflict of result.conflicts){
      const side=typeof choices==='string'?choices:choices?.[conflict.id];
      if(!['local','remote'].includes(side)){remaining.push(clone(conflict));continue;}
      let parent=out;const segments=conflict.segments;
      for(const segment of segments.slice(0,-1)){
        if(typeof segment==='string')parent=parent?.[segment];else parent=Array.isArray(parent)?parent.find(v=>String(identity(v,segment.field))===segment.value):undefined;
        if(parent===undefined)throw new Error('冲突位置已改变，请重新同步。');
      }
      const last=segments.at(-1),absent=conflict[side+'Missing'],value=absent?missing:clone(conflict[side]);
      if(typeof last==='string'){if(absent)delete parent[last];else parent[last]=value;}
      else if(last){
        const index=parent.findIndex(v=>String(identity(v,last.field))===last.value);
        if(absent){if(index>=0)parent.splice(index,1);}else if(index>=0)parent[index]=value;else parent.push(value);
      }else throw new Error('根快照冲突无法自动恢复。');
    }
    const checked=validateSnapshot(out);if(!checked.ok)throw new Error(checked.errors.join('；'));
    return {snapshot:out,conflicts:remaining,changed:result.changed||!equal(out,result.snapshot)};
  }
  return {canonical,equal,validateSnapshot,snapshot,merge,resolve};
});
