// 장기 리그 시뮬레이터 (CLI) — store.endSeason 오케스트레이션을 재현해 N시즌을 끝까지 돌린다.
// 전 구단 AI. 결정론(고정 리그/시즌 시드). 우승 분포·전력 균형(parity)·하위팀 반등·왕조를 측정.
//
//   npx tsx tools/simLeague.ts [시즌수=100]
//
// SOLID: 엔진/데이터 순수 함수만 합성(UI·store 무의존). 같은 인자 = 같은 결과.

import { LEAGUE, getTeam, resetLeagueBase, commitPlayerBase, commitRosters } from '../data/league';
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
  const my = ''; // 사용자 팀 없음 → 전 구단 AI
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

function main(): void {
  const seasons = Math.max(1, Number(process.argv[2]) || 100);
  resetLeagueBase();

  const ids = LEAGUE.teams.map((t) => t.id);
  const N = ids.length;
  const titles: Record<string, number> = {};
  const rankSum: Record<string, number> = {};
  const champSeasons: Record<string, number[]> = {};
  const lastSeasons: Record<string, number[]> = {};
  for (const id of ids) { titles[id] = 0; rankSum[id] = 0; champSeasons[id] = []; lastSeasons[id] = []; }

  const champByYear: string[] = [];
  let curTeam = '', curStreak = 0, longestStreak = 0, longestTeam = '';

  process.stderr.write(`▶ ${N}팀 ${seasons}시즌 시뮬 시작...\n`);
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
    if ((s + 1) % 25 === 0) process.stderr.write(`  …${s + 1}/${seasons}시즌\n`);
    advanceOffseason(s);
  }

  const log = (m: string) => process.stdout.write(m + '\n');
  log(`\n═══ ${N}팀 · ${seasons}시즌 시뮬 결과 (전 구단 AI, 결정론) ═══`);

  log('\n▸ 우승 횟수 분포 (많은 순):');
  const ranked = [...ids].sort((a, b) => titles[b] - titles[a]);
  for (const id of ranked) {
    log(`  ${teamName(id).padEnd(16)} 우승 ${String(titles[id]).padStart(3)}회  평균순위 ${(rankSum[id] / seasons).toFixed(1)}`);
  }

  const expected = seasons / N;
  const variance = ids.reduce((s, id) => s + (titles[id] - expected) ** 2, 0) / N;
  log(`\n▸ 전력 균형(parity):`);
  log(`  기대 우승(완전균등) ${expected.toFixed(1)}회/팀, 실측 표준편차 ${Math.sqrt(variance).toFixed(1)} (낮을수록 균형)`);
  log(`  우승 경험 팀: ${ids.filter((id) => titles[id] > 0).length}/${N}`);
  log(`  최장 연속 우승(왕조): ${teamName(longestTeam)} ${longestStreak}연패`);

  log('\n▸ "꼴찌 → 나중에 우승" 반등 사례:');
  let cases = 0;
  for (const id of ids) {
    const lasts = lastSeasons[id];
    const champs = champSeasons[id];
    if (!lasts.length || !champs.length) continue;
    const firstLast = lasts[0];
    const later = champs.find((c) => c > firstLast);
    if (later !== undefined) {
      cases++;
      log(`  ${teamName(id)}: ${firstLast}시즌 꼴찌 → ${later}시즌 우승 (${later - firstLast}년 후)`);
    }
  }
  if (!cases) log('  (꼴찌 후 우승한 팀 없음)');

  if (seasons <= 120) {
    log('\n▸ 우승 연표:');
    let line = '';
    champByYear.forEach((c, i) => {
      line += `${String(i).padStart(3)}:${teamName(c).slice(0, 4)} `;
      if ((i + 1) % 8 === 0) { log('  ' + line); line = ''; }
    });
    if (line) log('  ' + line);
  } else {
    log('\n▸ 10년 단위 최다 우승(시대/왕조):');
    for (let d = 0; d < seasons; d += 10) {
      const block = champByYear.slice(d, d + 10);
      const cnt: Record<string, number> = {};
      for (const c of block) cnt[c] = (cnt[c] ?? 0) + 1;
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      log(`  ${String(d).padStart(3)}~${String(Math.min(d + 9, seasons - 1)).padStart(3)}시즌: ${teamName(top[0])} ${top[1]}회`);
    }
  }
}

main();
