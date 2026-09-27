const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.CHROME_CHANNEL||undefined});try{
const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8000/mem-monitor/');await page.locator('#dashboard').waitFor();
assert.deepEqual(await page.locator('#node-select option').evaluateAll(es=>es.map(e=>e.value)),['06ESC-400','03SAU-400','08RMV-400']);
assert.equal(await page.locator('.mem-wordmark img').getAttribute('src'),'../assets/mem-energy.svg');
await page.screenshot({path:'/tmp/mem-logo.png',fullPage:true});
await page.locator('.monitor-tabs a[href="mapa.html"]').click();await page.locator('#map-content').waitFor();
assert.equal(await page.locator('#mexico-map path.state').count(),32);assert.match(await page.locator('#map-coverage').innerText(),/2,610/);
await page.screenshot({path:'/tmp/mem-map-desktop.png',fullPage:true});
const before=await page.locator('#state-price').innerText();await page.locator('#hour-filter').fill('1');assert.notEqual(await page.locator('#state-price').innerText(),before);
await page.selectOption('#voltage-filter','400');await page.locator('path[data-code="19"]').click();assert.equal(await page.locator('#selected-state').innerText(),'Nuevo León');
await page.locator('#node-search').fill('Escobedo');assert.match(await page.locator('#node-rows').innerText(),/06ESC-400/);
await page.locator('#clear-state').click();await page.locator('#node-search').fill('Valladolid');assert.match(await page.locator('#node-rows').innerText(),/08RMV-400/);
await page.locator('#node-search').fill('no-existe-123');assert.equal(await page.locator('#node-rows tr').count(),0);
await page.locator('#node-search').fill('');await page.selectOption('#voltage-filter','all');await page.selectOption('#system-filter','BCS');assert.match(await page.locator('#map-coverage').innerText(),/31 nodos/);
await page.selectOption('#system-filter','all');for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/mem-map-mobile.png',fullPage:true});
await page.route('**/price-map.json',r=>r.fulfill({status:503,body:'Unavailable'}));await page.reload();await page.locator('#map-retry').waitFor();assert(await page.locator('#map-content').isHidden());
await page.unroute('**/price-map.json');await page.locator('#map-retry').click();await page.locator('#map-content').waitFor();assert.deepEqual(errors,[]);
console.log('PASS: 400kV nodes, logo, 32 states, hourly prices, state selection, voltage/system filters, municipal search, empty search, mobile, failure/retry.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
