// 장기 리그 시뮬레이터 (CLI) — store.endSeason 오케스트레이션을 재현해 N시즌을 끝까지 돌린다.
// 전 구단 AI. 경기 엔진/훈련/노쇠/FA/드래프트 튜닝 후 우승 분포·전력 균형(parity)·하위팀 반등·왕조를 측정.
//
//   npx tsx tools/simLeague.ts [시즌수=100] [유니버스수=1]
//
// 유니버스수=1: 고정 시드 1개 타임라인의 상세 리포트(결정론).
// 유니버스수>1: 매 유니버스를 다른 시드로 재생성(독립) → parity·왕조·반등을 통계(평균±표준편차)로.
// SOLID: 엔진/데이터 순수 함수만 합성(UI·store 무의존).

import {
  LEAGUE, getTeam, resetLeagueBase, reseedLeague, commitPlayerBase, commitRosters, teamScoutReveal,
} from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { currentSeasonAwards } from '../data/awards';
import { setAwardScores } from '../data/awardSalary';
import { setSeasonHistory, setStanceEnabled } from '../data/leagueHistory';
import type { SeasonArchive } from '../types';

// 수상 프리미엄(SALARY 2장) — 실게임 store.endSeason 과 동일하게, 오프시즌 FA 전에 수상 컨텍스트를 갱신.
// 유니버스 경계(season 0)에서 초기화. 시뮬도 awarded 스타에 몸값 프리미엄을 반영해 검증한다.
// G-2(FINANCE 2.0 Stage3): championId/standings 까지 누적 → 모기업 기조(가뭄 등 다년 트리거) 발화 + setSeasonHistory 주입.
let simArchive: SeasonArchive[] = [];

const teamName = (id: string): string => getTeam(id)?.name ?? id;

/** 한 시즌의 오프시즌(롤오버·은퇴·경쟁FA·드래프트·충원·성장XP·이적근속리셋) — store.endSeason 재현, 전 구단 AI */
export function advanceOffseason(season: number, championId = '', standings: string[] = []): void {
  if (season === 0) simArchive = [];
  const nextSeason = season + 1;
  const my = '';
  // 끝난 시즌 수상·우승·순위 집계 → 컨텍스트(이번 오프시즌 FA/재계약·모기업 기조에 반영). 롤오버(buildDraftContext) 전.
  simArchive = [...simArchive, { season, championId, standings, awards: currentSeasonAwards(season) }];
  setAwardScores(simArchive);
  setSeasonHistory(simArchive); // 모기업 기조(FINANCE 2.0 Stage3) — AI FA 입찰 stance 도출원
  const ctx = buildDraftContext(my, {}, {}, [], false, [], nextSeason);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], my, [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], nextSeason);
  for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) {
    for (const id of filled.rosters[tid]) {
      const pr = seasonProd.get(id);
      if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
    }
  }
  for (const tid of Object.keys(filled.rosters)) {
    for (const id of filled.rosters[tid]) {
      const prev = ctx.prevTeamOf[id];
      if (prev && prev !== tid && snapshot[id]) snapshot[id] = { ...snapshot[id], clubTenure: 0 };
    }
  }
  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
}

export interface UniResult {
  ids: string[];
  titles: Record<string, number>;
  rankSum: Record<string, number>;
  rankHistory: Record<string, number[]>; // 시즌별 순위(1..N) — 초기/후기 지속성 분석용
  champByYear: string[];
  champSeasons: Record<string, number[]>;
  lastSeasons: Record<string, number[]>;
  longestStreak: number;
  longestTeam: string;
}

/** 현재 리그 상태로 N시즌 진행 — 호출 전에 resetLeagueBase()/reseedLeague() 로 상태 설정 */
export function runUniverse(seasons: number, onProgress?: (s: number) => void): UniResult {
  const ids = LEAGUE.teams.map((t) => t.id);
  const titles: Record<string, number> = {};
  const rankSum: Record<string, number> = {};
  const rankHistory: Record<string, number[]> = {};
  const champSeasons: Record<string, number[]> = {};
  const lastSeasons: Record<string, number[]> = {};
  for (const id of ids) { titles[id] = 0; rankSum[id] = 0; rankHistory[id] = []; champSeasons[id] = []; lastSeasons[id] = []; }
  const champByYear: string[] = [];
  let curTeam = '', curStreak = 0, longestStreak = 0, longestTeam = '';
  const N = ids.length;

  for (let s = 0; s < seasons; s++) {
    const standings = computeStandings(Number.MAX_SAFE_INTEGER);
    standings.forEach((st, rank) => {
      rankSum[st.teamId] += rank + 1;
      rankHistory[st.teamId].push(rank + 1);
      if (rank + 1 === N) lastSeasons[st.teamId].push(s);
    });
    const champ = buildPlayoffs(s).championId ?? standings[0].teamId;
    titles[champ]++;
    champSeasons[champ].push(s);
    champByYear.push(champ);
    if (champ === curTeam) curStreak++; else { curTeam = champ; curStreak = 1; }
    if (curStreak > longestStreak) { longestStreak = curStreak; longestTeam = champ; }
    if (onProgress) onProgress(s);
    advanceOffseason(s, champ, standings.map((st) => st.teamId)); // G-2: 우승·순위 누적(모기업 기조 트리거)
  }
  return { ids, titles, rankSum, rankHistory, champByYear, champSeasons, lastSeasons, longestStreak, longestTeam };
}

const stdev = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 피어슨 상관계수 */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** 초기 vs 후기 윈도 평균순위 + 지속성 상관 (드래프트·육성의 평균회귀 진단) */
function persistence(u: UniResult, seasons: number) {
  const w = Math.max(1, Math.floor(seasons / 4)); // 앞 1/4 vs 뒤 1/4
  const early: Record<string, number> = {}, late: Record<string, number> = {};
  for (const id of u.ids) {
    const h = u.rankHistory[id];
    early[id] = mean(h.slice(0, w));
    late[id] = mean(h.slice(seasons - w));
  }
  const corr = pearson(u.ids.map((id) => early[id]), u.ids.map((id) => late[id]));
  return { w, early, late, corr };
}

/** 한 유니버스의 구조적 지표(팀 이름 무관, 유니버스 간 집계용) */
function metrics(u: UniResult, seasons: number) {
  const N = u.ids.length;
  const titleArr = u.ids.map((id) => u.titles[id]);
  const teamsWon = titleArr.filter((t) => t > 0).length;
  const topShare = Math.max(...titleArr) / seasons;
  let comeback = false;
  for (const id of u.ids) {
    const lasts = u.lastSeasons[id];
    const champs = u.champSeasons[id];
    if (lasts.length && champs.some((c) => c > lasts[0])) { comeback = true; break; }
  }
  return { parityStd: stdev(titleArr), dynasty: u.longestStreak, teamsWon, N, topShare, comeback };
}

const log = (m: string) => process.stdout.write(m + '\n');

function singleReport(seasons: number): void {
  resetLeagueBase();
  const u = runUniverse(seasons, (s) => { if ((s + 1) % 25 === 0) process.stderr.write(`  …${s + 1}/${seasons}시즌\n`); });
  const N = u.ids.length;
  log(`\n═══ ${N}팀 · ${seasons}시즌 (고정 시드, 결정론) ═══`);
  log('\n▸ 우승 분포(많은 순):');
  for (const id of [...u.ids].sort((a, b) => u.titles[b] - u.titles[a])) {
    log(`  ${teamName(id).padEnd(16)} 우승 ${String(u.titles[id]).padStart(3)}회  평균순위 ${(u.rankSum[id] / seasons).toFixed(1)}`);
  }
  const m = metrics(u, seasons);
  log(`\n▸ parity: 표준편차 ${m.parityStd.toFixed(1)} (기대균등 ${(seasons / N).toFixed(1)}) · 우승경험 ${m.teamsWon}/${N} · 최장왕조 ${teamName(u.longestTeam)} ${m.dynasty}연패`);
  log('\n▸ 꼴찌→나중 우승:');
  let cases = 0;
  for (const id of u.ids) {
    const lasts = u.lastSeasons[id]; const champs = u.champSeasons[id];
    if (!lasts.length || !champs.length) continue;
    const later = champs.find((c) => c > lasts[0]);
    if (later !== undefined) { cases++; log(`  ${teamName(id)}: ${lasts[0]}→${later}시즌 (${later - lasts[0]}년 후)`); }
  }
  if (!cases) log('  (없음)');

  // 초기 상위권 지속성 — 드래프트·육성의 평균회귀 진단
  const p = persistence(u, seasons);
  log(`\n▸ 순위 지속성 (앞 ${p.w}시즌 vs 뒤 ${p.w}시즌 평균순위):`);
  for (const id of [...u.ids].sort((a, b) => p.early[a] - p.early[b])) {
    const e = p.early[id], l = p.late[id];
    const arrow = l < e - 0.5 ? '↑상승' : l > e + 0.5 ? '↓하락' : '─유지';
    log(`  ${teamName(id).padEnd(16)} 초기 ${e.toFixed(1)}위 → 후기 ${l.toFixed(1)}위  ${arrow}`);
  }
  log(`  지속성 상관계수 r=${p.corr.toFixed(2)}  (0≈건강한 평균회귀 / +1≈초기서열 고착 / −1≈완전역전)`);
}

function multiReport(seasons: number, universes: number): void {
  process.stderr.write(`▶ ${universes}개 독립 유니버스 × ${seasons}시즌 (풀 엔진)\n`);
  const parity: number[] = [], dynasty: number[] = [], teamsWon: number[] = [], topShare: number[] = [], persist: number[] = [];
  let comebacks = 0, allWon = 0, N = 0;
  log(`# universe, parityStd, dynasty, teamsWon/N, topShare%, persistR, comeback`);
  for (let uIdx = 0; uIdx < universes; uIdx++) {
    reseedLeague(20251018 + uIdx * 101, 777 + uIdx * 13);
    const u = runUniverse(seasons);
    const m = metrics(u, seasons);
    N = m.N;
    const pr = persistence(u, seasons).corr;
    parity.push(m.parityStd); dynasty.push(m.dynasty); teamsWon.push(m.teamsWon); topShare.push(m.topShare); persist.push(pr);
    if (m.comeback) comebacks++;
    if (m.teamsWon === m.N) allWon++;
    // 유니버스별 즉시 기록(도중 부분집계 가능)
    log(`u${String(uIdx).padStart(3)}: parityStd ${m.parityStd.toFixed(1)}  dynasty ${m.dynasty}  won ${m.teamsWon}/${m.N}  top ${(m.topShare * 100).toFixed(0)}%  r ${pr.toFixed(2)}  ${m.comeback ? '반등O' : '반등X'}`);
    process.stderr.write(`  …유니버스 ${uIdx + 1}/${universes}\n`);
  }
  log(`\n═══ 집계: ${universes}개 유니버스 × ${seasons}시즌 (${N}팀, 풀 엔진) ═══`);
  log(`▸ parity 표준편차: 평균 ${mean(parity).toFixed(2)} ± ${stdev(parity).toFixed(2)}  (낮을수록 균형, 완전균등 기대 0)`);
  log(`▸ 최장 왕조(연속우승): 평균 ${mean(dynasty).toFixed(1)}  최대 ${Math.max(...dynasty)}`);
  log(`▸ 순위 지속성 r: 평균 ${mean(persist).toFixed(2)} ± ${stdev(persist).toFixed(2)}  (0≈평균회귀 / +1≈서열고착)`);
  log(`▸ 우승 경험 팀: 평균 ${mean(teamsWon).toFixed(1)}/${N}  ·  전팀우승 유니버스 ${(allWon / universes * 100).toFixed(0)}%`);
  log(`▸ 1위팀 우승 점유율: 평균 ${(mean(topShare) * 100).toFixed(0)}%  (낮을수록 분산)`);
  log(`▸ "꼴찌→나중 우승" 발생 유니버스: ${(comebacks / universes * 100).toFixed(0)}%`);
}

function main(): void {
  if (process.env.STANCE_OFF) { setStanceEnabled(false); process.stderr.write('▶ STANCE_OFF — 모기업 기조 비활성(parity 베이스라인)\n'); }
  const seasons = Math.max(1, Number(process.argv[2]) || 100);
  const universes = Math.max(1, Number(process.argv[3]) || 1);
  if (universes <= 1) singleReport(seasons);
  else multiReport(seasons, universes);
}

// 직접 실행할 때만 main()을 돈다(다른 도구가 runUniverse만 import할 때 부작용 방지)
if ((process.argv[1] ?? '').includes('simLeague')) main();
