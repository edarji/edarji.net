const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({headless:true, channel:process.env.CHROME_CHANNEL || undefined});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1100}, reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base=process.env.MONITOR_URL || 'http://127.0.0.1:8000/mem-monitor/';
    const data=JSON.parse(fs.readFileSync(new URL('../mem-monitor/data/monitor.json',`file://${__filename}`),'utf8'));
    await page.goto(base);await page.locator('#dashboard').waitFor();
    assert.match(await page.locator('#demand-value').innerText(),/MW/);
    assert.match(await page.locator('#pml-caption').innerText(),/24 horas/);
    assert.match(await page.locator('#generation-caption').innerText(),/2026-08/);
    assert.equal(await page.locator('#generation-table tbody tr').count(),11);
    assert.equal(await page.locator('.source-info a').count(),3);
    assert(!(await page.locator('main').innerText()).includes('DEMO'));
    await page.screenshot({path:'/tmp/mem-blue-desktop.png',fullPage:true});
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('.menu-toggle').click();assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('.menu-toggle').click();
    await page.screenshot({path:'/tmp/mem-blue-mobile.png',fullPage:true});
    async function fixture(json) {
      await page.unroute('**/data/monitor.json');
      await page.route('**/data/monitor.json',route=>route.fulfill({json}));
      await page.reload();
    }
    const stale=structuredClone(data);stale.demand.status='stale';
    await fixture(stale);await page.locator('#dashboard').waitFor();
    assert.match(await page.locator('#demand-badge').innerText(),/SIN ACTUALIZAR/);
    const empty=structuredClone(data);
    for(const key of ['demand','pml','generation']) { empty[key].status='unavailable';empty[key].fetched_at=null; }
    empty.demand.series=[];empty.pml.nodes=[];empty.generation.items=[];
    await fixture(empty);await page.locator('#dashboard').waitFor();
    assert(await page.locator('#node-select').isDisabled());
    assert.match(await page.locator('#demand-value').innerText(),/—/);
    const invalid=structuredClone(data);invalid.demand.series[0].value=null;
    await fixture(invalid);await page.locator('#retry').waitFor();assert(await page.locator('#dashboard').isHidden());
    await page.unroute('**/data/monitor.json');
    await page.route('**/data/monitor.json',route=>route.fulfill({status:404,body:'Missing'}));
    await page.reload();await page.locator('#retry').waitFor();
    await page.unroute('**/data/monitor.json');await page.locator('#retry').click();await page.locator('#dashboard').waitFor();
    const nodes=structuredClone(data);const second=structuredClone(nodes.pml.nodes[0]);second.id='TEST-ONLY';second.series.forEach(r=>r.value=-20);nodes.pml.nodes.push(second);
    await fixture(nodes);await page.locator('#dashboard').waitFor();await page.selectOption('#node-select','TEST-ONLY');
    assert.match(await page.locator('#pml-value').innerText(),/-20/);
    await page.unroute('**/data/monitor.json');
    await page.setViewportSize({width:1440,height:1100});
    await page.goto(new URL('../',base).href);await page.locator('.site-nav a[href="mem-monitor/"]').click();await page.locator('#dashboard').waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: CENACE modules, source links, monthly units, mobile 320/390, stale, unavailable, invalid, HTTP failure/retry, negative PML, node selector, homepage.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
