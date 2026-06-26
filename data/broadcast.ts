// 중계 현수막 집계 (BROADCAST_SYSTEM). 순수 파생 — 새 저장 없음(결정론).
// 한 경기의 사건(기록 경신·플레이오프 확정/탈락)을 Banner[] 로. 스포일러 정책:
//   결과-중립(기록) 과 결과-결정(확정/탈락) 모두 finished 후에만 빌드 호출 → 누출 0(전수 검증).

import type { CareerStats, Side } from '../types';
import { personalMilestones } from '../engine/milestones';
import { getPlayer, shortTeamName } from './league';
import { availableTeamPlayers } from './injury';
import { leagueProduction } from './production';
import { teamClinch, teamTitleClinch } from './clinch';

export type BannerKind = 'champion' | 'record' | 'clinch' | 'eliminated' | 'triple';
export interface Banner { kind: BannerKind; tint: string; icon: string; title: string; mine: boolean }

const RECORD_TINT = '#3B82F6', CLINCH_TINT = '#16B07D', ELIM_TINT = '#FF6B5A', TRIPLE_TINT = '#8B5CF6', CHAMP_TINT = '#F2A93B';
// 트리플 크라운(KOVO 공식) — 한 경기 **후위공격·블로킹·서브 에이스 각 TRIPLE_MIN 이상**.
// 후위공격(backSpikes)은 production이 OH/OP 킬에서 별도 귀속(engine/production). tools/checkTripleCrown.ts 측정.
const TRIPLE_MIN = 3;
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

  // 1.5) 트리플 크라운(KOVO 공식, 결과-중립) — 한 경기 후위공격·블로킹·서브 에이스 각 TRIPLE_MIN 이상.
  //   개인 업적이라 승패를 노출하지 않음 → finished 후 안전.
  for (const [side, teamId] of sides) {
    const mine = mineSide === side;
    for (const pl of availableTeamPlayers(teamId, dayIndex)) {
      const pb = before.get(pl.id), pa = after.get(pl.id);
      const back = (pa?.backSpikes ?? 0) - (pb?.backSpikes ?? 0);
      const b = (pa?.blocks ?? 0) - (pb?.blocks ?? 0);
      const a = (pa?.aces ?? 0) - (pb?.aces ?? 0);
      if (back >= TRIPLE_MIN && b >= TRIPLE_MIN && a >= TRIPLE_MIN)
        out.push({ kind: 'triple', tint: TRIPLE_TINT, icon: 'ribbon', mine, title: `${pl.name} 트리플 크라운! 후위공격 ${back}·블로킹 ${b}·서브 ${a}` });
    }
  }

  // 2) 정규리그 우승(1위·챔프전 직행) 확정(결과-결정) — 이 경기로 막 1위를 수학적 확정한 팀. BROADCAST_SYSTEM §2.
  for (const [side, teamId] of sides) {
    const mine = mineSide === side;
    const tb = teamTitleClinch(teamId, Math.max(0, dayIndex - 1))?.state;
    const ta = teamTitleClinch(teamId, dayIndex)?.state;
    if (tb !== 'clinched' && ta === 'clinched')
      out.push({ kind: 'champion', tint: CHAMP_TINT, icon: 'trophy', mine, title: `${shortTeamName(teamId)} 정규리그 우승 — 챔프전 직행!` });
  }

  // 3) 플레이오프 확정/탈락(결과-결정) — 이 경기로 막 바뀐 팀
  for (const [side, teamId] of sides) {
    const mine = mineSide === side;
    const cb = teamClinch(teamId, Math.max(0, dayIndex - 1))?.state;
    const ca = teamClinch(teamId, dayIndex)?.state;
    const name = shortTeamName(teamId);
    if (cb !== 'clinched' && ca === 'clinched') out.push({ kind: 'clinch', tint: CLINCH_TINT, icon: 'checkmark-circle', mine, title: `${name} 플레이오프 확정!` });
    else if (cb !== 'eliminated' && ca === 'eliminated') out.push({ kind: 'eliminated', tint: ELIM_TINT, icon: 'close-circle', mine, title: `${name} 플레이오프 탈락` });
  }

  // 내 팀 사건 먼저, 그다음 우승(가장 특별) → 트리플 → 기록 → 확정/탈락 순
  const rank: Record<BannerKind, number> = { champion: 0, triple: 1, record: 2, clinch: 3, eliminated: 4 };
  return out.sort((a, b) => (Number(b.mine) - Number(a.mine)) || (rank[a.kind] - rank[b.kind]));
}
