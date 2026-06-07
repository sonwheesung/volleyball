// 장기 리그 시뮬레이터 (CLI) — store.endSeason 오케스트레이션을 재현해 N시즌을 끝까지 돌린다.
// 전 구단 AI. 경기 엔진/훈련/노쇠/FA/드래프트 튜닝 후 우승 분포·전력 균형(parity)·하위팀 반등·왕조를 측정.
//
//   npx tsx tools/simLeague.ts [시즌수=100] [유니버스수=1]
//
// 유니버스수=1: 고정 시드 1개 타임라인의 상세 리포트(결정론).
// 유니버스수>1: 매 유니버스를 다른 시드로 재생성(독립) → parity·왕조·반등을 통계(평균±표준편차)로.
// SOLID: 엔진/데이터 순수 함수만 합성(UI·store 무의존).

import {
  LEAGUE, getTeam, resetLeagueBase, reseedLeague, commitPlayerBase, commitRosters,
} from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';

const teamName = (id: string): string => getTeam(id)?.name ?? id;

/** 한 시즌의 오프시즌(롤오버·은퇴·경쟁FA·드래프트·충원·성장XP·이적근속리셋) — store.endSeason 재현, 전 구단 AI */
function advanceOffseason(season: number): void {
  const nextSeason = season + 1;
  const my = '';
  const ctx = buildDraftContext(my, {}, {}, [], false, [], nextSeason);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], my, [], styleOf);
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

interface UniResult {
  ids: string[];
  titles: Record<string, number>;
  rankSum: Record<string, number>;
  champByYear: string[];
  champSeasons: Record<string, number[]>;
  lastSeasons: Record<string, number[]>;
  longestStreak: number;
  longestTeam: string;
}

/** 현재 리그 상태로 N시즌 진행 — 호출 전에 resetLeagueBase()/reseedLeague() 로 상태 설정 */
function runUniverse(seasons: number, onProgress?: (s: number) => void): UniResult {
  const ids = LEAGUE.teams.map((t) => t.id);
  const titles: Record<string, number> = {};
  const rankSum: Record<string, number> = {};
  const champSeasons: Record<string, number[]> = {};
  const lastSeasons: Record<string, number[]> = {};
  for (const id of ids) { titles[id] = 0; rankSum[id] = 0; champSeasons[id] = []; lastSeasons[id] = []; }
  const champByYear: string[] = [];
  let curTeam = '', curStreak = 0, longestStreak = 0, longestTeam = '';
  const N = ids.length;

  for (let s = 0; s < seasons; s++) {
    const standings = computeStandings(Number.MAX_SAFE_INTEGER);
    standings.forEach((st, rank) => {
      rankSum[st.teamId] += rank + 1;
      if (rank + 1 === N) lastSeasons[st.teamId].push(s);
    });
    const champ = buildPlayoffs(s).championId ?? standings[0].teamId;
    titles[champ]++;
    champSeasons[champ].push(s);
    champByYear.push(champ);
    if (champ === curTeam) curStreak++; else { curTeam = champ; curStreak = 1; }
    if (curStreak > longestStreak) { longestStreak = curStreak; longestTeam = champ; }
    if (onProgress) onProgress(s);
    advanceOffseason(s);
  }
  return { ids, titles, rankSum, champByYear, champSeasons, lastSeasons, longestStreak, longestTeam };
}

const stdev = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

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
}

function multiReport(seasons: number, universes: number): void {
  process.stderr.write(`▶ ${universes}개 독립 유니버스 × ${seasons}시즌 (풀 엔진)\n`);
  const parity: number[] = [], dynasty: number[] = [], teamsWon: number[] = [], topShare: number[] = [];
  let comebacks = 0, allWon = 0, N = 0;
  log(`# universe, parityStd, dynasty, teamsWon/N, topShare%, comeback`);
  for (let uIdx = 0; uIdx < universes; uIdx++) {
    reseedLeague(20251018 + uIdx * 101, 777 + uIdx * 13);
    const u = runUniverse(seasons);
    const m = metrics(u, seasons);
    N = m.N;
    parity.push(m.parityStd); dynasty.push(m.dynasty); teamsWon.push(m.teamsWon); topShare.push(m.topShare);
    if (m.comeback) comebacks++;
    if (m.teamsWon === m.N) allWon++;
    // 유니버스별 즉시 기록(도중 부분집계 가능)
    log(`u${String(uIdx).padStart(3)}: parityStd ${m.parityStd.toFixed(1)}  dynasty ${m.dynasty}  won ${m.teamsWon}/${m.N}  top ${(m.topShare * 100).toFixed(0)}%  ${m.comeback ? '반등O' : '반등X'}`);
    process.stderr.write(`  …유니버스 ${uIdx + 1}/${universes}\n`);
  }
  log(`\n═══ 집계: ${universes}개 유니버스 × ${seasons}시즌 (${N}팀, 풀 엔진) ═══`);
  log(`▸ parity 표준편차: 평균 ${mean(parity).toFixed(2)} ± ${stdev(parity).toFixed(2)}  (낮을수록 균형, 완전균등 기대 0)`);
  log(`▸ 최장 왕조(연속우승): 평균 ${mean(dynasty).toFixed(1)}  최대 ${Math.max(...dynasty)}`);
  log(`▸ 우승 경험 팀: 평균 ${mean(teamsWon).toFixed(1)}/${N}  ·  전팀우승 유니버스 ${(allWon / universes * 100).toFixed(0)}%`);
  log(`▸ 1위팀 우승 점유율: 평균 ${(mean(topShare) * 100).toFixed(0)}%  (낮을수록 분산)`);
  log(`▸ "꼴찌→나중 우승" 발생 유니버스: ${(comebacks / universes * 100).toFixed(0)}%`);
}

function main(): void {
  const seasons = Math.max(1, Number(process.argv[2]) || 100);
  const universes = Math.max(1, Number(process.argv[3]) || 1);
  if (universes <= 1) singleReport(seasons);
  else multiReport(seasons, universes);
}

main();
