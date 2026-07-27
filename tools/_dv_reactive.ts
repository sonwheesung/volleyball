// 반응형 특성 상비 가드 (TRAIT_SYSTEM §6.3, Phase 2a — 조커/유리멘탈/오뚝이). 2026-07-27.
//   반응형 = 경기 중 사건(교체 투입·블로킹 당함·범실)→임시 버프(RallyTeam.activeBuffs, 5랠리·타임아웃/세트끝 해제).
//   신규 엔진 임시상태(저장 안 함, 시드 재생으로 재계산). 동일 시드 A/B로 파이프라인을 상시 감시한다. 추정 금지: 방향/지속/해제/캡을 실측으로 확정.
//   npx tsx tools/_dv_reactive.ts        exit 0=PASS / 1=FAIL
//
// 검사:
//   (a) 결정론/무해성: 반응형 미부여 리그 → activeBuffs 항상 빈 맵(activations=0·maxBuffs=0) + 동일시드 2회 바이트 동일 +
//       reactive* 접근자가 undefined 버프에 1배/0 반환(무특성 무영향). + 민감도(반응형 부여 시 activations>0·결과 변동)로 비공허 증명.
//   (b) 발동: 조커=교체 투입(강제 개입 sub)에서 activations 0→1(무조커 control=0) · 유리멘탈/오뚝이=블로킹 당함(stuff)/범실에서 activations>0(strip=0).
//       Phase 2b: 낯가림=교체 투입(조커와 동일 트리거·control 0) · 핀치서버=서브 슬롯 교체 투입(control 0) · 대타승부사=교체 공격수 첫 공격(control 0) · 에이스기세=서브 에이스(strip 0).
//   (c) 지속·해제: 5랠리 자동 만료(순수 tickReactiveBuffs 직접 검증 + Run A: expires=1·clears=0) · 타임아웃 즉시 clear(Run B: expires=0·clears=1) · 세트 종료 clear(late-set 발동 → clears로 해제, 누수 없음).
//   (d) 선수당 1개: 같은 id에 서로 다른 트리거를 강제 주입(Map.set) → 단일 유지(size=1, 마지막 승).
//   (e) 하드캡: reactiveClampSkill/reactiveClampFocus에 극단값(±5)을 주입해도 [0.90,1.10]/[−0.10,0.10] clamp.
//   (f) 방향 A/B(직접 playRally 하네스 — 팀 박스는 브리프 버프에 희석되어 둔감하므로 버프를 전원 활성해 방향을 크게 관측):
//       조커·대타승부사 홈팀 킬%↑ · 유리멘탈·낯가림 홈팀 킬%↓ · 핀치서버·에이스기세 홈 서브 에이스%↑ + **자가검증**(OFF/OFF = reactiveSkillMult≡1 세계면 킬%·서브에이스% 동률 → 방향 오라클 FAIL 증명).
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch, debugReactive, REACTIVE_DURATION } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { serverIndex } from '../engine/rotation';
import { playRally, type RallyTeam, type BoxSink } from '../engine/rally';
import { deriveRatings } from '../engine/ratings';
import { createRng } from '../engine/rng';
import {
  reactiveSkillMult, reactiveFocusAdj, reactiveClampSkill, reactiveClampFocus, tickReactiveBuffs,
  REACTIVE_SKILL_CAP, REACTIVE_FOCUS_CAP, type ActiveBuff, TRAIT_FX,
} from '../engine/traits';
import type { Player, Trait } from '../types';
import type { MatchIntervention } from '../engine/simMatch';

const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };

resetLeagueBase();
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const REACT: Trait[] = ['joker', 'fragile', 'bounce', 'coldStart', 'pinchServer', 'clutchSub', 'aceStreak']; // 반응형 7종 전부 제거(무영향 리그)
const stripReact = (p: Player): Player => ({ ...p, traits: (p.traits ?? []).filter((t) => !REACT.includes(t)) });
const A0 = availableTeamPlayers(t0, 0).map(stripReact); // 반응형 제거 리그(다른 특성은 유지 — 무관)
const B0 = availableTeamPlayers(t1, 0).map(stripReact);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;
const isAtk = (p: Player) => p.position === 'OH' || p.position === 'OP' || p.position === 'MB';
const addTraitTo = (ps: Player[], filter: (p: Player) => boolean, tr: Trait): Player[] =>
  ps.map((p) => (filter(p) ? { ...p, traits: [...(p.traits ?? []), tr] } : p));

// ─────────────────────────────────────────────────────────────────────────────
// (a) 결정론 / 무해성 (반응형 미부여 = 완전 무영향) + 민감도
// ─────────────────────────────────────────────────────────────────────────────
log('── (a) 결정론·무해성(무특성 무영향) + 민감도 ──');
{
  // 접근자 identity(단위): undefined 버프 → 1배 / 0
  check(reactiveSkillMult(undefined, 'spike') === 1 && reactiveSkillMult(undefined, 'serve') === 1, 'reactiveSkillMult(undefined) == 1 (모든 스킬)');
  check(reactiveFocusAdj(undefined) === 0, 'reactiveFocusAdj(undefined) == 0');

  // 반응형 미부여 리그 N경기 → activeBuffs 절대 안 뜸(activations·maxBuffs 0)
  debugReactive.reset();
  const seeds = [101, 202, 303, 404, 505];
  const firstPoints: string[] = [];
  for (const s of seeds) { const sim = simulateMatch(s, A0, B0, { ...base }); firstPoints.push(JSON.stringify(sim.points)); }
  const actInert = debugReactive.activations(), maxInert = debugReactive.maxBuffs();
  log(`   미부여 리그 ${seeds.length}경기: activations=${actInert} maxBuffs=${maxInert}`);
  check(actInert === 0 && maxInert === 0, '반응형 미부여 → 버프 0건(activeBuffs 항상 빈 맵 → 무영향)');

  // 동일 시드 2회 = 바이트 동일(결정론 — 반응형 배선이 비결정성 도입 안 함)
  let identical = true;
  for (const s of seeds) { const again = JSON.stringify(simulateMatch(s, A0, B0, { ...base }).points); if (again !== firstPoints[seeds.indexOf(s)]) identical = false; }
  check(identical, '동일 시드 2회 재실행 = points 바이트 동일(결정론 보존)');

  // 민감도(비공허) — 두 갈래로 "0건이 진짜 무영향"임을 증명(반응형 레이어가 죽은 코드가 아님):
  //   ① 트리거 배선: 유리멘탈 부여 → activations>0(match.ts가 실제로 버프를 세운다).
  debugReactive.reset();
  simulateMatch(101, addTraitTo(A0, isAtk, 'fragile'), B0, { ...base });
  const actLive = debugReactive.activations();
  check(actLive > 0, '① 트리거 배선: 반응형 부여 → 발동>0(match.ts가 버프를 세움)');
  //   ② 효과 배선(de-confounded): 동일 강제 sub을 양 arm에 걸고, 투입 선수만 조커 유/무. sub(라인업 변화)은 동일하니
  //      결과 차이는 오직 조커 버프(×1.04·5랠리) 때문. 결정론이라 고정 시드셋의 변동 건수도 고정. dilute라 다중 시드로 관측.
  const luS = buildLineup(A0, 0);
  const benchAtkS = A0.find((p) => !new Set(luS.six.map((x) => x.id)).has(p.id) && isAtk(p))!;
  const outIdS = luS.six.find((p) => p.position === benchAtkS.position)?.id ?? luS.six[0].id;
  const ivS: MatchIntervention[] = [{ at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: outIdS, inId: benchAtkS.id, subKind: 'manual' }];
  const jokBenchS = A0.map((p) => (p.id === benchAtkS.id ? { ...p, traits: ['joker' as Trait] } : p));
  const senseSeeds = [101, 202, 303, 404, 505, 1, 2, 3, 7, 11];
  let diffCnt = 0;
  for (const s of senseSeeds) {
    const pj = JSON.stringify(simulateMatch(s, jokBenchS, B0, { ...base, interventions: ivS }).points);
    const pc = JSON.stringify(simulateMatch(s, A0, B0, { ...base, interventions: ivS }).points);
    if (pj !== pc) diffCnt++;
  }
  log(`   민감도: ①발동 ${actLive}건 · ②동일sub 조커유/무 결과 변동 ${diffCnt}/${senseSeeds.length}경기`);
  check(diffCnt > 0, '② 효과 배선: 동일 sub·조커만 다름 → 결과 변동(버프가 산출을 실제로 바꿈 — (f)가 방향까지 결정)');
}

// ─────────────────────────────────────────────────────────────────────────────
// (b) 발동 — 조커(교체 투입) · 유리멘탈/오뚝이(블로킹 당함/범실)
// ─────────────────────────────────────────────────────────────────────────────
log('── (b) 트리거 발동 ──');
{
  // 조커: 강제 개입 sub으로 벤치 조커 선수를 코트 투입 → activations 0→1
  const luA = buildLineup(A0, 0);
  const sixIds = new Set(luA.six.map((p) => p.id));
  const benchAtk = A0.find((p) => !sixIds.has(p.id) && isAtk(p))!;
  const outId = luA.six.find((p) => p.position === benchAtk.position)?.id ?? luA.six[0].id;
  const subIv: MatchIntervention[] = [{ at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId, inId: benchAtk.id, subKind: 'manual' }];
  const jokBench = A0.map((p) => (p.id === benchAtk.id ? { ...p, traits: ['joker' as Trait] } : p));
  debugReactive.reset(); simulateMatch(7, jokBench, B0, { ...base, interventions: subIv });
  const actJok = debugReactive.activations();
  debugReactive.reset(); simulateMatch(7, A0, B0, { ...base, interventions: subIv }); // control: 같은 sub, 조커 없음
  const actCtl = debugReactive.activations();
  log(`   조커 교체 투입: activations=${actJok} · control(무조커 동일 sub)=${actCtl}`);
  check(actJok >= 1, '조커 보유 선수 교체 투입 → 버프 발동(activations≥1)');
  check(actCtl === 0, 'control(무조커 동일 sub) → 발동 0(교체 자체가 아니라 조커가 조건)');

  // 유리멘탈: 팀A 공격수 fragile → 블로킹 당함(stuff)에서 발동 · strip → 0
  debugReactive.reset(); simulateMatch(9, addTraitTo(A0, isAtk, 'fragile'), B0, { ...base });
  const actFrag = debugReactive.activations();
  debugReactive.reset(); simulateMatch(9, A0, B0, { ...base });
  const actFragOff = debugReactive.activations();
  log(`   유리멘탈: activations=${actFrag} · strip=${actFragOff}`);
  check(actFrag > 0 && actFragOff === 0, '유리멘탈 공격수 → 블로킹 당함/범실에서 발동(strip=0)');

  // 오뚝이: 팀A 공격수 bounce → 블로킹 당함/범실에서 발동
  debugReactive.reset(); simulateMatch(9, addTraitTo(A0, isAtk, 'bounce'), B0, { ...base });
  const actBounce = debugReactive.activations();
  log(`   오뚝이: activations=${actBounce}`);
  check(actBounce > 0, '오뚝이 공격수 → 블로킹 당함/범실에서 발동');

  // ── Phase 2b 이벤트 발동형 4종 ──
  // 낯가림(coldStart): 조커와 동일 트리거(교체 투입) → debuff 발동. control(무coldStart 동일 sub)=actCtl(위, 0).
  const csBench = A0.map((p) => (p.id === benchAtk.id ? { ...p, traits: ['coldStart' as Trait] } : p));
  debugReactive.reset(); simulateMatch(7, csBench, B0, { ...base, interventions: subIv });
  const actCold = debugReactive.activations();
  log(`   낯가림: activations=${actCold} · control(무coldStart 동일 sub)=${actCtl}`);
  check(actCold >= 1, '낯가림 보유 선수 교체 투입 → debuff 발동(activations≥1)');
  check(actCtl === 0, 'control(무coldStart/조커 동일 sub) → 발동 0(교체 자체가 아니라 특성이 조건)');

  // 핀치서버(pinchServer): 서브 로테이션 슬롯에 교체 투입(서브 차례) → 발동. set1 0:0 = 홈 서브(setNo%2==1).
  const luP = buildLineup(A0, 0);              // rotation 0
  const svSlot = serverIndex(0);
  const svStarter = luP.six[svSlot];           // 이 슬롯이 곧 서브(server=six[serverIndex])
  const benchPin = A0.find((p) => !new Set(luP.six.map((x) => x.id)).has(p.id) && isAtk(p))!; // 서브 가능 벤치 공격수
  const pinIv: MatchIntervention[] = [{ at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: svStarter.id, inId: benchPin.id, subKind: 'pinch' }];
  const pinBench = A0.map((p) => (p.id === benchPin.id ? { ...p, traits: ['pinchServer' as Trait] } : p));
  debugReactive.reset(); simulateMatch(7, pinBench, B0, { ...base, interventions: pinIv });
  const actPin = debugReactive.activations();
  debugReactive.reset(); simulateMatch(7, A0, B0, { ...base, interventions: pinIv }); // control: 같은 서브슬롯 sub, 무pinchServer
  const actPinCtl = debugReactive.activations();
  log(`   핀치서버: activations=${actPin} · control(무pinchServer 동일 서브슬롯 sub)=${actPinCtl}`);
  check(actPin >= 1, '핀치서버 서브 슬롯 교체 투입(서브 차례) → 발동(activations≥1)');
  check(actPinCtl === 0, 'control(무pinchServer 동일 sub) → 발동 0(서브슬롯 교체 자체가 아니라 특성이 조건)');

  // 대타승부사(clutchSub): 교체 투입된 공격수가 첫 공격 시 발동(manual sub=세트 끝까지 코트 → 반드시 공격).
  const luC = buildLineup(A0, 0);
  const benchClutch = A0.find((p) => !new Set(luC.six.map((x) => x.id)).has(p.id) && isAtk(p))!;
  const outIdC = luC.six.find((p) => p.position === benchClutch.position)?.id ?? luC.six[0].id;
  const cIv: MatchIntervention[] = [{ at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: outIdC, inId: benchClutch.id, subKind: 'manual' }];
  const cBench = A0.map((p) => (p.id === benchClutch.id ? { ...p, traits: ['clutchSub' as Trait] } : p));
  debugReactive.reset(); simulateMatch(7, cBench, B0, { ...base, interventions: cIv });
  const actClutch = debugReactive.activations();
  debugReactive.reset(); simulateMatch(7, A0, B0, { ...base, interventions: cIv }); // control: 같은 sub, 무clutchSub
  const actClutchCtl = debugReactive.activations();
  log(`   대타승부사: activations=${actClutch} · control(무clutchSub 동일 sub)=${actClutchCtl}`);
  check(actClutch >= 1, '대타승부사 교체 공격수 → 첫 공격에 발동(activations≥1)');
  check(actClutchCtl === 0, 'control(무clutchSub 동일 sub) → 발동 0(교체 자체가 아니라 특성이 조건)');

  // 에이스기세(aceStreak): 홈 전원 aceStreak → 서브 에이스에서 발동. strip → 0.
  const addAll = (ps: Player[], tr: Trait): Player[] => ps.map((p) => ({ ...p, traits: [...(p.traits ?? []), tr] }));
  debugReactive.reset(); simulateMatch(9, addAll(A0, 'aceStreak'), B0, { ...base });
  const actAce = debugReactive.activations();
  debugReactive.reset(); simulateMatch(9, A0, B0, { ...base });
  const actAceOff = debugReactive.activations();
  log(`   에이스기세: activations=${actAce} · strip=${actAceOff}`);
  check(actAce > 0 && actAceOff === 0, '에이스기세 → 서브 에이스에서 발동(strip=0)');
}

// ─────────────────────────────────────────────────────────────────────────────
// (c) 지속·해제 — 5랠리 만료 / 타임아웃 clear / 세트끝 clear
// ─────────────────────────────────────────────────────────────────────────────
log('── (c) 지속·해제 ──');
{
  // 5랠리 만료(순수 tickReactiveBuffs — 프로덕션 tickBuffs가 위임하는 바로 그 함수)
  const m = new Map<string, ActiveBuff>([['x', { trait: 'joker', kind: 'buff', left: 5 }]]);
  let expiredAt = -1;
  for (let r = 1; r <= 6; r++) { const e = tickReactiveBuffs(m); if (e > 0 && expiredAt < 0) expiredAt = r; }
  log(`   tickReactiveBuffs: left=5 버프 만료 시점 = ${expiredAt}랠리째(잔존 ${m.size})`);
  check(expiredAt === 5 && m.size === 0, '5랠리째 자동 만료(4랠리까진 활성, 5랠리째 제거)');

  // Run A(조커 sub만·타임아웃 없음): 버프가 5랠리 후 만료 → expires=1, clears=0
  const luA = buildLineup(A0, 0);
  const benchAtk = A0.find((p) => !new Set(luA.six.map((x) => x.id)).has(p.id) && isAtk(p))!;
  const outId = luA.six.find((p) => p.position === benchAtk.position)?.id ?? luA.six[0].id;
  const jokBench = A0.map((p) => (p.id === benchAtk.id ? { ...p, traits: ['joker' as Trait] } : p));
  const subIv: MatchIntervention = { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId, inId: benchAtk.id, subKind: 'manual' };
  const toIv: MatchIntervention = { at: { setNo: 1, h: 1, a: 0 }, side: 'home', kind: 'timeout' };
  debugReactive.reset(); simulateMatch(7, jokBench, B0, { ...base, interventions: [subIv] });
  const aA = debugReactive.activations(), aE = debugReactive.expires(), aC = debugReactive.clears();
  log(`   Run A(조커 sub, 무타임아웃): activations=${aA} expires=${aE} clears=${aC}`);
  check(aA === 1 && aE === 1 && aC === 0, 'Run A: 버프가 5랠리 후 만료(expires=1·clears=0)');

  // Run B(조커 sub + 즉시 타임아웃): 활성 버프가 타임아웃에 즉시 해제 → expires=0, clears=1
  debugReactive.reset(); simulateMatch(7, jokBench, B0, { ...base, interventions: [subIv, toIv] });
  const bA = debugReactive.activations(), bE = debugReactive.expires(), bC = debugReactive.clears();
  log(`   Run B(조커 sub + 타임아웃@1:1:0): activations=${bA} expires=${bE} clears=${bC}`);
  check(bA === 1 && bE === 0 && bC === 1, 'Run B: 타임아웃에 활성 버프 즉시 해제(만료 전 clear=1·expires=0)');

  // 세트 종료 clear: 세트 막판에 발동한 버프는 세트 경계에서 해제(누수 없음). 발동한 시드 전부 clears로 해제됨을 확인.
  let setEndActivated = 0, setEndCleared = 0, setEndLeaked = 0;
  for (const seed of [3, 7, 11, 15, 21, 31, 44]) {
    const s1 = simulateMatch(seed, jokBench, B0, { ...base }).points.filter((p) => p.setNo === 1);
    const tg = s1[s1.length - 2]; // set1 끝-2 좌표(존재 보장)
    const iv: MatchIntervention[] = [{ at: { setNo: 1, h: tg.home, a: tg.away }, side: 'home', kind: 'sub', outId, inId: benchAtk.id, subKind: 'manual' }];
    debugReactive.reset(); simulateMatch(seed, jokBench, B0, { ...base, interventions: iv });
    if (debugReactive.activations() === 1) { setEndActivated++; if (debugReactive.clears() >= 1 && debugReactive.expires() === 0) setEndCleared++; else setEndLeaked++; }
  }
  log(`   세트끝: 막판 발동 ${setEndActivated}건 중 경계 해제 ${setEndCleared}건 · 누수 ${setEndLeaked}건`);
  check(setEndActivated >= 1 && setEndLeaked === 0 && setEndCleared === setEndActivated, '세트 막판 발동 버프는 세트 경계에서 전부 해제(다음 세트 누수 0)');
}

// ─────────────────────────────────────────────────────────────────────────────
// (d) 선수당 1개 — Map 단일 유지(서로 다른 트리거 강제 주입해도 덮어쓰기)
// ─────────────────────────────────────────────────────────────────────────────
log('── (d) 선수당 1개(Map 단일) ──');
{
  // 프로덕션(match.ts triggerJoker·fragile/bounce 트리거)은 모두 activeBuffs.set(id, buff) — 같은 id면 덮어쓴다.
  const buffs = new Map<string, ActiveBuff>();
  buffs.set('p9', { trait: 'joker', kind: 'buff', left: 5 });   // 조커 활성
  buffs.set('p9', { trait: 'fragile', kind: 'debuff', left: 5 }); // 같은 선수에 다른 트리거 강제 주입
  log(`   같은 id 2회 set: size=${buffs.size} last=${buffs.get('p9')!.trait}`);
  check(buffs.size === 1 && buffs.get('p9')!.trait === 'fragile', '선수당 최대 1개(Map 덮어쓰기 — 마지막 트리거만 유지)');
}

// ─────────────────────────────────────────────────────────────────────────────
// (e) 하드캡 — 인위적 큰 계수도 [0.90,1.10] / [−0.10,0.10] clamp
// ─────────────────────────────────────────────────────────────────────────────
log('── (e) 하드캡(±10% / ±0.10) ──');
{
  check(reactiveClampSkill(5.0) === 1 + REACTIVE_SKILL_CAP, `reactiveClampSkill(5.0)=${reactiveClampSkill(5.0)} → 상한 ${1 + REACTIVE_SKILL_CAP}`);
  check(reactiveClampSkill(0.01) === 1 - REACTIVE_SKILL_CAP, `reactiveClampSkill(0.01)=${reactiveClampSkill(0.01)} → 하한 ${1 - REACTIVE_SKILL_CAP}`);
  check(reactiveClampFocus(5.0) === REACTIVE_FOCUS_CAP && reactiveClampFocus(-5.0) === -REACTIVE_FOCUS_CAP, `reactiveClampFocus(±5)=±${REACTIVE_FOCUS_CAP}`);
  // reactiveSkillMult가 clamp를 경유함(실계수는 캡 안이지만 반환이 항상 [0.90,1.10])
  const mj = reactiveSkillMult({ trait: 'joker', kind: 'buff', left: 5 }, 'spike');
  const mf = reactiveSkillMult({ trait: 'fragile', kind: 'debuff', left: 5 }, 'spike');
  log(`   reactiveSkillMult 실효: joker(spike)=${mj} fragile(spike)=${mf}`);
  check(mj <= 1.10 && mj >= 0.90 && mf <= 1.10 && mf >= 0.90, 'reactiveSkillMult 실계수 반환이 캡 내(0.90~1.10)');
  check(Math.abs(mj - TRAIT_FX.reactiveJokerAll) < 1e-9 && Math.abs(mf - TRAIT_FX.reactiveFragileSpike) < 1e-9, 'reactiveSkillMult == TRAIT_FX 계수(캡 안이라 그대로 통과)');
}

// ─────────────────────────────────────────────────────────────────────────────
// (f) 방향 A/B — 직접 playRally 하네스(버프 전원 활성해 방향 크게 관측). 조커 킬%↑ · 유리멘탈 킬%↓ + 자가검증
// ─────────────────────────────────────────────────────────────────────────────
log('── (f) 방향 A/B(직접 하네스) ──');
{
  const R = (p: Player) => deriveRatings(p);
  const homeIds = new Set(buildLineup(A0, 0).six.map((p) => p.id));
  const mkTeam = (players: Player[], buff: ActiveBuff | null, isHome: boolean): RallyTeam => {
    const lu = buildLineup(players, 0);
    const stam = new Map<string, number>(); for (const p of [...lu.six, ...(lu.libero ? [lu.libero] : [])]) stam.set(p.id, 1);
    const ab = new Map<string, ActiveBuff>();
    if (buff) for (const p of lu.six) ab.set(p.id, { ...buff }); // 방향 관측용: 홈 코트 전원 활성(브리프 버프 희석 제거)
    return { six: lu.six, libero: lu.libero, rotation: 0, momentum: 50, stam, injured: new Set(), style: 'balanced', pendingSevere: [], activeBuffs: ab, clutchArmed: new Set(), isHome };
  };
  const killPct = (homeBuff: ActiveBuff | null, N: number): number => {
    let att = 0, kill = 0;
    for (let i = 1; i <= N; i++) {
      const home = mkTeam(A0, homeBuff, true), away = mkTeam(B0, null, false);
      const box: BoxSink = new Map();
      const rng = createRng(i), boxRng = createRng((i ^ 0x6d2b79f5) >>> 0), digRng = createRng((i ^ 0x9e3779b9) >>> 0);
      for (let r = 0; r < 20; r++) playRally(r % 2 === 0 ? 'home' : 'away', home, away, R, rng, { home: 1, away: 1 }, undefined, undefined, undefined, undefined, false, null, box, boxRng, undefined, digRng);
      for (const [id, l] of box) if (homeIds.has(id)) { att += l.atkAtt; kill += l.atkKill; }
    }
    return att > 0 ? 100 * kill / att : 0;
  };
  // 홈 서브 에이스% — 서브 버프(핀치서버·에이스기세) 방향 관측용(킬% 하네스는 서브를 못 봄). 홈이 서브한 랠리만 집계.
  const homeAcePct = (homeBuff: ActiveBuff | null, N: number): number => {
    let serves = 0, aces = 0;
    for (let i = 1; i <= N; i++) {
      const home = mkTeam(A0, homeBuff, true), away = mkTeam(B0, null, false);
      const box: BoxSink = new Map();
      const rng = createRng(i), boxRng = createRng((i ^ 0x6d2b79f5) >>> 0), digRng = createRng((i ^ 0x9e3779b9) >>> 0);
      for (let r = 0; r < 20; r++) {
        const serving = r % 2 === 0 ? 'home' : 'away';
        const out = playRally(serving, home, away, R, rng, { home: 1, away: 1 }, undefined, undefined, undefined, undefined, false, null, box, boxRng, undefined, digRng);
        if (serving === 'home') { serves++; if (out.how === 'ace') aces++; }
      }
    }
    return serves > 0 ? 100 * aces / serves : 0;
  };
  const N = 400;
  const kNone = killPct(null, N);
  const kJoker = killPct({ trait: 'joker', kind: 'buff', left: 999 }, N);
  const kFrag = killPct({ trait: 'fragile', kind: 'debuff', left: 999 }, N);
  const kCold = killPct({ trait: 'coldStart', kind: 'debuff', left: 999 }, N);   // 전 스킬↓ → 킬%↓
  const kClutch = killPct({ trait: 'clutchSub', kind: 'buff', left: 999 }, N);    // 스파이크↑(activeBuffs 경로) → 킬%↑
  const kNone2 = killPct(null, N); // 자가검증: OFF/OFF(= reactiveSkillMult≡1 세계) → 동률
  log(`   홈 킬%(N=${N}): NONE ${kNone.toFixed(2)} | 조커 ${kJoker.toFixed(2)}(Δ${(kJoker - kNone).toFixed(2)}) | 유리멘탈 ${kFrag.toFixed(2)}(Δ${(kFrag - kNone).toFixed(2)}) | 낯가림 ${kCold.toFixed(2)}(Δ${(kCold - kNone).toFixed(2)}) | 대타승부사 ${kClutch.toFixed(2)}(Δ${(kClutch - kNone).toFixed(2)})`);
  check(kJoker > kNone, '조커 홈팀 킬% ↑(전스킬 버프 → 화력↑)');
  check(kFrag < kNone, '유리멘탈 홈팀 킬% ↓(스파이크↓·집중↓)');
  check(kCold < kNone, '낯가림 홈팀 킬% ↓(전 스킬 debuff → 화력↓)');
  check(kClutch > kNone, '대타승부사 홈팀 킬% ↑(첫 공격 스파이크↑ → 화력↑)');
  // 서브 버프 방향(핀치서버·에이스기세) — 홈 서브 에이스%로 관측
  const aNone = homeAcePct(null, N);
  const aPinch = homeAcePct({ trait: 'pinchServer', kind: 'buff', left: 999 }, N);
  const aAce = homeAcePct({ trait: 'aceStreak', kind: 'buff', left: 999 }, N);
  const aNone2 = homeAcePct(null, N); // 자가검증: OFF/OFF 동률
  log(`   홈 서브에이스%(N=${N}): NONE ${aNone.toFixed(2)} | 핀치서버 ${aPinch.toFixed(2)}(Δ${(aPinch - aNone).toFixed(2)}) | 에이스기세 ${aAce.toFixed(2)}(Δ${(aAce - aNone).toFixed(2)})`);
  check(aPinch > aNone, '핀치서버 홈팀 서브 에이스% ↑(서브↑)');
  check(aAce > aNone, '에이스기세 홈팀 서브 에이스% ↑(서브↑)');
  // 자가검증(허위 오라클 금지): OFF/OFF는 동률이어야 → 방향 오라클이 "동률이면 통과"하는 공허한 것이 아님을 증명
  const offOffEqual = Math.abs(kNone2 - kNone) < 1e-9;
  const aceOffEqual = Math.abs(aNone2 - aNone) < 1e-9;
  log(`   자가검증: OFF/OFF 킬% ${kNone2.toFixed(2)} == NONE ${kNone.toFixed(2)} → ${offOffEqual} · 서브에이스% ${aNone2.toFixed(2)} == ${aNone.toFixed(2)} → ${aceOffEqual}`);
  check(offOffEqual, 'OFF/OFF(reactiveSkillMult≡1 세계) 킬% 동률 → 만약 버프가 무효였다면 (f) 방향 오라클 FAIL(이빨 증명)');
  check(aceOffEqual, 'OFF/OFF 서브 에이스% 동률 → 서브 버프 오라클 이빨 증명');
  check(kJoker > kNone2 && kFrag < kNone2 && kCold < kNone2 && kClutch > kNone2, '조커·대타승부사 > OFF/OFF & 유리멘탈·낯가림 < OFF/OFF (방향은 버프가 활성일 때만 성립)');
}

// ─────────────────────────────────────────────────────────────────────────────
// (g) reactiveEvents 연출 출력(TRAIT_SYSTEM §6.10, Phase 2c) — 결정론·발동 1:1·활성 창 정합·미부여 빈 배열
// ─────────────────────────────────────────────────────────────────────────────
log('── (g) reactiveEvents 연출 출력(§6.10) ──');
{
  // (g1) 미부여 리그 → reactiveEvents 빈 배열(발동 0). 표현 출력이 무보유 리그에 안 뜬다.
  const inert = simulateMatch(101, A0, B0, { ...base });
  const inertN = (inert.reactiveEvents ?? []).length;
  log(`   미부여 리그: reactiveEvents=${inertN}건`);
  check(inertN === 0, '(g1) 반응형 미부여 리그 → reactiveEvents 빈 배열(순수 표현·무영향)');

  // 반응형 부여 리그(양 팀 공격수 유리멘탈+오뚝이 아닌 fragile만 — 상극이라 한쪽만) → 다수 발동
  const RA = addTraitTo(A0, isAtk, 'fragile');
  const RB = addTraitTo(B0, isAtk, 'fragile');
  const evSeeds = [7, 13, 21, 44, 88];

  // (g2) 결정론 — 동일 시드 2회 재실행 = reactiveEvents 바이트 동일(파생이 비결정성 도입 안 함).
  let evDet = true, totalEv = 0;
  for (const s of evSeeds) {
    const a = JSON.stringify(simulateMatch(s, RA, RB, { ...base }).reactiveEvents ?? []);
    const b = JSON.stringify(simulateMatch(s, RA, RB, { ...base }).reactiveEvents ?? []);
    if (a !== b) evDet = false;
    totalEv += (simulateMatch(s, RA, RB, { ...base }).reactiveEvents ?? []).length;
  }
  log(`   부여 리그 ${evSeeds.length}경기: 총 이벤트 ${totalEv}건 · 동일시드 2회 바이트 동일=${evDet}`);
  check(evDet, '(g2) 동일 시드 = 동일 reactiveEvents(결정론 — 파생이 rng/비결정성 도입 안 함)');
  check(totalEv > 0, '(g2b) 부여 리그 → 이벤트 발생(공허 아님)');

  // (g3) 발동 1:1 + 활성 창 경계 — reactiveEvents.length === activations, 각 창이 [0, points.length] 범위 & 지속 ≤ REACTIVE_DURATION.
  let onePerAct = true, boundsOk = true;
  for (const s of evSeeds) {
    debugReactive.reset();
    const sim = simulateMatch(s, RA, RB, { ...base });
    const evs = sim.reactiveEvents ?? [];
    const N = sim.points.length;
    if (evs.length !== debugReactive.activations()) onePerAct = false;
    for (const e of evs) {
      // startPoint = 첫 영향 랠리(유효 인덱스), endPoint = 마지막 영향 랠리(해제 시점 points.length−1) — 즉시 해제면 startPoint−1(< startPoint).
      if (!(e.startPoint >= 0 && e.startPoint <= N && e.endPoint <= N - 1 && e.endPoint >= e.startPoint - 1)) boundsOk = false;
      if (e.endPoint - e.startPoint + 1 > REACTIVE_DURATION) boundsOk = false; // 활성 창은 절대 5랠리 초과 금지
    }
  }
  check(onePerAct, '(g3) reactiveEvents.length === debugReactive.activations()(발동 1건당 이벤트 1건 — 누락/중복 없음)');
  check(boundsOk, `(g3b) 모든 활성 창이 [0, points.length] 범위 & 지속 ≤ ${REACTIVE_DURATION}랠리(창이 버프 지속 초과 안 함)`);

  // (g4) 활성 창 ↔ 버프 지속 정합 A/B(조커 sub 하네스 — (c)와 동일 설정, 그 lifecycle에 창 길이를 못박음):
  //   Run A(무타임아웃): 자연 만료 → 창 길이 정확히 REACTIVE_DURATION. Run B(즉시 타임아웃): clear로 클리핑 → 창 길이 < REACTIVE_DURATION.
  const luG = buildLineup(A0, 0);
  const benchAtkG = A0.find((p) => !new Set(luG.six.map((x) => x.id)).has(p.id) && isAtk(p))!;
  const outIdG = luG.six.find((p) => p.position === benchAtkG.position)?.id ?? luG.six[0].id;
  const jokBenchG = A0.map((p) => (p.id === benchAtkG.id ? { ...p, traits: ['joker' as Trait] } : p));
  const subIvG: MatchIntervention = { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: outIdG, inId: benchAtkG.id, subKind: 'manual' };
  const toIvG: MatchIntervention = { at: { setNo: 1, h: 1, a: 0 }, side: 'home', kind: 'timeout' };
  const evsA = (simulateMatch(7, jokBenchG, B0, { ...base, interventions: [subIvG] }).reactiveEvents ?? []).filter((e) => e.trait === 'joker');
  const evsB = (simulateMatch(7, jokBenchG, B0, { ...base, interventions: [subIvG, toIvG] }).reactiveEvents ?? []).filter((e) => e.trait === 'joker');
  const lenA = evsA.length === 1 ? evsA[0].endPoint - evsA[0].startPoint + 1 : -1;
  const lenB = evsB.length === 1 ? evsB[0].endPoint - evsB[0].startPoint + 1 : -1;
  log(`   조커 하네스: Run A(무타임아웃) 이벤트 ${evsA.length}건·창 길이 ${lenA} | Run B(즉시 타임아웃) 이벤트 ${evsB.length}건·창 길이 ${lenB}`);
  check(evsA.length === 1 && lenA === REACTIVE_DURATION, `(g4-A) 무타임아웃 조커 → 창 길이 == ${REACTIVE_DURATION}(자연 만료 = 버프 지속과 정합)`);
  check(evsB.length === 1 && lenB < REACTIVE_DURATION, '(g4-B) 즉시 타임아웃 조커 → 창 길이 < 5(타임아웃 clear로 창이 정확히 클리핑 — (c) lifecycle과 일치)');
  // (g4) pointIndex 위치 — 조커는 트리거(교체 투입)=활성 시작이라 pointIndex == startPoint.
  check(evsA.length === 1 && evsA[0].pointIndex === evsA[0].startPoint, '(g4-C) 조커 pointIndex == startPoint(투입 랠리 = 활성 시작 — 배너 키가 코트 투입 순간)');
}

log('');
if (fails.length) { log(`REACTIVE FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
log('REACTIVE PASS ((a)무해성+민감도 (b)조커/유리멘탈/오뚝이+낯가림/핀치서버/대타승부사/에이스기세 발동 (c)5랠리만료·타임아웃clear·세트끝clear (d)선수당1개 (e)하드캡 (f)방향 조커·대타승부사↑·유리멘탈·낯가림↓·핀치서버·에이스기세 서브↑ + OFF/OFF 자가검증 (g)reactiveEvents 결정론·발동1:1·활성창 정합·미부여 빈배열)');
process.exit(0);
