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
const tools = path.join(certDir, 'tizenjs');
const password = 'hotgotv';

// o tizen.js fica instalado junto do certificado, fora do repositório
if (!fs.existsSync(path.join(tools, 'node_modules', 'tizen'))) {
  fs.mkdirSync(tools, { recursive: true });
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--no-save', '--prefix', tools, 'github:reisxd/tizen.js'],
    { stdio: 'inherit', shell: process.platform === 'win32' });
}
const tizenDir = path.join(tools, 'node_modules', 'tizen');
const forge = require(require.resolve('node-forge', { paths: [tizenDir] }));
const { TizenCertificateCreator } = require(tizenDir);

// O create-tizen-cert do tizen.js grava no .p12 a chave da CA no lugar da chave do autor, e a TV
// recusa o pacote ("Signed with wrong key"). Aqui o certificado é montado com a chave certa.
async function createAuthorCert() {
  await new TizenCertificateCreator()._downloadTizenCertificates();
  const caDir = path.join(os.homedir(), 'share', '.tizen-cert', 'developer');
  const caPem = fs.readFileSync(path.join(caDir, 'tizen-developer-ca.cer'), 'utf8');
  const caKey = forge.pki.decryptRsaPrivateKey(
    fs.readFileSync(path.join(caDir, 'tizen-developer-ca-privatekey.pem'), 'utf8'),
    'tizencertificatefordevelopercaroqkfwk');
  const ca = forge.pki.certificateFromPem(caPem);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const c = forge.pki.createCertificate();
  c.publicKey = keys.publicKey;
  c.serialNumber = Date.now().toString(16);
  c.validity.notBefore = new Date();
  // não pode passar da validade da CA
  c.validity.notAfter = new Date(Math.min(Date.now() + 5 * 365 * 864e5, ca.validity.notAfter.getTime()));
  c.setSubject([{ name: 'commonName', value: 'HotGo TV' }]);
  c.setIssuer(ca.subject.attributes);
  c.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true },
    { name: 'extKeyUsage', codeSigning: true }
  ]);
  c.sign(caKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [forge.pki.certificateToPem(c), caPem], password,
    { generateLocalKeyId: true, friendlyName: 'UserCertificate', algorithm: '3des' });
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(cert, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
}

(async () => {
  if (!fs.existsSync(cert)) await createAuthorCert();
  execFileSync(process.execPath, [path.join(tizenDir, 'cli.js'), 'build', '.', '-t', 'wgt', '-o', out,
    '--author', cert, '--authorPwd', password, '-p', 'public'], { cwd: src, stdio: 'inherit' });
  console.log('gerado', path.relative(root, out));
})().catch((err) => { console.error(err); process.exit(1); });
