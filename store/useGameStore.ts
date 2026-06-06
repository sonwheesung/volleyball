// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 리그/선수 진화는 결정론 시드 리플레이라 저장 불필요(data/league.ts).
// 세이브엔 선택 팀 / 현재 일자 / 경기 결과 / 단장 거래(계약·방출)만 보존한다.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Contract, MatchResult } from '../types';

interface GameState {
  hydrated: boolean;
  selectedTeamId: string | null;
  currentDay: number;                          // 시즌 시작일로부터 경과 일수(진화 기준)
  results: Record<string, MatchResult>;        // fixtureId → 결과
  contractOverrides: Record<string, Contract>; // 재계약된 선수 계약(기본 위에 덮어씀)
  released: string[];                          // 방출된 선수 id

  selectTeam: (teamId: string) => void;
  setDay: (day: number) => void;
  recordResult: (r: MatchResult) => void;
  reSign: (playerId: string, contract: Contract) => void;
  release: (playerId: string) => void;
  unrelease: (playerId: string) => void;
  resetSave: () => void;
}

const freshSave = {
  selectedTeamId: null as string | null,
  currentDay: 0,
  results: {} as Record<string, MatchResult>,
  contractOverrides: {} as Record<string, Contract>,
  released: [] as string[],
};

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      hydrated: false,
      ...freshSave,

      selectTeam: (teamId) => set({ ...freshSave, selectedTeamId: teamId }),
      setDay: (day) => set((s) => ({ currentDay: Math.max(s.currentDay, day) })),
      recordResult: (r) => set((s) => ({ results: { ...s.results, [r.fixtureId]: r } })),
      reSign: (playerId, contract) =>
        set((s) => ({ contractOverrides: { ...s.contractOverrides, [playerId]: contract } })),
      release: (playerId) =>
        set((s) => (s.released.includes(playerId) ? s : { released: [...s.released, playerId] })),
      unrelease: (playerId) =>
        set((s) => ({ released: s.released.filter((id) => id !== playerId) })),
      resetSave: () => set({ ...freshSave }),
    }),
    {
      name: 'baeknyeon-save',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        selectedTeamId: s.selectedTeamId,
        currentDay: s.currentDay,
        results: s.results,
        contractOverrides: s.contractOverrides,
        released: s.released,
      }),
      onRehydrateStorage: () => () => {
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);
