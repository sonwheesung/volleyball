// 지갑 멱등키 서버 강제 빌더 — **순수·DB 무의존**(가드 _dv_security가 직접 테스트).
// SECURITY_AUDIT #1·#5(2026-07-07):
//  · FIX#1(welcome 무한발행): welcome은 클라 body.idempotencyKey를 **무시**하고 계정당 상수 'welcome'으로 강제.
//    최종키가 `${userId}:welcome`로 계정당 단일화 → UNIQUE(proj_code, idempotency_key)가 모든 반복을 1행으로 dedupe.
//  · FIX#5(userId 미바인딩 선점): 원장 저장키를 **서버가 해석한 userId**로 네임스페이스 → 공격자가 피해자 userId를
//    임베드한 클라키로 미리 적립해도 저장키는 공격자 userId로 시작 → 교차유저 선점 불가. 정당 재시도는 동일 dedupe.
export const WELCOME_KEY_PART = 'welcome';

/** earn 라우트의 "클라 키 부분" — welcome만 서버 강제 상수(클라 키 무시), ad/achievement/camp는 클라 키 그대로. */
export function earnClientKeyPart(reason: string, clientKey: string): string {
  return reason === 'welcome' ? WELCOME_KEY_PART : clientKey;
}

/** 원장에 **저장될** 최종 멱등키 — 항상 서버해석 userId로 프리픽스(교차유저 선점 차단·계정당 welcome 단일화). */
export function walletIdemKey(userId: string, clientKeyPart: string): string {
  return `${userId}:${clientKeyPart}`;
}
