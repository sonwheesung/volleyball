// 서비스 종료 시 **미사용 유상 다이아 환불 산정 리포트** (읽기 전용 — 지급 실행 아님). 정본 docs/SHUTDOWN_POLICY.md §3.
// 원장(wallet_ledger, append-only)을 유저별·시간순 재생해 "유상 잔여"를 산정한다.
//   규칙(약관 제2·5조·운영정책과 일치):
//     · purchase(+)                         → 유상 적립(환불 대상 풀)
//     · ad/achievement/coupon/welcome/adjust(+) → 무상 적립(환불 비대상)
//     · 소비(음수, camp 등 non-refund)        → 무상 우선 소진 후 유상 차감(이용자 유리 = 유상 최대 보존)
//     · refund(−)                           → 유상 풀에서 회수(구매 클로백)
//     · 최종 잔액 < 0(부채)                   → 유상 잔여 0
//     · ref 끝이 ':sandbox'인 purchase(+)     → 집계 제외(테스터 지급; --include-sandbox 시만 포함)
// Usage:
//   cd server && npx tsx tools/shutdownRefundReport.ts            (dev DB — .env.development.local 우선, 없으면 .env.local)
//   cd server && npx tsx tools/shutdownRefundReport.ts --include-sandbox   (테스터 유상 지급도 포함)
//   cd server && npx tsx tools/shutdownRefundReport.ts --selftest  (DB 불필요 — 손계산 4시나리오 A/B 자가검증)
//   운영 겨냥: DATABASE_URL=... npx tsx tools/shutdownRefundReport.ts

export type LedgerRow = { delta: number; reason: string; ref?: string | null };
export type RefundResult = { purchasedTotal: number; purchasedRemaining: number; balance: number };

const SPEND_FREE_FIRST = new Set(['ad', 'achievement', 'coupon', 'welcome', 'adjust']); // 무상 적립(양수일 때)

function isSandboxPurchase(r: LedgerRow): boolean {
  return r.reason === 'purchase' && typeof r.ref === 'string' && r.ref.endsWith(':sandbox');
}

/** 유저 한 명의 원장(시간순 정렬 가정)을 재생해 유상 적립합·유상 잔여·전체 잔액을 산정. 순수 함수(DB 무관). */
export function computeUserRefund(ledger: LedgerRow[], includeSandbox: boolean): RefundResult {
  let purchasedTotal = 0; // 집계된 유상 적립 합(리포트 표시용)
  let purchased = 0; // 유상 잔여 풀
  let free = 0; // 무상 잔여 풀(음수로 내려가지 않음)
  let balance = 0; // 전체 잔액 = Σdelta (모든 원장 포함 — sandbox·무상 포함)

  for (const r of ledger) {
    balance += r.delta;
    if (r.delta > 0) {
      if (r.reason === 'purchase') {
        if (isSandboxPurchase(r) && !includeSandbox) {
          free += r.delta; // 테스터 유상 지급 — 환불 비대상으로 취급(무상 풀에 넣어 소진순위도 무상)
        } else {
          purchased += r.delta;
          purchasedTotal += r.delta;
        }
      } else {
        // ad/achievement/coupon/welcome/adjust(+) 및 기타 양수 → 무상
        free += r.delta;
      }
    } else if (r.delta < 0) {
      const amt = -r.delta;
      if (r.reason === 'refund') {
        purchased -= amt; // 유상 회수(클로백) — 음수로 내려갈 수 있음(부채 → 최종 0 클램프)
      } else {
        // 소비(camp 등) → 무상 우선 소진 후 유상 차감
        const useFree = Math.min(free, amt);
        free -= useFree;
        const rest = amt - useFree;
        if (rest > 0) purchased -= rest;
      }
    }
  }

  let purchasedRemaining = purchased;
  if (balance < 0) purchasedRemaining = 0; // 부채 유저 → 유상 잔여 0
  if (purchasedRemaining < 0) purchasedRemaining = 0; // 클로백 초과 방어
  if (balance >= 0 && purchasedRemaining > balance) purchasedRemaining = balance; // 유상 잔여는 실잔액 초과 불가(방어)
  return { purchasedTotal, purchasedRemaining, balance };
}

// ── 셀프테스트(가드) — 손계산 기대값 대조 + A/B 민감도 ────────────────────────────
type Case = { name: string; ledger: LedgerRow[]; include: boolean; expect: RefundResult };

function runSelftest(): number {
  const cases: Case[] = [
    {
      name: '1. 순수 유상만',
      ledger: [{ delta: 1000, reason: 'purchase', ref: 'dia_1000' }],
      include: false,
      expect: { purchasedTotal: 1000, purchasedRemaining: 1000, balance: 1000 },
    },
    {
      name: '2. 무상 우선 소진(유상 500 + 무상 300, 소비 400 → 무상 300 먼저)',
      ledger: [
        { delta: 500, reason: 'purchase', ref: 'dia_500' },
        { delta: 300, reason: 'ad', ref: 'ssv1' },
        { delta: -400, reason: 'camp', ref: 'p1:spike' },
      ],
      include: false,
      // free 300 소진 → 나머지 100 유상 차감 → 유상 잔여 400. balance 400.
      expect: { purchasedTotal: 500, purchasedRemaining: 400, balance: 400 },
    },
    {
      name: '3. 환불 회수 후(유상 1000, refund 400 클로백)',
      ledger: [
        { delta: 1000, reason: 'purchase', ref: 'dia_1000' },
        { delta: -400, reason: 'refund', ref: 'dia_1000' },
      ],
      include: false,
      expect: { purchasedTotal: 1000, purchasedRemaining: 600, balance: 600 },
    },
    {
      name: '4. 부채 유저(유상 1000, 소비 1000, refund 1000 → 잔액 -1000)',
      ledger: [
        { delta: 1000, reason: 'purchase', ref: 'dia_1000' },
        { delta: -1000, reason: 'camp', ref: 'p2:block' },
        { delta: -1000, reason: 'refund', ref: 'dia_1000' },
      ],
      include: false,
      // 소비 1000: free 0 → 유상 1000 차감(유상 0). refund 1000: 유상 -1000. balance -1000<0 → 유상 잔여 0.
      expect: { purchasedTotal: 1000, purchasedRemaining: 0, balance: -1000 },
    },
  ];

  let pass = 0;
  for (const c of cases) {
    const got = computeUserRefund(c.ledger, c.include);
    const ok =
      got.purchasedTotal === c.expect.purchasedTotal &&
      got.purchasedRemaining === c.expect.purchasedRemaining &&
      got.balance === c.expect.balance;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name}\n      기대 total=${c.expect.purchasedTotal} 유상잔여=${c.expect.purchasedRemaining} 잔액=${c.expect.balance}` +
        `\n      실제 total=${got.purchasedTotal} 유상잔여=${got.purchasedRemaining} 잔액=${got.balance}`,
    );
    if (ok) pass++;
  }

  // A/B 민감도 ① — 샌드박스 유상 지급은 기본 제외, --include-sandbox 시 포함(플래그가 결과를 실제로 바꾼다).
  const sbLedger: LedgerRow[] = [
    { delta: 700, reason: 'purchase', ref: 'dia_700:sandbox' }, // 테스터 지급
    { delta: 300, reason: 'purchase', ref: 'dia_300' }, // 실구매
  ];
  const excl = computeUserRefund(sbLedger, false);
  const incl = computeUserRefund(sbLedger, true);
  const abSandbox = excl.purchasedRemaining === 300 && incl.purchasedRemaining === 1000;
  console.log(
    `${abSandbox ? 'PASS' : 'FAIL'}  A/B① 샌드박스 제외/포함 민감도` +
      `  제외=${excl.purchasedRemaining}(기대 300) · 포함=${incl.purchasedRemaining}(기대 1000)`,
  );
  if (abSandbox) pass++;

  // A/B 민감도 ② — "무상 우선 소진"이 load-bearing임을 증명: 만약 유상 우선 소진이라면 케이스2 유상잔여=100이 됐을 것.
  //   같은 원장을 유상 우선(구로직 재현)으로 계산해 다른 값(100)이 나옴을 보여, 규칙이 결과를 좌우함을 확인.
  const c2 = cases[1].ledger;
  const spendPurchasedFirst = (() => {
    let purchased = 0, free = 0;
    for (const r of c2) {
      if (r.delta > 0) r.reason === 'purchase' ? (purchased += r.delta) : (free += r.delta);
      else {
        let amt = -r.delta;
        const useP = Math.min(purchased, amt); // 유상 먼저(구로직 변이)
        purchased -= useP; amt -= useP;
        if (amt > 0) free -= amt;
      }
    }
    return purchased;
  })();
  const abOrder = spendPurchasedFirst === 100 && computeUserRefund(c2, false).purchasedRemaining === 400;
  console.log(
    `${abOrder ? 'PASS' : 'FAIL'}  A/B② 소진순서 민감도(무상우선=400 vs 유상우선=${spendPurchasedFirst}) — 400≠${spendPurchasedFirst} 확인`,
  );
  if (abOrder) pass++;

  const total = cases.length + 2;
  console.log(`\n판정: ${pass}/${total} ${pass === total ? 'PASS' : 'FAIL'}`);
  return pass === total ? 0 : 1;
}

// ── DB 리포트(읽기 전용) ──────────────────────────────────────────────────────
async function runReport(includeSandbox: boolean): Promise<number> {
  await import('./_env'); // db import 전 env 주입
  const { db } = await import('../db');
  const { walletLedger, users } = await import('../db/schema');
  const { eq, asc } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');

  // 전체 유저(이 게임) — 시간순 원장 재생.
  const userRows = await db.select({ id: users.id, balance: users.balance }).from(users).where(eq(users.projCode, PROJ_CODE));

  const mask = (id: string) => `${id.slice(0, 4)}…`;
  let sumRemaining = 0, sumPurchasedTotal = 0, refundableUsers = 0;
  const lines: string[] = [];

  for (const u of userRows) {
    const ledger = await db
      .select({ delta: walletLedger.delta, reason: walletLedger.reason, ref: walletLedger.ref })
      .from(walletLedger)
      .where(eq(walletLedger.userId, u.id))
      .orderBy(asc(walletLedger.createdAt));
    if (!ledger.length) continue;
    const res = computeUserRefund(ledger as LedgerRow[], includeSandbox);
    if (res.purchasedTotal === 0 && res.purchasedRemaining === 0) continue; // 유상 이력 없는 순수 무상 유저는 생략
    sumRemaining += res.purchasedRemaining;
    sumPurchasedTotal += res.purchasedTotal;
    if (res.purchasedRemaining > 0) refundableUsers++;
    lines.push(
      `  ${mask(u.id).padEnd(6)}  유상적립 ${String(res.purchasedTotal).padStart(8)}  유상잔여 ${String(res.purchasedRemaining).padStart(8)}  잔액 ${String(res.balance).padStart(8)}`,
    );
  }

  console.log(`\n=== 미사용 유상 다이아 환불 산정 (proj=${PROJ_CODE}, sandbox=${includeSandbox ? '포함' : '제외'}) ===`);
  console.log('  유저ID   유상적립합    유상잔여    잔액');
  console.log(lines.length ? lines.join('\n') : '  (유상 이력 있는 유저 없음)');
  console.log(
    `\n총계: 유상적립합 ${sumPurchasedTotal} · 환불대상 유상잔여 합 ${sumRemaining} · 환불대상 유저 ${refundableUsers}명 / 유상이력 ${lines.length}명`,
  );
  console.log('※ 읽기 전용 리포트 — 실제 환불 지급은 종료 시점에 스토어 절차 + 문의 건별 수동 처리(SHUTDOWN_POLICY §2 D-day 이후).');
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    process.exit(runSelftest());
  }
  const includeSandbox = args.includes('--include-sandbox');
  process.exit(await runReport(includeSandbox));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
