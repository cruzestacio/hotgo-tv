// Monta os arquivos do app da Samsung numa pasta: tizen/app com a versão preenchida + o overlay.
// Usado pelo scripts/build-tizen-app.js (que assina e gera o .wgt) e pelo teste web/test/tizen-app.test.js.
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'tizen', 'app');

function stage(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'hotgo-tizen-'));
  const [, minor, patch] = pkg.version.split('.');
  // a versão do pacote Tizen começa em 1 porque o antigo atalho (mesmo id) já estava instalado como 1.0.0
  const widgetVersion = '1.' + minor + '.' + patch;
  for (const name of fs.readdirSync(src)) {
    let data = fs.readFileSync(path.join(src, name));
    if (name === 'config.xml') data = data.toString('utf8').replace('__VERSION__', widgetVersion);
    if (name === 'loader.js') data = data.toString('utf8').replace('__VERSION__', pkg.version);
    fs.writeFileSync(path.join(dir, name), data);
  }
  const overlay = fs.readFileSync(path.join(root, 'web', 'src', 'tv-overlay.js'), 'utf8');
  if (!overlay.includes("version: '" + pkg.version + "'")) {
    throw new Error('a versão em web/src/tv-overlay.js (window.hotgoTV.version) não bate com o package.json');
  }
  fs.writeFileSync(path.join(dir, 'overlay.js'), overlay);
  return dir;
}

module.exports = { stage };
