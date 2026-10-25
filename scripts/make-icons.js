// Gera o banner (320x180) e o ícone (96x96) do launcher do Fire TV e o ícone (512x423) do atalho da Samsung.
// Uso: node scripts/make-icons.js
const path = require('path');
const { chromium } = require('playwright');

const RES = path.join(__dirname, '..', 'firetv', 'app', 'src', 'main', 'res');
const art = (w, h, size, text) => `<html><body style="margin:0"><div style="width:${w}px;height:${h}px;
  display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a0008,#5a0020);
  font:800 ${size}px Arial,sans-serif;color:#ff2d55;letter-spacing:2px">${text}</div></body></html>`;

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 320, height: 180 });
  await page.setContent(art(320, 180, 52, 'HotGo<span style="color:#fff;margin-left:10px">TV</span>'));
  await page.screenshot({ path: path.join(RES, 'drawable-xhdpi', 'banner.png') });
  await page.setViewportSize({ width: 96, height: 96 });
  await page.setContent(art(96, 96, 40, 'HG'));
  await page.screenshot({ path: path.join(RES, 'mipmap-xhdpi', 'ic_launcher.png') });
  await page.setViewportSize({ width: 512, height: 423 });
  await page.setContent(art(512, 423, 92, 'HotGo<br><span style="color:#fff">TV</span>').replace('justify-content:center', 'justify-content:center;text-align:center;line-height:1.1;flex-direction:column'));
  await page.screenshot({ path: path.join(__dirname, '..', 'tizen', 'launcher', 'icon.png') });
  await browser.close();
})();
