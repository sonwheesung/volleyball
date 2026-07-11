// 플레이오프 확정/탈락/경합 셀렉터 — 현재 순위(computeStandings) + 잔여 일정으로 조립해
// engine/clinch에 위임. 이미 치른 경기 + 남은 경기 수학이라 미래 결과를 드러내지 않음(스포일러 안전).
import { SEASON } from './league';
import { computeStandings } from './standings';
import { clinchStatus, type ClinchResult, type ClinchState } from '../engine/clinch';

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

/** 순위 확정 "순간"(전이) 이벤트 — 뉴스 피드용(NEWS_SYSTEM §3.1). PO진출/정규1위직행/PO탈락이
 *  **막 수학적으로 확정된 경기일**을 전 구단에 대해 검출한다. broadcast.ts의 day−1↔day 전이(경기 종료 순간
 *  현수막)를 시즌 전체로 확장한 것 — 현수막이 관전 연출이면 이건 피드에 남는 연대기(병행).
 *  스포일러 안전: 치른 경기(uptoDay 이하) 수학만 — 미래 결과를 쓰지 않는다.
 *  성능: clinch 상태는 **단조**(한 번 확정/탈락이면 유지 — 자기 승수 ↑·상대 잔여 ↓라 threats/guaranteedAbove 비가역)
 *  이므로 **경기가 치러진 날(distinct dayIndex)만** 순위를 한 번 계산하고 롤링 이전상태와 비교한다
 *  (경기 없는 날엔 상태 불변). 팀당 kind별 최대 1건. */
export interface ClinchEvent {
  teamId: string;
  kind: 'po' | 'title' | 'eliminated'; // PO 진출 확정 / 정규리그 1위(직행) 확정 / PO 탈락 확정
  day: number;  // 막 확정된 경기일(dayIndex) — 뉴스 최신순 정렬·2주 만료 기준
  rank: number; // 확정 시점 순위(표시용)
}
export function seasonClinchTransitions(uptoDay: number): ClinchEvent[] {
  const events: ClinchEvent[] = [];
  if (uptoDay < 0) return events; // 첫 경기 전(0경기) — 확정 사건 없음
  const total: Record<string, number> = {};
  for (const f of SEASON) {
    total[f.homeTeamId] = (total[f.homeTeamId] ?? 0) + 1;
    total[f.awayTeamId] = (total[f.awayTeamId] ?? 0) + 1;
  }
  // 상태가 바뀔 수 있는 날 = 경기가 치러진 날뿐. distinct dayIndex(≤uptoDay) 오름차순.
  const days = [...new Set(SEASON.map((f) => f.dayIndex))].filter((d) => d <= uptoDay).sort((a, b) => a - b);
  const prevPo = new Map<string, ClinchState>();    // cutoff=3 (PO 진출/탈락)
  const prevTitle = new Map<string, ClinchState>(); // cutoff=1 (정규 1위 직행)
  for (const day of days) {
    const standings = computeStandings(day); // 캐시된 전 경기 결과에서 uptoDay 필터 → 그날까지 순위
    const inputs = standings.map((s) => ({ teamId: s.teamId, wins: s.wins, remaining: Math.max(0, (total[s.teamId] ?? 0) - s.played) }));
    for (const r of clinchStatus(inputs, PLAYOFF_CUTOFF)) {
      const was = prevPo.get(r.teamId);
      if (r.state === 'clinched' && was !== 'clinched') events.push({ teamId: r.teamId, kind: 'po', day, rank: r.rank });
      else if (r.state === 'eliminated' && was !== 'eliminated') events.push({ teamId: r.teamId, kind: 'eliminated', day, rank: r.rank });
      prevPo.set(r.teamId, r.state);
    }
    for (const r of clinchStatus(inputs, 1)) { // 정규 1위 직행 — clinched만 사건(탈락은 PO 탈락으로 이미 다룸)
      const was = prevTitle.get(r.teamId);
      if (r.state === 'clinched' && was !== 'clinched') events.push({ teamId: r.teamId, kind: 'title', day, rank: r.rank });
      prevTitle.set(r.teamId, r.state);
    }
  }
  return events;
}
