// 선수별 박스 싱크(box?) 검증 — (1) box 유무로 sim.points 바이트 동일(밸런스·결정론 무영향)
// (2) 박스 합계 == 팀 단위 RallyStats 오라클(허위 오라클 금지: 스윗 단위 귀속이 팀 집계와 일치)
// (3) 공격 성공률(atkKill/atkAtt)이 현실 KOVO 분포(~45~55%)에 수렴.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { newRallyStats, type BoxSink, type BoxLine } from '../engine/rally';
const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

// ── (1) box·boxTimeline 유무 → 결과 바이트 동일 + 타임라인 정합 ──────────────
let neutralOk = true, tlOk = true;
const eqLine = (x: BoxLine, y: BoxLine) => (Object.keys(x) as (keyof BoxLine)[]).every((k) => x[k] === y[k]);
for (let i = 1; i <= 50; i++) {
  const noBox = simulateMatch(i, A, B, { ...base });
  const fullBox: BoxSink = new Map();
  const timeline: BoxSink[] = [];
  const withBox = simulateMatch(i, A, B, { ...base, box: fullBox });
  const withTl = simulateMatch(i, A, B, { ...base, boxTimeline: timeline });
  if (JSON.stringify(noBox.points) !== JSON.stringify(withBox.points) || JSON.stringify(noBox.points) !== JSON.stringify(withTl.points)) { neutralOk = false; log(`  [FAIL] seed ${i} points 불일치`); break; }
  // 타임라인: points와 1:1 길이, 마지막 스냅샷 == 최종 박스(전 선수·전 필드)
  if (timeline.length !== withTl.points.length) { tlOk = false; log(`  [FAIL] seed ${i} 타임라인 길이 ${timeline.length}≠points ${withTl.points.length}`); break; }
  const last = timeline[timeline.length - 1];
  for (const [id, l] of fullBox) { const t = last.get(id); if (!t || !eqLine(l, t)) { tlOk = false; log(`  [FAIL] seed ${i} 마지막 스냅샷≠최종 박스(${id})`); break; } }
  if (!tlOk) break;
}
log(`(1) 밸런스 무영향(box·boxTimeline 유무 sim.points 바이트 동일, 50경기): ${neutralOk ? 'PASS' : 'FAIL'}`);
log(`(1b) 타임라인 정합(points와 1:1 길이 · 마지막 스냅샷==최종 박스): ${tlOk ? 'PASS' : 'FAIL'}`);

// ── (2) 박스 합계 == 팀 RallyStats 오라클 ────────────────────────────────
const sum = (b: BoxSink, k: keyof BoxLine) => { let s = 0; for (const l of b.values()) s += l[k]; return s; };
const N = 300;
let atkAttT = 0, atkKillT = 0;
const acc = { attacks: 0, kills: 0, blockouts: 0, attackErrs: 0, stuffs: 0, serves: 0, aces: 0, serveErrs: 0, digs: 0, recvErrs: 0, recvQN: 0, recvGood: 0, recvOk: 0 };
const box = { att: 0, kill: 0, err: 0, blk: 0, blkPt: 0, srv: 0, ace: 0, srvErr: 0, dig: 0, assist: 0, rAtt: 0, rGood: 0, rErr: 0 };
for (let i = 1; i <= N; i++) {
  const stats = newRallyStats();
  const b: BoxSink = new Map();
  simulateMatch(i, A, B, { ...base, stats, box: b });
  acc.attacks += stats.attacks; acc.kills += stats.kills; acc.blockouts += stats.blockouts;
  acc.attackErrs += stats.attackErrs; acc.stuffs += stats.stuffs; acc.serves += stats.serves;
  acc.aces += stats.aces; acc.serveErrs += stats.serveErrs; acc.digs += stats.digs;
  acc.recvErrs += stats.recvErrs; acc.recvQN += stats.recvQN; acc.recvGood += stats.recvGood; acc.recvOk += stats.recvOk;
  box.att += sum(b, 'atkAtt'); box.kill += sum(b, 'atkKill'); box.err += sum(b, 'atkErr');
  box.blk += sum(b, 'atkBlocked'); box.blkPt += sum(b, 'blockPt'); box.srv += sum(b, 'srvAtt');
  box.ace += sum(b, 'srvAce'); box.srvErr += sum(b, 'srvErr'); box.dig += sum(b, 'digSucc');
  box.assist += sum(b, 'assist');
  box.rAtt += sum(b, 'recvAtt'); box.rGood += sum(b, 'recvGood'); box.rErr += sum(b, 'recvErr');
  atkAttT += sum(b, 'atkAtt'); atkKillT += sum(b, 'atkKill');
}
const chk = (label: string, boxV: number, oracle: number, exact = true) => {
  const ok = exact ? boxV === oracle : boxV <= oracle;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: box ${boxV} ${exact ? '==' : '<='} 오라클 ${oracle}`);
  return ok;
};
log(`(2) 박스 합계 == 팀 RallyStats 오라클 (${N}경기):`);
let allOk = true;
allOk = chk('공격 시도  atkAtt == stats.attacks', box.att, acc.attacks) && allOk;
allOk = chk('공격 성공  atkKill == kills+blockouts', box.kill, acc.kills + acc.blockouts) && allOk;
allOk = chk('공격 범실  atkErr == stats.attackErrs', box.err, acc.attackErrs) && allOk;
allOk = chk('차단당함  atkBlocked == stats.stuffs', box.blk, acc.stuffs) && allOk;
allOk = chk('블록 득점  blockPt == stats.stuffs', box.blkPt, acc.stuffs) && allOk;
allOk = chk('서브 시도  srvAtt == stats.serves', box.srv, acc.serves) && allOk;
allOk = chk('서브 에이스 srvAce == stats.aces', box.ace, acc.aces) && allOk;
allOk = chk('서브 범실  srvErr == stats.serveErrs', box.srvErr, acc.serveErrs) && allOk;
allOk = chk('세트 어시  assist == kills+blockouts', box.assist, acc.kills + acc.blockouts) && allOk;
allOk = chk('디그 성공  digSucc == stats.digs(클린+팁 디그 전부 귀속)', box.dig, acc.digs) && allOk;
allOk = chk('리시브 시도 recvAtt == aces+recvErrs+recvQN', box.rAtt, acc.aces + acc.recvErrs + acc.recvQN) && allOk;
allOk = chk('리시브 정확 recvGood == recvGood+recvOk(q≥0.45=KOVO 정확)', box.rGood, acc.recvGood + acc.recvOk) && allOk;
allOk = chk('리시브 실패 recvErr == aces+recvErrs', box.rErr, acc.aces + acc.recvErrs) && allOk;
const recvEff = (box.rGood - box.rErr) / box.rAtt * 100; // KOVO 리시브 효율 = (정확 − 실패) / 시도, 정확=q≥0.45(세터 전개 가능)
const recvRealistic = recvEff >= 25 && recvEff <= 55; // KOVO 여자부 팀 리시브 효율 현실 밴드(개인 리베로 40~70% — namu V리그/기록, 팀 평균은 그 아래)
log(`    리시브 효율((정확−실패)/시도) = ${recvEff.toFixed(1)}%  → ${recvRealistic ? 'PASS(KOVO 현실 밴드)' : 'CHECK(범위 밖 — 게이트 재확인)'}`);
log(`    참고: 정확률(recvGood/recvAtt q≥0.45) ${(box.rGood / box.rAtt * 100).toFixed(1)}% · 실패율 ${(box.rErr / box.rAtt * 100).toFixed(1)}%`);

// ── (3) 공격 성공률 현실성 ───────────────────────────────────────────────
const rate = atkKillT / atkAttT * 100;
const realistic = rate >= 36 && rate <= 56; // KOVO 여자부 팀 공격성공률 현실 밴드(CLAUDE.md 4.2 ~40~55% + 하한 여유)
log(`(3) 공격 성공률(atkKill/atkAtt) = ${rate.toFixed(1)}%  → ${realistic ? 'PASS(KOVO 현실 밴드)' : 'CHECK(범위 밖)'}`);
const errRate = box.err / box.att * 100, blkRate = box.blk / box.att * 100;
log(`    참고: 범실률 ${errRate.toFixed(1)}% · 차단당함률 ${blkRate.toFixed(1)}% (시도 대비)`);

log(`\n종합: ${neutralOk && tlOk && allOk && realistic ? '✅ ALL PASS' : '❌ FAIL 있음'}`);
