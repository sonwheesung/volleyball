// 업적 달성 검증 (ACHIEVEMENT_SYSTEM) — N시즌을 실제로 돌려(store.endSeason 재현) 누적된
// archive(우승+시상)·HOF·마일스톤에 evalAchievements를 매 시즌 적용, 업적이 진짜 달성되는지 확인.
//   npx tsx tools/simAchievements.ts [시즌=60]
// 합성 픽스처가 아니라 생성 데이터로 검증 — 챔피언/시상/레전드/기록 업적이 실제로 풀리는지.
// 운영(자금·팬심) 업적은 구단주 레이어(앱 플레이) 소관이라 이 리그 시뮬엔 안 잡힘 — 별도 표시.

import { resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE } from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { currentSeasonAwards } from '../data/awards';
import { detectSeasonMilestones } from '../data/milestones';
import { buildPlayoffs, seriesByTeam } from '../data/playoffs';
import { computeStandings, seasonStreaks } from '../data/standings';
import { evalAchievements, ACHIEVEMENTS } from '../engine/achievements';
import type { HofEntry, Milestone, SeasonArchive } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const HOF_POINTS = 4000, LEGEND_POINTS = 7500; // store/useGameStore.ts와 동일 유지

const N = Math.max(1, Number(process.argv[2]) || 60);
resetLeagueBase();

const archive: SeasonArchive[] = [];
const hof: HofEntry[] = [];
const allMs: Milestone[] = [];
// 업적이 처음 달성된 시즌 기록 (팀별로 본다 — 우승을 가장 많이 한 팀을 "내 팀"으로 사후 선정)
const firstUnlock: Record<string, Record<string, number>> = {}; // teamId -> achId -> season

for (let s = 0; s < N; s++) {
  // 1) 이번 시즌 결과 적립 (실제 endSeason 순서) — 순위·연승연패·플옵 시리즈 포함
  const po = buildPlayoffs(s);
  archive.push({
    season: s, championId: po.championId ?? '', awards: currentSeasonAwards(s),
    standings: computeStandings(Number.MAX_SAFE_INTEGER).map((r) => r.teamId),
    streaks: seasonStreaks(Number.MAX_SAFE_INTEGER),
    series: seriesByTeam(po),
  });
  allMs.push(...detectSeasonMilestones(s, hof));

  // 2) 오프시즌 컨텍스트(은퇴자·이전소속·스냅샷) + HOF 등재
  const ctx = buildDraftContext('', {}, {}, [], false, [], s + 1);
  const snapshot = ctx.snapshot;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const id of ctx.retired) {
    const base = snapshot[id];
    if (!base) continue;
    const c = accrueCareer(base, prod.get(id)).career;
    if (c.points >= HOF_POINTS) {
      hof.push({
        id, name: base.name, position: base.position, teamId: ctx.prevTeamOf[id] ?? '',
        seasons: c.seasons, points: c.points, blocks: c.blocks, digs: c.digs,
        retiredSeason: s, legend: c.points >= LEGEND_POINTS,
      });
    }
  }

  // 3) 매 시즌 종료 시점, 각 팀을 내 팀이라 가정하고 업적 평가 → 첫 달성 시즌 기록
  for (const t of LEAGUE.teams) {
    const st = evalAchievements({ myTeamId: t.id, archive, hof, milestones: allMs, cash: 50000, fanScore: 50 });
    const fu = (firstUnlock[t.id] ??= {});
    for (const x of st) if (x.unlocked && fu[x.ach.id] === undefined) fu[x.ach.id] = s;
  }

  // 4) 다음 시즌으로 진행 (드래프트 + 신인 + 통산 누적 — simNews.advance와 동일)
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], s + 1);
  for (const r of filled.newPlayers) snapshot[r.id] = r;
  for (const tid of Object.keys(filled.rosters)) {
    for (const id of filled.rosters[tid]) {
      const pr = prod.get(id);
      if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr);
    }
  }
  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
}

// ── 리포트 ──
// "내 팀" = 우승을 가장 많이 한 팀(가장 풍부한 커리어를 보여주려고)
const titlesByTeam = new Map<string, number>();
for (const a of archive) titlesByTeam.set(a.championId, (titlesByTeam.get(a.championId) ?? 0) + 1);
const myTeam = [...titlesByTeam.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? LEAGUE.teams[0].id;
const myName = getTeam(myTeam)?.name ?? myTeam;

const finalMine = evalAchievements({ myTeamId: myTeam, archive, hof, milestones: allMs, cash: 50000, fanScore: 50 });
const mineFu = firstUnlock[myTeam] ?? {};

log(`\n═══ 업적 달성 검증 — ${N}시즌 실제 시뮬 (내 팀 = ${myName}, 통산 우승 ${titlesByTeam.get(myTeam) ?? 0}회) ═══`);
// 리그 시뮬 밖: 운영(자금·팬심) + 단장 액션(careerLog — AI 리그엔 내 팀 액션 없음). 드래프트는 시즌수 파생이라 잡힘.
const opCats = new Set(['cash_200k', 'cash_500k', 'cash_1m', 'fan_70', 'fan_90', 'first_fa', 'fa_mogul', 'first_coach', 'coach_collector', 'first_staff', 'first_interview', 'interview_master']);
let done = 0, opSkipped = 0;
for (const st of finalMine) {
  const isOp = opCats.has(st.ach.id);
  if (st.unlocked) {
    done++;
    log(`  ✅ ${st.ach.title.padEnd(10)} — ${mineFu[st.ach.id] !== undefined ? `${mineFu[st.ach.id] + 1}시즌 달성` : '달성'} (${st.ach.desc})`);
  } else if (isOp) {
    opSkipped++;
    log(`  ⊘ ${st.ach.title.padEnd(10)} — 운영 레이어(앱 플레이) 소관, 리그 시뮬 밖 [${st.cur}/${st.ach.target}]`);
  } else {
    log(`  ·  ${st.ach.title.padEnd(10)} — 미달성 [${st.cur}/${st.ach.target}] (${st.ach.desc})`);
  }
}

// 리그 전체 커버리지: 운영 외 업적이 어느 팀에서든 한 번이라도 달성되는가(도달 가능성 증명)
const reachable = new Set<string>();
for (const t of LEAGUE.teams) for (const [achId, _] of Object.entries(firstUnlock[t.id] ?? {})) reachable.add(achId);
const neverReached = ACHIEVEMENTS.filter((a) => !opCats.has(a.id) && !reachable.has(a.id));

log(`\n내 팀 달성 ${done}/${ACHIEVEMENTS.length} (운영 ${opSkipped}개는 시뮬 밖).`);
log(`리그 전체에서 ${N}시즌 내 한 번이라도 달성된 비운영 업적: ${reachable.size}/${ACHIEVEMENTS.length - opCats.size}종`);
if (neverReached.length) {
  log(`⚠ ${N}시즌 동안 어느 팀도 못 깬 비운영 업적: ${neverReached.map((a) => a.title).join(', ')} — 임계 과한지 점검 대상`);
} else {
  log(`✅ 운영 외 전 업적이 실제 시뮬에서 도달 가능 — 임계 건강`);
}

// ── 난이도 지도: 비운영 업적별 (달성 팀 수 / 7) + 첫 달성까지 걸린 시즌(전 팀 중앙값) ──
// 적게·늦게 달성될수록 어렵다. 전설(어느 팀이든 매우 드묾) → 쉬움 순으로 정렬.
const teamCount = LEAGUE.teams.length;
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
type Diff = { id: string; title: string; cat: string; teams: number; medFirst: number; minFirst: number };
const diffs: Diff[] = ACHIEVEMENTS.filter((a) => !opCats.has(a.id)).map((a) => {
  const firsts: number[] = [];
  for (const t of LEAGUE.teams) { const f = firstUnlock[t.id]?.[a.id]; if (f !== undefined) firsts.push(f + 1); }
  return { id: a.id, title: a.title, cat: a.category, teams: firsts.length, medFirst: median(firsts), minFirst: firsts.length ? Math.min(...firsts) : Infinity };
});
// 정렬: 달성 팀 적은 순 → 중앙값 늦은 순 (가장 어려운 게 위로)
diffs.sort((a, b) => a.teams - b.teams || (b.medFirst || 0) - (a.medFirst || 0));
const tier = (d: Diff): string => {
  if (d.teams === 0) return '🔒 미도달';
  if (d.teams <= 1) return '🌑 전설';
  if (d.teams <= 3 || d.medFirst >= N * 0.6) return '🟣 매우 어려움';
  if (d.teams < teamCount || d.medFirst >= N * 0.3) return '🔴 어려움';
  if (d.medFirst >= N * 0.12) return '🟡 보통';
  return '🟢 쉬움';
};
log(`\n═══ 난이도 지도 (${N}시즌 · 7팀 기준 — 어려운 순) ═══`);
log('업적            카테고리  달성팀  첫달성(중앙값/최단)  난이도');
for (const d of diffs) {
  const med = isFinite(d.medFirst) ? `${d.medFirst}시즌` : '-';
  const min = isFinite(d.minFirst) ? `${d.minFirst}` : '-';
  log(`${d.title.padEnd(12)} ${d.cat.padEnd(4)} ${String(d.teams).padStart(3)}/${teamCount}   ${med.padStart(7)} / ${min.padStart(3)}최단    ${tier(d)}`);
}
const byTier: Record<string, number> = {};
for (const d of diffs) { const t = tier(d).split(' ')[1]; byTier[t] = (byTier[t] ?? 0) + 1; }
log(`\n분포: ${Object.entries(byTier).map(([k, v]) => `${k} ${v}`).join(' · ')} (비운영 ${diffs.length}종 · 운영/단장 액션 ${opCats.size}종은 앱 플레이 소관)`);
