/** Static authoring fragments interpolated inside the portable workspace closure.
 * Reuses its host capability, revision and idempotency guards; no independent transport.
 */
export const MCP_AUTHORING_STYLE = String.raw`.authoring-actions{display:flex;gap:6px;margin:8px 0}.authoring-actions button{flex:1;min-width:0;padding:10px 8px;font-size:14px}
#preview-surface{position:relative;height:clamp(220px,calc(100dvh - 410px),640px);max-height:none;overflow:hidden}#preview-surface img{max-height:none}
#summary,#live-status,#history-status{font-size:12px;line-height:1.4;margin:4px 0}.design-toolbar{margin:8px 0}.preview-tools{margin:8px 0}
.authoring-sheet{position:fixed;inset:auto 12px max(12px,env(safe-area-inset-bottom));z-index:8;max-height:min(62dvh,640px);overflow:auto;overscroll-behavior:contain;padding:0 14px 14px;border:1px solid #72a48a;border-radius:16px;background:#f7faf8;box-shadow:0 -8px 32px #172e2938}
.sheet-heading{position:sticky;top:0;background:inherit;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0}.sheet-heading h2{margin:0;font-size:18px}
.authoring-sheet form{display:grid;gap:12px;margin-top:14px}.authoring-sheet label{display:grid;gap:6px;padding:0;border:0}.authoring-sheet input,.authoring-sheet textarea,.authoring-sheet select{width:100%;min-width:0;min-height:48px;padding:10px;border:1px solid #adc5b9;border-radius:8px;background:#fff;color:#172e29;font:inherit}.authoring-sheet textarea{resize:vertical}
.authoring-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.authoring-sheet input[type=checkbox]{width:20px;min-height:20px}.authoring-sheet #authoring-conflict{padding:10px;border:1px solid #c39a4d;border-radius:10px}.authoring-sheet #authoring-conflict button{width:100%;margin-top:8px}
@media(min-width:900px){#workspace-panel{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:0 14px}#workspace-panel>*{grid-column:1}#artwork-choices,.authoring-sheet{grid-column:2;grid-row:3/10}.authoring-sheet{position:sticky;inset:auto;top:12px;max-height:calc(100dvh - 24px)}}
@media(max-height:500px) and (orientation:landscape){#preview-surface{height:max(220px,calc(100dvh - 130px))}}
@media(prefers-color-scheme:dark){.authoring-sheet{background:#16241e}.authoring-sheet input,.authoring-sheet textarea,.authoring-sheet select{background:#102019;color:#e4f2eb;border-color:#456954}}`;

export const MCP_AUTHORING_ACTIONS_MARKUP = String.raw`<div class="authoring-actions" aria-label="Design tools"><button id="add-text" type="button" aria-controls="authoring-sheet">Add text</button><button id="add-shape" type="button" aria-controls="authoring-sheet">Add shape</button><button id="properties" type="button" aria-controls="authoring-sheet">Properties</button></div>`;

export const MCP_AUTHORING_MARKUP = String.raw`<section class="authoring-sheet" id="authoring-sheet" aria-labelledby="authoring-heading" hidden>
<div class="sheet-heading"><h2 id="authoring-heading">Design tools</h2><button id="close-authoring" type="button">Close</button></div>
<p id="authoring-access" class="muted" role="status"></p>
<p id="authoring-conflict" role="status" hidden>The PC changed while you were editing. Your values are kept. Review the canvas before applying them.<button id="review-authoring" type="button">Use the current PC design</button></p>
<button id="authoring-retry" type="button" hidden>Retry last request</button>
<form id="add-text-form" data-authoring="text" hidden>
<label>Text<textarea name="text" rows="3" required maxlength="4096"></textarea></label>
<label>Font<select name="fontId"><option value="">Desktop default</option></select></label>
<div class="authoring-fields"><label>Text size (mm)<input name="fontSizeMm" type="text" inputmode="decimal" value="10" required></label><label>Width (mm)<input name="widthMm" type="text" inputmode="decimal" value="50" required></label><label>X (mm)<input name="xMm" type="text" inputmode="decimal" value="0" required></label><label>Y (mm)<input name="yMm" type="text" inputmode="decimal" value="0" required></label></div>
<button type="submit">Add text to PC</button></form>
<form id="add-rectangle-form" data-authoring="shape" hidden>
<label>Shape<select name="shapeType"><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse / circle</option></select></label>
<p class="muted">Enter exact dimensions. Give an ellipse equal width and height to make a circle.</p>
<p id="shape-availability" class="muted" hidden>Use a Laser workspace and update KerfDesk on the PC to add ellipses.</p>
<div class="authoring-fields"><label>Width (mm)<input name="widthMm" type="text" inputmode="decimal" value="40" required></label><label>Height (mm)<input name="heightMm" type="text" inputmode="decimal" value="30" required></label><label>X (mm)<input name="xMm" type="text" inputmode="decimal" value="0" required></label><label>Y (mm)<input name="yMm" type="text" inputmode="decimal" value="0" required></label></div>
<button type="submit">Add shape to PC</button></form>
<div data-authoring="properties" hidden><p id="authoring-selection" class="muted"></p>
<form id="transform-form"><div class="authoring-fields"><label>Move X (mm)<input name="dxMm" type="text" inputmode="decimal" value="0" required></label><label>Move Y (mm)<input name="dyMm" type="text" inputmode="decimal" value="0" required></label></div><button type="submit">Move selection</button></form>
<form id="resize-form"><div class="authoring-fields"><label>Width (mm)<input name="widthMm" type="text" inputmode="decimal" required></label><label>Height (mm)<input name="heightMm" type="text" inputmode="decimal" required></label></div><button type="submit">Resize selection</button></form>
<form id="rotate-form"><label>Rotation (degrees)<input name="angleDeg" type="text" inputmode="decimal" value="0" required></label><button type="submit">Rotate selection</button></form>
</div></section>`;

export const MCP_AUTHORING_SCRIPT = String.raw`  let submittedForm = null, fontsLoaded = false, authoringTrigger = null;
  const authoringDrafts = new Map();
  function authoringControls(enabled) {
    const stale = form => authoringDrafts.has(form.id) && authoringDrafts.get(form.id) !== workspace?.revision;
    $('authoring-conflict').hidden = !currentAuthoringForms().some(stale);
    $('review-authoring').disabled = !enabled;
    $('authoring-retry').hidden = !pendingEdit;
    $('authoring-retry').disabled = busy || !connected || !toolCallsAvailable || !canEdit();
    $('retry').hidden = !pendingEdit || !$('authoring-sheet').hidden;
    $('authoring-access').textContent = !toolCallsAvailable ? 'This host can show your design but cannot apply edits. Use a host that supports interactive MCP tools.' : !canEdit() ? 'Editing is off. Reconnect with editing permission and approve it on the PC. Add text, shapes and properties become available after approval.' : workspace?.mode === 'cnc' ? 'New text and shapes are available in a Laser workspace. Existing artwork can be moved or rotated here.' : 'Changes are saved to the open design on your PC. Undo is available on both screens.';
    $('authoring-selection').textContent = $('items').querySelectorAll('input:checked').length + ' artwork selected. Choose artwork in Design to change the selection.';
    const ellipseAvailable=workspace?.capabilities?.touchEditing===true;
    $('add-rectangle-form').querySelector('option[value=ellipse]').disabled=!ellipseAvailable;
    $('shape-availability').hidden=ellipseAvailable;
    for (const input of $('authoring-sheet').querySelectorAll('input,textarea,select')) input.disabled = !enabled;
    for (const form of $('authoring-sheet').querySelectorAll('form')) {
      const creating = form.id === 'add-text-form' || form.id === 'add-rectangle-form';
      form.querySelector('button[type=submit]').disabled = !enabled || stale(form) || (creating && workspace?.mode === 'cnc') || (form.id==='add-rectangle-form'&&form.elements.shapeType.value==='ellipse'&&!ellipseAvailable);
    }
  }
  function showAuthoring(name, trigger) {
    $('authoring-sheet').hidden = false;
    $('authoring-sheet').dataset.authoring = name;
    authoringTrigger = trigger;
    $('authoring-heading').textContent = name === 'text' ? 'Add text' : name === 'shape' ? 'Add shape' : 'Artwork properties';
    for (const panel of $('authoring-sheet').querySelectorAll('[data-authoring]')) panel.hidden = panel.dataset.authoring !== name;
    if(name==='properties'&&!authoringDrafts.has('resize-form'))loadSelectionSize();
    controls();
    $('close-authoring').focus({preventScroll:true});
    if (name === 'text' && toolCallsAvailable && !fontsLoaded) void loadAuthoringFonts();
  }
  async function loadAuthoringFonts() {
    try {
      const result = unwrap(await request('tools/call',{name:'list_fonts',arguments:{}}));
      if(disposed || !toolCallsAvailable || !Array.isArray(result.fonts))return;
      const select = $('add-text-form').elements.fontId, chosen = select.value;
      select.replaceChildren(new Option('Desktop default',''));
      for(const font of result.fonts.slice(0,200))if(font&&typeof font.id==='string'&&font.id.length<=128&&typeof font.name==='string')select.append(new Option(text(font.name,128),font.id));
      select.value=chosen;fontsLoaded=true;
    } catch { message('Bundled fonts could not load. Desktop default is still available.',true); }
  }
  for (const [id,name] of [['add-text','text'],['add-shape','shape'],['properties','properties']]) $(id).addEventListener('click',()=>showAuthoring(name,$(id)));
  function closeAuthoring() {$('authoring-sheet').hidden=true;controls();authoringTrigger?.focus({preventScroll:true});}
  $('close-authoring').addEventListener('click',closeAuthoring);
  $('authoring-retry').addEventListener('click',()=>{void run(retry);});
  $('authoring-sheet').addEventListener('keydown',event=>{if(event.key==='Escape')closeAuthoring();});
  function currentAuthoringForms() {return [...$('authoring-sheet').querySelectorAll('form')].filter(form=>form.closest('[data-authoring]').dataset.authoring===$('authoring-sheet').dataset.authoring);}
  function trackAuthoring(event){const form=event.target.closest('form');if(!form)return;if(!authoringDrafts.has(form.id))authoringDrafts.set(form.id,workspace?.revision);controls();}
  $('authoring-sheet').addEventListener('input',trackAuthoring);
  $('authoring-sheet').addEventListener('change',trackAuthoring);
  $('review-authoring').addEventListener('click',()=>{if(!canEdit()||busy||pendingEdit)return;for(const form of currentAuthoringForms())if(authoringDrafts.has(form.id))authoringDrafts.set(form.id,workspace.revision);controls();message('Your values are kept. Review the current canvas and selection, then apply.');});
  function fieldNumber(form,name,min=-100000,max=100000) {
    const value=form.elements[name].value.trim().replace(',','.');
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))throw new Error('Enter a valid number in each required field. Empty fields are kept until you enter a value.');
    const number=Number(value);
    if(!Number.isFinite(number)||number<min||number>max)throw new Error('Use a number between '+min+' and '+max+'.');
    return number;
  }
  function positiveField(form,name,max=100000) {const value=fieldNumber(form,name,0,max);if(value<=0)throw new Error('Sizes must be greater than zero.');return value;}
  function formSelection() {
    if(selectionDirty&&selectionRevision!==workspace?.revision)throw new Error('The PC selection changed. Use the PC selection or select artwork again first.');
    const artworkIds=[...$('items').querySelectorAll('input:checked')].map(input=>input.value);
    if(!artworkIds.length)throw new Error('Select artwork in Design before moving or rotating it.');
    return artworkIds;
  }
  function loadSelectionSize() {
    const ids=[...$('items').querySelectorAll('input:checked')].map(input=>input.value);
    const bounds=ids.map(id=>workspace?.artwork.find(item=>item.id===id)?.bounds);
    const valid=bounds.length&&bounds.every(box=>box&&[box.xMm,box.yMm,box.widthMm,box.heightMm].every(Number.isFinite));
    const form=$('resize-form');
    for(const name of ['widthMm','heightMm'])form.elements[name].value='';
    if(!valid)return;
    const width=Math.max(...bounds.map(box=>box.xMm+box.widthMm))-Math.min(...bounds.map(box=>box.xMm));
    const height=Math.max(...bounds.map(box=>box.yMm+box.heightMm))-Math.min(...bounds.map(box=>box.yMm));
    if(width>0&&width<=100000&&height>0&&height<=100000){form.elements.widthMm.value=Number(width.toFixed(3));form.elements.heightMm.value=Number(height.toFixed(3));}
  }
  function shapeCommand(form) {
    const shape=form.elements.shapeType.value;
    if(!['rectangle','ellipse'].includes(shape))throw new Error('Choose Rectangle or Ellipse.');
    if(shape==='ellipse'&&workspace?.capabilities?.touchEditing!==true)throw new Error('Use a Laser workspace and update KerfDesk on the PC to add ellipses.');
    return {name:'add_'+shape,args:{widthMm:positiveField(form,'widthMm'),heightMm:positiveField(form,'heightMm'),xMm:fieldNumber(form,'xMm'),yMm:fieldNumber(form,'yMm')}};
  }
  const authoringCommands={
    'add-text-form':form=>({name:'add_text',args:{text:form.elements.text.value,...(form.elements.fontId.value?{fontId:form.elements.fontId.value}:{}),fontSizeMm:positiveField(form,'fontSizeMm',1000),widthMm:positiveField(form,'widthMm'),xMm:fieldNumber(form,'xMm'),yMm:fieldNumber(form,'yMm')}}),
    'add-rectangle-form':shapeCommand,
    'transform-form':form=>({name:'transform_artwork',args:{artworkIds:formSelection(),transform:{type:'move',dxMm:fieldNumber(form,'dxMm'),dyMm:fieldNumber(form,'dyMm')}}}),
    'resize-form':form=>({name:'transform_artwork',args:{artworkIds:formSelection(),transform:{type:'resize',widthMm:positiveField(form,'widthMm'),heightMm:positiveField(form,'heightMm')}}}),
    'rotate-form':form=>({name:'transform_artwork',args:{artworkIds:formSelection(),transform:{type:'rotate',angleDeg:fieldNumber(form,'angleDeg',-3600,3600)}}}),
  };
  for(const [id,build] of Object.entries(authoringCommands))$(id).addEventListener('submit',event=>{
    event.preventDefault();
    if(!connected||!toolCallsAvailable||disposed||!canEdit()||busy||pendingEdit)return;
    const form=event.currentTarget;
    void run(async()=>{const command=build(form);submittedForm=form;try{await mutate(command.name,command.args,authoringDrafts.get(form.id)??workspace.revision);}finally{if(!pendingEdit)submittedForm=null;}});
  });
`;
