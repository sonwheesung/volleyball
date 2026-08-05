// POST /api/ticket/anon — 익명 문의 접수(로그인 없음 · 답변 없음 · 단방향).
//
// 왜 별도 라우트인가:
//   /api/ticket 은 requireUserId 로 익명 폴백을 **의도적으로** 금지한다(§13.17 P0-5 — 비로그인이 dev-user-1
//   한 버킷에 붕괴되는 것 차단). 그 원칙을 흔들지 않으려고 기존 라우트·관리자 라우트·wallet 헬퍼는 일절
//   건드리지 않고, 익명 허용은 이 파일 안에서만 국소적으로 한다.
//
// 왜 PROJ_CODE 를 안 쓰는가:
//   이 서버 배포 하나로 여러 앱(My Word 등)의 문의를 받기 위함. PROJ_CODE 단일소스 원칙(§13.2)의
//   **유일한 예외**이며, 임의 proj 주입을 막으려고 env allowlist 로만 허용한다.
//   allowlist 미설정이면 라우트 자체가 404 — 배구명가 배포에 이 파일이 얹혀도 기본은 꺼진 상태다.
//
// 무인증 공개 엔드포인트라 방어를 두 겹으로 둔다:
//   1) IP 레이트리밋 — Upstash 미설정 시 fail-open(무력)이라 이것만으로는 부족
//   2) 프로젝트별 24시간 총량 캡 — DB 카운트 기반이라 Upstash 없이도 동작(fail-closed)
import { NextResponse } from 'next/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../../../db';
import { projInfo, tickets, users } from '../../../../db/schema';
import { reportError } from '../../../../lib/observability';
import { afterSafe } from '../../../../lib/afterSafe';
import { notifyTicket } from '../../../../lib/notify';
import { checkLimit, clientIp } from '../../../../lib/ratelimit';

export const dynamic = 'force-dynamic';

const CATS = new Set(['bug', 'suggestion', 'question', 'etc', 'refund']);
const CONTENT_MIN = 5;
const CONTENT_MAX = 2000;
const DEFAULT_DAILY_CAP = 50;
// 익명 유저는 프로젝트당 1행. 문의는 전부 여기 귀속된다(누가 썼는지 서버도 모름).
const ANON_PROVIDER = 'dev';
const ANON_PROVIDER_ID = 'anon';

const clip = (v: unknown, max: number): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);

// env는 **호출 시점**에 읽는다(모듈 로드 시 캐시 금지) — auth.ts 와 같은 규약. 배포 env에 즉시 반응.

/** 익명 문의를 허용할 프로젝트(콤마 구분). 미설정이면 빈 집합 → 라우트 전체 비활성. */
function allowedProjects(): Set<string> {
  return new Set(
    (process.env.ANON_TICKET_PROJECTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** 24시간 총량 캡. 잘못된 값(0 이하·NaN)이면 기본값으로 폴백 — 설정 실수로 캡이 풀리지 않게. */
function dailyCap(): number {
  const n = Number(process.env.ANON_TICKET_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

/** 프로젝트 전용 디스코드 채널(DISCORD_TICKET_WEBHOOK_URL_MYWORD 등). 없으면 undefined → notify 기본 폴백. */
function projWebhook(proj: string): string | undefined {
  const key = `DISCORD_TICKET_WEBHOOK_URL_${proj.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return process.env[key] || undefined;
}

/** 프로젝트별 익명 유저 1행 보장. wallet.ensureUser 는 PROJ_CODE 고정이라 여기 proj 인자판을 둔다(기존 함수 무수정). */
async function ensureAnonUser(proj: string): Promise<string> {
  const where = and(
    eq(users.projCode, proj),
    eq(users.provider, ANON_PROVIDER),
    eq(users.providerId, ANON_PROVIDER_ID),
  );

  const found = await db.select({ id: users.id }).from(users).where(where).limit(1);
  if (found.length) return found[0].id;

  const created = await db
    .insert(users)
    .values({ projCode: proj, provider: ANON_PROVIDER, providerId: ANON_PROVIDER_ID })
    .onConflictDoNothing({ target: [users.projCode, users.provider, users.providerId] })
    .returning({ id: users.id });
  if (created.length) return created[0].id;

  // 동시 최초 요청 경쟁 — onConflictDoNothing 이 빈 배열을 주면 남이 먼저 만든 행을 다시 읽는다.
  const again = await db.select({ id: users.id }).from(users).where(where).limit(1);
  if (!again.length) throw new Error('anon user ensure failed');
  return again[0].id;
}

export async function POST(req: Request) {
  const allow = allowedProjects();
  // 미설정 = 기능 자체를 안 켰다는 뜻. 존재를 노출하지 않도록 404.
  if (allow.size === 0) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });

  // 1차: IP 레이트리밋(ticket 리미터 재사용 — 5회/600초). Upstash 미설정이면 통과(fail-open).
  if (!(await checkLimit('ticket', clientIp(req))).ok) {
    return NextResponse.json({ ok: false, reason: 'rate-limited' }, { status: 429 });
  }

  try {
    const b = (await req.json()) as {
      proj?: string;
      category?: string;
      content?: string;
      device?: { platform?: string; appVersion?: string };
    };

    const proj = (b.proj ?? '').trim().toLowerCase();
    if (!allow.has(proj)) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });

    const category = CATS.has(b.category ?? '') ? (b.category as string) : 'etc';
    const content = (b.content ?? '').trim();
    if (content.length < CONTENT_MIN) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });

    // 2차: 24시간 총량 캡. Upstash 없이도 동작하는 fail-closed 가드 — 무인증 라우트의 실질적 방어선.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const counted = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(eq(tickets.projCode, proj), gte(tickets.createdAt, since)));
    if ((counted[0]?.n ?? 0) >= dailyCap()) {
      return NextResponse.json({ ok: false, reason: 'rate-limited' }, { status: 429 });
    }

    // FK 부모 보장(최초 1회 실제 insert, 이후 no-op) → 익명 유저
    await db
      .insert(projInfo)
      .values({ projCode: proj, name: proj })
      .onConflictDoNothing({ target: projInfo.projCode });
    const anonUserId = await ensureAnonUser(proj);

    const platform = clip(b.device?.platform, 32);
    const appVersion = clip(b.device?.appVersion, 32);

    const ins = await db
      .insert(tickets)
      .values({
        projCode: proj,
        userId: anonUserId,
        category,
        content: content.slice(0, CONTENT_MAX),
        platform,
        appVersion,
        // osVersion 미수집 — 익명 문의에선 기기 지문 최소화(개인정보 최소수집)
      })
      .returning({ id: tickets.id });

    // 디스코드 통지는 응답 후(afterSafe) — 서버리스 freeze 유실 방지(§13.22). URL 미설정이면 no-op.
    afterSafe(() =>
      notifyTicket({
        ticketId: ins[0].id,
        category,
        content,
        userId: null, // 익명 — 표시할 유저 없음
        platform,
        appVersion,
        projLabel: `${proj} 문의`,
        webhookUrl: projWebhook(proj),
      }),
    );

    // ticketId 반환 안 함 — 조회·답변 경로가 없어 클라가 쓸 데가 없다(불필요한 식별자 노출 회피).
    return NextResponse.json({ ok: true });
  } catch (e) {
    reportError(e, 'ticket/anon');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
