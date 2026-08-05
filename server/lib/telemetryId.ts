// 텔레메트리 가명 id — season_telemetry를 계정(users)과 **직접 연결하지 않기 위한** 일방향 파생(2026-08-05, 개인정보 제거).
//
// analyticsId = HMAC-SHA256(userId, SALT) 앞 32 hex.
//   • 같은 유저 → 같은 id  ⇒ 사용자별/코호트 시즌 추이(#139) 그대로 유지.
//   • 역산은 SALT(별도 관리되는 서버 시크릿)가 있어야 가능 ⇒ PIPA 가명정보(§28-2 통계 목적으로 처리 가능).
//   • 저장 행에 userId FK가 없어 users 테이블과 직접 조인 불가 ⇒ 관리자도 실명으로 재식별 못 함.
//
// SALT: 서버 env `TELEMETRY_SALT`(prod은 Vercel env로 **시크릿 설정 권장** → 완전 가명). 미설정 시 아래 폴백 상수로도
//   동작하나(개인정보 제거 효과는 동일 — userId FK 부재), 완전한 재식별 저항을 위해 prod엔 secret 지정.
//   ⚠ SALT를 바꾸면 이후 analyticsId가 달라져 코호트 연속성이 끊긴다(분석 데이터라 무해, 단 출시 전에 확정).
import { createHmac } from 'crypto';

const SALT = process.env.TELEMETRY_SALT || 'baeknyeon-telemetry-pseudonym-v1';

/** userId → 가명 분석 id(HMAC 앞 32hex). 결정론적·안정적(같은 입력=같은 출력). */
export function analyticsIdFor(userId: string): string {
  return createHmac('sha256', SALT).update(userId).digest('hex').slice(0, 32);
}
