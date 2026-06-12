// 랠리 공간 이벤트 (서브~득점 순간 기록) — 테스트/검증용 구조적 텔레메트리.
// 좌표·결과는 추상 엔진 결과로부터 파생되며 승패를 바꾸지 않는다(별도 RNG).

import type { Position, Side } from '../types';
import type { Pt } from './court';
import type { Rng } from './rng';

export type ServeT = 'safe' | 'float' | 'jumpfloat' | 'spike';
export type Atk = 'quick' | 'tempo' | 'open' | 'back';
/** 속공 세부 종류 — A퀵(세터 앞 1m), B퀵(2m 넓게), 이동속공(세터 뒤 횡이동 슬라이드) */
export type QuickKind = 'A' | 'B' | 'slide';

/** 리시브 3상태(+에이스) — 성공/난조/못닿음(에이스 허용) */
export type RecvResult = 'good' | 'poor' | 'shank' | 'ace';
export type AtkResult = 'kill' | 'blocked' | 'dug' | 'error' | 'blockout' | 'softblock';

// rating: 그 동작에 쓰인 기본 종합 스탯(deriveRatings, 0~100 — 그날 진화·폼 반영 입력 기준)
// eff: 그 순간의 실효 배수(체력 잔량·부상 — engine/rally.ts eff()). 실효 스탯 = rating × eff.
// → 동작 결과가 "현재 경기를 뛰고 있는 스탯"에서 나왔는지 검증 가능(tools/simActionTrace.ts)
export type RallyEvent =
  | { t: 'serve'; side: Side; player: string; pos: Position; serveType: ServeT; from: Pt; target: Pt; landing: Pt; errMargin: number; outcome: 'in' | 'ace' | 'fault'; rating?: number; eff?: number }
  | { t: 'receive'; side: Side; player: string; pos: Position; at: Pt; ball: Pt; reach: number; result: RecvResult; q: number; rating?: number; eff?: number }
  | { t: 'set'; side: Side; player: string; pos: Position; from: Pt; target: Pt; landing: Pt; atk: Atk; quickKind?: QuickKind; offTarget: number; inSystem: boolean; rating?: number; eff?: number }
  | { t: 'attack'; side: Side; player: string; pos: Position; atk: Atk; quickKind?: QuickKind; from: Pt; course: Pt; result: AtkResult; rating?: number; eff?: number }
  | { t: 'block'; side: Side; players: string[]; positions: Position[]; at: Pt; count: number }
  | { t: 'dig'; side: Side; player: string; pos: Position; at: Pt; ball: Pt; reach: number; ok: boolean; rating?: number; eff?: number }
  | { t: 'point'; winner: Side; reason: string };

/** playRally 에 넘기는 텔레메트리 핸들 — events는 경기 전체 누적, srng는 랠리별 독립(메인 결과 RNG 불간섭) */
export interface Tele {
  events: RallyEvent[];
  srng: Rng;
  rallyNo: number;
}

export const r01 = (srng: Rng) => () => srng.next();
