// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 리그 데이터(선수/팀/일정)는 결정론 시드라 저장 불필요 → data/league.ts 참조.
// 여기서는 선택 팀 / 진행도(progressIndex) / 경기 결과만 보존한다.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { MatchResult } from '../types';

interface GameState {
  hydrated: boolean;
  selectedTeamId: string | null;
  progressIndex: number;                    // 선택 팀 일정에서 다음에 처리할 항목 인덱스
  results: Record<string, MatchResult>;     // fixtureId → 결과

  selectTeam: (teamId: string) => void;
  setProgress: (i: number) => void;
  recordResult: (r: MatchResult) => void;
  resetSave: () => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      hydrated: false,
      selectedTeamId: null,
      progressIndex: 0,
      results: {},

      selectTeam: (teamId) => set({ selectedTeamId: teamId, progressIndex: 0, results: {} }),
      setProgress: (i) => set({ progressIndex: i }),
      recordResult: (r) =>
        set((s) => ({ results: { ...s.results, [r.fixtureId]: r } })),
      resetSave: () => set({ selectedTeamId: null, progressIndex: 0, results: {} }),
    }),
    {
      name: 'baeknyeon-save',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        selectedTeamId: s.selectedTeamId,
        progressIndex: s.progressIndex,
        results: s.results,
      }),
      onRehydrateStorage: () => () => {
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);
