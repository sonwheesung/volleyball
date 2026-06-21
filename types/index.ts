// 공용 타입 — CLAUDE.md 9장 데이터 모델 기준.
// 엔진/스토어/DB/UI가 공유하는 단일 출처.

export type Position = 'S' | 'OH' | 'OP' | 'MB' | 'L';

/** 선수 특성 (TRAIT_SYSTEM) — 숫자 뒤의 성격. id 시드 결정론 부여. 정의·효과는 engine/traits.ts */
export type Trait =
  | 'clutch' | 'choke' | 'bigGame'
  | 'lateBloomer' | 'earlyDecline'
  | 'glass' | 'iron'
  | 'serveMachine' | 'leader' | 'diligent';

export type CoachStyle = 'attack' | 'defense' | 'balanced';

/** 통산 누적 기록 (백년야구식 장기 서사의 토대) */
export interface CareerStats {
  seasons: number;
  matches: number;
  sets: number;
  points: number;      // 통산 득점
  spikes: number;      // 공격 성공
  blocks: number;      // 블로킹 성공
  digs: number;        // 디그 성공
  aces: number;        // 서브 에이스
  errors: number;      // 범실
  assists: number;     // 세트 성공(세터) — 2026-06-11 추가, 구세이브는 0에서 시작
}

/** 한 시즌 개인 기록 라인 — 선수 상세 "시즌별 기록". 시즌 경계에서 적립, 은퇴 시 베이스와 함께 정리 */
export interface SeasonLine {
  season: number;   // 0-based
  teamId: string;   // 그 시즌 소속
  matches: number;
  points: number;
  spikes: number;
  blocks: number;
  aces: number;
  assists: number;
  digs: number;
}

export interface Player {
  id: string;
  name: string;
  age: number;
  position: Position;
  isForeign: boolean;
  isAsianQuota?: boolean; // 아시아쿼터 수입 선수(FOREIGN_SYSTEM 7). isForeign과 함께 true → 캡/FA 제외 자동, 라이프사이클만 분리
  nationality?: string;   // 국적(아시아쿼터 표시용 — AVC 가맹국). 결정론(id 시드)

  // 밑단 — 신체 (5.1)
  height: number;       // 고정 (나이 무관)
  jump: number;         // 노쇠 시 하락
  agility: number;      // 노쇠 시 하락
  staminaMax: number;   // 체력(보유 상한) — 노쇠 시 하락
  staminaRegen: number; // 체젠(회복 속도) — 노쇠 시 하락

  // 밑단 — 공통
  reaction: number;    // 완만한 곡선
  positioning: number; // 경험으로 성장

  // 밑단 — 멘탈
  focus: number;       // 집중력(clutch)
  consistency: number; // 기복
  vq: number;          // 배구 IQ (MATCH_SYSTEM 0장)

  // 기술치 (훈련·경기로 성장하는 순수 기술)
  skSpike: number;
  skBlock: number;
  skDig: number;
  skReceive: number;
  skSet: number;
  skServe: number;

  // 성장 (TRAINING_SYSTEM)
  xp: Partial<Record<TrainableStat, number>>;        // 스탯별 숨은 XP 바 (0~1)
  potential: Record<TrainableStat, number>;          // 스탯별 숨은 상한
  talentBase: number;                                // 종합 성장 재능 0.7~1.3 (숨김)
  catTalent: { physical: number; skill: number; mental: number };  // 분야별 0.85~1.15

  // 계약 (SALARY_SYSTEM) — 연봉은 서명 시점 가치로 고착
  contract: Contract;
  clubTenure: number;   // 현 구단 연속 근속 시즌(프랜차이즈 판정) — 이적 시 0

  // 특성 (TRAIT_SYSTEM) — 생성 시 id 시드로 부여. 없으면 무효과(구세이브 호환)
  traits?: Trait[];

  // 메타
  peakAge: number;     // 전성기 나이(노쇠 곡선용)
  career: CareerStats;
  seasonLines?: SeasonLine[]; // 시즌별 기록(선수 상세) — 없으면 빈 이력(구세이브 호환)

  // FA 성향 (FA_SYSTEM 2.5) — 선수마다 이적 동기가 다르다. id 시드로 결정론 생성.
  faPref?: FAPref;
}

/** FA 의사결정 아키타입 — 무엇을 가장 중시하는가 */
export type FAArchetype = 'money' | 'winnow' | 'loyal' | 'minutes' | 'hometown';

/** 동기별 가중치 (합 ≈ 1). offerScore 의 각 항에 곱해진다. */
export interface FAWeights {
  money: number;    // 연봉
  win: number;      // 우승권(최근 성적+전력)
  loyalty: number;  // 잔류(원소속·프랜차이즈)
  play: number;     // 출전 기회
  home: number;     // 연고/선호팀
}

export interface FAPref {
  archetype: FAArchetype;
  w: FAWeights;
  preferredTeamId?: string; // 연고/선호팀(있으면 그 팀에 home 가중)
}

/** 명예의전당 등재 — 은퇴 레전드의 통산 기록 영구 보존 (백년 서사) */
export interface HofEntry {
  id: string;
  name: string;
  position: Position;
  teamId: string;        // 마지막 소속(영구결번 구단)
  seasons: number;
  points: number;
  blocks: number;
  digs: number;
  // 2026-06-18 추가 — 통산 리더보드 여러 카테고리용(구세이브는 없을 수 있어 optional, 셀렉터에서 ?? 0)
  spikes?: number;
  aces?: number;
  assists?: number;
  retiredSeason: number; // 0-based
  legend: boolean;       // 영구결번급(예외적 커리어)
}

// ─── 시상식 (AWARDS_SYSTEM) ──────────────────────────────────
/** 개인 수상자 — playerId + 당시 소속 + 선정 수치 */
export interface AwardWinner {
  playerId: string;
  teamId: string;
  value: number;        // 선정 근거 수치(득점/어시/델타 등) — 표시용
}

/** 베스트7 한 자리 — 포지션 슬롯 + 수상자 */
export interface Best7Slot {
  pos: Position;
  winner: AwardWinner | null;
}

/** 한 시즌 시상 결과 — endSeason 에서 계산해 archive 에 영구 보존 */
export interface SeasonAwards {
  mvp: AwardWinner | null;          // 정규리그 MVP(팀 성적 가중)
  finalsMvp: AwardWinner | null;    // 챔피언결정전 MVP(우승팀)
  rookie: AwardWinner | null;       // 신인상
  mostImproved: AwardWinner | null; // 기량발전상
  titles: {                         // 부문 기록왕(순수 1위)
    scoring: AwardWinner | null;    // 득점왕
    spike: AwardWinner | null;      // 공격상
    block: AwardWinner | null;      // 블로킹왕
    serve: AwardWinner | null;      // 서브왕
    dig: AwardWinner | null;        // 디그왕
    set: AwardWinner | null;        // 세트왕
    receive: AwardWinner | null;    // 리시브왕
  };
  best7: Best7Slot[];               // S·OH·OH·OP·MB·MB·L 순
  roundMvps: (AwardWinner | null)[]; // 라운드(leg)별 MVP
}

/** 한 시즌 아카이브 한 건 — endSeason 에서 적립, 영구 보존(우승·시상·순위·연승연패) */
export interface SeasonArchive {
  season: number;
  championId: string;
  awards?: SeasonAwards;
  standings?: string[];                       // 최종 순위 teamId (1위→꼴찌). 순위 기반 업적용
  streaks?: Record<string, [number, number]>; // teamId → [그 시즌 최장 연승, 최장 연패]. 연승/연패 업적용
  series?: Record<string, ('W' | 'L')[][]>;   // teamId → 플옵 시리즈별 W/L 시퀀스. 리버스 스윕·블론 업적용
  record?: Record<string, [number, number]>;  // teamId → [정규리그 승, 패]. 시즌 승수 업적(전승·무승 등)용
}

// ─── 마일스톤 (MILESTONE_SYSTEM) ─────────────────────────────
/** 기록 경신 한 건 — 시즌 경계에서 감지해 피드에 영구 적립(뉴스 P5 소재) */
export interface Milestone {
  season: number;                          // 0-based 발생 시즌
  playerId: string;
  name: string;                            // 당시 선수명(영속 — 은퇴 후 조회 대비)
  teamId: string;
  kind: 'career' | 'club' | 'league';      // 개인 통산 / 구단 / 리그 역대
  text: string;                            // 완성형 표시 문구
  big: boolean;                            // 헤드라인급(역대 진입·구단 최초·레전드 추월)
}

/** 경기 중 작전 교체 방침 (MATCH_SYSTEM 1.3b) — 프리셋/방침 레벨, AI 자동 + 플레이어 토글 */
/** 뉴스 피드 (NEWS_SYSTEM) — 자동 진행된 리그를 읽을 수 있는 기사로. 1~4 종합 파생 */
export interface NewsItem {
  season: number;                                            // 0-based
  kind: 'champion' | 'award' | 'milestone' | 'hof' | 'injury' | 'scandal' | 'owner' | 'streak' | 'standing';
  headline: string;
  big: boolean;                                              // 헤드라인급
  teamId?: string;                                           // 내 팀 강조용
  body?: string;                                             // 기사 본문(사실 기반 2~3문장) — 없으면 분류별 기본 리드
  ref?: string;                                              // 안정 식별자(playerId 등) — newsKey 충돌 방지(동명이인 분리, NEWS_SYSTEM §4.4)
}

/** 영구제명 영속 기록 — 승부조작·학폭 등으로 리그에서 영구 퇴출된 선수(불명예, 뉴스·연표용) */
export interface ExpelRecord {
  season: number;                                            // 제명 확정 시즌(직전 시즌 종료)
  playerId: string;
  name: string;                                              // 제명 시점 이름(선수 소멸 후 표시용)
  teamId: string;                                            // 제명 당시 소속팀
  kind: 'matchfix' | 'violence';
}

export interface SubPolicy {
  pinchServer: boolean; // 약한 서버(세터 등) 차례에 벤치 서브 스페셜리스트 투입
  blockSub: boolean;    // (페이즈2) 접전 시 전위 블로킹 강화
  defSub: boolean;      // (페이즈3) 후위 수비 강화(리시브 약한 선발 교체)
}

/** 다년 계약 — 연봉은 서명 시점 시장가치로 고정 (단위: 만원) */
export interface Contract {
  salary: number;       // 연봉 (만원)
  years: number;        // 총 계약 연수
  remaining: number;    // 잔여 연수
  signedAtAge: number;  // 서명 당시 나이(시장가치 산정 기준)
}

// 훈련으로 성장하는 스탯 (키는 고정 → 제외) — TRAINING_SYSTEM 1.1
export type TrainableStat =
  | 'jump' | 'agility' | 'staminaMax' | 'staminaRegen'
  | 'reaction' | 'positioning'
  | 'focus' | 'consistency' | 'vq'
  | 'skSpike' | 'skBlock' | 'skDig' | 'skReceive' | 'skSet' | 'skServe';

export type TrainingCategory = 'physical' | 'skill' | 'mental';

export type TrainingId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** 감독 훈련 선호 — 핵심 2 + 보조 3 (TRAINING_SYSTEM 3장) */
export interface TrainingFocus {
  primary: [TrainingId, TrainingId];
  secondary: [TrainingId, TrainingId, TrainingId];
}

/** 감독 — 플레이어가 선임하는 별개 존재 (MATCH_SYSTEM 8장, STAFF_SYSTEM) */
export interface Coach {
  id: string;
  name: string;
  age: number;
  charisma: number;          // 타임아웃 기세 수렴 폭 (경기 운영)
  style: CoachStyle;         // 자동 운영 성향 (경기 운영)
  archetype: string;         // 훈련 아키타입 명칭 (표시용)
  trainingFocus: TrainingFocus; // 훈련 선호 (핵심2+보조3)
  salary: number;            // 연봉(만원) — 스태프 예산 차감
  teamId: string | null;     // 소속(null=프리에이전트 풀)
  firedFrom?: string[];      // 경질당한 팀 id — 그 팀엔 다시 부임하지 않음(STAFF_SYSTEM 6)
  contractYears?: number;    // 잔여 계약 연수(팀 소속 시) — 0이면 만료(재계약/FA). FA는 undefined
}

/** 전문 코치 분야 (STAFF_SYSTEM) — 해당 분야 훈련 성장 부스트 */
export type CoachSpecialty = 'attack' | 'defense' | 'stamina' | 'setter' | 'mental';

/** 전문 코치(보조) — 특정 훈련 분야를 빠르게 키운다 */
export interface AssistantCoach {
  id: string;
  name: string;
  age: number;
  specialty: CoachSpecialty;
  rating: number;            // 0~100 역량 → 부스트·연봉
  salary: number;            // 연봉(만원)
  teamId: string | null;     // 소속(null=프리)
  contractYears?: number;    // 잔여 계약 연수(팀 소속 시). FA는 undefined
}

/** 스카우터 — 드래프트 유망주 능력 공개도를 높인다 */
export interface Scout {
  id: string;
  name: string;
  age: number;
  scouting: number;          // 0~100 → 유망주 스탯 공개도
  salary: number;            // 연봉(만원)
  teamId: string | null;     // 소속(null=프리)
}

export interface Team {
  id: string;
  name: string;
  players: string[];       // player ids
  coachId: string;
  coachStyle: CoachStyle;
  foreignSlots: number;    // 외국인 보유 한도
  budget: number;          // 팀 총예산 (만원, 느슨한 제약)
}

/** 구단 정체성(서사) — 고정 배정. 생성 노브(strengthBias·ageRange) + 표시 프로필. CLUB_IDENTITY_SYSTEM */
export type ClubIdentityKey =
  | 'dynasty' | 'aging' | 'rising' | 'cellar' | 'midpack' | 'expansion' | 'rebuild';

export interface ClubIdentity {
  key: ClubIdentityKey;
  label: string;              // 짧은 칩 — "명문" 등
  tagline: string;            // 한 어구 — "전통의 명가" 등
  blurb: string;              // 한 줄 서사
  foundedYear: number;        // 창단연도
  titles: number;             // 통산 우승(서사)
  tradition: number;          // 0~100 전통/팬덤
  recentRanks: number[];      // 최근 N시즌 가상 순위(1=우승)
  strengthBias: number;       // [생성] OVR ± (랜덤 티어 대체)
  ageRange: [number, number]; // [생성] 선수 나이 분포
}

export type Side = 'home' | 'away';

export interface MatchState {
  seed: number;
  setNo: number;                                // 1..5
  points: { home: number; away: number };
  sets: { home: number; away: number };
  serving: Side;
  rotation: { home: number; away: number };     // 0..5
  over: boolean;
}

// ─── 일정/시즌 ───────────────────────────────────────────────

export interface Fixture {
  id: string;
  round: number;
  dayIndex: number;        // 시즌 시작일로부터의 경과 일수
  homeTeamId: string;
  awayTeamId: string;
  seed: number;            // 경기별 결정론 시드
}

export interface MatchResult {
  fixtureId: string;
  homeSets: number;
  awaySets: number;
}

/** 선택한 팀 기준 캘린더에 표시되는 일정 항목 */
export type ScheduleEntry =
  | { kind: 'match'; dayIndex: number; fixture: Fixture; isHome: boolean; opponentId: string }
  | { kind: 'event'; dayIndex: number; title: string };
