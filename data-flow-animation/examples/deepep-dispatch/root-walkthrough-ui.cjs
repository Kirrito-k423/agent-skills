const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const base = __dirname;
const origin = 'http://127.0.0.1:8789';
const records = [];
const errors = [];
const click = async (page, selector) => {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
};
const activeLine = page => page.locator('.code-line.active-line').getAttribute('data-line');
const visibleActiveLine = async page => page.waitForFunction(() => {
  const row = document.querySelector('.code-line.active-line')?.getBoundingClientRect();
  const clip = document.querySelector('#code-scroll')?.getBoundingClientRect();
  return row && clip && row.top >= clip.top - 1 && row.bottom <= clip.bottom + 1;
});
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const name of ['dispatch', 'dispatch_copy_epilogue']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('pageerror', e => errors.push({ name, message: e.message }));
      const response = await page.goto(`${origin}/walkthrough/${name}.walkthrough.html`);
      assert.equal(response.status(), 200);
      await page.waitForSelector('.code-line');
      const payload = await page.locator('#walkthrough-data').evaluate(el => JSON.parse(el.textContent));
      const analysis = payload.analysis;
      assert.equal(payload.draftMode, false);
      const expected = fs.readFileSync(path.join(base, 'DeepEP-Ascend', 'deep_ep/include/deep_ep/impls/ep', `${name}.hpp`), 'utf8').replace(/\n$/, '').split('\n');
      assert.deepEqual(payload.lines, expected);
      assert.equal(await page.locator('.code-line').count(), expected.length);
      assert.match(await page.locator('.review-pass').innerText(), /PASS/);
      const report = { name, lines: expected.length, modules: 0, functions: 0, segments: 0, internal_calls: 0, memory_paths: 0, transfers: 0, checks: [] };
      await click(page, '[data-workspace-view="logic"]');
      for (const module of analysis.modules) {
        await click(page, `[data-module="${module.id}"]`);
        assert.equal(await page.locator(`[data-module="${module.id}"]`).getAttribute('aria-pressed'), 'true');
        report.modules++;
      }
      for (const fn of analysis.functions) {
        await click(page, `[data-module="${fn.module_id}"]`);
        await click(page, `.function-node[data-function="${fn.id}"]`);
        assert.equal(Number(await activeLine(page)), fn.start);
        report.functions++;
        for (const segment of fn.segments) {
          await click(page, `[data-segment="${segment.id}"]`);
          assert.equal(Number(await activeLine(page)), segment.start);
          await visibleActiveLine(page);
          assert.equal(await page.locator('.code-line.segment-focus').count(), segment.end - segment.start + 1);
          report.segments++;
          for (const call of segment.calls || []) {
            if (call.type !== 'internal') continue;
            await click(page, `.call-chip[data-function="${call.target}"][data-call-line="${call.line}"]`);
            const callee = analysis.functions.find(x => x.id === call.target);
            assert.equal(Number(await activeLine(page)), callee.start);
            await click(page, '[data-function-back]');
            assert.equal(Number(await activeLine(page)), call.line);
            report.internal_calls++;
          }
        }
      }
      const q = 'token';
      await page.locator('#source-search').fill(q);
      const expectedMatches = expected.reduce((n, s) => n + (s.toLowerCase().match(/token/g) || []).length, 0);
      assert.match(await page.locator('#search-count').innerText(), new RegExp(`1 / ${expectedMatches} `));
      await click(page, '#search-next');
      assert.match(await page.locator('#search-count').innerText(), /^2 \//);
      await click(page, '#search-prev');
      assert.match(await page.locator('#search-count').innerText(), /^1 \//);
      await page.locator('#source-search').fill('root_undefined_search_token_829');
      assert.equal(await page.locator('#search-count').innerText(), '无结果');
      assert.equal(await page.locator('#search-next').isDisabled(), true);
      await page.locator('#source-search').fill('');
      report.checks.push('exact source bytes/line count', 'all modules/functions/segments', 'internal call drilldown and return line', 'global search count/navigation/no result');
      const reverse = analysis.functions[0].end - 1;
      await click(page, `[data-reverse-line="${reverse}"]`);
      assert.equal(Number(await activeLine(page)), reverse);
      await click(page, '#drawer-toggle');
      assert.equal(await page.locator('.line-review-text').count(), 1);
      assert.ok((await page.locator('.line-review-text').innerText()).length > 5);
      await click(page, '[data-close-drawer]');
      const resizer = page.locator('[data-column-resizer="middle-code"]');
      const originalWidth = await page.locator('[data-track="code"]').evaluate(el => el.getBoundingClientRect().width);
      await resizer.focus();
      await page.keyboard.press('ArrowLeft');
      const changedWidth = await page.locator('[data-track="code"]').evaluate(el => el.getBoundingClientRect().width);
      assert.ok(Math.abs(changedWidth - originalWidth) > 1);
      await click(page, '#layout-reset');
      await page.waitForTimeout(400);
      await visibleActiveLine(page);
      await page.screenshot({ path: path.join(base, `root-${name}-logic.png`) });
      report.checks.push('source reverse selection and reviewed line tips', 'keyboard column resize/reset');
      await click(page, '[data-workspace-view="memory"]');
      const memory = analysis.memory_model;
      for (const p of memory.paths) {
        await click(page, `[data-memory-path="${p.id}"]`);
        assert.ok((await page.locator(`[data-memory-path="${p.id}"]`).getAttribute('class')).includes('active'));
        for (const tid of p.transfer_ids) {
          const transfer = memory.transfers.find(x => x.id === tid);
          await click(page, `.memory-transfer-step[data-transfer="${tid}"]`);
          assert.ok((await page.locator('.memory-transfer-detail').innerText()).includes(transfer.api));
          await click(page, `.memory-transfer-detail [data-call-line="${transfer.line}"]`);
          assert.equal(Number(await activeLine(page)), transfer.line);
          await visibleActiveLine(page);
          report.transfers++;
        }
        report.memory_paths++;
      }
      await click(page, `[data-memory-path="${memory.paths[0].id}"]`);
      await visibleActiveLine(page);
      await page.screenshot({ path: path.join(base, `root-${name}-memory.png`) });
      for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(120);
        const size = await page.evaluate(() => ({ iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }));
        assert.ok(size.sw <= size.iw + 1, JSON.stringify(size));
        assert.ok(size.sh <= size.ih + 1, JSON.stringify(size));
        assert.equal(await page.locator('.code-line').count(), expected.length);
      }
      report.checks.push('memory paths/transfers/detail/source linkage', '1280x720/1440x900/1920x1080 viewport roots fit');
      records.push(report);
      await page.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(base, 'root-walkthrough-ui.json'), JSON.stringify({ status: 'PASS', browser: 'Playwright Chromium', origin, records, errors }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', records, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
