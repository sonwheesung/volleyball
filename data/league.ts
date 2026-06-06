// 리그 데이터 — 시드로 생성하되, 로스터·선수 상태는 세이브로 가변(다중 시즌·FA·드래프트).
// playerMap = 전역 선수 레지스트리(시드 + 시즌 스냅샷 + 신규 생성).
// rosters    = 팀 구성(가변). 시드 기본값에서 은퇴/영입/드래프트로 바뀐다.
// 시즌 내 진화는 스냅샷에서 currentDay 만큼 리플레이.

import type { Coach, Fixture, Player, Team, TrainingFocus } from '../types';
import { generateLeague } from './seed';
import { generateSeason } from '../engine/season';
import { evolvePlayer } from '../engine/progression';

const LEAGUE_SEED = 20251018;
const SEASON_SEED = 777;
const DEFAULT_FOCUS: TrainingFocus = { primary: [4, 6], secondary: [1, 10, 12] };

export const LEAGUE = generateLeague(LEAGUE_SEED);
export const SEASON: Fixture[] = generateSeason(LEAGUE.teams.map((t) => t.id), SEASON_SEED);

const teamMap = new Map(LEAGUE.teams.map((t) => [t.id, t]));
const playerMap = new Map<string, Player>(LEAGUE.players.map((p) => [p.id, p]));
const coachMap = new Map(LEAGUE.coaches.map((c) => [c.id, c]));
const fixtureMap = new Map(SEASON.map((f) => [f.id, f]));

// ─── 가변 로스터 + 캐시 ───
const seedRosters = (): Record<string, string[]> =>
  Object.fromEntries(LEAGUE.teams.map((t) => [t.id, [...t.players]]));

let rosters: Record<string, string[]> = seedRosters();
let playerFocus = new Map<string, TrainingFocus>();
let evoCache: { day: number; map: Map<string, Player> } | null = null;

function rebuildFocus(): void {
  playerFocus = new Map();
  for (const t of LEAGUE.teams) {
    const focus = coachMap.get(t.coachId)?.trainingFocus;
    if (focus) for (const pid of rosters[t.id] ?? []) playerFocus.set(pid, focus);
  }
}
rebuildFocus();

export const getTeam = (id: string): Team | undefined => teamMap.get(id);
export const getPlayer = (id: string): Player | undefined => playerMap.get(id);
export const getCoach = (id: string): Coach | undefined => coachMap.get(id);
export const getFixture = (id: string): Fixture | undefined => fixtureMap.get(id);

export const teamPlayerIds = (teamId: string): string[] => rosters[teamId] ?? [];

export const getTeamPlayers = (teamId: string): Player[] =>
  teamPlayerIds(teamId)
    .map((pid) => playerMap.get(pid))
    .filter((p): p is Player => !!p);

export const getTeamCoach = (teamId: string): Coach | undefined => {
  const t = teamMap.get(teamId);
  return t ? coachMap.get(t.coachId) : undefined;
};

/** 선수 → 소속팀 감독 훈련선호 (롤오버/진화 성장 방향) */
export const focusOf = (p: Player): TrainingFocus => playerFocus.get(p.id) ?? DEFAULT_FOCUS;

// ─── 세이브 동기화 (레지스트리/로스터) ───

/** 현재 활성(로스터 등록) 선수들 — 롤오버 대상 */
export const currentBasePlayers = (): Player[] => {
  const out: Player[] = [];
  for (const ids of Object.values(rosters)) {
    for (const id of ids) {
      const p = playerMap.get(id);
      if (p) out.push(p);
    }
  }
  return out;
};

/** 선수 상태 스냅샷을 레지스트리에 반영(신규 id 포함) */
export function commitPlayerBase(snapshot: Record<string, Player>): void {
  for (const id of Object.keys(snapshot)) playerMap.set(id, snapshot[id]);
  evoCache = null;
}

/** 가변 로스터 반영 */
export function commitRosters(next: Record<string, string[]>): void {
  rosters = next;
  rebuildFocus();
  evoCache = null;
}

export const currentRosters = (): Record<string, string[]> => rosters;
export const defaultRosters = seedRosters;

/** 세이브 초기화 시 시드 상태로 복원 */
export function resetLeagueBase(): void {
  for (const p of LEAGUE.players) playerMap.set(p.id, p);
  rosters = seedRosters();
  rebuildFocus();
  evoCache = null;
}

// ─── 진화(성장/노쇠) 적용 선수 — currentDay 기준, 날짜별 캐시 ───

export function evolvedPlayers(day: number): Map<string, Player> {
  if (evoCache && evoCache.day === day) return evoCache.map;
  const map = new Map<string, Player>();
  for (const team of LEAGUE.teams) {
    const coach = coachMap.get(team.coachId);
    if (!coach) continue;
    for (const pid of rosters[team.id] ?? []) {
      const base = playerMap.get(pid);
      if (base) map.set(pid, evolvePlayer(base, coach.trainingFocus, day));
    }
  }
  evoCache = { day, map };
  return map;
}

export const getEvolvedPlayer = (id: string, day: number): Player | undefined =>
  evolvedPlayers(day).get(id);

export const getEvolvedTeamPlayers = (teamId: string, day: number): Player[] => {
  const m = evolvedPlayers(day);
  return teamPlayerIds(teamId)
    .map((pid) => m.get(pid))
    .filter((p): p is Player => !!p);
};
