// Empacota e assina o atalho da Samsung (tizen/launcher) como hotgo-tv-samsung.wgt, sem Tizen Studio.
// Usa o tizen.js (github:reisxd/tizen.js), o mesmo do TizenBrew Installer: certificado de autor Tizen
// próprio + distribuidor público do SDK, que as TVs com Tizen até 6.5 aceitam no modo desenvolvedor.
// O certificado de autor fica fora do repositório (padrão: ~/.hotgo-tv/author.p12). Para atualizar o
// atalho instalado, use o mesmo certificado; com outro, desinstale o atalho antes.
// Uso: node scripts/build-tizen-launcher.js [pasta-do-certificado]
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'tizen', 'launcher');
const out = path.join(root, 'hotgo-tv-samsung.wgt');
const certDir = process.argv[2] || path.join(os.homedir(), '.hotgo-tv');
const cert = path.join(certDir, 'author.p12');
const password = 'hotgotv';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function tizenjs(args, cwd) {
  execFileSync(npx, ['-y', '-p', 'github:reisxd/tizen.js', 'tizenjs'].concat(args),
    { cwd: cwd || root, stdio: 'inherit', shell: process.platform === 'win32' });
}

if (!fs.existsSync(cert)) {
  fs.mkdirSync(certDir, { recursive: true });
  tizenjs(['create-tizen-cert', '--name', 'HotGo TV', '--password', password, '--output', cert]);
}
tizenjs(['build', '.', '-t', 'wgt', '-o', out, '--author', cert, '--authorPwd', password, '-p', 'public'], src);
console.log('gerado', path.relative(root, out));
