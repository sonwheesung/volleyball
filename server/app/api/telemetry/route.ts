// /api/telemetry — 시즌 종료 행동 텔레메트리(§13.27). POST=업서트(proj+user+season 교체).
// 서버는 payload를 **불투명 통계 메타 jsonb로 보관만**(게임플레이 불개입·결정론 격리 §1·§8) — 재화·시드·리플레이엔 안 들어감.
// requireUserId(fail-closed·익명 폴백 금지 §13.17 P0-5), proj 스코프(§13.2). 비식별 집계 수치만(비PII).
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/observability';
import { db } from '../../../db';
import { seasonTelemetry } from '../../../db/schema';
import { requireUserId } from '../../../lib/auth';
import { ensureProj } from '../../../lib/wallet';
import { PROJ_CODE } from '../../../lib/proj';
import { analyticsIdFor } from '../../../lib/telemetryId';

export const dynamic = 'force-dynamic';

const MAX_PAYLOAD = 16 * 1024; // 16KB — 집계 카운트라 정상은 수백 바이트. 넉넉한 상한 겸 남용 방어(초과 413).

export async function POST(req: Request) {
  const userId = await requireUserId(req);
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  try {
    const b = (await req.json()) as { season?: unknown; payload?: unknown };

    // season 정수 검증
    if (typeof b.season !== 'number' || !Number.isInteger(b.season)) {
      return NextResponse.json({ ok: false, reason: 'bad-season' }, { status: 400 });
    }
    const season = b.season;

    // payload 객체 검증(배열·null 거부 — jsonb 객체만)
    if (typeof b.payload !== 'object' || b.payload === null || Array.isArray(b.payload)) {
      return NextResponse.json({ ok: false, reason: 'bad-payload' }, { status: 400 });
    }
    const payload = b.payload as Record<string, unknown>;

    // 크기 캡(직렬화 바이트)
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD) {
      return NextResponse.json({ ok: false, reason: 'too-large' }, { status: 413 });
    }

    await ensureProj();

    // 가명 분석 id — userId를 저장하지 않고 HMAC 파생만 저장(개인정보 제거 §privacy, users와 직접 조인 불가).
    const analyticsId = analyticsIdFor(userId);

    // 업서트 — 같은 (proj,analyticsId,season) 재전송 = payload/createdAt 교체(UNIQUE 하드가드와 정합).
    await db
      .insert(seasonTelemetry)
      .values({ projCode: PROJ_CODE, analyticsId, season, payload })
      .onConflictDoUpdate({
        target: [seasonTelemetry.projCode, seasonTelemetry.analyticsId, seasonTelemetry.season],
        set: { payload, createdAt: new Date() },
      });

    return NextResponse.json({ ok: true });
  } catch (e) {
    reportError(e, 'telemetry');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
