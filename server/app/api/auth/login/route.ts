// POST /api/auth/login — 신원 → 자체 Bearer 세션 발급(AUTH_SYSTEM §3).
// body: { provider: 'google'|'apple'|'dev', providerId, displayName? }
// 스텁(dev): provider+providerId 신뢰. EAS: idToken을 구글/애플 JWKS로 검증 후 sub 도출로 교체.
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../../db';
import { users } from '../../../../db/schema';
import { ensureUser } from '../../../../lib/wallet';
import { signToken } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

type Device = { platform?: string; osVersion?: string; appVersion?: string };
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 64) : null);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { provider?: string; providerId?: string; displayName?: string; device?: Device };
    const provider = body.provider === 'google' || body.provider === 'apple' ? body.provider : 'dev';
    const providerId = typeof body.providerId === 'string' && body.providerId ? body.providerId : 'dev-user-1';
    const displayName = typeof body.displayName === 'string' ? body.displayName : undefined;
    const userId = await ensureUser(providerId, provider, displayName);
    // 진단 기기정보 갱신(§13.17 §A) — 마지막 로그인 기기. lastSeenAt은 DB now()(클럭 일관)
    const d = body.device;
    await db
      .update(users)
      .set({ platform: str(d?.platform), osVersion: str(d?.osVersion), appVersion: str(d?.appVersion), lastSeenAt: sql`now()` })
      .where(eq(users.id, userId));
    const token = signToken(`${provider}:${providerId}`);
    return NextResponse.json({ ok: true, token, userId, provider, displayName: displayName ?? null });
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  }
}
