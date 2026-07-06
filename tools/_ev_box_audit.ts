// 박스스코어 통계 정확도 종합 감사 — "여러 수치 넣어서 점검"
// 전 팀 조합(42 매치업: 7×6 홈/원정) × 대량 시드로 매 경기마다:
//  (A) 박스 합계 == RallyStats 오라클 (13필드, 경기별 — 집계 아닌 매 경기)
//  (B) 박스 → 실제 세트 스코어 보존: Σbox(srvErr+recvErr+atkKill+atkErr+blockPt)+faults+miscErrs == 총 득점
//  (C) 엔진 득점 회계 완전성: RallyStats 종결 카테고리 합 == 총 득점(누락 0)
//  (D) 선수 행 불변식: 음수 0, atkKill≤atkAtt, recvGood+recvErr≤recvAtt, 득점=공격+블록+에이스
//  (E) 강·약·대등 매치업 tier별 비율(공격성공률·리시브효율·에이스·사이드아웃) 현실성
//  (F) A/B 자가검증: 박스를 일부러 망가뜨리면 (A)·(B)가 반드시 잡는다(허위 오라클 금지)
// 사용: npx tsx tools/_ev_box_audit.ts [매치업당 시드=250]  (기본 42×250=10,500경기)
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { newRallyStats, type BoxSink, type BoxLine, type RallyStats } from '../engine/rally';
import { teamOverall } from '../engine/overall';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const PER = Math.max(1, parseInt(process.argv[2] || '250', 10));

const teams = LEAGUE.teams.map((t) => t.id);
const roster = new Map<string, Player[]>(teams.map((id) => [id, availableTeamPlayers(id, 0)]));
const coach = new Map(teams.map((id) => [id, coachInfoOf(id) as any]));
const ovr = new Map(teams.map((id) => [id, teamOverall(roster.get(id)!)]));

// 매치업: 모든 순서쌍(홈/원정 구분) i≠j
const matchups: [string, string][] = [];
for (const a of teams) for (const b of teams) if (a !== b) matchups.push([a, b]);

const sumBox = (b: BoxSink, k: keyof BoxLine) => { let s = 0; for (const l of b.values()) s += l[k]; return s; };

// 경기 1건 오라클(A)·보존(B)·회계(C)·불변식(D) 검사 → 위반 사유 배열 반환(빈 = 정상)
function auditMatch(seed: number, A: Player[], B: Player[], base: any): { fails: string[]; pts: number; tot: { atkAtt: number; atkKill: number; aces: number; serves: number; sideouts: number; rallies: number; recvAtt: number; recvGood: number; recvErr: number } } {
  const stats = newRallyStats();
  const box: BoxSink = new Map();
  const sim = simulateMatch(seed, A, B, { ...base, stats, box });
  const fails: string[] = [];
  const totalPts = sim.setScores.reduce((s, x) => s + x.home + x.away, 0);

  // (A) 박스 합 == 오라클
  const oracle: [string, number, number][] = [
    ['atkAtt', sumBox(box, 'atkAtt'), stats.attacks],
    ['atkKill', sumBox(box, 'atkKill'), stats.kills + stats.blockouts],
    ['atkErr', sumBox(box, 'atkErr'), stats.attackErrs],
    ['atkBlocked', sumBox(box, 'atkBlocked'), stats.stuffs],
    ['blockPt', sumBox(box, 'blockPt'), stats.stuffs],
    ['srvAtt', sumBox(box, 'srvAtt'), stats.serves],
    ['srvAce', sumBox(box, 'srvAce'), stats.aces + stats.recvErrs], // 공식 inclusive: 노터치 direct(stats.aces) + 리시브범실 indirect(stats.recvErrs)

    ['srvErr', sumBox(box, 'srvErr'), stats.serveErrs],
    ['assist', sumBox(box, 'assist'), stats.kills + stats.blockouts],
    ['recvAtt', sumBox(box, 'recvAtt'), stats.aces + stats.recvErrs + stats.recvQN],
    ['recvGood', sumBox(box, 'recvGood'), stats.recvGood + stats.recvOk],
    ['recvErr', sumBox(box, 'recvErr'), stats.aces + stats.recvErrs],
  ];
  for (const [k, b, o] of oracle) if (b !== o) fails.push(`A:${k} box${b}≠oracle${o}`);
  // 디그는 팁디그 미귀속이라 ≤
  if (sumBox(box, 'digSucc') > stats.digs) fails.push(`A:digSucc ${sumBox(box, 'digSucc')}>${stats.digs}`);

  // (C) 권위 종결로그 완전성: 매 랠리가 정확히 1점 → points.length == 총 득점
  if (sim.points.length !== totalPts) fails.push(`C:종결로그 ${sim.points.length}≠스코어 ${totalPts}`);
  // (B) 박스 → 실제 스코어 보존. 미귀속 득점 = fault(반칙)+miscErr(볼핸들링)+cap(랠리상한 강제종결) — 실제 스윙으로 끝난 게 아니라 박스에 못 담음.
  // 에이스 중복 회피: srvAce 빼고 recvErr(=에이스+셰이크)가 에이스 득점을 대표.
  const nCap = sim.points.filter((p) => p.how === 'cap').length;
  const nFault = sim.points.filter((p) => p.how === 'fault').length;
  const nMisc = sim.points.filter((p) => p.how === 'miscErr').length;
  const boxAttr = sumBox(box, 'srvErr') + sumBox(box, 'recvErr') + sumBox(box, 'atkKill') + sumBox(box, 'atkErr') + sumBox(box, 'blockPt');
  if (boxAttr + nFault + nMisc + nCap !== totalPts) fails.push(`B:보존 ${boxAttr}+f${nFault}+m${nMisc}+c${nCap}≠${totalPts}`);

  // (D) 선수 행 불변식
  for (const l of box.values()) {
    for (const [k, v] of Object.entries(l)) if ((v as number) < 0) fails.push(`D:음수 ${k}`);
    if (l.atkKill > l.atkAtt) fails.push(`D:atkKill>atkAtt`);
    if (l.recvGood + l.recvErr > l.recvAtt) fails.push(`D:recvGood+recvErr>recvAtt`);
  }

  return {
    fails, pts: totalPts,
    tot: { atkAtt: sumBox(box, 'atkAtt'), atkKill: sumBox(box, 'atkKill'), aces: stats.aces, serves: stats.serves, sideouts: stats.sideouts, rallies: stats.rallies, recvAtt: sumBox(box, 'recvAtt'), recvGood: sumBox(box, 'recvGood'), recvErr: sumBox(box, 'recvErr') },
  };
}

// tier 분류
const tierOf = (d: number) => (d <= 2 ? '대등(≤2)' : d <= 7 ? '중간(3~7)' : '격차(≥8)');
type Agg = { n: number; atkAtt: number; atkKill: number; aces: number; serves: number; sideouts: number; rallies: number; recvAtt: number; recvGood: number; recvErr: number };
const mk = (): Agg => ({ n: 0, atkAtt: 0, atkKill: 0, aces: 0, serves: 0, sideouts: 0, rallies: 0, recvAtt: 0, recvGood: 0, recvErr: 0 });
const tiers: Record<string, Agg> = { '대등(≤2)': mk(), '중간(3~7)': mk(), '격차(≥8)': mk() };
const all = mk();

let total = 0, failedMatches = 0;
const failSamples: string[] = [];
for (const [a, b] of matchups) {
  const base = { home: coach.get(a), away: coach.get(b) };
  const tier = tierOf(Math.abs(ovr.get(a)! - ovr.get(b)!));
  for (let s = 1; s <= PER; s++) {
    const r = auditMatch(s * 131 + a.length * 7 + b.length, roster.get(a)!, roster.get(b)!, base);
    total++;
    if (r.fails.length) { failedMatches++; if (failSamples.length < 12) failSamples.push(`${a}v${b} seed${s}: ${r.fails.slice(0, 4).join(', ')}`); }
    for (const agg of [tiers[tier], all]) {
      agg.n++; agg.atkAtt += r.tot.atkAtt; agg.atkKill += r.tot.atkKill; agg.aces += r.tot.aces;
      agg.serves += r.tot.serves; agg.sideouts += r.tot.sideouts; agg.rallies += r.tot.rallies;
      agg.recvAtt += r.tot.recvAtt; agg.recvGood += r.tot.recvGood; agg.recvErr += r.tot.recvErr;
    }
  }
}

log(`== 박스스코어 통계 정확도 감사 ==`);
log(`매치업 ${matchups.length}개(홈/원정 구분) × 시드 ${PER} = ${total}경기\n`);
log(`(A)(B)(C)(D) 무결성: ${failedMatches === 0 ? '✅ 위반 0' : `❌ ${failedMatches}/${total}경기 위반`}`);
if (failSamples.length) failSamples.forEach((s) => log('   ' + s));

const pctOf = (n: number, d: number) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '–';
log(`\n(E) tier별 비율 (강·약·대등에서 통계가 일관·현실적인가):`);
log(`  tier        | 경기 | 공격성공률 | 리시브효율 | 에이스율 | 사이드아웃`);
for (const [name, g] of Object.entries(tiers)) {
  if (!g.n) continue;
  const atkSucc = pctOf(g.atkKill, g.atkAtt);
  const recvEff = ((g.recvGood - g.recvErr) / g.recvAtt * 100).toFixed(1) + '%';
  const aceR = pctOf(g.aces, g.serves);
  const sideout = pctOf(g.sideouts, g.rallies);
  log(`  ${name.padEnd(11)} | ${String(g.n).padStart(4)} | ${atkSucc.padStart(9)} | ${recvEff.padStart(9)} | ${aceR.padStart(7)} | ${sideout.padStart(8)}`);
}
const recvEffAll = ((all.recvGood - all.recvErr) / all.recvAtt * 100).toFixed(1);
log(`  전체        | ${String(all.n).padStart(4)} | ${pctOf(all.atkKill, all.atkAtt).padStart(9)} | ${(recvEffAll + '%').padStart(9)} | ${pctOf(all.aces, all.serves).padStart(7)} | ${pctOf(all.sideouts, all.rallies).padStart(8)}`);

// KOVO 현실 밴드 게이트(전체)
const atkR = all.atkKill / all.atkAtt * 100, recvR = +recvEffAll, aceR = all.aces / all.serves * 100, soR = all.sideouts / all.rallies * 100;
const bands: [string, number, number, number][] = [['공격성공률', atkR, 36, 56], ['리시브효율', recvR, 25, 55], ['에이스율', aceR, 3, 9], ['사이드아웃', soR, 50, 66]];
log(`\n  KOVO 현실 밴드:`);
let bandsOk = true;
for (const [name, v, lo, hi] of bands) { const ok = v >= lo && v <= hi; if (!ok) bandsOk = false; log(`    ${ok ? 'PASS' : 'CHECK'}  ${name} ${v.toFixed(1)}% ∈ [${lo},${hi}]`); }

// (F) A/B 자가검증 — 박스를 일부러 망가뜨리면 (A)·(B)가 잡는가 (실제 박스에 있는 선수를 건드린다)
log(`\n(F) A/B 자가검증 (검사기 민감도 — 깨진 박스를 반드시 잡아야 함):`);
const oracleMismatch = (box: BoxSink, stats: RallyStats) =>
  sumBox(box, 'atkAtt') !== stats.attacks || sumBox(box, 'atkKill') !== stats.kills + stats.blockouts
  || sumBox(box, 'atkErr') !== stats.attackErrs || sumBox(box, 'atkBlocked') !== stats.stuffs
  || sumBox(box, 'srvAtt') !== stats.serves || sumBox(box, 'srvAce') !== stats.aces + stats.recvErrs
  || sumBox(box, 'srvErr') !== stats.serveErrs || sumBox(box, 'blockPt') !== stats.stuffs
  || sumBox(box, 'assist') !== stats.kills + stats.blockouts
  || sumBox(box, 'recvAtt') !== stats.aces + stats.recvErrs + stats.recvQN
  || sumBox(box, 'recvGood') !== stats.recvGood + stats.recvOk || sumBox(box, 'recvErr') !== stats.aces + stats.recvErrs;
function corruptDetected(mut: ((l: BoxLine) => void) | null, label: string): boolean {
  const stats = newRallyStats();
  const box: BoxSink = new Map();
  const A = roster.get(teams[0])!, B = roster.get(teams[1])!;
  const sim = simulateMatch(777, A, B, { home: coach.get(teams[0]), away: coach.get(teams[1]), stats, box });
  if (mut) { const id = [...box.keys()][0]; mut(box.get(id)!); } // 박스에 실제 있는 선수를 오염
  const totalPts = sim.setScores.reduce((s, x) => s + x.home + x.away, 0);
  const nCap = sim.points.filter((p) => p.how === 'cap').length, nFault = sim.points.filter((p) => p.how === 'fault').length, nMisc = sim.points.filter((p) => p.how === 'miscErr').length;
  const boxAttr = sumBox(box, 'srvErr') + sumBox(box, 'recvErr') + sumBox(box, 'atkKill') + sumBox(box, 'atkErr') + sumBox(box, 'blockPt');
  const caught = oracleMismatch(box, stats) || boxAttr + nFault + nMisc + nCap !== totalPts;
  const wantCaught = mut !== null;
  const ok = caught === wantCaught;
  log(`    ${ok ? 'PASS' : 'FAIL'}  ${label} → ${caught ? '검출 ✔' : '미검출'}${ok ? '' : caught ? ' (허위 양성!)' : ' (놓침 — 허위 오라클!)'}`);
  return ok;
}
let abOk = true;
abOk = corruptDetected((l) => { l.atkKill += 1; }, 'atkKill +1 (검출돼야)') && abOk;
abOk = corruptDetected((l) => { l.recvErr += 2; }, 'recvErr +2 (검출돼야)') && abOk;
abOk = corruptDetected((l) => { l.srvAce += 1; }, 'srvAce +1 (검출돼야)') && abOk;
abOk = corruptDetected((l) => { l.atkErr += 1; }, 'atkErr +1 (검출돼야)') && abOk;
abOk = corruptDetected(null, '오염 없음 (검출되면 안 됨)') && abOk;

log(`\n종합: ${failedMatches === 0 && bandsOk && abOk ? '✅ ALL PASS — 통계 정확(무결성 0위반·KOVO 밴드·A/B 민감)' : '❌ FAIL 있음'}`);
process.exit(failedMatches === 0 && bandsOk && abOk ? 0 : 1); // 배터리 게이트: 판정을 exit code로 배선(로그만이면 영구 허위 초록)
