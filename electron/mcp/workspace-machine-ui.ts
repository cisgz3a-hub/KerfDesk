/** Embedded static Machine view; authority and action readiness come from desktop tools. */
export const MCP_MACHINE_STYLE = String.raw`
.tabs{display:flex;gap:8px;margin:14px 0}.tabs button{flex:1}.machine-card{border:1px solid #ccdcd5;border-radius:14px;padding:14px;margin:12px 0}
#machine-state{font-size:19px;font-weight:650}.machine-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.machine-fields label{display:block;border:0;padding:0;font-size:14px}
.machine-fields input{display:block;width:100%;height:48px;border:1px solid #adc5b9;border-radius:9px;font:inherit;font-size:16px;padding:10px;margin-top:6px;background:transparent;color:inherit}
.jog-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px auto;width:min(100%,260px)}.jog-pad button{height:48px;font-size:26px}.jog-pad>:first-child{grid-column:2}.jog-pad>:nth-child(2){grid-column:1}.jog-pad span{text-align:center;align-content:center}
.machine-actions{display:flex;gap:10px}.machine-actions button{flex:1}#machine-start{width:100%;margin-top:12px}#machine-stop{position:sticky;bottom:8px;background:#f7faf8;padding:10px;border:1px solid #ccdcd5;border-radius:12px;z-index:2}#machine-abort{width:100%;background:#fbe5e8;color:#803140;border-color:#bf747e}
.review-row{padding:8px 0;border-bottom:1px solid #ccdcd5}.review-row p{margin:4px 0}.machine-card p{margin:8px 0}
.machine-view #summary{display:none}.machine-view #title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.machine-card .actions h2,.machine-card .actions p{margin:0}#machine-position,#machine-access{font-size:13px}
@media(prefers-color-scheme:dark){.machine-card,#machine-stop{border-color:#3d5648}#machine-stop{background:#16241e}}
`;

export const MCP_MACHINE_MARKUP = String.raw`
<section id="machine-panel" hidden aria-label="Machine control">
<div class="machine-card"><div class="actions"><div><h2>Machine</h2><p id="machine-state" role="status" aria-live="polite">Machine status unavailable</p></div><button id="machine-check" type="button">Check status</button></div>
<p id="machine-access" class="muted"></p><p id="machine-position" class="muted"></p><p id="machine-message" role="status" aria-live="polite"></p></div>
<div class="machine-card"><h2>Move the head</h2><p class="muted">One tap moves one step.</p><form id="machine-jog-form"><div class="machine-fields">
<label>Step (mm)<input name="distanceMm" inputmode="decimal" type="text" value="1" autocomplete="off"></label><label>Speed (mm/min)<input name="feedMmPerMin" inputmode="decimal" type="text" placeholder="PC default" autocomplete="off"></label></div>
<div class="jog-pad" aria-label="XY jog pad"><button type="button" data-axis="y" data-direction="1" aria-label="Jog up">↑</button><button type="button" data-axis="x" data-direction="-1" aria-label="Jog left">←</button><span>XY</span><button type="button" data-axis="x" data-direction="1" aria-label="Jog right">→</button><button type="button" data-axis="y" data-direction="-1" aria-label="Jog down">↓</button></div>
<div id="machine-z" class="machine-actions" hidden><button type="button" data-axis="z" data-direction="1">Raise Z</button><button type="button" data-axis="z" data-direction="-1">Lower Z</button></div></form></div>
<div class="machine-card"><h2>Run the current job</h2><p id="machine-frame-state" class="muted">Frame this job before Start.</p><div class="machine-actions"><button id="machine-frame" type="button">Frame job</button><button id="machine-review" type="button">Review job</button></div>
<div id="machine-review-card" hidden><h2>Current job review</h2><p id="machine-review-page-info" class="muted" role="status"></p><div id="machine-review-pages" class="machine-actions" hidden><button id="machine-review-first" type="button">First review page</button><button id="machine-review-next" type="button">Next review facts</button></div><div id="machine-review-stats"></div><details><summary id="machine-warning-count">Warnings</summary><div id="machine-review-warnings"></div></details><div id="machine-review-operations"></div><p id="machine-acknowledgement"></p><p class="muted">Start job confirms this exact review and starts the machine.</p><button id="machine-start" type="button">Start job</button></div></div>
<div id="machine-stop"><button id="machine-abort" type="button">Abort job</button><p class="muted">Requires a PC connection. Use the machine’s own stop control if disconnected.</p></div>
</section>`;

export const MCP_MACHINE_SCRIPT = String.raw`
function bindMcpMachine(environment) {
  const q = (id) => document.getElementById('machine-' + id);
  const text = (value) => typeof value === 'string' ? value.slice(0,2048) : '';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const terminal = new Set(['completed','cancelled','failed']);
  const states = new Set(['accepted','preparing','awaiting_review','starting','running','unknown',...terminal]);
  const actions = {jog_machine:'jog',frame_job:'frame',review_machine_job:'review',start_job:'start',abort_job:'abort'};
  const attempts=new Map();
  let status=null, operation=null, reading=false, visible=false, timer=null, generation=0, sequence=0,suspended=false,pageReading=false;
  function note(value) { q('message').textContent=text(value); }
  function validStatus(value) { return !!value && typeof value.revision==='string' && value.revision.length>0 && value.revision.length<=200 && ['connected','disconnected','connecting'].includes(value.connection) && typeof value.job?.active==='boolean' && ['idle','jog','frame','unknown'].includes(value.motion?.kind) && typeof value.frame?.complete==='boolean'; }
  function validOperation(value) { return !!value && uuid.test(value.operationId) && ['jog','frame','job','abort'].includes(value.kind) && states.has(value.state) && typeof value.revision==='string' && (typeof value.committed==='boolean'||value.committed===null); }
  function validReview(value) {
    const bounded=(items,max)=>Array.isArray(items)&&items.length<=max&&items.every(item=>item&&typeof item==='object');
    return !!value && uuid.test(value.reviewId) && typeof value.revision==='string' && ['laser','cnc'].includes(value.mode) && (value.artworkShared===undefined||typeof value.artworkShared==='boolean') && bounded(value.stats,16) && bounded(value.warnings,200) && bounded(value.operations,200) && validPagination(value) && ['laser-verified','laser-unverified','cnc'].includes(value.acknowledgement?.kind) && value.frame?.complete===true;
  }
  function validPagination(value) {
    const p=value.pagination;if(p===undefined)return true;
    return ['offset','totalFacts','totalWarnings','totalOperations','totalStats','totalSummaries'].every(key=>Number.isSafeInteger(p?.[key])&&p[key]>=0) && p.offset<=p.totalFacts && (p.nextOffset===null||(Number.isSafeInteger(p.nextOffset)&&p.nextOffset>p.offset&&p.nextOffset<p.totalFacts)) && p.totalWarnings>=value.warnings.length && p.totalOperations>=value.operations.length && p.totalStats>=value.stats.length;
  }
  function control() { return environment.available() && status?.permissions?.canControl===true; }
  function inFlight(abort){return [...attempts.values()].some(item=>item.abort===abort&&item.admissionPending);}
  function uncertain(){return [...attempts.values()].some(item=>item.uncertain);}
  function unfinished(item){return item.receipt&&!terminal.has(item.receipt.state)&&item.receipt.state!=='awaiting_review';}
  function ownedWork(){return [...attempts.values()].some(item=>item.admissionPending||item.uncertain||unfinished(item));}
  function writable() { return control() && !inFlight(false) && !inFlight(true) && !uncertain() && ![...attempts.values()].some(unfinished); }
  function reviewReady() { return validReview(operation?.review) && operation.state==='awaiting_review' && (!status||operation.review.revision===status.revision); }
  function available(name) { return status?.availability?.[actions[name]]?.available===true; }
  function label() {
    if(!environment.available()) return 'Machine tools unavailable in this host';
    if(!status) return 'Machine status unavailable';
    if(status.connection!=='connected') return status.connection==='connecting'?'Connecting to controller…':'Controller disconnected';
    if(inFlight(true)) return 'Abort requested — checking the PC…';
    if(uncertain()) return 'Result not confirmed — check status';
    if(operation?.state==='preparing') return operation.kind==='frame'?'Preparing Frame…':'Preparing current job review…';
    if(operation?.state==='awaiting_review') return 'Current job ready for review';
    if(status.motion.kind==='frame') return 'Framing…';
    if(status.motion.kind==='jog') return 'Jogging…';
    if(status.job.active) { const labels={starting:'Starting job…',running:'Running',paused:'Paused',tool_change:'Waiting for tool change on the PC',unknown:'Job state unknown'}; return (labels[status.job.state]||'Job active')+(Number.isFinite(status.job.progressPercent)?' · '+status.job.progressPercent.toFixed(0)+'%':''); }
    if(operation?.state==='accepted') return 'Request accepted — waiting for the PC';
    return text(status.controllerState)||'Controller state unknown';
  }
  function readyButton(name,allowed) { const hint=status?.availability?.[name]; q(name).disabled=!allowed||hint?.available!==true; q(name).title=text(hint?.reason); }
  function render() {
    q('panel').setAttribute('aria-busy',String(inFlight(false))); q('check').disabled=reading||!environment.available();
    q('state').textContent=label();
    q('access').textContent=!environment.available()?'Ask the assistant to read machine status; this host cannot call tools.':status?.permissions?.canControl===undefined?'The PC app cannot confirm machine control. Update KerfDesk on the PC, then check status.':control()?'Machine control approved on the PC.':'Viewing machine status. Request machine control and approve access on the PC.';
    if(control()&&!status.availability)q('access').textContent='The PC app cannot confirm action readiness. Update KerfDesk on the PC, then check status.';
    position(); q('frame-state').textContent=status?.frame?.complete?'Frame completed. Review the current job before Start.':'Frame this job before Start.'; q('frame').textContent=status?.frame?.complete?'Frame again':'Frame job';
    readyButton('frame',writable()); readyButton('review',writable()&&status?.frame?.complete); readyButton('start',writable()&&status?.frame?.complete&&reviewReady()); readyButton('abort',control()&&!inFlight(true));
    if(pageReading)q('start').disabled=true;
    q('abort').textContent=['preparing','awaiting_review'].includes(operation?.state)?'Cancel preparation':'Abort job';
    const jog=status?.jog||{}, hint=status?.availability?.jog||{}; q('z').hidden=jog.zSupported!==true;
    for(const button of q('jog-form').querySelectorAll('[data-axis]')) { button.disabled=!writable()||hint.available!==true||(button.dataset.axis==='z'?jog.zSupported:jog.xySupported)!==true; button.title=text(hint.reason); }
    renderReview();
  }
  function position() {
    const p=status?.position;
    if(p?.space!=='work'||![p.xMm,p.yMm].every(Number.isFinite)) { q('position').textContent='Work position unavailable.'; return; }
    const wcs=/^G5[4-9]$/.test(p.wcs)?' ('+p.wcs+')':'';
    q('position').textContent='Work position'+wcs+' · X '+p.xMm.toFixed(2)+' · Y '+p.yMm.toFixed(2)+(Number.isFinite(p.zMm)?' · Z '+p.zMm.toFixed(2):'')+' mm';
  }
  function row(parent,title,content) { const item=document.createElement('div'), heading=document.createElement('strong'), body=document.createElement('p'); item.className='review-row'; heading.textContent=text(title); body.textContent=text(content); item.append(heading,body);parent.append(item); }
  function renderReview() {
    const ready=reviewReady(); q('review-card').hidden=!ready;
    for(const name of ['review-stats','review-warnings','review-operations']) q(name).replaceChildren(); q('acknowledgement').textContent='';
    q('review-page-info').textContent='';q('review-pages').hidden=true;
    if(!ready)return;
    const review=operation.review;
    const p=review.pagination;q('review-pages').hidden=!p||(p.offset===0&&p.nextOffset===null);q('review-first').disabled=pageReading||!p||p.offset===0;q('review-next').disabled=pageReading||!p||p.nextOffset===null;
    q('review-page-info').textContent=!p?'This PC version does not report complete review counts. Check all details on the PC or update KerfDesk.':pageReading?'Reading more facts from this same job review…':'Review facts '+(p.totalFacts?p.offset+1:0)+'–'+(p.nextOffset??p.totalFacts)+' of '+p.totalFacts+' · '+p.totalWarnings+' warnings · '+p.totalOperations+' operations. Inspect the remaining pages before confirming Start.';
    for(const item of review.stats) row(q('review-stats'),item.label,text(item.value)+(item.detail?' · '+text(item.detail):''));
    q('warning-count').textContent=p?'Warnings ('+p.totalWarnings+' total · '+review.warnings.length+' on this page)':'Warnings ('+review.warnings.length+' shown)';
    for(const warning of review.warnings) row(q('review-warnings'),'Warning',warning.message);
    for(const item of review.operations) for(const summary of Array.isArray(item.summaries)?item.summaries.slice(0,20):[]) row(q('review-operations'),'Operation',summary);
    q('acknowledgement').textContent=text(review.acknowledgement.prompt)||(review.acknowledgement.kind==='laser-verified'?'The current controller laser mode is verified.':'Confirm this current review before Start.');
  }
  function needsReceipt(item){return item.uncertain||(unfinished(item)&&item.requestId!==status?.operation?.operationId);}
  function schedule() { clearTimeout(timer); if((visible||ownedWork())&&environment.available()&&!document.hidden&&!suspended) timer=setTimeout(()=>{void check();},Math.max(status?2000:5000,2000*(1+[...attempts.values()].filter(needsReceipt).length))); }
  function confirm(value){const item=attempts.get(value.operationId);if(!item)return;item.receipt=value;item.uncertain=value.state==='unknown';if(!item.admissionPending&&terminal.has(value.state))attempts.delete(item.requestId);}
  async function readReceipts(before,actionSequence){
    for(const item of [...attempts.values()].filter(needsReceipt)){
      const value=await environment.tool('get_control_operation',{operationId:item.requestId});if(before!==generation||actionSequence!==sequence)return;
      if(!validOperation(value?.operation)||value.operation.operationId!==item.requestId)throw new Error('The PC could not confirm the action. Check status.');confirm(value.operation);
      if(!validOperation(status?.operation)&&item.sequence===sequence)adoptOperation(value.operation);
    }
  }
  async function check() {
    if(reading||!environment.available()||suspended||document.hidden)return;
    const before=generation, actionSequence=sequence; reading=true;render();
    try {
      const value=await environment.tool('get_machine_status'); if(before!==generation||actionSequence!==sequence)return;
      if(!validStatus(value))throw new Error('Machine status is incomplete. Update the PC app and check again.');
      status=value;
      if(validOperation(value.operation)){adoptOperation(value.operation);confirm(value.operation);}
      try {
        await readReceipts(before,actionSequence);
        if(uncertain())note('Result not confirmed. Check status; no action will be sent again.');else if(operation?.message)note(operation.message);
      }catch(error){if(before===generation)note(error.message);}
    }catch(error){if(before===generation&&actionSequence===sequence){status=null;note(error.message);}}
    finally {reading=false;render();schedule();}
  }
  function adoptOperation(value) {
    if(value.operationId===operation?.operationId&&value.review?.reviewId===operation?.review?.reviewId&&value.review?.revision===operation?.review?.revision&&typeof value.review?.artworkShared==='boolean'&&value.review.artworkShared===operation?.review?.artworkShared&&operation?.review?.pagination?.offset>0)value={...value,review:operation.review};
    operation=value;
  }
  async function loadReviewPage(offset) {
    const original=operation;if(pageReading||!Number.isSafeInteger(offset)||offset<0||!reviewReady())return;
    const before=generation,actionSequence=sequence,review=original.review;pageReading=true;render();
    try {
      const value=await environment.tool('get_control_operation',{operationId:original.operationId,reviewPage:{reviewId:review.reviewId,offset}});
      if(before!==generation||actionSequence!==sequence||operation?.review?.reviewId!==review.reviewId)return;
      if(value?.operation?.operationId!==original.operationId||!validReview(value.operation.review)||value.operation.review.reviewId!==review.reviewId||value.operation.review.revision!==review.revision||value.operation.review.artworkShared!==operation?.review?.artworkShared||value.operation.review.pagination?.offset!==offset)throw new Error('The job review changed. Check status and review the current job.');
      operation=value.operation;note('');
    }catch(error){if(before===generation&&actionSequence===sequence){operation=null;note(error.message||'Review page unavailable. Check status before Start.');}}
    finally{if(before===generation)pageReading=false;render();}
  }
  async function submit(name,args={}) {
    const abort=name==='abort_job';
    if(!available(name)||(abort?!control()||inFlight(true):!writable())||(name==='start_job'&&(!reviewReady()||pageReading)))return;
    const before=generation, requestId=crypto.randomUUID(), request={requestId,...(abort?{}:{expectedRevision:status.revision}),...args};
    const item={requestId,sequence:++sequence,abort,admissionPending:true,uncertain:false};attempts.set(requestId,item);
    note(abort?'Sending Abort to the PC…':'Sending request to the PC…');render();
    try {
      const value=await environment.tool(name,request);if(before!==generation)return;
      if(!validOperation(value?.operation)||value.operation.operationId!==requestId)throw Object.assign(new Error('The result was not confirmed. Check status.'),{ambiguous:true});
      confirm(value.operation);if(item.sequence===sequence){operation=value.operation;note('Request accepted. Checking the machine…');}
    }catch(error){if(before===generation){if(error.ambiguous)item.uncertain=true;else attempts.delete(requestId);note(error.ambiguous?'Result not confirmed. Check status; no action will be sent again.':error.message);}}
    finally{if(before===generation){item.admissionPending=false;if(!item.uncertain&&!unfinished(item))attempts.delete(requestId);render();void check();}}
  }
  function numeric(name,min,max) { const field=q('jog-form').elements[name], draft=field.value.trim().replace(',','.'); if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(draft)||!Number.isFinite(Number(draft))||Number(draft)<min||Number(draft)>max){field.focus();throw new Error((name==='distanceMm'?'Step':'Speed')+' must be between '+min+' and '+max+'.');} return Number(draft); }
  async function jog(button) {if(!writable())return;try {const args={axis:button.dataset.axis,direction:Number(button.dataset.direction),distanceMm:numeric('distanceMm',0.01,100)};if(q('jog-form').elements.feedMmPerMin.value.trim())args.feedMmPerMin=numeric('feedMmPerMin',1,100000);await submit('jog_machine',args);}catch(error){note(error.message);}}
  for(const [button,name]of [['frame','frame_job'],['review','review_machine_job'],['abort','abort_job']])q(button).addEventListener('click',()=>{void submit(name);});
  q('start').addEventListener('click',()=>{void submit('start_job',{reviewId:operation?.review?.reviewId});});q('check').addEventListener('click',()=>{void check();});
  q('review-first').addEventListener('click',()=>{void loadReviewPage(0);});q('review-next').addEventListener('click',()=>{void loadReviewPage(operation?.review?.pagination?.nextOffset);});
  q('jog-form').addEventListener('submit',event=>event.preventDefault());for(const button of q('jog-form').querySelectorAll('[data-axis]'))button.addEventListener('click',()=>{void jog(button);});
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if((visible||ownedWork())&&!document.hidden)void check();});
  window.addEventListener('pagehide',()=>{suspended=true;clearTimeout(timer);});window.addEventListener('pageshow',()=>{suspended=false;if(visible||ownedWork())void check();});
  render();
  return {
    ready(){render();if(visible&&environment.available())void check();},
    show(value){visible=value;document.body.classList.toggle('machine-view',value);clearTimeout(timer);if(value)void check();else if(ownedWork())schedule();},
    reset(){generation++;pageReading=false;clearTimeout(timer);status=operation=null;attempts.clear();note('');render();},
    isBusy(){return reading||pageReading||ownedWork();},
    receive(value){
      if(validStatus(value)) {status=value;if(validOperation(value.operation))adoptOperation(value.operation);render();return;}
      if(validOperation(value?.operation)) {adoptOperation(value.operation);render();return;}
      generation++;status=operation=null;attempts.clear();note('Machine response is incomplete. Check status before using controls.');render();
    }
  };
}
`;
