// A/B 자가검증 가드 — 기량발전상(mostImproved) 선정 기준 개편 (AWARDS_SYSTEM §9, 2026-07-22).
// 개편: 점수 = impactScore(올시즌 ProdLine) − impactScore(전시즌 SeasonLine). 자격 = 비신인 ∧ 전시즌 라인 존재
//        ∧ 올시즌 matches≥MIN_IMPROVE_MATCHES(10) ∧ Δ>0. 프리뷰(집계 중)엔 null.
//
// 구성:
//   Part B (합성 엔진 A/B) — computeSeasonAwards를 손으로 구성한 입력에 돌려 4종 시나리오 + 오라클 검출력 증명.
//   Part A (실 store 다시즌) — 실제 endSeason 경로(seasonLines 적립)로 N시즌을 돌려 수상자 100%가 오라클을 만족.
//
//   npx tsx tools/_dv_mip.ts [시즌수=20]
import './_gt_mock';
import type { AwardsInput } from '../engine/awards';
import { computeSeasonAwards, impactScore, MIN_IMPROVE_MATCHES } from '../engine/awards';
import type { Player, Position, SeasonAwards } from '../types';
import type { ProdLine } from '../engine/production';

const log = (m: string) => process.stdout.write(m + '\n');
let fail = 0;
const check = (cond: boolean, pass: string, failMsg: string) => {
  if (cond) log(`PASS ${pass}`);
  else { fail++; log(`FAIL ${failMsg}`); }
};

// ─────────────────────────────────────────────────────────────────────
// 오라클(순수) — 수상 자격 사실(fact)로부터 위반 목록. Part A(실측 사실)·Part B5(주입 사실) 공용.
// ─────────────────────────────────────────────────────────────────────
interface WinnerFacts { currentImpact: number; matches: number; hasPrior: boolean; isRookie: boolean; delta: number }
function oracleViolations(f: WinnerFacts): string[] {
  const v: string[] = [];
  if (!(f.currentImpact > 0)) v.push('올시즌 생산 0');
  if (!(f.matches >= MIN_IMPROVE_MATCHES)) v.push(`matches ${f.matches.toFixed(2)}<${MIN_IMPROVE_MATCHES}`);
  if (!f.hasPrior) v.push('전시즌 라인 없음');
  if (f.isRookie) v.push('신인(상호배타 위반)');
  if (!(f.delta > 0)) v.push('Δ≤0');
  return v;
}

// ─────────────────────────────────────────────────────────────────────
// 합성 입력 빌더 (engine/awards.test.ts build() 축약 재현)
// ─────────────────────────────────────────────────────────────────────
const L = (o: Partial<ProdLine>): ProdLine =>
  ({ matches: 1, points: 0, spikes: 0, backSpikes: 0, blocks: 0, aces: 0, assists: 0, digs: 0, receives: 0, ...o });
const P = (pos: Position): Player => ({
  id: '', name: '', age: 25, position: pos, isForeign: false, height: 180,
  jump: 60, agility: 60, staminaMax: 60, staminaRegen: 60, reaction: 60, positioning: 60, focus: 60, consistency: 60, vq: 60,
  skSpike: 50, skBlock: 50, skDig: 50, skReceive: 50, skSet: 50, skServe: 50,
  xp: {}, potential: {} as Player['potential'], talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
  contract: { salary: 0, years: 1, remaining: 1, signedAtAge: 25 }, clubTenure: 1, peakAge: 28,
  career: { seasons: 1, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
});
function build(
  rows: { id: string; pos: Position; team: string; line: ProdLine }[],
  opts: Partial<AwardsInput> = {},
): AwardsInput {
  const prod = new Map(rows.map((r) => [r.id, r.line]));
  const pos = new Map(rows.map((r) => [r.id, r.pos]));
  const team = new Map(rows.map((r) => [r.id, r.team]));
  return {
    prod,
    player: (id) => (pos.has(id) ? P(pos.get(id)!) : undefined),
    teamOf: (id) => team.get(id),
    teamRank: opts.teamRank ?? new Map([['T1', 0]]),
    teamCount: opts.teamCount ?? 1,
    rookies: opts.rookies ?? new Set(),
    priorImpact: opts.priorImpact ?? new Map(),
    mostImprovedReady: opts.mostImprovedReady ?? true,
    championId: opts.championId ?? null,
    legProd: opts.legProd ?? [],
  };
}

// 구 규칙 재현(제거된 로직) — OVR델타 기반 + 후보 게이트 matches>0 뿐. 프린지 오수상 버그 재현용.
function oldRuleMostImproved(
  prod: Map<string, ProdLine>, rookies: Set<string>, improvement: Map<string, number>,
): string | null {
  const ids = [...prod.keys()].filter((id) => (prod.get(id)?.matches ?? 0) > 0); // 구 후보 게이트
  let best: string | null = null, bestVal = 0;
  for (const id of ids) {
    if (rookies.has(id)) continue;
    const d = improvement.get(id) ?? 0;
    if (d > bestVal) { bestVal = d; best = id; }
  }
  return best;
}

// ═══ Part B: 합성 엔진 A/B ═══════════════════════════════════════════
log('═══ Part B — 합성 엔진 A/B (computeSeasonAwards) ═══\n');

// B1 — 프린지(matches 0.1·OVR▲8·생산0): 구 규칙 수상 / 신 규칙 미수상
{
  const fringeLine = L({ matches: 0.1 }); // 생산 0 (핀치서브만)
  const prod = new Map([['fringe', fringeLine]]);
  const oldWin = oldRuleMostImproved(prod, new Set(), new Map([['fringe', 8]])); // OVR▲8
  const neo = computeSeasonAwards(build(
    [{ id: 'fringe', pos: 'OP', team: 'T1', line: fringeLine }],
    { priorImpact: new Map([['fringe', 0]]), mostImprovedReady: true },
  ));
  check(oldWin === 'fringe' && neo.mostImproved === null,
    `B1 프린지: 구 규칙 수상(${oldWin}) / 신 규칙 미수상 — matches 0.1<10 ∧ Δ0 봉인`,
    `B1 프린지 봉인 실패 (구=${oldWin}, 신=${neo.mostImproved?.playerId ?? null})`);
}

// B2 — 돌파(작년 소량→올해 급증): 신 규칙 수상 가능, value=Δ
{
  const cur = L({ matches: 30, points: 400 }); // 올시즌 임팩트 400
  const neo = computeSeasonAwards(build(
    [{ id: 'break', pos: 'OP', team: 'T1', line: cur }],
    { priorImpact: new Map([['break', 30]]), mostImprovedReady: true }, // 전시즌 30 → Δ=370
  ));
  check(neo.mostImproved?.playerId === 'break' && neo.mostImproved?.value === 370,
    `B2 돌파: 신 규칙 수상 break, value=${neo.mostImproved?.value} (Δ=400−30=370)`,
    `B2 돌파 수상 실패 (${neo.mostImproved?.playerId ?? null}, value=${neo.mostImproved?.value})`);
}

// B3 — 신규 외국인 OP(전시즌 라인 없음·리그 최고 생산): 미수상
{
  const neo = computeSeasonAwards(build(
    [
      { id: 'newForeign', pos: 'OP', team: 'T1', line: L({ matches: 36, points: 600 }) }, // 리그 최고, 전시즌 라인 없음
      { id: 'holdover', pos: 'OH', team: 'T1', line: L({ matches: 34, points: 300 }) },   // 전시즌 있음, Δ>0
    ],
    { priorImpact: new Map([['holdover', 100]]), mostImprovedReady: true }, // newForeign은 priorImpact 없음
  ));
  check(neo.mostImproved?.playerId === 'holdover',
    `B3 신규 외국인: 리그 최고 생산이어도 전시즌 라인 없어 미수상 → holdover 수상(${neo.mostImproved?.value})`,
    `B3 신규 외국인 봉인 실패 (수상=${neo.mostImproved?.playerId ?? null})`);
}

// B4 — 프리뷰 게이트(집계 중, ready=false): 유효 후보 있어도 null
{
  const neo = computeSeasonAwards(build(
    [{ id: 'break', pos: 'OP', team: 'T1', line: L({ matches: 30, points: 400 }) }],
    { priorImpact: new Map([['break', 30]]), mostImprovedReady: false },
  ));
  check(neo.mostImproved === null,
    'B4 프리뷰 게이트: mostImprovedReady=false(시즌 집계 중) → null',
    `B4 프리뷰 게이트 실패 (${neo.mostImproved?.playerId ?? null})`);
}

// B5 — 오라클 검출력(teeth): 각 자격 위반 fact가 위반으로 잡히고, 정상 fact는 0
{
  const good: WinnerFacts = { currentImpact: 400, matches: 30, hasPrior: true, isRookie: false, delta: 370 };
  const bads: [string, WinnerFacts][] = [
    ['생산0',   { ...good, currentImpact: 0 }],
    ['저출전',  { ...good, matches: 5 }],
    ['무전시즌', { ...good, hasPrior: false }],
    ['신인',    { ...good, isRookie: true }],
    ['Δ≤0',    { ...good, delta: 0 }],
  ];
  const goodOk = oracleViolations(good).length === 0;
  const badsOk = bads.every(([, f]) => oracleViolations(f).length > 0);
  check(goodOk && badsOk,
    `B5 오라클 teeth: 정상 fact 위반 0 · 5종 위반 fact 전부 검출(${bads.map(([n]) => n).join('/')})`,
    `B5 오라클 검출력 실패 (goodOk=${goodOk}, badsOk=${badsOk})`);
}

// B6 — 무후보/빈 입력 무크래시
{
  const empty = computeSeasonAwards(build([]));
  const allDecline = computeSeasonAwards(build(
    [{ id: 'x', pos: 'OP', team: 'T1', line: L({ matches: 30, points: 50 }) }],
    { priorImpact: new Map([['x', 200]]), mostImprovedReady: true }, // Δ<0
  ));
  check(empty.mostImproved === null && allDecline.mostImproved === null,
    'B6 무후보/빈 입력: mostImproved=null, 무크래시',
    'B6 무후보 처리 실패');
}

// ═══ Part A: 실 store 다시즌 오라클 ═══════════════════════════════════
(async () => {
  const SEASONS = Number(process.argv[2] || 20);
  log(`\n═══ Part A — 실 store ${SEASONS}시즌 (endSeason→archive, seasonLines 적립) ═══\n`);

  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, getPlayer } = await import('../data/league');
  const { currentSeasonAwards } = await import('../data/awards');
  const { leagueProduction } = await import('../data/production');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);

  G().resetSave(); G().selectTeam(my);

  let winnersChecked = 0, violations = 0;
  let previewNullOk = true; // 시즌 중(uptoDay<REF_DAY) 프리뷰 게이트 확인
  const posCount: Record<string, number> = {};
  const viMsgs: string[] = [];
  const REF_DAY = 164;

  for (let s = 0; s < SEASONS; s++) {
    // 시즌 중반 프리뷰 게이트 — 절반 시점 호출 시 mostImproved는 항상 null이어야
    const mid = currentSeasonAwards(s, Math.floor(REF_DAY / 2));
    if (mid.mostImproved !== null) previewNullOk = false;

    // 시즌 결과(내 경기) 기록 후 전체 시상 계산(endSeason이 archive에 박는 것과 동일)
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(REF_DAY);

    const aw: SeasonAwards = currentSeasonAwards(s); // 풀시즌 = endSeason이 박을 값
    const prod = leagueProduction(Number.MAX_SAFE_INTEGER);

    if (aw.mostImproved) {
      winnersChecked++;
      const w = aw.mostImproved;
      const line = prod.get(w.playerId);
      const p = getPlayer(w.playerId);
      const priorLine = p?.seasonLines?.find((l) => l.season === s - 1);
      const curImpact = line ? impactScore(line) : 0;
      const priorImpact = priorLine ? impactScore(priorLine) : 0;
      const facts: WinnerFacts = {
        currentImpact: curImpact,
        matches: line?.matches ?? 0,
        hasPrior: !!priorLine,
        isRookie: (p?.career.seasons ?? 0) === 0,
        delta: curImpact - priorImpact,
      };
      const vi = oracleViolations(facts);
      // 상호배타 — 신인상 수상자와 겹치지 않아야
      if (aw.rookie && aw.rookie.playerId === w.playerId) vi.push('신인상과 동일인');
      // value == round(Δ)
      if (w.value !== Math.round(facts.delta)) vi.push(`value ${w.value}≠round(Δ ${facts.delta.toFixed(2)})`);
      if (vi.length) { violations++; viMsgs.push(`S${s} ${w.playerId}: ${vi.join(', ')}`); }
      if (p) posCount[p.position] = (posCount[p.position] ?? 0) + 1;
    }

    G().endSeason();
  }

  log(`수상자 검사 ${winnersChecked}회 · 위반 ${violations}건`);
  if (viMsgs.length) log('  ' + viMsgs.slice(0, 10).join('\n  '));
  log(`수상자 포지션 분포(참고): ${Object.entries(posCount).map(([k, v]) => `${k}:${v}`).join(' ') || '(무)'}`);

  check(winnersChecked > 0, `A1 수상자 표본 확보 ${winnersChecked}건(오라클 비공허)`, `A1 수상자 0건 — 오라클 공허(표본 없음)`);
  check(violations === 0, `A2 수상자 100% 오라클 만족(생산>0∧matches≥10∧전시즌라인∧비신인∧Δ>0∧상호배타∧value=Δ)`, `A2 오라클 위반 ${violations}건`);
  check(previewNullOk, 'A3 시즌 중(uptoDay<REF_DAY) 프리뷰 호출 시 mostImproved=null(전 시즌)', 'A3 프리뷰 게이트 누수(집계 중 수상자 노출)');

  log(fail === 0 ? '\nALL PASS — 기량발전상 개편 오라클·A/B 무결' : `\n${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})();
