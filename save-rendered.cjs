const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox']
  });
  const p = await b.newPage();
  await p.goto('https://hk-city-monitor.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(8000);
  const html = await p.content();
  require('fs').writeFileSync('C:/hk-city-monitor/web/rendered.html', html);
  console.log('saved rendered.html');
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
