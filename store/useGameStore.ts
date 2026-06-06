// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 시즌 내 진화는 결정론 리플레이(currentDay), 시즌 경계에서 base 스냅샷을 커밋한다.
// 세이브: 선택 팀 / 시즌 / 현재 일자 / 결과 / 단장 거래 / 선수 base 스냅샷.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  commitPlayerBase,
  currentBasePlayers,
  focusOf,
  resetLeagueBase,
} from '../data/league';
import { rolloverLeague } from '../engine/rollover';
import type { Contract, MatchResult, Player } from '../types';

interface GameState {
  hydrated: boolean;
  selectedTeamId: string | null;
  season: number;                              // 0-based 경과 시즌
  currentDay: number;                          // 시즌 내 경과 일수
  results: Record<string, MatchResult>;
  contractOverrides: Record<string, Contract>;
  released: string[];
  playerBase: Record<string, Player> | null;   // 시즌 시작 시점 선수 스냅샷(null=시드)

  selectTeam: (teamId: string) => void;
  setDay: (day: number) => void;
  recordResult: (r: MatchResult) => void;
  reSign: (playerId: string, contract: Contract) => void;
  release: (playerId: string) => void;
  unrelease: (playerId: string) => void;
  endSeason: () => void;
  resetSave: () => void;
}

const freshSave = {
  selectedTeamId: null as string | null,
  season: 0,
  currentDay: 0,
  results: {} as Record<string, MatchResult>,
  contractOverrides: {} as Record<string, Contract>,
  released: [] as string[],
  playerBase: null as Record<string, Player> | null,
};

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      ...freshSave,

      selectTeam: (teamId) => {
        resetLeagueBase();
        set({ ...freshSave, selectedTeamId: teamId });
      },
      setDay: (day) => set((s) => ({ currentDay: Math.max(s.currentDay, day) })),
      recordResult: (r) => set((s) => ({ results: { ...s.results, [r.fixtureId]: r } })),
      reSign: (playerId, contract) =>
        set((s) => ({ contractOverrides: { ...s.contractOverrides, [playerId]: contract } })),
      release: (playerId) =>
        set((s) => (s.released.includes(playerId) ? s : { released: [...s.released, playerId] })),
      unrelease: (playerId) =>
        set((s) => ({ released: s.released.filter((id) => id !== playerId) })),

      endSeason: () => {
        const snapshot = rolloverLeague(currentBasePlayers(), focusOf, get().contractOverrides);
        commitPlayerBase(snapshot);
        set((s) => ({
          season: s.season + 1,
          currentDay: 0,
          results: {},
          contractOverrides: {},
          released: [],
          playerBase: snapshot,
        }));
      },

      resetSave: () => {
        resetLeagueBase();
        set({ ...freshSave });
      },
    }),
    {
      name: 'baeknyeon-save',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        selectedTeamId: s.selectedTeamId,
        season: s.season,
        currentDay: s.currentDay,
        results: s.results,
        contractOverrides: s.contractOverrides,
        released: s.released,
        playerBase: s.playerBase,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.playerBase) commitPlayerBase(state.playerBase);
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);
