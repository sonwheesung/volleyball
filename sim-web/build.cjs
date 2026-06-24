// 엔진 테스트 콘솔(PC 브라우저) 번들 — 순수 경기 엔진(engine/·data/)을 브라우저용으로 esbuild 번들.
// RN·AsyncStorage·expo 의존은 스텁으로 무력화(엔진은 순수 TS라 실제로 안 씀). 백엔드 불필요.
//   node sim-web/build.cjs            1회 빌드 → dist/bundle.js (sim-web/index.html 을 열면 됨)
//   node sim-web/build.cjs --watch    소스 변경 시 자동 재빌드
//   node sim-web/build.cjs --serve    빌드+감시+정적 서버(0.0.0.0:5051 — 폰에서도 접속)
const esbuild = require('esbuild');
const path = require('path');
const root = path.resolve(__dirname, '..');
const stubs = path.join(__dirname, '_stubs');

const opts = {
  // 두 페이지: 엔진 콘솔(index.html→dist/bundle.js) + 수비 위치 실험실(board-lab.html→dist/board-lab.js)
  entryPoints: [
    { out: 'bundle', in: path.join(__dirname, 'main.ts') },
    { out: 'board-lab', in: path.join(__dirname, 'board-lab.ts') },
  ],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outdir: path.join(__dirname, 'dist'),
  alias: {
    'react-native': path.join(stubs, 'empty.ts'),
    '@react-native-async-storage/async-storage': path.join(stubs, 'async-storage.ts'),
    'react-native-url-polyfill/auto': path.join(stubs, 'empty.ts'),
  },
  tsconfig: path.join(root, 'tsconfig.json'),
  define: { __DEV__: 'false' },
  logLevel: 'info',
};

const port = Number((process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1]) || 5051;

if (process.argv.includes('--serve')) {
  const http = require('http');
  const fs = require('fs');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
  esbuild.context(opts).then(async (ctx) => {
    await ctx.watch();
    http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/' || p === '') p = '/index.html';
      const file = path.join(__dirname, p);
      if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end('forbidden'); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(buf);
      });
    }).listen(port, '0.0.0.0', () => {
      console.log(`\n  배구 엔진 테스트 콘솔 ▶  http://localhost:${port}/   (폰: http://<PC IP>:${port}/)\n  0.0.0.0:${port} 바인딩 · Ctrl+C 종료\n`);
    });
  }).catch((e) => { console.error(e.message || e); process.exit(1); });
} else if (process.argv.includes('--watch')) {
  esbuild.context(opts).then((ctx) => ctx.watch().then(() => console.log('watching… (sim-web/index.html 열어 사용)')));
} else {
  esbuild.build(opts).then(() => console.log('빌드 완료 → sim-web/index.html 을 브라우저로 열어줘')).catch(() => process.exit(1));
}
