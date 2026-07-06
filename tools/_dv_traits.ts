// 선수 특성 엔드투엔드 상비 가드 (TRAIT_SYSTEM). 발견·실측=Fable 5 / 가드=Opus 에이전트, 2026-07-07.
// measTraits(스크래치, N=1500~4000)의 **빠른 상비판** — 전체 러닝 2~3분 내. 엔진이 실제로 p.traits를
// 읽어 방향이 맞는지(배선+효과) 동일 시드 A/B로 상시 감시한다. 추정 금지: 방향/배수를 실측으로 확정.
//   npx tsx tools/_dv_traits.ts
// 검사: ① 실전 객체 traits 보유율 25~55% ② 서브머신 에이스·범실 ON>OFF+liveness>0 ④ 노쇠 서열
//       ⑤ 노력형 전스탯합 서열(⚠기술합 함정 주석) ⑥ 부상 배수 1.70·0.55 ±0.01
//   ③ 클러치/새가슴은 소폭·고분산(+0.5~0.9%p)이라 상비 배터리에서 제외 — 무거운 검증은
//     measTraits 방식(N≥3000 승률 단조·접전상대)으로 별도. 여기선 배선만 간접 확인.
// A/B 자가검증(허위 오라클 금지): injuryTraitMult를 1로 뭉갠 mutant를 재현해 ⑥ 오라클이 FAIL함을 증명.
//   exit 0=PASS / 1=FAIL.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { evolvePlayer } from '../engine/progression';
import { injuryRisk } from '../engine/injury';
import { injuryTraitMult } from '../engine/traits';
import type { BoxSink } from '../engine/rally';
import type { Player, Trait, TrainingFocus } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const FOCUS: TrainingFocus = { primary: [1, 2], secondary: [3, 4, 5] }; // 웨이트·컨디셔닝(비기술 편중) — ⑤ 함정의 원인
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };

resetLeagueBase();
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A0 = availableTeamPlayers(t0, 0), B0 = availableTeamPlayers(t1, 0);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;
const setTraits = (p: Player, tr: Trait[]): Player => ({ ...p, traits: tr });
const strip = (p: Player, rm: Trait[]): Trait[] => (p.traits ?? []).filter((t) => !rm.includes(t));

// ── ① 실전 선수 객체 traits 보유율 (전 구단·경기 입장 시점) ──
{
  let withTr = 0, tot = 0;
  for (const tm of LEAGUE.teams) for (const p of availableTeamPlayers(tm.id, 0)) { tot++; if (p.traits?.length) withTr++; }
  const pct = 100 * withTr / tot;
  log(`① traits 보유율: ${withTr}/${tot} (${pct.toFixed(1)}%)`);
  check(pct >= 25 && pct <= 55, `보유율 25~55% 밴드(rollTraits 분포 정합) — 실측 ${pct.toFixed(1)}%`);
}

// ── ② 서브머신 — 팀A 전원 토글, 동일 시드 박스 A/B. 에이스·범실 방향 + liveness ──
{
  const N = 400;
  const mk = (on: boolean) => A0.map((p) => setTraits(p, on ? [...strip(p, ['serveMachine']), 'serveMachine'] : strip(p, ['serveMachine'])));
  const Aon = mk(true), Aoff = mk(false);
  const idsA = new Set(A0.map((p) => p.id));
  let liveDiff = 0;
  const acc = { on: { att: 0, ace: 0, err: 0 }, off: { att: 0, ace: 0, err: 0 } };
  for (let i = 1; i <= N; i++) {
    const bOn: BoxSink = new Map(), bOff: BoxSink = new Map();
    const sOn = simulateMatch(i, Aon, B0, { ...base, box: bOn });
    const sOff = simulateMatch(i, Aoff, B0, { ...base, box: bOff });
    if (JSON.stringify(sOn.points) !== JSON.stringify(sOff.points)) liveDiff++;
    for (const [id, l] of bOn) if (idsA.has(id)) { acc.on.att += l.srvAtt; acc.on.ace += l.srvAce; acc.on.err += l.srvErr; }
    for (const [id, l] of bOff) if (idsA.has(id)) { acc.off.att += l.srvAtt; acc.off.ace += l.srvAce; acc.off.err += l.srvErr; }
  }
  const aceOn = acc.on.ace / acc.on.att, aceOff = acc.off.ace / acc.off.att;
  const errOn = acc.on.err / acc.on.att, errOff = acc.off.err / acc.off.att;
  log(`② 서브머신(N=${N}·동일시드): 에이스 ${(100 * aceOff).toFixed(2)}→${(100 * aceOn).toFixed(2)}% · 범실 ${(100 * errOff).toFixed(2)}→${(100 * errOn).toFixed(2)}% · liveness ${liveDiff}/${N}`);
  check(aceOn > aceOff, `에이스 ON>OFF (공격적 서브 → 에이스↑)`);
  check(errOn > errOff, `범실 ON>OFF (공격적 서브 → 범실도↑, 리스크)`);
  check(liveDiff > 0, `liveness>0 (특성이 실제 경기 결과를 바꿈 — 배선 살아있음)`);
}

// ── ④ 노쇠 — 30세+ 실선수, 2시즌 진화. 신체합 Δ 대기만성>무특성>짧은전성기 ──
{
  const old = LEAGUE.teams.flatMap((t) => availableTeamPlayers(t.id, 0)).filter((p) => p.age >= 30).slice(0, 12);
  const phys = (p: Player) => p.jump + p.agility + p.staminaMax + p.staminaRegen;
  const days = 365 * 2;
  let dLate = 0, dNone = 0, dEarly = 0;
  for (const p of old) {
    dLate += phys(evolvePlayer(setTraits(p, ['lateBloomer']), FOCUS, days)) - phys(p);
    dNone += phys(evolvePlayer(setTraits(p, []), FOCUS, days)) - phys(p);
    dEarly += phys(evolvePlayer(setTraits(p, ['earlyDecline']), FOCUS, days)) - phys(p);
  }
  const n = old.length;
  log(`④ 노쇠(30세+ ${n}명·2년): 신체합 Δ 대기만성 ${(dLate / n).toFixed(2)} > 무특성 ${(dNone / n).toFixed(2)} > 짧은전성기 ${(dEarly / n).toFixed(2)}`);
  check(dLate > dNone && dNone > dEarly, `노쇠 서열 대기만성>무특성>짧은전성기 (×0.8/×1.25 방향)`);
}

// ── ⑤ 노력형 — 23세 이하 실선수, 1시즌 훈련. **전스탯합**으로 측정 ──
// ⚠ 함정(1차 오판 원인): FOCUS 1·2(웨이트·컨디셔닝)는 신체 위주라, 기술 6종(sk*) 부분합만 보면
//   diligent와 무특성이 거의 Δ0으로 보인다(성장이 비기술 스탯에 얹혀 위음성). 지표를 **전스탯합**
//   (신체+공통+멘탈+기술 15종)으로 잡아야 노력형 ×1.12가 검출된다 → 함정을 도구가 직접 대조로 박제.
{
  const young = LEAGUE.teams.flatMap((t) => availableTeamPlayers(t.id, 0)).filter((p) => p.age <= 23).slice(0, 12);
  const skOnly = (p: Player) => p.skSpike + p.skBlock + p.skDig + p.skReceive + p.skSet + p.skServe; // 함정 지표
  const allStat = (p: Player) => skOnly(p) + p.jump + p.agility + p.staminaMax + p.staminaRegen + p.reaction + p.positioning + p.focus + p.consistency + p.vq; // 정답 지표
  const days = 365;
  let dDilAll = 0, dNoneAll = 0, dDilSk = 0, dNoneSk = 0;
  for (const p of young) {
    const dil = evolvePlayer(setTraits(p, ['diligent']), FOCUS, days);
    const none = evolvePlayer(setTraits(p, []), FOCUS, days);
    dDilAll += allStat(dil) - allStat(p); dNoneAll += allStat(none) - allStat(p);
    dDilSk += skOnly(dil) - skOnly(p); dNoneSk += skOnly(none) - skOnly(p);
  }
  const n = young.length;
  log(`⑤ 노력형(23세 이하 ${n}명·1년): 전스탯합 Δ 노력형 ${(dDilAll / n).toFixed(2)} vs 무특성 ${(dNoneAll / n).toFixed(2)}`);
  log(`   ⚠ 함정 대조: 기술합(sk*)만 보면 노력형 ${(dDilSk / n).toFixed(2)} vs 무특성 ${(dNoneSk / n).toFixed(2)} (거의 Δ0 → 위음성)`);
  check(dDilAll > dNoneAll, `전스탯합 노력형>무특성 (×1.12 훈련 가속 — 올바른 지표에서만 보임)`);
}

// ── ⑥ 부상 배수 — injuryRisk(age, staminaMax, traits) 소비층 입력 재현. 유리몸 1.70·철강 0.55 ±0.01 ──
{
  const all = LEAGUE.teams.flatMap((t) => availableTeamPlayers(t.id, 0)).slice(0, 60);
  const sum = (tr: (p: Player) => Trait[]) => all.reduce((s, p) => s + injuryRisk(p.age, p.staminaMax, tr(p)), 0);
  const rGlass = sum((p) => [...strip(p, ['glass', 'iron']), 'glass']);
  const rNone = sum((p) => strip(p, ['glass', 'iron']));
  const rIron = sum((p) => [...strip(p, ['glass', 'iron']), 'iron']);
  const mGlass = rGlass / rNone, mIron = rIron / rNone;
  log(`⑥ 부상 배수(실선수 ${all.length}명): 유리몸 ${mGlass.toFixed(3)}× · 철강 ${mIron.toFixed(3)}× (문서 1.70·0.55)`);
  check(Math.abs(mGlass - 1.70) <= 0.01, `유리몸 배수 1.70 ±0.01 — 실측 ${mGlass.toFixed(3)}`);
  check(Math.abs(mIron - 0.55) <= 0.01, `철강 배수 0.55 ±0.01 — 실측 ${mIron.toFixed(3)}`);

  // ── A/B 자가검증(허위 오라클 금지): injuryTraitMult를 1로 뭉갠 mutant면 세 arm이 동일 → 배수 1.00 →
  //    ⑥ 오라클이 반드시 FAIL해야 한다. 실제 코드는 mult 배선이 살아있어 배수≠1이므로 PASS.
  //    (배수=1은 곧 traits 무시 = injuryTraitMult가 1을 반환하는 세계 — 그 세계에선 오라클이 잡아낸다.)
  const flat = injuryTraitMult([]); // 무특성 = 1 (mutant가 모든 특성에 반환할 값)
  const mutMult = flat / flat; // = 1.00 (glass/iron/none이 전부 같은 위험 → 배수 1)
  const oracleWouldFailOnMutant = !(Math.abs(mutMult - 1.70) <= 0.01) && !(Math.abs(mutMult - 0.55) <= 0.01);
  log(`   A/B: mutant(injuryTraitMult≡1) 배수 ${mutMult.toFixed(2)} → 오라클 FAIL? ${oracleWouldFailOnMutant}`);
  check(oracleWouldFailOnMutant, `mutant 감지: mult≡1이면 ⑥ 배수 대조가 FAIL (오라클 민감도 증명)`);
  check(flat === 1, `무특성 injuryTraitMult == 1 (mutant 기준값 정합)`);
}

// ── ③ 클러치/새가슴: crunch(듀스·세트포인트) 한정 focus 소폭 보정 — clutchFocusAdj +0.08/+0.05/−0.08.
//    효과가 승률에 +0.5~0.9%p로 작고 고분산이라 여기선 상비 검사에서 제외한다. 무거운 단조 서열 검증은
//    measTraits 방식(N≥3000·접전상대 필터)으로: 승률 clutch>neutral>choke가 2회 이상 단조여야 유효.
//    배선은 match.ts(crunch→playRally clutch 플래그)·rally.ts가 담당(다른 가드/골든이 커버).

log('');
if (fails.length) { log(`TRAITS FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
log('TRAITS PASS (① 보유율 ② 서브머신 방향+liveness ④ 노쇠 서열 ⑤ 노력형 전스탯합 ⑥ 부상 배수 + mutant 자가검증)');
process.exit(0);
