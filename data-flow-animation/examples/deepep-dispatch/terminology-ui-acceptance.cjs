const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require('playwright');
const base=__dirname,origin=process.env.DEEPEP_PREVIEW_ORIGIN||'http://127.0.0.1:54686';
const checks=[],samples=[],errors=[];
const tip=p=>p.locator('#numericTooltip');
const term=(p,id,scope='')=>p.locator(`${scope} [data-term-id=${JSON.stringify(id)}]`).first();
async function geometry(p,el,name){
  const box=await tip(p).boundingBox(),a=await el.boundingBox(),v=p.viewportSize();
  assert.ok(box&&a,name+' has real geometry');
  assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=v.width+1&&box.y+box.height<=v.height+1,name+' fits viewport '+JSON.stringify({box,v}));
  const iw=Math.max(0,Math.min(a.x+a.width,box.x+box.width)-Math.max(a.x,box.x));
  const ih=Math.max(0,Math.min(a.y+a.height,box.y+box.height)-Math.max(a.y,box.y));
  assert.ok(iw<=1||ih<=1,name+' does not cover its own anchor');
  return {box,anchor:a,viewport:v};
}
async function hover(p,el,rx,name){
  const before=await p.evaluate(()=>window.dispatchDemo?.api.getState());
  await el.scrollIntoViewIfNeeded();await el.hover();await tip(p).waitFor({state:'visible'});
  const text=await tip(p).innerText();assert.match(text,rx,name);
  const bounds=await geometry(p,el,name),record=await p.evaluate(()=>window.termExplanation);
  if(before){const after=await p.evaluate(()=>window.dispatchDemo.api.getState());for(const key of ['preset','step','selected'])assert.deepEqual(after[key],before[key],name+' state '+key);}
  samples.push({name,text,record,...bounds});return record;
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:720}}),control=await context.newPage(),visual=await context.newPage();
    const observe=p=>p.on('pageerror',e=>errors.push(e.message));observe(control);observe(visual);
    const session='root-terminology-'+Date.now();
    await control.goto(origin+'/animation/control.html?session='+session);await control.waitForFunction(()=>window.dispatchDemo?.api.getState().authoritative);
    await visual.goto(origin+'/animation/visual.html?session='+session);await visual.waitForFunction(()=>window.dispatchDemo?.api.getState().connected);
    await control.locator('#preset').selectOption('mixed');await control.locator('#stageJump').selectOption('0');
    await visual.waitForFunction(()=>window.dispatchDemo.api.getState().preset==='mixed'&&window.dispatchDemo.api.getState().step===0);
    for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:1920,height:1080}]){
      await visual.setViewportSize(viewport);await control.setViewportSize(viewport);
      await hover(visual,term(visual,'M','#visualConfig'),/最大.*容量|容量.*最大/,'capacity M '+viewport.width+'x'+viewport.height);
      await hover(visual,term(visual,'AIV','#visualConfig'),/AI Vector/,'AIV '+viewport.width+'x'+viewport.height);
      await visual.keyboard.press('Escape');
      checks.push('real CSS viewport '+viewport.width+'x'+viewport.height+' terminology geometry');
    }
    await visual.setViewportSize({width:1280,height:720});await control.setViewportSize({width:1280,height:720});
    const anchor=term(visual,'M','#visualConfig');await anchor.focus();await tip(visual).waitFor({state:'visible'});await visual.keyboard.press('Enter');
    await tip(visual).locator('[data-term-reference="T"]').first().click();assert.match(await tip(visual).innerText(),/有效输入/);
    assert.equal(await visual.locator('#numericTooltip:visible').count(),1);await visual.keyboard.press('Escape');await tip(visual).waitFor({state:'hidden'});
    checks.push('keyboard focus and Enter pin; related term uses one panel; Escape closes');
    await control.locator('#preset').selectOption('empty');await control.locator('#stageJump').selectOption('0');
    await visual.waitForFunction(()=>window.dispatchDemo.api.getState().preset==='empty');
    await hover(visual,term(visual,'T','#visualConfig'),/T=0|当前 0≤4/,'empty visible T');
    const popupPromise=control.waitForEvent('popup');await control.locator('#fullSource').click();const source=await popupPromise;observe(source);
    await source.waitForFunction(()=>window.dispatchSource?.model);
    assert.equal(new URL(source.url()).searchParams.get('preset'),'empty');
    assert.equal(await source.evaluate(()=>window.dispatchSource.model.config.T),0);
    assert.match(await source.locator('#meta').innerText(),/empty/);
    checks.push('complete source link retains caller empty preset and T=0 capacity context');
    const files=JSON.parse(fs.readFileSync(path.join(base,'animation/sources.json'),'utf8')).files;
    for(const [file,lines]of Object.entries(files)){
      await source.goto(origin+'/animation/source.html?file='+encodeURIComponent(file)+'&line=1&preset=empty&step=0');
      await source.waitForFunction(()=>window.dispatchSource?.model);
      const shown=await source.locator('#source .sourceText').allTextContents();
      assert.deepEqual(shown,lines,'exact frozen source text '+file);
      assert.equal(await source.locator('[data-unresolved-term]').count(),0,'source unresolved '+file);
    }
    checks.push('all nine complete source pages preserve 3732 original lines and have zero unresolved variable bindings');
    const E='deep_ep/include/deep_ep/impls/ep/dispatch_copy_epilogue.hpp';
    await source.goto(origin+'/animation/source.html?file='+encodeURIComponent(E)+'&line=484&preset=empty&step=0');await source.waitForFunction(()=>window.dispatchSource);
    const dst=term(source,'src.dst_slot_idx','#L484');
    await hover(source,dst,/输出行/,'epilogue dst_slot_idx scoped');await dst.click();
    await tip(source).locator('[data-term-reference="object.recv_x"]').first().click();
    const switched=await source.evaluate(()=>window.termExplanation);
    assert.equal(switched.termId,'object.recv_x');assert.match(switched.definition,/hidden|输出/);assert.doesNotMatch(switched.definition,/当前expert展开后的输出行号/);
    assert.notEqual(switched.sourceRef.line,484);await source.keyboard.press('Escape');
    checks.push('source related recv_x clears original identifier and retains its own definition and source reference');
    await control.locator('#preset').selectOption('mixed');await control.locator('#stageJump').selectOption('12');await control.locator('#cell').selectOption('R0.SQE[2]');await control.locator('#inspect').click();
    const addressTerm=control.locator('#dialogContent .structuredValue').first().locator('[data-term-id="field.source"]').first();
    await addressTerm.click();assert.match(await tip(control).innerText(),/SGE|地址/);
    const addressValue=tip(control).locator('[data-num-id="R0.SQE[2]"][data-num-path=\'[0,"SGEs",0,"source"]\']').first();
    await addressValue.click();assert.match(await tip(control).innerText(),/2×512|2.*512/);
    assert.equal(await control.evaluate(()=>window.numericExplanation.result),'R0.x+1024');
    assert.deepEqual(await control.evaluate(()=>window.numericExplanation.elementPath),[0,'SGEs',0,'source']);
    await control.keyboard.press('Escape');assert.ok(await control.locator('#inspector').evaluate(d=>d.open));await control.locator('#closeDialog').click();
    checks.push('modal source field term links to its own address arithmetic without recursively reopening the same term');
    const countsStep=await control.evaluate(()=>window.dispatchDemo.model('mixed').frames.findIndex(f=>f.stage==='counts'));
    await control.locator('#stageJump').selectOption(String(countsStep));await visual.waitForFunction(n=>window.dispatchDemo.api.getState().step===n,countsStep);
    const sourceConcept=visual.locator('#ranks .formula [data-term-query]').filter({hasText:/^source$/}).first();
    const sourceMeaning=await hover(visual,sourceConcept,/来源/,'source partition concept');
    assert.equal(sourceMeaning.termId,'source');assert.match(sourceMeaning.definition,/来源rank分区/);
    checks.push('source partition uses the general origin concept while typed SGE source retains its address-field meaning');
    await control.locator('#preset').selectOption('mixed');await control.locator('#stageJump').selectOption('5');
    await visual.waitForFunction(()=>window.dispatchDemo.api.getState().preset==='mixed'&&window.dispatchDemo.api.getState().step===5);
    await hover(visual,term(visual,'M','#visualConfig'),/M=4/,'pre transition term');await control.locator('#stageJump').selectOption('6');await tip(visual).waitFor({state:'hidden'});
    const late=await context.newPage();observe(late);await late.goto(origin+'/animation/visual.html?session='+session);
    await late.waitForFunction(()=>window.dispatchDemo?.api.getState().step===6&&window.dispatchDemo.api.getState().connected);
    await hover(late,term(late,'T','#visualConfig'),/T=4/,'late join receives term context');
    await late.reload();await late.waitForFunction(()=>window.dispatchDemo?.api.getState().step===6&&window.dispatchDemo.api.getState().connected);
    await hover(late,term(late,'M','#visualConfig'),/M=4/,'refresh restores term context');await late.screenshot({path:path.join(base,'terminology-final-720.png')});
    checks.push('step transition discards stale term tip; late join and refresh restore paired context');
    await source.close();await late.close();assert.deepEqual(errors,[]);
    const filesToHash=['app.mjs','style.css','numeric-ui.mjs','provenance.mjs','model.mjs','terminology.mjs','terminology-source-extra.mjs','terminology-source-evidence.mjs','source.mjs','source.html'];
    const deliveredHashes=Object.fromEntries(filesToHash.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'animation',f))).digest('hex')]));
    fs.writeFileSync(path.join(base,'root-terminology-ui.json'),JSON.stringify({status:'PASS',checkedAt:new Date().toISOString(),source_revision:'3b25377d04b24fc6154698ded78a2bcb2c59afff',checks,samples,errors,deliveredHashes},null,2)+'\n');
    console.log(JSON.stringify({status:'PASS',checks:checks.length,samples:samples.length,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
