// Copia o overlay compartilhado para o módulo TizenBrew (tizenbrew/userScript.js).
// O arquivo gerado fica versionado porque o TizenBrew baixa o módulo direto do GitHub/npm.
// Uso: node scripts/build-tizenbrew.js [--check]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'web', 'src', 'tv-overlay.js'), 'utf8');
const out = path.join(root, 'tizenbrew', 'userScript.js');
const content = '// Gerado por scripts/build-tizenbrew.js a partir de web/src/tv-overlay.js. Não edite.\n' + src;

if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== content) {
    console.error('tizenbrew/userScript.js está desatualizado: rode npm run build:tizenbrew');
    process.exit(1);
  }
  console.log('ok: tizenbrew/userScript.js em dia');
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
  console.log('gerado', path.relative(root, out));
}
