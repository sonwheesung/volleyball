// 사건·사고 (스캔들) — 아주 가끔, 리그 어딘가에서 누군가 사고를 친다.
// 순수 + 시드 결정론(`scandal:{id}:{age}` — 나이가 시즌마다 오르므로 시즌당 1회 굴림).
// 저장 없음: 시즌 계층(dynamics)이 파생해 출장 정지(결장)로 반영, 뉴스가 기사로 만든다.

import { createRng, strSeed } from './rng';

export type ScandalKind = 'dui' | 'gambling' | 'sns' | 'awol';

export const SCANDAL_KO: Record<ScandalKind, string> = {
  dui: '음주운전 적발',
  gambling: '불법 도박 연루',
  sns: 'SNS 설화',
  awol: '팀 무단이탈',
};

/** 사안별 출장 정지 경기 수 — 중대할수록 길다 */
export const SCANDAL_MISS: Record<ScandalKind, number> = { dui: 6, gambling: 5, sns: 2, awol: 3 };

/** 선수·시즌당 발생 확률 — 리그(~120명) 전체 기대 약 0.4건/시즌(두세 시즌에 한 번) */
export const SCANDAL_PROB = 0.0035;

/** 스캔들 시즌의 인기 계수 — 팬이 떠난다(선수팬 직격) */
export const SCANDAL_POP_FACTOR = 0.6;

export interface ScandalRoll { kind: ScandalKind; dayT: number /* 시즌 내 발생 시점 0..1 */ }

export function rollScandal(playerId: string, age: number): ScandalRoll | null {
  const rng = createRng(strSeed(`scandal:${playerId}:${age}`));
  if (rng.next() >= SCANDAL_PROB) return null;
  const r = rng.next();
  const kind: ScandalKind = r < 0.3 ? 'dui' : r < 0.5 ? 'gambling' : r < 0.85 ? 'sns' : 'awol';
  return { kind, dayT: rng.next() };
}
