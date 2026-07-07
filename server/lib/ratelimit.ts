// 서버 레이트리밋 유틸 (SECURITY_AUDIT #3, 2026-07-07) — Upstash Redis 슬라이딩 윈도.
//
// ★ 안전 원칙 (fail-open, 두 겹):
//   1) **미설정 fail-open**: UPSTASH_REDIS_REST_URL/TOKEN 중 하나라도 없으면 리미터는 **항상 허용**(no-op).
//      → Upstash 세팅 전에도 이 코드를 안전하게 커밋할 수 있고, 로컬 dev는 절대 막히지 않는다.
//      모듈 로드 시점에 절대 throw하지 않도록 Redis 클라 + Ratelimit 인스턴스를 **지연 초기화**한다.
//   2) **Redis 오류 fail-open**: 한도 검사 중 예외(Redis 다운/타임아웃)면 요청을 **허용**하고 reportError만.
//      인프라 장애로 정상 유저를 막지 않는다(인디 앱은 Redis 딸꾹질에 서비스가 죽으면 안 된다).
//
// 식별자 프리픽스: checkLimit이 엔드포인트명을 키에 섞어(cross-endpoint 충돌 방지) 저장한다.
import { reportError } from './observability';

// ── 튜너블 윈도 상수 (테스트/가드가 이 값을 직접 읽어 드리프트 차단) ──
export const LIMITS = {
  login: { limit: 10, windowSec: 60 }, // 로그인: 10회/60초 (IP)
  couponRedeemUser: { limit: 8, windowSec: 60 }, // 쿠폰: 8회/60초 (userId)
  couponRedeemIp: { limit: 20, windowSec: 600 }, // 쿠폰: 20회/600초 (IP)
  ticket: { limit: 5, windowSec: 600 }, // 문의: 5회/600초 (userId)
  snapshot: { limit: 10, windowSec: 300 }, // 스냅샷: 10회/300초 (userId)
} as const;

export type LimiterName = keyof typeof LIMITS;

// ── 지연 초기화 (모듈 로드 시 절대 throw 금지) ──
type RatelimitLike = { limit: (id: string) => Promise<{ success: boolean }> };
let cachedLimiters: Record<LimiterName, RatelimitLike> | null = null;
let initTried = false;

/** env가 둘 다 있으면 Ratelimit 인스턴스 맵, 아니면 null(no-op → 항상 허용). */
function getLimiters(): Record<LimiterName, RatelimitLike> | null {
  if (initTried) return cachedLimiters;
  initTried = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // 미설정 → fail-open no-op
  try {
    // 지연 require — 미설정 경로에선 모듈을 아예 안 만진다.

    const { Redis } = require('@upstash/redis') as typeof import('@upstash/redis');

    const { Ratelimit } = require('@upstash/ratelimit') as typeof import('@upstash/ratelimit');
    const redis = new Redis({ url, token });
    const make = (name: LimiterName): RatelimitLike =>
      new Ratelimit({
        redis,
        prefix: `rl:${name}`,
        limiter: Ratelimit.slidingWindow(LIMITS[name].limit, `${LIMITS[name].windowSec} s`),
      });
    cachedLimiters = {
      login: make('login'),
      couponRedeemUser: make('couponRedeemUser'),
      couponRedeemIp: make('couponRedeemIp'),
      ticket: make('ticket'),
      snapshot: make('snapshot'),
    };
    return cachedLimiters;
  } catch (e) {
    reportError(e, 'ratelimit/init');
    return null; // 초기화 실패도 fail-open
  }
}

/**
 * 한도 검사. 미설정(no-op)·Redis 오류는 모두 **허용(fail-open)**.
 * identifier는 엔드포인트명으로 프리픽스해 cross-endpoint 키 충돌을 막는다.
 */
export async function checkLimit(name: LimiterName, identifier: string): Promise<{ ok: boolean }> {
  const limiters = getLimiters();
  if (!limiters) return { ok: true }; // 미설정 → 항상 허용
  try {
    const res = await limiters[name].limit(`${name}:${identifier}`);
    return { ok: res.success };
  } catch (e) {
    reportError(e, `ratelimit/${name}`);
    return { ok: true }; // Redis 장애 → 허용(정상 유저 보호)
  }
}

/** Vercel이 세팅하는 x-forwarded-for의 첫 홉(실 클라 IP). 없으면 'unknown'. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
