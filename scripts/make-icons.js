// Gera o ícone (512x423) do app da Samsung e, com a mesma arte, o banner (320x180) e o ícone (96x96)
// do launcher do Fire TV, mais as versões em dobro (xxxhdpi) para a tela 4K.
// Uso: node scripts/make-icons.js
const path = require('path');
const { chromium } = require('playwright');

const RES = path.join(__dirname, '..', 'firetv', 'app', 'src', 'main', 'res');
// "HotGo" em cima e "TV" embaixo, no fundo vinho em degradê: a arte que ficou no app da Samsung
const art = (w, h, size) => `<html><body style="margin:0"><div style="width:${w}px;height:${h}px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1.1;
  background:linear-gradient(135deg,#1a0008,#5a0020);font:800 ${size}px Arial,sans-serif;color:#ff2d55;letter-spacing:2px">
  HotGo<br><span style="color:#fff">TV</span></div></body></html>`;

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const shot = async (w, h, size, scale, file) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    await page.setContent(art(w, h, size));
    await page.screenshot({ path: file });
    await page.close();
  };
  await shot(512, 423, 92, 1, path.join(__dirname, '..', 'tizen', 'app', 'icon.png'));
  for (const [dir, scale] of [['xhdpi', 1], ['xxxhdpi', 2]]) {
    await shot(320, 180, 60, scale, path.join(RES, `drawable-${dir}`, 'banner.png'));
    await shot(96, 96, 24, scale, path.join(RES, `mipmap-${dir}`, 'ic_launcher.png'));
  }
  await browser.close();
})();
