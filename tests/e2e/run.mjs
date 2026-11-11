// 画面を実際に操作する通しテスト。実行: npm run test:e2e
// 本物のFirebaseや外部サービスにはつながりません（e2e/lib.mjs が偽物に差し替えます）。
import { launch, makeSeed, SHOTS } from './lib.mjs';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import LZ from 'lz-string';
const shot = (name) => path.join(SHOTS, name);
const MON='2026-11-09';
const parse=(s)=> s.startsWith('LZ:') ? JSON.parse(LZ.decompressFromBase64(s.slice(3))) : JSON.parse(s);
const AUTH={accounts:{'admin@test.local':'pw123456'},strictRules:true}; const LOGIN=['admin@test.local','pw123456'];
const MAIN='artifacts/care-route-app/public/data/careRoute_state/main';
const ARCH=(m)=>'artifacts/care-route-app/public/data/careRoute_archive/'+m;
const mk=()=>{ const { _nurses, _visits, ...seed } = makeSeed(MON); return { seed, _nurses, _visits }; };
// 表示する週と日付を固定する。再読み込みすると偽データベースは初期状態に戻る点に注意
const setDates = async (page, sel) => { await page.evaluate(([m,s])=>{ localStorage.setItem('careRoute_startDate',m); localStorage.setItem('careRoute_selectedDate',s); localStorage.setItem('careRoute_activeTab','overview'); },[MON,sel]); await page.reload(); await page.waitForSelector('#root > div'); await page.waitForTimeout(900); };
const side = (page, name) => page.locator('aside button', { hasText:name }).click();
const errs=[];

// ============ 1. スマホ・閲覧モード ============
{
  const { seed } = mk();
  // 今週分に割り当てを入れておく（表示確認用）
  const vs = JSON.parse(seed.visits); const ns = JSON.parse(seed.nurses);
  vs.forEach((v,i)=>{ if(v.date>=MON && i%5!==0) v.nurseId = ns[i%4].id; });
  seed.visits = JSON.stringify(vs);
  const { browser, page, errors } = await launch({ viewport:{width:390,height:780}, seed, admin:false, isMobile:true, scale:2 });
  await setDates(page,'2026-11-11');
  await page.screenshot({ path:shot('m-overview.png') });
  // カードをタップ → 詳細
  await page.locator('.visit-card').first().click(); await page.waitForTimeout(300);
  await page.screenshot({ path:shot('m-detail.png') });
  await page.mouse.click(5,300); await page.waitForTimeout(200);
  await page.locator('#root > div > nav button', { hasText:'個別' }).click(); await page.waitForTimeout(400);
  await page.locator('button', { hasText:'上田 みどり' }).click(); await page.waitForTimeout(300);
  await page.screenshot({ path:shot('m-schedule.png') });
  assert.equal(await page.locator('button', { hasText:'自動編成' }).count(), 0, '閲覧モードに自動編成ボタンが出ている');
  await page.locator('#root > div > nav button', { hasText:'集計' }).click(); await page.waitForTimeout(400);
  await page.screenshot({ path:shot('m-report.png') });
  await page.locator('#root > div > nav button', { hasText:'利用者' }).click(); await page.waitForTimeout(400);
  await page.screenshot({ path:shot('m-visits.png') });
  const w = await page.evaluate(()=>({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth}));
  assert(w.sw<=w.cw, 'ページ全体が横スクロールしている '+JSON.stringify(w));
  errs.push(...errors); await browser.close();
  console.log('1 OK: スマホ閲覧モード');
}

// ============ 2. PC・管理者：自動編成 → 名簿更新 → 利用者同期 ============
{
  const { seed, _nurses } = mk();
  const nurseCsv = () => ['氏名,開始,終了,休み曜日,優先度,性別,特定休日,出発地',
    // 順番を入れ替え、1名追加、勤務時間を変更
    '上田 みどり,09:00,17:30,,,女性,,','青木 さくら,08:30,17:30,,,女性,,','井上 健,08:30,17:30,,,,,','遠藤 あかり,08:30,17:30,,,女性,,','小川 大地,08:30,17:30,水,,,,','加藤 ゆり,08:30,17:30,,低,女性,,','新人 はなこ,08:30,17:30,,,女性,,'].join('\n');
  let userCsvBody = '';
  const { browser, page, errors, store } = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN, csv:{ 'nurses.csv': nurseCsv, 'users.csv': ()=>userCsvBody } });
  await setDates(page,'2026-11-11');
  const before = parse((await store()).visits);
  const todayCount = before.filter(v=>v.date==='2026-11-11').length;
  // --- 自動編成
  await page.locator('button', { hasText:'自動編成' }).first().click();
  await page.waitForSelector('text=自動編成完了'); 
  const toast1 = await page.locator('text=自動編成完了').innerText();
  let st = await store(); let vs = parse(st.visits); const ns = JSON.parse(st.nurses);
  const today = vs.filter(v=>v.date==='2026-11-11');
  const unassigned = today.filter(v=>v.nurseId==null).length;
  // 重複なし・休みの人(小川=水曜休)に入っていない
  for (const n of ns) { const m=today.filter(v=>v.nurseId===n.id).sort((a,b)=>a.startTime.localeCompare(b.startTime)); for(let i=1;i<m.length;i++){ const t=x=>+x.slice(0,2)*60+ +x.slice(3); assert(t(m[i-1].startTime)+m[i-1].duration<=t(m[i].startTime),'重複: '+n.name); } }
  assert.equal(today.filter(v=>v.nurseId===1004).length,0,'休みの人に割り当て');
  const pref = today.find(v=>v.preferredNurseNames?.length); if (pref) assert.equal(pref.nurseId,1002,'優先担当');
  console.log('2a OK: 自動編成', toast1, '| 当日', todayCount, '件 未割り当て', unassigned, '| 担当別', ns.map(n=>n.name.split(' ')[0]+':'+today.filter(v=>v.nurseId===n.id).length).join(' '));
  await page.screenshot({ path:shot('pc-overview.png') });
  const assignedBefore = vs.filter(v=>v.nurseId!=null).map(v=>[v.id,v.nurseId]);

  // --- 看護師名簿の更新（従来はここで全ての割り当てが外れていた）
  await page.locator('aside button', { hasText:'看護師管理' }).click(); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'更新' }).click();
  await page.waitForSelector('text=看護師名簿を更新しました');
  console.log('   toast:', await page.locator('text=看護師名簿を更新しました').innerText());
  st = await store(); const ns2 = JSON.parse(st.nurses); vs = parse(st.visits);
  assert.equal(ns2.length,7);
  for (const old of _nurses) assert.equal(ns2.find(n=>n.name===old.name).id, old.id, 'IDが変わった: '+old.name);
  assert.equal(ns2.find(n=>n.name==='上田 みどり').startTime,'09:00');
  const idset=new Set(ns2.map(n=>n.id));
  assert(assignedBefore.every(([id,nid])=>idset.has(nid) && vs.find(v=>v.id===id).nurseId===nid),'割り当てが外れた');
  // もう一度更新しても同じ
  await page.locator('button', { hasText:'更新' }).click(); await page.waitForTimeout(600);
  assert.deepEqual(JSON.parse((await store()).nurses).map(n=>n.id), ns2.map(n=>n.id));
  console.log('2b OK: 名簿更新後も割り当て', assignedBefore.length, '件すべて維持');

  // --- 利用者シートの同期
  const dayName=['日','月','火','水','木','金','土'];
  const weekVisits = vs.filter(v=>v.date>=MON && v.date<='2026-11-15');
  const rows = weekVisits.map(v=>({ name:v.userName.replace(' 様',''), day:dayName[new Date(v.date).getDay()], t:v.originalStartTime, d:v.duration, f:v.requiresFemaleNurse?'女性':'', p:(v.preferredNurseNames||[])[0]||'', ex:(v.excludedNurseNames||[]).join('・'), addr:v.address }));
  const target = weekVisits.find(v=>v.date==='2026-11-11' && v.nurseId!=null);
  const gone = weekVisits.find(v=>v.date==='2026-11-11' && v.nurseId!=null && v.id!==target.id);
  rows.find(r=>r.name===target.userName.replace(' 様','') && r.day==='水').t = '16:30';     // 時間変更
  const goneIdx = rows.findIndex(r=>r.name===gone.userName.replace(' 様','') && r.day==='水'); rows.splice(goneIdx,1); // 行を削除
  rows.push({ name:'新規 利用者', day:'木', t:'9:00', d:30, f:'', p:'', ex:'', addr:'東京都架空区99丁目' });
  rows.push({ name:'カンマ 住所', day:'金', t:'10:00', d:45, f:'女性', p:'', ex:'井上,加藤', addr:'"東京都架空区5-5, 201号室"', quoted:true });
  userCsvBody = ['氏名,曜日,開始,所要,限定,優先1,優先2,除外,住所,状態', ...rows.map(r=>[r.name,r.day,r.t,r.d,r.f,r.p,'',r.quoted?'"'+r.ex+'"':r.ex,r.addr,''].join(','))].join('\n');
  // 開始日を「水曜日」にずらした状態で同期（従来は月・火の予定が消えていた）
  await page.locator('aside button', { hasText:'利用者管理' }).click(); await page.waitForTimeout(300);
  await page.locator('input[type=date]').fill('2026-11-11'); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'同期を実行' }).click();
  await page.waitForSelector('text=同期完了');
  const toast3 = await page.locator('text=同期完了').innerText();
  const vs3 = parse((await store()).visits);
  const t3 = vs3.find(v=>v.id===target.id);
  assert.equal(t3.nurseId,target.nurseId,'時間変更で担当が外れた'); assert.equal(t3.startTime,'16:30');
  assert.equal(vs3.find(v=>v.id===gone.id),undefined);
  assert(vs3.find(v=>v.userName==='新規 利用者 様' && v.date==='2026-11-12' && v.startTime==='09:00'));
  const cv = vs3.find(v=>v.userName==='カンマ 住所 様');
  assert.equal(cv.address,'東京都架空区5-5, 201号室'); assert.equal(cv.duration,45); assert.equal(cv.requiresFemaleNurse,true); assert.deepEqual(cv.excludedNurseNames,['井上','加藤']);
  const stillAssigned = weekVisits.filter(v=>v.nurseId!=null && v.id!==gone.id).every(v=>vs3.find(x=>x.id===v.id)?.nurseId===v.nurseId);
  assert(stillAssigned,'同期で割り当てが外れた');
  assert.equal(vs3.filter(v=>v.date<MON).length, vs.filter(v=>v.date<MON).length,'過去データが変わった');
  assert.equal(vs3.filter(v=>v.date>'2026-11-15').length,0,'翌週に予定がずれて入った');
  console.log('2c OK: 利用者同期', toast3);
  // 元に戻す
  await page.locator('aside button', { hasText:'全体スケジュール' }).click(); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'元に戻す' }).first().click(); await page.waitForTimeout(500);
  assert(parse((await store()).visits).find(v=>v.id===gone.id),'元に戻すで復元できない');
  console.log('2d OK: 同期を「元に戻す」で復元');

  // --- 空のCSV（通信エラー相当）では何も消さない
  userCsvBody = '<html>error</html>';
  const n0 = parse((await store()).visits).length;
  await page.locator('aside button', { hasText:'利用者管理' }).click(); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'同期を実行' }).click();
  await page.waitForSelector('text=予定は変更していません');
  assert.equal(parse((await store()).visits).length, n0);
  console.log('2e OK: CSVでない応答では変更しない');
  userCsvBody = '氏名,曜日\n';   // 見出しだけ（中身が空）
  await page.locator('button', { hasText:'同期を実行' }).click();
  await page.waitForSelector('text=同期を中止しました');
  assert.equal(parse((await store()).visits).length, n0);
  console.log('2f OK: 空の取得結果では変更しない');

  await page.locator('aside button', { hasText:'集計レポート' }).click(); await page.waitForTimeout(500);
  await page.screenshot({ path:shot('pc-report.png') });
  errs.push(...errors); await browser.close();
}
// ============ 3. スマホ・管理者 ============
{
  const { seed } = mk();
  const { browser, page, errors } = await launch({ viewport:{width:390,height:780}, seed, admin:true, isMobile:true, scale:2, authCfg:AUTH, login:LOGIN });
  await setDates(page,'2026-11-11');
  await page.screenshot({ path:shot('m-admin-overview.png') });
  errs.push(...errors); await browser.close();
}
// ===== A. ログイン =====
{
  const { seed } = mk();
  // A1: 普通のURL → 閲覧モード。編集ボタンなし
  let r = await launch({ viewport:{width:1440,height:900}, seed, admin:false, authCfg:AUTH });
  assert.equal(await r.page.locator('button', { hasText:'自動編成' }).count(),0);
  assert.equal(await r.page.locator('text=管理者ログイン').count(),0);
  errs.push(...r.errors); await r.browser.close();
  // A2: ?mode=admin だけでは管理者にならない → ログイン画面
  r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH });
  await r.page.waitForSelector('text=管理者ログイン');
  assert.equal(await r.page.locator('text=管理者モード').count(),0,'ログイン前に管理者になっている');
  await r.page.screenshot({ path:shot('login.png') });
  await r.page.fill('input[name=email]','admin@test.local'); await r.page.fill('input[name=password]','wrong'); await r.page.click('button[type=submit]');
  await r.page.waitForSelector('text=メールアドレスかパスワードが違います');
  assert.equal(await r.page.locator('text=管理者モード').count(),0);
  // ログイン画面を閉じて編集を試みても、ルール側で拒否される（偽DBで再現）
  const denied = await r.page.evaluate(async()=>{ const m=await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'); try{ await m.setDoc(m.doc({},'artifacts','care-route-app','public','data','careRoute_state','main'),{visits:'[]'},{merge:true}); return 'written'; }catch(e){ return e.code; } });
  assert.equal(denied,'permission-denied');
  await r.page.fill('input[name=password]','pw123456'); await r.page.click('button[type=submit]');
  await r.page.waitForSelector('text=管理者モード');
  assert(await r.page.locator('button', { hasText:'自動編成' }).count()>0);
  // 再読み込みしてもログイン維持（匿名ログインで上書きされない）
  await r.page.reload(); await r.page.waitForSelector('text=管理者モード');
  assert.equal(await r.page.evaluate(()=>window.__anonSignIns||0),0,'匿名ログインで上書きされた');
  assert.equal(await r.page.locator('text=管理者ログイン').count(),0);
  // ログアウト → 閲覧モード
  await r.page.locator('aside button', { hasText:'ログアウト' }).click(); await r.page.waitForTimeout(500);
  assert.equal(await r.page.locator('text=管理者モード').count(),0);
  assert.equal(await r.page.locator('button', { hasText:'自動編成' }).count(),0);
  errs.push(...r.errors.filter(e=>!e.includes('Login error'))); await r.browser.close();
  // A3: ログイン機能が未設定 → 案内＋従来方式への逃げ道（締め出し防止）
  r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:{passwordEnabled:false} });
  await r.page.fill('input[name=email]','a@b.c'); await r.page.fill('input[name=password]','x'); await r.page.click('button[type=submit]');
  await r.page.waitForSelector('text=ログイン機能がまだ有効になっていません');
  await r.page.locator('button', { hasText:'従来の方式で管理者として開く' }).click();
  await r.page.waitForSelector('text=ログイン機能が未設定のため');
  assert(await r.page.locator('button', { hasText:'自動編成' }).count()>0);
  await r.browser.close();
  // A4: データが空のとき、閲覧者は初期データを書き込まない
  r = await launch({ viewport:{width:1440,height:900}, seed:null, admin:false, authCfg:AUTH });
  assert.deepEqual(await r.page.evaluate(()=>window.__mockStore.writes),[]);
  await r.browser.close();
  console.log('A OK: ログイン（未ログインは編集不可・誤パスワード・維持・ログアウト・未設定時の案内）');
}

// ===== B/C. 保管庫・バックアップ・復元 =====
{
  const { seed, _nurses } = mk();
  const vs = JSON.parse(seed.visits);
  // 古いデータ（1〜5月）を足す
  let id=90000;
  for (const m of ['01','02','03','04','05']) for (let d=5; d<=25; d+=5) for (let k=0;k<6;k++)
    vs.push({ id:id++, userName:`古田 ${k} 様`, location:{x:50,y:50}, duration:30, date:`2026-${m}-${String(d).padStart(2,'0')}`, startTime:`${String(9+k).padStart(2,'0')}:00`, originalStartTime:`${String(9+k).padStart(2,'0')}:00`, nurseId:_nurses[k%4].id, address:'東京都架空区旧町'+k });
  seed.visits = JSON.stringify(vs);
  seed.savedPatterns = JSON.stringify({ '2026-02-10': { 1: [vs[0]] }, '2026-11-11': { 1: [vs[1]] } });
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await side(page,'集計レポート'); await page.waitForTimeout(500);
  await page.screenshot({ path:shot('report-archive.png') });
  // --- バックアップ（保管前）
  let [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText:'バックアップを保存' }).click()]);
  const bk1 = shot('backup1.json'); await dl.saveAs(bk1);
  const b1 = JSON.parse(fs.readFileSync(bk1,'utf8'));
  assert.equal(b1.visits.length, vs.length); assert.equal(b1.version,2);
  // --- 保管
  await page.locator('button', { hasText:'古いデータを保管庫へ移す' }).click();
  await page.waitForSelector('text=保管庫へ移しました');
  let docs = await r.docs();
  const live = parse(docs[MAIN].visits);
  assert.equal(live.length, vs.filter(v=>v.date>='2026-06').length);
  assert.deepEqual(JSON.parse(docs[MAIN].archivedMonths),['2026-01','2026-02','2026-03','2026-04','2026-05']);
  assert.equal(parse(docs[ARCH('2026-03')].visits).length,30);
  assert(parse(docs[ARCH('2026-02')].savedPatterns)['2026-02-10']); assert(!parse(docs[MAIN].savedPatterns)['2026-02-10']); assert(parse(docs[MAIN].savedPatterns)['2026-11-11']);
  console.log('B1 OK: 保管', await page.locator('text=保管庫へ移しました').innerText());
  // --- 保管済みの月：レポートで件数が見える
  await page.locator('input[type=month]').fill('2026-03'); await page.waitForTimeout(600);
  assert.equal((await page.locator('p:has-text("月間総訪問件数") + p').innerText()).replace(/\s/g,''),'30件');
  // --- 保管済みの日を開く：表示される・閲覧のみ
  await side(page,'全体スケジュール'); await page.waitForTimeout(300);
  await page.locator('input[type=date]').fill('2026-03-09'); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'3/10(火)' }).click(); await page.waitForTimeout(700);
  await page.waitForSelector('text=保管済みのため、閲覧のみです');
  assert.equal(await page.locator('.visit-card').count(),6,'保管済みの予定が表示されない');
  assert.equal(await page.locator('button', { hasText:'自動編成' }).count(),0,'保管済みの月で編集できてしまう');
  await page.screenshot({ path:shot('archived-view.png') });
  // 保管済みの月を見ている間にメインへ書き戻されていないこと
  assert.equal(parse((await r.docs())[MAIN].visits).length, live.length);
  // --- 現在の週に戻って編集 → 保管分がメインに混ざらない
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(500);
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了');
  docs = await r.docs();
  assert(parse(docs[MAIN].visits).every(v=>v.date>='2026-06'),'保管分がメインに混入');
  assert.equal(parse(docs[MAIN].visits).length, live.length);
  console.log('B2 OK: 保管済みの月は閲覧のみ・メインに混入しない');
  // --- バックアップ（保管後）：保管庫も含まれる
  await side(page,'集計レポート'); await page.waitForTimeout(500);
  [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText:'バックアップを保存' }).click()]);
  const bk2=shot('backup2.json'); await dl.saveAs(bk2);
  const b2 = JSON.parse(fs.readFileSync(bk2,'utf8'));
  assert.equal(Object.keys(b2.archives).length,5); assert.equal(b2.visits.length+Object.values(b2.archives).reduce((n,a)=>n+a.visits.length,0), vs.length);
  // --- 月を編集可能に戻す
  await side(page,'全体スケジュール'); await page.waitForTimeout(300);
  await page.locator('input[type=date]').fill('2026-05-04'); await page.waitForTimeout(600);
  await page.locator('button', { hasText:'編集できるように戻す' }).click();
  await page.waitForSelector('text=編集できる状態に戻しました');
  docs = await r.docs();
  assert.deepEqual(JSON.parse(docs[MAIN].archivedMonths),['2026-01','2026-02','2026-03','2026-04']);
  assert.equal(parse(docs[MAIN].visits).filter(v=>v.date.startsWith('2026-05')).length,30);
  assert.equal(await page.locator('text=保管済みのため').count(),0);
  console.log('B3 OK: 保管済みの月を編集可能に戻す');
  // --- 復元：保管前のバックアップ(backup1)に戻す
  await side(page,'集計レポート'); await page.waitForTimeout(400);
  await page.locator('input[type=file]').setInputFiles(bk1);
  await page.waitForSelector('text=すべて置き換えます');
  await page.screenshot({ path:shot('restore-confirm.png') });
  [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText:'復元する' }).click()]);   // 復元前の自動バックアップ
  await page.waitForSelector('text=バックアップから復元しました');
  docs = await r.docs();
  assert.equal(parse(docs[MAIN].visits).length, vs.length); assert.deepEqual(JSON.parse(docs[MAIN].archivedMonths),[]);
  assert.deepEqual(parse(docs[MAIN].visits).map(v=>v.id).sort(), vs.map(v=>v.id).sort());
  assert.equal(JSON.parse(docs[MAIN].nurses).length,6);
  // --- 復元：保管後のバックアップ(backup2)に戻す → 保管庫も復元
  await page.locator('input[type=file]').setInputFiles(bk2);
  await page.waitForSelector('text=保管庫 150件');
  [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText:'復元する' }).click()]);
  await page.waitForSelector('text=バックアップから復元しました'); await page.waitForTimeout(300);
  docs = await r.docs();
  assert.equal(JSON.parse(docs[MAIN].archivedMonths).length,5); assert.equal(parse(docs[MAIN].visits).length,b2.visits.length);
  // --- 壊れたファイルは拒否
  fs.writeFileSync(shot('bad.json'),'{"hello":1}');
  await page.locator('input[type=file]').setInputFiles(shot('bad.json'));
  await page.waitForSelector('text=バックアップとして読み込めませんでした');
  assert.equal(parse((await r.docs())[MAIN].visits).length,b2.visits.length);
  console.log('C OK: バックアップ→復元（保管庫含む・復元前の自動保存・不正ファイル拒否）');
  errs.push(...r.errors); await r.browser.close();
}

// ===== D. 位置情報 =====
{
  const { seed } = mk();
  let calls=[];
  const gsi = (route, url) => { const q=decodeURIComponent(url.split('q=')[1]); calls.push(q); const n=parseInt(q.match(/(\d+)丁目/)?.[1]||'0'); 
    const body = n===7 ? '[]' : JSON.stringify([{geometry:{coordinates:[139.70+n*0.01,35.70],type:'Point'},type:'Feature',properties:{title:q}}]);
    return route.fulfill({ status:200, contentType:'application/json', body, headers:{'access-control-allow-origin':'*'} }); };
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN, routes:{ 'msearch.gsi.go.jp': gsi } });
  const { page } = r;
  page.on('dialog', d => d.accept());
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了');
  const before = await page.locator('.visit-card').count();
  await side(page,'利用者管理'); await page.waitForTimeout(400);
  const missingText = await page.locator('p:has-text("位置が分かっている住所")').innerText();
  await page.locator('button', { hasText:'住所から位置を取得する' }).click();
  await page.waitForSelector('text=位置情報を取得しました', { timeout: 30000 });
  const toast = await page.locator('text=位置情報を取得しました').innerText();
  const cache = JSON.parse((await r.docs())[MAIN].geoCache);
  assert(Object.keys(cache).length>0); assert(calls.every(q=>!q.includes('太郎')),'氏名が送信された');
  assert.equal(cache['東京都架空区7丁目'],undefined);
  assert.deepEqual(cache['東京都架空区3丁目'],[35.7,139.73]);
  await page.screenshot({ path:shot('geo.png') });
  await side(page,'全体スケジュール'); await page.waitForTimeout(500);
  assert.equal(await page.locator('.visit-card').count(), before);
  await page.screenshot({ path:shot('geo-overview.png') });
  console.log('D OK: 位置取得', missingText.replace(/\s+/g,' '), '→', toast);
  errs.push(...r.errors.filter(e=>!e.includes('Login error'))); await r.browser.close();
}

// ===== E. スマホ：タップで担当者・時間を変更 =====
{
  const { seed } = mk();
  const r = await launch({ viewport:{width:390,height:780}, seed, admin:true, isMobile:true, scale:2, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(500);
  // 未割り当ての「宇野」(09:00・30分) をタップ → メニュー → 変更画面
  const card = page.locator('.visit-card', { hasText:'宇野' }).first();
  await card.scrollIntoViewIfNeeded(); await card.tap({position:{x:7,y:10}}); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'担当者・時間を変更' }).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: shot('m-move.png') });
  // 水曜休みの「小川」は選べない
  assert(await page.locator('form button', { hasText:'小川 大地' }).isDisabled(),'休みの人を選べてしまう');
  await page.locator('form input[type=time]').fill('09:30');
  await page.locator('form button', { hasText:'遠藤 あかり' }).tap();
  await page.locator('form button[type=submit]').tap();
  await page.waitForSelector('text=に変更しました');
  let vs = parse((await r.store()).visits);
  const moved = vs.find(v=>v.userName.startsWith('宇野') && v.date==='2026-11-11');
  assert.equal(moved.nurseId,1003); assert.equal(moved.startTime,'09:30'); assert.equal(moved.originalStartTime,'09:00');
  // 同じ人・同じ時間にもう1件入れる → 入るが、重複の注意が出る
  const card2 = page.locator('.visit-card', { hasText:'須藤' }).first();
  await card2.scrollIntoViewIfNeeded(); await card2.tap({position:{x:7,y:10}}); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'担当者・時間を変更' }).click(); await page.waitForTimeout(300);
  await page.locator('form input[type=time]').fill('09:30'); await page.waitForTimeout(200);
  assert((await page.locator('form button', { hasText:'遠藤 あかり' }).innerText()).includes('重複'),'重複の表示が出ない');
  await page.screenshot({ path: shot('m-move-overlap.png') });
  await page.locator('form button', { hasText:'遠藤 あかり' }).tap();
  await page.locator('form button[type=submit]').tap();
  await page.waitForSelector('text=時間が重なっています');
  // 未割り当てに戻す
  await page.waitForTimeout(300);
  const card3 = page.locator('.visit-card', { hasText:'宇野' }).first();
  await card3.scrollIntoViewIfNeeded(); await card3.tap({position:{x:7,y:10}}); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'担当者・時間を変更' }).click(); await page.waitForTimeout(300);
  await page.locator('form button', { hasText:'未割り当てに戻す' }).tap();
  await page.locator('form button[type=submit]').tap(); await page.waitForTimeout(500);
  vs = parse((await r.store()).visits);
  assert.equal(vs.find(v=>v.id===moved.id).nurseId,null);
  // 元に戻す
  await page.locator('button', { hasText:'元に戻す' }).first().tap(); await page.waitForTimeout(500);
  assert.equal(parse((await r.store()).visits).find(v=>v.id===moved.id).nurseId,1003);
  console.log('E OK: スマホで担当者・時間を変更（休みは選択不可・重複の注意・元に戻す）');
  errs.push(...r.errors); await r.browser.close();
}

const real = errs.filter(e=>!e.includes('cdn.tailwindcss.com should not be used')&&!e.includes('in-browser Babel')&&!e.includes('形式が違います')&&!e.includes('CSVではなくWebページ'));
if (real.length) { console.error('画面でエラーが発生:', real); process.exit(1); }
console.log('ALL PASS');
