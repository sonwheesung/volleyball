// 다이아 금액 권위 (BACKEND_SYSTEM §13.12 P0-2) — 고정값 거래는 **서버가 금액을 계산**(클라 amount 무시).
// 클라가 amount=1을 보내도 전지훈련은 서버가 −900을 강제한다. 스텁 단계에서도 닫아야 할 구멍(리뷰 지적).
// 상수는 engine/diamonds.ts 락값(AD_REWARD=50·CAMP_COURSE_COST=900·AD_DAILY_CAP=8)의 손복제 —
// 서버는 앱 engine을 import 못 하므로(별 tsconfig) 복제하고, 드리프트는 클라측 가드 `_dv_walletauth`가 대조.
export const AD_REWARD = 50; // 광고 1회 (engine/diamonds AD_REWARD)
export const CAMP_COST = 900; // 전지훈련 코스 (engine/diamonds CAMP_COURSE_COST)
export const ACH_MAX_TOTAL = 5000; // 업적 평생합 백스톱 상한(H3 — 서버 리플레이 안 하므로 캡만)
export const AD_DAILY_CAP = 8; // 광고 하루 상한 서버 백스톱 (engine/diamonds AD_DAILY_CAP)

export type EarnReason = 'ad' | 'achievement';
export type SpendReason = 'camp';

const EARN_OK = new Set<string>(['ad', 'achievement']);
const SPEND_OK = new Set<string>(['camp']);

/** 라우트 화이트리스트 — 클라의 'purchase'/'coupon' 사칭 차단(그건 별도 검증 라우트). */
export const isEarnReason = (r: string): r is EarnReason => EARN_OK.has(r);
export const isSpendReason = (r: string): r is SpendReason => SPEND_OK.has(r);

/** 적립 권위 금액 — ad는 서버 상수, achievement만 클라값이되 상한 캡. 허용 외/무효면 null. */
export function earnAmount(reason: string, clientAmount: number): number | null {
  if (reason === 'ad') return AD_REWARD;
  if (reason === 'achievement') {
    const a = Math.floor(clientAmount);
    if (!Number.isFinite(a) || a <= 0) return null;
    return Math.min(a, ACH_MAX_TOTAL);
  }
  return null;
}

/** 차감 권위 금액 — camp 서버 상수. 허용 외면 null. */
export function spendAmount(reason: string): number | null {
  if (reason === 'camp') return CAMP_COST;
  return null;
}

/** 잔액게이트(next<0) 우회 대상 — **환불만** 음수 balance 허용(§13.17 P0-1). reason 파생(자유 플래그 아님 →
 *  spend/earn/coupon/camp에 실수로 켜질 사고 구조적 차단). 다 써버린 고래 환불→음수→spend 게이트가 막음(§13.4 H1). */
export const allowsNegativeBalance = (reason: string): boolean => reason === 'refund';
