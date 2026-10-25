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

// No hotgo.tv o Início vem da API (tab-layout) e o vídeo toca no player próprio.
// A API é simulada com a fixture; FIXTURE=caminho troca por uma resposta real salva.
async function apiScenario(browser) {
  const fixture = process.env.FIXTURE || path.join(__dirname, 'fixtures', 'tab-layout.json');
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  const calls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://www.hotgo.tv/**', (r) => r.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>hotgo</title><body><streann-root></streann-root></body>'
  }));
  await page.route('https://cf.streann.tech/**', (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors() });
    calls.push({ method: req.method(), path: u.pathname, auth: req.headers()['authorization'], body: req.postData() });
    if (u.pathname.endsWith('/tab-layout')) return r.fulfill({ headers: cors(), path: fixture });
    if (u.pathname.endsWith('/check-access')) return r.fulfill({ headers: cors(), json: { hasAccess: true } });
    if (u.pathname.endsWith('/playlist.m3u8')) {
      return r.fulfill({ headers: cors(), json: { url: 'https://cfvod.example/' + u.pathname.split('/')[5] + '/hls/master.m3u8' } });
    }
    return r.fulfill({ status: 404, headers: cors(), body: '{}' });
  });
  await page.addInitScript(() => {
    localStorage.setItem('access_token', 'token-de-teste');
    localStorage.setItem('langCode', 'pt');
    // Chromium do Playwright não toca HLS; nas TVs o player nativo toca
    HTMLMediaElement.prototype.canPlayType = () => 'maybe';
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  });
  await page.goto('https://www.hotgo.tv/pt/home');
  await page.addScriptTag({ content: OVERLAY });

  await page.waitForSelector('#tvf-home.open', { timeout: 5000 });
  const rows = await page.$$eval('.tvf-row-title', (h) => h.map((x) => x.textContent));
  if (!process.env.FIXTURE) assert.deepStrictEqual(rows, ['Estreias', 'Mais vistos']);
  console.log('linhas do Início:', rows.length, rows.slice(0, 5).join(' | '));
  const layout = calls.find((c) => c.path.endsWith('/tab-layout'));
  assert.strictEqual(layout.path, '/web/services/v3/user/tab-layout');
  assert.strictEqual(layout.auth, 'Bearer token-de-teste');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'home-api.png') });

  await press(page, 'ArrowDown');
  const first = await focused(page);
  await press(page, 'Enter');
  await page.waitForFunction(() => {
    const v = document.getElementById('tvf-player');
    return v && v.src && v.classList.contains('tvf-max');
  }, null, { timeout: 3000 });
  const access = calls.find((c) => c.path.endsWith('/check-access'));
  assert.match(access.body, /dataType=videoondemand/);
  assert.match(access.body, /device-id=tv/);
  const src = await page.$eval('#tvf-player', (v) => v.src);
  assert.match(src, /^https:\/\/cfvod\.example\/.+\/hls\/master\.m3u8$/);
  console.log('tocando', first, '->', src);

  // Voltar fecha o player e reabre o Início
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 10009, bubbles: true })));
  await page.waitForTimeout(200);
  assert.strictEqual(await page.$eval('#tvf-player', (v) => v.style.display), 'none');
  assert.strictEqual(await page.$eval('#tvf-home', (h) => h.classList.contains('open')), true);

  assert.deepStrictEqual(errors, []);
  await page.close();
}

function cors() {
  return {
    'access-control-allow-origin': 'https://www.hotgo.tv',
    'access-control-allow-headers': 'authorization,x-app-name,x-app-platform,x-langcode,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
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
  await apiScenario(browser);
  await browser.close();
  console.log('ok: overlay passou em todos os cenários');
})().catch((e) => { console.error(e); process.exit(1); });
