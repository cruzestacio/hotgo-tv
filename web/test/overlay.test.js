// Teste do overlay num catálogo simulado, com o Chromium do Playwright.
// Uso: node web/test/overlay.test.js
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');

const DEMO = 'file://' + path.join(__dirname, 'demo.html');
const OVERLAY = fs.readFileSync(path.join(__dirname, '..', 'src', 'tv-overlay.js'), 'utf8');
const SHOTS = process.env.SHOTS_DIR;

async function press(page, key, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
  }
}

const focused = (page) => page.evaluate(() => {
  const e = document.querySelector('.tvf-focus');
  return e ? (e.textContent || e.tagName).trim().slice(0, 40) : null;
});

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(DEMO);
  await page.addScriptTag({ content: OVERLAY });

  // A tela Início abre sozinha com os 18 cards agrupados pelas 3 seções
  await page.waitForSelector('#tvf-home.open', { timeout: 4000 });
  const rows = await page.$$eval('.tvf-row-title', (h) => h.map((x) => x.textContent));
  assert.deepStrictEqual(rows, ['Lançamentos', 'Mais assistidos', 'Canais']);
  assert.strictEqual(await page.$$eval('.tvf-card', (c) => c.length), 18);
  assert.match(await focused(page), /Assistir/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'home.png') });

  // Baixo entra na primeira linha; direita anda pelos cards; baixo vai para a próxima linha
  await press(page, 'ArrowDown');
  assert.strictEqual(await focused(page), 'Lançamentos 1');
  await press(page, 'ArrowRight', 2);
  assert.strictEqual(await focused(page), 'Lançamentos 3');
  await press(page, 'ArrowDown');
  assert.match(await focused(page), /^Mais assistidos/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'home-row2.png') });

  // OK abre o vídeo pelo link original do site
  await press(page, 'Enter');
  await page.waitForTimeout(200);
  assert.match(page.url(), /#\/video\/1-/);
  assert.strictEqual(await page.$eval('#tvf-home', (h) => h.classList.contains('open')), false);

  // Voltar (tecla do Tizen) volta para o catálogo do site
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 10009, bubbles: true })));
  await page.waitForTimeout(300);
  assert.doesNotMatch(page.url(), /#\/video\//);

  // Fora do Início, as setas navegam pelo próprio site, inclusive no <div onclick>
  await page.evaluate(() => window.hotgoTV.toggleHome()); // abre
  await page.evaluate(() => window.hotgoTV.toggleHome()); // fecha e foca o site
  const order = [];
  for (let i = 0; i < 3; i++) { order.push(await focused(page)); await press(page, 'ArrowRight'); }
  assert.deepStrictEqual(order, ['Início', 'Ao vivo', 'Menu']);
  await press(page, 'ArrowLeft');
  await press(page, 'Enter');
  assert.strictEqual(await page.title(), 'menu-clicado');

  // Vídeo: evento play maximiza; Voltar restaura
  await page.evaluate(() => {
    const v = document.getElementById('video');
    v.dispatchEvent(new Event('play'));
  });
  assert.strictEqual(await page.$eval('#video', (v) => v.classList.contains('tvf-max')), true);
  assert.strictEqual(await page.evaluate(() => window.hotgoTV.back()), true);
  assert.strictEqual(await page.$eval('#video', (v) => v.classList.contains('tvf-max')), false);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('ok: overlay passou em todos os cenários');
})().catch((e) => { console.error(e); process.exit(1); });
