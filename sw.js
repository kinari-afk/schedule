// CareRoute のオフライン対応（サービスワーカー）
// アプリ本体（index.html）と、表示に必要な外部の部品を端末に保存し、電波がないときはそこから表示する。
// ※ 予定のデータそのものは Firestore 側の仕組み（index.html 内の persistentLocalCache）が端末に保存する。
const CACHE = 'careroute-shell-v1';

// 端末に保存してよい外部サイト（アプリの部品の配布元）。データベースやログインの通信は対象外。
const ASSET_HOSTS = ['cdn.tailwindcss.com', 'unpkg.com', 'esm.sh', 'www.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('careroute-shell-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const put = async (request, response) => {
  // 正常な応答だけを保存する（opaque は、別サイトの <script> 読み込みで中身が見えない応答。保存はできる）
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
};

// まず通信を試し、だめなら（または遅すぎたら）端末に保存した分を返す。ページ本体に使う＝常に最新を優先
const networkFirst = async (request, timeoutMs) => {
  const cached = await caches.match(request, { ignoreSearch: true });
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), cached ? timeoutMs : 60000)),
    ]);
    return await put(request, fresh);
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
};

// 保存した分があればすぐ返し、裏で新しいものを取りに行って次回に備える。部品に使う＝速さを優先
const staleWhileRevalidate = async (request) => {
  const cached = await caches.match(request);
  const refresh = fetch(request).then(res => put(request, res)).catch(() => null);
  return cached || (await refresh) || Response.error();
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
      event.respondWith(networkFirst(request, 4000));
    }
    return;
  }
  if (ASSET_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
