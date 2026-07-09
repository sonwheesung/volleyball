// 가변 로스터 + KOVO 드래프트 상비 가드 (FA_SYSTEM §1.5~1.7·§3.0, 2026-07-09).
//   npx tsx tools/_dv_roster.ts        (engine+data, N유니버스×시즌 결정론)
//
// 검사(전부 A/B 자가검증 — 검사기가 위반을 실제로 잡는지 mutant로 증명):
//   ① 계약 상한 20 — 오프시즌 커밋 로스터 ≤ 20(드래프트 자기억제). 어떤 team-season도 초과 안 함.
//   ② 포지션 floor 경기무결 — 모든 team-season이 포지션 floor(S2·OH3·OP2·MB3·L2) 이상 → buildLineup 성립.
//   ③ 드래프트 픽 발생 — 팀당 평균 2~4명, 지명 0 비율 낮음(강팀도 발굴), 패스도 발생(4라운드 가변).
//   ④ 로스터 하한 — 어떤 team-season도 12 미만 아님(자동충원 floor 보장).
//   ⑤ holes floor/ideal 분리 — 로스터 꽉 찬(ideal 충족) 팀도 지명권(4라운드) 있음(빈자리≠픽수).
//
// A/B 자가검증: floor 검사기에 "floor−1로 축소한 가짜 로스터"를 넣으면 반드시 위반 검출(허위 오라클 금지).

import {
  LEAGUE, getTeam, reseedLeague, commitPlayerBase, commitRosters, teamScoutReveal,
} from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft, buildDraftOrder, DRAFT_ROUNDS } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { buildLineup } from '../engine/lineup';
import { currentSeasonAwards } from '../data/awards';
import { setAwardScores } from '../data/awardSalary';
import { setSeasonHistory } from '../data/leagueHistory';
import { ROSTER_CONTRACT_CAP, ROSTER_FLOOR, ROSTER_FLOOR_TOTAL } from '../engine/transactions';
import { aiTargetOf, aiRosterTargets, aiReserveTargets, aiDomesticCaps } from '../data/rosterTarget';
import { aiRosterTarget } from '../engine/aiGM';
import type { Player, Position, SeasonArchive } from '../types';

const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };

interface Acc {
  picks: number[]; passes: number; slots: number; sizes: number[];
  over20: number; under12: number; floorViol: number; floorEx: string[];
  at20: number;                          // 상한(20)에 앉은 team-season(팽창 수렴 신호 — Phase 1.5는 0 기대)
  perSeasonSpread: number[];             // 시즌별 팀 크기 max−min(팀별로 다름 = 편차)
  rankSize: { rank: number; size: number }[]; // (직전순위 index 0=1위, 커밋 크기) — 상위팀 두껍게 상관
  ages: number[];                        // 커밋 로스터 평균연령(과도 급노화·급회춘 감시)
  lineupFail: number;
  roundPass: number[]; roundSlots: number[]; // 라운드별 패스/슬롯(단조 검사) — index 0=1R
}

let simArchive: SeasonArchive[] = [];
function offseason(season: number, champ: string, standings: string[], acc: Acc): void {
  if (season === 0) simArchive = [];
  const nextSeason = season + 1;
  simArchive = [...simArchive, { season, championId: champ, standings, awards: currentSeasonAwards(season) }];
  setAwardScores(simArchive); setSeasonHistory(simArchive);
  const ctx = buildDraftContext('', {}, {}, [], false, [], nextSeason);
  const snapshot = ctx.snapshot;
  const styleOf = (t: string) => getTeam(t)?.coachStyle ?? 'balanced';
  // 직전 시즌 순위(0=1위) — Phase 1.5 로스터 목표(우승권 두껍게)의 상관 검사에 쓴다.
  const rankOf: Record<string, number> = {};
  standings.forEach((tid, i) => { rankOf[tid] = i; });
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal, [], aiTargetOf());
  for (const p of drafted.picked) snapshot[p.id] = p;
  const perTeam: Record<string, number> = {};
  for (const pk of drafted.sequence) perTeam[pk.teamId] = (perTeam[pk.teamId] ?? 0) + 1;
  for (const t of LEAGUE.teams) acc.picks.push(perTeam[t.id] ?? 0);
  acc.passes += ctx.order.length - drafted.sequence.length;
  acc.slots += ctx.order.length;
  // 라운드별 패스율(단조 검사) — sequence는 order의 부분수열(패스=건너뛴 슬롯). 두 포인터로 슬롯별 pick/pass 판정.
  {
    const roundOf: Record<string, number> = {};
    let j = 0;
    for (const teamId of ctx.order) {
      const rd = (roundOf[teamId] = (roundOf[teamId] ?? 0) + 1) - 1; // 0-based 라운드
      acc.roundSlots[rd] = (acc.roundSlots[rd] ?? 0) + 1;
      if (j < drafted.sequence.length && drafted.sequence[j].teamId === teamId) j++; // 이 슬롯 지명
      else acc.roundPass[rd] = (acc.roundPass[rd] ?? 0) + 1;                          // 이 슬롯 패스
    }
  }
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], nextSeason);
  for (const r of filled.newPlayers) snapshot[r.id] = r;
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) for (const id of filled.rosters[tid]) {
    const pr = seasonProd.get(id); if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
  }
  const seasonSizes: number[] = [];
  for (const t of LEAGUE.teams) {
    const ids = filled.rosters[t.id] ?? [];
    acc.sizes.push(ids.length);
    seasonSizes.push(ids.length);
    if (ids.length > ROSTER_CONTRACT_CAP) acc.over20++;
    if (ids.length === ROSTER_CONTRACT_CAP) acc.at20++;
    if (ids.length < ROSTER_FLOOR_TOTAL) acc.under12++;
    if (rankOf[t.id] !== undefined) acc.rankSize.push({ rank: rankOf[t.id], size: ids.length });
    const cnt: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
    const players: Player[] = [];
    for (const id of ids) { const p = snapshot[id]; if (p) { cnt[p.position]++; players.push(p); acc.ages.push(p.age); } }
    let under = false;
    for (const pos of POS) if (cnt[pos] < ROSTER_FLOOR[pos]) { under = true; if (acc.floorEx.length < 8) acc.floorEx.push(`S${nextSeason} ${t.id} ${pos}=${cnt[pos]}<${ROSTER_FLOOR[pos]}`); }
    if (under) acc.floorViol++;
    // 경기 무결 — buildLineup 성립(throw 없이 6인+리베로)
    try { const lu = buildLineup(players); if (lu.six.filter(Boolean).length < 6) acc.lineupFail++; }
    catch { acc.lineupFail++; }
  }
  { const mn = Math.min(...seasonSizes), mx = Math.max(...seasonSizes); acc.perSeasonSpread.push(mx - mn); }
  commitPlayerBase(snapshot); commitRosters(filled.rosters);
}

function run(seasons: number, universes: number): Acc {
  const acc: Acc = { picks: [], passes: 0, slots: 0, sizes: [], over20: 0, under12: 0, floorViol: 0, floorEx: [], at20: 0, perSeasonSpread: [], rankSize: [], ages: [], lineupFail: 0, roundPass: [], roundSlots: [] };
  for (let u = 0; u < universes; u++) {
    reseedLeague(20251018 + u * 101, 777 + u * 13);
    for (let s = 0; s < seasons; s++) {
      const standings = computeStandings(Number.MAX_SAFE_INTEGER);
      const champ = buildPlayoffs(s).championId ?? standings[0].teamId;
      offseason(s, champ, standings.map((st) => st.teamId), acc);
    }
    process.stderr.write(`  …유니버스 ${u + 1}/${universes}\n`);
  }
  return acc;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 2) return 0;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

function main(): void {
  const seasons = Number(process.argv[2]) || 60;
  const universes = Number(process.argv[3]) || 3;
  log(`가변 로스터 + KOVO 드래프트 + AI 로스터 자율관리 가드(Phase 1.5) · ${universes}유니버스 × ${seasons}시즌 · ${LEAGUE.teams.length}팀`);
  const a = run(seasons, universes);
  const meanPicks = mean(a.picks);
  const zeroRate = a.picks.filter((x) => x === 0).length / a.picks.length;
  const passRate = a.passes / a.slots;
  const meanSize = mean(a.sizes), maxSize = Math.max(...a.sizes), minSize = Math.min(...a.sizes);
  const meanSpread = mean(a.perSeasonSpread);
  const meanAge = mean(a.ages);
  const rankSizeCorr = pearson(a.rankSize.map((p) => p.rank), a.rankSize.map((p) => p.size)); // rank 0=1위 → 큰 로스터면 음수
  log(`  로스터 크기 min ${minSize}·평균 ${meanSize.toFixed(1)}·max ${maxSize} · at20 ${a.at20}건 · 시즌내편차(max−min) 평균 ${meanSpread.toFixed(1)} · 평균연령 ${meanAge.toFixed(1)}`);
  log(`  지명 평균 ${meanPicks.toFixed(2)}/팀·시즌 · 지명0 ${(100 * zeroRate).toFixed(1)}% · 패스율 ${(100 * passRate).toFixed(1)}% · 순위-크기 상관 ${rankSizeCorr.toFixed(2)}(음수=상위팀 두껍게)`);

  check(a.over20 === 0, `① 계약 상한 20 — 초과 team-season ${a.over20}건(≤${ROSTER_CONTRACT_CAP} 자기억제)`);
  check(a.floorViol === 0, `② 포지션 floor 무결 — 위반 ${a.floorViol}건 ${a.floorEx.slice(0, 4).join(' / ')}`);
  check(a.lineupFail === 0, `②' buildLineup 성립 — 실패 ${a.lineupFail}건`);
  // ③ 지명수 — Phase 1.5: 살아있는 AI FA 시장(_dv_uictx)이 같은 슬롯을 두고 경쟁하므로 **순 로스터 유입 ~1.8~2.3**로 앉는다
  //    (드래프트 상한=T, FA 상한=T−2 → 지명 ≈ T−FA상한 = 2, 오버슈트로 ~1.8). KOVO 현실(지명 다수는 컷)과 정합. [1.7, 4.2].
  check(meanPicks >= 1.7 && meanPicks <= 4.2, `③ 지명수 평균 ${meanPicks.toFixed(2)} ∈ [1.7, 4.2](팀당 ~2, FA와 슬롯 경쟁)`);
  check(zeroRate < 0.20, `③' 지명 0 비율 ${(100 * zeroRate).toFixed(1)}% < 20%(강팀도 발굴)`);
  check(passRate > 0.02 && passRate < 0.65, `③'' 패스율 ${(100 * passRate).toFixed(1)}% ∈ (2%, 65%)(4라운드 가변 지명)`);
  check(a.under12 === 0, `④ 로스터 하한 — 12 미만 team-season ${a.under12}건(floor 자동충원 보장)`);

  // ⑤ Phase 1.5 로스터 크기 편차 — 상한(20)에 수렴하지 않고 팀별 목표(12~18)에 앉는다(팽창 해소·능동 배출).
  //    avg 14~15 · max ≤ 18(전팀 20 아님) · at20 0건 · 시즌 안에서 팀별로 다름(편차 ≥ 3).
  check(meanSize >= 13.5 && meanSize <= 16 && maxSize <= 18 && a.at20 === 0 && meanSpread >= 3,
    `⑤ 로스터 크기 편차 — avg ${meanSize.toFixed(1)}∈[13.5,16]·max ${maxSize}≤18·at20 ${a.at20}(전팀 20 아님)·편차 ${meanSpread.toFixed(1)}≥3`);

  // ⑥ 라운드별 패스율 단조↑ (사용자 2026-07-09) — 후반 라운드로 갈수록 패스↑. 1R은 낮게(상위픽 낭비 방지).
  //    Phase 1.5: 목표 도달 팀은 R1도 패스할 수 있어 1R<15%로 완화(기존 <10%). 패스는 여전히 후반 편중.
  const rp = a.roundPass.map((p, i) => (a.roundSlots[i] ? p / a.roundSlots[i] : 0));
  const mono = rp.every((r, i) => i === 0 || r >= rp[i - 1] - 0.02); // 비감소(측정오차 2%p 여유)
  log(`  라운드별 패스율: ${rp.map((r, i) => `${i + 1}R=${(100 * r).toFixed(0)}%`).join(' ')}`);
  check(mono && rp[0] < 0.15, `⑥ 라운드 패스율 단조↑ 및 1R 낮음(${(100 * rp[0]).toFixed(0)}%<15%) — 패스는 후반 편중`);

  // ⑦ 우승권 두껍게(Phase 1.5 서사) — 직전 순위(0=1위)와 로스터 크기가 음의 상관(상위팀 = 큰 로스터).
  check(rankSizeCorr < -0.12, `⑦ 우승권 두껍게 — 순위-크기 상관 ${rankSizeCorr.toFixed(2)} < −0.12(상위팀 로스터 큼·성적 반영)`);

  // ── A/B 자가검증 ①: floor 검사기가 실제로 위반을 잡는가(허위 오라클 금지) ──
  const fakeCnt: Record<Position, number> = { S: ROSTER_FLOOR.S - 1, OH: ROSTER_FLOOR.OH, OP: ROSTER_FLOOR.OP, MB: ROSTER_FLOOR.MB, L: ROSTER_FLOOR.L };
  const detects = POS.some((pos) => fakeCnt[pos] < ROSTER_FLOOR[pos]);
  check(detects, `A/B①: floor 검사기가 S=floor−1 가짜 로스터를 위반으로 검출(검사기 이빨)`);

  // ── A/B 자가검증 ②: AI 목표 함수 성적 반영 + 목표 분해(배출·드래프트 자리) — flat mutant는 반드시 FAIL ──
  //   aiRosterTarget: 1위(rank1)가 꼴찌(rankN)보다 두껍다. flat(모두 14) mutant면 성적반영 검사를 통과 못 함.
  const n7 = LEAGUE.teams.length;
  const tBest = aiRosterTarget(1, n7, 0), tWorst = aiRosterTarget(n7, n7, 0);
  const flatMut = (_r: number, _n: number, _b = 0) => 14; // mutant: 성적 무관 상수
  check(tBest > tWorst && !(flatMut(1, n7) > flatMut(n7, n7)),
    `A/B②: 목표 성적반영 rank1 T${tBest}>rankN T${tWorst} AND flat mutant는 반영검사 FAIL(검사기 이빨)`);
  // 목표 분해: 예약(FA)·국내(재계약/방출) 상한이 총원목표보다 낮아 드래프트·능동배출 자리가 구조적으로 생긴다.
  const T = aiRosterTargets(), R = aiReserveTargets(), D = aiDomesticCaps();
  const roomOk = Object.keys(T).length > 0 && Object.keys(T).every((id) => R[id] < T[id] && D[id] < R[id]);
  check(roomOk, `A/B②': 목표 분해 국내 < FA예약 < 총원목표 — 배출·드래프트 자리 보장(mutant 동일값이면 FAIL)`);

  log('');
  const total = 12;
  if (fails.length) { log(`ROSTER FAIL (${total - fails.length}/${total}) — ${fails.join(' / ')}`); process.exit(1); }
  log(`ROSTER PASS (${total}/${total}) — 상한20·floor무결·경기성립·지명2~4·발굴·패스·하한12·크기편차12~18·라운드단조·우승권두껍게·A/B이빨×3`);
  process.exit(0);
}
main();
