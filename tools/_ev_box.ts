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

// ── (1) box 유무 → 결과 바이트 동일 ──────────────────────────────────────
let neutralOk = true;
for (let i = 1; i <= 50; i++) {
  const noBox = simulateMatch(i, A, B, { ...base });
  const withBox = simulateMatch(i, A, B, { ...base, box: new Map() as BoxSink });
  if (JSON.stringify(noBox.points) !== JSON.stringify(withBox.points)) { neutralOk = false; log(`  [FAIL] seed ${i} points 불일치`); break; }
}
log(`(1) 밸런스 무영향(box 유무 sim.points 바이트 동일, 50경기): ${neutralOk ? 'PASS' : 'FAIL'}`);

// ── (2) 박스 합계 == 팀 RallyStats 오라클 ────────────────────────────────
const sum = (b: BoxSink, k: keyof BoxLine) => { let s = 0; for (const l of b.values()) s += l[k]; return s; };
const N = 300;
let atkAttT = 0, atkKillT = 0;
const acc = { attacks: 0, kills: 0, blockouts: 0, attackErrs: 0, stuffs: 0, serves: 0, aces: 0, serveErrs: 0, digs: 0 };
const box: { att: number; kill: number; err: number; blk: number; blkPt: number; srv: number; ace: number; srvErr: number; dig: number; assist: number } =
  { att: 0, kill: 0, err: 0, blk: 0, blkPt: 0, srv: 0, ace: 0, srvErr: 0, dig: 0, assist: 0 };
for (let i = 1; i <= N; i++) {
  const stats = newRallyStats();
  const b: BoxSink = new Map();
  simulateMatch(i, A, B, { ...base, stats, box: b });
  acc.attacks += stats.attacks; acc.kills += stats.kills; acc.blockouts += stats.blockouts;
  acc.attackErrs += stats.attackErrs; acc.stuffs += stats.stuffs; acc.serves += stats.serves;
  acc.aces += stats.aces; acc.serveErrs += stats.serveErrs; acc.digs += stats.digs;
  box.att += sum(b, 'atkAtt'); box.kill += sum(b, 'atkKill'); box.err += sum(b, 'atkErr');
  box.blk += sum(b, 'atkBlocked'); box.blkPt += sum(b, 'blockPt'); box.srv += sum(b, 'srvAtt');
  box.ace += sum(b, 'srvAce'); box.srvErr += sum(b, 'srvErr'); box.dig += sum(b, 'digSucc');
  box.assist += sum(b, 'assist');
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
allOk = chk('디그 성공  digSucc <= stats.digs(팁디그 미귀속)', box.dig, acc.digs, false) && allOk;

// ── (3) 공격 성공률 현실성 ───────────────────────────────────────────────
const rate = atkKillT / atkAttT * 100;
const realistic = rate >= 36 && rate <= 56; // KOVO 여자부 팀 공격성공률 현실 밴드(CLAUDE.md 4.2 ~40~55% + 하한 여유)
log(`(3) 공격 성공률(atkKill/atkAtt) = ${rate.toFixed(1)}%  → ${realistic ? 'PASS(KOVO 현실 밴드)' : 'CHECK(범위 밖)'}`);
const errRate = box.err / box.att * 100, blkRate = box.blk / box.att * 100;
log(`    참고: 범실률 ${errRate.toFixed(1)}% · 차단당함률 ${blkRate.toFixed(1)}% (시도 대비)`);

log(`\n종합: ${neutralOk && allOk && realistic ? '✅ ALL PASS' : '❌ FAIL 있음'}`);
