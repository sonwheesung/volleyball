// 관계망 셀렉터 — 선수↔팀 affinity + 표시용 친구/라이벌. docs/RELATIONSHIP_SYSTEM §2.
// 엔진(engine/relationships)은 순수, 여기서 리그 로스터·bond를 엮는다. bond는 Phase 1b에서 store가 주입(없으면 0).
import { affinity, pairKey, BOND_GROW, BOND_MAX, BOND_DECAY } from '../engine/relationships';
import { getPlayer, getTeamPlayers, currentRosters } from './league';
import type { Player } from '../types';

const REL_SCALE_FA = 6;       // 친구 다수라야 포화(RELATIONSHIP §2 — 장기 parity 보호: 친구 연쇄 집중 완화, 30×8 측정)
const SHOW_THRESHOLD = 0.3;   // 표시할 관계 최소 강도

// ── bond 컨텍스트(setTxContext 패턴) — 스토어가 주입, FA 해석(offseason)이 읽어 preview=result 유지 ──
let bondsCtx: Record<string, number> = {};
export function setRelationContext(b: Record<string, number> | undefined): void { bondsCtx = b ?? {}; }
export function relationBonds(): Record<string, number> { return bondsCtx; }
const BOND_PRUNE = 0.02;      // 이하 가지치기(옛정 소멸)
const BOND_CAP = 4000;        // 맵 크기 상한(저장 폭주 차단)

/** 시즌말 bond 누적 — 전체 감쇠(옛정 약화) + 같은 팀 국내 쌍 +성장. 무영향 결정론(저장값). RELATIONSHIP §1.1. */
export function accrueBonds(prev: Record<string, number>, rosters: Record<string, string[]>): Record<string, number> {
  const next: Record<string, number> = {};
  // 1) 전체 감쇠 — 떨어진 쌍 자연 약화(완전소멸은 prune)
  for (const k in prev) { const d = prev[k] * BOND_DECAY; if (d >= BOND_PRUNE) next[k] = d; }
  // 2) 같은 팀 국내 쌍 성장(감쇠 상쇄 + 누적, 상한 BOND_MAX)
  for (const ids of Object.values(rosters)) {
    const dom = ids.filter((id) => { const p = getPlayer(id); return p && !p.isForeign; });
    for (let i = 0; i < dom.length; i++) for (let j = i + 1; j < dom.length; j++) {
      const k = pairKey(dom[i], dom[j]);
      next[k] = Math.min(BOND_MAX, (next[k] ?? 0) + BOND_GROW);
    }
  }
  // 3) 바운딩 — 상한 초과 시 강한 순 top BOND_CAP만 유지
  const keys = Object.keys(next);
  if (keys.length > BOND_CAP) {
    keys.sort((a, b) => next[b] - next[a]);
    const trimmed: Record<string, number> = {};
    for (let i = 0; i < BOND_CAP; i++) trimmed[keys[i]] = next[keys[i]];
    return trimmed;
  }
  return next;
}

type Bonds = Record<string, number>;

const teamOfMap = (): Record<string, string> => {
  const m: Record<string, string> = {};
  const rosters = currentRosters();
  for (const [t, ids] of Object.entries(rosters)) for (const id of ids) m[id] = t;
  return m;
};

/** 선수 ↔ 팀(로컬 rosters 기준) affinity ∈ [-1,+1] — FA 해석(resolveFAMarket)의 **실경로** relT(친구 +·라이벌/앙숙 −).
 *  진행 중 영입 반영(친구 연쇄) — 등록부 셀렉터 대신 로컬 rosterIds/get을 받아 그 시점 로스터로 계산.
 *  data/offseason(resolveFAMarket)·data/faOfferSatisfaction(오퍼 만족도 UI)가 **같은 산식**(REL_SCALE_FA=6·affinity)으로
 *  공유 — 중복 상수 드리프트 차단(FA §2.8.4). 순수·id시드(메인 rng 불간섭). */
export function teamAffinityFor(p: Player, rosterIds: string[], get: (id: string) => Player | undefined, bonds: Record<string, number>): number {
  if (p.isForeign) return 0;
  let sum = 0, n = 0;
  for (const mid of rosterIds) {
    if (mid === p.id) continue;
    const m = get(mid);
    if (!m || m.isForeign) continue;
    sum += affinity(p, m, bonds[pairKey(p.id, mid)] ?? 0, true); n++;
  }
  return n ? Math.max(-1, Math.min(1, sum / REL_SCALE_FA)) : 0;
}

export interface Relation { id: string; name: string; v: number }

/** 특정 팀 로스터 중 그 선수의 친구/라이벌(FA 센터 표시용 — "이 팀에 친한/껄끄러운 선수가 있다"). */
export function teamRelations(playerId: string, teamId: string, bonds: Bonds = bondsCtx): { friends: Relation[]; rivals: Relation[] } {
  const p = getPlayer(playerId);
  if (!p || p.isForeign) return { friends: [], rivals: [] };
  const out: Relation[] = [];
  for (const m of getTeamPlayers(teamId)) {
    if (m.id === playerId || m.isForeign) continue;
    const v = affinity(p, m, bonds[pairKey(playerId, m.id)] ?? 0, true);
    if (Math.abs(v) >= SHOW_THRESHOLD) out.push({ id: m.id, name: m.name, v });
  }
  return {
    friends: out.filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3),
    rivals: out.filter((x) => x.v < 0).sort((a, b) => a.v - b.v).slice(0, 3),
  };
}

/** 특정 팀에 있는 그 선수의 최고 절친(현재 사실) — 이적 뉴스 서사용(가짜 드라마 아님: 지금 그 팀에 있는 친구). */
export function topFriendOnTeam(playerId: string, teamId: string, bonds: Bonds = bondsCtx): Relation | null {
  const p = getPlayer(playerId);
  if (!p || p.isForeign) return null;
  let best: Relation | null = null;
  for (const m of getTeamPlayers(teamId)) {
    if (m.id === playerId || m.isForeign) continue;
    const v = affinity(p, m, bonds[pairKey(playerId, m.id)] ?? 0, true);
    if (v >= 0.4 && (!best || v > best.v)) best = { id: m.id, name: m.name, v };
  }
  return best;
}

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
