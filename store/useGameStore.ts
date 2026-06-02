// 단일 zustand 스토어. 시뮬 상태가 크므로 화면에서는 selector로 부분 구독한다.
// 게임 로직은 /engine 에 둔다. 스토어는 상태 보관 + 엔진 호출 조정만.

import { create } from 'zustand';
import type { Player, Team } from '../types';

interface GameState {
  season: number;
  myTeamId: string | null;
  teams: Record<string, Team>;
  players: Record<string, Player>;

  // actions
  loadSeed: (teams: Team[], players: Player[], myTeamId: string) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  season: 1,
  myTeamId: null,
  teams: {},
  players: {},

  loadSeed: (teams, players, myTeamId) =>
    set({
      myTeamId,
      teams: Object.fromEntries(teams.map((t) => [t.id, t])),
      players: Object.fromEntries(players.map((p) => [p.id, p])),
    }),

  reset: () => set({ season: 1, myTeamId: null, teams: {}, players: {} }),
}));
