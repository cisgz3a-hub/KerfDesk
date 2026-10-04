/** Pure static UI helpers: read-only refresh and local preview zoom, no storage or networking. */
export const MCP_LIVE_SCRIPT = String.raw`
function bindMcpLive({ready,blocked,refresh,changed}) {
  let timer=null,running=false,enabled=true,stopped=true,suspended=false,failures=0,generation=0,readTask=null;
  function active(){return !stopped&&!suspended&&enabled&&!document.hidden;}
  function schedule(delay=failures?10000:5000) {
    clearTimeout(timer);
    if(stopped||suspended||!ready())return;
    if(!enabled||document.hidden){changed('paused');return;}
    timer=setTimeout(()=>{void update();},delay);
  }
  async function update() {
    clearTimeout(timer);if(stopped||suspended||!ready())return false;
    if(!enabled||document.hidden){changed('paused');return;}
    if(running||blocked()){changed('waiting');schedule();return false;}
    const before=generation;
    running=true;
    try{const result=await withRead(refresh);if(before===generation&&active()&&result!==false){failures=0;changed('live');}}
    catch{if(before===generation&&active()){failures++;changed('disconnected');}}
    finally{running=false;if(before!==generation)void update();else schedule();}
  }
  function visibility(){clearTimeout(timer);if(document.hidden)changed('paused');else void update();}
  document.addEventListener('visibilitychange',visibility);
  async function withRead(callback){while(readTask)await readTask.catch(()=>{});const task=Promise.resolve().then(callback);readTask=task;try{return await task;}finally{if(readTask===task)readTask=null;}}
  function hide(){suspended=true;generation++;clearTimeout(timer);changed('paused');}
  function show(){suspended=false;void update();}
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  return {
    active,
    withRead,
    start(){generation++;stopped=false;changed(active()?'connecting':'paused');schedule();},
    confirm(){if(ready())changed(active()?'live':'paused');},
    stop(){generation++;stopped=true;clearTimeout(timer);changed('disconnected');},
    pause(value){enabled=!value;visibility();},
    dispose(){generation++;stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);},
    refresh:update,
  };
}
function bindMcpPreviewZoom() {
  const image=document.getElementById('preview'),surface=document.getElementById('preview-surface');let scale=1;
  function zoom(next){scale=Math.max(1,Math.min(3,next));image.style.width=scale*100+'%';surface.classList.toggle('preview-zoomed',scale>1);if(scale===1){surface.scrollLeft=surface.scrollTop=0;}}
  for(const [id,step]of [['zoom-in',.5],['zoom-out',-.5],['zoom-fit',0]])document.getElementById(id).addEventListener('click',()=>zoom(step?scale+step:1));
  new MutationObserver(()=>{for(const button of document.querySelectorAll('.preview-tools button'))button.disabled=image.hidden;if(image.hidden)zoom(1);}).observe(image,{attributes:true,attributeFilter:['hidden']});
}
`;

export const MCP_DESIGN_STYLE = String.raw`
body{padding:14px}header{margin-bottom:8px}#summary{margin:4px 0;font-size:13px}#live-status{margin:8px 0;font-size:13px}
.tabs{position:sticky;top:0;z-index:3;padding:6px;border:1px solid #ccdcd5;border-radius:14px;background:#f7faf8}.tabs button{min-width:0;padding:10px;font-size:14px;background:transparent}.tabs button[aria-pressed=true]{background:#d8f3e5}
.design-toolbar{display:flex;gap:8px;margin:12px 0}.design-toolbar button{flex:1}.preview{max-height:420px;overflow:auto;touch-action:pan-x pan-y pinch-zoom}.preview img{max-width:none}.preview.preview-zoomed img{max-height:none}
.preview-tools{display:flex;gap:8px;justify-content:center;margin:12px 0}.preview-tools button{min-width:48px;padding:10px}#artwork-choices{margin-top:12px;border:1px solid #ccdcd5;border-radius:12px;padding:0 12px}#artwork-choices summary{font-size:16px;font-weight:600}
#settings-panel{padding:14px;border:1px solid #ccdcd5;border-radius:14px}#settings-panel label{padding:0;border:0}#settings-panel input{width:20px;height:20px}.machine-view #live-status{display:none}.machine-card h2{margin:8px 0}#selection-conflict{padding:12px;background:#fbe5e8;color:#803140;border-radius:10px}#selection-conflict button{width:100%;margin-top:8px}
@media(prefers-color-scheme:dark){.tabs{background:#16241e;border-color:#3d5648}.tabs button[aria-pressed=true]{background:#254b36}#settings-panel,#artwork-choices{border-color:#3d5648}}
`;

export const MCP_SETTINGS_MARKUP = String.raw`
<section id="settings-panel" hidden><h2>Connection and updates</h2><label><input id="live-updates" type="checkbox" checked> Keep the design in sync</label><p class="muted">PC edits appear automatically. Updates pause while this view is hidden. Selections you have not applied stay here.</p><details><summary>Access and setup</summary><p class="muted">Keep KerfDesk open on the paired PC. Ask the assistant to add text, change fonts or arrange artwork. Editing and machine control each need approval on the PC. Use Frame, review the current job, then confirm Start in Machine.</p></details></section>`;
