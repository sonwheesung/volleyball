// 플레이오프 확정/탈락/경합 셀렉터 — 현재 순위(computeStandings) + 잔여 일정으로 조립해
// engine/clinch에 위임. 이미 치른 경기 + 남은 경기 수학이라 미래 결과를 드러내지 않음(스포일러 안전).
import { SEASON } from './league';
import { computeStandings } from './standings';
import { clinchStatus, type ClinchResult } from '../engine/clinch';

export const PLAYOFF_CUTOFF = 3; // 상위 3팀 포스트시즌 진출(data/playoffs.ts와 동일)

/** uptoDay 시점의 전 구단 확정/탈락/경합 + 매직넘버. cutoff=상위 N 진출(기본 PO 3, 1이면 정규리그 우승). */
export function seasonClinch(uptoDay: number, cutoff: number = PLAYOFF_CUTOFF): ClinchResult[] {
  const standings = computeStandings(uptoDay);
  const total: Record<string, number> = {};
  for (const f of SEASON) {
    total[f.homeTeamId] = (total[f.homeTeamId] ?? 0) + 1;
    total[f.awayTeamId] = (total[f.awayTeamId] ?? 0) + 1;
  }
  const inputs = standings.map((s) => ({
    teamId: s.teamId,
    wins: s.wins,
    remaining: Math.max(0, (total[s.teamId] ?? 0) - s.played),
  }));
  return clinchStatus(inputs, cutoff);
}

/** 한 팀의 플옵 상태만. */
export function teamClinch(teamId: string, uptoDay: number): ClinchResult | undefined {
  return seasonClinch(uptoDay).find((r) => r.teamId === teamId);
}

/** 한 팀의 정규리그 우승(1위·챔프전 직행) 확정 상태 — cutoff=1. 'clinched'면 수학적으로 1위 확정. */
export function teamTitleClinch(teamId: string, uptoDay: number): ClinchResult | undefined {
  return seasonClinch(uptoDay, 1).find((r) => r.teamId === teamId);
}
