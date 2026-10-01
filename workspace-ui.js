(function(root){
  'use strict';const C=root.StudyWorkspaceCore,S=root.StudyState,P=root.StudyPack,$=id=>document.getElementById(id),esc=s=>P.escape(s??'');
  function download(payload,name){const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function create({data,current,persist,toast}){
    let incoming=null,restoreDraft=null;
    const base=()=>C.originalPack(root.READING_DATA);
    function snapshot(){persist();return {format:'english-study-backup',version:1,exportedAt:new Date().toISOString(),base:base(),packs:root.StudyLibrary.payloads(),state:C.clone({reader:S.get('reader',{}),learning:S.get('learning',root.StudyLearningCore.empty()),extra:S.get('extra',C.emptyExtra())})};}
    function preview(){
      $('restoreConfirm').disabled=true;restoreDraft=null;if(!incoming)return;
      try{const mode=$('restoreMode').value,plan=C.restorePlan(snapshot(),incoming,mode,$('restorePreference').value);restoreDraft=plan.backup;const s=plan.summary;
        $('restorePreview').innerHTML=`<p><strong>${s.packs} 份新增资料 · ${s.cards} 张义项卡 · ${s.notes} 条错句 · ${s.tasks} 个任务 · ${s.attempts} 次小测</strong></p><p>${mode==='replace'?'将完整替换当前学习数据，恢复前版本可回退。':'与当前数据合并，重复记录去重。'} ${plan.conflicts.length?'以下冲突采用所选版本，不按设备时间自动覆盖。':'未发现内容冲突。'}</p>${plan.conflicts.length?`<details open><summary>${plan.conflicts.length} 项冲突</summary><ul>${plan.conflicts.slice(0,100).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}<p class="settings-note">本机修订、草稿和个人记录不会因恢复而上传。缺失的原位置仍保留学习快照。</p>`;
        $('restoreConfirm').disabled=false;
      }catch(e){$('restorePreview').textContent=e.message;}
    }
    function parse(text){const r=C.parseBackup(text);incoming=r.ok?r.backup:null;$('restorePreview').hidden=false;if(!r.ok){restoreDraft=null;$('restoreConfirm').disabled=true;$('restorePreview').textContent=r.errors.join('；');}else preview();}
    $('backupOpen').addEventListener('click',()=>{$('libraryDialog').close();$('backupDialog').showModal();});
    $('backupDownload').addEventListener('click',async()=>{try{const b=snapshot(),r=C.validateBackup(b);if(!r.ok)throw new Error(r.errors[0]);await S.flush().catch(()=>{});download(b,`english-study-backup-${new Date().toISOString().slice(0,10)}.json`);$('backupStatus').textContent='备份已生成，请保留下载的 JSON 文件。';}catch(e){$('backupStatus').textContent=e.message;}});
    $('backupFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;if(file.size>100*1024*1024){$('restorePreview').hidden=false;$('restorePreview').textContent='备份超过 100 MB，未读取或修改记录。';return;}parse(await file.text());});
    $('backupParse').addEventListener('click',()=>parse($('backupPaste').value));
    $('restoreMode').addEventListener('change',preview);$('restorePreference').addEventListener('change',preview);
    $('restoreConfirm').addEventListener('click',async()=>{if(!restoreDraft)return;$('restoreConfirm').disabled=true;try{await S.restore(restoreDraft,base());$('backupStatus').textContent='恢复成功，正在重新打开阅读器。';location.reload();}catch(e){$('backupStatus').textContent=e.message;$('restoreConfirm').disabled=false;}});
    $('backupRollback').addEventListener('click',async()=>{try{await S.rollback();location.reload();}catch(e){$('backupStatus').textContent=e.message;}});
    return {snapshot,changed(){},articleChanged(){}};
  }
  root.StudyWorkspace={create,download};
})(window);
