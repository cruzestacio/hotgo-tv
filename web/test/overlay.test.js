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
    contentType: 'text/html',
    body: '<!doctype html><title>hotgo</title><body><streann-root><div id="enquete" ' +
      'style="position:fixed;right:0;bottom:0;width:300px;height:300px;z-index:2147483647;background:#f06">enquete</div>' +
      '</streann-root></body>'
  }));
  await page.route('https://cf.streann.tech/**', (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors() });
    calls.push({ method: req.method(), path: u.pathname, auth: req.headers()['authorization'], body: req.postData() });
    // o layout do usuário falhando: o Início tem que vir do catálogo público
    if (u.pathname.endsWith('/user/tab-layout')) return r.fulfill({ status: 500, headers: cors(), body: '{}' });
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
  // pop-ups do site (como a enquete) não ficam por cima do Início
  assert.strictEqual(await page.$eval('#enquete', (e) => e.offsetParent === null), true);
  const layout = calls.find((c) => c.path.endsWith('/tab-layout'));
  assert.strictEqual(layout.path, '/web/services/v3/user/tab-layout');
  assert.strictEqual(layout.auth, 'Bearer token-de-teste');
  assert.ok(calls.some((c) => c.path === '/web/services/v3/external/tab-layout'));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'home-api.png') });

  await press(page, 'ArrowDown');
  const first = await focused(page);
  // o card focado tem que se destacar dos outros
  const look = await page.evaluate(() => {
    const f = document.querySelector('.tvf-card.tvf-focus');
    const other = document.querySelector('.tvf-card:not(.tvf-focus)');
    return { f: !!f, title: f && getComputedStyle(f.querySelector('.tvf-card-title')).backgroundColor,
      op: f && getComputedStyle(f).opacity, otherOp: other && getComputedStyle(other).opacity };
  });
  assert.ok(look.f, 'nenhum card focado');
  assert.strictEqual(look.title, 'rgb(255, 45, 85)');
  assert.ok(Number(look.op) > Number(look.otherOp));
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

  // No app do Fire TV, o vídeo vai para o player nativo pela ponte HotGoNative
  await page.evaluate(() => {
    window.nativeCalls = [];
    window.HotGoNative = { play: (url, title) => { window.nativeCalls.push([url, title]); return true; } };
  });
  await page.evaluate(() => window.hotgoTV.openItem({ id: 'vod002', type: 'vod', title: 'Nativo' }));
  await page.waitForFunction(() => window.nativeCalls.length === 1, null, { timeout: 3000 });
  assert.deepStrictEqual(await page.evaluate(() => window.nativeCalls[0]),
    ['https://cfvod.example/vod002/hls/master.m3u8', 'Nativo']);
  await page.evaluate(() => { delete window.HotGoNative; });

  // Voltar fecha o player e reabre o Início
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 10009, bubbles: true })));
  await page.waitForTimeout(200);
  assert.strictEqual(await page.$eval('#tvf-player', (v) => v.style.display), 'none');
  assert.strictEqual(await page.$eval('#tvf-home', (h) => h.classList.contains('open')), true);

  assert.deepStrictEqual(errors, []);
  await page.close();
}

// Sem sessão no hotgo.tv, o app abre o login por código e grava a sessão quando o código é confirmado
async function codeLoginScenario(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  let polls = 0;
  let confirmed = false; // vira true quando o teste "confirma o código no celular"
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://www.hotgo.tv/**', (r) => r.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>hotgo</title><body><streann-root></streann-root></body>'
  }));
  await page.route('https://api.streann.tech/**', (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors() });
    if (u.pathname.endsWith('/login-code')) return r.fulfill({ headers: cors(), json: { id: 'x', code: '123456', date: Date.now() } });
    if (u.pathname.includes('/smartTv/login/code/123456/')) {
      assert.strictEqual(r.request().headers()['authorization'].length, 64);
      polls++;
      if (!confirmed) return r.fulfill({ headers: cors(), body: '' });
      return r.fulfill({ headers: cors(), json: { access_token: 'tok-codigo', refresh_token: 'ref', expires_in: 3600 } });
    }
    return r.fulfill({ status: 404, headers: cors(), body: '{}' });
  });
  await page.route('https://cf.streann.tech/**', (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors() });
    if (u.pathname === '/web/services/user') return r.fulfill({ headers: cors(), json: { id: 'user1', ipCountry: 'BR' } });
    return r.fulfill({ status: 404, headers: cors(), body: '{}' });
  });
  await page.addInitScript(() => { window.hotgoTVPollEvery = 200; });
  await page.goto('https://www.hotgo.tv/pt/home');
  await page.addScriptTag({ content: OVERLAY });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  try {
    await page.waitForSelector('#tvf-login.open', { timeout: 5000 });
  } catch (e) {
    console.error('login não abriu. erros:', errors, 'console:', logs,
      'estado:', await page.evaluate(() => ({ v: window.hotgoTV && window.hotgoTV.version, host: location.hostname,
        tok: localStorage.getItem('access_token'), el: !!document.getElementById('tvf-login') })));
    throw e;
  }
  await page.waitForFunction(() => document.getElementById('tvf-code').textContent === '123456', null, { timeout: 3000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'login-code.png') });
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('access_token')), null);
  confirmed = true;
  await page.waitForFunction(() => localStorage.getItem('access_token') === 'tok-codigo', null, { timeout: 15000 });
  await page.waitForFunction(() => localStorage.getItem('userId') === 'user1', null, { timeout: 3000 });
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('remeberMe')), 'true');
  console.log('login por código ok, polls:', polls);
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
  await codeLoginScenario(browser);
  await browser.close();
  console.log('ok: overlay passou em todos os cenários');
})().catch((e) => { console.error(e); process.exit(1); });
