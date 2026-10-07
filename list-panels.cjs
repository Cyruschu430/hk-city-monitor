const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage();
  await p.goto('https://hk-city-monitor.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(5000);
  const panels = await p.evaluate(() => {
    const els = document.querySelectorAll('[id^="panel-"]');
    return Array.from(els).map(el => el.id.replace('panel-', ''));
  });
  console.log('PANELS:' + panels.length);
  panels.forEach(p => console.log(p));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
