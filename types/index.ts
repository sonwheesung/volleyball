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
  height: number;      // 고정 (나이 무관)
  jump: number;        // 노쇠 시 하락
  agility: number;     // 노쇠 시 하락
  stamina: number;     // 노쇠 시 하락

  // 밑단 — 공통
  reaction: number;    // 완만한 곡선
  positioning: number; // 경험으로 성장

  // 밑단 — 멘탈
  focus: number;       // 집중력(clutch)
  consistency: number; // 기복

  // 기술치 (훈련·경기로 성장하는 순수 기술)
  skSpike: number;
  skBlock: number;
  skDig: number;
  skReceive: number;
  skSet: number;
  skServe: number;

  // 메타
  peakAge: number;     // 전성기 나이(노쇠 곡선용)
  career: CareerStats;
}

/** 감독 — 플레이어가 선임하는 별개 존재 (MATCH_SYSTEM 8장) */
export interface Coach {
  id: string;
  name: string;
  age: number;
  charisma: number;        // 타임아웃 기세 수렴 폭
  style: CoachStyle;       // 자동 운영 성향
  teamId: string;
}

export interface Team {
  id: string;
  name: string;
  players: string[];       // player ids
  coachId: string;
  coachStyle: CoachStyle;
  foreignSlots: number;    // 외국인 보유 한도
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
