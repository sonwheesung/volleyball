// POST /api/auth/login — 신원 → 자체 Bearer 세션 발급(AUTH_SYSTEM §3).
// body: { provider: 'google'|'apple'|'dev', idToken?(google), providerId?(dev), device? }
// google: idToken을 구글 서명·audience 검증 후 sub 도출(server/lib/googleVerify). dev/apple: providerId(기기ID) 스텁.
// 개인정보 최소화: 이메일·이름 미저장(sub만). ⚠ TODO(보안): prod에서 provider='dev' 백도어 차단(구글 미검증 우회).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../../db';
import { users } from '../../../../db/schema';
import { ensureUser } from '../../../../lib/wallet';
import { signToken } from '../../../../lib/auth';
import { verifyGoogleIdToken } from '../../../../lib/googleVerify';

export const dynamic = 'force-dynamic';

type Device = { platform?: string; osVersion?: string; appVersion?: string };
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 64) : null);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { provider?: string; providerId?: string; idToken?: string; device?: Device };
    const provider = body.provider === 'google' || body.provider === 'apple' ? body.provider : 'dev';
    let providerId: string;
    if (provider === 'google') {
      const sub = await verifyGoogleIdToken(body.idToken); // 서명·audience·만료 검증 → sub
      if (!sub) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
      providerId = sub;
    } else {
      providerId = typeof body.providerId === 'string' && body.providerId ? body.providerId : 'dev-user-1';
    }
    const userId = await ensureUser(providerId, provider); // displayName 미저장(최소수집)
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
