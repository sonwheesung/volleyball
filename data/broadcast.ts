// 중계 현수막 집계 (BROADCAST_SYSTEM). 순수 파생 — 새 저장 없음(결정론).
// 한 경기의 사건(기록 경신·플레이오프 확정/탈락)을 Banner[] 로. 스포일러 정책:
//   결과-중립(기록) 과 결과-결정(확정/탈락) 모두 finished 후에만 빌드 호출 → 누출 0(전수 검증).

import type { CareerStats, Side } from '../types';
import { personalMilestones } from '../engine/milestones';
import { getPlayer, shortTeamName } from './league';
import { availableTeamPlayers } from './injury';
import { leagueProduction } from './production';
import { teamClinch } from './clinch';

export type BannerKind = 'record' | 'clinch' | 'eliminated';
export interface Banner { kind: BannerKind; tint: string; icon: string; title: string; mine: boolean }

const RECORD_TINT = '#3B82F6', CLINCH_TINT = '#16B07D', ELIM_TINT = '#FF6B5A';
const STAT_KO: Record<string, [string, string]> = {
  points: ['통산', '점'], blocks: ['통산 블로킹', '개'], digs: ['통산 디그', '개'],
  aces: ['통산 서브에이스', '개'], matches: ['통산', '경기 출전'], seasons: ['통산', '시즌'],
};

const Z: CareerStats = { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 };

/** 경기 종료 시 띄울 현수막들 — 반드시 finished 후에만 호출(스포일러 정책). dayIndex = 경기일. */
export function buildMatchBanners(homeId: string, awayId: string, dayIndex: number, mineSide: Side | null): Banner[] {
  const out: Banner[] = [];
  const before = leagueProduction(Math.max(0, dayIndex - 1)); // 경기 전 시즌 누적
  const after = leagueProduction(dayIndex);                   // 경기 포함 누적
  const sides: [Side, string][] = [['home', homeId], ['away', awayId]];

  // 1) 기록 경신(결과-중립) — 이 경기에서 통산 임계를 넘은 선수
  for (const [side, teamId] of sides) {
    const mine = mineSide === side;
    for (const pl of availableTeamPlayers(teamId, dayIndex)) {
      const base = getPlayer(pl.id)?.career; if (!base) continue;
      const pb = before.get(pl.id) ?? Z, pa = after.get(pl.id) ?? Z;
      const add = (c: CareerStats, p: typeof pb): CareerStats =>
        ({ ...c, points: c.points + p.points, blocks: c.blocks + p.blocks, digs: c.digs + p.digs, aces: c.aces + p.aces, matches: c.matches + p.matches });
      for (const m of personalMilestones(add(base, pb), add(base, pa))) {
        if (m.stat === 'seasons') continue; // 시즌수는 경기로 안 변함
        const [lab, unit] = STAT_KO[m.stat] ?? [m.stat, ''];
        out.push({ kind: 'record', tint: RECORD_TINT, icon: 'stats-chart', mine, title: `${pl.name} ${lab} ${m.threshold.toLocaleString()}${unit} 돌파!` });
      }
    }
  }

  // 2) 플레이오프 확정/탈락(결과-결정) — 이 경기로 막 바뀐 팀
  for (const [side, teamId] of sides) {
    const mine = mineSide === side;
    const cb = teamClinch(teamId, Math.max(0, dayIndex - 1))?.state;
    const ca = teamClinch(teamId, dayIndex)?.state;
    const name = shortTeamName(teamId);
    if (cb !== 'clinched' && ca === 'clinched') out.push({ kind: 'clinch', tint: CLINCH_TINT, icon: 'checkmark-circle', mine, title: `${name} 플레이오프 확정!` });
    else if (cb !== 'eliminated' && ca === 'eliminated') out.push({ kind: 'eliminated', tint: ELIM_TINT, icon: 'close-circle', mine, title: `${name} 플레이오프 탈락` });
  }

  // 내 팀 사건 먼저, 그다음 확정류
  return out.sort((a, b) => (Number(b.mine) - Number(a.mine)) || (a.kind === 'record' ? 0 : 1) - (b.kind === 'record' ? 0 : 1));
}
