// POST /api/auth/login — 신원 → 자체 Bearer 세션 발급(AUTH_SYSTEM §3).
// body: { provider: 'google'|'apple'|'dev', idToken?(google), providerId?(dev), device? }
// google: idToken을 구글 서명·audience 검증 후 sub 도출(server/lib/googleVerify). dev/apple: providerId(기기ID) 스텁.
// 개인정보 최소화: 이메일·이름 미저장(sub만). ⚠ TODO(보안): prod에서 provider='dev' 백도어 차단(구글 미검증 우회).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../../db';
import { users } from '../../../../db/schema';
import { findUserRow, createUser } from '../../../../lib/wallet';
import { signToken } from '../../../../lib/auth';
import { verifyGoogleIdToken } from '../../../../lib/googleVerify';
import { checkLimit, clientIp } from '../../../../lib/ratelimit';

export const dynamic = 'force-dynamic';

type Device = { platform?: string; osVersion?: string; appVersion?: string };
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 64) : null);

export async function POST(req: Request) {
  // #3 레이트리밋(2026-07-07) — 미인증 로그인 플러딩 차단. IP 키로 DB/구글검증 전에 컷(fail-open: Upstash 미설정 시 통과).
  if (!(await checkLimit('login', clientIp(req))).ok) {
    return NextResponse.json({ ok: false, reason: 'rate-limited' }, { status: 429 });
  }
  try {
    const body = (await req.json()) as { provider?: string; providerId?: string; idToken?: string; ageConfirmed?: boolean; device?: Device };
    const provider = body.provider === 'google' || body.provider === 'apple' ? body.provider : 'dev';
    // #2(b)(2026-07-07): 프로덕션에선 실 idToken을 검증하는 google만 허용. dev(무검증 백도어)·apple(토큰검증 미구현)은 401.
    // TODO(Apple 로그인 출시 전 필수): Apple JWKS(appleid.apple.com) 서명·audience(bundle id)·iss/exp 검증 구현 후
    //   apple을 프로덕션 화이트리스트에 추가(별도 EAS 마일스톤 작업). 그 전까지 apple도 프로덕션 차단.
    if (process.env.VERCEL_ENV === 'production' && provider !== 'google') {
      return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    }
    let providerId: string;
    if (provider === 'google') {
      const sub = await verifyGoogleIdToken(body.idToken); // 서명·audience·만료 검증 → sub
      if (!sub) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
      providerId = sub;
    } else {
      providerId = typeof body.providerId === 'string' && body.providerId ? body.providerId : 'dev-user-1';
    }
    // 연령 게이트(만14세, AUTH §8) — **신규 생성만** 확인 요구. 기존 라이브 계정은 소급 강제 안 함.
    // 탈퇴 계정은 providerId가 토움스톤이라 findUserRow가 못 찾음 → 재로그인=새 계정(연령 재확인, AUTH §7.3).
    const found = await findUserRow(providerId, provider);
    let userId: string;
    if (found && !found.deletedAt) {
      userId = found.id; // 기존 계정 — displayName 미저장(최소수집), ageConfirmedAt 재기록 안 함
    } else {
      if (body.ageConfirmed !== true) {
        return NextResponse.json({ ok: false, reason: 'age-required' }, { status: 400 });
      }
      userId = await createUser(providerId, provider, new Date()); // 연령 확인 시점 기록(AUTH §8.2)
    }
    // 진단 기기정보 갱신(§13.17 §A) — 마지막 로그인 기기. lastSeenAt은 DB now()(클럭 일관)
    const d = body.device;
    await db
      .update(users)
      .set({ platform: str(d?.platform), osVersion: str(d?.osVersion), appVersion: str(d?.appVersion), lastSeenAt: sql`now()` })
      .where(eq(users.id, userId));
    const token = signToken(`${provider}:${providerId}`);
    return NextResponse.json({ ok: true, token, userId, provider, displayName: null });
  } catch (e) { reportError(e, 'auth/login');
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  }
}
