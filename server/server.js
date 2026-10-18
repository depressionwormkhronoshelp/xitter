// Xitter — сервер для веб-версии.
// Данные и сообщения живут в Firebase, этот сервер только раздаёт интерфейс:
// по http (порт 3000) и по https (порт 3443, нужен браузерам для звонков в локальной сети).

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || PORT + 443;
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIR = path.resolve(process.env.WEB_DIR || path.join(__dirname, '..', 'web'));
const DATA_DIR = path.join(__dirname, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
};

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(WEB_DIR, 'index.html');
    fs.stat(file, (err2, st2) => {
      if (err2) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Length': st2.size,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

// Самоподписанный сертификат создаётся при первом запуске (нужна папка node_modules/selfsigned)
function httpsOptions() {
  const certFile = path.join(DATA_DIR, 'cert.pem');
  const keyFile = path.join(DATA_DIR, 'key.pem');
  try {
    if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
      const selfsigned = require('selfsigned');
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...lanAddresses().map((ip) => ({ type: 7, ip }))];
      const pems = selfsigned.generate([{ name: 'commonName', value: 'Xitter local' }], {
        days: 3650,
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames }],
      });
      fs.writeFileSync(certFile, pems.cert);
      fs.writeFileSync(keyFile, pems.private);
    }
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  } catch (e) {
    console.warn('  HTTPS не запущен:', e.message);
    return null;
  }
}

const tls = httpsOptions();
if (tls) https.createServer(tls, handler).listen(HTTPS_PORT, HOST);

http.createServer(handler).listen(PORT, HOST, () => {
  const ips = lanAddresses();
  console.log('\n  \x1b[38;5;208m✕ Xitter\x1b[0m веб-версия запущена (данные в Firebase)\n');
  console.log(`  На этом компьютере:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  В локальной сети:    http://${ip}:${PORT}`);
  if (tls) for (const ip of ips) console.log(`  Со звонками:         https://${ip}:${HTTPS_PORT}  (браузер спросит про сертификат: «Дополнительно» → «Перейти»)`);
  console.log('\n  Остановить: Ctrl+C\n');
});
