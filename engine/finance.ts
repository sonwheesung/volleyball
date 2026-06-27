// 구단 재정 (FINANCE_SYSTEM) — 모기업 지원 + 관중 + 굿즈, 그리고 구단주의 지갑. 순수 + 시드 결정론.
// 철학: 성적이 나빠도 팬은 잘 안 떠난다 — 대신 직관이 끊겨 지갑이 먼저 마른다.

import { createRng, strSeed } from './rng';

export const HOME_GAMES = 18;   // 36경기의 절반
export const TICKET = 1;        // 객단가(만원)
export const MERCH_PER_FAN = 0.25; // 선수팬 1명당 연간 굿즈 매출(만원)
/** 구단 운영 고정비(만원) — 시설·전지훈련·유소년·프런트. 이게 있어야 흉작 시즌에 적자가 난다 */
export const OPERATING_COST = 80000;

/** 모기업 지원금 베이스(만원) — 팀별 차등 25~33억(모기업 크기가 다르다). 시드 결정론.
 *  2026-06-14 상향(20~28→22~30): 리그 성장으로 연봉↑ → 보전 62% → 베이스 +2억.
 *  2026-06-27 재상향(22~30→25~33, +3억): 구단 정체성(06-18)+성장/노쇠 변경으로 payroll 인플레가
 *  누적돼 평균 net −2.87억/시즌(만성 적자) → 보전 50%·FA 영입 막힘(25/96) 회귀(문서-코드 일관성 검사 발견).
 *  +3억으로 net 회복 → simFinance 120시즌: 잔고 8.0억·보전 8%·FA 성사 68/96(좌절 21=드라마 생존)·✅ 건강. */
export function sponsorBase(teamId: string): number {
  return 250000 + Math.floor(createRng(strSeed(`sponsor:${teamId}`)).next() * 80000);
}

/** 모기업 긴축 계수 — 모기업은 메꿔주는 기관이지 쌓아주는 기관이 아니다.
 *  잔고가 두둑하면 "올해는 자체 운영하세요"(지원 삭감) → 잔고가 유계로 유지된다. */
export function sponsorThrift(cashBefore: number): number {
  if (cashBefore < 150000) return 1;     // 15억 미만 — 전액 지원
  if (cashBefore < 500000) return 0.85;  // 50억 미만 — 약간 긴축
  return 0.7;                            // 그 이상 — "잘 사는 구단" 긴축
}

/** 성적 보너스 — 정규 순위 비례 + 챔프전 성적. "정규 2위에 플옵 준우승이라 모기업이 더 쏜다" */
export function sponsorBonus(base: number, rank: number, teamCount: number, champion: boolean, runnerUp: boolean): number {
  const rankT = teamCount <= 1 ? 1 : 1 - (rank - 1) / (teamCount - 1);
  return Math.round(base * (0.2 * rankT + (champion ? 0.15 : runnerUp ? 0.08 : 0)));
}

/** 직관율 — 성적이 지배하고 팬심이 거든다. 팬은 남아도 발길이 끊긴다 */
export function turnoutRate(winRate: number, fan: number): number {
  return Math.max(0.04, Math.min(0.16, 0.05 + 0.07 * winRate + 0.03 * (fan / 100)));
}

/** 관중 수입(만원) — 평균 관중 × 홈경기 × 객단가 */
export const gateRevenue = (avgAttendance: number): number => Math.round(avgAttendance * HOME_GAMES * TICKET);

/** 굿즈(유니폼) 수입(만원) — 선수팬이 살수록(겹침 포함 총합) 스타가 벌어준다 */
export const merchRevenue = (playerFansTotal: number): number => Math.round(playerFansTotal * MERCH_PER_FAN);

export interface SeasonFinance {
  sponsor: number; bonus: number; gate: number; merch: number; income: number;
  payroll: number; staff: number; expense: number;
  net: number;
  attendance: number;   // 평균 관중(명)
  bailout: boolean;     // 모기업 적자 보전 발생(잔고 바닥)
}

/** 시즌 정산 — 잔고에 순익을 더하고, 바닥나면 모기업이 보전한다(파산 없음, 대신 영입 여력 0) */
export function settleSeason(input: {
  teamId: string; rank: number; teamCount: number; champion: boolean; runnerUp: boolean;
  winRate: number; fan: number; fanTotal: number; playerFansTotal: number;
  payroll: number; staff: number; cashBefore: number;
}): SeasonFinance {
  const base = sponsorBase(input.teamId);
  const sponsor = Math.round(base * sponsorThrift(input.cashBefore));
  const bonus = sponsorBonus(base, input.rank, input.teamCount, input.champion, input.runnerUp);
  const attendance = Math.round(input.fanTotal * turnoutRate(input.winRate, input.fan));
  const gate = gateRevenue(attendance);
  const merch = merchRevenue(input.playerFansTotal);
  const income = sponsor + bonus + gate + merch;
  const expense = input.payroll + input.staff + OPERATING_COST;
  return {
    sponsor, bonus, gate, merch, income,
    payroll: input.payroll, staff: input.staff, expense,
    // bailout은 잔고 적용 후에야 확정 — 호출부가 applyNet(cash,net).bailout으로 덮어쓴다(여기선 placeholder)
    net: income - expense, attendance, bailout: false,
  };
}

/** 잔고 갱신 — floor 0(모기업 보전 플래그) */
export function applyNet(cash: number, net: number): { cash: number; bailout: boolean } {
  const next = cash + net;
  return next < 0 ? { cash: 0, bailout: true } : { cash: next, bailout: false };
}
