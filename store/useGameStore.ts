// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 시즌 내 진화는 결정론 리플레이(currentDay), 시즌 경계에서 base 스냅샷을 커밋한다.
// 세이브: 선택 팀 / 시즌 / 현재 일자 / 결과 / 단장 거래 / 선수 base 스냅샷.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  commitPlayerBase,
  commitRosters,
  currentBasePlayers,
  currentRosters,
  focusOf,
  resetLeagueBase,
} from '../data/league';
import { fillRosters } from '../data/rookies';
import { createRng } from '../engine/rng';
import { applyRetirements } from '../engine/retire';
import { rolloverLeague, renewedContract } from '../engine/rollover';
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
  rosters: Record<string, string[]> | null;    // 가변 팀 구성(null=시드)
  resignDecisions: Record<string, boolean>;    // 내 FA 잔류(true)/포기(false), 기본=잔류

  selectTeam: (teamId: string) => void;
  setDay: (day: number) => void;
  recordResult: (r: MatchResult) => void;
  reSign: (playerId: string, contract: Contract) => void;
  release: (playerId: string) => void;
  unrelease: (playerId: string) => void;
  setResign: (playerId: string, keep: boolean) => void;
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
  rosters: null as Record<string, string[]> | null,
  resignDecisions: {} as Record<string, boolean>,
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
      setResign: (playerId, keep) =>
        set((s) => ({ resignDecisions: { ...s.resignDecisions, [playerId]: keep } })),

      endSeason: () => {
        const { season, contractOverrides, selectedTeamId, resignDecisions } = get();
        const nextSeason = season + 1;
        // 1) 성장/노쇠/나이/계약 롤오버 (자격자는 만료=FA)
        const snapshot = rolloverLeague(currentBasePlayers(), focusOf, contractOverrides);
        // 2) 은퇴
        const retireRng = createRng(70000 + nextSeason * 977);
        const afterRetire = applyRetirements(currentRosters(), snapshot, retireRng);
        // 3) FA 처리: 내 팀은 잔류/포기 결정, AI는 자동 잔류
        const rosters: Record<string, string[]> = {};
        for (const teamId of Object.keys(afterRetire.rosters)) {
          const keep: string[] = [];
          for (const id of afterRetire.rosters[teamId]) {
            const p = snapshot[id];
            if (!p) continue;
            if (p.contract.remaining <= 0) {
              // FA: 내 팀이 '포기'면 떠남, 그 외(잔류/AI)는 재계약
              if (teamId === selectedTeamId && resignDecisions[id] === false) continue;
              snapshot[id] = { ...p, contract: renewedContract(p) };
            }
            keep.push(id);
          }
          rosters[teamId] = keep;
        }
        // 4) 빈 자리 신인 충원
        const filled = fillRosters(rosters, (id) => snapshot[id], nextSeason);
        for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;

        commitPlayerBase(snapshot);
        commitRosters(filled.rosters);
        set({
          season: nextSeason,
          currentDay: 0,
          results: {},
          contractOverrides: {},
          released: [],
          resignDecisions: {},
          playerBase: snapshot,
          rosters: filled.rosters,
        });
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
        rosters: s.rosters,
        resignDecisions: s.resignDecisions,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.playerBase) commitPlayerBase(state.playerBase);
        if (state?.rosters) commitRosters(state.rosters);
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);
