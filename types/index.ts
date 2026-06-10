// 공용 타입 — CLAUDE.md 9장 데이터 모델 기준.
// 엔진/스토어/DB/UI가 공유하는 단일 출처.

export type Position = 'S' | 'OH' | 'OP' | 'MB' | 'L';

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
}

export interface Player {
  id: string;
  name: string;
  age: number;
  position: Position;
  isForeign: boolean;

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

  // 메타
  peakAge: number;     // 전성기 나이(노쇠 곡선용)
  career: CareerStats;

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
  };
  best7: Best7Slot[];               // S·OH·OH·OP·MB·MB·L 순
  roundMvps: (AwardWinner | null)[]; // 라운드(leg)별 MVP
}

/** 경기 중 작전 교체 방침 (MATCH_SYSTEM 1.3b) — 프리셋/방침 레벨, AI 자동 + 플레이어 토글 */
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
