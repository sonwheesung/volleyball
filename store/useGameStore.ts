// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 시즌 내 진화는 결정론 리플레이(currentDay), 시즌 경계에서 base 스냅샷을 커밋한다.
// 세이브: 선택 팀 / 시즌 / 현재 일자 / 결과 / 단장 거래 / 선수 base 스냅샷.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { SAVE_VERSION, migrateSave } from './saveMigration';
import { accrueBonds, setRelationContext } from '../data/relationships';
import { commitPlayerBase, commitRosters, getTeam, resetLeagueBase, setFocusOverride,
  hireHeadCoach, hireAssistant as hireAsstLeague, releaseAssistant as releaseAsstLeague,
  hireScout as hireScoutLeague, releaseScout as releaseScoutLeague, commitStaff, getStaffState, teamScoutReveal,
  currentCoachPool, commitCoachPool, assignCoach, reconcileStaff, resignTeamCoach, fireCoach as fireCoachLeague, getTeamCoach, grantStartingStaff, LEAGUE } from '../data/league';
import { advanceCoaches } from '../data/staffLifecycle';
import { bottomStreak } from '../engine/staffLifecycle';
import { SEASON_DAYS } from '../engine/calendar';
import type { Coach, AssistantCoach } from '../types';
import { buildDraftContext } from '../data/draftSetup';
import { leagueProduction } from '../data/production';
import { currentSeasonAwards } from '../data/awards';
import { detectSeasonMilestones } from '../data/milestones';
import { seasonInjuryDays, availableTeamPlayers } from '../data/injury';
import { buildLineup } from '../engine/lineup';
import { setTxContext, setOwnerContext, seasonTxLog, seasonScandals, availableFAsOnDay, rosterIdsOnDay, type Tx } from '../data/dynamics';
import { captureSimCache, restoreSimCache } from '../data/simCache';
import {
  meetAccept, persuade, cardMatch,
  benchAccept, startSuggestAccept, popularityOf, benchAngerPenalty, releaseAngerPenalty, fanScore as fanScoreOf, BENCH_MAX,
  TALK_COOLDOWN_DAYS, BENCH_COOLDOWN_DAYS,
  type DiscontentTopic, type TalkCard, type InterviewLog, type BenchDirective, type BenchReason, type OwnerFx,
} from '../engine/owner';
import { discontentNow, teamFanbaseNow, buildOwnerFx } from '../data/owner';
import { settleSeason, applyNet, type SeasonFinance } from '../engine/finance';
import { FOREIGN_SALARY, ASIAN_SALARY } from '../engine/foreign';
import { staffSpend, setMyTeamStaff } from '../data/league';
import { overall } from '../engine/overall';
import { awardHistoryOf } from '../data/awards';
import { computeStandings, seasonStreaks, seasonResults } from '../data/standings';
import { coachInfoOf } from '../data/league';
import { buildPlayoffs, seriesByTeam } from '../data/playoffs';
import { currentRosters, evolveOnDay, getPlayer, SEASON } from '../data/league';
import { planNextAction } from '../engine/advance';
import { marketVal, setAwardScores } from '../data/awardSalary';
import { LEAGUE_CAP, maxSalaryFor } from '../engine/cap';
import { ROSTER_MAX, canRelease, inSeasonCost, severanceFee } from '../engine/transactions';
import { accrueCareer, appendSeasonLine } from '../engine/production';
import { fillRosters } from '../data/rookies';
import { resolveDraft } from '../engine/draft';
import { applyMatchXp } from '../engine/experience';
import { PROTECT_COUNT } from '../engine/compensation';
import type { Contract, ExpelRecord, HofEntry, MatchResult, Milestone, Player, RetireRecord, SeasonArchive, SeasonAwards, TrainingFocus, Transfer } from '../types';

const HOF_POINTS = 4000;   // 통산 득점 명예의전당 등재 기준
const RETIRE_NEWS_MIN_SEASONS = 8; // 작별 뉴스 대상 — 8시즌+ 뛴 노장(또는 HOF). 버스트(단명)는 무음
const LEGEND_POINTS = 7500; // 영구결번급 — 60시즌 통산 최고 ~8645라 9000은 도달 불가였음(레전드 0명).
                            //   7500 = 60시즌당 ~2명(top 8645·7723) → 영구결번 ~30시즌당 1명 + league 마일스톤(레전드 추월) 가능
const SEASON_END_DAY = SEASON_DAYS; // 정규시즌 길이(일) — 출전비율·팬심 계산 기준. 단일 출처(engine/calendar)
const GAME_EVERY = 4.6;     // 평균 경기 간격(일)

interface GameState {
  hydrated: boolean;
  onboarded: boolean;                          // 온보딩(첫 안내) 완료 — 세이브와 별개(초기화해도 유지)
  supporter: boolean;                          // 서포터 팩(비소모성 IAP) 보유 — 구매 자산이라 초기화해도 유지
  sfxEnabled: boolean;                         // 경기 효과음(휘슬·스파이크·서브) 켬 — 사용자 환경설정(초기화해도 유지)
  seenTips: Record<string, true>;              // 본 스포트라이트 스텝 id 집합(ONBOARDING) — 세이브와 별개(초기화해도 유지)
  selectedTeamId: string | null;
  season: number;                              // 0-based 경과 시즌
  currentDay: number;                          // 시즌 내 경과 일수
  results: Record<string, MatchResult>;
  watchProgress: Record<string, number>;       // fixtureId → 관전한 랠리 인덱스(이어보기). 종료/확정 시 삭제
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
  moneyOnlyIds: string[];                      // '돈만' 보상 선택 A/B FA id — 보상선수 면제·보상금 가중(FA_SYSTEM 2.2)
  draftPicks: string[];                        // 드래프트 지명 위시리스트(우선순위)
  archive: SeasonArchive[];                    // 역대 우승 + 시상 + 순위/연승연패/플옵
  careerLog: { faSigns: number; coachHires: number; staffHires: number; interviews: number }; // 단장 통산 액션(업적용)
  careerTotals: { points: number; aces: number; setsWon: number; setsLost: number; matchWins: number; matchLosses: number }; // 내 팀 통산 경기 기록(업적용)
  bonds: Record<string, number>; // 인간관계 우정(pairKey→0~0.3, 함께한 세월 누적, RELATIONSHIP_SYSTEM)
  coachPool: { coaches: Coach[]; assistants: AssistantCoach[] } | null; // 감독 생애주기 풀(null=시드, STAFF_SYSTEM 6)
  hallOfFame: HofEntry[];                      // 명예의전당(은퇴 레전드 통산 기록)
  expelledLog: ExpelRecord[];                  // 영구제명 연표(승부조작·학폭 — 불명예 퇴출, 뉴스/서사용)
  transfers: Transfer[];                       // FA 이적 연표(오프시즌 팀 이동, 뉴스 슬라이스3)
  retirements: RetireRecord[];                 // 은퇴 연표(주목 은퇴자 작별·회고, 뉴스 슬라이스5)
  milestones: Milestone[];                     // 기록 경신 피드(MILESTONE_SYSTEM)
  readNews: string[];                          // 읽은 뉴스 키(season:kind:headline) — 읽음/안읽음 구분(NEWS_SYSTEM)
  trainingFocus: TrainingFocus | null;         // 단장이 고른 내 팀 훈련 방향(null=감독 기본)
  staffHead: Record<string, string>;           // teamId → 영입 감독 id(STAFF_SYSTEM)
  staffAssistants: Record<string, string[]>;   // teamId → 영입 코치 ids
  staffScouts: Record<string, string[]>;       // teamId → 영입 스카우터 ids
  interviews: InterviewLog[];                  // 구단주 면담 로그(OWNER_SYSTEM) — FA 판정 입력
  benchDirectives: BenchDirective[];           // 감독 수락된 벤치 지시 — dynamics 주입
  talkCooldown: Record<string, number>;        // playerId → 재면담 가능 day(쿨다운, OWNER_SYSTEM)
  benchCooldown: Record<string, number>;       // playerId → 재건의(주전/벤치) 가능 day
  fanScore: number;                            // 내 팀 팬심(직전 시즌 결과, 0~100)
  releaseAnger: number;                        // 이번 시즌 스타 방출로 적립된 팬 분노(방출 시점 인기로 계산, endSeason서 fanScore에 반영·리셋)
  cash: number;                                // 운영 자금(FINANCE) — 캡과 별개의 지갑
  lastFinance: SeasonFinance | null;           // 직전 시즌 정산 내역(표시용)
  tryoutWish: string[];                        // 외국인 트라이아웃 위시리스트(우선순위)
  foreignAltPool: string[];                    // 시즌 중 교체 대체 외인 후보
  foreignSubUsed: boolean;                     // 외인 교체는 시즌당 1회
  keepForeign: boolean | null;                 // 외인 재계약 결정(null=자동 — AI 판단)
  asianWish: string[];                         // 아시아쿼터 트라이아웃 위시리스트(우선순위)
  asianAltPool: string[];                      // 시즌 중 교체 대체 아시아쿼터 후보
  asianSubUsed: boolean;                       // 아시아쿼터 교체는 시즌당 1회
  keepAsian: boolean | null;                   // 아시아쿼터 재계약 결정(null=자동)

  selectTeam: (teamId: string) => void;
  setDay: (day: number) => void;
  recordResult: (r: MatchResult) => void;
  saveWatchProgress: (fixtureId: string, idx: number) => void; // 이어보기 위치 저장
  clearWatchProgress: (fixtureId: string) => void;             // 종료·결과 확정 시 삭제
  reSign: (playerId: string, contract: Contract) => void;
  release: (playerId: string) => boolean;
  unrelease: (playerId: string) => boolean;
  signInSeason: (faId: string) => boolean;
  setResign: (playerId: string, keep: boolean) => void;
  signFA: (playerId: string) => void;
  unsignFA: (playerId: string) => void;
  setAggressive: (on: boolean) => void;
  toggleProtect: (playerId: string) => void;
  toggleMoneyOnly: (playerId: string) => void;
  toggleDraftPick: (playerId: string) => void;
  recordChampion: (season: number, championId: string) => void;
  markNewsRead: (keys: string[]) => void;
  setTrainingFocus: (focus: TrainingFocus | null) => void;
  hireCoach: (coachId: string) => boolean;
  resignCoach: () => boolean;
  fireCoach: () => { acting: string | null };
  hireAssistant: (id: string) => boolean;
  releaseAssistant: (id: string) => void;
  hireScout: (id: string) => boolean;
  releaseScout: (id: string) => void;
  requestInterview: (playerId: string, card: TalkCard) => { met: boolean; topic: DiscontentTopic | null; ok?: boolean };
  suggestBench: (playerId: string, reason: BenchReason) => boolean;
  suggestStart: (playerId: string) => boolean;
  unbench: (playerId: string) => void;
  toggleTryoutWish: (playerId: string) => void;
  replaceForeign: (altId: string) => boolean;
  setKeepForeign: (keep: boolean | null) => void;
  toggleAsianWish: (playerId: string) => void;
  replaceAsian: (altId: string) => boolean;
  setKeepAsian: (keep: boolean | null) => void;
  endSeason: () => void;
  resetSave: () => void;
  completeOnboarding: () => void;
  replayOnboarding: () => void;
  markTip: (id: string) => void;               // 스포트라이트 스텝 1개 완료(ONBOARDING)
  resetTips: () => void;                        // 스포트라이트 전체 리셋(설정 "튜토리얼 다시보기")
  grantSupporter: () => void;
  setSupporter: (v: boolean) => void;
  setSfx: (v: boolean) => void;
}

const freshSave = {
  selectedTeamId: null as string | null,
  season: 0,
  currentDay: 0,
  results: {} as Record<string, MatchResult>,
  watchProgress: {} as Record<string, number>,
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
  moneyOnlyIds: [] as string[],
  draftPicks: [] as string[],
  archive: [] as SeasonArchive[],
  careerLog: { faSigns: 0, coachHires: 0, staffHires: 0, interviews: 0 },
  careerTotals: { points: 0, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 },
  bonds: {} as Record<string, number>,
  coachPool: null as { coaches: Coach[]; assistants: AssistantCoach[] } | null,
  hallOfFame: [] as HofEntry[],
  expelledLog: [] as ExpelRecord[],
  transfers: [] as Transfer[],
  retirements: [] as RetireRecord[],
  milestones: [] as Milestone[],
  readNews: [] as string[],
  trainingFocus: null as TrainingFocus | null,
  staffHead: {} as Record<string, string>,
  staffAssistants: {} as Record<string, string[]>,
  staffScouts: {} as Record<string, string[]>,
  interviews: [] as InterviewLog[],
  benchDirectives: [] as BenchDirective[],
  talkCooldown: {} as Record<string, number>,
  benchCooldown: {} as Record<string, number>,
  fanScore: 50,
  releaseAnger: 0,
  cash: 50000, // 시작 운영 예비금 5억
  lastFinance: null as SeasonFinance | null,
  tryoutWish: [] as string[],
  foreignAltPool: [] as string[],
  foreignSubUsed: false,
  keepForeign: null as boolean | null,
  asianWish: [] as string[],
  asianAltPool: [] as string[],
  asianSubUsed: false,
  keepAsian: null as boolean | null,
};

/** 내 팀의 시즌 중 거래 반영 명단 변화 — 방출/영입 집합 + 현재 정원(방출·영입 검증 게이트 공용) */
function myRosterDelta(my: string, inSeasonTx: Tx[], rosterIds: string[]) {
  const myReleased = new Set(inSeasonTx.filter((t) => t.kind === 'release' && t.teamId === my).map((t) => t.playerId));
  const mySigned = inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === my).map((t) => t.playerId);
  return { myReleased, mySigned, size: (rosterIds.length - myReleased.size) + mySigned.length };
}

/** 방출 시점의 팬 분노(TRANSACTION_SYSTEM 0.5③) — **안정 명성**(career·수상·근속, 시즌 production 제외)으로
 *  계산해 결정론 보장(leagueProduction은 호출 순서에 민감해 분노가 흔들렸다 — 제외). 외인은 0(팬심 비대상). */
function releaseAngerOf(playerId: string, archive: SeasonArchive[], day: number): number {
  const rp = evolveOnDay(playerId, day);
  if (!rp || rp.isForeign) return 0;
  const stature = popularityOf(rp.career.points, awardHistoryOf(archive, playerId).length, rp.clubTenure, 0);
  return releaseAngerPenalty(stature);
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      onboarded: false,
      supporter: false,
      sfxEnabled: true,
      seenTips: {},
      ...freshSave,

      selectTeam: (teamId) => {
        resetLeagueBase();
        set({ ...freshSave, selectedTeamId: teamId });
        setTxContext([], [], teamId);
        setMyTeamStaff(teamId); // 내 팀만 영입 스태프, 나머지는 AI 기본 스태프(STAFF_SYSTEM 7)
        // 시작 기본 스태프(ONBOARDING 6) — 플레이어 팀을 0이 아니라 코치1+스카우터1로 출발시킨다(AI와 대칭).
        const staff = grantStartingStaff(teamId);
        set({ staffHead: staff.head, staffAssistants: staff.asst, staffScouts: staff.scout });
        setOwnerContext([]);
        setAwardScores([]); // 새 세이브 — 수상 이력 없음
      },
      setDay: (day) => set((s) => (Number.isFinite(day) ? { currentDay: Math.max(s.currentDay, day) } : {})), // NaN/Infinity 거부(currentDay 오염 전파 차단)
      recordResult: (r) => set((s) => ({ results: { ...s.results, [r.fixtureId]: r } })),
      saveWatchProgress: (fixtureId, idx) => set((s) => ({ watchProgress: { ...s.watchProgress, [fixtureId]: idx } })),
      clearWatchProgress: (fixtureId) => set((s) => {
        if (s.watchProgress[fixtureId] === undefined) return {};
        const next = { ...s.watchProgress }; delete next[fixtureId];
        return { watchProgress: next };
      }),
      reSign: (playerId, contract) => {
        // 내 로스터 선수 + 정상 계약 + **캡 인지**만 허용. 검증 없으면 음수 연봉(payroll 음수→캡 무력화)
        // 또는 거대 연봉(개인 7천만배·팀 캡 초과)으로 캡을 뚫는다(전체게임 퍼저 Defect3·확장몽키, EC-TX-04).
        // reSign은 void라 비정상 입력은 조용히 무시(UI는 항상 정상 계약을 보냄).
        const s = get();
        const my = s.selectedTeamId ?? '';
        const rosterIds = currentRosters()[my] ?? [];
        if (!rosterIds.includes(playerId)) return;
        // 외인/아시아쿼터는 국내 재계약 흐름 비대상 — 트라이아웃 재지명(keepForeign)으로만 갱신(FOREIGN_SYSTEM 3장)
        if (getPlayer(playerId)?.isForeign) return;
        const { salary, years, remaining } = contract;
        if (![salary, years, remaining].every((v) => Number.isFinite(v))) return;
        if (salary <= 0 || years < 1 || remaining < 1 || remaining > years) return;
        // 재계약 후 내 국내 payroll이 캡 초과면 거부(다른 영입과 일관 — 캡은 하드). 외인은 캡 제외.
        const target = evolveOnDay(playerId, s.currentDay);
        // 개인 연봉 상한(MAX_SALARY 8억 / 프랜차이즈 11억) — 팀캡만 보면 단일선수 거대연봉으로 우회 가능(EC-TX-04 잔여)
        if (target && !target.isForeign && salary > maxSalaryFor(target)) return;
        if (target && !target.isForeign) {
          let dom = 0;
          for (const id of rosterIds) {
            const p = evolveOnDay(id, s.currentDay);
            if (!p || p.isForeign) continue;
            dom += id === playerId ? salary : (s.contractOverrides[id]?.salary ?? p.contract.salary);
          }
          if (dom > LEAGUE_CAP) return;
        }
        set((st) => ({ contractOverrides: { ...st.contractOverrides, [playerId]: contract } }));
      },
      // 시즌 중 방출 → FA 풀(dynamics가 영입 가능하게). released[]는 표시용, inSeasonTx는 시뮬용.
      // 정원 하한(ROSTER_MIN) 게이트 — 명단이 비어 경기 불가가 되는 상태를 원천 차단.
      release: (playerId) => {
        const s = get();
        if (s.released.includes(playerId)) return false;
        const my = s.selectedTeamId ?? '';
        const rosterIds = currentRosters()[my] ?? [];
        const { mySigned, size } = myRosterDelta(my, s.inSeasonTx, rosterIds);
        // 내 유효 로스터(시즌초 명단 + 시즌 중 영입) 선수만 방출 가능 — 타 팀/존재 안 함 id 주입 차단.
        // (없으면 팬텀 방출로 이중 소속·영입비 누수·자기 방출 DoS, 2026-06-20 전체게임 퍼저 발견)
        if (!rosterIds.includes(playerId) && !mySigned.includes(playerId)) return false;
        // 외인/아시아쿼터 방출 차단 — 외인은 FA 풀로 안 가므로(FOREIGN_SYSTEM 3장) 방출 시 시즌 1회 교체 외엔
        // 못 메우는 공석이 된다. 외인은 시즌 중 교체(replaceForeign)·오프시즌 트라이아웃에서만 정리(리뷰 발견 2026-06-25).
        if (getPlayer(playerId)?.isForeign) return false;
        if (!canRelease(size)) return false;
        // 위약금(TRANSACTION_SYSTEM 0.5①) — 잔여 보장액의 일부를 운영 자금에서 즉시 정산. 지갑이 모자라면 방출 불가.
        const c = getPlayer(playerId)?.contract;
        const fee = c ? severanceFee(c.salary, c.remaining) : 0;
        if (fee > s.cash) return false;
        const inSeasonTx: Tx[] = [...s.inSeasonTx, { day: s.currentDay, teamId: my, playerId, kind: 'release' }];
        // 팬 분노 적립(방출 시점 인기 — TRANSACTION_SYSTEM 0.5③). endSeason서 fanScore에 반영.
        const anger = releaseAngerOf(playerId, s.archive, s.currentDay);
        set({ released: [...s.released, playerId], inSeasonTx, cash: s.cash - fee, releaseAnger: s.releaseAnger + anger });
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
        // 당일 철회는 실수 정정 — 위약금 환불 + 팬 분노 적립도 되돌림(같은 날·같은 입력이라 동일값).
        const c = getPlayer(playerId)?.contract;
        const fee = c ? severanceFee(c.salary, c.remaining) : 0;
        const anger = releaseAngerOf(playerId, s.archive, s.currentDay);
        set({ released: s.released.filter((id) => id !== playerId), inSeasonTx, cash: s.cash + fee, releaseAnger: Math.max(0, s.releaseAnger - anger) });
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
        const { myReleased, mySigned, size } = myRosterDelta(my, s.inSeasonTx, rosterIds);
        if (size >= ROSTER_MAX) return false;
        // 배신 웃돈: 내가 이번 시즌 방출한 선수의 재영입은 몸값 ×1.5 (당일 철회는 unrelease로 무료)
        const betrayedBy = (id: string) => s.inSeasonTx.some((t) => t.kind === 'release' && t.teamId === my && t.playerId === id);
        let payroll = 0;
        for (const id of rosterIds) if (!myReleased.has(id)) { const rp = evolveOnDay(id, s.currentDay); if (rp && !rp.isForeign) payroll += rp.contract.salary; } // 캡=국내 전용
        for (const id of mySigned) { const p = evolveOnDay(id, s.currentDay); if (p) payroll += inSeasonCost(marketVal(p), betrayedBy(id)); }
        const signCost = inSeasonCost(marketVal(fa), betrayedBy(faId));
        if (payroll + signCost > LEAGUE_CAP) return false;
        if (signCost > s.cash) return false; // 운영 자금 부족(FINANCE) — 캡이 남아도 지갑이 비면 못 뽑는다
        const inSeasonTx: Tx[] = [...s.inSeasonTx, { day: s.currentDay, teamId: my, playerId: faId, kind: 'sign' }];
        set({ inSeasonTx, cash: s.cash - signCost, careerLog: { ...s.careerLog, faSigns: s.careerLog.faSigns + 1 } }); // 지갑 즉시 차감 + 영입 카운트
        setTxContext(inSeasonTx, get().faPool, my);
        return true;
      },
      setResign: (playerId, keep) =>
        set((s) => ({ resignDecisions: { ...s.resignDecisions, [playerId]: keep } })),
      signFA: (playerId) =>
        set((s) => (s.faSignings.includes(playerId) ? s : { faSignings: [...s.faSignings, playerId] })),
      unsignFA: (playerId) =>
        set((s) => ({
          faSignings: s.faSignings.filter((id) => id !== playerId),
          moneyOnlyIds: s.moneyOnlyIds.filter((id) => id !== playerId), // 지명 취소 시 '돈만' 선택도 해제
        })),
      setAggressive: (on) => set({ faAggressive: on }),
      toggleProtect: (playerId) =>
        set((s) => {
          if (s.protectedIds.includes(playerId))
            return { protectedIds: s.protectedIds.filter((id) => id !== playerId) };
          if (!(currentRosters()[s.selectedTeamId ?? ''] ?? []).includes(playerId)) return s; // 내 로스터만 보호(유령/타팀 id 무시 — 보호슬롯 낭비 방지)
          if (s.protectedIds.length >= PROTECT_COUNT) return s; // 정원 초과 무시
          return { protectedIds: [...s.protectedIds, playerId] };
        }),
      toggleMoneyOnly: (playerId) =>
        set((s) => (s.moneyOnlyIds.includes(playerId)
          ? { moneyOnlyIds: s.moneyOnlyIds.filter((id) => id !== playerId) }
          : { moneyOnlyIds: [...s.moneyOnlyIds, playerId] })),
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
      // 읽은 뉴스 키 누적 — 최근 1500개만 보존(방치형 장기 저장 바운딩, NEWS_SYSTEM §6). 오래된 키가 떨어져도
      // 그 기사는 피드 소스(transfers 200·retirements 200·milestones 300 등)서 이미 빠져 다시 안 뜨므로 안전.
      markNewsRead: (keys) => set((s) => ({ readNews: Array.from(new Set([...s.readNews, ...keys])).slice(-1500) })),
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
        if (ok) { const s = getStaffState(); set((st) => ({ staffHead: s.head, staffAssistants: s.asst, staffScouts: s.scout, coachPool: currentCoachPool(), careerLog: { ...st.careerLog, coachHires: st.careerLog.coachHires + 1 } })); }
        return ok;
      },
      // 감독 재계약 — 계약 3년 연장(만료/임박 시). 풀 변화 영속.
      resignCoach: () => {
        const tid = get().selectedTeamId;
        if (!tid) return false;
        const ok = resignTeamCoach(tid);
        if (ok) set({ coachPool: currentCoachPool() });
        return ok;
      },
      // 감독 경질 — 시즌 중 해촉. 전문 코치가 대행, 없으면 공석. 새 감독은 직접 영입.
      fireCoach: () => {
        const tid = get().selectedTeamId;
        if (!tid) return { acting: null };
        const r = fireCoachLeague(tid);
        set({ coachPool: currentCoachPool(), staffHead: getStaffState().head });
        return r;
      },
      hireAssistant: (id) => {
        const tid = get().selectedTeamId;
        if (!tid) return false;
        const ok = hireAsstLeague(tid, id);
        if (ok) set((st) => ({ staffAssistants: getStaffState().asst, coachPool: currentCoachPool(), careerLog: { ...st.careerLog, staffHires: st.careerLog.staffHires + 1 } }));
        return ok;
      },
      releaseAssistant: (id) => {
        const tid = get().selectedTeamId;
        if (!tid) return;
        releaseAsstLeague(tid, id);
        set({ staffAssistants: getStaffState().asst, coachPool: currentCoachPool() });
      },
      hireScout: (id) => {
        const tid = get().selectedTeamId;
        if (!tid) return false;
        const ok = hireScoutLeague(tid, id);
        if (ok) set((st) => ({ staffScouts: getStaffState().scout, careerLog: { ...st.careerLog, staffHires: st.careerLog.staffHires + 1 } }));
        return ok;
      },
      releaseScout: (id) => {
        const tid = get().selectedTeamId;
        if (!tid) return;
        releaseScoutLeague(tid, id);
        set({ staffScouts: getStaffState().scout });
      },

      // ── 구단주 레이어 (OWNER_SYSTEM) ──
      // 면담: 문은 선수가 연다(들볶을수록·실망시켰을수록 거절) → 약속 카드로 설득(성공/역효과)
      requestInterview: (playerId, card) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my) return { met: false, topic: null };
        if (s.currentDay < (s.talkCooldown[playerId] ?? 0)) return { met: false, topic: null }; // 쿨다운 중(UI에서 막지만 방어)
        const p = evolveOnDay(playerId, s.currentDay);
        if (!p) return { met: false, topic: null };
        const nextCd = { ...s.talkCooldown, [playerId]: s.currentDay + TALK_COOLDOWN_DAYS }; // 면담했으면(성공·거절·결렬 무관) 일정 기간 잠금
        const { topic } = discontentNow(p, my, s.currentDay);
        if (!topic) { set({ talkCooldown: nextCd }); return { met: true, topic: null }; } // 만족 상태 — "괜찮습니다, 구단주님"
        const seasonLogs = s.interviews.filter((l) => l.playerId === playerId && l.season === s.season);
        const lastFailed = seasonLogs.length > 0 && !seasonLogs[seasonLogs.length - 1].ok;
        if (!meetAccept(playerId, s.season, seasonLogs.length, lastFailed)) { set({ talkCooldown: nextCd }); return { met: false, topic }; }
        const standings = computeStandings(s.currentDay > 0 ? s.currentDay : Number.MAX_SAFE_INTEGER);
        const rank = Math.max(1, standings.findIndex((r) => r.teamId === my) + 1);
        const perfT = standings.length <= 1 ? 1 : 1 - (rank - 1) / (standings.length - 1);
        const fails = s.interviews.filter((l) => l.playerId === playerId && !l.ok).length;
        const ok = persuade(playerId, s.season, seasonLogs.length, cardMatch(card, topic, p), perfT, fails);
        set({
          interviews: [...s.interviews, { playerId, season: s.season, day: s.currentDay, topic, card, ok }].slice(-200),
          careerLog: { ...s.careerLog, interviews: s.careerLog.interviews + 1 },
          talkCooldown: nextCd,
        });
        return { met: true, topic, ok };
      },
      // 감독 벤치 건의 — 합리(대체자 격차)와 소신(카리스마·에이스 보호) 사이에서 감독이 답한다
      suggestBench: (playerId, reason) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my) return false;
        if (s.currentDay < (s.benchCooldown[playerId] ?? 0)) return false; // 건의 쿨다운(방어)
        if (s.benchDirectives.length >= BENCH_MAX) return false;
        if (s.benchDirectives.some((b) => b.playerId === playerId)) return false;
        const squad = rosterIdsOnDay(my, s.currentDay)
          .map((id) => evolveOnDay(id, s.currentDay))
          .filter((q): q is Player => !!q)
          .sort((a, b) => overall(b) - overall(a));
        const target = squad.find((q) => q.id === playerId);
        if (!target) return false;
        const aceRank = squad.findIndex((q) => q.id === playerId);
        const alt = squad.find((q) => q.id !== playerId && q.position === target.position);
        const gap = alt ? overall(target) - overall(alt) : 10;
        const ovrGapT = Math.max(0, Math.min(1, 1 - gap / 10)); // 대체자가 비등할수록 1
        const ok = benchAccept(playerId, s.season, s.currentDay, coachInfoOf(my)?.charisma ?? 50, ovrGapT, aceRank, reason);
        const benchCd = { ...s.benchCooldown, [playerId]: s.currentDay + BENCH_COOLDOWN_DAYS }; // 건의했으면(수락·거절 무관) 잠금
        if (ok) {
          const benchDirectives = [...s.benchDirectives, { playerId, fromDay: s.currentDay }];
          set({ benchDirectives, benchCooldown: benchCd });
          setOwnerContext(benchDirectives);
        } else {
          set({ benchCooldown: benchCd });
        }
        return ok;
      },
      // 선발 기용 건의 — 수락 시 동포지션 최약 주전을 벤치 지시(건의 선수가 그 자리를 잇는다)
      suggestStart: (playerId) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my) return false;
        if (s.currentDay < (s.benchCooldown[playerId] ?? 0)) return false; // 건의 쿨다운(방어)
        if (s.benchDirectives.length >= BENCH_MAX) return false;
        const benched = new Set(s.benchDirectives.map((b) => b.playerId));
        const squad = rosterIdsOnDay(my, s.currentDay)
          .map((id) => evolveOnDay(id, s.currentDay))
          .filter((q): q is Player => !!q && !benched.has(q.id));
        const target = squad.find((q) => q.id === playerId);
        if (!target) return false;
        // 동포지션 '최약 주전'을 벤치 — 건의 선수가 그 자리를 잇는다(주석대로). 과거 최강(에이스)을 벤치하던 버그 수정(EC-LU-02).
        //   주전 판정은 실제 경기 라인업(availableTeamPlayers→buildLineup)으로 — 벤치된 비주전을 골라 무의미해지는 것 방지.
        const lu = buildLineup(availableTeamPlayers(my, s.currentDay));
        const starterIds = new Set<string>([...lu.six.map((p) => p.id), ...(lu.libero ? [lu.libero.id] : [])]);
        const incumbent = squad
          .filter((q) => q.position === target.position && q.id !== playerId && starterIds.has(q.id))
          .sort((x, y) => overall(x) - overall(y))[0];
        if (!incumbent) {
          // 동포지션 대체자가 없어 건의가 무의미해도, 시도했으면 쿨다운 적용(성공·거절·무의미 모두 잠금)
          set({ benchCooldown: { ...s.benchCooldown, [playerId]: s.currentDay + BENCH_COOLDOWN_DAYS } });
          return false;
        }
        const gapT = Math.max(0, Math.min(1, 1 - (overall(incumbent) - overall(target)) / 10));
        const ok = startSuggestAccept(playerId, s.season, s.currentDay, coachInfoOf(my)?.charisma ?? 50, gapT);
        const benchCd = { ...s.benchCooldown, [playerId]: s.currentDay + BENCH_COOLDOWN_DAYS }; // 건의했으면(수락·거절 무관) 잠금
        if (ok) {
          const benchDirectives = [...s.benchDirectives, { playerId: incumbent.id, fromDay: s.currentDay }];
          set({ benchDirectives, benchCooldown: benchCd });
          setOwnerContext(benchDirectives);
        } else {
          set({ benchCooldown: benchCd });
        }
        return ok;
      },
      unbench: (playerId) => {
        const benchDirectives = get().benchDirectives.filter((b) => b.playerId !== playerId);
        set({ benchDirectives });
        setOwnerContext(benchDirectives);
      },
      setKeepForeign: (keep) => set({ keepForeign: keep }),
      toggleTryoutWish: (playerId) =>
        set((s) => ({ tryoutWish: s.tryoutWish.includes(playerId) ? s.tryoutWish.filter((id) => id !== playerId) : [...s.tryoutWish, playerId] })),
      // 시즌 중 외인 교체(시즌당 1회) — 퇴출 외인은 리그를 떠나고, 대체 외인 연봉은 지갑에서(이중 부담)
      replaceForeign: (altId) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my || s.foreignSubUsed) return false;
        if (!s.foreignAltPool.includes(altId)) return false;
        const curForeign = rosterIdsOnDay(my, s.currentDay).map((id) => evolveOnDay(id, s.currentDay)).find((p) => p?.isForeign && !p?.isAsianQuota);
        if (!curForeign) return false;
        if (FOREIGN_SALARY > s.cash) return false; // 운영 자금 부족
        const inSeasonTx: Tx[] = [...s.inSeasonTx,
          { day: s.currentDay, teamId: my, playerId: curForeign.id, kind: 'release' },
          { day: s.currentDay, teamId: my, playerId: altId, kind: 'sign' }];
        set({ inSeasonTx, foreignSubUsed: true, cash: s.cash - FOREIGN_SALARY, foreignAltPool: s.foreignAltPool.filter((id) => id !== altId) });
        setTxContext(inSeasonTx, get().faPool, my);
        return true;
      },
      setKeepAsian: (keep) => set({ keepAsian: keep }),
      toggleAsianWish: (playerId) =>
        set((s) => ({ asianWish: s.asianWish.includes(playerId) ? s.asianWish.filter((id) => id !== playerId) : [...s.asianWish, playerId] })),
      // 시즌 중 아시아쿼터 교체(시즌당 1회) — 외인 교체와 동일 구조(ASIAN_SALARY)
      replaceAsian: (altId) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my || s.asianSubUsed) return false;
        if (!s.asianAltPool.includes(altId)) return false;
        const curAsian = rosterIdsOnDay(my, s.currentDay).map((id) => evolveOnDay(id, s.currentDay)).find((p) => p?.isAsianQuota);
        if (!curAsian) return false;
        if (ASIAN_SALARY > s.cash) return false; // 운영 자금 부족
        const inSeasonTx: Tx[] = [...s.inSeasonTx,
          { day: s.currentDay, teamId: my, playerId: curAsian.id, kind: 'release' },
          { day: s.currentDay, teamId: my, playerId: altId, kind: 'sign' }];
        set({ inSeasonTx, asianSubUsed: true, cash: s.cash - ASIAN_SALARY, asianAltPool: s.asianAltPool.filter((id) => id !== altId) });
        setTxContext(inSeasonTx, get().faPool, my);
        return true;
      },

      endSeason: () => {
        const { season, contractOverrides, selectedTeamId, resignDecisions, faSignings, faAggressive, protectedIds, moneyOnlyIds, draftPicks, hallOfFame, expelledLog, transfers, retirements, archive, careerLog, careerTotals, bonds, milestones, interviews, benchDirectives, fanScore, cash, tryoutWish, keepForeign, asianWish, keepAsian } = get();
        const nextSeason = season + 1;
        const my = selectedTeamId ?? '';

        // 더블탭 방어 — 정규시즌이 실제로 끝났을 때만 진행한다. 한 번 롤오버하면 results가 비워져(아래 749)
        //   planNextAction이 다시 'match'를 돌려주므로, 확정 버튼 연타로 인한 시즌 2전진을 차단한다(§3.5 endSeason 더블탭).
        if (planNextAction(SEASON, my, get().results).kind !== 'seasonOver') return;

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
        const playoffs = buildPlayoffs(season);
        const championId = playoffs.championId ?? '';
        // 순위·연승연패·플옵 서사·시즌 승수 업적용: 최종 순위 + 팀별 최장 연승/연패 + 플옵 W/L + 팀별 승패
        const finalTable = computeStandings(Number.MAX_SAFE_INTEGER);
        const rankOrder = finalTable.map((r) => r.teamId);
        const record: Record<string, [number, number]> = {};
        for (const r of finalTable) record[r.teamId] = [r.wins, r.losses];
        const seasonStreak = seasonStreaks(Number.MAX_SAFE_INTEGER);
        const archEntry: SeasonArchive = { season, championId, awards: seasonAwards, standings: rankOrder, streaks: seasonStreak, series: seriesByTeam(playoffs), record };
        const nextArchive = archive.some((a) => a.season === season)
          ? archive.map((a) => (a.season === season ? { ...a, ...archEntry } : a))
          : [...archive, archEntry];
        setAwardScores(nextArchive); // 수상 프리미엄 컨텍스트 갱신 — 이번 오프시즌 FA/재계약(buildDraftContext)부터 반영

        // 통산 경기 기록 누적(업적용) — 이번 시즌 내 팀 득점·에이스·세트·경기 승패
        const myRowRec = record[my] ?? [0, 0];
        let seasonPts = 0, seasonAces = 0, setsW = 0, setsL = 0;
        const myProd = leagueProduction(Number.MAX_SAFE_INTEGER);
        for (const id of currentRosters()[my] ?? []) { const pr = myProd.get(id); if (pr) { seasonPts += pr.points; seasonAces += pr.aces; } }
        for (const r of seasonResults(Number.MAX_SAFE_INTEGER)) {
          if (r.homeTeamId === my) { setsW += r.homeSets; setsL += r.awaySets; }
          else if (r.awayTeamId === my) { setsW += r.awaySets; setsL += r.homeSets; }
        }
        const nextTotals = {
          points: careerTotals.points + seasonPts, aces: careerTotals.aces + seasonAces,
          setsWon: careerTotals.setsWon + setsW, setsLost: careerTotals.setsLost + setsL,
          matchWins: careerTotals.matchWins + myRowRec[0], matchLosses: careerTotals.matchLosses + myRowRec[1],
        };

        // 0.6) 구단주 레이어(OWNER_SYSTEM) — 면담 결과·불만·팬심 → FA 거부/오퍼 보정 + 시즌 팬심 정산
        //   FA/드래프트 센터 미리보기와 같은 빌더(buildOwnerFx) — 미리보기=결과 보장
        const ownerFx: OwnerFx = buildOwnerFx(interviews, season, my, fanScore);
        // 팬심 정산: 성적 + 인기 스타 벤치 분노 → 다음 시즌 팬심(예산·침몰선 정서 입력)
        const finalStandings = computeStandings(Number.MAX_SAFE_INTEGER);
        const myRow = finalStandings.find((r) => r.teamId === my);
        const winRate = myRow ? myRow.wins / Math.max(1, myRow.wins + myRow.losses) : 0.5;
        const prodAll = leagueProduction(Number.MAX_SAFE_INTEGER);
        let angerSum = 0;
        for (const b of benchDirectives) {
          const bp = evolveOnDay(b.playerId, SEASON_END_DAY);
          if (!bp) continue;
          const pop = popularityOf(bp.career.points, awardHistoryOf(archive, b.playerId).length, bp.clubTenure, prodAll.get(b.playerId)?.points ?? 0);
          if (pop >= 60) angerSum += benchAngerPenalty(Math.round((SEASON_END_DAY - b.fromDay) / GAME_EVERY));
        }
        // 내 팀 선수의 사건·사고 — 팬들이 등을 돌린다(사안이 클수록 = 정지 경기 많을수록 더 떠난다)
        for (const sc of seasonScandals()) if (sc.teamId === my) angerSum += Math.min(28, 6 + sc.missMatches);
        // 스타 방출 분노(TRANSACTION_SYSTEM 0.5③ — OWNER §3.2). 방출 *시점*에 적립한 값을 합산
        // (release가 그때의 인기로 계산 — 방출 후 production 제외로 시즌 활약이 사라지는 역설 회피).
        angerSum += get().releaseAnger;
        const nextFan = fanScoreOf(winRate, championId === my, angerSum);

        // 0.7) 재정 정산(FINANCE) — 모기업(베이스+성적 보너스) + 직관(성적 민감) + 굿즈(선수팬).
        //   롤오버 전, 끝난 시즌의 성적·팬덤으로 정산 → 새 잔고가 이번 오프시즌 FA 지갑이 된다.
        const po = buildPlayoffs(season);
        const runnerUpId = po.final ? (po.final.hiId === po.championId ? po.final.loId : po.final.hiId) : null;
        const myRankFinal = Math.max(1, finalStandings.findIndex((r) => r.teamId === my) + 1);
        const fb = teamFanbaseNow(my, SEASON_END_DAY, fanScore, archive);
        const myPayroll = (finalR[my] ?? []).reduce((sum, id) => sum + (evolveOnDay(id, SEASON_END_DAY)?.contract.salary ?? 0), 0);
        const finance = settleSeason({
          teamId: my, rank: myRankFinal, teamCount: finalStandings.length,
          champion: championId === my, runnerUp: runnerUpId === my,
          winRate, fan: fanScore, fanTotal: fb.total, playerFansTotal: fb.playerFansTotal,
          payroll: myPayroll, staff: staffSpend(my), cashBefore: cash,
        });
        const settled = applyNet(cash, finance.net);
        const nextFinance: SeasonFinance = { ...finance, bailout: settled.bailout };

        // 1) 롤오버·은퇴·경쟁FA(영입/보상)·순번·클래스 (드래프트 센터와 동일 소스)
        //    FA 입찰은 캡 AND 새 잔고(지갑) — 캡이 남아도 돈이 없으면 못 뽑는다
        const ctx = buildDraftContext(my, resignDecisions, contractOverrides, faSignings, faAggressive, protectedIds, nextSeason, ownerFx, settled.cash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian);
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
        const seasonRetires: RetireRecord[] = []; // 은퇴 세리머니(슬라이스5) — 주목 은퇴자 작별·회고
        for (const id of ctx.retired) {
          const base = snapshot[id];
          if (!base) continue;
          const c = accrueCareer(base, seasonProd.get(id)).career;
          const isHof = c.points >= HOF_POINTS;
          if (isHof) {
            hofAdds.push({
              id, name: base.name, position: base.position, teamId: ctx.prevTeamOf[id] ?? '',
              seasons: c.seasons, points: c.points, blocks: c.blocks, digs: c.digs,
              spikes: c.spikes, aces: c.aces, assists: c.assists,
              retiredSeason: season, legend: c.points >= LEGEND_POINTS,
            });
          }
          // 주목 은퇴자(오래 뛴 베테랑 또는 HOF)는 작별 뉴스 — 비-HOF 노장이 무음으로 사라지지 않게
          if (isHof || c.seasons >= RETIRE_NEWS_MIN_SEASONS) {
            seasonRetires.push({
              season, playerId: id, name: base.name, position: base.position, teamId: ctx.prevTeamOf[id] ?? '',
              seasons: c.seasons, points: c.points, blocks: c.blocks, digs: c.digs, aces: c.aces, assists: c.assists,
              hof: isHof, legend: c.points >= LEGEND_POINTS,
            });
          }
        }
        const nextRetirements = [...retirements, ...seasonRetires].slice(-200);

        // 3.7) 감독 생애주기(STAFF_SYSTEM 6) — 노쇠·은퇴·경질·은퇴선수→코치·승격·빈팀 자동배정
        const assignedHead: Record<string, string> = {};
        for (const t of LEAGUE.teams) { const hc = getTeamCoach(t.id); if (hc) assignedHead[t.id] = hc.id; }
        const retiredPlayers = ctx.retired.map((id) => snapshot[id]).filter((p): p is Player => !!p);
        const legendSet = new Set(hofAdds.filter((h) => h.legend).map((h) => h.id));
        // 최근 4시즌 순위(과거 archive standings + 이번 시즌)로 연속 하위권 = 경질 판정
        const recentOrders = [...nextArchive.slice(-4).map((a) => a.standings).filter((s): s is string[] => !!s)];
        const bottomYears: Record<string, number> = {};
        for (const t of LEAGUE.teams) bottomYears[t.id] = bottomStreak(recentOrders, t.id);
        const lifecycle = advanceCoaches(nextSeason, currentCoachPool(), assignedHead, retiredPlayers, legendSet, rankOrder, bottomYears, my);
        commitCoachPool(lifecycle.coaches, lifecycle.assistants);
        // 재배정 적용: AI 팀은 새 감독, 내 팀은 감독이 떠났으면 배정 해제(기본 감독 복귀 — 직접 다시 영입)
        for (const r of lifecycle.reassign) assignCoach(r.teamId, r.coachId);
        const reconciled = reconcileStaff(); // 은퇴·승격으로 사라진 영입 계약 정리(내 팀 코치 포함)
        const nextCoachPool = currentCoachPool();
        const nextStaffHead = reconciled.head;       // AI 재배정 + 죽은 계약 정리 반영(영속)
        const nextStaffAssistants = reconciled.asst;  // 은퇴한 내 코치 슬롯 정리

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

        // 4.6) 다음 시즌 FA 풀 = 롤오버됐으나 미계약(로스터 외)·비은퇴·비제명 선수(오프시즌 잔류 FA)
        const rosteredNext = new Set(Object.values(filled.rosters).flat());
        const retiredSet = new Set(ctx.retired);
        const expelledSet = new Set(ctx.expelled.map((e) => e.playerId)); // 영구제명자는 FA 풀로도 안 감(리그 소멸)
        const nextFaPool = Object.keys(snapshot).filter((id) => !rosteredNext.has(id) && !retiredSet.has(id) && !expelledSet.has(id) && !snapshot[id].isForeign); // 외인은 FA 풀 비대상(트라이아웃 전용)

        // FA 영입 지출 차감 — 내 새 명단에 합류한 타 구단 출신(드래프트·신인 제외)의 첫 해 연봉 + A/B 보상금
        let faSpend = ctx.compCash; // FA 보상금(A 200%·B 100% × 직전연봉, FA_SYSTEM 2.2) — 운영 자금에서
        let offseasonSigns = 0;
        for (const id of filled.rosters[my] ?? []) {
          const prev = ctx.prevTeamOf[id];
          if (prev && prev !== my) { faSpend += snapshot[id]?.contract.salary ?? 0; offseasonSigns += 1; } // 영입 수(업적 careerLog)
        }

        // FA 이적·방출 연표(뉴스 슬라이스3·4) — 오프시즌 선수 이동. 최근 200건.
        //  노이즈 정책(NEWS_SYSTEM §3.3): 내 팀 in/out은 항상, 타팀은 거물(overall≥REL_NEWS_OVR)만 적립 → 로그를 린하게.
        const REL_NEWS_OVR = 71; // 타팀 이동 기사화 게이트(리그 국내평균 ~68 위 = 주전급. _ev_transfernews 보정 — 타팀 수건/시즌, 잡선수 노이즈 차단)
        const notable = (id: string) => { const p = snapshot[id]; return !!p && overall(p) >= REL_NEWS_OVR; };
        const seasonTransfers: Transfer[] = [];
        for (const tid of Object.keys(filled.rosters)) {
          for (const id of filled.rosters[tid]) {
            const prev = ctx.prevTeamOf[id];
            const p = snapshot[id];
            // 팀→팀 이동(국내). 내 팀 in/out은 항상, 타팀은 거물만.
            if (prev && prev !== tid && p && !p.isForeign && (prev === my || tid === my || notable(id)))
              seasonTransfers.push({ season, playerId: id, name: p.name, fromTeam: prev, toTeam: tid, kind: 'transfer', ovr: overall(p) });
          }
        }
        // 방출/재계약 불발 — 직전 소속(prevTeamOf)이 있는데 새 시즌 어느 명단에도 없는 국내 선수(=FA 풀행, 미계약).
        //  nextFaPool = 이미 (비로스터·비은퇴·비제명·국내)라, 거기에 "직전 소속 보유"만 더하면 신규 방출자.
        const seasonReleases: Transfer[] = [];
        for (const id of nextFaPool) {
          const prev = ctx.prevTeamOf[id];
          const p = snapshot[id];
          if (!prev || !p) continue; // 직전 소속 없으면 풀 잔류자(신규 방출 아님)
          if (prev === my || notable(id)) seasonReleases.push({ season, playerId: id, name: p.name, fromTeam: prev, toTeam: '', kind: 'release', ovr: overall(p) });
        }
        const nextTransfers = [...transfers, ...seasonTransfers, ...seasonReleases].slice(-200);

        const nextBonds = accrueBonds(bonds, filled.rosters); // 인간관계 우정 누적(같은 팀 +·옛정 감쇠)
        setRelationContext(nextBonds);    // 새 시즌 관계 컨텍스트(FA preview=result)
        commitPlayerBase(snapshot);
        commitRosters(filled.rosters);
        setTxContext([], nextFaPool, my); // 새 시즌: 거래 초기화 + FA 풀 주입
        setOwnerContext([]);              // 벤치 지시는 시즌 단위 — 새 시즌 전원 복귀
        set({
          coachPool: nextCoachPool,          // 감독 생애주기 풀 영속(STAFF_SYSTEM 6)
          staffHead: nextStaffHead,          // AI 재배정 + 죽은 계약 정리 반영
          staffAssistants: nextStaffAssistants, // 은퇴한 코치 슬롯 정리
          careerLog: { ...careerLog, faSigns: careerLog.faSigns + offseasonSigns }, // 오프시즌 영입 누적(업적)
          careerTotals: nextTotals, // 통산 경기 기록 누적(업적)
          bonds: nextBonds, // 인간관계 우정 누적(같은 팀 +·옛정 감쇠, RELATIONSHIP §1.1)
          interviews: interviews.filter((l) => l.season >= season - 1).slice(-200), // 직전 시즌까지만(실패 이력 참조용)
          benchDirectives: [],
          talkCooldown: {},   // 시즌말 currentDay 0 리셋과 함께 쿨다운 초기화
          benchCooldown: {},
          // 영구제명(승부조작·학폭) — 내 팀이면 팬심 대폭락(사건당 −35). 리그 최대 충격.
          fanScore: Math.max(0, nextFan - 35 * ctx.expelled.filter((e) => e.teamId === my).length),
          cash: Math.max(0, settled.cash - faSpend),
          lastFinance: nextFinance,
          tryoutWish: [],
          foreignAltPool: ctx.tryout.altPoolIds,
          foreignSubUsed: false,
          keepForeign: null,
          asianWish: [],
          asianAltPool: ctx.asianTryout.altPoolIds,
          asianSubUsed: false,
          keepAsian: null,
          season: nextSeason,
          currentDay: 0,
          results: {},
          watchProgress: {}, // 새 시즌 — 이어보기 위치 초기화
          contractOverrides: {},
          released: [],
          releaseAnger: 0, // 시즌 분노는 이번 endSeason에서 fanScore로 반영됐으니 리셋
          inSeasonTx: [],
          faPool: nextFaPool,
          resignDecisions: {},
          faSignings: [],
          faAggressive: false,
          protectedIds: [],
          moneyOnlyIds: [],
          draftPicks: [],
          playerBase: snapshot,
          rosters: filled.rosters,
          hallOfFame: [...hallOfFame, ...hofAdds],
          expelledLog: [...expelledLog, ...ctx.expelled.map((e) => ({ season, playerId: e.playerId, name: snapshot[e.playerId]?.name ?? e.playerId, teamId: e.teamId, kind: e.kind }))],
          transfers: nextTransfers,
          retirements: nextRetirements,
          archive: nextArchive,
          milestones: nextMilestones,
        });
      },

      resetSave: () => {
        resetLeagueBase();
        setTxContext([], [], '');
        setOwnerContext([]);
        setAwardScores([]);
        // 전체 데이터 초기화 = 새 출발 → 스포트라이트 본 기록도 리셋(튜토리얼 다시 봄). 인트로 슬라이드(onboarded)는
        // 유지(다시보기는 replayOnboarding). seenTips는 freshSave 밖이라 명시적으로 비운다(ONBOARDING 4).
        set({ ...freshSave, seenTips: {} });
      },
      completeOnboarding: () => set({ onboarded: true }),
      replayOnboarding: () => set({ onboarded: false }),
      markTip: (id) => set((s) => (s.seenTips[id] ? {} : { seenTips: { ...s.seenTips, [id]: true } })),
      resetTips: () => set({ seenTips: {} }),
      grantSupporter: () => set({ supporter: true }), // 결제 성공 시 호출(출시 시 IAP 콜백에 연결)
      setSupporter: (v) => set({ supporter: v }),     // 미리보기 토글(개발용) — 적용된 모습 확인
      setSfx: (v) => set({ sfxEnabled: v }),          // 효과음 켬/끔(설정) — 영속
    }),
    {
      name: 'baeknyeon-save',
      storage: createJSONStorage(() => AsyncStorage),
      version: SAVE_VERSION,
      // 구버전/손상 세이브 → 정규화(컨테이너 모양 강제) + 향후 breaking 변경 단계 변환. SAVE_SYSTEM.md.
      migrate: (persisted, version) => migrateSave(persisted, version) as never,
      partialize: (s) => ({
        onboarded: s.onboarded,
        supporter: s.supporter,
        sfxEnabled: s.sfxEnabled,
        seenTips: s.seenTips, // 본 스포트라이트 스텝(영구 추적 — 리로드/새 게임에도 유지, ONBOARDING 1·4)
        selectedTeamId: s.selectedTeamId,
        season: s.season,
        currentDay: s.currentDay,
        results: s.results,
        watchProgress: s.watchProgress,
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
        moneyOnlyIds: s.moneyOnlyIds,
        draftPicks: s.draftPicks,
        archive: s.archive,
        careerLog: s.careerLog,
        careerTotals: s.careerTotals,
        bonds: s.bonds,
        simCache: captureSimCache(), // 계산된 시즌 결과(REALTIME_SIM Phase1) — 워밍됐을 때만, 재로드 재계산 제거
        coachPool: s.coachPool,
        hallOfFame: s.hallOfFame,
        expelledLog: s.expelledLog,
        transfers: s.transfers,
        retirements: s.retirements,
        milestones: s.milestones,
        readNews: s.readNews,
        trainingFocus: s.trainingFocus,
        staffHead: s.staffHead,
        staffAssistants: s.staffAssistants,
        staffScouts: s.staffScouts,
        interviews: s.interviews,
        benchDirectives: s.benchDirectives,
        talkCooldown: s.talkCooldown,
        benchCooldown: s.benchCooldown,
        fanScore: s.fanScore,
        releaseAnger: s.releaseAnger,
        cash: s.cash,
        lastFinance: s.lastFinance,
        tryoutWish: s.tryoutWish,
        foreignAltPool: s.foreignAltPool,
        foreignSubUsed: s.foreignSubUsed,
        keepForeign: s.keepForeign,
        asianWish: s.asianWish,
        asianAltPool: s.asianAltPool,
        asianSubUsed: s.asianSubUsed,
        keepAsian: s.keepAsian,
      }),
      onRehydrateStorage: () => (state) => {
        // migrate(정규화)를 거쳐 모양은 안전하나, 심층 방어로 try/catch — 커밋이 throw하면
        // 크래시 루프 대신 fresh로 깨끗이 리셋(데이터 1개라 최악도 1인 손실). SAVE_SYSTEM §3.3.
        try {
          if (state?.playerBase) commitPlayerBase(state.playerBase);
          if (state?.rosters) commitRosters(state.rosters);
          if (state?.coachPool) commitCoachPool(state.coachPool.coaches, state.coachPool.assistants); // 감독 풀 복원(commitStaff 전 — staffHead가 참조)
          if (state?.selectedTeamId && state?.trainingFocus) setFocusOverride(state.selectedTeamId, state.trainingFocus);
          if (state?.staffHead || state?.staffAssistants || state?.staffScouts) commitStaff(state.staffHead ?? {}, state.staffAssistants ?? {}, state.staffScouts ?? {});
          setTxContext(state?.inSeasonTx ?? [], state?.faPool ?? [], state?.selectedTeamId ?? '');
          setRelationContext(state?.bonds ?? {}); // 인간관계 우정 컨텍스트(FA 해석)
          setMyTeamStaff(state?.selectedTeamId ?? ''); // 내 팀 등록(AI 기본 스태프 분리)
          setOwnerContext(state?.benchDirectives ?? []);
          setAwardScores(state?.archive ?? []); // 수상 프리미엄 컨텍스트 복원
          // 시뮬 결과 캐시 복원 — **반드시 맨 끝**(위 commit들이 baseVersion/txVersion을 bump한 뒤). 저장 키와 맞춰 재계산 제거(Phase1).
          restoreSimCache((state as { simCache?: import('../data/simCache').SimCache })?.simCache);
          useGameStore.setState({ hydrated: true });
        } catch (e) {
          console.warn('[save] 복원 실패 — fresh로 리셋:', e);
          resetLeagueBase();
          useGameStore.setState({ ...freshSave, hydrated: true });
        }
      },
    },
  ),
);
