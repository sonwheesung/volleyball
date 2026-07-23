// 다이아 금액 권위 (BACKEND_SYSTEM §13.12 P0-2) — 고정값 거래는 **서버가 금액을 계산**(클라 amount 무시).
// 클라가 amount=1을 보내도 전지훈련은 서버가 −200을 강제한다. 스텁 단계에서도 닫아야 할 구멍(리뷰 지적).
// 상수는 engine/diamonds.ts 락값(AD_REWARD=50·CAMP_COURSE_COST=200·AD_DAILY_CAP=8)의 손복제 —
// 서버는 앱 engine을 import 못 하므로(별 tsconfig) 복제하고, 드리프트는 클라측 가드 `_dv_walletauth`가 대조.
export const AD_REWARD = 50; // 광고 1회 (engine/diamonds AD_REWARD)
export const CAMP_COST = 200; // 전지훈련 코스 (engine/diamonds CAMP_COURSE_COST 손복제) — 2026-07-17 300→200 인하(사용자 결정; 앞서 2026-07-06 900→300)
// 업적 적립 백스톱(H3) — 서버는 시즌 리플레이를 안 하므로 클라가 보낸 achievement 금액을 사전 검증만 한다.
//   · ACH_MAX_PER_CLAIM: 카탈로그 최대 단건(1000 — titles_20·hof_10·perfect_season·points_1m·seasons_100).
//     한 호출이 그 이상 뜯지 못하게 클램프. (engine/achievements ACH_REWARD 실측 2026-07-06)
//   · ACH_LIFETIME_CAP: 평생 합 상한. 카탈로그 86개 총합 16,220(실측 2026-07-06) + 확장 헤드룸 → 20,000.
//     정당 유저는 총합 16,220 < 20,000이라 절대 안 닿음(치터 전용 blast-radius 바운드). earn 라우트가 원장 sum으로 강제.
export const ACH_MAX_PER_CLAIM = 1000; // 업적 1회 적립 상한(카탈로그 최대 단건)
export const ACH_LIFETIME_CAP = 20000; // 업적 평생합 상한(카탈로그 16,220 + 헤드룸)
export const AD_DAILY_CAP = 8; // 광고 하루 상한 서버 백스톱 (engine/diamonds AD_DAILY_CAP)
export const AD_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 광고 쿨다운 서버 백스톱 2시간 (engine/diamonds AD_COOLDOWN_MS 손복제 — 2026-07-17 구 30분. earn 라우트가 최근 'ad' 원장 시각으로 강제, 드리프트는 클라 가드 대조)
export const WELCOME_DIAMONDS = 1000; // 첫 전지훈련 진입 환영 선물(계정당 1회, 멱등키 welcome:<userId>) — 온보딩·다이아 훅

// ── 다이아 출석 패스(ATTENDANCE_PASS_SYSTEM §2.1·§9 Phase① · 서버 지급량 권위) ──
// 스토어 표시가 ₩9,900은 스토어 등록값이 정본(PASS_PRICE_KRW는 표시/가드용). 서버는 지급량·창·리셋·유예만 권위.
// 클라 표시 미러는 engine/diamonds.ts(Phase②) — 드리프트는 클라 가드 _dv_walletauth가 대조(엔진 미러 도입 후).
export const PASS_DAILY_REWARD = 100;     // 하루 수령 💎(dayIndex 슬롯당)
export const PASS_DURATION_DAYS = 28;     // 창 길이(dayIndex 0~27 = 28슬롯)
export const PASS_MAX_TOTAL = PASS_DAILY_REWARD * PASS_DURATION_DAYS; // 2800 — 28일 완주 파생(표시/가드 상한)
export const PASS_PRICE_KRW = 9900;       // 표시가(스토어 등록값이 실청구 정본 — 서버는 표시/가드용만)
export const PASS_RESET_HOUR_KST = 4;     // Q6 — 일일 리셋 KST 04:00(자정 넘겨 플레이 보호, 게임 관행). dayIndex·start·수령 전부 리셋보정
export const PASS_GRACE_DAYS = 3;         // Q5=(B) — 미수령 유예 3일(0이면 (A) 당일 소멸). claim 창 = start ≤ 오늘 ≤ end+GRACE(B3)

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

/** 업적 배치 적립의 평생합 캡 배분 — **순수·DB 무의존**(가드 _dv_earnbatch가 직접 테스트).
 *  used(원장 achievement 평생합)를 baseline으로, wantedAmounts(각 earnAmount('achievement',_) 클램프 후)를
 *  순서대로 배정한다. earn 라우트의 per-call remaining 로직을 **배치에 맞게 grantedSoFar 누적**으로 확장:
 *    remaining = ACH_LIFETIME_CAP - used - grantedSoFar
 *  · remaining<=0 → grant 0, capped:true (단건 라우트의 409 cap과 동일 의미 — 지급 없음, 호출부가 confirm해 재시도 차단)
 *  · remaining>0 → grant = min(wanted, remaining), capped:false (부분 지급도 applied이지 cap 아님 — 단건 라우트와 동일)
 *  누적을 빼먹으면 캡을 여러 아이템이 각자 통과해 초과지급(치터) — 가드가 이 누적을 A/B로 못 박는다. */
export function allocateAchGrants(used: number, wantedAmounts: number[]): Array<{ grant: number; capped: boolean }> {
  let grantedSoFar = 0;
  return wantedAmounts.map((wanted) => {
    const remaining = ACH_LIFETIME_CAP - used - grantedSoFar;
    if (remaining <= 0) return { grant: 0, capped: true };
    const grant = Math.min(wanted, remaining);
    grantedSoFar += grant;
    return { grant, capped: false };
  });
}

/** 잔액게이트(next<0) 우회 대상 — **환불만** 음수 balance 허용(§13.17 P0-1). reason 파생(자유 플래그 아님 →
 *  spend/earn/coupon/camp에 실수로 켜질 사고 구조적 차단). 다 써버린 고래 환불→음수→spend 게이트가 막음(§13.4 H1). */
export const allowsNegativeBalance = (reason: string): boolean => reason === 'refund';
