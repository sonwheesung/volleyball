// 세이브 상태 전용 zustand 스토어. AsyncStorage 영속.
// 시즌 내 진화는 결정론 리플레이(currentDay), 시즌 경계에서 base 스냅샷을 커밋한다.
// 세이브: 선택 팀 / 시즌 / 현재 일자 / 결과 / 단장 거래 / 선수 base 스냅샷.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { debouncedAsyncStorage } from './persistStorage';
import { SAVE_VERSION, migrateSave, sanitizeSave, consumePendingClaimSeed } from './saveMigration';
import { accrueBonds, setRelationContext } from '../data/relationships';
import { commitPlayerBase, commitRosters, getTeam, resetLeagueBase, setFocusTimeline,
  hireHeadCoach, hireAssistant as hireAsstLeague, releaseAssistant as releaseAsstLeague,
  hireScout as hireScoutLeague, releaseScout as releaseScoutLeague, commitStaff, getStaffState, teamScoutReveal,
  currentCoachPool, commitCoachPool, assignCoach, reconcileStaff, resignTeamCoach, fireCoach as fireCoachLeague, getTeamCoach, grantStartingStaff, LEAGUE,
  currentBasePlayers, getCoachTimeline, getFixture } from '../data/league';
import { medianOvr, MED_REF } from '../engine/overall';
import { advanceCoaches } from '../data/staffLifecycle';
import { bottomStreak } from '../engine/staffLifecycle';
import { SEASON_DAYS } from '../engine/calendar';
import type { Coach, AssistantCoach } from '../types';
import { buildDraftContext } from '../data/draftSetup';
import { aiTargetOf } from '../data/rosterTarget';
import { leagueProduction } from '../data/production';
import { currentSeasonAwards } from '../data/awards';
import { detectSeasonMilestones } from '../data/milestones';
import { seasonInjuryDays, availableTeamPlayers } from '../data/injury';
import { buildLineup } from '../engine/lineup';
import { setTxContext, setOwnerContext, setInterventionContext, seasonTxLog, seasonScandals, availableFAsOnDay, rosterIdsOnDay, type Tx } from '../data/dynamics';
import type { MatchIntervention } from '../engine/simMatch';
import { captureSimCache, restoreSimCache } from '../data/simCache';
import {
  meetAccept, persuade, cardMatch,
  benchAccept, startSuggestAccept, benchRejectReason, startRejectReason, popularityOf, benchAngerPenalty, releaseAngerPenalty, fanScore as fanScoreOf, BENCH_MAX,
  TALK_COOLDOWN_DAYS, BENCH_COOLDOWN_DAYS,
  type DiscontentTopic, type TalkCard, type InterviewLog, type BenchDirective, type BenchReason, type OwnerFx, type OwnerRejectReason,
} from '../engine/owner';
import { applyForm } from '../engine/form';
import { formFactorOnDay } from '../data/dynamics';
import { discontentNow, teamFanbaseNow, buildOwnerFx } from '../data/owner';
import { settleSeason, applyNet, stanceCashBonus, type SeasonFinance } from '../engine/finance';
import { FOREIGN_SALARY, ASIAN_SALARY } from '../engine/foreign';
import { staffSpend, setMyTeamStaff } from '../data/league';
import { overall } from '../engine/overall';
import { awardHistoryOf } from '../data/awards';
import { computeStandings, displayCutoff, seasonStreaks, seasonResults, playedThroughDay } from '../data/standings';
import { coachInfoOf } from '../data/league';
import { buildPlayoffs, seriesByTeam } from '../data/playoffs';
import { currentRosters, evolveOnDay, getPlayer, SEASON } from '../data/league';
import { planNextAction } from '../engine/advance';
import { marketVal, setAwardScores, setSalaryEra } from '../data/awardSalary';
import { setSeasonHistory, upcomingStanceOf } from '../data/leagueHistory';
import { LEAGUE_CAP, maxSalaryFor, isFranchise } from '../engine/cap';
import { capPayroll } from '../data/roster';
import { ROSTER_MAX, canReleasePosition, inSeasonCost, severanceFee } from '../engine/transactions';
import { accrueCareer, appendSeasonLine } from '../engine/production';
import { diag } from '../lib/deviceLog';
import { fillRosters } from '../data/rookies';
import { resolveDraft } from '../engine/draft';
import { applyMatchXp } from '../engine/experience';
import { PROTECT_COUNT } from '../engine/compensation';
import { RETIRE_AGE } from '../engine/retire';
import type { Contract, DraftPickRecord, ExpelRecord, FAOffer, FocusSeg, ForeignSwapRecord, HofEntry, MatchResult, Milestone, Player, RetireRecord, SeasonArchive, SeasonAwards, TrainableStat, TrainingFocus, Transfer } from '../types';
import { DEFAULT_FA_OFFER } from '../engine/faMarket';
import { evalAchievements, achReward } from '../engine/achievements';
import { achTotals } from '../data/careerTotals';
import { canWatchAd, grantAd, unclaimedReward, applyCamp, applyCampCourse, courseUpgradable, CAMP_COURSES, CAMP_COURSE_COST, CAMP_CUR_GAIN, CAMP_POT_GAIN, CAMP_LEGACY_CUR_GAIN, CAMP_LEGACY_POT_GAIN, WELCOME_DIAMONDS, FRESH_AD_STATE, type AdState, type CampCourse } from '../engine/diamonds';
import { showRewardedForDiamonds } from '../lib/ads';
import { earnDiamonds, earnDiamondsBatch, spendDiamonds, getWallet } from '../lib/server';
import { adKey, achKey, campKey, newSaveId } from '../lib/walletKeys';
import { useAuthStore } from './useAuthStore';
import { track } from '../lib/analytics';

/** zustand persist 스토리지 키 — 세이브 도구(_dv_campoutbox·_dv_migrate_e2e)와 공유(리터럴 재타이핑 금지). */
export const SAVE_KEY = 'baeknyeon-save';

/** 전지훈련 기록(MONETIZATION §11.2) — 시드 폴백 재적용용 + 감사.
 *  유니온(H3 · 소급 보존): 구 모델 엔트리 stats[]→+1/+1, 코스 엔트리 course→ 임베드 {cur,pot}.
 *  cur/pot 폴백 매트릭스: stats[]=+1/+1 · course & cur/pot 없음(구 2026-07-02~07-07)=+2/+7(레거시) ·
 *  course & {cur,pot} 임베드(신규 2026-07-08~)=그 값(현행 +3/+3). 구매 시점 수치를 엔트리에 박아
 *  이후 상수 리밸런스가 이미 산 캠프를 소급으로 바꾸지 않게 한다(결정론·유료재화 소급 약화 금지). */
interface CampEntry { season: number; playerId: string; stats?: TrainableStat[]; course?: CampCourse; cur?: number; pot?: number }
/** 전지훈련 아웃박스(BACKEND §13.12 P0-4) — 서버 차감 성공 후 로컬 스탯 적용 전 크래시 복구용.
 *  서버 호출 전에 persist → 성공 시 적용+clear → 재기동 reconcile이 같은 key로 재확인 후 적용. */
interface PendingCamp { key: string; playerId: string; course: CampCourse; season: number }
// 재계약 결과(FA_SYSTEM §2.4) — 조용한 거부 대신 이유를 반환. 프랜차이즈는 팀캡 예외(over-team-cap 미발생).
export type ReSignReject = 'not-on-roster' | 'foreign' | 'invalid-contract' | 'over-individual-cap' | 'over-team-cap';
export type ReSignResult = { ok: true } | { ok: false; reason: ReSignReject };

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
  bgmVolume: number;                           // 배경음악 볼륨 0..1(SOUND_SYSTEM §3) — 사용자 환경설정(초기화해도 유지)
  seenTips: Record<string, true>;              // 본 스포트라이트 스텝 id 집합(ONBOARDING) — 세이브와 별개(초기화해도 유지)
  selectedTeamId: string | null;
  season: number;                              // 0-based 경과 시즌
  currentDay: number;                          // 시즌 내 경과 일수
  lastGrowthDay: number;                        // 성장 리포트 모달 — 마지막으로 성장 diff를 본 날(-1=미초기화). TRAINING §성장리포트
  results: Record<string, MatchResult>;
  watchProgress: Record<string, number>;       // fixtureId → 관전한 랠리 인덱스(이어보기). 종료/확정 시 삭제
  contractOverrides: Record<string, Contract>;
  released: string[];
  inSeasonTx: Tx[];                            // 시즌 중 이동(방출/영입) — dynamics 주입
  faPool: string[];                            // 시즌 시작 미계약 FA 풀(오프시즌 잔류)
  playerBase: Record<string, Player> | null;   // 시즌 시작 시점 선수 스냅샷(null=시드)
  rosters: Record<string, string[]> | null;    // 가변 팀 구성(null=시드)
  resignDecisions: Record<string, boolean>;    // 내 FA 잔류(true)/포기(false), 기본=잔류
  faOffers: Record<string, FAOffer>;           // 오프시즌 FA 지명별 오퍼(FA_SYSTEM §2.8 격상) — keys=영입 시도 id, 값=다레버 오퍼. 구 faSignings[]+faAggressive 대체
  protectedIds: string[];                      // 보호선수 명단(최대 PROTECT_COUNT)
  moneyOnlyIds: string[];                      // '돈만' 보상 선택 A/B FA id — 보상선수 면제·보상금 가중(FA_SYSTEM 2.2)
  draftPicks: string[];                        // 드래프트 찜(shortlist·우선순위) — 라이브 위시폴백/미표 자동지명 (FA_SYSTEM §3.2.1)
  draftSelections: string[];                   // 라이브 드래프트 내 슬롯 순서 확정 픽 — endSeason resolveDraft mySelections. FA/재계약 변경 시 clear
  archive: SeasonArchive[];                    // 역대 우승 + 시상 + 순위/연승연패/플옵
  careerLog: { faSigns: number; coachHires: number; staffHires: number; interviews: number }; // 단장 통산 액션(업적용)
  careerTotals: { points: number; aces: number; setsWon: number; setsLost: number; matchWins: number; matchLosses: number }; // 내 팀 통산 경기 기록(업적용)
  diamonds: number;                            // 다이아 잔액(MONETIZATION §11) — **표시용 캐시**(진실=서버, §13.12). 서버 확정 후에만 갱신
  saveId: string;                              // 세이브 인스턴스 nonce(walletEpoch) — camp 멱등키 스코프(세이브 리셋 무료강화 차단)
  campLog: CampEntry[];                        // 전지훈련 기록(시드 폴백 재적용·감사)
  campTrainedThisOffseason: string[];          // 이번 오프시즌 전지훈련한 선수(선수당 1회) — 새 시즌 시작 시 초기화
  campDoneSeason: number;                       // 전지훈련을 "마친" 시즌(=이 시즌엔 오프시즌 종료 → 개막전 노출). 시즌번호라 새 시즌 자동 리셋. 기본 -1
  pendingCamp: PendingCamp | null;             // 전지훈련 아웃박스(§13.12 P0-4) — 서버차감↔로컬적용 사이 크래시 복구
  walletBusy: boolean;                         // 다이아 서버 왕복 in-flight 래치(비영속) — 버튼 연타 이중적용 차단(P0-1)
  claimedAch: string[];                        // 다이아 수령한 업적 id(1회 지급)
  adState: AdState;                            // 광고 보상 쿨다운/하루상한 상태(메타 — 시드 무관)
  watchAdForDiamonds: () => Promise<{ ok: boolean; reward?: number; reason?: 'cooldown' | 'cap' | 'offline' | 'busy' | 'error' | 'no-ad' }>;
  claimAchDiamonds: () => Promise<{ granted: number; reason?: 'offline' | 'busy' | 'none' | 'cap' | 'already' }>; // 새로 달성한 업적 다이아 수령(서버 확정). already=이전 시도가 응답 유실로 이미 지급됨(멱등 재시도 확인)
  claimWelcomeDiamonds: () => Promise<{ applied: boolean }>; // 첫 전지훈련 진입 환영 선물(계정당 1회, 서버 멱등)
  trainingCamp: (playerId: string, course: CampCourse) => Promise<{ ok: boolean; reason?: string }>; // 오프시즌 전지훈련(서버 차감 후, §11.2)
  syncWallet: () => Promise<void>;             // 서버 잔액으로 캐시 리싱크(로그인/포그라운드/실패후 — §13.12 P0-3) + 아웃박스 정산
  reconcilePendingCamp: () => Promise<void>;   // 아웃박스 정산(재기동 복구)
  bonds: Record<string, number>; // 인간관계 우정(pairKey→0~0.3, 함께한 세월 누적, RELATIONSHIP_SYSTEM)
  coachPool: { coaches: Coach[]; assistants: AssistantCoach[] } | null; // 감독 생애주기 풀(null=시드, STAFF_SYSTEM 6)
  hallOfFame: HofEntry[];                      // 명예의전당(은퇴 레전드 통산 기록)
  expelledLog: ExpelRecord[];                  // 영구제명 연표(승부조작·학폭 — 불명예 퇴출, 뉴스/서사용)
  transfers: Transfer[];                       // FA 이적 연표(오프시즌 팀 이동, 뉴스 슬라이스3)
  retirements: RetireRecord[];                 // 은퇴 연표(주목 은퇴자 작별·회고, 뉴스 슬라이스5)
  seasonDraftLog: DraftPickRecord[];           // 드래프트 입단 연표(오프시즌 결산 뉴스 슬라이스6, §3.7)
  seasonForeignLog: ForeignSwapRecord[];       // 외인·아시아쿼터 교체 연표(슬라이스6, §3.7)
  milestones: Milestone[];                     // 기록 경신 피드(MILESTONE_SYSTEM)
  readNews: string[];                          // 읽은 뉴스 키(season:kind:headline) — 읽음/안읽음 구분(NEWS_SYSTEM)
  trainingFocus: TrainingFocus | null;         // 단장이 고른 내 팀 **현재** 훈련 방향(null=감독 기본, 표시·UI용)
  focusLog: FocusSeg[];                        // 훈련 방침 **타임라인**(A4 — "바꾼 날부터 적용", 본 역사 보존). 데이터층 진화가 소비
  staffHead: Record<string, string>;           // teamId → 영입 감독 id(STAFF_SYSTEM)
  staffAssistants: Record<string, string[]>;   // teamId → 영입 코치 ids
  staffScouts: Record<string, string[]>;       // teamId → 영입 스카우터 ids
  interviews: InterviewLog[];                  // 구단주 면담 로그(OWNER_SYSTEM) — FA 판정 입력
  benchDirectives: BenchDirective[];           // 감독 수락된 벤치 지시 — dynamics 주입
  interventions: Record<string, MatchIntervention[]>; // 경기 개입 로그(MATCH_INTERVENTION_SYSTEM §2) — fixtureId→개입[]. dynamics 주입
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
  setLastGrowthDay: (day: number) => void; // 성장 리포트 모달이 구간을 소비한 뒤 bump

  finishCamp: () => void; // 전지훈련 마치기 → 이번 시즌 오프시즌 종료(개막전 노출). currentDay는 그대로(경기 시작이 진행).
  recordResult: (r: MatchResult) => void;
  recordIntervention: (fixtureId: string, iv: MatchIntervention) => void; // 경기 개입 1건 append(MATCH_INTERVENTION §2) — 4단계 UI가 호출, 2단계는 배선만
  saveWatchProgress: (fixtureId: string, idx: number) => void; // 이어보기 위치 저장
  clearWatchProgress: (fixtureId: string) => void;             // 종료·결과 확정 시 삭제
  // 반환값(ok/reason) — 조용한 거부를 남기지 않음(호출부는 무시해도 무방, 배선은 제안). 캡 예외는 프랜차이즈만.
  reSign: (playerId: string, contract: Contract) => ReSignResult;
  release: (playerId: string) => boolean;
  unrelease: (playerId: string) => boolean;
  signInSeason: (faId: string) => boolean;
  setResign: (playerId: string, keep: boolean) => void;
  setOffer: (playerId: string, offer: FAOffer) => void;   // FA 오퍼 설정/교체(§2.8 Phase1 — 레버 UI는 Phase 4)
  clearOffer: (playerId: string) => void;                 // FA 오퍼 제거(지명 취소)
  signFA: (playerId: string) => void;                     // 컨비니언스 = 기본 오퍼로 setOffer(공격적 상태 승계)
  unsignFA: (playerId: string) => void;                   // 컨비니언스 = clearOffer
  setAggressive: (on: boolean) => void;                   // 공격적 영입(전역) = 전 오퍼 aggressive 마커 일괄 설정
  toggleProtect: (playerId: string) => void;
  toggleMoneyOnly: (playerId: string) => void;
  toggleDraftPick: (playerId: string) => void;
  setDraftSelections: (ids: string[]) => void;  // 라이브 드래프트 확정 픽(내 슬롯 순서) — 확정마다 즉시 영속
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
  suggestBench: (playerId: string, reason: BenchReason) => { ok: boolean; reason?: OwnerRejectReason };
  suggestStart: (playerId: string) => { ok: boolean; reason?: OwnerRejectReason };
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
  setBgmVolume: (v: number) => void;
}

const freshSave = {
  selectedTeamId: null as string | null,
  season: 0,
  currentDay: 0,
  lastGrowthDay: -1, // 성장 리포트 — 미초기화(-1). 첫 일정 포커스에서 currentDay로 세팅
  results: {} as Record<string, MatchResult>,
  watchProgress: {} as Record<string, number>,
  contractOverrides: {} as Record<string, Contract>,
  released: [] as string[],
  inSeasonTx: [] as Tx[],
  faPool: [] as string[],
  playerBase: null as Record<string, Player> | null,
  rosters: null as Record<string, string[]> | null,
  resignDecisions: {} as Record<string, boolean>,
  faOffers: {} as Record<string, FAOffer>,
  protectedIds: [] as string[],
  moneyOnlyIds: [] as string[],
  draftPicks: [] as string[],
  draftSelections: [] as string[],
  archive: [] as SeasonArchive[],
  careerLog: { faSigns: 0, coachHires: 0, staffHires: 0, interviews: 0 },
  careerTotals: { points: 0, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 },
  diamonds: 0,
  saveId: '', // 첫 전지훈련/새 게임 시작 시 생성(newSaveId) — camp 멱등키 스코프
  campLog: [] as CampEntry[],
  campTrainedThisOffseason: [] as string[],
  campDoneSeason: -1,
  pendingCamp: null as PendingCamp | null,
  claimedAch: [] as string[],
  adState: { ...FRESH_AD_STATE } as AdState,
  bonds: {} as Record<string, number>,
  coachPool: null as { coaches: Coach[]; assistants: AssistantCoach[] } | null,
  hallOfFame: [] as HofEntry[],
  expelledLog: [] as ExpelRecord[],
  transfers: [] as Transfer[],
  retirements: [] as RetireRecord[],
  seasonDraftLog: [] as DraftPickRecord[],   // 드래프트 입단 연표(오프시즌 결산 뉴스 §3.7) — 최근 150
  seasonForeignLog: [] as ForeignSwapRecord[], // 외인·아시아쿼터 교체 연표(§3.7) — 최근 150
  milestones: [] as Milestone[],
  readNews: [] as string[],
  trainingFocus: null as TrainingFocus | null,
  focusLog: [] as FocusSeg[], // 훈련 방침 타임라인(A4)
  staffHead: {} as Record<string, string>,
  staffAssistants: {} as Record<string, string[]>,
  staffScouts: {} as Record<string, string[]>,
  interviews: [] as InterviewLog[],
  benchDirectives: [] as BenchDirective[],
  interventions: {} as Record<string, MatchIntervention[]>, // 경기 개입 로그(MATCH_INTERVENTION §2) — fixtureId→개입[]
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

/** 전지훈련 로컬 적용 — **서버 차감 확정 뒤에만** 호출(BACKEND §13.12). 스탯 부스트+campLog+캐시 갱신+pending clear를 한 set으로.
 *  이미 적용된 선수(campTrainedThisOffseason)면 no-op(pending·캐시만 정리) — 아웃박스 재확인 시 이중적용 차단(P0-1). */
function applyCampLocal(playerId: string, course: CampCourse, balance: number, season: number): void {
  const st = useGameStore.getState();
  if (st.campTrainedThisOffseason.includes(playerId)) { useGameStore.setState({ diamonds: balance, pendingCamp: null }); return; }
  const p = getPlayer(playerId);
  if (!p) { useGameStore.setState({ diamonds: balance, pendingCamp: null }); return; }
  const camped = applyCampCourse(p, course); // 3스탯 현재+3·포텐+3(§11.2 코스형, 2026-07-08 대칭)
  commitPlayerBase({ [playerId]: camped }); // 레지스트리 즉시 반영(evoCache 무효화 → 화면 즉시)
  useGameStore.setState({
    diamonds: balance, // 표시 캐시 = 서버 확정 잔액
    // 구매 시점 수치를 임베드(cur/pot) → 이후 상수 리밸런스가 이 캠프를 소급으로 바꾸지 않음(H3)
    campLog: [...st.campLog, { season, playerId, course, cur: CAMP_CUR_GAIN, pot: CAMP_POT_GAIN }],
    campTrainedThisOffseason: [...st.campTrainedThisOffseason, playerId],
    pendingCamp: null,
    // 시즌≥1: 영속 base에도 굽기. 시즌0(base null): campLog가 재로드 시 시드에 재적용(§11.2 — 이중적용 없음)
    ...(st.playerBase ? { playerBase: { ...st.playerBase, [playerId]: camped } } : {}),
  });
  diag(season, 'wallet', `전지훈련 ${playerId} ${CAMP_COURSES[course].label} -${CAMP_COURSE_COST}💎`); // 진단 로그(#44)
}

// ── dev-local(오프라인 개발 세션) 다이아 로컬 처리 — __DEV__ 전용, 운영 무영향 ──────────────────
// "개발자 로그인"은 서버 Bearer 없는 세션(provider 'dev' + 빈 토큰, useAuthStore signIn dev 폴백)을 만든다.
// 이 세션엔 서버가 없어 earn/spend가 401로 실패 → 다이아 이코노미 전체가 막힌다. 개발 테스트를 위해
// **오직 이 세션에서만** 다이아를 로컬 캐시(diamonds)로 처리한다. 운영 빌드는 __DEV__===false라 항상 false이고,
// 실세션(google 등)은 provider·token 조건에서 걸러져 서버 진실 경로가 그대로 돈다([[server-authoritative-currency]]).
function isDevLocalSession(): boolean {
  if (!__DEV__) return false;
  const sess = useAuthStore.getState().session;
  return !!sess && sess.provider === 'dev' && !sess.token; // === userId.startsWith('dev-local:')
}
// 환영 다이아 계정당 1회 지급을 로컬로 표시(서버 멱등키 welcome:<userId>의 로컬 대체). claimedAch는 계정 단위로
// 영속·보존(selectTeam/새게임에서 유지)되므로 재선택해도 재지급되지 않는다. 실제 업적 id와 충돌 없는 센티넬.
const WELCOME_LOCAL_MARK = '__welcome_local__';

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      walletBusy: false, // 비영속 — 다이아 서버 왕복 in-flight 래치(P0-1, 버튼 연타 이중적용 차단)
      onboarded: false,
      supporter: false,
      sfxEnabled: true,
      bgmVolume: 0.8,
      seenTips: {},
      ...freshSave,

      // ── 다이아 이코노미 (MONETIZATION §11 · 서버 진실화 BACKEND §13.12) ──
      // diamonds는 **표시용 캐시**. 적립/차감은 서버 확정(earn/spend 응답 balance) 후에만 반영(로컬 산술 금지).
      // 서버 실패는 캐시 손 안 대고 syncWallet로 수렴. 버튼 연타는 walletBusy 래치로 차단(P0-1).
      watchAdForDiamonds: async () => {
        const s = get();
        if (s.walletBusy) return { ok: false, reason: 'busy' };
        const now = Date.now(); // 광고 쿨다운/상한은 메타(시드/결정론 무관)
        const c = canWatchAd(s.adState, now);
        if (!c.ok) return { ok: false, reason: c.reason };
        const userId = useAuthStore.getState().session?.userId;
        if (!userId) return { ok: false, reason: 'offline' }; // 로그인 안 됨 → 서버 귀속 불가
        // 실제 보상형 광고를 재생하고 **완주(earned)해야만** 지급(free-faucet 차단 §3.2). 미완주/노필/취소면 지급·쿨다운 소모 없음.
        set({ walletBusy: true });
        const adRes = await showRewardedForDiamonds();
        if (!adRes.earned) { set({ walletBusy: false }); return { ok: false, reason: 'no-ad' }; } // 광고 못 봄 → 슬롯 미소모(adState 불변)
        const now2 = Date.now(); // 광고 시청(수초~수십초) 후 시점으로 쿨다운 시작
        const { adState, reward } = grantAd(s.adState, now2); // 새 슬롯(count↑) — 실패 시 미커밋이라 재시도 동일키(멱등)
        // dev-local(오프라인 개발 세션)엔 서버가 없어 다이아를 로컬로 처리 — __DEV__ 전용, 운영 무영향.
        // 쿨다운/상한(canWatchAd·grantAd)은 그대로 두고 서버 적립만 로컬 잔액 반영으로 대체.
        if (isDevLocalSession()) {
          set({ walletBusy: false, diamonds: get().diamonds + reward, adState });
          track('watch_ad');
          track('diamond_earned', { source: 'ad', amount: reward });
          return { ok: true, reward };
        }
        const r = await earnDiamonds(reward, 'ad', adKey(userId, adState.dayIdx, adState.count));
        set({ walletBusy: false });
        if (!r.ok) { void get().syncWallet(); return { ok: false, reason: r.reason === 'offline' ? 'offline' : r.reason === 'cap' ? 'cap' : 'error' }; }
        set({ diamonds: r.balance, adState }); // 서버 확정 후에만 슬롯·캐시 커밋
        track('watch_ad');
        if (r.applied) track('diamond_earned', { source: 'ad', amount: reward });
        return { ok: true, reward: r.applied ? reward : 0 };
      },
      claimAchDiamonds: async () => {
        const s = get();
        if (s.walletBusy) return { granted: 0, reason: 'busy' };
        const my = s.selectedTeamId;
        if (!my) return { granted: 0, reason: 'none' };
        const userId = useAuthStore.getState().session?.userId;
        if (!userId) return { granted: 0, reason: 'offline' };
        // 통산 업적을 시즌 중에도 실시간 반영: 저장 careerTotals + 이번 시즌 진행분(achTotals). endSeason 누적과 이음매 없음.
        const statuses = evalAchievements({ myTeamId: my, archive: s.archive, hof: s.hallOfFame, milestones: s.milestones, cash: s.cash, fanScore: s.fanScore, careerLog: s.careerLog, careerTotals: achTotals(my, s.careerTotals, s.results) });
        const { ids } = unclaimedReward(statuses, s.claimedAch);
        if (!ids.length) return { granted: 0, reason: 'none' };
        set({ walletBusy: true });
        // 배치 적립 — N개 업적을 **1왕복 1트랜잭션**으로(순차 earn N회의 ~40s 병목 제거, BACKEND §4). achId별 dedup·평생합 캡·금액 서버권위는 서버가 보존.
        const items = ids.map((id) => ({ amount: achReward(id), idempotencyKey: achKey(userId, id), ref: id }));
        const r = await earnDiamondsBatch(items);
        if (!r.ok) { // 오프라인/에러 → 아무것도 확정 안 함(원자적). 재수령은 서버가 멱등 dedup.
          set({ walletBusy: false });
          void get().syncWallet();
          return { granted: 0, reason: 'offline' };
        }
        // results는 ids와 동일 순서. applied=신규지급(granted 합산) · capped=평생합 캡(지급0) · 둘 다 아님=멱등 재시도. 모두 confirm(재시도 차단).
        let granted = 0; const confirmed: string[] = []; let capped = false;
        r.results.forEach((res, i) => {
          confirmed.push(ids[i]);
          if (res.applied) granted += achReward(ids[i]); // 부분지급도 applied — 현 단건 의미 보존(정당 유저는 캡 경계 미도달)
          else if (res.capped) capped = true; // 평생합 캡 도달(치터 전용) — 확정 처리해 영구 재시도 차단
        });
        set({ walletBusy: false, ...(confirmed.length ? { claimedAch: [...get().claimedAch, ...confirmed] } : {}), diamonds: r.balance });
        if (granted > 0) track('diamond_earned', { source: 'achievement', amount: granted });
        if (capped) return { granted, reason: 'cap' };
        // 전부 멱등 재시도(applied·capped 둘 다 아님) = 이전 시도가 응답 유실로 이미 지급된 케이스(운영 사고 2026-07-11).
        // "새로 달성한 업적이 없습니다"라고 하면 거짓 — 이미 반영됐음을 알린다.
        if (granted === 0 && confirmed.length > 0) return { granted, reason: 'already' };
        return { granted };
      },
      // 첫 전지훈련 진입 환영 선물 — 서버가 계정당 1회 지급(멱등키 welcome:<userId>, 금액 서버 고정 1000).
      // applied=true면 이번이 첫 지급(호출부가 팝업). false=이미 받음(조용). 다이아=서버 진실이라 서버 확정 후 캐시 반영.
      claimWelcomeDiamonds: async () => {
        const userId = useAuthStore.getState().session?.userId;
        if (!userId) return { applied: false }; // 로그인 안 됨(오프라인) — 다음 온라인 진입에서 재시도
        // dev-local(오프라인 개발 세션)엔 서버가 없어 다이아를 로컬로 처리 — __DEV__ 전용, 운영 무영향.
        // 계정당 1회: claimedAch의 센티넬로 이미 받았는지 확인(서버 applied 멱등 모사). 첫 지급만 applied:true.
        if (isDevLocalSession()) {
          if (get().claimedAch.includes(WELCOME_LOCAL_MARK)) return { applied: false };
          set({ diamonds: get().diamonds + WELCOME_DIAMONDS, claimedAch: [...get().claimedAch, WELCOME_LOCAL_MARK] });
          track('diamond_earned', { source: 'welcome', amount: WELCOME_DIAMONDS });
          return { applied: true };
        }
        const r = await earnDiamonds(WELCOME_DIAMONDS, 'welcome', `welcome:${userId}`);
        if (!r.ok) { void get().syncWallet(); return { applied: false }; }
        set({ diamonds: r.balance }); // 서버 확정 후에만 캐시
        if (r.applied) track('diamond_earned', { source: 'welcome', amount: WELCOME_DIAMONDS });
        return { applied: r.applied };
      },
      trainingCamp: async (playerId, course) => {
        const s = get();
        if (s.walletBusy) return { ok: false, reason: 'busy' };
        const my = s.selectedTeamId;
        if (!my) return { ok: false, reason: 'no-team' };
        if (s.currentDay !== 0) return { ok: false, reason: 'not-offseason' }; // 오프시즌(경기0)만 — 재시뮬/소급 방지(§11.2)
        if (s.campTrainedThisOffseason.includes(playerId)) return { ok: false, reason: 'already' }; // 선수당 오프시즌 1회
        if (!CAMP_COURSES[course]) return { ok: false, reason: 'no-course' }; // 유효 코스만(손상 입력 가드)
        if (!(currentRosters()[my] ?? []).includes(playerId)) return { ok: false, reason: 'not-mine' };
        const base = getPlayer(playerId);
        if (!base) return { ok: false, reason: 'not-found' };
        // 정년(40세) 앞둔 선수 차단(2026-07-08): day0의 age>=39는 이번 시즌 뒤 무조건 은퇴 → "동행 연장"을 팔 수 없다.
        //   경고가 아니라 차단(사용자 결정). RETIRE_AGE-1 이상 = 다음 롤오버 정년 도달.
        if (base.age >= RETIRE_AGE - 1) return { ok: false, reason: 'retiring' };
        if (!courseUpgradable(base, course)) return { ok: false, reason: 'maxed' }; // 3스탯 전부 현재·포텐 99
        const userId = useAuthStore.getState().session?.userId;
        if (!userId) return { ok: false, reason: 'offline' };
        // dev-local(오프라인 개발 세션)엔 서버가 없어 다이아를 로컬로 처리 — __DEV__ 전용, 운영 무영향.
        // 서버 차감(spendDiamonds)·아웃박스(pendingCamp) 대신 로컬 잔액에서 직접 차감. 스탯 부스트·campLog는
        // 기존 applyCampLocal 로직 그대로(로컬 효과 보존) — 서버 게이트만 로컬 잔액 검사로 대체. 실세션은 아래 서버 경로 불변.
        if (isDevLocalSession()) {
          if (s.diamonds < CAMP_COURSE_COST) return { ok: false, reason: 'no-diamonds' };
          applyCampLocal(playerId, course, s.diamonds - CAMP_COURSE_COST, s.season); // 차감 잔액으로 캐시 갱신 + 스탯 + campLog
          track('special_training', { course });
          track('diamond_spent', { source: 'camp', amount: CAMP_COURSE_COST });
          return { ok: true };
        }
        // saveId(walletEpoch) 지연 생성 — camp 멱등키 세이브 스코프(리셋 무료강화 차단)
        let saveId = s.saveId;
        if (!saveId) { saveId = newSaveId(); set({ saveId }); }
        const key = campKey(userId, saveId, s.season, playerId);
        // 아웃박스(P0-4): 서버 호출 **전에** pending persist → spend 성공 후 크래시해도 재기동 reconcile이 복구
        set({ walletBusy: true, pendingCamp: { key, playerId, course, season: s.season } });
        const r = await spendDiamonds(CAMP_COURSE_COST, 'camp', key, `${playerId}:${course}`);
        if (!r.ok) {
          set({ walletBusy: false, pendingCamp: null }); // 차감 안 됨 → 아웃박스 취소(적용 안 함)
          if (r.reason !== 'offline') void get().syncWallet(); // insufficient/error/unauthorized → 캐시 수렴(P0-3)
          return { ok: false, reason: r.reason === 'offline' ? 'offline' : r.reason === 'insufficient' ? 'no-diamonds' : 'error' };
        }
        applyCampLocal(playerId, course, r.balance, s.season); // 서버 확정(applied true/false=이미 과금) → 스탯 적용+campLog+clear
        set({ walletBusy: false });
        track('special_training', { course });
        track('diamond_spent', { source: 'camp', amount: CAMP_COURSE_COST });
        return { ok: true };
      },
      syncWallet: async () => {
        const userId = useAuthStore.getState().session?.userId;
        if (!userId) return;
        const r = await getWallet();
        if (r.ok) {
          const patch: Partial<GameState> = { diamonds: r.balance }; // 서버 잔액으로 캐시 리싱크(P0-3)
          // 광고 쿨다운/캡을 서버 원장에서 복원(§13.19) — 구단 초기화·재설치로 못 우회(서버 진실). today=UTC일 정합.
          if (r.adToday) {
            const today = Math.floor(Date.now() / 86_400_000);
            patch.adState = { dayIdx: today, count: r.adToday.count, lastAdAt: r.adToday.lastAtMs ?? 0 };
          }
          set(patch);
        }
        await get().reconcilePendingCamp();      // 아웃박스 정산(재기동/포그라운드 복구)
      },
      reconcilePendingCamp: async () => {
        const s = get();
        const pc = s.pendingCamp;
        if (!pc) return;
        if (s.campTrainedThisOffseason.includes(pc.playerId)) { set({ pendingCamp: null }); return; } // 이미 적용됨(clear 전 크래시)
        if (!useAuthStore.getState().session?.userId) return; // 오프라인 → pending 유지, 다음 기회
        const r = await spendDiamonds(CAMP_COURSE_COST, 'camp', pc.key, `${pc.playerId}:${pc.course}`);
        if (!r.ok) return; // 오프라인/일시오류 → pending 유지
        applyCampLocal(pc.playerId, pc.course, r.balance, pc.season); // dup(applied:false)=이미 과금 확정 → 스탯 적용
      },

      selectTeam: (teamId) => {
        const prev = get();
        resetLeagueBase();
        // 계정 소유 재화·업적수령·광고상태는 **구단 초기화해도 유지**(§13.19 — 다이아/업적은 서버 진실·계정 평생). saveId만 새로(camp 재과금=정당).
        set({ ...freshSave, selectedTeamId: teamId, saveId: newSaveId(), diamonds: prev.diamonds, claimedAch: prev.claimedAch, adState: prev.adState });
        setTxContext([], [], teamId);
        setMyTeamStaff(teamId); // 내 팀만 영입 스태프, 나머지는 AI 기본 스태프(STAFF_SYSTEM 7)
        // 시작 기본 스태프(ONBOARDING 6) — 플레이어 팀을 0이 아니라 코치1+스카우터1로 출발시킨다(AI와 대칭).
        const staff = grantStartingStaff(teamId);
        set({ staffHead: staff.head, staffAssistants: staff.asst, staffScouts: staff.scout });
        setOwnerContext([]);
        setInterventionContext({}); // 새 세이브 — 개입 로그 없음(MATCH_INTERVENTION §2)
        setAwardScores([]); // 새 세이브 — 수상 이력 없음
        setSeasonHistory([]); // 모기업 기조(FINANCE 2.0) 컨텍스트 — 이력 없음
        setSalaryEra(medianOvr(currentBasePlayers().filter((p) => !p.isForeign))); // 시대 앵커(SALARY 2장) — 시드 시대 ≈ MED_REF
      },
      setDay: (day) => set((s) => (Number.isFinite(day) ? { currentDay: Math.max(s.currentDay, day) } : {})), // NaN/Infinity 거부(currentDay 오염 전파 차단)
      setLastGrowthDay: (day) => set(() => (Number.isFinite(day) ? { lastGrowthDay: day } : {})),
      finishCamp: () => set((s) => (s.campDoneSeason === s.season ? {} : { campDoneSeason: s.season })), // 이번 시즌 오프시즌 종료 표시(멱등). currentDay 불변 — 개막전은 "경기 시작"이 진행
      recordResult: (r) => set((s) => ({ results: { ...s.results, [r.fixtureId]: r } })),
      // 경기 개입 1건 append(MATCH_INTERVENTION §2) — 4단계 보드 UI가 호출, 2단계는 배선만.
      //   해당 fixture 배열에 push → 상태 갱신 + setInterventionContext(파생 캐시 무효화, §2.3 접미 bump = 그 경기일).
      //   fixture는 관전 중(=currentDay) 경기라 minAffectedDay=fixture.dayIndex → forward-only 스플라이스와 정합.
      recordIntervention: (fixtureId, iv) => {
        const s = get();
        const cur = s.interventions[fixtureId] ?? [];
        const interventions = { ...s.interventions, [fixtureId]: [...cur, iv] };
        set({ interventions });
        const dayIndex = getFixture(fixtureId)?.dayIndex ?? 0; // 좌표 불명 fixture는 0(전체 재계산, 안전 폴백)
        setInterventionContext(interventions, dayIndex);
      },
      saveWatchProgress: (fixtureId, idx) => set((s) => ({ watchProgress: { ...s.watchProgress, [fixtureId]: idx } })),
      clearWatchProgress: (fixtureId) => set((s) => {
        if (s.watchProgress[fixtureId] === undefined) return {};
        const next = { ...s.watchProgress }; delete next[fixtureId];
        return { watchProgress: next };
      }),
      reSign: (playerId, contract) => {
        // 내 로스터 선수 + 정상 계약 + **캡 인지**만 허용. 검증 없으면 음수 연봉(payroll 음수→캡 무력화)
        // 또는 거대 연봉(개인 7천만배·팀 캡 초과)으로 캡을 뚫는다(전체게임 퍼저 Defect3·확장몽키, EC-TX-04).
        // 반환값(ok/reason)으로 거부 이유를 알린다(조용한 무시 제거). UI는 항상 정상 계약을 보냄.
        const s = get();
        const my = s.selectedTeamId ?? '';
        const rosterIds = currentRosters()[my] ?? [];
        if (!rosterIds.includes(playerId)) return { ok: false, reason: 'not-on-roster' };
        // 외인/아시아쿼터는 국내 재계약 흐름 비대상 — 트라이아웃 재지명(keepForeign)으로만 갱신(FOREIGN_SYSTEM 3장)
        if (getPlayer(playerId)?.isForeign) return { ok: false, reason: 'foreign' };
        const { salary, years, remaining } = contract;
        if (![salary, years, remaining].every((v) => Number.isFinite(v))) return { ok: false, reason: 'invalid-contract' };
        if (salary <= 0 || years < 1 || remaining < 1 || remaining > years) return { ok: false, reason: 'invalid-contract' };
        // 재계약 후 내 국내 payroll이 캡 초과면 거부(다른 영입과 일관 — 캡은 하드). 외인은 캡 제외.
        const target = evolveOnDay(playerId, s.currentDay);
        // 개인 연봉 상한(MAX_SALARY 8억 / 프랜차이즈 11억) — 팀캡만 보면 단일선수 거대연봉으로 우회 가능(EC-TX-04 잔여)
        if (target && !target.isForeign && salary > maxSalaryFor(target)) return { ok: false, reason: 'over-individual-cap' };
        // 프랜차이즈 재계약은 팀캡 예외(FA_SYSTEM §2.4 "재계약 시 샐러리캡 일부 예외") — engine/cap.canAfford(franchise=true)와 동일 규칙.
        //   UI(app/contracts.tsx pickOffer)는 canAfford로 이 예외를 이미 통과시키는데, store 하드캡이 다시 막아 "조용한 거부"가 나던 걸 통일한다.
        //   개인 상한(위 maxSalaryFor=FRANCHISE_MAX 11억)은 프랜차이즈에도 여전히 적용 — 팀캡만 면제(canAfford의 "일부 예외" 의미를 정본으로 따름).
        if (target && !target.isForeign && !isFranchise(target)) {
          // 캡 게이트 = 단일 규칙(capPayroll §7): 그날 유효 명단(방출 제외 + 시즌 중 영입 포함)에 재계약 override
          // (playerId=제안 연봉)·시즌 중 영입비까지 반영. 과거 인라인 루프는 시즌 중 영입분을 빠뜨려 캡을 저평가했다.
          const { myReleased, mySigned } = myRosterDelta(my, s.inSeasonTx, rosterIds);
          const betrayedBy = (id: string) => s.inSeasonTx.some((t) => t.kind === 'release' && t.teamId === my && t.playerId === id);
          const effPlayers = [...rosterIds.filter((id) => !myReleased.has(id)), ...mySigned]
            .map((id) => evolveOnDay(id, s.currentDay))
            .filter((p): p is Player => !!p);
          const nextOverrides = { ...s.contractOverrides, [playerId]: contract };
          if (capPayroll(effPlayers, nextOverrides, new Set(mySigned), betrayedBy) > LEAGUE_CAP) return { ok: false, reason: 'over-team-cap' };
        }
        set((st) => ({ contractOverrides: { ...st.contractOverrides, [playerId]: contract }, draftSelections: [] })); // 재계약=구성 변동 → 확정 픽 무효
        diag(s.season, 'transaction', `재계약 ${playerId} 연봉 ${salary}·${years}년`); // 진단 로그(§13.20 ④)
        return { ok: true };
      },
      // 시즌 중 방출 → FA 풀(dynamics가 영입 가능하게). released[]는 표시용, inSeasonTx는 시뮬용.
      // 정원 하한(ROSTER_MIN) 게이트 — 명단이 비어 경기 불가가 되는 상태를 원천 차단.
      release: (playerId) => {
        const s = get();
        if (s.currentDay > SEASON_DAYS) return false; // 플옵 엔트리 동결(SEASON §5.0) — 지갑·명단 변경 차단(딥링크/UI 우회 방어)
        if (s.released.includes(playerId)) return false;
        const my = s.selectedTeamId ?? '';
        const rosterIds = currentRosters()[my] ?? [];
        const { myReleased, mySigned } = myRosterDelta(my, s.inSeasonTx, rosterIds);
        // 내 유효 로스터(시즌초 명단 + 시즌 중 영입) 선수만 방출 가능 — 타 팀/존재 안 함 id 주입 차단.
        // (없으면 팬텀 방출로 이중 소속·영입비 누수·자기 방출 DoS, 2026-06-20 전체게임 퍼저 발견)
        if (!rosterIds.includes(playerId) && !mySigned.includes(playerId)) return false;
        // 외인/아시아쿼터 방출 차단 — 외인은 FA 풀로 안 가므로(FOREIGN_SYSTEM 3장) 방출 시 시즌 1회 교체 외엔
        // 못 메우는 공석이 된다. 외인은 시즌 중 교체(replaceForeign)·오프시즌 트라이아웃에서만 정리(리뷰 발견 2026-06-25).
        if (getPlayer(playerId)?.isForeign) return false;
        // 방출 하한 = 포지션 인지 floor(FA_SYSTEM §1.6) — 그 포지션이 floor 미만이 되는 방출 차단('세터 0명' 방지).
        //   유효 명단(시즌초−방출+영입)의 포지션 카운트로 판정. buildLineup throw-guard와 같은 결(경기 성립 사전 보장).
        const effPlayers = [...rosterIds.filter((id) => !myReleased.has(id)), ...mySigned]
          .map((id) => evolveOnDay(id, s.currentDay))
          .filter((p): p is Player => !!p);
        if (!canReleasePosition(effPlayers, playerId)) return false;
        // 위약금(TRANSACTION_SYSTEM 0.5①) — 잔여 보장액의 일부를 운영 자금에서 즉시 정산. 지갑이 모자라면 방출 불가.
        const c = getPlayer(playerId)?.contract;
        const fee = c ? severanceFee(c.salary, c.remaining) : 0;
        if (fee > s.cash) return false;
        const inSeasonTx: Tx[] = [...s.inSeasonTx, { day: s.currentDay, teamId: my, playerId, kind: 'release' }];
        // 팬 분노 적립(방출 시점 인기 — TRANSACTION_SYSTEM 0.5③). endSeason서 fanScore에 반영.
        const anger = releaseAngerOf(playerId, s.archive, s.currentDay);
        set({ released: [...s.released, playerId], inSeasonTx, cash: s.cash - fee, releaseAnger: s.releaseAnger + anger });
        diag(s.season, 'transaction', `방출 ${playerId} 위약금 ${fee}`); // 진단 로그(§13.20 ④)
        setTxContext(inSeasonTx, get().faPool, my, s.currentDay); // §7 스플라이스: tx day 이전 경기 재사용
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
        setTxContext(inSeasonTx, get().faPool, get().selectedTeamId ?? '', tx.day); // §7: 취소되는 방출 day(=currentDay) 이후만 재시뮬
        return true;
      },
      // 시즌 중 FA 영입(캡·정원 검증). dynamics는 플레이어 거래를 검증 없이 적용하므로 여기서 게이트.
      signInSeason: (faId) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my) return false;
        if (s.currentDay > SEASON_DAYS) return false; // 플옵 엔트리 동결(SEASON §5.0) — 지갑·명단 변경 차단(딥링크/UI 우회 방어)
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
        // 캡 게이트 = 단일 규칙(capPayroll §7): 기존 로스터는 override 인지(과거 base 연봉만), 시즌 중 영입은 inSeasonCost. 국내 전용.
        const effPlayers = [...rosterIds.filter((id) => !myReleased.has(id)), ...mySigned]
          .map((id) => evolveOnDay(id, s.currentDay))
          .filter((p): p is Player => !!p);
        const payroll = capPayroll(effPlayers, s.contractOverrides, new Set(mySigned), betrayedBy);
        const signCost = inSeasonCost(marketVal(fa), betrayedBy(faId));
        if (payroll + signCost > LEAGUE_CAP) return false;
        if (signCost > s.cash) return false; // 운영 자금 부족(FINANCE) — 캡이 남아도 지갑이 비면 못 뽑는다
        const inSeasonTx: Tx[] = [...s.inSeasonTx, { day: s.currentDay, teamId: my, playerId: faId, kind: 'sign' }];
        set({ inSeasonTx, cash: s.cash - signCost, careerLog: { ...s.careerLog, faSigns: s.careerLog.faSigns + 1 } }); // 지갑 즉시 차감 + 영입 카운트
        diag(s.season, 'transaction', `시즌중 FA 영입 ${faId} 비용 ${signCost}`); // 진단 로그(§13.20 ④)
        setTxContext(inSeasonTx, get().faPool, my, s.currentDay); // §7 스플라이스
        return true;
      },
      // 상류 FA/재계약 변경은 드래프트 순번(myPickSlots)·클래스 구성을 바꾼다 → 라이브에서 확정한 draftSelections를
      //   무효화(clear). 안 지우면 슬롯이 밀려 다른 선수를 지명하는 stale-pick 발생(FA_SYSTEM §3.2.1 조정 D).
      setResign: (playerId, keep) =>
        set((s) => ({ resignDecisions: { ...s.resignDecisions, [playerId]: keep }, draftSelections: [] })),
      // FA 오퍼(§2.8 Phase1) — setOffer/clearOffer가 정본 primitive. signFA/unsignFA/setAggressive는 컨비니언스 래퍼(Phase 4 레버 UI 전).
      //   상류 FA 변경은 드래프트 순번·클래스를 바꾸므로 확정 픽(draftSelections) 무효화(§3.2.1 조정 D).
      setOffer: (playerId, offer) =>
        set((s) => ({ faOffers: { ...s.faOffers, [playerId]: offer }, draftSelections: [] })),
      clearOffer: (playerId) =>
        set((s) => {
          if (!s.faOffers[playerId]) return s;
          const next = { ...s.faOffers }; delete next[playerId];
          return { faOffers: next, moneyOnlyIds: s.moneyOnlyIds.filter((id) => id !== playerId), draftSelections: [] }; // 지명 취소 시 '돈만'도 해제
        }),
      signFA: (playerId) =>
        set((s) => {
          if (s.faOffers[playerId]) return s;
          // 기본 오퍼(원탭 자동, §2.8.1 ④). 현재 공격적 영입(전역) 상태를 승계 — aggressive 오퍼가 하나라도 있으면 새 오퍼도 공격적.
          const aggr = Object.values(s.faOffers).some((o) => o.aggressive);
          const offer: FAOffer = { ...DEFAULT_FA_OFFER, promises: {}, ...(aggr ? { aggressive: true } : {}) };
          return { faOffers: { ...s.faOffers, [playerId]: offer }, draftSelections: [] };
        }),
      unsignFA: (playerId) =>
        set((s) => {
          if (!s.faOffers[playerId]) return s;
          const next = { ...s.faOffers }; delete next[playerId];
          return { faOffers: next, moneyOnlyIds: s.moneyOnlyIds.filter((id) => id !== playerId), draftSelections: [] };
        }),
      // 공격적 영입(전역 토글) — 구 faAggressive 재현: 현 오퍼 전부에 aggressive 마커를 일괄 설정('auto' 해석 ×1.2).
      setAggressive: (on) =>
        set((s) => ({
          faOffers: Object.fromEntries(Object.entries(s.faOffers).map(([id, o]) => [id, { ...o, aggressive: on }])),
          draftSelections: [],
        })),
      toggleProtect: (playerId) =>
        set((s) => {
          if (s.protectedIds.includes(playerId))
            return { protectedIds: s.protectedIds.filter((id) => id !== playerId), draftSelections: [] };
          if (!(currentRosters()[s.selectedTeamId ?? ''] ?? []).includes(playerId)) return s; // 내 로스터만 보호(유령/타팀 id 무시 — 보호슬롯 낭비 방지)
          if (s.protectedIds.length >= PROTECT_COUNT) return s; // 정원 초과 무시
          return { protectedIds: [...s.protectedIds, playerId], draftSelections: [] };
        }),
      toggleMoneyOnly: (playerId) =>
        set((s) => (s.moneyOnlyIds.includes(playerId)
          ? { moneyOnlyIds: s.moneyOnlyIds.filter((id) => id !== playerId), draftSelections: [] }
          : { moneyOnlyIds: [...s.moneyOnlyIds, playerId], draftSelections: [] })),
      toggleDraftPick: (playerId) =>
        set((s) =>
          s.draftPicks.includes(playerId)
            ? { draftPicks: s.draftPicks.filter((id) => id !== playerId) }
            : { draftPicks: [...s.draftPicks, playerId] },
        ),
      // 라이브 드래프트 확정 픽(내 슬롯 순서, FA_SYSTEM §3.2.1 조정 D) — 확정마다 즉시 set(디바운스 영속).
      //   endSeason의 resolveDraft가 mySelections로 소비. 재개(앱 종료 후)는 이 배열로 시퀀스 재계산 → fast-forward.
      setDraftSelections: (ids) => set({ draftSelections: [...ids] }),
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
        // A4(2026-07-08, 사용자 결정): 방침은 **바꾼 날부터** 적용(본 역사 보존) — day0 소급 금지.
        //   타임라인(focusLog)에 forward-only 세그먼트를 덧댄다. fromDay = max(currentDay, playedThroughDay+1)
        //   (A2와 동일 불변식 — 이미 관전·기록한 경기일엔 절대 새 방침이 소급 안 됨). 같은 날 재변경은 그 날 세그먼트 덮어씀.
        const s = get();
        const tid = s.selectedTeamId;
        if (!tid) { set({ trainingFocus: focus }); return; }
        const fromDay = Math.max(s.currentDay, playedThroughDay(s.results) + 1);
        const focusLog: FocusSeg[] = [...s.focusLog.filter((seg) => seg.fromDay < fromDay), { fromDay, focus }];
        setFocusTimeline(tid, focusLog, fromDay); // §7 스플라이스: fromDay 이전 진화·경기 불변 → 재사용
        set({ trainingFocus: focus, focusLog });
      },
      // 스태프 계약(STAFF_SYSTEM) — league가 예산·중복을 판정하고, 성공 시 상태를 동기화
      hireCoach: (coachId) => {
        const s0 = get();
        const tid = s0.selectedTeamId;
        if (!tid) return false;
        // 축3: 부임일 = 아직 안 치른 다음 경기일(setTrainingFocus와 동일). 그날부터 새 감독 → 이전 경기·성장은 이전 감독(forward-only).
        const hireDay = Math.max(s0.currentDay, playedThroughDay(s0.results) + 1);
        const ok = hireHeadCoach(tid, coachId, hireDay);
        if (ok) { const s = getStaffState(); set((st) => ({ staffHead: s.head, staffAssistants: s.asst, staffScouts: s.scout, coachPool: currentCoachPool(), careerLog: { ...st.careerLog, coachHires: st.careerLog.coachHires + 1 } })); diag(get().season, 'staff', `감독 선임 ${coachId}`); } // 진단 로그(§13.20 ④)
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
        diag(get().season, 'staff', `감독 경질 (대행 ${r.acting ?? '공석'})`); // 진단 로그(§13.20 ④)
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
        // 성적 가중(perfT): 앱 표준 표시 컷오프(§3.3 displayCutoff, results-aware, F3 2026-07-07)로 통일. 치른 경기 0
        // (cutoff<0: 시즌 초·오프시즌)이면 순위가 비어 무의미하므로 직전 시즌 최종 순위로 폴백(막 끝난 성적 = 현재 팀 위상).
        const cut = displayCutoff(s.currentDay, s.results, my);
        const order = cut >= 0
          ? computeStandings(cut).map((r) => r.teamId)
          : (s.archive.length ? s.archive.reduce((m, a) => (a.season > m.season ? a : m)).standings ?? [] : []);
        const rank = Math.max(1, order.indexOf(my) + 1);
        const perfT = order.length <= 1 ? 1 : 1 - (rank - 1) / (order.length - 1);
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
        if (!my) return { ok: false };
        if (s.currentDay > SEASON_DAYS) return { ok: false, reason: 'postseason' }; // 플옵 엔트리 동결(SEASON §5.0) — UI 우회(딥링크) 방어
        if (s.currentDay < (s.benchCooldown[playerId] ?? 0)) return { ok: false }; // 건의 쿨다운(방어)
        // 활성(미철회) 지시만 슬롯·중복 판정(A3) — 철회(toDay 박힘)된 지시는 슬롯을 비우고 재건의를 허용한다.
        const activeDirectives = s.benchDirectives.filter((b) => b.toDay == null);
        if (activeDirectives.length >= BENCH_MAX) return { ok: false };
        if (activeDirectives.some((b) => b.playerId === playerId)) return { ok: false };
        const squad = rosterIdsOnDay(my, s.currentDay)
          .map((id) => evolveOnDay(id, s.currentDay))
          .filter((q): q is Player => !!q)
          .sort((a, b) => overall(b) - overall(a));
        const target = squad.find((q) => q.id === playerId);
        if (!target) return { ok: false };
        const aceRank = squad.findIndex((q) => q.id === playerId);
        const alt = squad.find((q) => q.id !== playerId && q.position === target.position);
        // Form 비대칭(OWNER §2.2 ★): 대체자(alt)의 현재 준비 상태(경기감각) 반영 — 폼 나쁜 백업 위해 주전 빼는 건 무리.
        //   target(현 주전)은 폼≈1.0이라 순수 OVR. 선발 건의(suggestStart)는 건의선수 폼 미반영(악순환 방지).
        const altOvr = alt ? overall(applyForm(alt, formFactorOnDay(my, alt.id, s.currentDay))) : null;
        const gap = altOvr != null ? overall(target) - altOvr : 10;
        const ovrGapT = Math.max(0, Math.min(1, 1 - gap / 10)); // 대체자가 비등할수록 1
        const charisma = coachInfoOf(my)?.charisma ?? 50;
        const ok = benchAccept(playerId, s.season, s.currentDay, charisma, ovrGapT, aceRank, reason);
        const why = ok ? undefined : benchRejectReason(charisma, ovrGapT, aceRank, reason);
        const benchCd = { ...s.benchCooldown, [playerId]: s.currentDay + BENCH_COOLDOWN_DAYS }; // 건의했으면(수락·거절 무관) 잠금
        if (ok) {
          // 관전 중(이어보기 대기) 경기엔 미적용 → 다음 경기부터(OWNER_SYSTEM 2.3, 옵션 A). watchProgress 비어있지 않음 == 현재 경기 관전 중.
          // 소급 방어(A2, 2026-07-08): 오늘 경기를 기록(watchProgress 비움·setDay 전)한 직후엔 currentDay가 아직 그
          //   기록된 경기일이라 fromDay=currentDay가 **이미 관전한 경기를 리플레이에서 소급 변경**한다. playedThroughDay+1로
          //   바닥을 대 기록된 경기일엔 절대 지시가 걸리지 않게 한다(forward-only — 본 역사 보존).
          const fromDay = Math.max(s.currentDay + (Object.keys(s.watchProgress).length > 0 ? 1 : 0), playedThroughDay(s.results) + 1);
          const benchDirectives = [...s.benchDirectives, { playerId, fromDay }];
          set({ benchDirectives, benchCooldown: benchCd });
          setOwnerContext(benchDirectives, fromDay); // §7 스플라이스: fromDay 이전 경기 재사용
        } else {
          set({ benchCooldown: benchCd });
        }
        diag(s.season, 'bench', `벤치 건의 ${playerId}(${reason}) → ${ok ? '수락' : '거절'}`); // 진단 로그(§13.20 ④)
        return { ok, reason: why };
      },
      // 선발 기용 건의 — 수락 시 동포지션 최약 주전을 벤치 지시(건의 선수가 그 자리를 잇는다)
      suggestStart: (playerId) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my) return { ok: false };
        if (s.currentDay > SEASON_DAYS) return { ok: false, reason: 'postseason' }; // 플옵 엔트리 동결(SEASON §5.0) — UI 우회(딥링크) 방어
        if (s.currentDay < (s.benchCooldown[playerId] ?? 0)) return { ok: false }; // 건의 쿨다운(방어)
        // 활성(미철회) 지시만 슬롯·후보 제외 판정(A3) — 철회된 지시는 슬롯을 비운다.
        const activeDirectives = s.benchDirectives.filter((b) => b.toDay == null);
        if (activeDirectives.length >= BENCH_MAX) return { ok: false };
        const benched = new Set(activeDirectives.map((b) => b.playerId));
        const squad = rosterIdsOnDay(my, s.currentDay)
          .map((id) => evolveOnDay(id, s.currentDay))
          .filter((q): q is Player => !!q && !benched.has(q.id));
        const target = squad.find((q) => q.id === playerId);
        if (!target) return { ok: false };
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
          return { ok: false };
        }
        // Form 비대칭(OWNER §2.2 ★): 선발 건의는 건의선수의 폼을 보지 않는다(순수 OVR = 원래 능력) — 뛰게 해서 폼 회복시키려는 것,
        //   자기 러스트로 자기 승격을 막는 자충수 방지. incumbent(현 주전)는 폼≈1.0이라 어차피 순수 OVR.
        const gapT = Math.max(0, Math.min(1, 1 - (overall(incumbent) - overall(target)) / 10));
        const charisma = coachInfoOf(my)?.charisma ?? 50;
        const ok = startSuggestAccept(playerId, s.season, s.currentDay, charisma, gapT);
        const why = ok ? undefined : startRejectReason(charisma, gapT);
        const benchCd = { ...s.benchCooldown, [playerId]: s.currentDay + BENCH_COOLDOWN_DAYS }; // 건의했으면(수락·거절 무관) 잠금
        if (ok) {
          // 관전 중(이어보기 대기) 경기엔 미적용 → 다음 경기부터(OWNER_SYSTEM 2.3, 옵션 A). 소급 방어(A2) — suggestBench와 동일.
          const fromDay = Math.max(s.currentDay + (Object.keys(s.watchProgress).length > 0 ? 1 : 0), playedThroughDay(s.results) + 1);
          const benchDirectives = [...s.benchDirectives, { playerId: incumbent.id, fromDay }];
          set({ benchDirectives, benchCooldown: benchCd });
          setOwnerContext(benchDirectives, fromDay); // §7 스플라이스
        } else {
          set({ benchCooldown: benchCd });
        }
        diag(s.season, 'bench', `선발 건의 ${playerId} → ${ok ? '수락' : '거절'}`); // 진단 로그(§13.20 ④)
        return { ok, reason: why };
      },
      unbench: (playerId) => {
        // 소급 삭제 금지(A3, 2026-07-08): 삭제하면 이미 관전·기록한 경기 구간에서 그 지시가 사라져 **리플레이가
        //   본 역사를 다시 씀**(서사 위반). 대신 **종결일(toDay)** 을 박는다 — toDay = playedThroughDay(마지막 치른 경기일).
        //   [fromDay, playedThroughDay]는 벤치 유지(치른 경기 보존), 그 이후 미관전 미래 경기는 복귀. playedThroughDay<fromDay면
        //   (아직 한 경기도 안 치름) toDay<fromDay라 구간이 비어 완전 무효(즉시 취소와 동치).
        const s = get();
        const end = playedThroughDay(s.results);
        const benchDirectives = s.benchDirectives.map((b) =>
          b.playerId === playerId && b.toDay == null ? { ...b, toDay: end } : b);
        set({ benchDirectives });
        setOwnerContext(benchDirectives, end + 1); // §7: 언벤치는 toDay+1부터 복귀 — 그 이전(≤toDay, 벤치 유지)은 재사용
      },
      setKeepForeign: (keep) => set({ keepForeign: keep }),
      toggleTryoutWish: (playerId) =>
        set((s) => ({ tryoutWish: s.tryoutWish.includes(playerId) ? s.tryoutWish.filter((id) => id !== playerId) : [...s.tryoutWish, playerId] })),
      // 시즌 중 외인 교체(시즌당 1회) — 퇴출 외인은 리그를 떠나고, 대체 외인 연봉은 지갑에서(이중 부담)
      replaceForeign: (altId) => {
        const s = get();
        const my = s.selectedTeamId;
        if (!my || s.foreignSubUsed) return false;
        if (s.currentDay > SEASON_DAYS) return false; // 플옵 엔트리 동결(SEASON §5.0) — 교체권·지갑 소모 차단(플옵 엔트리는 164 동결이라 새 외인 0경기)
        if (!s.foreignAltPool.includes(altId)) return false;
        const curForeign = rosterIdsOnDay(my, s.currentDay).map((id) => evolveOnDay(id, s.currentDay)).find((p) => p?.isForeign && !p?.isAsianQuota);
        if (!curForeign) return false;
        if (FOREIGN_SALARY > s.cash) return false; // 운영 자금 부족
        const inSeasonTx: Tx[] = [...s.inSeasonTx,
          { day: s.currentDay, teamId: my, playerId: curForeign.id, kind: 'release' },
          { day: s.currentDay, teamId: my, playerId: altId, kind: 'sign' }];
        set({ inSeasonTx, foreignSubUsed: true, cash: s.cash - FOREIGN_SALARY, foreignAltPool: s.foreignAltPool.filter((id) => id !== altId) });
        diag(s.season, 'transaction', `외국인 교체 ${curForeign.id} → ${altId}`); // 진단 로그(§13.20 ④)
        setTxContext(inSeasonTx, get().faPool, my, s.currentDay); // §7 스플라이스
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
        if (s.currentDay > SEASON_DAYS) return false; // 플옵 엔트리 동결(SEASON §5.0) — 교체권·지갑 소모 차단(플옵 엔트리는 164 동결이라 새 선수 0경기)
        if (!s.asianAltPool.includes(altId)) return false;
        const curAsian = rosterIdsOnDay(my, s.currentDay).map((id) => evolveOnDay(id, s.currentDay)).find((p) => p?.isAsianQuota);
        if (!curAsian) return false;
        if (ASIAN_SALARY > s.cash) return false; // 운영 자금 부족
        const inSeasonTx: Tx[] = [...s.inSeasonTx,
          { day: s.currentDay, teamId: my, playerId: curAsian.id, kind: 'release' },
          { day: s.currentDay, teamId: my, playerId: altId, kind: 'sign' }];
        set({ inSeasonTx, asianSubUsed: true, cash: s.cash - ASIAN_SALARY, asianAltPool: s.asianAltPool.filter((id) => id !== altId) });
        setTxContext(inSeasonTx, get().faPool, my, s.currentDay); // §7 스플라이스
        return true;
      },

      endSeason: () => {
        const { season, contractOverrides, selectedTeamId, resignDecisions, faOffers, protectedIds, moneyOnlyIds, draftPicks, draftSelections, hallOfFame, expelledLog, transfers, retirements, seasonDraftLog, seasonForeignLog, archive, careerLog, careerTotals, bonds, milestones, interviews, benchDirectives, fanScore, cash, tryoutWish, keepForeign, asianWish, keepAsian } = get();
        const nextSeason = season + 1;
        const my = selectedTeamId ?? '';
        diag(season, 'season', `시즌 종료 ${season + 1}→${nextSeason + 1} (오프시즌 진입)`); // 진단 로그(#44)

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
        // 오프시즌 결산 뉴스(§3.7) — 외인/아시아쿼터 교체 OUT 이름은 트라이아웃 해소(runTryout cleanup) 전에 캡처.
        //   여기서 getPlayer는 아직 오프시즌 전 base(외인 잔존)를 읽는다(commitPlayerBase는 롤오버 말미). finalR = 이번 시즌 최종 명단.
        type SwapSide = { id: string; name: string };
        const prevForeign: Record<string, SwapSide> = {}; // teamId → 직전 외국인
        const prevAsian: Record<string, SwapSide> = {};    // teamId → 직전 아시아쿼터
        for (const tid of Object.keys(finalR)) {
          for (const id of finalR[tid]) {
            const p = getPlayer(id); if (!p) continue;
            if (p.isForeign && !p.isAsianQuota) prevForeign[tid] = { id, name: p.name };
            else if (p.isAsianQuota) prevAsian[tid] = { id, name: p.name };
          }
        }
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
        setSeasonHistory(nextArchive); // 모기업 기조(FINANCE 2.0 Stage3) — 이번 오프시즌 AI FA 입찰부터 반영(championId/standings)

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
        const ownerFx: OwnerFx = buildOwnerFx(interviews, season, my, fanScore, contractOverrides);
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
          // 벤치 연속 결장 분노는 지시가 유효했던 구간만(A3) — 철회(toDay)됐으면 그날까지, 아니면 시즌말까지.
          const benchEnd = b.toDay ?? SEASON_END_DAY;
          const missed = Math.round((benchEnd - b.fromDay) / GAME_EVERY);
          if (pop >= 60 && missed > 0) angerSum += benchAngerPenalty(missed);
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
        // 모기업 aggressive 1회성 현금 보너스(FINANCE 2.0 Stage4) — 다가오는 오프시즌 FA 지갑에 가산.
        //   upcomingStanceOf = projectSettledCash(FA 프리뷰)와 동일 도출 → 미리보기=결과. thrifty/normal=0(권한표).
        const walletCash = settled.cash + stanceCashBonus(upcomingStanceOf(my, season));

        // 1) 롤오버·은퇴·경쟁FA(영입/보상)·순번·클래스 (드래프트 센터와 동일 소스)
        //    FA 입찰은 캡 AND 새 잔고(지갑) — 캡이 남아도 돈이 없으면 못 뽑는다
        // FA 오퍼 다레버(§2.8 Phase1) — faSignings=지명 keys·aggressive=false(전역은 per-오퍼 aggressive로 이관), faOffers=레버 전달.
        const ctx = buildDraftContext(my, resignDecisions, contractOverrides, Object.keys(faOffers), false, protectedIds, nextSeason, ownerFx, walletCash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian, faOffers);
        const snapshot = ctx.snapshot;

        // 2) 드래프트 해석(라이브 확정 픽 mySelections 우선 → 찜 위시폴백 → AI 자동, 순번 존중. FA_SYSTEM §3.2.1)
        const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
        const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], my, draftPicks, styleOf, teamScoutReveal, draftSelections, aiTargetOf());
        for (const p of drafted.picked) snapshot[p.id] = p;
        const myDrafted = drafted.picked.filter((p) => (drafted.rosters[my] ?? []).includes(p.id)); // 내 지명만(§13.20 ④)
        if (myDrafted.length) diag(season, 'draft', `드래프트 지명 ${myDrafted.map((p) => p.name).join(', ')}`); // 진단 로그

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
              hof: isHof, legend: c.points >= LEGEND_POINTS, age: base.age, // 정년(40) 기사 구분
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

        // FA 영입 지출 차감 — A/B 보상금만(운영 자금). 몸값(첫해 salary)은 여기서 빼지 않는다.
        //   [이중과금 수정, EC-FN-03] 영입 FA의 첫해 몸값은 다음 시즌 myPayroll(finalR 전원 salary)이
        //   단일 채널로 전액 부과한다. faSpend에도 더하면 첫해가 payroll+faSpend 이중 차감(N년 계약=salary×(N+1)).
        //   → 국내·외인 공통으로 salary 가산을 제거. faSpend = compCash(보상금)만. offseasonSigns는 카운트만.
        let faSpend = ctx.compCash; // FA 보상금(A 200%·B 100% × 직전연봉, FA_SYSTEM 2.2) — 유일한 오프시즌 몸값-외 비용
        let offseasonSigns = 0;
        for (const id of filled.rosters[my] ?? []) {
          const prev = ctx.prevTeamOf[id];
          if (prev && prev !== my) offseasonSigns += 1; // 영입 수(업적 careerLog) — 카운트만, salary 가산과 분리
        }

        // FA 이적·방출 연표(뉴스 슬라이스3·4) — 오프시즌 선수 이동. 최근 200건.
        //  노이즈 정책(NEWS_SYSTEM §3.3): 내 팀 in/out은 항상, 타팀은 거물(overall≥REL_NEWS_OVR)만 적립 → 로그를 린하게.
        const REL_NEWS_OVR = 71; // 타팀 이동 기사화 게이트(리그 국내평균 ~68 위 = 주전급. _ev_transfernews 보정 — 타팀 수건/시즌, 잡선수 노이즈 차단)
        const notable = (id: string) => { const p = snapshot[id]; return !!p && overall(p) >= REL_NEWS_OVR; };
        // 카운터 수락 관측(FA_SYSTEM §2.8.6) — 내가 counterTolerance로 요구를 수용해 서명한 계약이면 to연봉을 로그에 실어 뉴스 ①로.
        const counterFired = ctx.counterFired ?? {};
        const satOutSet = new Set(ctx.faSatOut ?? []); // SIT_OUT+bids>0(뉴스 ②) — 아무도 안 부른 미계약과 구분
        const seasonTransfers: Transfer[] = [];
        for (const tid of Object.keys(filled.rosters)) {
          for (const id of filled.rosters[tid]) {
            const prev = ctx.prevTeamOf[id];
            const p = snapshot[id];
            // 팀→팀 이동(국내). 내 팀 in/out은 항상, 타팀은 거물만.
            if (prev && prev !== tid && p && !p.isForeign && (prev === my || tid === my || notable(id))) {
              const cf = tid === my ? counterFired[id] : undefined; // 카운터는 내 팀 서명만 발동(§2.8.6)
              seasonTransfers.push({ season, playerId: id, name: p.name, fromTeam: prev, toTeam: tid, kind: 'transfer', ovr: overall(p), ...(cf ? { counteredTo: cf.to } : {}) });
            }
          }
        }
        // 방출/재계약 불발 — 직전 소속(prevTeamOf)이 있는데 새 시즌 어느 명단에도 없는 국내 선수(=FA 풀행, 미계약).
        //  nextFaPool = 이미 (비로스터·비은퇴·비제명·국내)라, 거기에 "직전 소속 보유"만 더하면 신규 방출자.
        const seasonReleases: Transfer[] = [];
        for (const id of nextFaPool) {
          const prev = ctx.prevTeamOf[id];
          const p = snapshot[id];
          if (!prev || !p) continue; // 직전 소속 없으면 풀 잔류자(신규 방출 아님)
          // 재계약 불발 사유(FA §2.5c-격상) — 내 팀 만료FA만 buildOffseason 버킷팅 진실(ctx.myReleaseReasons)에서. 은퇴자는 nextFaPool에 없어 자동 제외.
          const reason = prev === my ? ctx.myReleaseReasons[id] : undefined;
          if (prev === my || notable(id)) seasonReleases.push({ season, playerId: id, name: p.name, fromTeam: prev, toTeam: '', kind: 'release', ovr: overall(p), ...(satOutSet.has(id) ? { satOut: true } : {}), ...(reason ? { reason } : {}) });
        }
        // 재계약 도장(FA §2.5c-격상) — 내 팀 만료FA 중 keep 버킷(refuse 롤 통과). 결산 뉴스 전용, fromTeam=toTeam=my.
        const rosteredMine = new Set(filled.rosters[my] ?? []);
        const seasonResigns: Transfer[] = [];
        for (const id of ctx.myResigned) {
          const p = snapshot[id];
          if (!p || !rosteredMine.has(id)) continue; // 최종 로스터에 실제 남은 도장만(방어적 — keep 버킷은 항상 남음)
          seasonResigns.push({ season, playerId: id, name: p.name, fromTeam: my, toTeam: my, kind: 'resign', ovr: overall(p) });
        }
        const nextTransfers = [...transfers, ...seasonTransfers, ...seasonReleases, ...seasonResigns].slice(-200);

        // 오프시즌 결산 뉴스(§3.7) — ① 드래프트 입단 로그: 내 팀 전 픽 ∪ 타팀 1라운드.
        //   round/overallPick은 drafted.sequence를 회차 재구성(한 라운드에 팀이 두 번 나오면 새 라운드 — buildDraftOrder 구조).
        const seasonDraft: DraftPickRecord[] = [];
        {
          let round = 1, overallPick = 0;
          const seenThisRound = new Set<string>();
          for (const pk of drafted.sequence) {
            if (seenThisRound.has(pk.teamId)) { round++; seenThisRound.clear(); }
            seenThisRound.add(pk.teamId);
            overallPick++;
            if (pk.teamId === my || round === 1) {
              const p = snapshot[pk.playerId];
              if (p) seasonDraft.push({ season, teamId: pk.teamId, playerId: pk.playerId, name: p.name, position: p.position, round, overallPick });
            }
          }
        }
        const nextDraftLog = [...seasonDraftLog, ...seasonDraft].slice(-150);

        // ② 외인·아시아쿼터 교체 로그: 전 팀, id가 바뀐 팀만(재계약=동일 id는 미기록). in/out 중 하나는 반드시 존재.
        const nextSideOf = (tid: string, asian: boolean): SwapSide | undefined => {
          for (const id of filled.rosters[tid] ?? []) {
            const p = snapshot[id]; if (!p || !p.isForeign) continue;
            if (asian ? p.isAsianQuota : !p.isAsianQuota) return { id, name: p.name };
          }
          return undefined;
        };
        const seasonForeign: ForeignSwapRecord[] = [];
        for (const tid of Object.keys(filled.rosters)) {
          for (const asian of [false, true]) {
            const prev = asian ? prevAsian[tid] : prevForeign[tid];
            const next = nextSideOf(tid, asian);
            if ((prev?.id ?? '') === (next?.id ?? '')) continue; // 유임 또는 계속 공석 — 뉴스거리 아님
            seasonForeign.push({ season, teamId: tid, asian, outId: prev?.id, outName: prev?.name, inId: next?.id, inName: next?.name });
          }
        }
        const nextForeignLog = [...seasonForeignLog, ...seasonForeign].slice(-150);

        const nextBonds = accrueBonds(bonds, filled.rosters); // 인간관계 우정 누적(같은 팀 +·옛정 감쇠)
        setRelationContext(nextBonds);    // 새 시즌 관계 컨텍스트(FA preview=result)
        commitPlayerBase(snapshot);
        commitRosters(filled.rosters);
        setTxContext([], nextFaPool, my); // 새 시즌: 거래 초기화 + FA 풀 주입
        setOwnerContext([]);              // 벤치 지시는 시즌 단위 — 새 시즌 전원 복귀
        setInterventionContext({});       // 개입 로그도 시즌 단위(fixtureId는 시즌마다 재생성) — 새 시즌 초기화(MATCH_INTERVENTION §2)
        // 훈련 방침 타임라인 접기(A4) — 새 시즌 currentDay=0 리셋에 맞춰 **현재 방침을 day0 baseline**으로 붕괴.
        //   (롤오버는 위 buildDraftContext에서 이번 시즌 타임라인으로 이미 진화 완료. 다음 시즌은 현재 방침이 처음부터.)
        const nextFocusLog: FocusSeg[] = get().trainingFocus ? [{ fromDay: 0, focus: get().trainingFocus }] : [];
        setFocusTimeline(my, nextFocusLog);
        setSalaryEra(medianOvr(currentBasePlayers().filter((p) => !p.isForeign))); // 시대 앵커 갱신(SALARY 2장) — 새 base 기준
        set({
          coachPool: nextCoachPool,          // 감독 생애주기 풀 영속(STAFF_SYSTEM 6)
          staffHead: nextStaffHead,          // AI 재배정 + 죽은 계약 정리 반영
          staffAssistants: nextStaffAssistants, // 은퇴한 코치 슬롯 정리
          careerLog: { ...careerLog, faSigns: careerLog.faSigns + offseasonSigns }, // 오프시즌 영입 누적(업적)
          careerTotals: nextTotals, // 통산 경기 기록 누적(업적)
          bonds: nextBonds, // 인간관계 우정 누적(같은 팀 +·옛정 감쇠, RELATIONSHIP §1.1)
          interviews: interviews.filter((l) => l.season >= season - 1).slice(-200), // 직전 시즌까지만(실패 이력 참조용)
          benchDirectives: [],
          interventions: {}, // 개입 로그 — 새 시즌 초기화(fixtureId 재생성, MATCH_INTERVENTION §2)
          focusLog: nextFocusLog, // 훈련 방침 타임라인 — 새 시즌 day0 baseline으로 접음(A4)
          talkCooldown: {},   // 시즌말 currentDay 0 리셋과 함께 쿨다운 초기화
          benchCooldown: {},
          // 영구제명(승부조작·학폭) — 내 팀이면 팬심 대폭락(사건당 −35). 리그 최대 충격.
          fanScore: Math.max(0, nextFan - 35 * ctx.expelled.filter((e) => e.teamId === my).length),
          cash: Math.max(0, walletCash - faSpend),
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
          lastGrowthDay: -1, // 새 시즌 — 성장 리포트 재초기화(시즌 경계 diff는 로스터·나이 변동 얽혀 제외, TRAINING §성장리포트)
          campTrainedThisOffseason: [], // 새 오프시즌 — 전지훈련 1회 제한 초기화(MONETIZATION §11.2)
          results: {},
          watchProgress: {}, // 새 시즌 — 이어보기 위치 초기화
          contractOverrides: {},
          released: [],
          releaseAnger: 0, // 시즌 분노는 이번 endSeason에서 fanScore로 반영됐으니 리셋
          inSeasonTx: [],
          faPool: nextFaPool,
          resignDecisions: {},
          faOffers: {},
          protectedIds: [],
          moneyOnlyIds: [],
          draftPicks: [],
          draftSelections: [], // 라이브 드래프트 확정 픽 — 새 오프시즌 초기화(FA_SYSTEM §3.2.1)
          playerBase: snapshot,
          rosters: filled.rosters,
          hallOfFame: [...hallOfFame, ...hofAdds],
          expelledLog: [...expelledLog, ...ctx.expelled.map((e) => ({ season, playerId: e.playerId, name: snapshot[e.playerId]?.name ?? e.playerId, teamId: e.teamId, kind: e.kind }))],
          transfers: nextTransfers,
          retirements: nextRetirements,
          seasonDraftLog: nextDraftLog,
          seasonForeignLog: nextForeignLog,
          archive: nextArchive,
          milestones: nextMilestones,
        });
      },

      resetSave: () => {
        const prev = get();
        diag(0, 'save', '새 게임 시작 (resetSave)'); // 진단 로그(#44)
        resetLeagueBase();
        setTxContext([], [], '');
        setOwnerContext([]);
        setInterventionContext({}); // 새 게임 — 개입 로그 없음(MATCH_INTERVENTION §2)
        setAwardScores([]);
        setSeasonHistory([]); // 모기업 기조(FINANCE 2.0) 컨텍스트 리셋
        setSalaryEra(MED_REF); // 시대 앵커 리셋(시대 0)
        // 전체 데이터 초기화 = 새 출발 → 스포트라이트 본 기록도 리셋(튜토리얼 다시 봄). 인트로 슬라이드(onboarded)는
        // 유지(다시보기는 replayOnboarding). seenTips는 freshSave 밖이라 명시적으로 비운다(ONBOARDING 4).
        // **계정 재화·업적수령·광고상태는 유지**(§13.19 — 서버 진실·계정 평생). saveId만 새로(camp 재과금 정당).
        set({ ...freshSave, seenTips: {}, saveId: newSaveId(), diamonds: prev.diamonds, claimedAch: prev.claimedAch, adState: prev.adState });
      },
      completeOnboarding: () => set({ onboarded: true }),
      replayOnboarding: () => set({ onboarded: false }),
      markTip: (id) => set((s) => (s.seenTips[id] ? {} : { seenTips: { ...s.seenTips, [id]: true } })),
      resetTips: () => set({ seenTips: {} }),
      grantSupporter: () => set({ supporter: true }), // 결제 성공 시 호출(출시 시 IAP 콜백에 연결)
      setSupporter: (v) => set({ supporter: v }),     // 미리보기 토글(개발용) — 적용된 모습 확인
      setSfx: (v) => set({ sfxEnabled: v }),          // 효과음 켬/끔(설정) — 영속
      setBgmVolume: (v) => set({ bgmVolume: Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.8)) }), // BGM 볼륨 0..1 클램프 — 영속
    }),
    {
      name: SAVE_KEY,
      storage: debouncedAsyncStorage(), // 매 set마다 직렬화+쓰기 폭주 → 디바운스로 합침(A6 성능, 저장 내용 불변)
      version: SAVE_VERSION,
      // 구버전/손상 세이브 → 정규화(컨테이너 모양 강제) + 향후 breaking 변경 단계 변환. SAVE_SYSTEM.md.
      migrate: (persisted, version) => migrateSave(persisted, version) as never,
      // 상시 정규화(SAVE_SYSTEM §3.2) — persist는 저장 version==현행일 때 migrate를 건너뛰므로, 현행 버전 세이브가
      //   손상되면 sanitizeSave를 안 탄다(비정규화 값이 state로 유입·throw 시 전손). merge는 버전 무관 매 rehydrate 실행되니
      //   여기서 sanitizeSave를 항상 경유시킨다. migrate 경로와 중복 적용돼도 sanitizeSave는 멱등(구세이브는 migrate가
      //   먼저 정규화 후 merge가 재정규화 — 동일 결과). persisted 없으면(신규 설치) 현재 상태 그대로(기본값 덮어쓰기 금지).
      merge: (persisted, current) =>
        persisted == null ? (current as never) : ({ ...(current as object), ...sanitizeSave(persisted) } as never),
      partialize: (s) => ({
        onboarded: s.onboarded,
        supporter: s.supporter,
        sfxEnabled: s.sfxEnabled,
        bgmVolume: s.bgmVolume,
        seenTips: s.seenTips, // 본 스포트라이트 스텝(영구 추적 — 리로드/새 게임에도 유지, ONBOARDING 1·4)
        selectedTeamId: s.selectedTeamId,
        season: s.season,
        currentDay: s.currentDay,
        lastGrowthDay: s.lastGrowthDay,
        results: s.results,
        watchProgress: s.watchProgress,
        contractOverrides: s.contractOverrides,
        released: s.released,
        inSeasonTx: s.inSeasonTx,
        faPool: s.faPool,
        playerBase: s.playerBase,
        rosters: s.rosters,
        resignDecisions: s.resignDecisions,
        faOffers: s.faOffers,
        protectedIds: s.protectedIds,
        moneyOnlyIds: s.moneyOnlyIds,
        draftPicks: s.draftPicks,
        draftSelections: s.draftSelections,
        archive: s.archive,
        careerLog: s.careerLog,
        careerTotals: s.careerTotals,
        diamonds: s.diamonds,
        saveId: s.saveId,
        campLog: s.campLog,
        campTrainedThisOffseason: s.campTrainedThisOffseason,
        campDoneSeason: s.campDoneSeason,
        pendingCamp: s.pendingCamp,
        claimedAch: s.claimedAch,
        adState: s.adState,
        bonds: s.bonds,
        simCache: captureSimCache(), // 계산된 시즌 결과(REALTIME_SIM Phase1) — 워밍됐을 때만, 재로드 재계산 제거
        coachPool: s.coachPool,
        hallOfFame: s.hallOfFame,
        expelledLog: s.expelledLog,
        transfers: s.transfers,
        retirements: s.retirements,
        seasonDraftLog: s.seasonDraftLog,
        seasonForeignLog: s.seasonForeignLog,
        milestones: s.milestones,
        readNews: s.readNews,
        trainingFocus: s.trainingFocus,
        focusLog: s.focusLog, // 훈련 방침 타임라인(A4)
        staffHead: s.staffHead,
        staffHeadTimeline: getCoachTimeline(), // 감독 부임 타임라인(축3) — 재로드 후에도 시즌 중 영입 forward-only 유지(라이브 리그 상태 읽기)
        staffAssistants: s.staffAssistants,
        staffScouts: s.staffScouts,
        interviews: s.interviews,
        benchDirectives: s.benchDirectives,
        interventions: s.interventions, // 경기 개입 로그(MATCH_INTERVENTION §2)
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
          // 시즌0(base null): 영속 base가 없으니 전지훈련 부스트를 시드 레지스트리에 재적용(campLog=기록입력, §11.2).
          // 시즌≥1(base 존재): 이미 굽힌 base를 로드 → 재적용 안 함(이중적용 방지).
          else if (state?.campLog?.length) {
            for (const e of state.campLog) {
              const p = getPlayer(e.playerId);
              if (!p) continue;
              // 유니온 재적용(H3 소급 보존): stats[]=구 산식(+1/+1) · 코스 엔트리=임베드 {cur,pot}(신규 +3/+3)
              // 또는 cur/pot 없는 구 코스 엔트리는 레거시(+2/+7)로 폴백 → 각 캠프가 구매 시점 산식대로 재현(결정론)
              if (e.course && CAMP_COURSES[e.course]) commitPlayerBase({ [e.playerId]: applyCampCourse(p, e.course, e.cur ?? CAMP_LEGACY_CUR_GAIN, e.pot ?? CAMP_LEGACY_POT_GAIN) });
              else if (e.stats?.length) commitPlayerBase({ [e.playerId]: applyCamp(p, e.stats) });
            }
          }
          if (state?.rosters) commitRosters(state.rosters);
          if (state?.coachPool) commitCoachPool(state.coachPool.coaches, state.coachPool.assistants); // 감독 풀 복원(commitStaff 전 — staffHead가 참조)
          // 훈련 방침 타임라인 복원(A4) — 마이그레이션이 구세이브의 단일 trainingFocus를 focusLog로 시드해 둠([{fromDay:0}]).
          if (state?.selectedTeamId) setFocusTimeline(state.selectedTeamId, state.focusLog ?? []);
          if (state?.staffHead || state?.staffAssistants || state?.staffScouts) commitStaff(state.staffHead ?? {}, state.staffAssistants ?? {}, state.staffScouts ?? {}, (state as { staffHeadTimeline?: Record<string, { fromDay: number; coachId: string | null }[]> })?.staffHeadTimeline); // 축3: 타임라인 복원(구세이브=undefined→소급=byte 불변)
          setTxContext(state?.inSeasonTx ?? [], state?.faPool ?? [], state?.selectedTeamId ?? '');
          setRelationContext(state?.bonds ?? {}); // 인간관계 우정 컨텍스트(FA 해석)
          setMyTeamStaff(state?.selectedTeamId ?? ''); // 내 팀 등록(AI 기본 스태프 분리)
          setOwnerContext(state?.benchDirectives ?? []);
          setInterventionContext(state?.interventions ?? {}); // 개입 로그 컨텍스트 복원(MATCH_INTERVENTION §2) — sim 호출부가 조회
          setAwardScores(state?.archive ?? []); // 수상 프리미엄 컨텍스트 복원
          setSeasonHistory(state?.archive ?? []); // 모기업 기조(FINANCE 2.0) 컨텍스트 복원 — FA 화면 진입 전 stance 일관
          setSalaryEra(medianOvr(currentBasePlayers().filter((p) => !p.isForeign))); // 시대 앵커 복원(SALARY 2장) — base 커밋 후
          // 시뮬 결과 캐시 복원 — **반드시 맨 끝**(위 commit들이 baseVersion/txVersion을 bump한 뒤). 저장 키와 맞춰 재계산 제거(Phase1).
          restoreSimCache((state as { simCache?: import('../data/simCache').SimCache })?.simCache);
          // 다이아 소급 폭탄 방지(§11.3): 기능 이전 세이브면 현 달성 업적을 claimed로 시드(1회) → 이후 신규 달성만 다이아.
          if (consumePendingClaimSeed() && state?.selectedTeamId) {
            const st = evalAchievements({ myTeamId: state.selectedTeamId, archive: state.archive ?? [], hof: state.hallOfFame ?? [], milestones: state.milestones ?? [], cash: state.cash ?? 0, fanScore: state.fanScore ?? 50, careerLog: state.careerLog, careerTotals: state.careerTotals });
            useGameStore.setState({ claimedAch: st.filter((x) => x.unlocked).map((x) => x.ach.id) });
          }
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

/** 진단 스냅샷용 재현 키(§13.20 ①) — persist가 저장하는 것과 **정확히 동일한** {state, version} 블롭.
 *  partialize를 그대로 재사용해 미래 필드가 추가돼도 자동 포함(손 선별 금지 — 로더 계약 "영속 객체 통째를 다시 먹여라").
 *  운영툴은 이걸 migrateSave+onRehydrateStorage로 먹여 그 게임을 bit-identical 재현한다(서버는 해석 안 하는 불투명 증거물). */
export function captureReplaySave(): { state: Record<string, unknown>; version: number } | null {
  const opts = useGameStore.persist.getOptions();
  if (!opts.partialize) return null;
  return { state: opts.partialize(useGameStore.getState()) as Record<string, unknown>, version: opts.version ?? 0 };
}
