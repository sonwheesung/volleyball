// 다이아 금액 권위 (BACKEND_SYSTEM §13.12 P0-2) — 고정값 거래는 **서버가 금액을 계산**(클라 amount 무시).
// 클라가 amount=1을 보내도 전지훈련은 서버가 −300을 강제한다. 스텁 단계에서도 닫아야 할 구멍(리뷰 지적).
// 상수는 engine/diamonds.ts 락값(AD_REWARD=50·CAMP_COURSE_COST=300·AD_DAILY_CAP=8)의 손복제 —
// 서버는 앱 engine을 import 못 하므로(별 tsconfig) 복제하고, 드리프트는 클라측 가드 `_dv_walletauth`가 대조.
export const AD_REWARD = 50; // 광고 1회 (engine/diamonds AD_REWARD)
export const CAMP_COST = 300; // 전지훈련 코스 (engine/diamonds CAMP_COURSE_COST) — 2026-07-06 900→300 정액 인하(사용자 결정)
// 업적 적립 백스톱(H3) — 서버는 시즌 리플레이를 안 하므로 클라가 보낸 achievement 금액을 사전 검증만 한다.
//   · ACH_MAX_PER_CLAIM: 카탈로그 최대 단건(1000 — titles_20·hof_10·perfect_season·points_1m·seasons_100).
//     한 호출이 그 이상 뜯지 못하게 클램프. (engine/achievements ACH_REWARD 실측 2026-07-06)
//   · ACH_LIFETIME_CAP: 평생 합 상한. 카탈로그 86개 총합 16,220(실측 2026-07-06) + 확장 헤드룸 → 20,000.
//     정당 유저는 총합 16,220 < 20,000이라 절대 안 닿음(치터 전용 blast-radius 바운드). earn 라우트가 원장 sum으로 강제.
export const ACH_MAX_PER_CLAIM = 1000; // 업적 1회 적립 상한(카탈로그 최대 단건)
export const ACH_LIFETIME_CAP = 20000; // 업적 평생합 상한(카탈로그 16,220 + 헤드룸)
export const AD_DAILY_CAP = 8; // 광고 하루 상한 서버 백스톱 (engine/diamonds AD_DAILY_CAP)
export const WELCOME_DIAMONDS = 1000; // 첫 전지훈련 진입 환영 선물(계정당 1회, 멱등키 welcome:<userId>) — 온보딩·다이아 훅

export type EarnReason = 'ad' | 'achievement' | 'welcome';
export type SpendReason = 'camp';

const EARN_OK = new Set<string>(['ad', 'achievement', 'welcome']);
const SPEND_OK = new Set<string>(['camp']);

/** 라우트 화이트리스트 — 클라의 'purchase'/'coupon' 사칭 차단(그건 별도 검증 라우트). */
export const isEarnReason = (r: string): r is EarnReason => EARN_OK.has(r);
export const isSpendReason = (r: string): r is SpendReason => SPEND_OK.has(r);

/** 적립 권위 금액 — ad는 서버 상수, achievement만 클라값이되 상한 캡. 허용 외/무효면 null. */
export function earnAmount(reason: string, clientAmount: number): number | null {
  if (reason === 'ad') return AD_REWARD;
  if (reason === 'welcome') return WELCOME_DIAMONDS; // 서버 고정 1000(클라값 무시) — 멱등키가 계정당 1회 보장
  if (reason === 'achievement') {
    const a = Math.floor(clientAmount);
    if (!Number.isFinite(a) || a <= 0) return null;
    return Math.min(a, ACH_MAX_PER_CLAIM); // 호출당 클램프(최대 단건). 평생합은 earn 라우트가 원장 sum으로 별도 강제.
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
