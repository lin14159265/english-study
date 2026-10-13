/* Native dialog navigation. Ephemeral UI state only; no learning-data writes. */
(function(root){
  'use strict';
  const stack=[],prepared=new WeakMap(),$=id=>typeof id==='string'?document.getElementById(id):id;
  let trigger=null;
  document.addEventListener('click',e=>{trigger=e.target.closest('button,a,input,select,textarea,summary');queueMicrotask(()=>{trigger=null;});},{capture:true});
  const title=d=>d.querySelector('.dialog-heading h2')?.textContent||'上一级';
  function toggles(d){
    for(const input of d.querySelectorAll('.switch-row input[type=checkbox],#guessMode')){
      if(input.closest('.panel-toggle'))continue;
      const wrapper=document.createElement('span'),track=document.createElement('span');
      wrapper.className='panel-toggle';track.className='panel-toggle-track';track.setAttribute('aria-hidden','true');
      input.before(wrapper);wrapper.append(input,track);
    }
  }
  function prepare(d){
    toggles(d);
    if(prepared.has(d))return prepared.get(d);
    const heading=d.querySelector('.dialog-heading'),closeButton=heading?.querySelector('.close-dialog');
    let back,crumb;
    if(heading&&closeButton){
      const copy=document.createElement('div');copy.className='panel-heading-copy';
      for(const node of [...heading.childNodes])if(node!==closeButton)copy.append(node);
      heading.prepend(copy);crumb=document.createElement('p');crumb.className='panel-breadcrumb';copy.prepend(crumb);
      back=document.createElement('button');back.type='button';back.className='icon-button panel-back';back.hidden=true;
      back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>';
      heading.prepend(back);back.addEventListener('click',()=>close(d));
    }
    const ui={back,crumb,closeButton,label:closeButton?.getAttribute('aria-label')};prepared.set(d,ui);
    d.addEventListener('cancel',e=>{e.preventDefault();close(d);});
    // Also support native method=dialog submission and existing business actions
    // that close a panel after saving. Transition closes are not current entries.
    d.addEventListener('close',()=>{if(stack.at(-1)?.dialog===d&&!d.open)close(d);});
    return ui;
  }
  function decorate(){
    const entry=stack.at(-1);if(!entry)return;
    const d=entry.dialog,ui=prepare(d),parent=stack.at(-2)?.dialog;
    d.classList.toggle('panel-child',!!parent);
    if(ui.back){ui.back.hidden=!parent;ui.back.setAttribute('aria-label',parent?'返回'+title(parent):'返回');ui.back.title=ui.back.getAttribute('aria-label');}
    if(ui.crumb){ui.crumb.hidden=!parent;ui.crumb.textContent=stack.slice(0,-1).map(e=>title(e.dialog)).join(' / ');}
    if(ui.closeButton)ui.closeButton.setAttribute('aria-label',parent?'关闭'+title(d)+'并返回'+title(parent):ui.label||'关闭'+title(d));
  }
  function focus(element,fallback){
    if(element?.isConnected&&!element.disabled&&!element.inert&&element.getClientRects().length)element.focus({preventScroll:true});
    else fallback?.querySelector('.close-dialog')?.focus({preventScroll:true});
  }
  function open(id,{root:asRoot=false,opener=trigger||document.activeElement}={}){
    const d=$(id);if(!d)return;
    if(asRoot)leave();
    const current=stack.at(-1);
    if(current?.dialog===d){decorate();if(!d.open)d.showModal();return;}
    // Re-entering an existing ancestor must not create a loop or duplicate stack.
    const ancestor=stack.findIndex(e=>e.dialog===d);
    if(ancestor>=0){while(stack.length>ancestor+1){const e=stack.pop();if(e.dialog.open)e.dialog.close();}decorate();d.showModal();d.scrollTop=stack.at(-1).scroll;return;}
    if(current){current.scroll=current.dialog.scrollTop;current.focus=opener;if(current.dialog.open)current.dialog.close();}
    for(const other of document.querySelectorAll('dialog[open]'))if(other!==d)other.close();
    stack.push({dialog:d,opener,scroll:0,focus:null});decorate();d.showModal();d.scrollTop=0;
  }
  function close(id){
    const d=$(id),entry=stack.at(-1);
    if(!entry||entry.dialog!==d){if(d?.open)d.close();return;}
    stack.pop();if(d.open)d.close();
    const parent=stack.at(-1);
    if(parent){decorate();if(!parent.dialog.open)parent.dialog.showModal();parent.dialog.scrollTop=parent.scroll;focus(parent.focus,parent.dialog);}
    else focus(entry.opener);
  }
  function leave(){
    stack.length=0;
    for(const d of document.querySelectorAll('dialog[open]'))d.close();
  }
  root.StudyPanels={open,close,leave,depth:()=>stack.length};
})(window);
