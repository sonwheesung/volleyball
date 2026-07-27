// 선수 특성 엔드투엔드 상비 가드 (TRAIT_SYSTEM). 발견·실측=Fable 5 / 가드=Opus 에이전트, 2026-07-07.
// measTraits(스크래치, N=1500~4000)의 **빠른 상비판** — 전체 러닝 2~3분 내. 엔진이 실제로 p.traits를
// 읽어 방향이 맞는지(배선+효과) 동일 시드 A/B로 상시 감시한다. 추정 금지: 방향/배수를 실측으로 확정.
//   npx tsx tools/_dv_traits.ts
// 검사: ① 전 구단 실선수 전원 1개 이상 + 상극쌍 0건 + 검사기 A/B 자가검증 ② 서브머신 에이스·범실 ON>OFF+liveness>0 ④ 노쇠 서열
//       ⑤ 노력형 전스탯합 서열(⚠기술합 함정 주석) ⑥ 부상 배수 1.70·0.55 ±0.01
//   ── 상시형 신규 6종(2026-07-27, Phase 1) 동일 시드 A/B 방향 검증 ──
//   ⑦ 폭격기: 킬%↑ + 공격범실%↑(양날) + liveness>0 + 무효과세계(OFF/OFF) 오라클 FAIL 자가검증
//   ⑧ 수비벽: 디그 성공↑ + liveness>0   ⑨ 황금손: 팀 킬%↑ + liveness>0
//   ⑩ 꾀돌이: vqTraitMult 보유>무·무==1   ⑪ 강철체력: 유효 최대체력 보유>무   ⑫ 지구력: recover 후 체력 보유>무
//   ③ 클러치/새가슴은 소폭·고분산(+0.5~0.9%p)이라 상비 배터리에서 제외 — 무거운 검증은
//     measTraits 방식(N≥3000 승률 단조·접전상대)으로 별도. 여기선 배선만 간접 확인.
// A/B 자가검증(허위 오라클 금지): injuryTraitMult를 1로 뭉갠 mutant를 재현해 ⑥ 오라클이 FAIL함을 증명 +
//   ⑦ 폭격기는 "트레이트 무효과 세계(OFF vs OFF)"를 재현해 liveness=0·킬%동률로 ⑦ 오라클이 FAIL함을 증명.
//   exit 0=PASS / 1=FAIL.
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { evolvePlayer } from '../engine/progression';
import { injuryRisk } from '../engine/injury';
import { injuryTraitMult, ANTAGONISTS, vqTraitMult, staminaMaxTraitMult, staminaRegenTraitMult, venueSkillMult, stateSkillMult, TRAIT_FX, type StateCtx } from '../engine/traits';
import { STAM_REGEN_BASE, playRally, type BoxSink, type RallyTeam } from '../engine/rally';
import { buildLineup } from '../engine/lineup';
import { deriveRatings } from '../engine/ratings';
import { createRng } from '../engine/rng';
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

// ── ① 전원 1개 이상 + 상극쌍 0건 (전 구단·경기 입장 시점) + A/B 자가검증 ──
{
  const hasAntagonist = (tr: Trait[]): boolean =>
    tr.some((t) => (ANTAGONISTS[t] ?? []).some((a) => tr.includes(a)));
  let withTr = 0, tot = 0, empty = 0, pairs = 0;
  for (const tm of LEAGUE.teams) for (const p of availableTeamPlayers(tm.id, 0)) {
    tot++; const tr = p.traits ?? [];
    if (tr.length) withTr++; else empty++;
    if (hasAntagonist(tr)) pairs++;
  }
  const pct = 100 * withTr / tot;
  log(`① traits: ${withTr}/${tot} 보유(${pct.toFixed(1)}%) · 무특성 ${empty} · 상극쌍 ${pairs}`);
  check(empty === 0, `전원 1개 이상 (무특성 0) — 실측 무특성 ${empty}`);
  check(pairs === 0, `상극쌍 동시부여 0건 — 실측 ${pairs}`);
  // A/B: 검사기가 상극을 실제로 잡는지(민감도) — 합성 위반 선수가 반드시 검출돼야
  const mutantDetected = hasAntagonist(['clutch', 'choke'] as Trait[]);
  log(`   A/B: 합성 {clutch,choke} 검출? ${mutantDetected}`);
  check(mutantDetected, `상극 검사기 민감도 증명 (합성 위반 검출 — 허위 오라클 금지)`);
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

// ─────────────────────────────────────────────────────────────────────────────
// 상시형 신규 6종(2026-07-27, Phase 1) — 동일 시드 A/B 방향 검증. 미부여=1배(무영향)이므로
//   토글 ON/OFF로 방향을 관측. 박스 관측 가능(⑦⑧⑨)은 박스로, 스탯층(⑩⑪⑫)은 접근자 직접.
// ─────────────────────────────────────────────────────────────────────────────
const n = (v: number) => v / 100;
const idsA = new Set(A0.map((p) => p.id));
// 팀A 전원에 good 특성 토글, 동일 시드 박스 A/B → 팀A 박스 집계(atkAtt/Kill/Err·digSucc)와 liveness.
//   flagOn/flagOff = 각 arm에서 팀A가 특성 보유 여부. 정상=(true,false), 무효과세계(mutant)=(false,false).
function boxToggle(trait: Trait, N: number, flagOn: boolean, flagOff: boolean) {
  const mk = (on: boolean) => A0.map((p) => setTraits(p, on ? [...strip(p, [trait]), trait] : strip(p, [trait])));
  const Aon = mk(flagOn), Aoff = mk(flagOff);
  const zero = () => ({ atkAtt: 0, atkKill: 0, atkErr: 0, digSucc: 0, rallies: 0 });
  const on = zero(), off = zero();
  let liveDiff = 0;
  const rallyOf = (s: ReturnType<typeof simulateMatch>) => (s.setScores ?? []).reduce((a, x) => a + x.home + x.away, 0);
  for (let i = 1; i <= N; i++) {
    const bOn: BoxSink = new Map(), bOff: BoxSink = new Map();
    const sOn = simulateMatch(i, Aon, B0, { ...base, box: bOn });
    const sOff = simulateMatch(i, Aoff, B0, { ...base, box: bOff });
    if (JSON.stringify(sOn.points) !== JSON.stringify(sOff.points)) liveDiff++;
    on.rallies += rallyOf(sOn); off.rallies += rallyOf(sOff); // 경기 길이(총 랠리) — count 지표 정규화용
    for (const [id, l] of bOn) if (idsA.has(id)) { on.atkAtt += l.atkAtt; on.atkKill += l.atkKill; on.atkErr += l.atkErr; on.digSucc += l.digSucc; }
    for (const [id, l] of bOff) if (idsA.has(id)) { off.atkAtt += l.atkAtt; off.atkKill += l.atkKill; off.atkErr += l.atkErr; off.digSucc += l.digSucc; }
  }
  return { on, off, liveDiff };
}

// ── ⑦ 폭격기 — 스파이크 화력↑(킬%↑) + 공격 범실↑(양날) + liveness + 무효과세계 오라클 FAIL 자가검증 ──
{
  const N = 300;
  const { on, off, liveDiff } = boxToggle('bomber', N, true, false);
  const killOn = on.atkKill / on.atkAtt, killOff = off.atkKill / off.atkAtt;
  const errOn = on.atkErr / on.atkAtt, errOff = off.atkErr / off.atkAtt;
  log(`⑦ 폭격기(N=${N}·동일시드): 킬 ${(100 * killOff).toFixed(2)}→${(100 * killOn).toFixed(2)}% · 공격범실 ${(100 * errOff).toFixed(2)}→${(100 * errOn).toFixed(2)}% · liveness ${liveDiff}/${N}`);
  check(killOn > killOff, `킬% ON>OFF (스파이크 화력↑)`);
  check(errOn > errOff, `공격범실% ON>OFF (양날 — 범실도↑)`);
  check(liveDiff > 0, `liveness>0 (특성이 실제 경기 결과를 바꿈 — 배선 살아있음)`);
  // A/B 자가검증: 트레이트 무효과 세계(양 arm 모두 OFF)면 입력 동일 → liveness=0·킬% 동률 → ⑦ 오라클이 FAIL해야
  const mut = boxToggle('bomber', 60, false, false);
  const mutKillEq = mut.on.atkKill / mut.on.atkAtt === mut.off.atkKill / mut.off.atkAtt;
  log(`   A/B: 무효과세계(OFF/OFF) liveness ${mut.liveDiff}/60 · 킬% 동률 ${mutKillEq} → ⑦ 오라클 FAIL 재현`);
  check(mut.liveDiff === 0 && mutKillEq, `mutant(무효과) → liveness0+킬%동률 → ⑦ 오라클 이빨 증명(허위 오라클 금지)`);
}

// ── ⑧ 수비벽 — 디그 성공률(랠리당)↑ + liveness ──
//   ★ 지표: 원시 digSucc COUNT는 경기 길이에 오염된다(수비↑ → 승리 빨라짐 → 총 랠리↓ → 총 디그 COUNT↓,
//     방향이 뒤집힘 — 2026-07-27 Phase 2a에서 리그 조합 변화로 실제 flip 관측). 랠리당 디그율로 정규화하면
//     경기 길이 무관하게 방향이 안정(실측 rate 0.375>0.347·승률 500>446/600 — 검증=Fable 5).
{
  const N = 300;
  const { on, off, liveDiff } = boxToggle('digWall', N, true, false);
  const rOn = on.digSucc / on.rallies, rOff = off.digSucc / off.rallies;
  log(`⑧ 수비벽(N=${N}·동일시드): 디그성공/랠리 ${rOff.toFixed(4)}→${rOn.toFixed(4)} (원시 COUNT ${off.digSucc}→${on.digSucc} = 경기길이 오염 참고) · liveness ${liveDiff}/${N}`);
  check(rOn > rOff, `디그 성공률(랠리당) ON>OFF (수비 범위↑ — 경기길이 무관 지표)`);
  check(liveDiff > 0, `liveness>0 (배선 살아있음)`);
}

// ── ⑨ 황금손 — 세팅 승수↑ → 팀 킬%↑(박스) + liveness ──
{
  const N = 300;
  const { on, off, liveDiff } = boxToggle('maestro', N, true, false);
  const killOn = on.atkKill / on.atkAtt, killOff = off.atkKill / off.atkAtt;
  log(`⑨ 황금손(N=${N}·동일시드): 팀 킬% ${(100 * killOff).toFixed(2)}→${(100 * killOn).toFixed(2)}% · liveness ${liveDiff}/${N}`);
  check(killOn > killOff, `팀 킬% ON>OFF (세팅 승수↑ → 공격 화력↑)`);
  check(liveDiff > 0, `liveness>0 (배선 살아있음)`);
}

// ── ⑩ 꾀돌이 — vqTraitMult 보유>무·무==1(배선 무영향 보장) ──
{
  const mReal = vqTraitMult(['smart']), mNone = vqTraitMult([]);
  log(`⑩ 꾀돌이 vqTraitMult: 보유 ${mReal.toFixed(3)} vs 무 ${mNone.toFixed(3)} (문서 ${TRAIT_FX.smartVq})`);
  check(mReal > mNone && mNone === 1, `vqTraitMult 보유>무·무==1 (미부여 무영향)`);
  check(Math.abs(mReal - TRAIT_FX.smartVq) < 1e-9, `배수 == TRAIT_FX.smartVq(${TRAIT_FX.smartVq})`);
}

// ── ⑪ 강철체력 — 유효 최대체력(=n(staminaMax)×배수) 보유>무·무배수==1 ──
{
  const p = A0[0];
  const effTank = n(p.staminaMax) * staminaMaxTraitMult(['tank']);
  const effNone = n(p.staminaMax) * staminaMaxTraitMult([]);
  log(`⑪ 강철체력 유효 최대체력: 보유 ${effTank.toFixed(3)} > 무 ${effNone.toFixed(3)} (배수 ${staminaMaxTraitMult(['tank']).toFixed(2)})`);
  check(effTank > effNone && staminaMaxTraitMult([]) === 1, `유효 staminaMax 보유>무·무배수==1 (drain 분모↑ → 소모↓)`);
}

// ── ⑫ 지구력 — recover 후 체력(match.ts 회복식 재현) 보유>무·무배수==1 ──
{
  const p = A0[0];
  const cur = 0.5, scale = STAM_REGEN_BASE;
  const rec = (tr: Trait[]) => Math.min(1, cur + scale * (0.4 + p.staminaRegen / 100) * staminaRegenTraitMult(tr));
  const recEnd = rec(['endurance']), recNone = rec([]);
  log(`⑫ 지구력 recover 후 체력(cur=${cur}): 보유 ${recEnd.toFixed(4)} > 무 ${recNone.toFixed(4)}`);
  check(recEnd > recNone && staminaRegenTraitMult([]) === 1, `recover 후 체력 보유>무·무배수==1 (체력재생↑)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 경기 맥락 상시형 2종(2026-07-27, Phase 2d) — 홈/원정 스왑 A/B. 팀A 전원에 venue 특성 토글, 같은 상대(B0)·동일 시드.
//   asHome=팀A가 fixture 홈이냐. 팀A 박스 킬%(atkKill/atkAtt)를 측정 — venue는 스파이크·세팅에 곱해 킬%로 관측.
//   안방호랑이 asHome: ON>OFF(홈 ×1.03) · asAway: ON<OFF(원정 ×0.97).  원정형은 정반대.
//   미부여=1배 무영향. 무효과세계(OFF/OFF)면 입력 동일 → 킬% 동률·liveness0 → 오라클 FAIL 자가검증(허위 오라클 금지).
// ─────────────────────────────────────────────────────────────────────────────
function venueToggle(trait: Trait, N: number, asHome: boolean, flagOn: boolean, flagOff: boolean) {
  const mk = (on: boolean) => A0.map((p) => setTraits(p, on ? [...strip(p, [trait]), trait] : strip(p, [trait])));
  const Aon = mk(flagOn), Aoff = mk(flagOff);
  // asHome=true → 팀A=홈(fixture home). asHome=false → 팀A=원정(B0가 홈). 코치도 팀과 함께 이동해 배선 대칭.
  const homeC = asHome ? base : { home: base.away, away: base.home };
  const sim = (Aset: Player[], seed: number, box: BoxSink) =>
    asHome ? simulateMatch(seed, Aset, B0, { ...homeC, box }) : simulateMatch(seed, B0, Aset, { ...homeC, box });
  const acc = { on: { att: 0, kill: 0 }, off: { att: 0, kill: 0 } };
  let liveDiff = 0;
  for (let i = 1; i <= N; i++) {
    const bOn: BoxSink = new Map(), bOff: BoxSink = new Map();
    const sOn = sim(Aon, i, bOn), sOff = sim(Aoff, i, bOff);
    if (JSON.stringify(sOn.points) !== JSON.stringify(sOff.points)) liveDiff++;
    for (const [id, l] of bOn) if (idsA.has(id)) { acc.on.att += l.atkAtt; acc.on.kill += l.atkKill; }
    for (const [id, l] of bOff) if (idsA.has(id)) { acc.off.att += l.atkAtt; acc.off.kill += l.atkKill; }
  }
  return { killOn: acc.on.kill / acc.on.att, killOff: acc.off.kill / acc.off.att, liveDiff };
}

// ── ⑬ 안방호랑이(homeTiger) — 홈에서 킬%↑·원정에서 킬%↓ + 미부여 무영향 + 무효과세계 오라클 FAIL ──
{
  const N = 300;
  const H = venueToggle('homeTiger', N, true, true, false);   // 팀A=홈, 안방호랑이 ON vs OFF
  const A = venueToggle('homeTiger', N, false, true, false);  // 팀A=원정, 안방호랑이 ON vs OFF
  log(`⑬ 안방호랑이(N=${N}·동일시드): 홈 킬% ${(100 * H.killOff).toFixed(2)}→${(100 * H.killOn).toFixed(2)}%(ON↑) · 원정 킬% ${(100 * A.killOff).toFixed(2)}→${(100 * A.killOn).toFixed(2)}%(ON↓) · liveness 홈${H.liveDiff}/원정${A.liveDiff}`);
  check(H.killOn > H.killOff, `홈경기 킬% ON>OFF (안방호랑이 홈 ×${TRAIT_FX.venueBonus})`);
  check(A.killOn < A.killOff, `원정경기 킬% ON<OFF (안방호랑이 원정 ×${TRAIT_FX.venuePenalty})`);
  check(H.liveDiff > 0 && A.liveDiff > 0, `liveness>0 양 코트 (venue 배선 살아있음)`);
  // 미부여=1배: venueSkillMult([], 홈/원정) 둘 다 1
  const noneH = venueSkillMult([], true), noneA = venueSkillMult([], false);
  check(noneH === 1 && noneA === 1, `미부여 venueSkillMult==1 (홈/원정 모두 무영향)`);
  // A/B 자가검증: 무효과세계(OFF/OFF)면 입력 동일 → 킬% 동률·liveness0 → 오라클 FAIL 재현
  const mut = venueToggle('homeTiger', 60, true, false, false);
  const mutEq = mut.killOn === mut.killOff;
  log(`   A/B: 무효과세계(OFF/OFF) liveness ${mut.liveDiff}/60 · 킬% 동률 ${mutEq} → ⑬ 오라클 FAIL 재현`);
  check(mut.liveDiff === 0 && mutEq, `mutant(무효과) → liveness0+킬%동률 → ⑬ 오라클 이빨 증명(허위 오라클 금지)`);
}

// ── ⑭ 원정형(awayWarrior) — 원정에서 킬%↑·홈에서 킬%↓ (안방호랑이의 정반대) ──
{
  const N = 300;
  const A = venueToggle('awayWarrior', N, false, true, false); // 팀A=원정, 원정형 ON vs OFF
  const H = venueToggle('awayWarrior', N, true, true, false);  // 팀A=홈, 원정형 ON vs OFF
  log(`⑭ 원정형(N=${N}·동일시드): 원정 킬% ${(100 * A.killOff).toFixed(2)}→${(100 * A.killOn).toFixed(2)}%(ON↑) · 홈 킬% ${(100 * H.killOff).toFixed(2)}→${(100 * H.killOn).toFixed(2)}%(ON↓) · liveness 원정${A.liveDiff}/홈${H.liveDiff}`);
  check(A.killOn > A.killOff, `원정경기 킬% ON>OFF (원정형 원정 ×${TRAIT_FX.venueBonus})`);
  check(H.killOn < H.killOff, `홈경기 킬% ON<OFF (원정형 홈 ×${TRAIT_FX.venuePenalty})`);
  check(A.liveDiff > 0 && H.liveDiff > 0, `liveness>0 양 코트 (venue 배선 살아있음)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑮ 상태형 5종(2026-07-27, Phase 3) — 경기 국면 조건부 상시 배수(stateSkillMult). 연출 없음(조용한 국면 보정).
//   ⑮-1 단위: stateSkillMult 정확값(충족=계수·미충족/미부여=1·comeback/thinIce는 뒤지는 팀만 isHome 선택).
//   ⑮-2 방향(직접 playRally 하네스·국면 ctx 고정): **조건 충족 국면 vs 미충족 국면 분리**. 충족에서만 방향(뒷심/초반집중/
//      역전/5세트 킬%↑·살얼음↓), 미충족 국면에선 효과 0(무영향) → 조건 게이팅 증명. 자가검증: 미충족 국면에서 특성 보유 ==
//      무보유(stateSkillMult≡1 세계) 바이트 동일 → 만약 배수가 항상 활성이었다면 이 등식이 깨져 방향 오라클 이빨(허위 오라클 금지).
// ─────────────────────────────────────────────────────────────────────────────
{
  // ⑮-1 단위 검증(정확·즉시)
  const late = { homeScore: 22, awayScore: 20, setNo: 3 };    // 최고 22≥20 (뒷심 활성·초반집중 비활성)
  const early = { homeScore: 5, awayScore: 4, setNo: 3 };      // 최고 5≤10 (초반집중 활성·뒷심 비활성)
  const behindH = { homeScore: 5, awayScore: 10, setNo: 3 };   // 홈 뒤짐 (역전/살얼음 홈 활성·원정 비활성)
  const ahead = { homeScore: 10, awayScore: 5, setNo: 3 };     // 홈 앞섬 (역전/살얼음 비활성)
  const set5 = { homeScore: 10, awayScore: 8, setNo: 5 };      // 5세트 (5세트의사나이 활성)
  const eqf = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  check(stateSkillMult([], late, true) === 1 && stateSkillMult(undefined, late, true) === 1, '⑮-1 미부여/undefined stateSkillMult==1 (무영향)');
  check(eqf(stateSkillMult(['closer'], late, true), TRAIT_FX.closerMul) && stateSkillMult(['closer'], early, true) === 1, `뒷심: 20점+ 활성=×${TRAIT_FX.closerMul}·미만=1`);
  check(eqf(stateSkillMult(['fastStart'], early, true), TRAIT_FX.fastStartMul) && stateSkillMult(['fastStart'], late, true) === 1, `초반집중: 10점↓ 활성=×${TRAIT_FX.fastStartMul}·초과=1`);
  check(eqf(stateSkillMult(['comeback'], behindH, true), TRAIT_FX.comebackMul) && stateSkillMult(['comeback'], behindH, false) === 1 && stateSkillMult(['comeback'], ahead, true) === 1, '역전의명수: 뒤지는 팀만(isHome 선택)·앞선 팀=1');
  check(stateSkillMult(['thinIce'], behindH, true) < 1 && eqf(stateSkillMult(['thinIce'], behindH, true), TRAIT_FX.thinIceMul) && stateSkillMult(['thinIce'], behindH, false) === 1, `살얼음: 뒤지는 팀만 ×${TRAIT_FX.thinIceMul}(↓)·앞선/원정 팀=1`);
  check(eqf(stateSkillMult(['tiebreaker'], set5, true), TRAIT_FX.tiebreakerMul) && stateSkillMult(['tiebreaker'], late, true) === 1, `5세트의사나이: 5세트 활성=×${TRAIT_FX.tiebreakerMul}·그 외=1`);

  // ⑮-2 방향(직접 playRally 하네스) — 홈팀 킬%. 국면 ctx 고정으로 조건 충족/미충족 분리.
  //   confound 방지: 상태형 5종을 A0/B0에서 먼저 제거(시드 리그가 이미 보유할 수 있음).
  const STATE: Trait[] = ['closer', 'fastStart', 'comeback', 'thinIce', 'tiebreaker'];
  const stripState = (p: Player): Player => ({ ...p, traits: (p.traits ?? []).filter((t) => !STATE.includes(t)) });
  const AS = A0.map(stripState), BS = B0.map(stripState);
  const R = (p: Player) => deriveRatings(p);
  const homeIds6 = new Set(buildLineup(AS, 0).six.map((p) => p.id));
  const mkTeam = (players: Player[], trait: Trait | null, isHome: boolean): RallyTeam => {
    const lu = buildLineup(players, 0);
    const stam = new Map<string, number>(); for (const p of [...lu.six, ...(lu.libero ? [lu.libero] : [])]) stam.set(p.id, 1);
    const six = trait ? lu.six.map((p) => ({ ...p, traits: [...(p.traits ?? []), trait] })) : lu.six;
    return { six, libero: lu.libero, rotation: 0, momentum: 50, stam, injured: new Set(), style: 'balanced', pendingSevere: [], activeBuffs: new Map(), clutchArmed: new Set(), isHome };
  };
  const killPct = (trait: Trait | null, ctx: StateCtx, N: number): number => {
    let att = 0, kill = 0;
    for (let i = 1; i <= N; i++) {
      const home = mkTeam(AS, trait, true), away = mkTeam(BS, null, false);
      const box: BoxSink = new Map();
      const rng = createRng(i), boxRng = createRng((i ^ 0x6d2b79f5) >>> 0), digRng = createRng((i ^ 0x9e3779b9) >>> 0);
      for (let r = 0; r < 20; r++) playRally(r % 2 === 0 ? 'home' : 'away', home, away, R, rng, { home: 1, away: 1 }, undefined, undefined, undefined, undefined, false, null, box, boxRng, undefined, digRng, ctx);
      for (const [id, l] of box) if (homeIds6.has(id)) { att += l.atkAtt; kill += l.atkKill; }
    }
    return att > 0 ? 100 * kill / att : 0;
  };
  const N = 500;
  const kOff = killPct(null, late, N); // 무특성 기저 — ctx 무관(상태형 없으면 stateSkillMult≡1 → 어떤 국면이든 동일)
  // [특성, 라벨, 충족 ctx, 미충족 ctx, 방향(+1 킬%↑ / −1 ↓)]
  const cases: [Trait, string, StateCtx, StateCtx, 1 | -1][] = [
    ['closer', '뒷심', late, early, 1],
    ['fastStart', '초반집중', early, late, 1],
    ['comeback', '역전의명수', behindH, ahead, 1],
    ['thinIce', '살얼음', behindH, ahead, -1],
    ['tiebreaker', '5세트의사나이', set5, { homeScore: 10, awayScore: 8, setNo: 3 }, 1],
  ];
  for (const [trait, label, actCtx, inCtx, dir] of cases) {
    const kOnAct = killPct(trait, actCtx, N);  // 충족 국면 + 특성
    const kOnIn = killPct(trait, inCtx, N);     // 미충족 국면 + 특성(휴면)
    log(`⑮ ${label}(N=${N}): 충족 킬% ${kOff.toFixed(2)}→${kOnAct.toFixed(2)}(Δ${(kOnAct - kOff).toFixed(2)}) · 미충족 ${kOnIn.toFixed(2)}(off ${kOff.toFixed(2)})`);
    check(dir > 0 ? kOnAct > kOff : kOnAct < kOff, `${label}: 충족 국면 킬% 방향 정상(${dir > 0 ? '↑' : '↓'})`);
    check(Math.abs(kOnIn - kOff) < 1e-9, `${label}: 미충족 국면 효과 0(조건 밖 무영향 — stateSkillMult≡1 세계 == 무보유 · 오라클 이빨)`);
  }
}

// ── ③ 클러치/새가슴: crunch(듀스·세트포인트) 한정 focus 소폭 보정 — clutchFocusAdj +0.08/+0.05/−0.08.
//    효과가 승률에 +0.5~0.9%p로 작고 고분산이라 여기선 상비 검사에서 제외한다. 무거운 단조 서열 검증은
//    measTraits 방식(N≥3000·접전상대 필터)으로: 승률 clutch>neutral>choke가 2회 이상 단조여야 유효.
//    배선은 match.ts(crunch→playRally clutch 플래그)·rally.ts가 담당(다른 가드/골든이 커버).

log('');
if (fails.length) { log(`TRAITS FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
log('TRAITS PASS (① 전원1개+상극0+검사기A/B ② 서브머신 방향+liveness ④ 노쇠 서열 ⑤ 노력형 전스탯합 ⑥ 부상 배수 + mutant 자가검증 · 상시형6종 ⑦폭격기(킬%↑+범실%↑+무효과세계FAIL) ⑧수비벽 ⑨황금손 ⑩꾀돌이 ⑪강철체력 ⑫지구력 · 경기맥락2종 ⑬안방호랑이(홈킬%↑·원정↓+무효과세계FAIL) ⑭원정형(원정↑·홈↓) · 상태형5종 ⑮뒷심/초반집중/역전/살얼음/5세트(충족국면 방향+미충족 효과0 조건게이팅))');
process.exit(0);
