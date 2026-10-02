const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require('playwright');
const base=__dirname,checks=[],samples=[],errors=[];
const origin=process.env.DEEPEP_PREVIEW_ORIGIN||'http://127.0.0.1:54686';
const num=(p,id,elementPath,scope='#currentValue')=>p.locator(`${scope} [data-num-id=${JSON.stringify(id)}][data-num-path=${JSON.stringify(JSON.stringify(elementPath))}]`).last();
const tooltip=p=>p.locator('#numericTooltip');
async function hover(p,n,patterns,name){
  await n.scrollIntoViewIfNeeded();await n.hover();await tooltip(p).waitFor({state:'visible'});
  const text=await tooltip(p).innerText();for(const rx of patterns)assert.match(text,rx,name);
  const record=await p.evaluate(()=>window.numericExplanation);
  samples.push({name,record,text});return record;
}
async function select(p,preset,step,id){
  await p.locator('#preset').selectOption(preset);await p.locator('#stageJump').selectOption(String(step));
  await p.locator('#cell').selectOption(id);
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:720}});
    const p=await context.newPage(),v=await context.newPage();
    for(const page of[p,v])page.on('pageerror',e=>errors.push(e.message));
    await p.goto(origin+'/animation/control.html?session=root-object-numeric');
    await v.goto(origin+'/animation/visual.html?session=root-object-numeric');
    await p.waitForFunction(()=>window.dispatchDemo?.api.getState().authoritative);
    await select(p,'mixed',0,'R0.x[0]');await p.locator('#inspect').click();
    const hidden255=num(p,'R0.x[0]',[255],'#dialogContent .structuredValue:first-of-type');
    await hover(p,hidden255,[/255/,/token.?0|gid.?0|global.?idx.?0|第.?0.*token/i,/0/],'full inspector hidden element 255');
    await hidden255.click();
    assert.equal(await tooltip(p).evaluate(t=>t.closest('dialog')?.id),'inspector');
    await tooltip(p).locator('#closeNumeric').click();await tooltip(p).waitFor({state:'hidden'});
    assert.ok(await p.locator('#inspector').evaluate(el=>el.open));
    await p.locator('#closeDialog').click();
    checks.push('full hidden element 255 has its own typed query; fixed modal tooltip closes by real click');

    await select(p,'fp8',0,'R0.sf[0]');
    await p.locator('#inspect').click();
    const sf=await hover(p,num(p,'R0.sf[0]',[7],'#dialogContent .structuredValue:first-of-type'),[/15367/,/0x3c00|15360/,/7/,/位|bits|pack/i],'FP8 SF pack 7 raw bits');
    assert.equal(sf.result,15367);
    await p.locator('#closeDialog').click();
    checks.push('SF pack explains its chosen raw bit pattern rather than a decoded scale');

    await select(p,'fp8',12,'R0.SQE[2]');await p.locator('#inspect').click();
    const nested=num(p,'R0.SQE[2]',[0,'SGEs',0,'bytes'],'#dialogContent .structuredValue:first-of-type');
    const sqe=await hover(p,nested,[/256/,/256.*1|H.*dtype|hiddenBytes/],'nested SQE hidden SGE bytes');
    await nested.click();await tooltip(p).locator('details summary').click();
    assert.ok(await tooltip(p).locator('details').evaluate(el=>el.open));
    assert.match(await tooltip(p).locator('details').innerText(),/步骤|常数\/参数定义/);
    await tooltip(p).hover();await p.mouse.wheel(0,800);
    await p.waitForFunction(()=>{const el=document.getElementById('numericTooltip');return el.scrollTop>0||el.scrollHeight<=el.clientHeight;},{},{timeout:3000});
    await p.screenshot({path:path.join(base,'numeric-nested-sqe-inspector-720.png')});
    const popupPromise=p.waitForEvent('popup');
    await tooltip(p).locator('a').click();
    const sourcePage=await popupPromise;await sourcePage.waitForLoadState('networkidle');
    assert.match(await sourcePage.locator('#meta').innerText(),/dispatch.hpp/);
    assert.equal(await sourcePage.locator('#source .codeLine').count(),867);
    assert.ok(await sourcePage.locator('#L'+sqe.sourceRef.line).count());
    await sourcePage.close();
    await p.keyboard.press('Escape');await tooltip(p).waitFor({state:'hidden'});
    assert.ok(await p.locator('#inspector').evaluate(el=>el.open));
    await p.locator('#closeDialog').click();
    checks.push('nested SQE field has exact operands; modal details are clickable and long explanation scrolls; first Escape preserves inspector');
    checks.push('fixed numeric explanation opens its real source line in the complete frozen source page');

    await select(p,'mixed',11,'R0.signals');
    const fresh=num(p,'R0.signals',['metadata_ready']),retained=num(p,'R0.signals',['local_copy_ready']);
    await hover(p,fresh,[/1/,/11/,/发布|ready/],'new metadata ready signal');
    const freshColor=await fresh.evaluate(el=>getComputedStyle(el).color);
    const kept=await hover(p,retained,[/1/,/6/],'retained local ready signal');
    assert.equal(kept.producerStep,6);
    const retainedColor=await retained.evaluate(el=>getComputedStyle(el).color);
    assert.notEqual(freshColor,retainedColor);
    checks.push('newly published signal is red; retained same-value signal preserves its earlier producer and ordinary color');

    await select(p,'mixed',1,'R0.ub_rank_histogram[0]');
    const zeroBucket=num(p,'R0.ub_rank_histogram[0]',[3],'#history .historyRow.now');
    const untouched=await hover(p,zeroBucket,[/0/,/初始|初始化/],'unhit UB bucket in current history row');
    assert.equal(untouched.producerStep,-1);
    const unhitColor=await zeroBucket.evaluate(el=>getComputedStyle(el).color);
    const hitColor=await num(p,'R0.ub_rank_histogram[0]',[0],'#history .historyRow.now').evaluate(el=>getComputedStyle(el).color);
    assert.notEqual(unhitColor,hitColor);
    checks.push('history row color distinguishes an untouched zero UB bucket from its newly incremented bucket');

    await select(p,'cached',0,'R0.psum_num_recv_tokens_per_rank');
    const cache=await hover(p,num(p,'R0.psum_num_recv_tokens_per_rank',[0]),[/缓存|cached|上一轮|prior/i],'cached initial prefix');
    assert.ok(cache.operands.some(o=>o.scope==='previous-fresh'));
    await num(p,'R0.psum_num_recv_tokens_per_rank',[0]).click();
    await tooltip(p).locator('details summary').click();
    assert.match(await tooltip(p).locator('details').innerText(),/previous-fresh/);
    await p.keyboard.press('Escape');
    checks.push('cached initial value exposes the prior Fresh-call operand scope in visible details');

    await select(p,'mixed',0,'R0.recv_buffer[0,0]');
    const unknown=await hover(p,num(p,'R0.recv_buffer[0,0]',[]),[/未写入|UNKNOWN/,/0|零|数值/],'unwritten receive buffer');
    assert.equal(unknown.result,'未写入');
    checks.push('unwritten storage is explicitly explained as unknown rather than a zero');

    for(const [preset,step,field,expected] of [['mixed',7,'sf','无SF分支'],['noWeights',7,'weights','未提供'],['cached',2,'topk','cached不发送']]){
      await select(p,preset,step,'R0.metadata_send_buffer[0]');await p.locator('#inspect').click();
      const opt=await hover(p,num(p,'R0.metadata_send_buffer[0]',[field],'#dialogContent .structuredValue:first-of-type'),[new RegExp(expected)],preset+' optional '+field);
      assert.ok(!opt.operation.includes('缓存继承'));
      assert.ok(!opt.calculation.some(s=>s.includes('上次fresh生产')));
      await p.locator('#closeDialog').click();
    }
    checks.push('Fresh absent SF/weights and Cached omitted metadata fields are not described as inherited cached values');

    await select(p,'empty',2,'R0.rank_histogram_sum_view');
    const zero=await hover(p,num(p,'R0.rank_histogram_sum_view',[0]),[/0/,/空|T.?=.?0|输入/],'empty rank count remains zero');
    assert.equal(zero.result,0);
    checks.push('empty-input zero write has an explicit zero-contribution derivation');
    assert.deepEqual(errors,[]);
    const deliveredHashes=Object.fromEntries(['app.mjs','style.css','numeric-ui.mjs','provenance.mjs','model.mjs'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'animation',f))).digest('hex')]));
    const report={status:'PASS',checkedAt:new Date().toISOString(),deliveredHashes,viewport:[1280,720],checks,samples,errors};
    fs.writeFileSync(path.join(base,'root-numeric-object-ui.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({status:'PASS',checks:checks.length,samples:samples.length,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
