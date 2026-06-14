// 사건·사고 (스캔들) — 아주 가끔, 리그 어딘가에서 누군가 사고를 친다.
// 순수 + 시드 결정론. 두 갈래:
//   ① 출장정지(recoverable) — `scandal:{id}:{age}` 시즌당 1회. 경기 수만큼 결장 후 복귀.
//   ② 영구제명(terminal)   — `expel:{id}:{age}` 시즌당 1회. 리그에서 영구 퇴출(불명예 — HOF 불가).
// 처벌 기준은 KOVO/KBO 실제 징계 선례에 맞춤(정규리그 36경기 스케일). 상세 표는 docs/OWNER_SYSTEM 4.6.

import { createRng, strSeed } from './rng';

// ─── ① 출장정지(복귀 가능) ───
export type ScandalKind = 'sns' | 'awol' | 'assault' | 'dui' | 'gambling';

export const SCANDAL_KO: Record<ScandalKind, string> = {
  sns: 'SNS 설화·구설',
  awol: '팀 무단이탈',
  assault: '폭행·불법행위',
  dui: '음주운전 적발',
  gambling: '불법도박 연루',
};

/** 사안별 출장 정지 경기 수 — KOVO/KBO 선례 기준(36경기 시즌 스케일).
 *  SNS 경고급 2 · 무단이탈 4 · 폭행 12 · 음주운전 18(KBO 70/144경기 ≈ 반시즌) · 불법도박 30(거의 시즌아웃). */
export const SCANDAL_MISS: Record<ScandalKind, number> = { sns: 2, awol: 4, assault: 12, dui: 18, gambling: 30 };

/** 선수·시즌당 출장정지 사고 확률 — 리그(~100명) 전체 기대 ~0.4건/시즌 */
export const SCANDAL_PROB = 0.0035;

/** 스캔들 시즌의 인기 계수 — 팬이 떠난다(선수팬 직격) */
export const SCANDAL_POP_FACTOR = 0.6;

/** 사고 후 다음 재계약·FA 평판 계수(≤1) — 사안 경중(정지 경기 수)만큼 연봉 할인.
 *  SNS −1% · 무단이탈 −2% · 폭행 −6% · 음주 −9% · 도박 −15%(상한). 다음 한 시즌만 반영(평판은 회복). */
export function scandalRepMul(missMatches: number): number {
  return 1 - Math.min(0.15, Math.max(0, missMatches) * 0.005);
}

export interface ScandalRoll { kind: ScandalKind; dayT: number /* 시즌 내 발생 시점 0..1 */ }

export function rollScandal(playerId: string, age: number): ScandalRoll | null {
  const rng = createRng(strSeed(`scandal:${playerId}:${age}`));
  if (rng.next() >= SCANDAL_PROB) return null;
  const r = rng.next();
  // 경미가 흔하고 중대가 드물다: SNS 38 · 무단이탈 22 · 음주 25 · 폭행 10 · 도박 5(%)
  const kind: ScandalKind = r < 0.38 ? 'sns' : r < 0.60 ? 'awol' : r < 0.85 ? 'dui' : r < 0.95 ? 'assault' : 'gambling';
  return { kind, dayT: rng.next() };
}

// ─── ② 영구제명(무기한·복귀 없음) ───
export type ExpelKind = 'matchfix' | 'violence';

export const EXPEL_KO: Record<ExpelKind, string> = {
  matchfix: '승부조작·조직 불법도박',
  violence: '학교폭력',
};

/** 선수·시즌당 영구제명 확률 — 매우 희소. 리그 전체 ~0.04건/시즌(한 세기에 서너 명).
 *  실제 KOVO/KBO: 2012 승부조작 영구실격·2021 학교폭력 무기한 — 드물지만 리그를 뒤흔든다. */
export const EXPEL_PROB = 0.0004;

export interface ExpelRoll { kind: ExpelKind }

/** 영구제명 판정 — null=무사. 출장정지(rollScandal)와 독립 시드. */
export function rollExpulsion(playerId: string, age: number): ExpelRoll | null {
  const rng = createRng(strSeed(`expel:${playerId}:${age}`));
  if (rng.next() >= EXPEL_PROB) return null;
  const r = rng.next();
  const kind: ExpelKind = r < 0.55 ? 'matchfix' : 'violence';
  return { kind };
}
