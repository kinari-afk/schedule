// 画面テストの土台。
// 本物のFirebase（データベース・ログイン）や外部サービスには一切つながず、すべて偽物に差し替えて動かす。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.resolve(here, '..', '.cache');
const nodeModules = path.resolve(here, '..', 'node_modules');
export const INDEX_HTML = path.resolve(here, '..', '..', 'index.html');
export const SHOTS = path.resolve(here, '..', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const V = 'https://esm.sh/__test_vendor.js';
const mods = {
  'https://esm.sh/react@18.2.0': `import {React} from '${V}'; export default React; export const {useState,useMemo,useRef,useEffect,useCallback,Fragment,createElement,forwardRef}=React;`,
  'https://esm.sh/react@18.2.0/jsx-runtime': `import {JSXRuntime} from '${V}'; export const {jsx,jsxs,Fragment}=JSXRuntime;`,
  'https://esm.sh/react-dom@18.2.0/client': `import {ReactDOMClient} from '${V}'; export const {createRoot}=ReactDOMClient;`,
  'https://esm.sh/lz-string@1.5.0': `import {LZString} from '${V}'; export default LZString; export const {compressToBase64,decompressFromBase64}=LZString;`,
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js': `export const initializeApp=(c)=>({c});`,
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js': `
    // 偽の認証：ログイン状態は localStorage に残す（本物と同じく、再読み込みしても維持される）
    const A = window.__mockAuth = { user: JSON.parse(localStorage.getItem('__mockUser')||'null'), subs: [], passwordEnabled: window.__authCfg?.passwordEnabled !== false, accounts: window.__authCfg?.accounts || {} };
    const set=(u)=>{ A.user=u; if(u) localStorage.setItem('__mockUser',JSON.stringify(u)); else localStorage.removeItem('__mockUser'); A.subs.forEach(cb=>setTimeout(()=>cb(A.user),0)); };
    const err=(code)=>{ const e=new Error(code); e.code=code; return e; };
    export const getAuth=()=>({});
    export const onAuthStateChanged=(a,cb)=>{ A.subs.push(cb); setTimeout(()=>cb(A.user),0); return ()=>{}; };
    export const signInAnonymously=async()=>{ window.__anonSignIns=(window.__anonSignIns||0)+1; set({uid:'anon',isAnonymous:true}); };
    export const signInWithCustomToken=async()=>{ set({uid:'tok',isAnonymous:false}); };
    export const signInWithEmailAndPassword=async(a,email,pw)=>{ if(!A.passwordEnabled) throw err('auth/operation-not-allowed'); if(A.accounts[email]!==pw) throw err('auth/invalid-credential'); set({uid:'u-'+email,email,isAnonymous:false}); };
    export const signOut=async()=>{ set(null); };`,
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js': `
    // 偽のデータベース：複数ドキュメント対応。strictRules のときは「書き込みはパスワードログインのみ」を再現
    const saved = window.__authCfg?.persist ? localStorage.getItem('__mockDocs') : null;
    const S = window.__mockStore = window.__mockStore || { docs: saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(window.__seedDocs || {})), subs: {}, writes: [] };
    if (window.__authCfg?.persist) localStorage.setItem('__mockDocs', JSON.stringify(S.docs));
    const MAIN='artifacts/care-route-app/public/data/careRoute_state/main';
    Object.defineProperty(S,'data',{get(){return S.docs[MAIN]||null;}});
    const err=(code)=>{ const e=new Error(code); e.code=code; return e; };
    const snap=(p)=>({exists:()=>S.docs[p]!=null,data:()=>({...S.docs[p]})});
    export const getFirestore=()=>({});
    export const initializeFirestore=()=>({}); export const persistentLocalCache=(o)=>o; export const persistentMultipleTabManager=()=>({});
    export const doc=(db,...a)=>({path:a.join('/')});
    export const setDoc=async(ref,data,opt)=>{
      const u=window.__mockAuth?.user;
      if (window.__authCfg?.strictRules && (!u || u.isAnonymous)) throw err('permission-denied');
      const size=Object.entries(data).reduce((n,[k,v])=>n+k.length+new TextEncoder().encode(String(v)).length,0);
      if (size>1048487) throw err('invalid-argument');
      S.docs[ref.path] = opt&&opt.merge ? {...(S.docs[ref.path]||{}),...data} : {...data};
      S.writes.push(ref.path);
      if (window.__authCfg?.persist) localStorage.setItem('__mockDocs', JSON.stringify(S.docs));
      (S.subs[ref.path]||[]).forEach(cb=>setTimeout(()=>cb(snap(ref.path)),0));
    };
    export const getDoc=async(ref)=>snap(ref.path);
    export const onSnapshot=(ref,cb)=>{ (S.subs[ref.path]=S.subs[ref.path]||[]).push(cb); setTimeout(()=>cb(snap(ref.path)),0); return ()=>{ S.subs[ref.path]=S.subs[ref.path].filter(x=>x!==cb); }; };`,
};

// 外部への通信をすべて横取りして、ローカルの偽物を返す。知らない宛先は遮断して記録する
export function makeRouteHandler({ csv = {}, routes = {}, errors = [], isOffline = () => false }) {
  const lucideNames = fs.readFileSync(INDEX_HTML,'utf8').match(/import \{([^}]+)\} from 'lucide-react'/)[1].split(',').map(s=>s.trim().split(' as ')[0]);
  return async (route) => {
    const url = route.request().url();
    if (isOffline()) return route.abort('internetdisconnected');
    if (url.startsWith('http://localhost')) return route.continue();
    const js = (body) => route.fulfill({ status: 200, contentType: 'text/javascript', body, headers: { 'access-control-allow-origin': '*' } });
    if (url.startsWith('https://test.local/app')) return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(INDEX_HTML,'utf8') });
    if (url === V) return js(fs.readFileSync(path.join(cache,'vendor.js'),'utf8'));
    if (url.startsWith('https://cdn.tailwindcss.com')) return js(`const st=document.createElement('style'); st.textContent=${JSON.stringify(fs.readFileSync(path.join(cache,'tw.css'),'utf8'))}; document.head.appendChild(st);`);
    if (url.startsWith('https://unpkg.com/@babel/standalone')) return js(fs.readFileSync(path.join(nodeModules,'@babel/standalone/babel.min.js'),'utf8'));
    if (url.startsWith('https://esm.sh/lucide-react')) return js(`import {Lucide} from '${V}'; export const {${lucideNames.join(',')}}=Lucide;`);
    if (mods[url]) return js(mods[url]);
    for (const k of Object.keys(routes)) if (url.includes(k)) return routes[k](route, url);
    for (const k of Object.keys(csv)) if (url.includes(k)) return route.fulfill({ status: 200, contentType: 'text/csv', body: typeof csv[k]==='function'?csv[k]():csv[k], headers: { 'access-control-allow-origin': '*' } });
    errors.push('BLOCKED ' + url);
    return route.abort();
  };
}
export async function launch({ viewport, seed, admin = true, csv = {}, isMobile = false, scale = 1, authCfg = {}, login = null, routes = {} }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport, deviceScaleFactor: scale, isMobile, hasTouch: isMobile, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);   // コピーした内容をテストで読み取るため
  // テストの中の「今日」を固定する（2026-11-11 水曜の朝10時から時計が進む）。実行する日によって結果が変わらないように
  await ctx.clock.install({ time: new Date('2026-11-11T10:00:00+09:00') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/*', makeRouteHandler({ csv, routes, errors }));
  await page.addInitScript(([seed, authCfg]) => { window.__seedDocs = seed ? { 'artifacts/care-route-app/public/data/careRoute_state/main': seed } : {}; window.__authCfg = authCfg; }, [seed, authCfg]);
  await page.goto('https://test.local/app' + (admin ? '?mode=admin' : ''));
  await page.waitForSelector('#root > div', { timeout: 30000 });
  await page.waitForTimeout(600);
  if (login) { await page.fill('input[name=email]', login[0]); await page.fill('input[name=password]', login[1]); await page.click('button[type=submit]:has-text("ログイン")'); await page.waitForTimeout(500); }
  return { browser, page, errors, ctx, store: () => page.evaluate(() => window.__mockStore.data), docs: () => page.evaluate(() => window.__mockStore.docs) };
}
// ---- 偽データ（実在の人物ではありません） ----
export function makeSeed(monday) {
  const colors = ['#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
  const names = ['青木 さくら','井上 健','上田 みどり','遠藤 あかり','小川 大地','加藤 ゆり'];
  const nurses = names.map((name,i)=>({ id: 1000+i, name, startLocation:{x:50,y:50}, color: colors[i], startTime:'08:30', endTime:'17:30', offDays: i===4?[{day:3,type:'full'}]:[], specificOffDays:[], isLowPriority: i===5, isFemale: i!==1 && i!==4 }));
  const users = ['相川','石田','宇野','江口','大野','片山','木村','久保','剣持','小林','斉藤','柴田','須藤','関','園田','高田','千葉','土屋','寺田','戸田','中村','西田','沼田','根本'].map(n=>n+' 太郎 様');
  const times = ['09:00','09:30','10:00','10:30','11:00','11:30','13:30','14:00','14:30','15:00','15:30','16:00'];
  const visits = []; let id = 5000;
  const addDays=(d,n)=>{const x=new Date(d); x.setDate(x.getDate()+n); return x.toISOString().split('T')[0];};
  const hash=(s)=>{let h=0; for(const c of s) h=c.charCodeAt(0)+((h<<5)-h); return {x:Math.abs(h%80)+10,y:Math.abs((h>>3)%80)+10};};
  for (let w=-3; w<=0; w++) for (let d=0; d<5; d++) {
    const date = addDays(monday, w*7+d);
    users.forEach((u,ui)=>{
      if ((ui+d)%2) return;
      const t = times[(ui*5+d)%times.length];
      visits.push({ id:id++, userName:u, location:hash(u), duration: ui%3===0?60:30, date, dayOfWeek:(d+1)%7, startTime:t, originalStartTime:t,
        nurseId: w<0 ? nurses[ui%4].id : null, requiresFemaleNurse: ui%7===0, preferredNurseNames: ui===3?['上田']:[], excludedNurseNames: ui===5?['井上']:[], address:'東京都架空区'+(ui+1)+'丁目', isExcludedFromAutoAssign:false, isAccompany:false, ...(ui===2?{comment:'玄関の鍵はポストの中。犬がいます。'}:{}) });
    });
  }
  return { nurses: JSON.stringify(nurses), visits: JSON.stringify(visits), nurseStatuses:'[]', savedPatterns:'{}', dailyMemos: JSON.stringify({[addDays(monday,2)]:'本日14時からカンファレンスがあります。'}), sheetUrl:'https://sheet.local/users.csv', nurseSheetUrl:'https://sheet.local/nurses.csv', baseTravelTime:7, _nurses:nurses, _visits:visits };
}
