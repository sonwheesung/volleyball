// 완전 수동(구단주 직접·개입 없음) 승률 영향 A/B 실측 (MATCH_INTERVENTION_SYSTEM §4.1·§6).
//   시나리오: "설정은 구단주 직접인데 실제로 관전·개입은 안 하는 유저" — 감독 자동 타임아웃·작전교체가 꺼진 채 개입도 없음.
//   동일 로스터 매치업·동일 시드로 baseline(양팀 감독 자동) vs treatment(홈만 manualSide, 개입 0)를 돌려 승률·세트득실 델타 측정.
//   **튜닝 아님 — 정직한 숫자 보고만**(사용자가 트레이드오프 수용). N≥10,000.
//   npx tsx tools/_ab_manual_side.ts [N=12000]

import { LEAGUE, resetLeagueBase, coachInfoOf, getEvolvedTeamPlayers } from '../data/league';
import { simulateMatch } from '../engine/match';
import type { Side, Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);
const nT = ids.length;

const N = Math.max(10000, Number(process.argv[2]) || 12000);

type Agg = { wins: number; setsFor: number; setsAgainst: number; games: number };
const mk = (): Agg => ({ wins: 0, setsFor: 0, setsAgainst: 0, games: 0 });
const base = mk(), treat = mk();     // 홈(=완전 수동 대상) 관점
const baseAway = mk(), treatAway = mk();

for (let i = 0; i < N; i++) {
  const seed = (i * 2654435761) >>> 0;
  const hi = i % nT, ai = (hi + 1 + (i % (nT - 1))) % nT;
  const home = sq[ids[hi]], away = sq[ids[ai]];
  const coach = { home: coachInfoOf(ids[hi]), away: coachInfoOf(ids[ai]) };
  const b = simulateMatch(seed, home, away, { ...coach });
  const t = simulateMatch(seed, home, away, { ...coach, manualSide: 'home' as Side });
  for (const [r, agg, aggAway] of [[b, base, baseAway], [t, treat, treatAway]] as const) {
    agg.games++; aggAway.games++;
    agg.setsFor += r.homeSets; agg.setsAgainst += r.awaySets;
    aggAway.setsFor += r.awaySets; aggAway.setsAgainst += r.homeSets;
    if (r.homeSets > r.awaySets) agg.wins++; else aggAway.wins++;
  }
}

const pct = (a: Agg) => (100 * a.wins / a.games);
const setDiff = (a: Agg) => ((a.setsFor - a.setsAgainst) / a.games);

log(`\n═══ 완전 수동(구단주 직접·개입 0) 승률 A/B — N=${N} 매치업(동일 시드·로스터) ═══`);
log(`  대상 = 홈 사이드(manualSide='home'), 상대 = 종전 감독 자동. treatment는 홈만 완전 수동.\n`);
log(`  ┌─────────────┬──────────┬──────────┬───────────┐`);
log(`  │ 지표(홈 관점) │ baseline │ treatment │  델타(Δ)  │`);
log(`  ├─────────────┼──────────┼──────────┼───────────┤`);
log(`  │ 홈 승률(%)   │ ${pct(base).toFixed(2).padStart(8)} │ ${pct(treat).toFixed(2).padStart(8)} │ ${(pct(treat) - pct(base)).toFixed(2).padStart(9)} │`);
log(`  │ 홈 세트득실  │ ${setDiff(base).toFixed(3).padStart(8)} │ ${setDiff(treat).toFixed(3).padStart(8)} │ ${(setDiff(treat) - setDiff(base)).toFixed(3).padStart(9)} │`);
log(`  │ 홈 획득세트/G │ ${(base.setsFor / base.games).toFixed(3).padStart(8)} │ ${(treat.setsFor / treat.games).toFixed(3).padStart(8)} │ ${((treat.setsFor - base.setsFor) / N).toFixed(3).padStart(9)} │`);
log(`  │ 홈 실점세트/G │ ${(base.setsAgainst / base.games).toFixed(3).padStart(8)} │ ${(treat.setsAgainst / treat.games).toFixed(3).padStart(8)} │ ${((treat.setsAgainst - base.setsAgainst) / N).toFixed(3).padStart(9)} │`);
log(`  └─────────────┴──────────┴──────────┴───────────┘`);
log(`\n  해석: Δ<0 = 완전 수동(개입 안 함)이 감독 자동보다 홈에 불리(감독 자동 타임아웃·교체가 주던 이득 상실).`);
log(`        이 손해를 유저 개입(타임아웃·교체 직접 호출)으로 메우는 게 설계 의도(§4.1·§6). 튜닝 대상 아님 — 관전형 텔레메트리로 모니터.`);
process.exit(0);
