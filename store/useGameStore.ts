// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 리그/선수 진화는 결정론 시드 리플레이라 저장 불필요(data/league.ts).
// 세이브엔 선택 팀 / 현재 일자(currentDay) / 경기 결과만 보존한다.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { MatchResult } from '../types';

interface GameState {
  hydrated: boolean;
  selectedTeamId: string | null;
  currentDay: number;                       // 시즌 시작일로부터 경과 일수(진화 기준)
  results: Record<string, MatchResult>;     // fixtureId → 결과

  selectTeam: (teamId: string) => void;
  setDay: (day: number) => void;
  recordResult: (r: MatchResult) => void;
  resetSave: () => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      hydrated: false,
      selectedTeamId: null,
      currentDay: 0,
      results: {},

      selectTeam: (teamId) => set({ selectedTeamId: teamId, currentDay: 0, results: {} }),
      setDay: (day) => set((s) => ({ currentDay: Math.max(s.currentDay, day) })),
      recordResult: (r) =>
        set((s) => ({ results: { ...s.results, [r.fixtureId]: r } })),
      resetSave: () => set({ selectedTeamId: null, currentDay: 0, results: {} }),
    }),
    {
      name: 'baeknyeon-save',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        selectedTeamId: s.selectedTeamId,
        currentDay: s.currentDay,
        results: s.results,
      }),
      onRehydrateStorage: () => () => {
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);
