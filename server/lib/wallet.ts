// 다이아 지갑 — 원자적 적립/차감 (BACKEND_SYSTEM §4·§13.4 H2).
// 불변식: balance == sum(ledger.delta) 항상. 절대 음수 안 됨(spend는 balance 게이트).
// 동시성(H2): 서로 다른 동시 spend 2건이 각자 잔액 읽고 통과하는 초과지출을 막으려면 멱등키만으론 부족 —
//   트랜잭션 안에서 users 행을 FOR UPDATE로 잠가 직렬화한다. 멱등키는 "같은 키 재시도"를 dedupe.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, walletLedger, projInfo } from '../db/schema';
import { PROJ_CODE } from './proj';
import { allowsNegativeBalance } from './econ';

// pass_daily = 출석 패스 일일 수령 · iap_bonus_1p1 = 월1회 1+1 보너스(ATTENDANCE_PASS_SYSTEM §2.5·§3.4).
// 둘 다 적립(delta>0). 환불 회수는 기존 'refund' 재사용(멱등키/ref로 종류 구분 — §4.4 판단 보고). pass_daily는 /earn 화이트리스트 제외(전용 라우트).
// mail = 우편함 다이아 수령(MAILBOX_SYSTEM §4). 적립(delta>0), 멱등키 mail:<mailId> / mail_bc:<bcId>:<userId>. /earn 화이트리스트 제외(전용 claim 라우트).
export type WalletReason = 'purchase' | 'ad' | 'achievement' | 'camp' | 'refund' | 'adjust' | 'coupon' | 'welcome' | 'pass_daily' | 'iap_bonus_1p1' | 'mail';

export type WalletResult =
  | { ok: true; balance: number; applied: boolean } // applied=false → 멱등 재시도(이미 처리됨, 재적용 안 함)
  | { ok: false; reason: 'insufficient' | 'no-user'; balance: number }
  | { ok: false; reason: 'error' };

/** drizzle 트랜잭션 핸들 타입(내부 타입 import 없이 유도) — applyWalletTx 주입용. */
export type WalletTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 지갑 delta 적용 — **주어진 트랜잭션 안에서**(쿠폰 redeem 등과 원자 합성용, §13.14 P0-A).
 * 멱등(중복키=재적용 안 함) + 잔액게이트(음수 거부). 호출부가 tx 소유·커밋/롤백. throw 없이 typed 반환.
 * @param idempotencyKey 스토어 transaction_id / SSV id / 업적id / camp키 / coupon:<userId>:<couponId> 등 자연키
 */
export async function applyWalletTx(
  tx: WalletTx,
  userId: string,
  delta: number,
  reason: WalletReason,
  idempotencyKey: string,
  ref?: string,
): Promise<WalletResult> {
  // 1) 멱등 — 같은 (proj, 키)가 이미 있으면 재적용 안 함. 단 잔액은 원장의 그때 balanceAfter(스냅샷)가
  //    아니라 **현재 지갑 잔액**을 반환한다. balanceAfter는 그 거래 시점 값이라 이후 다른 거래(지출·적립)가
  //    있으면 stale → 클라가 옛 잔액으로 되돌아가 split-brain 표시(에뮬 재현 2026-07-06: 환영 +1000 후
  //    캠프 −300(구 −900)으로 잔액이 줄었는데, 화면 재진입 시 환영 멱등재시도가 옛 1000을 반환해 100을 덮어씀). 현재값으로 수렴.
  const dup = await tx
    .select({ id: walletLedger.id })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, idempotencyKey)))
    .limit(1);
  // ※ 유저 조회는 **proj 스코프 필수**(§13.2 멀티게임 격리, R2 2026-07-24). 없으면 admin/refund·admin/grant가
  //    **타 게임 유저 지갑**을 차감/지급할 수 있었다(우리 proj 원장에 남 게임 유저 거래가 기록됨). userId는 uuid PK라
  //    토큰 파생 경로(earn/spend/coupon/mail/pass)는 애초에 우리 proj 유저 → **정상 경로 동작 변화 0**, 관리자 입력만 막힌다.
  //    실패 어휘는 기존 'no-user' 재사용(새 코드 발명 없음 — 타 proj 유저 = 이 게임엔 없는 유저).
  if (dup.length) {
    const u = await tx.select({ balance: users.balance }).from(users).where(and(eq(users.projCode, PROJ_CODE), eq(users.id, userId))).limit(1);
    // 이 proj에 없는 유저 = no-user(멱등 재시도라도 남 게임 유저 잔액을 0으로 위장 반환하지 않는다).
    // 정상 경로에선 도달 불가 — 원장 행(FK)이 있으면 유저 행도 반드시 있고, 그 유저는 이 proj다.
    if (!u.length) return { ok: false as const, reason: 'no-user' as const, balance: 0 };
    return { ok: true as const, balance: u[0].balance, applied: false };
  }

  // 2) 행 잠금 — 동시 spend 직렬화(FOR UPDATE)
  const locked = await tx.select({ balance: users.balance }).from(users).where(and(eq(users.projCode, PROJ_CODE), eq(users.id, userId))).for('update').limit(1);
  if (!locked.length) return { ok: false as const, reason: 'no-user' as const, balance: 0 };

  const cur = locked[0].balance;
  const next = cur + delta;
  // 잔액게이트 = **차감 전용**(§13.17 P0-1 정정 2026-07-16 — delta 부호 미구분 트랩). delta<0(차감)이 음수로 떨어질 때만 거부.
  //   · 차감(delta<0, camp): next<0이면 'insufficient' — spend 게이트는 절대 약화 안 됨(다 써버린 고래는 더 못 씀 §13.4 H1).
  //   · 환불(delta<0, refund): allowsNegativeBalance로 게이트 우회 — 음수 허용(클로백).
  //   · 적립(delta>0, ad/achievement/coupon/welcome/adjust): **잔액이 음수여도 항상 통과**(부채 상환 경로). 환불로 음수가 된
  //     유저가 광고/업적/쿠폰으로 빚을 갚아 0으로 복귀 가능 — 이걸 막던 게 음수 탈출 불가 트랩(적립까지 거부)이었음.
  // balance==Σledger 불변식은 방향 무관 유지(적립은 잔액을 0쪽으로 올릴 뿐 불변식 안 깸).
  if (delta < 0 && next < 0 && !allowsNegativeBalance(reason)) return { ok: false as const, reason: 'insufficient' as const, balance: cur };

  // 3) 잔액 갱신 + 원장 기록(같은 트랜잭션 = 원자적)
  await tx.update(users).set({ balance: next }).where(eq(users.id, userId));
  await tx.insert(walletLedger).values({ projCode: PROJ_CODE, userId, delta, reason, ref, idempotencyKey, balanceAfter: next });
  return { ok: true as const, balance: next, applied: true };
}

/**
 * 지갑에 delta 를 원자적으로 적용(자체 트랜잭션). delta>0 적립, delta<0 차감.
 * applyWalletTx를 얇게 감싸 재사용(중복로직 0). earn/spend 라우트용.
 */
export async function applyWallet(
  userId: string,
  delta: number,
  reason: WalletReason,
  idempotencyKey: string,
  ref?: string,
): Promise<WalletResult> {
  try {
    return await db.transaction((tx) => applyWalletTx(tx, userId, delta, reason, idempotencyKey, ref));
  } catch {
    // 동시 same-key 경쟁 dedup 수렴(2026-07-17, prod 샌드박스 실결제 실측 — RC 웹훅↔confirm 폴백이 ~100ms 내 동시 도착해
    //   진 쪽 트랜잭션이 ledger_proj_idem_uniq 유니크 충돌로 throw → 매 결제 발생). 무조건 error로 끝내지 않고 **재조회로 dedup 판정**:
    //   진 쪽이 진 이유가 "경쟁자가 이미 같은 키를 커밋"이면 그건 오류가 아니라 멱등 재시도와 동형 → applyWalletTx의 dup 경로와
    //   같은 형태로 수렴시킨다(confirm이 지면 500 대신 200 성공 UX / 웹훅이 지면 RC 불필요 재시도 제거). 돈은 이미 정확(이중지급 0).
    try {
      const dup = await db
        .select({ id: walletLedger.id })
        .from(walletLedger)
        .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (dup.length) {
        // 경쟁자가 이미 지급 완료 → 현재 잔액 반환(balanceAfter 스냅샷 아님 — split-brain 방지, applyWalletTx dup 경로와 동일 규칙).
        // proj 스코프(R2) — applyWalletTx의 dup 경로와 같은 규칙. 유니크 충돌 경쟁은 같은 proj 안에서만 나므로 동작 변화 0.
        const u = await db.select({ balance: users.balance }).from(users).where(and(eq(users.projCode, PROJ_CODE), eq(users.id, userId))).limit(1);
        return { ok: true as const, balance: u.length ? u[0].balance : 0, applied: false };
      }
    } catch {
      // 재조회 자체 실패(DB 다운 등) → 유니크 충돌이 아닌 오류를 성공으로 위장하지 않는다.
      return { ok: false as const, reason: 'error' as const };
    }
    // 유니크 충돌이 아닌 진짜 오류(DB 다운·FK 등 — 키 행이 없음) → 현행대로 error.
    return { ok: false as const, reason: 'error' as const };
  }
}

/** 오늘(UTC 캘린더 데이) 특정 reason 원장 건수 — 광고 하루 상한 서버 백스톱(§13.12). */
export async function countReasonToday(userId: string, reason: WalletReason): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.projCode, PROJ_CODE),
        eq(walletLedger.userId, userId),
        eq(walletLedger.reason, reason),
        sql`${walletLedger.createdAt} >= date_trunc('day', now())`,
      ),
    );
  return rows[0]?.n ?? 0;
}

/** 특정 reason **가장 최근** 원장 행의 시각(ms) — 광고 쿨다운 서버 백스톱의 진실(§13.12, 2026-07-17). 없으면 null.
 *  countReasonToday(하루 건수)와 짝: 그건 하루 상한, 이건 최근 1건 시각(**날짜 무관** — 자정 넘는 쿨다운도 정확). ledger_user_idx 활용. */
export async function lastReasonAt(userId: string, reason: WalletReason): Promise<number | null> {
  const rows = await db
    .select({ lastMs: sql<string | null>`(extract(epoch from max(${walletLedger.createdAt})) * 1000)::bigint` })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, userId), eq(walletLedger.reason, reason)));
  const r = rows[0];
  return r?.lastMs != null ? Number(r.lastMs) : null;
}

/** 특정 reason 원장 delta 합계(평생·프로젝트/유저 스코프) — 업적 평생합 백스톱의 **서버 진실**(§13.12 H3).
 *  countReasonToday(건수)와 짝: 그건 광고 하루 상한, 이건 업적 평생합. 원장이 진실이라 세이브 리셋으로 못 우회. */
export async function sumReason(userId: string, reason: WalletReason): Promise<number> {
  const rows = await db
    .select({ s: sql<number>`coalesce(sum(${walletLedger.delta}), 0)::int` })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, userId), eq(walletLedger.reason, reason)));
  return rows[0]?.s ?? 0;
}

/** 오늘(UTC) 광고 적립 상태 — 횟수 + 마지막 시각(ms). 광고 쿨다운/캡의 **서버 진실**(§13.19 — 로컬 리셋으로 못 우회). */
export async function adStatusToday(userId: string): Promise<{ count: number; lastAtMs: number | null }> {
  const rows = await db
    .select({
      n: sql<number>`count(*)::int`,
      lastMs: sql<string | null>`(extract(epoch from max(${walletLedger.createdAt})) * 1000)::bigint`,
    })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, userId), eq(walletLedger.reason, 'ad'), sql`${walletLedger.createdAt} >= date_trunc('day', now())`));
  const r = rows[0];
  return { count: r?.n ?? 0, lastAtMs: r?.lastMs != null ? Number(r.lastMs) : null };
}

/** 접속 하트비트(BACKEND §13.15·§13.29) — 인증된 콜에서 lastSeenAt을 now()로 찍는다.
 *  ~~로그인 시에만 lastSeenAt 갱신(하트비트 미구현) → DAU가 "오늘 로그인한 사람"만 셈~~ → GET /api/wallet(=앱이 로그인·포그라운드마다 부르는
 *  syncWallet)에서 이 함수를 태워 DAU를 "오늘 앱을 켠 사람"으로 정확화(2026-07-31, 테스터: 오늘 테스트했는데 DAU 0 — 세션 영속이라 재로그인 안 함).
 *
 *  ★ 정정(2026-08-08, §13.29 착수 전 전수 실측 — 위 서술이 두 군데 부정확했다):
 *   · **"로그인 시에만 갱신"은 취소선 대상이 아니었다** — `auth/login` 라우트는 지금도 기기정보 갱신과 함께 `lastSeenAt: now()`를
 *     **무조건** 쓴다(app/api/auth/login/route.ts, `.set({platform,osVersion,appVersion,lastSeenAt})`). 즉 로그인은 여전히 정당한 writer다.
 *   · **"포그라운드마다"는 사실이 아니다** — GET /api/wallet(syncWallet)을 부르는 곳은 components/BootGate.tsx의
 *     **로그인 직후 + AppState 'active' 복귀** 두 순간뿐이고 **주기 타이머가 없다**. 그래서 앱을 켜놓고 40분 경기를 보는 유저가
 *     "최근 30분(active30m)" 창에서 사라진다(§13.15 정정 ②). DAU는 날짜 해상도라 무영향, 깨진 건 active30m뿐.
 *  ⇒ 현재 writer 전수: ① auth/login ② GET /api/wallet ③ **POST /api/heartbeat(신, §13.29 — 경기 시작 이벤트 핑)**.
 *  now()는 DB 클럭(로그인과 동일 규약). 탈퇴 유저 제외. 실패는 조용히 무시(지표 부수효과라 본 응답을 막지 않는다). */
export async function touchLastSeen(userId: string): Promise<void> {
  try {
    await db.update(users).set({ lastSeenAt: sql`now()` }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
  } catch { /* 하트비트 실패는 무시 — DAU 근사, 본 기능 아님 */ }
}

/** 현재 잔액 + 최근 원장 N건 + 오늘 광고 상태(쿨다운/캡 서버 진실) + 출석 패스 상태(Q2 §2.4).
 *  pass는 순환 import 방지 위해 지연 import(lib/pass → lib/wallet 역참조 회피). */
export async function getWallet(userId: string, recent = 20) {
  const u = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u.length) return null;
  const ledger = await db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId))
    .orderBy(walletLedger.createdAt)
    .limit(recent);
  const adToday = await adStatusToday(userId);
  // 지급 완료 업적 id 전체(reason='achievement' distinct ref) — 원장 윈도우(recent 20)로는 오래된 지급이 누락돼
  //   재설치·기기변경 후 이미 받은 업적이 "보상받기"로 다시 뜨던 것(테스터 2026-07-30)을 서버 진실로 pre-mark.
  //   전체 distinct라 작음(업적 수십 개 상한). ref null(구 데이터)은 배제.
  const earnedAchRows = await db
    .selectDistinct({ ref: walletLedger.ref })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, userId), eq(walletLedger.reason, 'achievement')));
  const earnedAch = earnedAchRows.map((r) => r.ref).filter((r): r is string => !!r);
  const { passStatus } = await import('./pass'); // 지연 import(순환 회피)
  const pass = await passStatus(userId);
  // 우편함 미확인·미수령 카운트 편입(MAILBOX §5.2 R4·S1 — syncWallet 합류점 재사용, 별 라운드트립 0). 지연 import(순환 회피).
  const { mailCounts } = await import('./mail');
  const { unreadMailCount, unclaimedMailCount } = await mailCounts(userId);
  return { balance: u[0].balance, ledger, adToday, pass, unreadMailCount, unclaimedMailCount, earnedAch };
}

/** 이 게임(PROJ_CODE)의 proj_info 행 보장 — FK 대상. 최초 1회만 실제 insert. */
export async function ensureProj(): Promise<void> {
  await db
    .insert(projInfo)
    .values({ projCode: PROJ_CODE, name: PROJ_CODE })
    .onConflictDoNothing({ target: projInfo.projCode });
}

/** (proj_code, provider, providerId) 유저 upsert → id. 인증(auth/login·resolveUserId)·익명 폴백 공용. */
export async function ensureUser(providerId: string, provider = 'dev', displayName?: string): Promise<string> {
  await ensureProj(); // FK 부모 보장(최초 1회 실제 insert, 이후 no-op)
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.projCode, PROJ_CODE), eq(users.provider, provider), eq(users.providerId, providerId)))
    .limit(1);
  if (existing.length) return existing[0].id;
  const inserted = await db
    .insert(users)
    .values({ projCode: PROJ_CODE, provider, providerId, displayName })
    .returning({ id: users.id });
  return inserted[0].id;
}

/** 로그인 계정 이메일 저장/갱신(AUTH §3.5) — **운영 식별용**. 값이 같으면 쓰지 않는다(불필요 write 회피).
 *  ★ throw-none: 실패해도 삼킨다. 이메일은 편의 정보라 여기서 터지면 **로그인 자체가 막히는** 게 더 큰 손해다(§13.22).
 *  ⚠ 개인정보 — 탈퇴 시 파기 대상(§13.9 비필수). 처리방침 §1① 수집 항목에 명시돼 있어야 한다. */
export async function setUserEmail(userId: string, email: string): Promise<void> {
  try {
    // ⚠ **SQL NULL 함정(2026-08-08 실제로 밟음)**: 여기 원래 `ne(users.email, email)`로 "같으면 쓰지 않기" 최적화를 넣었는데,
    //   기존 값이 NULL이면 `NULL <> 'x'` 가 TRUE가 아니라 **NULL**이라 WHERE를 통과하지 못한다 → UPDATE 0행.
    //   즉 **최초 채우기가 통째로 막혔다**(정작 채워야 할 계정만 안 채워지는 정반대 결과).
    //   → 조건을 뺀다. 로그인당 UPDATE 1건은 무시할 비용이고, 아끼려다 기능을 죽이는 게 훨씬 비싸다.
    await db.update(users).set({ email }).where(eq(users.id, userId));
  } catch {
    /* 무음 — 로그인 비차단 */
  }
}

/** 개발용 고정 유저 보장(익명 폴백 — Bearer 없을 때). provider=dev. */
export async function ensureDevUser(providerId = 'dev-user-1'): Promise<string> {
  return ensureUser(providerId, 'dev');
}

/** (proj, provider, providerId) 라이브 조회 — **생성 안 함**. 없으면 null. deletedAt은 호출부가 판정(AUTH §7.2·§8.1).
 *  requireUserId/resolveUserId(토큰→라이브 유저)·login(신규 여부 판정)·계정삭제(멱등)에서 공용. */
export async function findUserRow(providerId: string, provider = 'dev'): Promise<{ id: string; deletedAt: Date | null } | null> {
  const rows = await db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(and(eq(users.projCode, PROJ_CODE), eq(users.provider, provider), eq(users.providerId, providerId)))
    .limit(1);
  return rows.length ? rows[0] : null;
}

/** 신규 소셜 유저 생성 — 연령 확인(ageConfirmedAt) 기록(AUTH §8). login 라우트 전용(연령 게이트 통과 후).
 *  ensureUser(저수준 upsert)와 분리: 게이트가 걸린 "진짜 가입"만 이 경로로 ageConfirmedAt을 박는다. */
export async function createUser(providerId: string, provider: string, ageConfirmedAt: Date, displayName?: string): Promise<string> {
  await ensureProj(); // FK 부모 보장
  const inserted = await db
    .insert(users)
    .values({ projCode: PROJ_CODE, provider, providerId, displayName, ageConfirmedAt })
    .returning({ id: users.id });
  return inserted[0].id;
}

/** 누적 실가입 수(§13.28) — 이 proj에서 **연령 게이트를 통과한 진짜 가입**(`ageConfirmedAt` not null)만 센다.
 *  `ageConfirmedAt`은 createUser만 박으므로 ensureUser가 만든 dev/가드 행·익명 문의 유저(provider=anon)는 자연 제외.
 *  탈퇴 행도 포함 — "누적 가입"의 정의(탈퇴해도 가입은 있었다). 신규 가입 알림의 "N번째" 표기용.
 *  **throw-none**: 관측용 부수 지표라 실패 시 null(알림은 '—'로 나가고 가입 흐름엔 영향 0). */
export async function countSignups(): Promise<number | null> {
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.projCode, PROJ_CODE), sql`${users.ageConfirmedAt} is not null`));
    return rows[0]?.n ?? null;
  } catch {
    return null; // 카운트 실패가 알림/가입을 막지 않는다
  }
}

/** 탈퇴 — 가명처리 소프트삭제(AUTH §7.1). providerId 비복원 파기(재로그인 매칭 불가+UNIQUE 슬롯 해제)·비필수 PII null·
 *  deletedAt 마킹. **잔액·원장은 보존**(법정 5년). 멱등: 이미 삭제면 false, 이번에 삭제하면 true. */
export async function pseudonymizeUser(userId: string): Promise<boolean> {
  const res = await db
    .update(users)
    .set({
      deletedAt: sql`now()`,
      providerId: `deleted:${userId}`, // 토움스톤 — 원본 sub 비복원 파기(재로그인=새 계정)
      displayName: null,
      platform: null,
      osVersion: null,
      appVersion: null,
    })
    .where(and(eq(users.id, userId), isNull(users.deletedAt))) // 멱등 — 이미 삭제된 행은 재처리 안 함
    .returning({ id: users.id });
  return res.length > 0;
}
