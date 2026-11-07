// Teste do app da Samsung (tizen/app) aberto como arquivo local, como a TV abre o .wgt: sem site por baixo,
// login por código direto e atualização do overlay pelo GitHub para a próxima abertura.
// Uso: node web/test/tizen-app.test.js
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');
const { stage } = require('../../scripts/tizen-app-stage');

const pkg = require('../../package.json');
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

(async () => {
  const dir = stage();
  const overlay = fs.readFileSync(path.join(dir, 'overlay.js'), 'utf8');
  const remote = overlay.replace("version: '" + pkg.version + "'", "version: '99.0.0'");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  let siteHits = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://www.hotgo.tv/**', (r) => { siteHits++; return r.abort(); });
  await page.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ headers: cors, body: remote }));
  await page.route('https://api.streann.tech/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (new URL(r.request().url()).pathname.endsWith('/login-code')) {
      return r.fulfill({ headers: cors, json: { id: 'x', code: '654321', date: Date.now() } });
    }
    return r.fulfill({ headers: cors, body: '' });
  });
  await page.route('https://cf.streann.tech/**', (r) => r.fulfill({ status: 404, headers: cors, body: '{}' }));
  await page.addInitScript(() => { window.hotgoTVUpdateAfter = 300; window.hotgoTVPollEvery = 60000; });

  // Primeira abertura: overlay do pacote, login por código sem o botão de e-mail (que levaria ao site)
  await page.goto('file://' + path.join(dir, 'index.html'));
  await page.waitForSelector('#tvf-login.open', { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('tvf-code').textContent === '654321', null, { timeout: 3000 });
  assert.strictEqual(await page.evaluate(() => window.hotgoTV.version), pkg.version);
  assert.strictEqual(await page.$('#splash'), null);
  const buttons = await page.$$eval('#tvf-login button', (b) => b.map((x) => x.textContent));
  assert.ok(!buttons.some((t) => /e-mail/i.test(t)), 'sem login por e-mail no app: ' + buttons);

  // Voltar no login, sem sessão, pede para sair do app (não há site por baixo)
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 10009, bubbles: true })));
  await page.waitForFunction(() => /Voltar de novo para sair/.test((document.getElementById('tvf-toast') || {}).textContent || ''), null, { timeout: 2000 });

  // A versão nova do GitHub fica guardada e vale na próxima abertura
  await page.waitForFunction(() => /version: '99\.0\.0'/.test(localStorage.getItem('tvfAppCode') || ''), null, { timeout: 5000 });
  await page.reload();
  await page.waitForSelector('#tvf-login.open', { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => window.hotgoTV.version), '99.0.0');

  // Uma cópia guardada que quebra ao subir é descartada e o app volta para o overlay do pacote
  await page.evaluate(() => localStorage.setItem('tvfAppCode', "throw new Error('quebrado'); version: '100.0.0'"));
  await page.unroute('https://raw.githubusercontent.com/**');
  await page.route('https://raw.githubusercontent.com/**', (r) => r.abort());
  await page.reload();
  await page.waitForSelector('#tvf-login.open', { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => window.hotgoTV.version), pkg.version);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('tvfAppCode')), null);

  assert.strictEqual(siteHits, 0, 'o app não pode abrir o site');
  assert.deepStrictEqual(errors.filter((e) => !/quebrado/.test(e)), []);
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok: app da Samsung passou');
})().catch((e) => { console.error(e); process.exit(1); });
