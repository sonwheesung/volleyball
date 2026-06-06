// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 시즌 내 진화는 결정론 리플레이(currentDay), 시즌 경계에서 base 스냅샷을 커밋한다.
// 세이브: 선택 팀 / 시즌 / 현재 일자 / 결과 / 단장 거래 / 선수 base 스냅샷.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { commitPlayerBase, commitRosters, currentRosters, resetLeagueBase } from '../data/league';
import { buildOffseason } from '../data/offseason';
import { fillRosters } from '../data/rookies';
import { aiFillFromPool } from '../engine/aiGM';
import { assignFAGrades } from '../engine/faMarket';
import { needsCompensationPlayer, pickCompensation, PROTECT_COUNT } from '../engine/compensation';
import { renewedContract } from '../engine/rollover';
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
  faSignings: string[];                        // 오프시즌에 영입하기로 한 풀 FA id
  protectedIds: string[];                      // 보호선수 명단(최대 PROTECT_COUNT)

  selectTeam: (teamId: string) => void;
  setDay: (day: number) => void;
  recordResult: (r: MatchResult) => void;
  reSign: (playerId: string, contract: Contract) => void;
  release: (playerId: string) => void;
  unrelease: (playerId: string) => void;
  setResign: (playerId: string, keep: boolean) => void;
  signFA: (playerId: string) => void;
  unsignFA: (playerId: string) => void;
  toggleProtect: (playerId: string) => void;
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
  faSignings: [] as string[],
  protectedIds: [] as string[],
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
      signFA: (playerId) =>
        set((s) => (s.faSignings.includes(playerId) ? s : { faSignings: [...s.faSignings, playerId] })),
      unsignFA: (playerId) =>
        set((s) => ({ faSignings: s.faSignings.filter((id) => id !== playerId) })),
      toggleProtect: (playerId) =>
        set((s) => {
          if (s.protectedIds.includes(playerId))
            return { protectedIds: s.protectedIds.filter((id) => id !== playerId) };
          if (s.protectedIds.length >= PROTECT_COUNT) return s; // 정원 초과 무시
          return { protectedIds: [...s.protectedIds, playerId] };
        }),

      endSeason: () => {
        const { season, contractOverrides, selectedTeamId, resignDecisions, faSignings, protectedIds } = get();
        const nextSeason = season + 1;
        const my = selectedTeamId ?? '';

        // 영입 전 소속(보상 대상팀 판정)
        const committed = currentRosters();
        const prevTeamOf: Record<string, string> = {};
        for (const tid of Object.keys(committed)) for (const id of committed[tid]) prevTeamOf[id] = tid;

        // 1) 롤오버 + 은퇴 + FA 풀 형성 (FA 센터 프리뷰와 동일 소스)
        const off = buildOffseason(my, resignDecisions, contractOverrides, nextSeason);
        const snapshot = off.snapshot;
        const rosters: Record<string, string[]> = { ...off.rosters };
        const grades = assignFAGrades(off.pool.map((id) => snapshot[id]).filter(Boolean) as Player[]);

        // 2) 내가 선택한 FA 영입
        const remainingPool = new Set(off.pool);
        for (const id of faSignings) {
          if (!remainingPool.has(id)) continue;
          const p = snapshot[id];
          if (!p) continue;
          snapshot[id] = { ...p, contract: renewedContract(p) };
          rosters[my] = [...(rosters[my] ?? []), id];
          remainingPool.delete(id);
        }

        // 2.5) 보상선수: A/B 영입마다 내 비보호 1명이 원소속팀으로
        const taken: string[] = [];
        for (const id of faSignings) {
          if (off.pool.indexOf(id) < 0) continue;
          const grade = grades.get(id);
          if (!grade || !needsCompensationPlayer(grade)) continue;
          const prev = prevTeamOf[id];
          if (!prev || prev === my || !rosters[prev]) continue;
          const compId = pickCompensation(rosters[my] ?? [], protectedIds, snapshot, [...taken, id]);
          if (!compId) continue;
          taken.push(compId);
          rosters[my] = (rosters[my] ?? []).filter((x) => x !== compId);
          rosters[prev] = [...rosters[prev], compId];
        }

        // 3) AI가 남은 풀에서 빈자리 충원
        const aiFilled = aiFillFromPool(rosters, [...remainingPool], snapshot, my);

        // 4) 그래도 빈 자리는 신인으로
        const filled = fillRosters(aiFilled.rosters, (id) => snapshot[id], nextSeason);
        for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;

        // 5) 이적자 현 구단 근속 리셋(프랜차이즈 판정)
        for (const tid of Object.keys(filled.rosters)) {
          for (const id of filled.rosters[tid]) {
            const prev = prevTeamOf[id];
            if (prev && prev !== tid && snapshot[id]) snapshot[id] = { ...snapshot[id], clubTenure: 0 };
          }
        }

        commitPlayerBase(snapshot);
        commitRosters(filled.rosters);
        set({
          season: nextSeason,
          currentDay: 0,
          results: {},
          contractOverrides: {},
          released: [],
          resignDecisions: {},
          faSignings: [],
          protectedIds: [],
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
        faSignings: s.faSignings,
        protectedIds: s.protectedIds,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.playerBase) commitPlayerBase(state.playerBase);
        if (state?.rosters) commitRosters(state.rosters);
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);
