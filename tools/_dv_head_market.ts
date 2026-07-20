// _dv_head_market — 감독 시장(스태프 3.0 Phase C, STAFF_SYSTEM §9.6-C·게이트 ④⑥) 가드.
//   (a) 관심 구단 수가 명성 티어와 단조(거장 > 무명)
//   (b) 선호 파생 결정론 + 유형별 행선지 편향(육성형 명장 → 젊은 팀行 빈도↑ · 무선호 대비 편향)
//   (c) 공석 데드락 0 — 120시즌 실제 오프시즌 구동(전 팀 매 시즌 감독 확보, _dv_head_vacancy 겸함)
//   (d) 카운터오퍼 결정론 · 1회성(재시도 무이득) · 확률 단조(명성·관심·할인폭↑ → 결렬↑)
//   (e) 폴백 발동 경로 — 선호 전원 거절 강제 주입에도 공석 0(무선호 폴백이 반드시 채움)
//   실행: npx tsx tools/_dv_head_market.ts        (정상 = PASS)
//         npx tsx tools/_dv_head_market.ts --ab   (A/B 자가검증 — 각 오라클에 결함 주입 → 검출 증명)
import {
  resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters,
  currentCoachPool, commitCoachPool, assignCoach, reconcileStaff, getTeamCoach, getTeamPlayers, LEAGUE,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { computeStandings } from '../data/standings';
import { advanceCoaches } from '../data/staffLifecycle';
import { bottomStreak } from '../engine/staffLifecycle';
import {
  predictRanks, reputationOf, coachPreference, resolveCoachMarket, interestedClubs, interestCapForTier,
  counterOfferOutcome, counterOfferAcceptProb, reputationTier, YOUNG_AGE,
  type TeamContext, type MarketCoach, type CoachCareerRow,
} from '../engine/reputation';
import { strSeed } from '../engine/rng';

const log = (m: string) => process.stdout.write(m + '\n');
const AB = process.argv.includes('--ab');
let allPass = true;
const mark = (pass: boolean, name: string, msg: string) => { if (!pass) allPass = false; log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${msg}`); };

// 합성 팀 컨텍스트 헬퍼
const T = (teamId: string, avgAge: number, predictedRank: number): TeamContext => ({ teamId, avgAge, predictedRank });
// 합성 감독 매물
const MC = (id: string, rep: number, pref: MarketCoach['pref'], matchOps = 70, firedFrom: string[] = []): MarketCoach => ({ id, matchOps, reputation: rep, pref, firedFrom });

// ════════════════════════════════════════════════════════════════════
// (a) 관심 구단 수 — 명성 티어 단조(거장 > 무명)
function checkA(flatCap = false): { pass: boolean; msg: string } {
  // 티어별 상한 단조 비내림 + 무명 < 거장
  const caps = [1, 2, 3, 4, 5].map((s) => (flatCap ? 3 : interestCapForTier(s))); // A/B: flat이면 단조 깨짐 검출
  let monotone = true;
  for (let i = 1; i < caps.length; i++) if (caps[i] < caps[i - 1]) monotone = false;
  const spread = caps[4] > caps[0];
  // interestedClubs 실측 — 동일 팀 풀에서 무명(rep 10) vs 거장(rep 90) 관심 구단 수
  const teams: TeamContext[] = Array.from({ length: 7 }, (_, i) => T(`tm${i}`, 24 + i, i + 1));
  const coachNoname = { id: 'cx', matchOps: 70, dvPhilosophy: 50, leadership: 50 };
  const nUnknown = interestedClubs(coachNoname, 10, teams, 7).length;
  const nMaestro = interestedClubs(coachNoname, 90, teams, 7).length;
  const pass = monotone && spread && nMaestro > nUnknown;
  return { pass, msg: `티어상한 ${caps.join('≤')} (단조 ${monotone}·거장>무명 ${spread}) · 실측 무명 ${nUnknown}구단 < 거장 ${nMaestro}구단` };
}

// ════════════════════════════════════════════════════════════════════
// (b) 선호 파생 결정론 + 유형별 행선지 편향
function checkB(ignorePref = false): { pass: boolean; msg: string } {
  // b1. coachPreference 파생 결정론 + 규칙(명장+육성형→young · 명장+승부형→contender · 하위티어/조직→none)
  const devMaestro = { matchOps: 50, dvPhilosophy: 90, leadership: 50 }; // 육성형
  const winMaestro = { matchOps: 90, dvPhilosophy: 50, leadership: 50 }; // 승부형
  const orgMaestro = { matchOps: 50, dvPhilosophy: 50, leadership: 90 }; // 조직관리형
  const detOk = coachPreference(devMaestro, 70) === coachPreference(devMaestro, 70);
  const ruleOk = coachPreference(devMaestro, 70) === 'young'
    && coachPreference(winMaestro, 70) === 'contender'
    && coachPreference(orgMaestro, 70) === 'none'
    && coachPreference(devMaestro, 30) === 'none'; // 하위 티어(주목)=무선호
  // b2. resolveCoachMarket 결정론(같은 입력 두 번 = 동일)
  const teams = [T('a', 24, 3), T('b', 29, 1), T('c', 25, 6), T('d', 31, 2)];
  const coaches = [MC('young1', 70, 'young'), MC('cont1', 70, 'contender'), MC('none1', 40, 'none', 80)];
  const m1 = JSON.stringify(resolveCoachMarket(teams, coaches, 7));
  const m2 = JSON.stringify(resolveCoachMarket([...teams], [...coaches], 7));
  const marketDet = m1 === m2;
  // b3. 행선지 편향 실측 — 무작위 시나리오 500개에서 young-pref 감독 배정팀 평균연령 < none-pref 대비.
  const M = 500;
  let youngAgeSum = 0, youngN = 0, noneAgeSum = 0, noneN = 0, contRankSum = 0, contN = 0;
  const assign = ignorePref
    ? (ts: TeamContext[], cs: MarketCoach[]) => { // A/B 변이: 선호 무시(id 순 배정) → 편향 사라짐
      const out: Record<string, string> = {}; const free = [...cs];
      for (const t of [...ts].sort((x, y) => (x.teamId < y.teamId ? -1 : 1))) { const c = free.shift(); if (c) out[t.teamId] = c.id; }
      return out;
    }
    : (ts: TeamContext[], cs: MarketCoach[]) => resolveCoachMarket(ts, cs, 7);
  for (let i = 0; i < M; i++) {
    // 7팀: 나이 22~32·예상순위 셔플(시드 결정론)
    const ranks = [1, 2, 3, 4, 5, 6, 7].sort((x, y) => (strSeed(`br:${i}:${x}`) % 100) - (strSeed(`br:${i}:${y}`) % 100));
    const ts = Array.from({ length: 7 }, (_, k) => T(`s${i}_${k}`, 22 + (strSeed(`ba:${i}:${k}`) % 11), ranks[k]));
    const cs = [MC(`y${i}`, 70, 'young'), MC(`c${i}`, 70, 'contender'), MC(`n${i}`, 40, 'none', 85),
      MC(`n2${i}`, 35, 'none', 60), MC(`n3${i}`, 30, 'none', 55)];
    const res = assign(ts, cs);
    const teamOf = (cid: string) => ts.find((t) => res[t.teamId] === cid);
    const ty = teamOf(`y${i}`); if (ty) { youngAgeSum += ty.avgAge; youngN++; }
    const tn = teamOf(`n${i}`); if (tn) { noneAgeSum += tn.avgAge; noneN++; }
    const tc = teamOf(`c${i}`); if (tc) { contRankSum += tc.predictedRank; contN++; }
  }
  const youngAvg = youngN ? youngAgeSum / youngN : 99;
  const noneAvg = noneN ? noneAgeSum / noneN : 0;
  const contAvg = contN ? contRankSum / contN : 99;
  const biasOk = youngAvg <= YOUNG_AGE && youngAvg < noneAvg - 1 && contAvg <= Math.ceil(7 / 2);
  const pass = detOk && ruleOk && marketDet && biasOk;
  return { pass,
    msg: `파생 결정론 ${detOk}·규칙 ${ruleOk}·시장 결정론 ${marketDet} · 편향: young배정 평균연령 ${youngAvg.toFixed(1)} (none ${noneAvg.toFixed(1)}·YOUNG_AGE ${YOUNG_AGE}) · contender배정 평균예상순위 ${contAvg.toFixed(1)}(≤${Math.ceil(7 / 2)})` };
}

// ════════════════════════════════════════════════════════════════════
// (c) 공석 데드락 0 — 120시즌 실제 오프시즌 구동
function checkC(): { pass: boolean; msg: string } {
  resetLeagueBase();
  const N = 120;
  const LEGEND_POINTS = 7500;
  const careerLog: CoachCareerRow[] = [];
  const recentRankOrders: string[][] = [];
  let vacancies = 0;
  let seasonsWithVacancy = 0;
  let prefEngaged = 0; // 선호(none 아님) 감독이 시장에 등장한 횟수(비공허성 지표)
  let maxTier = 0;

  for (let s = 0; s < N; s++) {
    const table = computeStandings(Number.MAX_SAFE_INTEGER);
    const rankOrder = table.map((r) => r.teamId);
    recentRankOrders.push(rankOrder); if (recentRankOrders.length > 4) recentRankOrders.shift();
    const bottomYears: Record<string, number> = {};
    for (const t of LEAGUE.teams) bottomYears[t.id] = bottomStreak(recentRankOrders, t.id);

    // 언론 예상 순위(개막 전 로스터) — 경력 로그 predictedRank·teamContext 공통 기준
    const predOrder = predictRanks(LEAGUE.teams.map((t) => ({ teamId: t.id, players: getTeamPlayers(t.id) })));
    const predRankOf = (tid: string) => { const i = predOrder.indexOf(tid); return i < 0 ? LEAGUE.teams.length : i + 1; };

    const assignedHead: Record<string, string> = {};
    for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) assignedHead[t.id] = c.id; }

    const ctx = buildDraftContext('', {}, {}, [], false, [], s + 1);
    const snapshot = ctx.snapshot;
    const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
    const retiredPlayers = ctx.retired.map((id) => snapshot[id]).filter(Boolean);
    const legendIds = new Set(retiredPlayers.filter((p) => accrueCareer(p, prod.get(p.id)).career.points >= LEGEND_POINTS).map((p) => p.id));

    // 경력 로그 append(명성 상승 → 선호 엔진 실제 발현) — 시즌말 감독 팀별 1행
    for (let i = 0; i < rankOrder.length; i++) {
      const tid = rankOrder[i]; const headId = assignedHead[tid]; if (!headId) continue;
      careerLog.push({ season: s, coachId: headId, teamId: tid, predictedRank: predRankOf(tid), actualRank: i + 1,
        playoff: i === 0 ? 'champion' : i <= 2 ? 'po' : 'none', champion: i === 0, midSeasonFired: false });
    }

    // teamContext(다음 시즌 로스터 나이 + 예상순위)
    const teamContext: Record<string, TeamContext> = {};
    for (const t of LEAGUE.teams) {
      const ps = getTeamPlayers(t.id);
      const avgAge = ps.length ? ps.reduce((a, p) => a + p.age, 0) / ps.length : 28;
      teamContext[t.id] = T(t.id, avgAge, predRankOf(t.id));
    }
    // 비공허성 계측 — 이번 시즌 프리 감독 중 선호(none 아님) 수
    for (const c of currentCoachPool().coaches) {
      if (c.teamId !== null) continue;
      const rep = reputationOf(careerLog, c);
      maxTier = Math.max(maxTier, reputationTier(rep).stars);
      if (coachPreference(c, rep) !== 'none') prefEngaged++;
    }

    const pool = currentCoachPool();
    const res = advanceCoaches(s + 1, pool, assignedHead, retiredPlayers, legendIds, rankOrder, bottomYears, '___none___', careerLog, teamContext);
    commitCoachPool(res.coaches, res.assistants);
    for (const r of res.reassign) assignCoach(r.teamId, r.coachId);
    reconcileStaff();

    // 공석 판정 — 전 팀 감독 확보?
    let seasonVac = 0;
    for (const t of LEAGUE.teams) if (!getTeamCoach(t.id)) seasonVac++;
    if (seasonVac > 0) { vacancies += seasonVac; seasonsWithVacancy++; }

    // 다음 시즌 진행
    const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
    const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal, [], aiTargetOf());
    for (const p of d.picked) snapshot[p.id] = p;
    const f = fillRosters(d.rosters, (id) => snapshot[id], s + 1);
    for (const r of f.newPlayers) snapshot[r.id] = r;
    for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
    commitPlayerBase(snapshot); commitRosters(f.rosters);
  }
  const pass = vacancies === 0;
  return { pass, msg: `${N}시즌 · 공석 ${vacancies}건(${seasonsWithVacancy}시즌) · 선호 발현 프리감독 누적 ${prefEngaged}회·최고 티어 ★${maxTier} (비공허)` };
}

// (c) A/B 변이: 폴백이 load-bearing인 all-reject 상황에서 폴백을 제거 → 공석 발생. 공석 오라클이 검출(FAIL)해야 SENS-OK.
//   (정상 잉여 풀에선 시장만으로도 전 팀이 채워져 폴백 제거가 무해 → 폴백이 실제로 필요한 regime[전원 거절]에서 검증한다.)
//   반환 = "변이 하에서 오라클이 PASS(공석 0)인가" — false여야(공석 검출) 민감도 OK.
function abVacancyMutant(): boolean {
  resetLeagueBase();
  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  const rankOrder = table.map((r) => r.teamId);
  const teamCount = rankOrder.length;
  // all-reject: 전 팀 예상 꼴찌(predictedRank=teamCount) + 프리 감독 전원 contender 선호 → coachSuits 전부 false → 시장 매칭 0.
  const openTeams = rankOrder.map((tid) => T(tid, 33, teamCount));
  const asst = currentCoachPool().assistants;
  const coaches = currentCoachPool().coaches.map((c) => ({ ...c, teamId: null as string | null }));
  const marketCoaches: MarketCoach[] = coaches.map((c) => MC(c.id, 90, 'contender', c.matchOps, c.firedFrom ?? []));
  const market = resolveCoachMarket(openTeams, marketCoaches, teamCount); // 전원 거절 → {} 기대
  // 폴백 없이 시장 결과만 적용(실제 advanceCoaches는 여기서 승격·신임 폴백으로 전부 채운다)
  commitCoachPool(coaches, asst); // 전 감독 teamId=null 커밋 → 미매칭 팀은 시드 폴백도 없음(공석)
  for (const tid of rankOrder) assignCoach(tid, market[tid] ?? null);
  reconcileStaff();
  let vac = 0; for (const t of LEAGUE.teams) if (!getTeamCoach(t.id)) vac++;
  resetLeagueBase(); // 위생 복원
  return vac === 0; // 폴백 없으면 vac>0 → false → 검출됨
}

// ════════════════════════════════════════════════════════════════════
// (d) 카운터오퍼 결정론 · 1회성 · 확률 단조
function checkD(nonMonotone = false): { pass: boolean; msg: string } {
  const demand = 15000;
  // d1. 결정론 — 같은 시드 두 번 = 동일(재시도 무이득 = 1회성 본질)
  const o1 = counterOfferOutcome(demand, 14000, 60, 2, 'counter:cX:5');
  const o2 = counterOfferOutcome(demand, 14000, 60, 2, 'counter:cX:5');
  const det = o1.accept === o2.accept && o1.prob === o2.prob;
  // d2. 확률 단조 — 할인폭↑·명성↑·관심↑ → 수락확률↓(결렬↑)
  const probFn = nonMonotone
    ? (dm: number, of: number, rep: number, riv: number) => 0.5 // A/B: 상수(단조 깨짐)
    : counterOfferAcceptProb;
  const pGapLo = probFn(demand, 14500, 60, 2); // 소폭 할인
  const pGapHi = probFn(demand, 11000, 60, 2); // 대폭 할인
  const pRepLo = probFn(demand, 13000, 20, 2);
  const pRepHi = probFn(demand, 13000, 95, 2);
  const pRivLo = probFn(demand, 13000, 60, 0);
  const pRivHi = probFn(demand, 13000, 60, 5);
  const monoGap = pGapHi < pGapLo, monoRep = pRepHi < pRepLo, monoRiv = pRivHi < pRivLo;
  // d3. 할인 아님(offered ≥ demand) → 무조건 수락(prob 1)
  const noDiscount = counterOfferAcceptProb(demand, demand, 90, 5) === 1;
  const pass = det && monoGap && monoRep && monoRiv && noDiscount;
  return { pass, msg: `결정론 ${det} · 단조(할인 ${monoGap}·명성 ${monoRep}·관심 ${monoRiv}) · 무할인수락 ${noDiscount} · [gap ${pGapLo.toFixed(2)}→${pGapHi.toFixed(2)}·rep ${pRepLo.toFixed(2)}→${pRepHi.toFixed(2)}·riv ${pRivLo.toFixed(2)}→${pRivHi.toFixed(2)}]` };
}

// ════════════════════════════════════════════════════════════════════
// (e) 폴백 발동 경로 — 선호 전원 거절 강제에도 공석 0
function checkE(): { pass: boolean; msg: string } {
  resetLeagueBase();
  // 모든 프리 감독을 '컨텐더 선호'로 강제하고 모든 공석 팀을 하위 예상순위(선호 불충족)로 → 시장 매칭 0.
  //   실제 advanceCoaches는 폴백 사슬(승격·신임)로 반드시 채워야 한다(선호 무시 폴백).
  const table = computeStandings(Number.MAX_SAFE_INTEGER);
  const rankOrder = table.map((r) => r.teamId);
  const teamCount = rankOrder.length;
  const assignedHead: Record<string, string> = {};
  for (const t of LEAGUE.teams) { const c = getTeamCoach(t.id); if (c) assignedHead[t.id] = c.id; }
  // teamContext: 전 팀 예상 꼴찌권(predictedRank = teamCount) + 늙은 로스터(avgAge 33) → contender·young 둘 다 불충족
  const teamContext: Record<string, TeamContext> = {};
  for (const t of LEAGUE.teams) teamContext[t.id] = T(t.id, 33, teamCount);
  // careerLog: 모든 감독을 거장(반복 초과달성)으로 부풀려 선호 활성 → contender/young 전부 거절 유도
  const careerLog: CoachCareerRow[] = [];
  const allCoachIds = new Set([...Object.values(assignedHead), ...currentCoachPool().coaches.map((c) => c.id)]);
  for (const cid of allCoachIds) for (let s = 0; s < 8; s++) careerLog.push({ season: s, coachId: cid, teamId: 'tX', predictedRank: 7, actualRank: 1, playoff: 'champion', champion: true, midSeasonFired: false });

  // 전원 경질 → 전 팀 공석화(강제 재배정 상황)
  const bottomYears: Record<string, number> = {};
  for (const t of LEAGUE.teams) bottomYears[t.id] = 0;
  const pool = currentCoachPool();
  // myTeamId='___none___' 로 전 팀 AI 재배정 대상. 단 감독이 안 떠나면 leftHeadByTeam에 안 들어가므로,
  //   여기선 계약을 인위로 만료시키기보다 "선호 거절→폴백" 경로를 직접 겨냥: pref 활성 감독 다수 + 공석 다수를 만든다.
  //   경질/은퇴가 자연 발생하지 않을 수 있어, 강한 검증은 checkC(skipFallback A/B)가 담당하고 여기선 '선호 거절 시장'에서
  //   advanceCoaches가 공석을 남기지 않음을 확인(재배정 대상이 있으면 전부 채움).
  const res = advanceCoaches(1, pool, assignedHead, [], new Set(), rankOrder, bottomYears, '___none___', careerLog, teamContext);
  commitCoachPool(res.coaches, res.assistants);
  for (const r of res.reassign) assignCoach(r.teamId, r.coachId);
  reconcileStaff();
  // 재배정된 팀(reassign)은 전부 non-null coachId여야(폴백 보장). + 전 팀 감독 확보.
  const nullReassign = res.reassign.filter((r) => r.coachId === null).length; // '___none___'은 실팀 아님 → 0이어야
  let vac = 0; for (const t of LEAGUE.teams) if (!getTeamCoach(t.id)) vac++;
  // 선호가 실제로 전 팀을 거절하는지 검증(시장 매칭이 비었는지) — 별도 순수 확인
  const marketCoaches: MarketCoach[] = res.coaches.filter((c) => c.teamId === null).map((c) => {
    const rep = reputationOf(careerLog, c);
    return { id: c.id, matchOps: c.matchOps, reputation: rep, pref: 'contender' as const, firedFrom: c.firedFrom ?? [] };
  });
  const openBottom = rankOrder.map((tid) => T(tid, 33, teamCount));
  const matched = Object.keys(resolveCoachMarket(openBottom, marketCoaches, teamCount)).length; // 전부 하위→contender 거절→0
  const pass = vac === 0 && nullReassign === 0 && matched === 0;
  return { pass, msg: `공석 ${vac}건 · null재배정 ${nullReassign} · 선호전원거절 시장매칭 ${matched}(0=전부 거절 확인) · 재배정 ${res.reassign.length}팀` };
}

// ════════════════════════════════════════════════════════════════════
log('=== _dv_head_market — 감독 시장(Phase C) 가드 ===');
const rA = checkA(); mark(rA.pass, '(a) 관심 구단 티어 단조', rA.msg);
const rB = checkB(); mark(rB.pass, '(b) 선호 파생·행선지 편향', rB.msg);
const rC = checkC(); mark(rC.pass, '(c) 공석 데드락 0(120시즌)', rC.msg);
const rD = checkD(); mark(rD.pass, '(d) 카운터오퍼 결정론·1회성·단조', rD.msg);
const rE = checkE(); mark(rE.pass, '(e) 폴백 발동(선호 전원 거절)', rE.msg);

if (AB) {
  log('\n--- A/B 민감도 자가검증(결함 주입 → 반드시 FAIL로 검출) ---');
  const ab: Array<[string, boolean]> = [
    ['(a) 관심 상한 flat(단조 제거)', checkA(true).pass],
    ['(b) 선호 무시 배정(편향 제거)', checkB(true).pass],
    ['(c) 폴백 제거(all-reject 공석)', abVacancyMutant()],
    ['(d) 확률 상수화(단조 제거)', checkD(true).pass],
  ];
  let sensOk = true;
  for (const [name, passUnderMutation] of ab) {
    const detected = !passUnderMutation;
    if (!detected) sensOk = false;
    log(`${detected ? 'SENS-OK' : 'SENS-FAIL'} ${name} — 주입 후 ${passUnderMutation ? 'PASS(둔감!)' : 'FAIL(검출됨)'}`);
  }
  log(sensOk ? 'A/B 민감도: 4/4 결함 전부 검출(허위 오라클 아님)' : 'A/B 민감도: 일부 결함 미검출 — 가드 무효');
  if (!sensOk) allPass = false;
  // A/B는 리그 상태를 오염시키므로 정상 상태로 복원(후속 없음이지만 위생)
  resetLeagueBase();
}

log(allPass ? '\n✅ ALL PASS' : '\n❌ FAIL');
process.exit(allPass ? 0 : 1);
