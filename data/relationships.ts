// 관계망 셀렉터 — 선수↔팀 affinity + 표시용 친구/라이벌. docs/RELATIONSHIP_SYSTEM §2.
// 엔진(engine/relationships)은 순수, 여기서 리그 로스터·bond를 엮는다. bond는 Phase 1b에서 store가 주입(없으면 0).
import { affinity, pairKey } from '../engine/relationships';
import { getPlayer, getTeamPlayers, currentRosters } from './league';

const REL_SCALE = 2.5;        // 친구 2~3명이면 포화
const SHOW_THRESHOLD = 0.3;   // 표시할 관계 최소 강도

type Bonds = Record<string, number>;

const teamOfMap = (): Record<string, string> => {
  const m: Record<string, string> = {};
  const rosters = currentRosters();
  for (const [t, ids] of Object.entries(rosters)) for (const id of ids) m[id] = t;
  return m;
};

/** 선수 ↔ 팀 affinity ∈ [-1,+1] — 그 팀 국내 선수들과의 합 정규화(양=끌림·음=기피) */
export function teamAffinity(playerId: string, teamId: string, bonds: Bonds = {}): number {
  const p = getPlayer(playerId);
  if (!p || p.isForeign) return 0;
  const mates = getTeamPlayers(teamId).filter((m) => m.id !== playerId && !m.isForeign);
  if (!mates.length) return 0;
  let sum = 0;
  for (const m of mates) sum += affinity(p, m, bonds[pairKey(playerId, m.id)] ?? 0, true);
  return Math.max(-1, Math.min(1, sum / REL_SCALE));
}

export interface Relation { id: string; name: string; v: number }

/** 표시용 — 리그 전체에서 친한/껄끄러운 선수 상위(선수 상세 화면) */
export function relationsOf(playerId: string, bonds: Bonds = {}): { friends: Relation[]; rivals: Relation[] } {
  const p = getPlayer(playerId);
  if (!p || p.isForeign) return { friends: [], rivals: [] };
  const tmap = teamOfMap();
  const myTeam = tmap[playerId];
  const out: Relation[] = [];
  for (const ids of Object.values(currentRosters())) {
    for (const id of ids) {
      if (id === playerId) continue;
      const o = getPlayer(id);
      if (!o || o.isForeign) continue;
      const v = affinity(p, o, bonds[pairKey(playerId, id)] ?? 0, !!myTeam && tmap[id] === myTeam);
      if (Math.abs(v) >= SHOW_THRESHOLD) out.push({ id, name: o.name, v });
    }
  }
  return {
    friends: out.filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 4),
    rivals: out.filter((x) => x.v < 0).sort((a, b) => a.v - b.v).slice(0, 4),
  };
}
