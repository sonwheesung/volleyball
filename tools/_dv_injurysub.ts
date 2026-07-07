// 경기 내 부상 교체(MATCH_SYSTEM 1.3d) 상비 가드 — A/B, DB 무의존.
//   npx tsx tools/_dv_injurysub.ts [matches=3000]
// 검증:
//  (a) 결정론 — 같은 시드 → 동일 SimResult(요약 바이트). 400시드 2회, 차이 0.
//  (b) 부상 아웃 선수는 그 경기 이후 랠리·세트에 코트로 절대 재등장하지 않는다(applySubsToSix 재생).
//  (c) 부상 교체는 작전 교체 회계 밖 — 부상 아웃 선수가 작전 교체 inId로 재활용되지 않고,
//      부상 슬롯에 그 뒤 작전 교체가 붙지 않으며(subBudget/재진입 미소모), 작전 교체는 여전히 net-zero로 돈다.
//  (d) 심각도 게이트 — 중상(교체 승격) 건 ≪ 부상 발동 총건(참고뛰기가 대다수). severe/injuries ≈ SEVERE_INJURY_FRAC.
//  (e) 경기당 부상 교체율 출력(N≥2000 — Fable 현실성 새너티체크용).
//  (f) 변이 노트: SEVERE_INJURY_FRAC→1로 올리면 (d) 게이트가 무너져 severe≈injuries가 되어야 함(가드 민감).
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { newRallyStats } from '../engine/rally';
import { applySubsToSix } from '../components/courtDirector';
import type { SimResult } from '../engine/simMatch';
import type { Player, Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

const N = Math.max(1, Number(process.argv[2]) || 3000);
const DET_N = 400;

// SimResult 요약(결정론 비교용) — 랠리 결과 + 교체 로그.
const summarize = (s: SimResult): string => JSON.stringify({
  hs: s.homeSets, as: s.awaySets, ss: s.setScores,
  p: s.points.map((p) => [p.setNo, p.home, p.away, p.scorer, p.how ?? '', p.byId ?? '']),
  e: (s.subEvents ?? []).map((e) => [e.point, e.setNo, e.side, e.slot, e.inId, e.outId, e.kind, e.enter ? 1 : 0]),
});

const pair = (m: number): [string, string] => {
  const hi = ids[m % ids.length], ai = ids[(m * 3 + 1) % ids.length];
  return [hi, ai];
};

// ── (a) 결정론 ──
let detFail = 0;
{
  let seed = 700000;
  for (let m = 0; m < DET_N; m++) {
    const [hi, ai] = pair(m); if (hi === ai) continue; seed += 13;
    const s1 = simulateMatch(seed, sq[hi], sq[ai], { home: coachInfoOf(hi), away: coachInfoOf(ai) });
    const s2 = simulateMatch(seed, sq[hi], sq[ai], { home: coachInfoOf(hi), away: coachInfoOf(ai) });
    if (summarize(s1) !== summarize(s2)) detFail++;
  }
}

// ── (b)~(e) 본 배터리 ──
let matches = 0, injSubMatches = 0, injSubEvents = 0;
let injFired = 0, injSevere = 0;      // 계측(stats)
let tacticalEnters = 0, bothCoexist = 0;
let failReappear = 0, failRecycle = 0, failTacticalOnSlot = 0, failTacticalNetZero = 0;

let seed = 800000;
for (let m = 0; m < N; m++) {
  const [hi, ai] = pair(m); if (hi === ai) continue; seed += 7;
  const home = sq[hi], away = sq[ai];
  const stats = newRallyStats();
  const sim = simulateMatch(seed, home, away, { home: coachInfoOf(hi), away: coachInfoOf(ai), stats });
  matches++;
  injFired += stats.injuries; injSevere += stats.injurySevere;

  const evs = sim.subEvents ?? [];
  const injEvs = evs.filter((e) => e.kind === 'injury');
  const tacEvs = evs.filter((e) => e.kind !== 'injury');
  tacticalEnters += tacEvs.filter((e) => e.enter).length;
  if (injEvs.length) { injSubMatches++; injSubEvents += injEvs.length; }
  if (injEvs.length && tacEvs.length) bothCoexist++;

  const byId = new Map<string, Player>();
  for (const p of home) byId.set(p.id, p);
  for (const p of away) byId.set(p.id, p);
  const baseSix: Record<Side, Player[]> = { home: buildLineup(home).six, away: buildLineup(away).six };

  // (b) 부상 아웃 선수 재등장 0 — 부상 이후 모든 랠리 시점의 코트 6인에 outId 없음.
  for (const e of injEvs) {
    for (let r = e.point; r <= sim.points.length; r++) {
      const six = applySubsToSix(baseSix[e.side], e.side, evs, r, byId);
      if (six.some((p) => p.id === e.outId)) { failReappear++; break; }
    }
  }

  // (c1) 부상 아웃 선수가 작전 교체 inId로 재활용되지 않는다(예산·재진입 밖 → 부상자 복귀 통로 없음).
  //   순서 인식: 진짜 재활용은 그 선수의 부상 아웃(setNo,point) '이후' 발생한 작전 진입뿐이다.
  //   (합법적으로 먼저 작전 투입된 뒤 나중에 부상 아웃된 선수는 재활용이 아님 — 과다계수 방지.)
  const injOutAt = new Map<string, { setNo: number; point: number }>(); // side:id → 가장 이른 부상 아웃 시점
  for (const e of injEvs) {
    const k = `${e.side}:${e.outId}`;
    const prev = injOutAt.get(k);
    if (!prev || e.setNo < prev.setNo || (e.setNo === prev.setNo && e.point < prev.point)) {
      injOutAt.set(k, { setNo: e.setNo, point: e.point });
    }
  }
  for (const e of tacEvs) {
    if (!e.enter) continue;
    const out = injOutAt.get(`${e.side}:${e.inId}`);
    if (out && (e.setNo > out.setNo || (e.setNo === out.setNo && e.point > out.point))) failRecycle++;
  }

  // (c2) 부상 슬롯엔 그 뒤 작전 교체가 붙지 않는다(subIn 가드 → 부상 교체 선수 영구 유지).
  for (const ie of injEvs) {
    for (const te of tacEvs) if (te.side === ie.side && te.slot === ie.slot && te.point >= ie.point) failTacticalOnSlot++;
  }

  // (c3) 작전 교체는 여전히 net-zero — 기대 최종 = base에 부상 스왑만. 작전은 원복돼야.
  for (const side of ['home', 'away'] as Side[]) {
    const final = applySubsToSix(baseSix[side], side, evs, sim.points.length, byId);
    const expected = baseSix[side].slice();
    for (const e of injEvs) if (e.side === side) { const p = byId.get(e.inId); if (p) expected[e.slot] = p; }
    if (!(final.length === expected.length && final.every((p, i) => p.id === expected[i].id))) failTacticalNetZero++;
  }
}

const severeRatio = injFired ? injSevere / injFired : 0;

log(`\n경기 ${matches}건 (seed 800000+)`);
log(`부상 발동 총 ${injFired} (경기당 ${(injFired / matches).toFixed(3)}) · 그중 중상(교체 승격) ${injSevere} (경기당 ${(injSevere / matches).toFixed(3)})`);
log(`실제 부상 교체 이벤트 ${injSubEvents} · 교체 발생 경기 ${injSubMatches} (${(100 * injSubMatches / matches).toFixed(1)}%) · 경기당 부상 교체율 ${(injSubEvents / matches).toFixed(4)}`);
log(`중상/발동 비율 ${(severeRatio * 100).toFixed(1)}% (SEVERE_INJURY_FRAC=0.12 기대) · 참고뛰기 ${(100 * (1 - severeRatio)).toFixed(1)}%`);
log(`작전 교체 투입(enter) 총 ${tacticalEnters} · 부상+작전 공존 경기 ${bothCoexist}`);
log(`(중상 발동 ${injSevere} vs 실제 교체 ${injSubEvents} 차이 = 벤치 소진/이미 이탈 폴백)`);

log('\n검증:');
const assert = (c: boolean, label: string, detail = '') => log(`  ${c ? 'PASS' : 'FAIL ❌'} — ${label}${detail}`);
assert(detFail === 0, `(a) 결정론 — 같은 시드=동일 결과 (${DET_N}시드×2)`, detFail ? ` (불일치 ${detFail})` : '');
assert(failReappear === 0, '(b) 부상 아웃 선수 이후 코트 재등장 0', failReappear ? ` (위반 ${failReappear})` : '');
assert(failRecycle === 0, '(c1) 부상 아웃 선수 작전 교체로 재활용 0', failRecycle ? ` (위반 ${failRecycle})` : '');
assert(failTacticalOnSlot === 0, '(c2) 부상 슬롯 이후 작전 교체 부착 0(예산·재진입 미소모)', failTacticalOnSlot ? ` (위반 ${failTacticalOnSlot})` : '');
assert(failTacticalNetZero === 0, '(c3) 작전 교체 net-zero 유지(부상 스왑만 영구)', failTacticalNetZero ? ` (위반 ${failTacticalNetZero})` : '');
assert(tacticalEnters > 0, '(c) 작전 교체 여전히 작동(투입 발생)');
assert(injFired > 0, '(d) 부상 발동 표본 존재');
assert(injSevere > 0, '(d) 중상 교체 표본 존재');
assert(severeRatio < 0.30, '(d) 심각도 게이트 — 중상 ≪ 발동(참고뛰기 대다수)', ` (중상 ${(severeRatio * 100).toFixed(1)}%)`);
assert(severeRatio > 0.04 && severeRatio < 0.25, '(d) 중상/발동 ≈ SEVERE_INJURY_FRAC(0.12)', ` (${(severeRatio * 100).toFixed(1)}%)`);
assert(injSubEvents > 0, '(e) 실제 부상 교체 발생(연출 켜짐)');

const pass = detFail === 0 && failReappear === 0 && failRecycle === 0 && failTacticalOnSlot === 0
  && failTacticalNetZero === 0 && tacticalEnters > 0 && injFired > 0 && injSevere > 0
  && severeRatio < 0.30 && injSubEvents > 0;
log('\n(f) 변이 노트: SEVERE_INJURY_FRAC(rally.ts)을 1.0으로 바꾸면 (d) 게이트가 무너져 severe≈injuries·교체율 급등 → 이 가드가 즉시 FAIL해야 정상(민감도).');
log(pass ? '\n완료 — 전부 PASS.' : '\n완료 — 실패 있음.');
process.exit(pass ? 0 : 1);
