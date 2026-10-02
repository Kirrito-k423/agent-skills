const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const {chromium} = require('playwright');
const base = __dirname;
const origin = process.env.DEEPEP_PREVIEW_ORIGIN || 'http://127.0.0.1:54686';
const checks = [], errors = [], hoverResults = [];
const number = (page, id, p, value, scope='') => page.locator(`${scope} [data-num-id=${JSON.stringify(id)}][data-num-path=${JSON.stringify(JSON.stringify(p))}]`).filter({hasText:new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)}).first();
const tip = page => page.locator('[role="tooltip"]:visible').last();
async function inspectHover(page, locator, matches, name) {
  const state = await page.evaluate(()=>window.dispatchDemo.api.getState());
  await locator.hover();
  await tip(page).waitFor({state:'visible'});
  const text = await tip(page).innerText();
  for (const match of matches) assert.match(text, match, `${name}: ${text}`);
  const geometry = await page.evaluate(() => {
    const t = [...document.querySelectorAll('[role="tooltip"]')].find(el=>el.getBoundingClientRect().width>0);
    const r=t.getBoundingClientRect();
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,viewport:[innerWidth,innerHeight]};
  });
  const anchor = await locator.boundingBox();
  assert.ok(geometry.left>=-1&&geometry.top>=-1&&geometry.right<=geometry.viewport[0]+1&&geometry.bottom<=geometry.viewport[1]+1,JSON.stringify(geometry));
  const iw=Math.max(0,Math.min(anchor.x+anchor.width,geometry.right)-Math.max(anchor.x,geometry.left));
  const ih=Math.max(0,Math.min(anchor.y+anchor.height,geometry.bottom)-Math.max(anchor.y,geometry.top));
  assert.ok(iw<=1||ih<=1,`tooltip covers its number: ${name}`);
  const now=await page.evaluate(()=>window.dispatchDemo.api.getState());
  assert.equal(now.step,state.step);
  assert.equal(now.selected,state.selected);
  hoverResults.push({name,text,geometry});
  return text;
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const ctx=await browser.newContext({viewport:{width:1280,height:720}});
    const control=await ctx.newPage(),visual=await ctx.newPage();
    for(const p of [control,visual])p.on('pageerror',e=>errors.push(e.message));
    await control.goto(origin+'/animation/control.html?session=root-numeric');
    await visual.goto(origin+'/animation/visual.html?session=root-numeric');
    await control.waitForFunction(()=>window.dispatchDemo?.api.getState().authoritative);
    await visual.waitForFunction(()=>window.dispatchDemo?.api.getState().connected);
    await control.locator('#preset').selectOption('mixed');
    await control.locator('#stageJump').selectOption('0');
    await visual.waitForFunction(()=>window.dispatchDemo.api.getState().preset==='mixed'&&window.dispatchDemo.api.getState().step===0);
    await inspectHover(visual,number(visual,'R0.topk_idx[3]',[0],-1),[/-1/,/专家/,/初始|输入|人为/,/lane|位置|元素|top.k/],'initial -1 sentinel');
    await visual.screenshot({path:path.join(base,'numeric-initial-sentinel-720.png')});
    await inspectHover(visual,number(visual,'R0.topk_idx[3]',[1],0),[/专家/,/0/,/有效/],'initial expert 0');
    checks.push('screenshot 1: separate array elements, sentinel and valid expert zero');
    await control.locator('#stageJump').selectOption('5');
    await control.locator('#cell').selectOption('R0.rank_histogram_sum_view');
    await visual.waitForFunction(()=>window.dispatchDemo.api.getState().step===5);
    for(let p=0;p<4;p++){
      const text=await inspectHover(control,number(control,'R0.rank_histogram_sum_view',[p],p===0?2:1,'#currentValue'),[/Rank|R[0-3]|rank/,/去重/,/计算|代入|推导|贡献|=/],`destination R${p} count`);
      if(p===0){assert.match(text,/token\s*0|token.?编号.?0|token\[0\]/i);assert.match(text,/token\s*3|token.?编号.?3|token\[3\]/i);}
    }
    await inspectHover(control,number(control,'R0.rank_histogram_sum_view',[0],2,'#currentValue'),[/2/,/去重/],'R0 count full derivation');
    await control.screenshot({path:path.join(base,'numeric-count-derivation-720.png')});
    await inspectHover(control,number(control,'R0.rank_histogram_sum_view',[0],0,'#currentValue'),[/0/,/初始|初始化/],'write-before zero');
    checks.push('screenshot 2: each destination count has its own contributions and arithmetic', 'write-before zero differs from write-after count');
    await inspectHover(control,number(control,'R0.rank_histogram_sum_view',[0],2,'#history'),[/5/,/2/],'history value produced at step 5');
    await control.locator('#stageJump').selectOption('6');
    await tip(control).waitFor({state:'hidden'});
    const observed=await inspectHover(control,number(control,'R0.rank_histogram_sum_view',[0],2,'#currentValue'),[/5/,/2/],'observation retains earlier producer');
    checks.push('historic and observed values retain actual production step', 'step changes discard stale tooltip');
    const focusNumber=number(control,'R0.rank_histogram_sum_view',[0],2,'#currentValue');
    await focusNumber.focus();
    await control.keyboard.press('Enter');
    await tip(control).waitFor({state:'visible'});
    await control.keyboard.press('Escape');
    await tip(control).waitFor({state:'hidden'});
    checks.push('keyboard focus, Enter pin and Escape close');
    for(const viewport of [{width:1440,height:900},{width:1920,height:1080}]){
      await control.setViewportSize(viewport);await visual.setViewportSize(viewport);
      await control.locator('#stageJump').selectOption('5');
      await inspectHover(control,number(control,'R0.rank_histogram_sum_view',[3],1,'#currentValue'),[/1/],`right edge ${viewport.width}x${viewport.height}`);
      await visual.waitForFunction(()=>window.dispatchDemo.api.getState().step===5);
      await inspectHover(visual,number(visual,'R3.topk_idx[3]',[1],-1),[/-1/,/专家/],`bottom rank edge ${viewport.width}x${viewport.height}`);
    }
    checks.push('tooltip fits all three actual CSS viewports and does not cover its anchor');
    assert.deepEqual(errors,[]);
    const deliveredHashes=Object.fromEntries(['app.mjs','style.css','numeric-ui.mjs','provenance.mjs','model.mjs'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'animation',f))).digest('hex')]));
    const result={status:'PASS',checkedAt:new Date().toISOString(),deliveredHashes,source_revision:'3b25377d04b24fc6154698ded78a2bcb2c59afff',checks,hoverResults,errors};
    fs.writeFileSync(path.join(base,'root-numeric-ui.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({status:result.status,checks,hovers:hoverResults.length,errors}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
