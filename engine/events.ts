// 랠리 공간 이벤트 (서브~득점 순간 기록) — 테스트/검증용 구조적 텔레메트리.
// 좌표·결과는 추상 엔진 결과로부터 파생되며 승패를 바꾸지 않는다(별도 RNG).

import type { Position, Side } from '../types';
import type { Pt } from './court';
import type { Rng } from './rng';

export type ServeT = 'safe' | 'float' | 'jumpfloat' | 'spike';
export type Atk = 'quick' | 'tempo' | 'open' | 'back';

/** 리시브 3상태(+에이스) — 성공/난조/못닿음(에이스 허용) */
export type RecvResult = 'good' | 'poor' | 'shank' | 'ace';
export type AtkResult = 'kill' | 'blocked' | 'dug' | 'error' | 'blockout' | 'softblock';

export type RallyEvent =
  | { t: 'serve'; side: Side; player: string; pos: Position; serveType: ServeT; from: Pt; target: Pt; landing: Pt; errMargin: number; outcome: 'in' | 'ace' | 'fault' }
  | { t: 'receive'; side: Side; player: string; pos: Position; at: Pt; ball: Pt; reach: number; result: RecvResult; q: number }
  | { t: 'set'; side: Side; player: string; pos: Position; from: Pt; target: Pt; landing: Pt; atk: Atk; offTarget: number; inSystem: boolean }
  | { t: 'attack'; side: Side; player: string; pos: Position; atk: Atk; from: Pt; course: Pt; result: AtkResult }
  | { t: 'block'; side: Side; players: string[]; positions: Position[]; at: Pt; count: number }
  | { t: 'dig'; side: Side; player: string; pos: Position; at: Pt; ball: Pt; reach: number; ok: boolean }
  | { t: 'point'; winner: Side; reason: string };

/** playRally 에 넘기는 텔레메트리 핸들 — events는 경기 전체 누적, srng는 랠리별 독립(메인 결과 RNG 불간섭) */
export interface Tele {
  events: RallyEvent[];
  srng: Rng;
  rallyNo: number;
}

export const r01 = (srng: Rng) => () => srng.next();
