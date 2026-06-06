// 리그 싱글톤 — 앱 시작 시 고정 시드로 한 번 생성(결정론).
// 선수/팀/감독/일정은 시드에서 항상 재현되므로 저장할 필요가 없다.
// (세이브로는 selectedTeamId·진행도·경기결과만 보존 — store 참고)

import type { Coach, Fixture, Player, Team } from '../types';
import { generateLeague } from './seed';
import { generateSeason } from '../engine/season';

const LEAGUE_SEED = 20251018;
const SEASON_SEED = 777;

export const LEAGUE = generateLeague(LEAGUE_SEED);
export const SEASON: Fixture[] = generateSeason(LEAGUE.teams.map((t) => t.id), SEASON_SEED);

const teamMap = new Map(LEAGUE.teams.map((t) => [t.id, t]));
const playerMap = new Map(LEAGUE.players.map((p) => [p.id, p]));
const coachMap = new Map(LEAGUE.coaches.map((c) => [c.id, c]));
const fixtureMap = new Map(SEASON.map((f) => [f.id, f]));

export const getTeam = (id: string): Team | undefined => teamMap.get(id);
export const getPlayer = (id: string): Player | undefined => playerMap.get(id);
export const getCoach = (id: string): Coach | undefined => coachMap.get(id);
export const getFixture = (id: string): Fixture | undefined => fixtureMap.get(id);

export const getTeamPlayers = (teamId: string): Player[] => {
  const t = teamMap.get(teamId);
  if (!t) return [];
  return t.players.map((pid) => playerMap.get(pid)!).filter(Boolean);
};

export const getTeamCoach = (teamId: string): Coach | undefined => {
  const t = teamMap.get(teamId);
  return t ? coachMap.get(t.coachId) : undefined;
};
