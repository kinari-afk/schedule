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
// 全体スケジュールの「その他」メニューを開く（項目名を渡すと、その項目まで押す）
const more = async (page, item) => {
  if (await page.locator('[data-testid=more-menu]').count() === 0) { await page.locator('button[aria-expanded]', { hasText:'その他' }).click(); await page.waitForTimeout(150); }
  if (item) { await page.locator('[data-testid=more-menu] button', { hasText:item }).click(); await page.waitForTimeout(250); }
};
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
  const stats1 = JSON.parse(docs[MAIN].assignStats);
  assert.deepEqual(stats1['古田0'].base, { [_nurses[0].id]: 25 }, '保管した分が通算に足されていない');   // 5か月×5日
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
  assert.deepEqual(JSON.parse(docs[MAIN].assignStats)['古田0'].base, { [_nurses[0].id]: 20 }, '戻した分が通算から引かれていない');
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
  assert.deepEqual(JSON.parse(docs[MAIN].assignStats)['古田0'].base, { [_nurses[0].id]: 25 }, '復元後の通算が保管庫の中身と合わない');
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

// ===== F. 同行訪問の連動 =====
{
  const { seed } = mk();
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(400);
  const menu = async (name, item) => { await page.locator('.visit-card:visible', { hasText:name }).first().click({ button:'right', position:{x:7,y:10} }); await page.waitForTimeout(200); await page.locator('div.fixed button', { hasText:item }).first().click(); await page.waitForTimeout(300); };
  await menu('宇野','同行複製');
  let vs = parse((await r.store()).visits);
  const parent = vs.find(v=>v.userName.startsWith('宇野') && v.date==='2026-11-11' && !v.isAccompany);
  const acc = vs.find(v=>v.isAccompany);
  assert.equal(acc.accompanyOf,parent.id);
  // 自動編成：同行と主担当は別の人になる
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了');
  vs = parse((await r.store()).visits);
  const pa = vs.find(v=>v.id===parent.id), aa = vs.find(v=>v.id===acc.id);
  assert(pa.nurseId && aa.nurseId && pa.nurseId!==aa.nurseId,'同行と主担当が同じ人');
  // 元の予定の時間を編集 → 同行も動く
  await page.locator('.visit-card:visible', { hasText:'宇野' }).first().click({ button:'right' }); await page.waitForTimeout(200);
  const isAccMenu = await page.locator('div.fixed', { hasText:'主担当:' }).count();
  await page.mouse.click(5,5); await page.waitForTimeout(200);
  const cards = page.locator('.visit-card:visible', { hasText:'宇野' });
  await cards.nth(isAccMenu ? 1 : 0).click({ button:'right' }); await page.waitForTimeout(200);
  assert(await page.locator('div.fixed', { hasText:'同行:' }).count()>0,'メニューに同行者が表示されない');
  await page.locator('div.fixed button', { hasText:'編集' }).first().click(); await page.waitForTimeout(300);
  await page.locator('form input[name=startTime]').fill('13:30'); await page.locator('form input[name=duration]').fill('45');
  await page.locator('form button[type=submit]').click(); await page.waitForTimeout(500);
  vs = parse((await r.store()).visits);
  assert.equal(vs.find(v=>v.id===parent.id).startTime,'13:30');
  assert.equal(vs.find(v=>v.id===acc.id).startTime,'13:30','同行が連動しない'); assert.equal(vs.find(v=>v.id===acc.id).duration,45);
  assert.equal(vs.find(v=>v.id===acc.id).nurseId,aa.nurseId);
  // 元の予定を削除 → 同行も消える → 元に戻すで両方復活
  await side(page,'利用者管理'); await page.waitForTimeout(300);
  const rowEl = page.locator('tbody tr', { hasText:'宇野' }).filter({ hasNotText:'同行' }).first();
  await rowEl.locator('button[title=削除]').click(); await page.locator('button', { hasText:'削除する' }).click(); await page.waitForTimeout(500);
  vs = parse((await r.store()).visits);
  assert(!vs.find(v=>v.id===parent.id) && !vs.find(v=>v.id===acc.id),'元を消しても同行が残る');
  await side(page,'全体スケジュール'); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'元に戻す' }).first().click(); await page.waitForTimeout(500);
  vs = parse((await r.store()).visits);
  assert(vs.find(v=>v.id===parent.id) && vs.find(v=>v.id===acc.id));
  console.log('F OK: 同行訪問（別担当に割り当て・時間と所要時間の連動・削除の連動・元に戻す）');

  // ===== G. 印刷 =====
  await page.emulateMedia({ media:'print' });
  const pr = page.locator('.print-only');
  assert(await pr.isVisible()); assert.equal(await page.locator('aside').isVisible(), false);
  const text = await pr.innerText();
  assert(text.includes('訪問担当表') && text.includes('2026/11/11') && text.includes('青木 さくら') && text.includes('カンファレンス') && text.includes('お休み: 小川 大地'));
  assert(text.includes('（同行）'));
  await page.pdf({ path: shot('print-all.pdf'), preferCSSPageSize: true });
  await page.screenshot({ path: shot('print-all.png'), fullPage:true });
  await page.emulateMedia({ media:'screen' });
  await side(page,'個別ルート確認'); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'井上 健' }).first().click(); await page.waitForTimeout(200);
  await page.emulateMedia({ media:'print' });
  const text2 = await pr.innerText();
  assert(text2.includes('井上 健') && !text2.includes('青木 さくら') && text2.includes('東京都架空区'));
  await page.screenshot({ path: shot('print-one.png'), fullPage:true });
  assert(fs.statSync(shot('print-all.pdf')).size>5000);
  console.log('G OK: 印刷（全員分・個別ルート・PDF出力）');
  errs.push(...r.errors); await r.browser.close();
}

// ===== H. 週まとめて編成・設定・理由の表示 =====
{
  const { seed } = mk();
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(400);
  // --- 設定：半休の時刻と昼休憩を変更して保存
  await more(page,'編成の設定');
  await page.screenshot({ path: shot('settings.png') });
  await page.locator('input[name=amOffStart]').fill('13:00');
  await page.locator('input[name=lunchMinutes]').fill('45');
  await page.locator('input[name=baseTravelTime]').fill('6');
  await page.locator('input[name=travelSpeedKmh]').fill('30');
  await page.locator('form button[type=submit]', { hasText:'保存する' }).click();
  await page.waitForSelector('text=編成の設定を保存しました');
  let st = JSON.parse((await r.store()).settings);
  assert.equal(st.amOffStart,'13:00'); assert.equal(st.lunch.minutes,45);
  assert.equal((await r.store()).baseTravelTime,6); assert.equal((await r.store()).travelSpeedKmh,30);
  await more(page); assert((await page.locator('[data-testid=more-menu]').innerText()).includes('移動6分・時速30km')); await page.mouse.click(5,5); await page.waitForTimeout(150); assert.equal(st.lunch.enabled,true); assert.equal(st.pmOffEnd,'12:30');
  // --- 未割り当ての理由（編成前）：メニューに「入れられる担当者」が出る
  await page.locator('.visit-card:visible', { hasText:'宇野' }).first().click({ button:'right', position:{x:7,y:10} }); await page.waitForTimeout(300);
  assert(await page.locator('div.fixed', { hasText:'入れられる担当者' }).count()>0,'未割り当ての理由が出ない');
  await page.screenshot({ path: shot('reason-unassigned.png') });
  await page.mouse.click(5,5); await page.waitForTimeout(200);
  // --- 週まとめて編成：今日(水)以降の3日分。月・火（過去）は触らない
  const before = parse((await r.store()).visits);
  await more(page);
  const label = await page.locator('[data-testid=more-menu] button', { hasText:'週まとめて編成' }).innerText();
  assert(label.includes('3日'),'対象日数: '+label);
  await page.locator('[data-testid=more-menu] button', { hasText:'週まとめて編成' }).click();
  await page.waitForSelector('text=日分の自動編成完了');
  const toast = await page.locator('text=日分の自動編成完了').innerText();
  const after = parse((await r.store()).visits);
  const un = (vs,d)=>vs.filter(v=>v.date===d && v.nurseId==null).length;
  for (const d of ['2026-11-11','2026-11-12','2026-11-13']) assert.equal(un(after,d),0,d+' に未割り当てが残った');
  for (const d of ['2026-11-09','2026-11-10']) assert.equal(un(after,d),un(before,d),d+'（過去の日）が変更された');
  const ns = JSON.parse((await r.store()).nurses);
  for (const d of ['2026-11-11','2026-11-12','2026-11-13']) for (const n of ns) { const m=after.filter(v=>v.date===d&&v.nurseId===n.id).sort((a,b)=>a.startTime.localeCompare(b.startTime)); for(let i=1;i<m.length;i++){ const tt=x=>+x.slice(0,2)*60+ +x.slice(3); assert(tt(m[i-1].startTime)+m[i-1].duration<=tt(m[i].startTime),'重複 '+d+' '+n.name); } }
  // 同じ利用者は、週の中でなるべく同じ担当者に（前の日の結果を実績として使う）
  console.log('H1 OK: 週まとめて編成', toast);
  // --- 割り当ての理由（編成後）：メニューに「自動編成の理由」が出る
  await page.locator('.visit-card:visible').first().click({ button:'right' }); await page.waitForTimeout(300);
  assert(await page.locator('div.fixed', { hasText:'自動編成の理由' }).count()>0,'割り当ての理由が出ない');
  await page.screenshot({ path: shot('reason-assigned.png') });
  await page.mouse.click(5,5); await page.waitForTimeout(200);
  // --- 元に戻す：週まとめて編成を1回で取り消せる
  await page.locator('button', { hasText:'元に戻す' }).first().click(); await page.waitForTimeout(500);
  assert.equal(un(parse((await r.store()).visits),'2026-11-12'),un(before,'2026-11-12'));
  console.log('H2 OK: 設定の保存・理由の表示・週まとめて編成の取り消し');
  // --- 負担の一覧
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了');
  await page.locator('[data-testid=overview-viewbar] button', { hasText:'負担の一覧' }).click(); await page.waitForTimeout(400);
  const wl = await page.locator('div:has(> div > p:has-text("負担の一覧"))').first().innerText();
  assert(wl.includes('青木 さくら') && wl.includes('訪問') && wl.includes('移動') && wl.includes('今週') && wl.includes('お休み') && /平均 \d+%/.test(wl), '負担の一覧の内容: '+wl.slice(0,200));
  await page.screenshot({ path: shot('workload.png') });
  await page.reload(); await page.waitForSelector('#root > div'); await page.waitForTimeout(600);   // 開いた状態を覚えている（再読み込みで偽DBは初期化される）
  assert(await page.locator('p:has-text("負担の一覧")').count()>0,'開いた状態が記憶されていない');
  await page.locator('[data-testid=overview-viewbar] button', { hasText:'負担の一覧' }).click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('p:has-text("負担の一覧")').count(),0);
  console.log('H3 OK: 負担の一覧（表示・記憶・閉じる）');
  errs.push(...r.errors); await r.browser.close();
}
// ===== I. スマホ：未割り当ての一覧から割り当て =====
{
  const { seed } = mk();
  const r = await launch({ viewport:{width:390,height:780}, seed, admin:true, isMobile:true, scale:2, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(500);
  await page.locator('button[title="未割り当ての一覧を開く"]').tap(); await page.waitForTimeout(300);
  await page.waitForSelector('div.fixed h3:has-text("未割り当て 12件")');
  await page.screenshot({ path: shot('m-unassigned-list.png') });
  await page.locator('div.fixed button', { hasText:'須藤' }).first().tap(); await page.waitForTimeout(300);
  await page.locator('form button', { hasText:'井上 健' }).tap();
  await page.locator('form button[type=submit]').tap(); await page.waitForTimeout(500);
  const vs = parse((await r.store()).visits);
  assert.equal(vs.find(v=>v.userName.startsWith('須藤') && v.date==='2026-11-11').nurseId,1001);
  await page.waitForSelector('div.fixed h3:has-text("未割り当て 11件")');     // 一覧は開いたまま、続けて次を割り当てられる
  // --- 一覧の行にある「キャンセル」から、その場でキャンセルにできる
  await page.locator('div.fixed button[aria-label="宇野 太郎 様 をキャンセルにする"]').tap(); await page.waitForTimeout(300);
  await page.locator('form input[name=note]').fill('入院');
  await page.locator('form button[type=submit]', { hasText:'キャンセルにする' }).tap();
  await page.waitForSelector('div.fixed h3:has-text("未割り当て 10件")');     // 一覧は開いたまま、件数が減る
  const vs2 = parse((await r.store()).visits);
  const cu = vs2.find(v=>v.userName.startsWith('宇野') && v.date==='2026-11-11');
  assert.equal(cu.isCancelled,true); assert.equal(cu.cancelNote,'入院');
  assert(await page.locator('div.fixed', { hasText:'キャンセル 1件' }).count()>0);
  await page.screenshot({ path: shot('m-unassigned-cancel.png') });
  console.log('I OK: スマホで未割り当ての一覧から続けて割り当て・その場でキャンセル');
  errs.push(...r.errors); await r.browser.close();
}

// ===== J. キャンセルと臨時の訪問 =====
{
  const { seed } = mk();
  let userCsvBody='';
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN, csv:{ 'users.csv': ()=>userCsvBody } });
  const { page } = r;
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(400);
  const menu = async (name, item) => { await page.locator('.visit-card:visible', { hasText:name }).first().click({ button:'right', position:{x:7,y:10} }); await page.waitForTimeout(200); await page.locator('div.fixed button', { hasText:item }).first().click(); await page.waitForTimeout(300); };
  const badge = () => page.locator('button[title="未割り当ての一覧を開く"]').innerText();
  assert((await badge()).includes('12件'));
  // --- キャンセルにする（理由つき）
  await menu('宇野','キャンセルにする');
  await page.locator('form input[name=note]').fill('入院のため');
  await page.locator('form button[type=submit]', { hasText:'キャンセルにする' }).click();
  await page.waitForSelector('text=の予定をキャンセルにしました');
  let vs = parse((await r.store()).visits);
  const c = vs.find(v=>v.userName.startsWith('宇野') && v.date==='2026-11-11');
  assert.equal(c.isCancelled,true); assert.equal(c.cancelNote,'入院のため'); assert.equal(c.nurseId,null);
  assert((await badge()).includes('11件'),'未割り当ての件数にキャンセルが含まれている');
  assert(await page.locator('button[title="キャンセルの一覧を開く"]').innerText().then(x=>x.includes('1件')));
  assert.equal(await page.locator('.visit-card[data-cancelled=true]').count(),1);
  // --- 自動編成：キャンセルの予定は割り振られない
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了');
  const toast = await page.locator('text=自動編成完了').innerText();
  vs = parse((await r.store()).visits);
  assert.equal(vs.find(v=>v.id===c.id).nurseId,null,'キャンセルの予定が自動編成された');
  assert.equal(vs.filter(v=>v.date==='2026-11-11' && v.nurseId==null).length,1);
  assert(toast.includes('11件を割り当て'),toast);
  await page.screenshot({ path: shot('cancelled.png') });
  // --- 週まとめて編成の対象日からも外れる（今日は対象外になる）
  await more(page);
  assert(!(await page.locator('[data-testid=more-menu] button', { hasText:'週まとめて編成' }).innerText()).includes('3日'));
  await page.mouse.click(5,5); await page.waitForTimeout(150);
  // --- 同期してもキャンセルは保たれる
  const dayName=['日','月','火','水','木','金','土'];
  userCsvBody = ['氏名,曜日,開始,所要,限定,優先1,優先2,除外,住所,状態', ...vs.filter(v=>v.date>=MON && v.date<='2026-11-15').map(v=>[v.userName.replace(' 様',''),dayName[new Date(v.date).getDay()],v.originalStartTime,v.duration,v.requiresFemaleNurse?'女性':'',(v.preferredNurseNames||[])[0]||'','',(v.excludedNurseNames||[]).join('・'),v.address,''].join(','))].join('\n');
  // --- 臨時の訪問を追加（登録済みの利用者 → 住所を引き継ぐ）
  await side(page,'全体スケジュール'); await page.waitForTimeout(200);
  await page.locator('button', { hasText:'予定を追加' }).click(); await page.waitForTimeout(300);
  await page.locator('form button', { hasText:'臨時の訪問' }).click();
  await page.locator('form input[name=title]').fill('根本 太郎 様');
  await page.locator('form input[name=startTime]').fill('16:00');
  await page.locator('form input[name=comment]').fill('発熱のため');
  await page.screenshot({ path: shot('add-visit.png') });
  await page.locator('form button[type=submit]', { hasText:'追加する' }).click();
  await page.waitForSelector('text=臨時の訪問を追加しました');
  vs = parse((await r.store()).visits);
  const extra = vs.find(v=>v.isManual);
  assert.equal(extra.type,undefined); assert.equal(extra.address,'東京都架空区24丁目'); assert.equal(extra.comment,'発熱のため'); assert.equal(extra.nurseId,null); assert.equal(extra.startTime,'16:00');
  assert((await badge()).includes('1件'));
  // 臨時の訪問は自動編成で割り振られる
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了: 1件');
  // --- 同期：キャンセルは保たれ、臨時の訪問（シートに無い）は消えない
  await side(page,'利用者管理'); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'同期を実行' }).click(); await page.waitForSelector('text=同期完了');
  const sync = await page.locator('text=同期完了').innerText();
  vs = parse((await r.store()).visits);
  assert(sync.includes('削除 0件'),sync);
  assert.equal(vs.find(v=>v.id===c.id).isCancelled,true); assert(vs.find(v=>v.id===extra.id)?.nurseId!=null,'臨時の訪問が同期で消えた、または担当が外れた');
  // --- 集計：キャンセルは訪問件数に含めず別に数える。臨時の訪問は数える
  await side(page,'集計レポート'); await page.waitForTimeout(500);
  assert.equal((await page.locator('p:has-text("キャンセル件数") + p').innerText()).replace(/\s/g,''),'1件');
  const total = parseInt((await page.locator('p:has-text("月間総訪問件数") + p').innerText()));
  assert.equal(total, vs.filter(v=>v.date.startsWith('2026-11') && v.type!=='other' && !v.isCancelled).length);
  // --- キャンセルを取り消す（一覧から）
  await side(page,'全体スケジュール'); await page.waitForTimeout(300);
  await page.locator('button[title="キャンセルの一覧を開く"]').click(); await page.waitForTimeout(300);
  await page.locator('div.fixed button', { hasText:'取り消す' }).click();
  await page.waitForSelector('text=のキャンセルを取り消しました');
  vs = parse((await r.store()).visits);
  assert.equal(vs.find(v=>v.id===c.id).isCancelled,undefined);
  console.log('J OK: キャンセル（件数・自動編成の対象外・同期で保持・集計・取り消し）と臨時の訪問（引き継ぎ・同期で保持）');
  errs.push(...r.errors); await r.browser.close();
}

// ===== K. 担当実績（通算） =====
{
  const { seed, _nurses } = mk();
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await side(page,'集計レポート'); await page.waitForTimeout(500);
  const card = page.locator('div:has(> div > div > p:has-text("担当実績（通算）"))').first();
  // 相川さんは過去3週、青木さん(1000)が担当（月・水・金 ×3週 = 9回）
  const rowOf = (name) => card.locator('tbody tr', { hasText:name });
  assert.equal((await rowOf('相川').locator('td').nth(1).innerText()).trim(),'9');
  assert.equal((await rowOf('相川').locator('td').last().innerText()).trim(),'9');
  await page.screenshot({ path: shot('stats.png') });
  // --- 回数を修正：相川さんの井上さん(1001)の欄を 0 → 30 に
  await card.locator('button', { hasText:'回数を修正' }).click(); await page.waitForTimeout(200);
  const input = rowOf('相川').locator('input').nth(1);
  await input.fill('30'); await input.blur(); await page.waitForTimeout(400);
  const st = JSON.parse((await r.store()).assignStats);
  assert.deepEqual(st['相川太郎'].adj, { [_nurses[1].id]: 30 });
  await card.locator('button', { hasText:'修正を終える' }).click(); await page.waitForTimeout(200);
  assert.equal((await rowOf('相川').locator('td').nth(2).innerText()).trim(),'30');
  assert.equal((await rowOf('相川').locator('td').last().innerText()).trim(),'39');
  assert((await rowOf('相川').innerText()).includes('修正'));
  // --- 書き出し：Googleスプレッドシートで開けるCSV
  const [dl] = await Promise.all([page.waitForEvent('download'), card.locator('button', { hasText:'実績を書き出す' }).click()]);
  const f = shot('stats.csv'); await dl.saveAs(f);
  const csv = fs.readFileSync(f,'utf8');
  assert(csv.startsWith('﻿"利用者","青木 さくら"')); assert(csv.includes('"相川 太郎 様","9","30"')); assert(csv.split('\r\n')[0].endsWith('"合計"'));
  // --- 自動編成に効く：相川さん（女性限定）は井上さん(男性)には行かないが、修正した実績は別の利用者で確認
  //     石田さんの実績を「遠藤さん(1003)に50回」と直し、最優先にすると、遠藤さんへ
  await card.locator('button', { hasText:'回数を修正' }).click(); await page.waitForTimeout(200);
  const target = (await card.locator('tbody tr').allInnerTexts()).findIndex(x=>x.startsWith('石田'));
  const inp2 = card.locator('tbody tr').nth(target).locator('input').nth(3);
  await inp2.fill('50'); await inp2.blur(); await page.waitForTimeout(400);
  await side(page,'全体スケジュール'); await page.waitForTimeout(300);
  await more(page,'編成の設定');
  await page.locator('input[name=historyWeight][value=strong]').check();
  await page.locator('form button[type=submit]', { hasText:'保存する' }).click(); await page.waitForSelector('text=編成の設定を保存しました');
  assert.equal(JSON.parse((await r.store()).settings).historyWeight,'strong');
  // 石田さんの予定がある日（火曜）で編成
  await page.locator('button:visible', { hasText:'11/10(火)' }).click(); await page.waitForTimeout(400);
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了');
  const vs = parse((await r.store()).visits);
  const ishida = vs.find(v=>v.userName.startsWith('石田') && v.date==='2026-11-10');
  assert.equal(ishida.nurseId,_nurses[3].id,'修正した実績が自動編成に使われていない');
  console.log('K OK: 担当実績（表示・修正・書き出し・自動編成への反映・最優先の設定）');
  errs.push(...r.errors); await r.browser.close();
}

// ===== L. 未割り当ての見落とし防止と、転記用テキスト =====
{
  const { seed, _nurses } = mk();
  // 水曜は青木さん以外を休みにして、自動編成で入りきらない予定が必ず残るようにする
  seed.nurses = JSON.stringify(_nurses.map((n,i)=> i===0 ? n : { ...n, offDays:[{day:3,type:'full'}] }));
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(400);
  const banner = page.locator('[data-testid=pending-banner]');
  const dayBtn = (label) => page.locator('button:visible', { hasText: label }).first();
  // --- 未割り当てがある日：バナーと、日付ボタンの赤い数字
  assert((await banner.innerText()).includes('12件'));
  assert((await dayBtn('11/11(水)').innerText()).includes('12'));
  assert((await dayBtn('11/12(木)').innerText()).replace('11/12(木)','').trim()==='12');
  // --- 固定した未割り当て・キャンセルは数えない
  const menu = async (name, item) => { await page.locator('.visit-card:visible', { hasText:name }).first().click({ button:'right', position:{x:7,y:10} }); await page.waitForTimeout(200); await page.locator('div.fixed button', { hasText:item }).first().click(); await page.waitForTimeout(300); };
  await menu('宇野','予定を固定');
  assert((await banner.innerText()).includes('11件'),'固定した予定が数えられている');
  await menu('園田','キャンセルにする');
  await page.locator('form button[type=submit]', { hasText:'キャンセルにする' }).click(); await page.waitForTimeout(400);
  assert((await banner.innerText()).includes('10件'),'キャンセルの予定が数えられている');
  // --- 自動編成で入らない予定が残ると、一覧が自動で開く
  //     （このテストでは、水曜の出勤者が1名だけになるようデータを用意してある）
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了');
  await page.waitForSelector('div.fixed h3:has-text("未割り当て")');
  const left = parse((await r.store()).visits).filter(v=>v.date==='2026-11-11' && v.nurseId==null && !v.isCancelled && !v.isExcludedFromAutoAssign).length;
  assert(left>0,'テストの前提：入らない予定が残るはず');
  assert((await page.locator('div.fixed h3:has-text("未割り当て")').innerText()).includes(`${left+1}件`));    // 固定した1件を含む
  await page.screenshot({ path: shot('pending.png') });
  await page.locator('div.fixed button[aria-label="閉じる"]').click(); await page.waitForTimeout(200);
  assert((await banner.innerText()).includes(`${left}件`));
  assert((await dayBtn('11/11(水)').innerText()).includes(String(left)));
  // 全部片づくとバナーも数字も消える
  await page.locator('button', { hasText:'元に戻す' }).first().click(); await page.waitForTimeout(300);
  console.log('L1 OK: 未割り当ての見落とし防止（バナー・日付の数字・固定とキャンセルは除外・編成後に一覧を開く）');
  errs.push(...r.errors); await r.browser.close();
}
{
  const { seed, _nurses } = mk();
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(400);
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('text=自動編成完了');
  assert.equal(await page.locator('[data-testid=pending-banner]').count(),0,'全部割り当てたのにバナーが残っている');
  // --- 転記用テキスト
  await page.locator('[data-testid=overview-viewbar] button', { hasText:'転記用テキスト' }).click(); await page.waitForTimeout(300);
  const val = (part) => page.locator(`textarea[data-part=${part}]`).inputValue();
  const vs = parse((await r.store()).visits).filter(v=>v.date==='2026-11-11').sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const am = await val('am'), pm = await val('pm');
  assert.equal(await val('memo'),'本日14時からカンファレンスがあります。');
  assert.equal(am.split('\n').length + pm.split('\n').length, vs.length);
  const first = vs[0]; const n0 = _nurses.find(n=>n.id===first.nurseId);
  assert(am.split('\n').some(l=>l===`9:00 ${first.userName.replace(/[\s様]/g,'')}（${n0.name.split(' ')[0]}）`),'行の形式: '+am.split('\n')[0]);
  assert(/^13:30 /.test(pm.split('\n')[0]));
  await page.screenshot({ path: shot('transfer.png') });
  // 略称を変えると作り直される
  await page.locator('summary', { hasText:'担当者の略称を変える' }).click();
  const inp = page.locator(`input[aria-label="${n0.name} の略称"]`); await inp.fill('ＡＡ'); await inp.blur(); await page.waitForTimeout(300);
  assert((await val('am')).includes('（ＡＡ）'));
  assert.equal(JSON.parse((await r.store()).settings).shortNames[n0.id],'ＡＡ');
  // コピー：午前だけ（1セル形式）
  await page.locator('button', { hasText:'午前をコピー' }).click(); await page.waitForTimeout(200);
  let clip = await page.evaluate(()=>navigator.clipboard.readText());
  assert.equal(clip, '"'+(await val('am'))+'"');
  // コピー：まとめて（午前・午後を縦に2セル。メモは含めない）
  await page.locator('button', { hasText:'まとめてコピー' }).click(); await page.waitForTimeout(200);
  clip = await page.evaluate(()=>navigator.clipboard.readText());
  assert.equal(clip, [await val('am'), await val('pm')].map(x=>'"'+x+'"').join('\n'));
  assert(!clip.includes('カンファレンスがあります'),'まとめてコピーにメモが含まれている');
  // 書き直した内容がそのままコピーされる／ふつうの文章の形式
  await page.locator('textarea[data-part=memo]').fill('山田さん休み');
  await page.locator('input[type=checkbox]:visible').last().uncheck();
  await page.locator('button', { hasText:'メモをコピー' }).click(); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'山田さん休み');
  console.log('L2 OK: 転記用テキスト（形式・略称・1セル形式／縦2セル／文章でコピー・書き直し）');
  errs.push(...r.errors); await r.browser.close();
}

// ===== M. 全体スケジュールのボタン配置と、別の案（第2案） =====
{
  for (const [vw, mobile] of [[{width:1440,height:900},false],[{width:390,height:780},true],[{width:1024,height:768},false]]) {
    const { seed } = mk();
    const r = await launch({ viewport:vw, seed, admin:true, isMobile:mobile, scale: mobile?2:1, authCfg:AUTH, login:LOGIN });
    const { page } = r;
    await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(400);
    // よく使う4つ（＋元に戻す・その他）が、横にスクロールしなくても画面内に見えている
    const bar = page.locator('[data-testid=overview-toolbar]');
    // 日付の右：負担の一覧・印刷・転記用テキスト ／ 右側：元に戻す・予定を追加・メモリ・リセット・自動編成・その他
    const firstWord = (x) => x.trim().split(/\s/)[0];
    const view = (await page.locator('[data-testid=overview-viewbar] > button').allInnerTexts()).map(x=>x.trim());
    assert.deepEqual(view, ['負担の一覧','印刷 / PDF','転記用テキスト'], `${vw.width}px: 日付の右の並びが違う ${view}`);
    const tools = (await bar.locator(':scope > *').allInnerTexts()).map(firstWord);
    assert.deepEqual(tools, ['元に戻す','予定を追加','メモリ','リセット','自動編成','その他'], `${vw.width}px: 右側の並びが違う ${tools}`);
    for (const el of [...await page.locator('[data-testid=overview-viewbar] > button').all(), ...await bar.locator(':scope > *').all()]) {
      const box = await el.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= vw.width + 1, `${vw.width}px: ボタンが画面からはみ出している`);
    }
    if (vw.width === 1440) {   // パソコンでは、転記用テキストのすぐ右が元に戻す（同じ行で左から右へ）
      const t1 = await page.locator('[data-testid=overview-viewbar] button', { hasText:'転記用テキスト' }).boundingBox();
      const u1 = await bar.locator('button', { hasText:'元に戻す' }).boundingBox();
      if (Math.abs(u1.y - t1.y) < 10) assert(u1.x > t1.x, '転記用テキストより左に元に戻すがある'); else assert(u1.y > t1.y, '元に戻すが転記用テキストより上の行にある');
    }
    // その他の中身
    await more(page);
    const menuText = await page.locator('[data-testid=more-menu]').innerText();
    assert(['週まとめて編成','実績反映','編成の設定','一括固定','一括解除'].every(x=>menuText.includes(x)), menuText);
    assert(!['メモリ','負担の一覧','印刷','転記用テキスト','リセット'].some(x=>menuText.includes(x)), menuText);
    await page.mouse.click(5,5); await page.waitForTimeout(150);
    // メモリは上に並ぶ
    await page.locator('[data-testid=memory-slots] button', { hasText:'1' }).click(); await page.waitForTimeout(200);
    assert(await page.locator('h3', { hasText:'メモリ 1' }).count() > 0, 'メモリが開けない');
    await page.locator('div.fixed button', { hasText:'現在の状態を保存' }).click(); await page.waitForTimeout(300);
    assert(await page.locator('text=メモリ1 に現在の割り当てを保存しました').count() > 0);
    const ov = await bar.evaluate(el => el.scrollWidth - el.clientWidth);
    assert(ov <= 1, `${vw.width}px: ボタンの列が横にスクロールする`);
    assert.equal(await page.locator('input[type=number]:visible').count(), 0, '移動時間・時速の入力欄が上部に残っている');
    await page.screenshot({ path: shot(`toolbar-${vw.width}.png`) });
    await more(page);
    await page.screenshot({ path: shot(`toolbar-${vw.width}-more.png`) });
    errs.push(...r.errors); await r.browser.close();
  }
  console.log('M1 OK: 上部の並び（日付の右に負担の一覧・印刷・転記用テキスト、右側に元に戻す・予定を追加・メモリ・リセット・自動編成・その他）が画面内に収まる（1440／1024／390px）');
}
{
  const { seed, _nurses } = mk();
  const r = await launch({ viewport:{width:1440,height:900}, seed, admin:true, authCfg:AUTH, login:LOGIN });
  const { page } = r;
  await page.locator('button:visible', { hasText:'今日' }).first().click(); await page.waitForTimeout(400);
  const autoBtn = page.locator('[data-testid=overview-toolbar] button', { hasText:'自動編成' });
  // 第1案
  await autoBtn.click(); await page.waitForSelector('text=自動編成完了');
  const day = async () => parse((await r.store()).visits).filter(v=>v.date==='2026-11-11').sort((a,b)=>a.id-b.id);
  const plan1 = (await day()).map(v=>v.nurseId);
  assert(plan1.every(x=>x!=null));
  assert((await autoBtn.getAttribute('class')).includes('opacity-50'),'編成後もボタンが通常表示のまま');
  // 手で1件変える（この予定は別の案でも動かない）
  await side(page,'利用者管理'); await page.waitForTimeout(300);
  const firstRow = page.locator('tbody tr').first();
  const curNurse = parseInt(await firstRow.locator('select').inputValue(), 10);
  const otherNurse = _nurses.find(n=>n.id!==curNurse && n.isFemale && !n.offDays.length).id;
  await firstRow.locator('select').selectOption(String(otherNurse)); await page.waitForTimeout(300);
  const manual = (await day()).filter(v=>v.autoAssigned===false);
  assert.equal(manual.length,1,'手で変えた予定から自動編成の印が外れていない');
  const manualId = manual[0].id;
  await side(page,'全体スケジュール'); await page.waitForTimeout(300);
  // もう一度押す → 確認 → キャンセルなら何も変わらない
  await autoBtn.click(); await page.waitForSelector('[data-testid=alt-plan-confirm]');
  const msg = await page.locator('[data-testid=alt-plan-confirm]').innerText();
  assert(msg.includes('第2案を作りますか') && msg.includes('11件を組み直します'), msg);
  await page.screenshot({ path: shot('alt-plan-confirm.png') });
  await page.locator('[data-testid=alt-plan-confirm] button', { hasText:'キャンセル' }).click(); await page.waitForTimeout(200);
  const beforeAlt = (await day()).map(v=>v.nurseId);
  // OK → 第2案
  await autoBtn.click(); await page.waitForSelector('[data-testid=alt-plan-confirm]');
  await page.locator('[data-testid=alt-plan-confirm] button', { hasText:'OK' }).click();
  await page.waitForSelector('text=第2案を作りました');
  const toast = await page.locator('text=第2案を作りました').innerText();
  const plan2 = (await day());
  assert.equal(plan2.find(v=>v.id===manualId).nurseId, otherNurse, '手で変えた割り当てが組み直された');
  const changed = plan2.filter((v,i)=>v.nurseId!==beforeAlt[i]).length;
  assert(changed>0, '第2案で何も変わらなかった'); assert(toast.includes(`${changed}件の担当者が変わりました`), toast);
  assert(plan2.every(v=>v.nurseId!=null),'第2案で未割り当てが出た');
  for (const n of _nurses) { const m=plan2.filter(v=>v.nurseId===n.id).sort((a,b)=>a.startTime.localeCompare(b.startTime)); for(let i=1;i<m.length;i++){ const tt=x=>+x.slice(0,2)*60+ +x.slice(3); assert(tt(m[i-1].startTime)+m[i-1].duration<=tt(m[i].startTime),'第2案で時間が重なった '+n.name); } }
  // 元に戻す → 第1案に戻る。もう一度押すと第3案（第1案とも第2案とも違う組み合わせを目指す）
  await page.locator('button', { hasText:'元に戻す' }).first().click(); await page.waitForTimeout(400);
  assert.deepEqual((await day()).map(v=>v.nurseId), beforeAlt);
  await autoBtn.click(); await page.waitForSelector('[data-testid=alt-plan-confirm]');
  assert((await page.locator('[data-testid=alt-plan-confirm]').innerText()).includes('第3案'));
  await page.locator('[data-testid=alt-plan-confirm] button', { hasText:'OK' }).click(); await page.waitForSelector('text=第3案を作りました');
  // 個別ルートの自動編成ボタンも同じ動き
  await side(page,'個別ルート確認'); await page.waitForTimeout(300);
  await page.locator('button', { hasText:'自動編成' }).first().click(); await page.waitForSelector('[data-testid=alt-plan-confirm]');
  assert((await page.locator('[data-testid=alt-plan-confirm]').innerText()).includes('第4案'));
  console.log('M2 OK: 編成後にもう一度押すと確認 → 第2案（手で変えた分は残す・元に戻す・第3案・個別ルートからも）', toast);
  errs.push(...r.errors); await r.browser.close();
}

const real = errs.filter(e=>!e.includes('cdn.tailwindcss.com should not be used')&&!e.includes('in-browser Babel')&&!e.includes('形式が違います')&&!e.includes('CSVではなくWebページ'));
if (real.length) { console.error('画面でエラーが発生:', real); process.exit(1); }
console.log('ALL PASS');
