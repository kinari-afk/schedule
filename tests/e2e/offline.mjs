// オフライン表示のテスト。実行: npm run test:offline
// 本物のWebサーバーを立て、サービスワーカー（sw.js）を実際に動かして確かめる。
//  1) 通信できる状態で開く → 2) 通信を完全に止める → 3) 開き直しても表示されること
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { makeRouteHandler, makeSeed, INDEX_HTML, SHOTS } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SW = path.resolve(here, '..', '..', 'sw.js');
let serverUp = true, offline = false;
const server = http.createServer((req, res) => {
  if (!serverUp) { req.socket.destroy(); return; }
  const p = req.url.split('?')[0];
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(INDEX_HTML)); }
  else if (p === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(fs.readFileSync(SW)); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/index.html`;

const { _nurses, _visits, ...seed } = makeSeed('2026-11-09');
const vs = JSON.parse(seed.visits); vs.forEach((v, i) => { if (v.date >= '2026-11-09') v.nurseId = _nurses[i % 4].id; }); seed.visits = JSON.stringify(vs);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const errors = [];
await ctx.route('**/*', makeRouteHandler({ errors, isOffline: () => offline }));
await ctx.addInitScript(([seed]) => { window.__seedDocs = { 'artifacts/care-route-app/public/data/careRoute_state/main': seed }; window.__authCfg = { persist: true }; }, [seed]);
const page = await ctx.newPage();

// 1) 通信できる状態で開く。サービスワーカーが有効になったら、もう一度開いて部品を端末に保存させる
await page.goto(base);
await page.waitForSelector('.visit-card', { timeout: 30000 });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForSelector('.visit-card', { timeout: 30000 });
await page.waitForTimeout(1500);
const cached = await page.evaluate(async () => { const c = await caches.open('careroute-shell-v1'); return (await c.keys()).map(r => r.url); });
assert(cached.some(u => u.includes('index.html')), 'ページ本体が保存されていない');
for (const host of ['cdn.tailwindcss.com', 'unpkg.com', 'esm.sh', 'www.gstatic.com']) assert(cached.some(u => u.includes(host)), host + ' の部品が保存されていない');
assert(!cached.some(u => u.includes('firestore.googleapis.com') || u.includes('identitytoolkit')), 'データベースやログインの通信まで保存している');
const onlineCards = await page.locator('.visit-card').count();
console.log('1 OK: 端末に保存された部品', cached.length, '件');

// 2) 通信を完全に止める（サーバー停止＋外部への通信もすべて失敗させる）
serverUp = false; offline = true;
await ctx.setOffline(true);

// 3) 開き直す → 保存した内容で表示される
await page.reload();
await page.waitForSelector('.visit-card', { timeout: 30000 });
await page.waitForSelector('text=オフラインです');
assert.equal(await page.locator('.visit-card').count(), onlineCards, '表示される予定の数が違う');
fs.mkdirSync(SHOTS, { recursive: true });
await page.screenshot({ path: path.join(SHOTS, 'offline.png') });
console.log('2 OK: 通信なしで開き直しても表示される（予定', onlineCards, '件・オフライン表示あり）');

// 4) 通信が戻る → 最新のページを取りに行く（古い保存分に固定されない）
serverUp = true; offline = false;
await ctx.setOffline(false);
await page.reload();
await page.waitForSelector('.visit-card', { timeout: 30000 });
assert.equal(await page.locator('text=オフラインです').count(), 0);
console.log('3 OK: 通信が戻ると通常表示に戻る');

await browser.close(); server.close();
console.log('ALL PASS');
