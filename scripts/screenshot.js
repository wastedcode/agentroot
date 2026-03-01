const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const screenshots = [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 812 },
  ];
  const pages = [
    { path: '/', name: 'home' },
    { path: '/howitworks.html', name: 'howitworks' },
    { path: '/submit.html', name: 'submit' },
    { path: '/spec.html', name: 'spec' },
  ];
  for (const size of screenshots) {
    await page.setViewport({ width: size.width, height: size.height });
    for (const p of pages) {
      await page.goto(`http://localhost:4747${p.path}`, { waitUntil: 'networkidle0' });
      const file = path.join('/home/openclaw/.openclaw/workspace/agents/atlas/screenshots', `${p.name}-${size.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`Captured: ${file}`);
    }
  }
  await browser.close();
})();
