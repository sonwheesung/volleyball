// 상설 가드 — 스태프 3.0 Phase D(실효과 훅) 발현·역전금지·소폭상한·결정론 (STAFF_SYSTEM §9.6-D). 검증=Fable / 구현=Opus.
//   npx tsx tools/_dv_staff3_hooks.ts   (exit 0/1)
//
// 게이트 ⑤(발현 A/B — vacuous 방지): 각 훅을 on/off로 실측해 결과가 실제로 달라짐을 증명하고,
//   off(중립값)==baseline(byte-동일)로 0드리프트를 함께 증명한다(허위 오라클 방지 — 스태프 2.0 phase① 교훈).
//   훅: ① FA 유인(offerScore coachRep) ② 관중(turnoutRate coachRep) ③ U23 라인업(buildLineup dvPhilosophy·역전금지)
//       ④ 경기경험(u23ExpMul) ⑤ 리더십 FORM(formFactor relief) ⑥ 리더십 OWNER(persuade·sustainedBenchRefuse·benchP)
//       ⑦ 명성 U23 보조축(rowDelta) ⑧ 코치 명성(assistantCoachRep·coachToHead renown)
import './_gt_mock';

import type { Player, Position } from '../types';
import { makePlayer } from '../data/seed';
import { createRng } from '../engine/rng';
import { overall } from '../engine/overall';
import { buildLineup, u23Edge, U23_LINEUP_EDGE } from '../engine/lineup';
import { splitLineup } from '../engine/production';
import { offerScore, COACH_REP_APPEAL, type OfferCtx } from '../engine/faMarket';
import { turnoutRate, COACH_REP_TURNOUT } from '../engine/finance';
import { applyMatchXp, u23ExpMul, U23_EXP_BONUS } from '../engine/experience';
import { emptyProd, type ProdLine } from '../engine/production';
import { formFactor, leadershipRelief, LEADERSHIP_FORM_RELIEF, FORM_MAX_PENALTY } from '../engine/form';
import { persuade, sustainedBenchRefuse, benchP, benchAccept } from '../engine/owner';
import { rowDelta, assistantCoachRep, COACH_REP_BASE, type CoachCareerRow, type CoachAsstCareerRow } from '../engine/reputation';
import { headWorthiness, coachToHead } from '../engine/staffLifecycle';
import type { AssistantCoach } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

// ── 헬퍼: OVR을 skSpike/skServe 증감으로 정확히 target에 맞춘 선수(overall은 이 스탯에 단조) ──
function withOverall(seed: string, pos: Position, target: number, age: number): Player {
  let p = { ...makePlayer(createRng(1234 + seed.length), seed, pos, false, age), id: seed, age } as Player;
  const bump = (d: number) => { p = { ...p, skSpike: Math.max(1, Math.min(99, p.skSpike + d)), skServe: Math.max(1, Math.min(99, p.skServe + d)), skReceive: Math.max(1, Math.min(99, p.skReceive + d)) }; };
  for (let it = 0; it < 300; it++) {
    const o = overall(p);
    if (o === target) break;
    bump(o < target ? 1 : -1);
  }
  return p;
}
/** base 선수를 age·정확 OVR로 복제(하향은 항상 가능 — skSpike 등 감소). */
function cloneTo(base: Player, id: string, target: number, age: number): Player {
  let p = { ...base, id, age } as Player;
  const bump = (d: number) => { p = { ...p, skSpike: Math.max(1, Math.min(99, p.skSpike + d)), skServe: Math.max(1, Math.min(99, p.skServe + d)), skReceive: Math.max(1, Math.min(99, p.skReceive + d)) }; };
  for (let it = 0; it < 400; it++) { const o = overall(p); if (o === target) break; bump(o < target ? 1 : -1); }
  return p;
}

/** OH 정확히 3인(vetA 최강·vetB=vetA−5·u23=vetB−belowB) + 나머지 포지션 필러. 하향 파생이라 항상 성립. */
function rosterWithOH(belowB: number, u23Age = 22): { roster: Player[]; oA: number; oB: number; oU: number } {
  const rs = createRng(9999);
  const fillers: Player[] = [];
  const need: [Position, number][] = [['S', 2], ['MB', 3], ['OP', 2], ['L', 2]]; // OH 필러 없음 — 정확 3 OH만
  let n = 0;
  for (const [pos, cnt] of need) for (let i = 0; i < cnt; i++) fillers.push(makePlayer(rs, `fill_${pos}_${n++}`, pos, false, 28));
  const vetA = makePlayer(createRng(4242), 'ohVetA', 'OH', false, 30, 18); // bias로 강한 OH
  const oA = overall(vetA);
  const vetB = cloneTo(vetA, 'ohVetB', oA - 5, 30);
  const oB = overall(vetB);
  const u23 = cloneTo(vetA, 'ohU23', oB - belowB, u23Age);
  return { roster: [vetA, vetB, u23, ...fillers], oA, oB, oU: overall(u23) };
}

console.log('═══ ① FA 유인 — offerScore coachRep (발현 + 0드리프트 + 소폭상한) ═══');
{
  const ctx0: OfferCtx = {
    teamOvr: 70, prestige: 0.5, posGap: 1, isOriginal: false, isFranchise: false, isPreferred: false,
    offerSalary: 5000, asking: 5000, w: { money: 0.4, win: 0.3, loyalty: 0.15, play: 0.1, home: 0.05, rel: 0.03 }, rand: 0.5,
  };
  const base = offerScore(ctx0);                       // coachRep undefined = 0
  const rep0 = offerScore({ ...ctx0, coachRep: 0 });   // 명시 0
  const rep100 = offerScore({ ...ctx0, coachRep: 100 });
  const rep60 = offerScore({ ...ctx0, coachRep: 60 });
  ok(base === rep0, `0드리프트: coachRep 미지정 == coachRep 0 (${base}==${rep0})`);
  ok(rep100 > rep0, `발현: coachRep 100 > 0 (${rep100.toFixed(4)} > ${rep0.toFixed(4)})`);
  ok(rep100 > rep60 && rep60 > rep0, `단조↑: 100 > 60 > 0`);
  ok(Math.abs((rep100 - rep0) - COACH_REP_APPEAL) < 1e-9, `소폭상한: 최대 가산 == COACH_REP_APPEAL(${COACH_REP_APPEAL})`);
  ok(rep100 - rep0 <= 0.06, `소폭: 최대 가산 ≤ 0.06(rand 지터급)`);
}

console.log('═══ ② 관중 — turnoutRate coachRep (발현 + 0드리프트 + 상한 캡) ═══');
{
  const base = turnoutRate(0.5, 50);
  const rep0 = turnoutRate(0.5, 50, 0);
  const rep100 = turnoutRate(0.5, 50, 100);
  ok(base === rep0, `0드리프트: coachRep 미지정 == 0 (${base}==${rep0})`);
  ok(rep100 > rep0, `발현: rep 100 > 0 (${rep100.toFixed(4)} > ${rep0.toFixed(4)})`);
  ok(COACH_REP_TURNOUT <= 0.03, `소폭: 계수 ${COACH_REP_TURNOUT} ≤ 팬심 가산 0.03`);
  ok(turnoutRate(1, 100, 100) <= 0.16, `상한 캡: 극단 입력도 ≤ 0.16`);
}

console.log('═══ ③ U23 라인업 — buildLineup dvPhilosophy (발현 + 역전금지 + 0드리프트) ═══');
{
  // 근소차: u23=vetB−1. dvPhil 100 → u23+2 > vetB → u23이 vetB를 역전(주전 진입).
  const near = rosterWithOH(1);
  const rNear = near.roster;
  console.log(`   구성 실측: vetA=${near.oA} vetB=${near.oB} u23=${near.oU}`);
  ok(near.oU < near.oB && near.oB - near.oU <= U23_LINEUP_EDGE, `전제: 근소차(vetB ${near.oB} − u23 ${near.oU} = ${near.oB - near.oU} ≤ ${U23_LINEUP_EDGE})`);
  const luOff = buildLineup(rNear, 0);
  const luOn = buildLineup(rNear, 100);
  const startersOff = new Set(luOff.six.map((p) => p.id));
  const startersOn = new Set(luOn.six.map((p) => p.id));
  ok(!startersOff.has('ohU23'), `off(dvPhil0): 근소차 U23 벤치(pure OVR)`);
  ok(startersOn.has('ohU23'), `발현(dvPhil100): 근소차 U23 주전 진입`);
  ok(startersOn.has('ohVetA'), `역전금지 부분: 최상위 vetA(${near.oA})는 여전히 주전`);
  ok(!startersOn.has('ohVetB'), `근소차 vetB(${near.oB})만 밀림`);

  // 역전금지(큰 격차): u23=vetB−4. dvPhil 100 → +2=oB−2 < oB → 여전히 벤치.
  const gap = rosterWithOH(4);
  ok(gap.oB - gap.oU > U23_LINEUP_EDGE, `전제: 큰 격차(vetB ${gap.oB} − u23 ${gap.oU} = ${gap.oB - gap.oU} > ${U23_LINEUP_EDGE})`);
  const luGap = buildLineup(gap.roster, 100);
  ok(!new Set(luGap.six.map((p) => p.id)).has('ohU23'), `역전금지: OVR 큰 격차 U23은 dvPhil 100에도 벤치`);

  // 0드리프트: dvPhil ≤50이면 pure OVR과 동일.
  const luD0 = buildLineup(rNear, 0), luD50 = buildLineup(rNear, 50), luD30 = buildLineup(rNear, 30);
  const ids = (lu: typeof luD0) => lu.six.map((p) => p.id).join(',');
  ok(ids(luD0) === ids(luD50) && ids(luD0) === ids(luD30), `0드리프트: dvPhil 0==30==50 (승부형=youth 에지 없음)`);

  // u23Edge 순수함수 성질
  const vet = rNear[0], u23 = rNear[2];
  ok(u23Edge(vet, 100) === 0, `u23Edge: 비-U23(age30) = 0`);
  ok(u23Edge(u23, 50) === 0 && u23Edge(u23, 30) === 0, `u23Edge: dvPhil≤50 = 0`);
  ok(Math.abs(u23Edge(u23, 100) - U23_LINEUP_EDGE) < 1e-9, `u23Edge: dvPhil100 U23 = ${U23_LINEUP_EDGE}`);

  // splitLineup(생산 귀속)도 동일 에지 — 라인업↔생산 정합
  const spOff = new Set(splitLineup(rNear, 0).starters.map((p) => p.id));
  const spOn = new Set(splitLineup(rNear, 100).starters.map((p) => p.id));
  ok(!spOff.has('ohU23') && spOn.has('ohU23'), `splitLineup 정합: 생산 귀속도 U23 에지 동일(라인업↔생산 일치)`);
}

console.log('═══ ④ 경기경험 — u23ExpMul / applyMatchXp (발현 + 0드리프트) ═══');
{
  ok(u23ExpMul(22, 50) === 1 && u23ExpMul(22, 30) === 1, `0드리프트: dvPhil≤50 → 승수 1`);
  ok(u23ExpMul(30, 100) === 1, `비-U23(age30): 승수 1(무보정)`);
  ok(Math.abs(u23ExpMul(22, 100) - (1 + U23_EXP_BONUS)) < 1e-9, `발현: U23 dvPhil100 → 1+${U23_EXP_BONUS}`);
  // applyMatchXp: expMul>1이 실제 XP를 더 쌓는가(성장 발현). 성장 여지 있는 U23 선수로.
  const rs = createRng(555);
  let p = makePlayer(rs, 'u23xp', 'OH', false, 20);
  // 포텐을 현재보다 높여 성장 여지 확보
  p = { ...p, potential: { ...p.potential, skSpike: Math.min(99, p.skSpike + 20), skReceive: Math.min(99, p.skReceive + 20), skServe: Math.min(99, p.skServe + 20), vq: Math.min(99, p.vq + 20), positioning: Math.min(99, p.positioning + 20) } };
  const prod: ProdLine = { ...emptyProd(), matches: 30, spikes: 200, receives: 150, aces: 20 };
  const g1 = applyMatchXp(p, prod, 20, 1);
  const gBoost = applyMatchXp(p, prod, 20, 1 + U23_EXP_BONUS);
  const sum = (q: Player) => q.skSpike + q.skReceive + q.skServe + q.vq + q.positioning + Object.values(q.xp ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  ok(sum(gBoost) > sum(g1), `발현: expMul 1.15가 expMul 1.0보다 XP↑ 실적립(${sum(gBoost).toFixed(2)} > ${sum(g1).toFixed(2)})`);
  const g0 = applyMatchXp(p, prod, 20);         // 기본 expMul=1
  ok(sum(g0) === sum(g1), `0드리프트: expMul 미지정 == expMul 1`);
}

console.log('═══ ⑤ 리더십 FORM — formFactor relief (발현 + 0드리프트 + 소폭상한) ═══');
{
  const worst0 = formFactor(0, 5);        // relief 미지정 = 0
  const worstL50 = formFactor(0, 5, leadershipRelief(50));
  const worstL100 = formFactor(0, 5, leadershipRelief(100));
  ok(worst0 === worstL50, `0드리프트: leadership 50 → relief 0 (${worst0}==${worstL50})`);
  ok(worstL100 > worst0, `발현: leadership 100이 경기감각 하락 완화(${worstL100.toFixed(4)} > ${worst0.toFixed(4)})`);
  ok(Math.abs(worst0 - (1 - FORM_MAX_PENALTY)) < 1e-9, `기저: relief 0 최악 = ${1 - FORM_MAX_PENALTY}(구 −7%)`);
  const relievedPenalty = 1 - worstL100;
  ok(relievedPenalty >= FORM_MAX_PENALTY * (1 - LEADERSHIP_FORM_RELIEF) - 1e-9, `소폭: 완화해도 페널티 ≥ ${(FORM_MAX_PENALTY * (1 - LEADERSHIP_FORM_RELIEF)).toFixed(4)}(바닥 존재)`);
  ok(worstL100 < 1, `완화≠제거: 여전히 페널티 존재(<1.0)`);
  ok(leadershipRelief(30) === 0, `leadership<50 → relief 0(악화 없음)`);
}

console.log('═══ ⑥ 리더십 OWNER — persuade·sustainedBenchRefuse·benchP (발현 + 0드리프트) ═══');
{
  // persuade: 리더십↑ → 성공률↑ (600표본 비율 A/B)
  const rate = (lead: number) => { let o = 0; for (let i = 0; i < 800; i++) if (persuade(`px${i}`, 1, 0, 0.5, 0.5, 0, lead)) o++; return o / 800; };
  const r50 = rate(50), r100 = rate(100);
  ok(Math.abs(rate(50) - rate(50)) < 1e-9, `persuade 결정론(같은 시드 동일)`);
  ok(r100 > r50 + 0.02, `발현: 리더십 100 면담 성공률 > 50 (${(r100 * 100).toFixed(1)}% > ${(r50 * 100).toFixed(1)}%)`);
  // 0드리프트: leadership 50 == 무인자(기본 50)
  let a = 0, b = 0; for (let i = 0; i < 400; i++) { if (persuade(`pd${i}`, 2, 0, 0.5, 0.5, 0)) a++; if (persuade(`pd${i}`, 2, 0, 0.5, 0.5, 0, 50)) b++; }
  ok(a === b, `0드리프트: persuade 무인자 == leadership 50 (${a}==${b})`);

  // sustainedBenchRefuse: 리더십↑ → 불만 축적↓
  const u50 = sustainedBenchRefuse(0.2, 0.6, 50);
  const u100 = sustainedBenchRefuse(0.2, 0.6, 100);
  ok(sustainedBenchRefuse(0.2, 0.6) === u50, `0드리프트: 무인자 == leadership 50`);
  ok(u100 < u50, `발현: 리더십 100 불만 축적 < 50 (${u100.toFixed(4)} < ${u50.toFixed(4)})`);
  ok(u100 >= u50 * (1 - 0.20) - 1e-9, `소폭: 완화 ≤20%`);

  // benchP(구 charisma→leadership 이관): 리더십↑ → 벤치 수락↓(소신). 결정론 유지.
  ok(benchP(60, 0.5, 4, 'form') < benchP(40, 0.5, 4, 'form'), `발현: 리더십↑ → 벤치 건의 수락 확률↓(소신)`);
  ok(benchAccept('x', 2, 5, 60, 0.4, 0, 'form') === benchAccept('x', 2, 5, 60, 0.4, 0, 'form'), `benchAccept 결정론(시드)`);
}

console.log('═══ ⑦ 명성 U23 보조축 — rowDelta (발현 + 0드리프트) ═══');
{
  const rowBase: CoachCareerRow = { season: 1, coachId: 'c', teamId: 't', predictedRank: 4, actualRank: 4, playoff: 'none', champion: false, midSeasonFired: false };
  const d0 = rowDelta(rowBase);
  ok(d0 === 0, `기저: 예상==실제·무보조 → delta 0`);
  ok(rowDelta({ ...rowBase, u23Starters: 2 }) > d0, `발현: U23 주전 안착 2명 → delta↑`);
  ok(rowDelta({ ...rowBase, rookieAward: true }) > d0, `발현: 신인상 배출 → delta↑`);
  ok(rowDelta({ ...rowBase, u23Starters: undefined, rookieAward: undefined }) === d0, `0드리프트: 보조필드 undefined == 구 로그`);
  // 상한: u23Starters 캡(3)
  ok(rowDelta({ ...rowBase, u23Starters: 10 }) === rowDelta({ ...rowBase, u23Starters: 3 }), `상한: u23Starters 캡 3`);
  // 소폭: 기대(예상 대비) 주축이 보조축보다 크다 — 1칸 기대(+3) vs U23 최대(+1.5)+신인상(+1.5)=3. 주축이 여전히 지배적.
  const expDelta = rowDelta({ ...rowBase, predictedRank: 5, actualRank: 4 }); // 기대 +1칸
  ok(expDelta >= 3 - 1e-9, `주축 보존: 기대 1칸(+3) ≥ 보조 최대(U23 1명 0.5)`);
}

console.log('═══ ⑧ 코치 명성 §6.3 — assistantCoachRep / coachToHead renown (발현 + 0드리프트 청산) ═══');
{
  ok(assistantCoachRep([], 'noHistory', 7) === COACH_REP_BASE, `0드리프트: 무경력 == 구 상수 ${COACH_REP_BASE}(headWorthiness 회귀)`);
  const log: CoachAsstCareerRow[] = [
    { season: 1, coachId: 'veteran', teamId: 't', teamRank: 1 },
    { season: 2, coachId: 'veteran', teamId: 't', teamRank: 2 },
    { season: 3, coachId: 'veteran', teamId: 't', teamRank: 3 },
  ];
  const repVet = assistantCoachRep(log, 'veteran', 7);
  ok(repVet > COACH_REP_BASE, `발현: 3시즌 상위권 경력 → coachRep > ${COACH_REP_BASE} (${repVet})`);
  // headWorthiness가 실제로 반영(구 상수 50 청산)
  ok(headWorthiness(70, repVet, 40) > headWorthiness(70, COACH_REP_BASE, 40), `발현: 경력 coachRep이 승격 자질↑`);
  // coachToHead renown: coachRep이 초기 명성에 반영
  const ac: AssistantCoach = { id: 'ac1', name: 'X', age: 45, specialty: 'attack', rating: 80, salary: 12000, teamId: null };
  const hNoCareer = coachToHead(ac, 40, { primary: [4, 6], secondary: [1, 10, 12] }, 'attack', COACH_REP_BASE);
  const hCareer = coachToHead(ac, 40, { primary: [4, 6], secondary: [1, 10, 12] }, 'attack', repVet);
  ok(hCareer.renown > hNoCareer.renown, `발현: 코치 경력이 승격 초기 명성(renown)↑ (${hCareer.renown} > ${hNoCareer.renown})`);
  const hDefault = coachToHead(ac, 40, { primary: [4, 6], secondary: [1, 10, 12] }, 'attack');
  ok(hDefault.renown === hNoCareer.renown, `0드리프트: coachRep 미지정 == COACH_REP_BASE`);
}

console.log(fail === 0 ? '\n✅ PASS — 스태프 3.0 Phase D 훅 8종 발현·역전금지·소폭·0드리프트·결정론 전건' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
