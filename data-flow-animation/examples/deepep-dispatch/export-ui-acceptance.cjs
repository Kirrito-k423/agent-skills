const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {spawn}=require('child_process'),{chromium}=require('playwright');
const base=path.resolve(process.argv[2]||__dirname),checks=[],errors=[];
(async()=>{
  const service=spawn('python3',[path.join(base,'serve.py'),'--no-open','--port','0'],{cwd:base,stdio:['ignore','pipe','pipe']});
  let browser;
  try{
    const origin=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('exported preview did not start')),8000);
      service.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
      service.stderr.on('data',()=>{});service.on('error',reject);service.on('exit',code=>{if(!output.includes('http://'))reject(Error('preview exited '+code));});
    });
    const review=JSON.parse(fs.readFileSync(path.join(base,'root-terminology-ui.json'),'utf8'));
    for(const [file,digest]of Object.entries(review.deliveredHashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'animation',file))).digest('hex'),digest,file+' published byte identity');
    checks.push('portable copy retains every final reviewed terminology and numeric module hash');
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:720}}),index=await context.newPage(),c=await context.newPage(),v=await context.newPage();
    for(const p of [index,c,v])p.on('pageerror',e=>errors.push(e.message));
    await index.goto(origin+'/index.html');assert.ok((await index.locator('a[href="animation/control.html"]').count())>0);checks.push('portable index opens local control and visual artifacts');
    const session='export-'+Date.now();await c.goto(origin+'/animation/control.html?session='+session);await c.waitForFunction(()=>window.dispatchDemo?.api.getState().authoritative);
    await v.goto(origin+'/animation/visual.html?session='+session);await v.waitForFunction(()=>window.dispatchDemo?.api.getState().connected);
    await c.locator('#preset').selectOption('mixed');await c.locator('#stageJump').selectOption('0');await v.waitForFunction(()=>window.dispatchDemo.api.getState().preset==='mixed'&&window.dispatchDemo.api.getState().step===0);
    for(const [id,re]of [['M',/最大.*容量|容量.*最大/],['T',/有效输入/],['A',/对齐/],['SF',/原始位模式/]]){
      await v.locator('#visualConfig [data-term-id="'+id+'"]').hover();await v.locator('#numericTooltip').waitFor({state:'visible'});assert.match(await v.locator('#numericTooltip').innerText(),re);
      assert.equal(await v.evaluate(()=>window.termExplanation.sourceRef.commit),'3b25377d04b24fc6154698ded78a2bcb2c59afff');await v.keyboard.press('Escape');
    }
    checks.push('published M T A SF definitions are interactive and point to the frozen revision');
    await c.locator('#stageJump').selectOption('5');await c.locator('#cell').selectOption('R0.rank_histogram_sum_view');await v.waitForFunction(()=>window.dispatchDemo.api.getState().step===5);
    await c.locator('#currentValue [data-num-id="R0.rank_histogram_sum_view"][data-num-path="[0]"]').filter({hasText:/^2$/}).hover();await c.locator('#numericTooltip').waitFor({state:'visible'});
    assert.equal(await c.evaluate(()=>window.numericExplanation.result),2);assert.match(await c.locator('#numericTooltip').innerText(),/去重/);checks.push('published pair stays synchronized and numeric derivation remains available');
    await c.locator('#preset').selectOption('empty');await c.locator('#stageJump').selectOption('0');await v.waitForFunction(()=>window.dispatchDemo.api.getState().preset==='empty'&&window.dispatchDemo.api.getState().step===0);
    await v.locator('#visualConfig [data-term-id="T"]').hover();assert.match(await v.locator('#numericTooltip').innerText(),/T=0|当前 0≤4/);
    const pending=c.waitForEvent('popup');await c.locator('#fullSource').click();const s=await pending;s.on('pageerror',e=>errors.push(e.message));await s.waitForFunction(()=>window.dispatchSource);
    assert.equal(await s.evaluate(()=>window.dispatchSource.model.config.T),0);assert.equal(await s.locator('[data-unresolved-term]').count(),0);checks.push('published empty context and complete source annotations survive portable deployment');
    await v.screenshot({path:path.join(base,'export-browser-720.png')});assert.deepEqual(errors,[]);
    const result={status:'PASS',checkedAt:new Date().toISOString(),runtime:'Chromium',viewport:[1280,720],source_revision:'3b25377d04b24fc6154698ded78a2bcb2c59afff',temporaryServiceStopped:true,checks,errors,deliveredHashes:review.deliveredHashes};
    fs.writeFileSync(path.join(base,'export-browser-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'PASS',checks:checks.length,errors}));
  }finally{
    if(browser)await browser.close();if(service.exitCode===null){const stopped=new Promise(resolve=>service.once('exit',resolve));service.kill('SIGTERM');await stopped;}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
