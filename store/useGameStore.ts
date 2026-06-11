// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 시즌 내 진화는 결정론 리플레이(currentDay), 시즌 경계에서 base 스냅샷을 커밋한다.
// 세이브: 선택 팀 / 시즌 / 현재 일자 / 결과 / 단장 거래 / 선수 base 스냅샷.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { commitPlayerBase, commitRosters, getTeam, resetLeagueBase, setFocusOverride,
  hireHeadCoach, hireAssistant as hireAsstLeague, releaseAssistant as releaseAsstLeague,
  hireScout as hireScoutLeague, releaseScout as releaseScoutLeague, commitStaff, getStaffState, teamScoutReveal } from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { leagueProduction } from '../data/production';
import { currentSeasonAwards } from '../data/awards';
import { detectSeasonMilestones } from '../data/milestones';
import { seasonInjuryDays } from '../data/injury';
import { setTxContext, seasonTxLog, availableFAsOnDay, type Tx } from '../data/dynamics';
import { buildPlayoffs } from '../data/playoffs';
import { currentRosters, evolveOnDay } from '../data/league';
import { marketValue } from '../engine/salary';
import { LEAGUE_CAP } from '../engine/cap';
import { ROSTER_MAX, canRelease, inSeasonCost } from '../engine/transactions';
import { accrueCareer, appendSeasonLine } from '../engine/production';
import { fillRosters } from '../data/rookies';
import { resolveDraft } from '../engine/draft';
import { applyMatchXp } from '../engine/experience';
import { PROTECT_COUNT } from '../engine/compensation';
import type { Contract, HofEntry, MatchResult, Milestone, Player, SeasonAwards, SubPolicy, TrainingFocus } from '../types';

const HOF_POINTS = 4000;   // 통산 득점 명예의전당 등재 기준
const LEGEND_POINTS = 9000; // 영구결번급

const DEFAULT_SUB_POLICY: SubPolicy = { pinchServer: true, blockSub: true, defSub: true };

interface GameState {
  hydrated: boolean;
  selectedTeamId: string | null;
  season: number;                              // 0-based 경과 시즌
  currentDay: number;                          // 시즌 내 경과 일수
  results: Record<string, MatchResult>;
  contractOverrides: Record<string, Contract>;
  released: string[];
  inSeasonTx: Tx[];                            // 시즌 중 이동(방출/영입) — dynamics 주입
  faPool: string[];                            // 시즌 시작 미계약 FA 풀(오프시즌 잔류)
  playerBase: Record<string, Player> | null;   // 시즌 시작 시점 선수 스냅샷(null=시드)
  rosters: Record<string, string[]> | null;    // 가변 팀 구성(null=시드)
  resignDecisions: Record<string, boolean>;    // 내 FA 잔류(true)/포기(false), 기본=잔류
  faSignings: string[];                        // 오프시즌에 영입 시도할 풀 FA id
  faAggressive: boolean;                       // 공격적 영입(연봉↑로 경쟁 우위)
  protectedIds: string[];                      // 보호선수 명단(최대 PROTECT_COUNT)
  draftPicks: string[];                        // 드래프트 지명 위시리스트(우선순위)
  archive: { season: number; championId: string; awards?: SeasonAwards }[]; // 역대 우승 + 시상
  hallOfFame: HofEntry[];                      // 명예의전당(은퇴 레전드 통산 기록)
  milestones: Milestone[];                     // 기록 경신 피드(MILESTONE_SYSTEM)
  subPolicy: SubPolicy;                        // 내 팀 작전 교체 방침(경기 적용)
  trainingFocus: TrainingFocus | null;         // 단장이 고른 내 팀 훈련 방향(null=감독 기본)
  staffHead: Record<string, string>;           // teamId → 영입 감독 id(STAFF_SYSTEM)
  staffAssistants: Record<string, string[]>;   // teamId → 영입 코치 ids
  staffScouts: Record<string, string[]>;       // teamId → 영입 스카우터 ids

  selectTeam: (teamId: string) => void;
  setDay: (day: number) => void;
  recordResult: (r: MatchResult) => void;
  reSign: (playerId: string, contract: Contract) => void;
  release: (playerId: string) => boolean;
  unrelease: (playerId: string) => boolean;
  signInSeason: (faId: string) => boolean;
  setResign: (playerId: string, keep: boolean) => void;
  signFA: (playerId: string) => void;
  unsignFA: (playerId: string) => void;
  setAggressive: (on: boolean) => void;
  toggleProtect: (playerId: string) => void;
  toggleDraftPick: (playerId: string) => void;
  recordChampion: (season: number, championId: string) => void;
  setSubPolicy: (policy: Partial<SubPolicy>) => void;
  setTrainingFocus: (focus: TrainingFocus | null) => void;
  hireCoach: (coachId: string) => boolean;
  hireAssistant: (id: string) => boolean;
  releaseAssistant: (id: string) => void;
  hireScout: (id: string) => boolean;
  releaseScout: (id: string) => void;
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
  inSeasonTx: [] as Tx[],
  faPool: [] as string[],
  playerBase: null as Record<string, Player> | null,
  rosters: null as Record<string, string[]> | null,
  resignDecisions: {} as Record<string, boolean>,
  faSignings: [] as string[],
  faAggressive: false,
  protectedIds: [] as string[],
  draftPicks: [] as string[],
  archive: [] as { season: number; championId: string; awards?: SeasonAwards }[],
  hallOfFame: [] as HofEntry[],
  milestones: [] as Milestone[],
  subPolicy: { ...DEFAULT_SUB_POLICY } as SubPolicy,
  trainingFocus: null as TrainingFocus | null,
  staffHead: {} as Record<string, string>,
  staffAssistants: {} as Record<string, string[]>,
  staffScouts: {} as Record<string, string[]>,
};

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      ...freshSave,

      selectTeam: (teamId) => {
        resetLeagueBase();
        set({ ...freshSave, selectedTeamId: teamId });
        setTxContext([], [], teamId);
      },
      setDay: (day) => set((s) => ({ currentDay: Math.max(s.currentDay, day) })),
      recordResult: (r) => set((s) => ({ results: { ...s.results, [r.fixtureId]: r } })),
      reSign: (playerId, contract) =>
        set((s) => ({ contractOverrides: { ...s.contractOverrides, [playerId]: contract } })),
      // 시즌 중 방출 → FA 풀(dynamics가 영입 가능하게). released[]는 표시용, inSeasonTx는 시뮬용.
      // 정원 하한(ROSTER_MIN) 게이트 — 명단이 비어 경기 불가가 되는 상태를 원천 차단.
      release: (playerId) => {
        const s = get();
        if (s.released.includes(playerId)) return false;
        const my = s.selectedTeamId ?? '';
        const rosterIds = currentRosters()[my] ?? [];
        const myReleased = new Set(s.inSeasonTx.filter((t) => t.kind === 'release' && t.teamId === my).map((t) => t.playerId));
        const mySigned = s.inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === my).map((t) => t.playerId);
        const size = (rosterIds.length - myReleased.size) + mySigned.length;
        if (!canRelease(size)) return false;
        const inSeasonTx: Tx[] = [...s.inSeasonTx, { day: s.currentDay, teamId: my, playerId, kind: 'release' }];
        set({ released: [...s.released, playerId], inSeasonTx });
        setTxContext(inSeasonTx, get().faPool, my);
        return true;
      },
      // 방출 철회는 당일만 — 다음 날부터는 리플레이가 이미 그 명단으로 경기를 굴렸으므로
      // 철회하면 과거 경기 결과가 소급 변경된다(거래 이후 AI 영입 연쇄 포함).
      unrelease: (playerId) => {
        const s = get();
        const tx = s.inSeasonTx.find((t) => t.kind === 'release' && t.playerId === playerId);
        if (!tx || tx.day !== s.currentDay) return false;
        const inSeasonTx = s.inSeasonTx.filter((t) => !(t.kind === 'release' && t.playerId === playerId));
        set({ released: s.released.filter((id) => id !== playerId), inSeasonTx });
        setTxContext(inSeasonTx, get().faPool, get().selectedTeamId ?? '');
        return true;
      },
      // 시즌 중 FA 영입(캡·정원 검증). dynamics는 플레이어 거래를 검증 없이 적용하므로 여기서 게이트.
      signInSeason: (faId) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my) return false;
        if (s.inSeasonTx.some((t) => t.kind === 'sign' && t.playerId === faId)) return false;
        // FA 풀 멤버십 검증 — 풀 밖 id(타 팀 소속 선수 등)를 영입하면 한 선수가 두 명단에 존재하게 된다
        if (!availableFAsOnDay(s.currentDay).includes(faId)) return false;
        const fa = evolveOnDay(faId, s.currentDay);
        if (!fa) return false;
        const rosterIds = currentRosters()[my] ?? [];
        const myReleased = new Set(s.inSeasonTx.filter((t) => t.kind === 'release' && t.teamId === my).map((t) => t.playerId));
        const mySigned = s.inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === my).map((t) => t.playerId);
        const size = (rosterIds.length - myReleased.size) + mySigned.length;
        if (size >= ROSTER_MAX) return false;
        // 배신 웃돈: 내가 이번 시즌 방출한 선수의 재영입은 몸값 ×1.5 (당일 철회는 unrelease로 무료)
        const betrayedBy = (id: string) => s.inSeasonTx.some((t) => t.kind === 'release' && t.teamId === my && t.playerId === id);
        let payroll = 0;
        for (const id of rosterIds) if (!myReleased.has(id)) payroll += evolveOnDay(id, s.currentDay)?.contract.salary ?? 0;
        for (const id of mySigned) { const p = evolveOnDay(id, s.currentDay); if (p) payroll += inSeasonCost(marketValue(p), betrayedBy(id)); }
        if (payroll + inSeasonCost(marketValue(fa), betrayedBy(faId)) > LEAGUE_CAP) return false;
        const inSeasonTx: Tx[] = [...s.inSeasonTx, { day: s.currentDay, teamId: my, playerId: faId, kind: 'sign' }];
        set({ inSeasonTx });
        setTxContext(inSeasonTx, get().faPool, my);
        return true;
      },
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
      setTrainingFocus: (focus) => {
        const tid = get().selectedTeamId;
        if (tid) setFocusOverride(tid, focus);
        set({ trainingFocus: focus });
      },
      // 스태프 계약(STAFF_SYSTEM) — league가 예산·중복을 판정하고, 성공 시 상태를 동기화
      hireCoach: (coachId) => {
        const tid = get().selectedTeamId;
        if (!tid) return false;
        const ok = hireHeadCoach(tid, coachId);
        if (ok) { const s = getStaffState(); set({ staffHead: s.head, staffAssistants: s.asst, staffScouts: s.scout }); }
        return ok;
      },
      hireAssistant: (id) => {
        const tid = get().selectedTeamId;
        if (!tid) return false;
        const ok = hireAsstLeague(tid, id);
        if (ok) set({ staffAssistants: getStaffState().asst });
        return ok;
      },
      releaseAssistant: (id) => {
        const tid = get().selectedTeamId;
        if (!tid) return;
        releaseAsstLeague(tid, id);
        set({ staffAssistants: getStaffState().asst });
      },
      hireScout: (id) => {
        const tid = get().selectedTeamId;
        if (!tid) return false;
        const ok = hireScoutLeague(tid, id);
        if (ok) set({ staffScouts: getStaffState().scout });
        return ok;
      },
      releaseScout: (id) => {
        const tid = get().selectedTeamId;
        if (!tid) return;
        releaseScoutLeague(tid, id);
        set({ staffScouts: getStaffState().scout });
      },

      endSeason: () => {
        const { season, contractOverrides, selectedTeamId, resignDecisions, faSignings, faAggressive, protectedIds, draftPicks, hallOfFame, archive, milestones } = get();
        const nextSeason = season + 1;
        const my = selectedTeamId ?? '';

        // 0) 시상식·마일스톤 — 롤오버 전(끝난 시즌의 base·생산이 살아있을 때) 계산해 영구 보존
        const seasonAwards = currentSeasonAwards(season);
        // 0.4) 시즌 중 이동(방출/영입, 플레이어+AI)을 명단에 영구 반영 — 오프시즌(롤오버) 전.
        //   seasonTxLog는 반드시 commitRosters 전에 읽는다(commit이 dynamics 재계산을 유발).
        const txLog = seasonTxLog();
        const finalR: Record<string, string[]> = {};
        const cur = currentRosters();
        for (const tid of Object.keys(cur)) finalR[tid] = [...cur[tid]];
        for (const tx of txLog) {
          const arr = finalR[tx.teamId] ?? [];
          if (tx.kind === 'release') finalR[tx.teamId] = arr.filter((id) => id !== tx.playerId);
          else if (!arr.includes(tx.playerId)) finalR[tx.teamId] = [...arr, tx.playerId];
        }
        commitRosters(finalR);
        // 마일스톤: big(역대·구단·레전드)은 영구 보존, 일반 통산 임계는 최근 300건만(방치형 장기 저장 바운딩)
        const allMs = [...milestones, ...detectSeasonMilestones(season, hallOfFame)];
        const nextMilestones = [...allMs.filter((m) => m.big), ...allMs.filter((m) => !m.big).slice(-300)]
          .sort((a, b) => a.season - b.season);
        const injuryDays = seasonInjuryDays(); // 만성 노쇠가속(약) — 큰 부상 선수 영구 소폭 하락
        const championId = buildPlayoffs(season).championId ?? '';
        const nextArchive = archive.some((a) => a.season === season)
          ? archive.map((a) => (a.season === season ? { ...a, championId: championId || a.championId, awards: seasonAwards } : a))
          : [...archive, { season, championId, awards: seasonAwards }];

        // 1) 롤오버·은퇴·경쟁FA(영입/보상)·순번·클래스 (드래프트 센터와 동일 소스)
        const ctx = buildDraftContext(my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, nextSeason);
        const snapshot = ctx.snapshot;

        // 2) 드래프트 해석(내 위시리스트 + AI 자동, 순번 존중)
        const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
        const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], my, draftPicks, styleOf, teamScoutReveal);
        for (const p of drafted.picked) snapshot[p.id] = p;

        // 3) 클래스 소진 등 남은 빈자리 신인 자동 충원
        const filled = fillRosters(drafted.rosters, (id) => snapshot[id], nextSeason);
        for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;

        // 3.5) 이번 시즌 경기 출전·생산 → 성장 경험치 적립
        const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
        for (const tid of Object.keys(filled.rosters)) {
          for (const id of filled.rosters[tid]) {
            const pr = seasonProd.get(id);
            // 시즌 라인의 소속은 "이번 시즌을 뛴 팀"(prevTeamOf) — filled.rosters(tid)는 다음 시즌 명단이라 FA 이적자가 새 팀으로 잘못 적힘
            if (pr && snapshot[id]) snapshot[id] = appendSeasonLine(accrueCareer(applyMatchXp(snapshot[id], pr), pr), season, ctx.prevTeamOf[id] ?? tid, pr); // 성장 XP + 통산 누적 + 시즌별 기록 라인
          }
        }

        // 3.6) 은퇴 레전드 명예의전당 등재(마지막 시즌까지 누적 후 기준 충족 시)
        const hofAdds: HofEntry[] = [];
        for (const id of ctx.retired) {
          const base = snapshot[id];
          if (!base) continue;
          const c = accrueCareer(base, seasonProd.get(id)).career;
          if (c.points >= HOF_POINTS) {
            hofAdds.push({
              id, name: base.name, position: base.position, teamId: ctx.prevTeamOf[id] ?? '',
              seasons: c.seasons, points: c.points, blocks: c.blocks, digs: c.digs,
              retiredSeason: season, legend: c.points >= LEGEND_POINTS,
            });
          }
        }

        // 4) 이적자 현 구단 근속 리셋(프랜차이즈 판정)
        for (const tid of Object.keys(filled.rosters)) {
          for (const id of filled.rosters[tid]) {
            const prev = ctx.prevTeamOf[id];
            if (prev && prev !== tid && snapshot[id]) snapshot[id] = { ...snapshot[id], clubTenure: 0 };
          }
        }

        // 4.5) 만성 노쇠가속(약) — 큰 부상(7경기↑ 결장) 선수는 점프력 영구 -1.
        //   staminaMax는 건드리지 않음(부상위험 피드백 스파이럴 차단).
        for (const id of Object.keys(snapshot)) {
          if ((injuryDays.get(id) ?? 0) >= 7 && snapshot[id]) {
            const p = snapshot[id];
            snapshot[id] = { ...p, jump: Math.max(25, p.jump - 1) };
          }
        }

        // 4.6) 다음 시즌 FA 풀 = 롤오버됐으나 미계약(로스터 외)·비은퇴 선수(오프시즌 잔류 FA)
        const rosteredNext = new Set(Object.values(filled.rosters).flat());
        const retiredSet = new Set(ctx.retired);
        const nextFaPool = Object.keys(snapshot).filter((id) => !rosteredNext.has(id) && !retiredSet.has(id));

        commitPlayerBase(snapshot);
        commitRosters(filled.rosters);
        setTxContext([], nextFaPool, my); // 새 시즌: 거래 초기화 + FA 풀 주입
        set({
          season: nextSeason,
          currentDay: 0,
          results: {},
          contractOverrides: {},
          released: [],
          inSeasonTx: [],
          faPool: nextFaPool,
          resignDecisions: {},
          faSignings: [],
          faAggressive: false,
          protectedIds: [],
          draftPicks: [],
          playerBase: snapshot,
          rosters: filled.rosters,
          hallOfFame: [...hallOfFame, ...hofAdds],
          archive: nextArchive,
          milestones: nextMilestones,
        });
      },

      resetSave: () => {
        resetLeagueBase();
        setTxContext([], [], '');
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
        inSeasonTx: s.inSeasonTx,
        faPool: s.faPool,
        playerBase: s.playerBase,
        rosters: s.rosters,
        resignDecisions: s.resignDecisions,
        faSignings: s.faSignings,
        faAggressive: s.faAggressive,
        protectedIds: s.protectedIds,
        draftPicks: s.draftPicks,
        archive: s.archive,
        hallOfFame: s.hallOfFame,
        milestones: s.milestones,
        subPolicy: s.subPolicy,
        trainingFocus: s.trainingFocus,
        staffHead: s.staffHead,
        staffAssistants: s.staffAssistants,
        staffScouts: s.staffScouts,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.playerBase) commitPlayerBase(state.playerBase);
        if (state?.rosters) commitRosters(state.rosters);
        if (state?.selectedTeamId && state?.trainingFocus) setFocusOverride(state.selectedTeamId, state.trainingFocus);
        if (state?.staffHead || state?.staffAssistants || state?.staffScouts) commitStaff(state.staffHead ?? {}, state.staffAssistants ?? {}, state.staffScouts ?? {});
        setTxContext(state?.inSeasonTx ?? [], state?.faPool ?? [], state?.selectedTeamId ?? '');
        useGameStore.setState({ hydrated: true });
      },
    },
  ),
);
