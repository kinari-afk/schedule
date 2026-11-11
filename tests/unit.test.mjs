// 計算ロジックの単体テスト。実行: npm test（追加のインストールは不要）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
// index.html の中の「計算だけを行う関数」を取り出して、その場で実行できる形にする
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'index.html'), 'utf8');
const body = src.split('/*__PURE_HELPERS_START__*/')[1].split('/*__PURE_HELPERS_END__*/')[0];
const H = new Function(body + '; return { planAutoAssign, buildAssignHistory, mergeSheetVisits, mergeNurseSheet, normalizeDateStr, isVisitUnassigned, makePointOf, travelMinutes, areaKeyOf, haversineKm, normalizeAddress, parseCsv, looksLikeHtml, assignProblem, findOverlap, parseTime, formatTime, syncAccompanyVisits, findAccompanyParent };')();

const D='2026-11-11'; // 水
const nurse=(id,name,o={})=>({id,name,startTime:'08:30',endTime:'17:30',startLocation:{x:50,y:50},isFemale:true,...o});
let vid=100;
const visit=(userName,startTime,duration=30,o={})=>({id:vid++,userName,date:D,startTime,originalStartTime:startTime,duration,nurseId:null,location:{x:50,y:50},preferredNurseNames:[],excludedNurseNames:[],...o});
const run=(visits,nurses,o={})=>{ const pointOf=H.makePointOf(o.geo||{}); return H.planAutoAssign({visits,nurses,date:D,offTypeOf:o.off||(()=>'work'),pointOf,travelBetween:(a,b)=>H.travelMinutes(a,b,7,20),history:o.history||null}); };
const overlaps=(vs,nurses)=>{ for(const n of nurses){ const m=vs.filter(v=>v.nurseId===n.id).sort((a,b)=>a.startTime.localeCompare(b.startTime)); for(let i=1;i<m.length;i++){ const pe=H.constructor, a=m[i-1], b=m[i]; const pa=(t)=>+t.slice(0,2)*60+ +t.slice(3); if(pa(a.startTime)+a.duration>pa(b.startTime)) return true; } } return false; };

// 1. 後ろに固定予定(16:00会議)があっても、その前の空き時間に入れられる
{
  const nurses=[nurse(1,'A')];
  const vs=[visit('会議','16:00',60,{nurseId:1,type:'other',isExcludedFromAutoAssign:true}), visit('田中 様','10:00'), visit('鈴木 様','11:00')];
  const r=run(vs,nurses);
  assert.equal(r.assignedCount,2); assert.equal(r.failed.length,0);
  console.log('1 OK: 空き時間への差し込み');
}
// 2. ダブルブッキングしない（同時刻3件・看護師2名 → 1件は未割り当てのまま）
{
  const nurses=[nurse(1,'A'),nurse(2,'B')];
  const vs=[visit('a 様','10:00'),visit('b 様','10:00'),visit('c 様','10:00')];
  const r=run(vs,nurses);
  assert.equal(r.assignedCount,2); assert.equal(r.failed.length,1); assert(!overlaps(r.visits,nurses));
  console.log('2 OK: 重複させず未割り当てに残す');
}
// 3. 優先担当者：時間が重なる場合は第2希望へ
{
  const nurses=[nurse(1,'山田'),nurse(2,'佐藤'),nurse(3,'高橋')];
  const vs=[visit('x 様','10:00',60,{nurseId:1}), visit('y 様','10:30',30,{preferredNurseNames:['山田','佐藤']})];
  const r=run(vs,nurses);
  assert.equal(r.visits.find(v=>v.userName==='y 様').nurseId,2);
  console.log('3 OK: 優先担当が埋まっていれば第2希望');
}
// 4. 優先担当ありの予定が、先に来た一般の予定に席を取られない
{
  const nurses=[nurse(1,'山田'),nurse(2,'佐藤')];
  const vs=[visit('一般 様','09:00',60), visit('指名 様','09:30',30,{preferredNurseNames:['山田']})];
  const r=run(vs,nurses);
  assert.equal(r.visits.find(v=>v.userName==='指名 様').nurseId,1);
  assert.equal(r.visits.find(v=>v.userName==='一般 様').nurseId,2);
  console.log('4 OK: 優先担当ありを先に確保');
}
// 5. 女性限定・除外スタッフ
{
  const nurses=[nurse(1,'男性A',{isFemale:false}),nurse(2,'女性B'),nurse(3,'女性C')];
  const vs=[visit('p 様','10:00',30,{requiresFemaleNurse:true,excludedNurseNames:['女性B']})];
  const r=run(vs,nurses);
  assert.equal(r.visits[0].nurseId,3);
  console.log('5 OK: 女性限定・除外');
}
// 6. 過去実績：いつもBさんが訪問している利用者はBさんへ（負担が同じなら）
{
  const nurses=[nurse(1,'A'),nurse(2,'B')];
  const past=['2026-11-04','2026-10-28','2026-10-21'].map(d=>visit('常連 様','10:00',30,{date:d,nurseId:2}));
  const vs=[...past, visit('常連 様','10:00')];
  const hist=H.buildAssignHistory(vs,new Set([1,2]),D);
  const r=run(vs,nurses,{history:hist});
  assert.equal(r.visits.at(-1).nurseId,2); assert.equal(r.historyHits,1);
  const r0=run(vs,nurses);  // 実績なしならAさん（先頭）
  assert.equal(r0.visits.at(-1).nurseId,1);
  console.log('6 OK: 過去実績を反映');
}
// 7. 半休：午前休の人に午前の訪問を入れない / 低優先は最後
{
  const nurses=[nurse(1,'午前休'),nurse(2,'低',{isLowPriority:true}),nurse(3,'通常')];
  const vs=[visit('q 様','10:00'),visit('r 様','10:00'),visit('s 様','10:00')];
  const r=run(vs,nurses,{off:n=>n.id===1?'AM':'work'});
  assert.equal(r.visits[0].nurseId,3); assert.equal(r.visits[1].nurseId,2); assert.equal(r.visits[2].nurseId,null);
  console.log('7 OK: 半休・低優先');
}
// 8. 負担の平準化：6件を2人に3件ずつ
{
  const nurses=[nurse(1,'A'),nurse(2,'B')];
  const vs=['09:00','10:00','11:00','13:00','14:00','15:00'].map((t,i)=>visit('u'+i+' 様',t,30));
  const r=run(vs,nurses);
  const c1=r.visits.filter(v=>v.nurseId===1).length;
  assert.equal(c1,3); console.log('8 OK: 平準化 3/3');
}
// 9. 名簿から消えた担当者の予定は未割り当て扱い → 自動編成の対象になる
{
  const nurses=[nurse(1,'A')];
  const vs=[visit('孤児 様','10:00',30,{nurseId:999})];
  const r=run(vs,nurses); assert.equal(r.visits[0].nurseId,1); console.log('9 OK: 孤児予定の救済');
}
// 10. 元の配列・オブジェクトを書き換えない
{
  const nurses=[nurse(1,'A')]; const vs=[visit('z 様','10:00')]; const snap=JSON.stringify(vs);
  run(vs,nurses); assert.equal(JSON.stringify(vs),snap); console.log('10 OK: 非破壊');
}

// ---- 看護師名簿のマージ ----
{
  const cur=[{id:11,name:'山田 花子',color:'#0ea5e9'},{id:12,name:'佐藤',color:'#10b981'},{id:13,name:'退職者',color:'#f59e0b'}];
  const sheet=[{id:9001,name:'佐藤',color:'#0ea5e9',startTime:'09:00'},{id:9002,name:'山田花子',color:'#10b981'},{id:9003,name:'新人',color:'#f59e0b'}];
  let seq=0; const m=H.mergeNurseSheet({nurses:cur,sheetNurses:sheet,makeId:()=>5000+(++seq)});
  assert.deepEqual(m.nurses.map(n=>n.id),[12,11,5001]);
  assert.equal(m.nurses[0].startTime,'09:00'); assert.equal(m.nurses[0].color,'#10b981');
  assert.equal(m.kept,2); assert.equal(m.added,1); assert.equal(m.removed,1);
  assert.equal(new Set(m.nurses.map(n=>n.color)).size,3);
  console.log('N OK: 名簿更新でIDを引き継ぐ', m.nurses.map(n=>n.name+':'+n.id+':'+n.color).join(' '));
}
// ---- 利用者シートのマージ ----
{
  const week=['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15'];
  const row=(userName,date,t,o={})=>({id:Math.random(),userName,date,startTime:t,originalStartTime:t,duration:30,nurseId:null,isExcludedFromAutoAssign:false,isAccompany:false,...o});
  const cur=[
    {id:1,userName:'田中 様',date:'2026-11-11',startTime:'10:15',originalStartTime:'10:00',duration:30,nurseId:7,isExcludedFromAutoAssign:true,comment:'鍵は玄関'},   // ドラッグで時間調整済み
    {id:2,userName:'鈴木 様',date:'2026-11-11',startTime:'13:00',originalStartTime:'13:00',duration:30,nurseId:8},   // シートで14:00に変更
    {id:3,userName:'中止 様',date:'2026-11-11',startTime:'15:00',originalStartTime:'15:00',duration:30,nurseId:8},   // シートから消えた
    {id:4,userName:'先週 様',date:'2026-11-04',startTime:'09:00',originalStartTime:'09:00',duration:30,nurseId:7},   // 表示週の外
    {id:5,userName:'会議',type:'other',date:'2026-11-11',startTime:'16:00',duration:60,nurseId:7},
    {id:6,userName:'旧形式 様',date:'2026-11-12',startTime:'09:00',duration:30,nurseId:7},                          // originalStartTime なし
  ];
  const sheet=[row('田中 様','2026-11-11','10:00',{duration:45}),row('鈴木 様','2026-11-11','14:00'),row('新規 様','2026-11-13','09:00'),row('旧形式 様','2026-11-12','09:00')];
  const m=H.mergeSheetVisits({visits:cur,sheetRows:sheet,weekDates:week});
  const by=id=>m.visits.find(v=>v.id===id);
  assert.equal(by(1).nurseId,7); assert.equal(by(1).startTime,'10:15'); assert.equal(by(1).duration,45); assert.equal(by(1).comment,'鍵は玄関'); assert.equal(by(1).isExcludedFromAutoAssign,true);
  assert.equal(by(2).nurseId,8); assert.equal(by(2).startTime,'14:00'); assert.equal(by(2).originalStartTime,'14:00');
  assert.equal(by(3),undefined); assert(by(4)); assert(by(5)); assert.equal(by(6).nurseId,7);
  assert.deepEqual([m.added,m.updated,m.retimed,m.deleted,m.deletedAssigned],[1,2,1,1,1]);
  assert.equal(m.visits.length,6);
  // 2回続けて同期しても結果が変わらない（冪等）
  const m2=H.mergeSheetVisits({visits:m.visits,sheetRows:sheet,weekDates:week});
  assert.deepEqual([m2.added,m2.retimed,m2.deleted],[0,0,0]); assert.equal(m2.visits.length,6);
  console.log('S OK: 利用者同期で担当・固定・コメントを引き継ぐ');
}
assert.equal(H.normalizeDateStr('2026/4/5'),'2026-04-05');
// ---- 移動時間 ----
{
  assert.equal(H.areaKeyOf('東京都 架空区緑町１－２－３'),'東京都架空区緑町');
  assert.equal(H.areaKeyOf('架空市本町二丁目5'),'架空市本町');
  assert.equal(H.areaKeyOf(''),null);
  const tokyo={lat:35.6812,lng:139.7671}, shinjuku={lat:35.6896,lng:139.7006};
  const km=H.haversineKm(tokyo,shinjuku); assert(km>5.9&&km<6.3,'km='+km);
  assert.equal(H.travelMinutes(tokyo,shinjuku,7,20), 7+Math.round(km*1.3/20*60));
  assert.equal(H.travelMinutes({area:'A'},{area:'A'},7,20),7);
  assert.equal(H.travelMinutes({area:'A'},{area:'B'},7,20),11);
  assert.equal(H.travelMinutes({area:null},{area:'B'},7,20),9);
  const pointOf=H.makePointOf({'東京都架空区緑町1-2':[35.7,139.7]});
  assert.equal(pointOf({address:'東京都架空区 緑町１－２'}).lat,35.7);                       // 住所から取得した位置
  assert.equal(pointOf({address:'x',location:{x:1,y:2,lat:35.1,lng:139.1}}).lat,35.1);    // シートの緯度経度が優先
  assert.equal(pointOf({address:'東京都架空区緑町9'}).lat,undefined);
  assert.equal(pointOf({location:{x:1,y:2,lat:0,lng:0}}).lat,undefined);                   // 日本の範囲外は無視
  console.log('T OK: 移動時間（距離・町名・不明）');
}
// 近い看護師が選ばれる：Aは直前に遠方、Bは直前に近所
{
  const nurses=[nurse(1,'A'),nurse(2,'B')];
  const near={x:0,y:0,lat:35.70,lng:139.70}, far={x:0,y:0,lat:35.80,lng:139.90};
  const vs=[visit('遠方 様','09:00',30,{nurseId:1,location:far}), visit('近所 様','09:00',30,{nurseId:2,location:{...near,lat:35.701}}), visit('対象 様','10:00',30,{location:near})];
  const r=run(vs,nurses); assert.equal(r.visits.at(-1).nurseId,2);
  console.log('T2 OK: 実距離の近い担当者を選ぶ');
}
// ---- CSVの読み取り ----
{
  const rows = H.parseCsv('﻿氏名,曜日,住所\r\n山田 太郎,月,"東京都架空区1-2, 3号室"\n"鈴木 ""はな"" 子",火,"1行目\n2行目"\n,,\n最後,水,x');
  assert.deepEqual(rows[0],['氏名','曜日','住所']);                                  // 先頭の見えない文字(BOM)を除去
  assert.deepEqual(rows[1],['山田 太郎','月','東京都架空区1-2, 3号室']);             // 住所の中のカンマで列がずれない
  assert.deepEqual(rows[2],['鈴木 "はな" 子','火','1行目\n2行目']);                  // "" は " 1文字、セル内の改行も保持
  assert.deepEqual(rows[3],['','','']);
  assert.deepEqual(rows[4],['最後','水','x']);                                       // 末尾に改行がなくても最後の行を読む
  assert.equal(rows.length,5);
  assert.deepEqual(H.parseCsv(''),[]);
  assert.deepEqual(H.parseCsv('a,b\n'),[['a','b']]);
  assert(H.looksLikeHtml('  <!DOCTYPE html><html>')); assert(!H.looksLikeHtml('氏名,曜日'));
  console.log('CSV OK: カンマ・引用符・改行を含むセル');
}
// ---- 割り当て可否の判定 ----
{
  const v=visit('判定 様','10:00',30,{requiresFemaleNurse:true,excludedNurseNames:['佐藤']});
  assert.match(H.assignProblem(v,nurse(1,'男性',{isFemale:false}),'work',600),/女性/);
  assert.match(H.assignProblem(v,nurse(2,'佐藤 花子'),'work',600),/除外/);
  assert.match(H.assignProblem(v,nurse(3,'山田'),'full',600),/お休み/);
  assert.match(H.assignProblem(v,nurse(3,'山田'),'AM',600),/午前休/);
  assert.equal(H.assignProblem(v,nurse(3,'山田'),'AM',14*60),null);
  assert.match(H.assignProblem(v,nurse(3,'山田'),'PM',13*60),/午後休/);
  assert.equal(H.assignProblem(v,nurse(3,'山田'),'work',600),null);
  const others=[visit('先約 様','10:15',30,{nurseId:3}), visit('別日 様','10:15',30,{nurseId:3,date:'2026-11-12'}), visit('直後 様','10:30',30,{nurseId:4})];
  assert.equal(H.findOverlap(others,v,3,D,600).userName,'先約 様');
  assert.equal(H.findOverlap(others,v,4,D,600),null);          // 10:00〜10:30 と 10:30〜 は重ならない
  assert.equal(H.findOverlap(others,v,3,D,9*60),null);
  console.log('P OK: 割り当て可否・重複の判定');
}
// ---- 同行訪問の連動 ----
{
  const p=visit('親 様','10:00',30,{nurseId:1});
  const a={...visit('親 様','10:00',30,{nurseId:2}), isAccompany:true, accompanyOf:p.id};
  const other=visit('他 様','11:00',30);
  const prev=[p,a,other];
  // 元の予定を10:00→13:30・45分に変更 → 同行も同じに
  let next=H.syncAccompanyVisits(prev, prev.map(v=>v.id===p.id?{...v,startTime:'13:30',duration:45}:v));
  let a2=next.find(v=>v.id===a.id); assert.equal(a2.startTime,'13:30'); assert.equal(a2.duration,45); assert.equal(a2.nurseId,2);
  // 同行だけを動かした場合はそのまま（意図的なずらしを尊重）
  next=H.syncAccompanyVisits(prev, prev.map(v=>v.id===a.id?{...v,startTime:'10:15'}:v));
  assert.equal(next.find(v=>v.id===a.id).startTime,'10:15'); assert.equal(next.find(v=>v.id===p.id).startTime,'10:00');
  // ずらした同行（+15分）は、元が動いたら「同じ幅だけ」動く
  const prevOff=prev.map(v=>v.id===a.id?{...v,startTime:'10:15'}:v);
  next=H.syncAccompanyVisits(prevOff, prevOff.map(v=>v.id===p.id?{...v,startTime:'11:00'}:v));
  assert.equal(next.find(v=>v.id===a.id).startTime,'11:15');
  // 元の予定を削除 → 同行も消える。関係ない予定は残る
  next=H.syncAccompanyVisits(prev, prev.filter(v=>v.id!==p.id));
  assert.deepEqual(next.map(v=>v.id),[other.id]);
  // 担当者だけの変更では同行は変わらない（同じ配列がそのまま返る）
  const same=prev.map(v=>v.id===p.id?{...v,nurseId:3}:v);
  assert.equal(H.syncAccompanyVisits(prev,same),same);
  // 紐づけ情報のない古い同行予定：同じ利用者・日・時刻で見つけて連動し、紐づけを記録する
  const legacy={...a, accompanyOf:undefined};
  const prevL=[p,legacy];
  next=H.syncAccompanyVisits(prevL, prevL.map(v=>v.id===p.id?{...v,startTime:'09:00'}:v));
  assert.equal(next.find(v=>v.id===legacy.id).startTime,'09:00'); assert.equal(next.find(v=>v.id===legacy.id).accompanyOf,p.id);
  // 「元に戻す」のように両方が同時に変わる場合は、渡された内容をそのまま使う
  const snap=[{...p,startTime:'08:00'},{...a,startTime:'08:30'}];
  next=H.syncAccompanyVisits(prev,snap); assert.equal(next.find(v=>v.id===a.id).startTime,'08:30');
  // 日付の変更も連動
  next=H.syncAccompanyVisits(prev, prev.map(v=>v.id===p.id?{...v,date:'2026-11-12'}:v));
  assert.equal(next.find(v=>v.id===a.id).date,'2026-11-12');
  console.log('AC OK: 同行訪問の連動（時刻・所要時間・日付・削除・手動ずらし・旧データ）');
}
console.log('ALL PASS');
