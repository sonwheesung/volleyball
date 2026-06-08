// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 시즌 내 진화는 결정론 리플레이(currentDay), 시즌 경계에서 base 스냅샷을 커밋한다.
// 세이브: 선택 팀 / 시즌 / 현재 일자 / 결과 / 단장 거래 / 선수 base 스냅샷.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { commitPlayerBase, commitRosters, getTeam, resetLeagueBase } from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { leagueProduction } from '../data/production';
import { fillRosters } from '../data/rookies';
import { resolveDraft } from '../engine/draft';
import { applyMatchXp } from '../engine/experience';
import { PROTECT_COUNT } from '../engine/compensation';
import type { Contract, MatchResult, Player, SubPolicy } from '../types';

const DEFAULT_SUB_POLICY: SubPolicy = { pinchServer: true, blockSub: true, defSub: true };

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
  faSignings: string[];                        // 오프시즌에 영입 시도할 풀 FA id
  faAggressive: boolean;                       // 공격적 영입(연봉↑로 경쟁 우위)
  protectedIds: string[];                      // 보호선수 명단(최대 PROTECT_COUNT)
  draftPicks: string[];                        // 드래프트 지명 위시리스트(우선순위)
  archive: { season: number; championId: string }[]; // 역대 우승
  subPolicy: SubPolicy;                        // 내 팀 작전 교체 방침(경기 적용)

  selectTeam: (teamId: string) => void;
  setDay: (day: number) => void;
  recordResult: (r: MatchResult) => void;
  reSign: (playerId: string, contract: Contract) => void;
  release: (playerId: string) => void;
  unrelease: (playerId: string) => void;
  setResign: (playerId: string, keep: boolean) => void;
  signFA: (playerId: string) => void;
  unsignFA: (playerId: string) => void;
  setAggressive: (on: boolean) => void;
  toggleProtect: (playerId: string) => void;
  toggleDraftPick: (playerId: string) => void;
  recordChampion: (season: number, championId: string) => void;
  setSubPolicy: (policy: Partial<SubPolicy>) => void;
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
  faAggressive: false,
  protectedIds: [] as string[],
  draftPicks: [] as string[],
  archive: [] as { season: number; championId: string }[],
  subPolicy: { ...DEFAULT_SUB_POLICY } as SubPolicy,
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
      setAggressive: (on) => set({ faAggressive: on }),
      toggleProtect: (playerId) =>
        set((s) => {
          if (s.protectedIds.includes(playerId))
            return { protectedIds: s.protectedIds.filter((id) => id !== playerId) };
          if (s.protectedIds.length >= PROTECT_COUNT) return s; // 정원 초과 무시
          return { protectedIds: [...s.protectedIds, playerId] };
        }),
      toggleDraftPick: (playerId) =>
        set((s) =>
          s.draftPicks.includes(playerId)
            ? { draftPicks: s.draftPicks.filter((id) => id !== playerId) }
            : { draftPicks: [...s.draftPicks, playerId] },
        ),
      recordChampion: (season, championId) =>
        set((s) =>
          s.archive.some((a) => a.season === season)
            ? s
            : { archive: [...s.archive, { season, championId }] },
        ),
      setSubPolicy: (policy) => set((s) => ({ subPolicy: { ...s.subPolicy, ...policy } })),

      endSeason: () => {
        const { season, contractOverrides, selectedTeamId, resignDecisions, faSignings, faAggressive, protectedIds, draftPicks } = get();
        const nextSeason = season + 1;
        const my = selectedTeamId ?? '';

        // 1) 롤오버·은퇴·경쟁FA(영입/보상)·순번·클래스 (드래프트 센터와 동일 소스)
        const ctx = buildDraftContext(my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, nextSeason);
        const snapshot = ctx.snapshot;

        // 2) 드래프트 해석(내 위시리스트 + AI 자동, 순번 존중)
        const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
        const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], my, draftPicks, styleOf);
        for (const p of drafted.picked) snapshot[p.id] = p;

        // 3) 클래스 소진 등 남은 빈자리 신인 자동 충원
        const filled = fillRosters(drafted.rosters, (id) => snapshot[id], nextSeason);
        for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;

        // 3.5) 이번 시즌 경기 출전·생산 → 성장 경험치 적립
        const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
        for (const tid of Object.keys(filled.rosters)) {
          for (const id of filled.rosters[tid]) {
            const pr = seasonProd.get(id);
            if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
          }
        }

        // 4) 이적자 현 구단 근속 리셋(프랜차이즈 판정)
        for (const tid of Object.keys(filled.rosters)) {
          for (const id of filled.rosters[tid]) {
            const prev = ctx.prevTeamOf[id];
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
          faAggressive: false,
          protectedIds: [],
          draftPicks: [],
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
        faAggressive: s.faAggressive,
        protectedIds: s.protectedIds,
        draftPicks: s.draftPicks,
        archive: s.archive,
        subPolicy: s.subPolicy,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.playerBase) commitPlayerBase(state.playerBase);
        if (state?.rosters) commitRosters(state.rosters);
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);
