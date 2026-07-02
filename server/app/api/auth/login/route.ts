// POST /api/auth/login — 신원 → 자체 Bearer 세션 발급(AUTH_SYSTEM §3).
// body: { provider: 'google'|'apple'|'dev', providerId, displayName? }
// 스텁(dev): provider+providerId 신뢰. EAS: idToken을 구글/애플 JWKS로 검증 후 sub 도출로 교체.
import { NextResponse } from 'next/server';
import { ensureUser } from '../../../../lib/wallet';
import { signToken } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { provider?: string; providerId?: string; displayName?: string };
    const provider = body.provider === 'google' || body.provider === 'apple' ? body.provider : 'dev';
    const providerId = typeof body.providerId === 'string' && body.providerId ? body.providerId : 'dev-user-1';
    const displayName = typeof body.displayName === 'string' ? body.displayName : undefined;
    const userId = await ensureUser(providerId, provider, displayName);
    const token = signToken(`${provider}:${providerId}`);
    return NextResponse.json({ ok: true, token, userId, provider, displayName: displayName ?? null });
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  }
}
