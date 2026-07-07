// 업적 배치 적립 순수 가드 (BACKEND_SYSTEM §4·§13.12) — **DB 불필요**. 실행: cd server && npx tsx tools/_dv_earnbatch.ts
//
// 검증(순수 조각만 — DB 트랜잭션은 _dv_achearn 라이브 가드가 담당):
//  (a) allocateAchGrants: 평생합 캡 baseline(used) + grantedSoFar **누적** 배분
//      · 여유 충분 → 전액 지급(capped:false)  · 경계 → 부분 지급(capped:false)  · 소진 → 지급0(capped:true)
//      · ★핵심: 여러 아이템이 각자 캡을 통과해 **합이 초과**되지 않게 grantedSoFar 누적(누적 빠지면 초과지급=치터)
//  (b) 배치 멱등키 네임스페이스: walletIdemKey(userId, achKey(userId,id))가 userId로 시작(교차유저 선점 차단) + userId별 유일
//
// ⚠ 변이 자가검증(mutant self-check):
//   · allocateAchGrants에서 `- grantedSoFar`를 지우면 (a)-③ 두 아이템 합-초과 케이스가 각자 전액 지급돼 FAIL.
//   · remaining<=0 → capped 분기를 지우면 (a)-④ 소진 케이스가 capped:false로 뒤집혀 FAIL.
//   · walletIdemKey가 userId 프리픽스를 빼면 (b) startsWith 검사가 FAIL.
import { allocateAchGrants, ACH_LIFETIME_CAP } from '../lib/econ';
import { walletIdemKey } from '../lib/walletKey';

let pass = 0;
let total = 0;
const ok = (cond: boolean, msg: string): void => {
  total++;
  if (cond) { pass++; console.log('  ✓', msg); }
  else console.error('  ✗ FAIL:', msg);
};

// achKey 형식 미러(lib/walletKeys.achKey = `ach:<userId>:<achId>`) — 클라가 보내는 idempotencyKey.
const achKey = (userId: string, achId: string): string => `ach:${userId}:${achId}`;

function main(): number {
  // ── (a) 캡 배분 ──
  console.log('── (a) allocateAchGrants — 평생합 캡 누적 배분 ──');

  // ① 여유 충분 → 전액 지급
  const r1 = allocateAchGrants(0, [100, 200, 30]);
  ok(r1.length === 3 && r1[0].grant === 100 && r1[1].grant === 200 && r1[2].grant === 30, '① used=0, [100,200,30] → 전액 지급');
  ok(r1.every((x) => !x.capped), '① 전부 capped:false');

  // ② 순서 보존(results가 items와 1:1)
  ok(r1.map((x) => x.grant).join(',') === '100,200,30', '② 입력 순서 그대로 반환(1:1 매핑)');

  // ③ ★핵심: 두 아이템 합이 캡 초과 → 누적으로 두 번째가 잘림(누적 빠지면 각자 전액 = 초과지급)
  const near = ACH_LIFETIME_CAP - 700; // 남은 헤드룸 700
  const r3 = allocateAchGrants(near, [500, 500]); // 1000 요청, 700만 남음
  ok(r3[0].grant === 500 && r3[0].capped === false, '③ 첫 아이템 500 전액(remaining=700)');
  ok(r3[1].grant === 200 && r3[1].capped === false, '③ 둘째 아이템 200만(remaining=700-500=200 클램프 — grantedSoFar 누적)');
  ok(r3[0].grant + r3[1].grant === 700, '③ 합계 = 남은 헤드룸 700(초과지급 0)');

  // ④ 소진 → 지급0·capped:true
  const r4 = allocateAchGrants(ACH_LIFETIME_CAP, [50, 50]);
  ok(r4[0].grant === 0 && r4[0].capped === true, '④ used=CAP, 첫 아이템 지급0·capped');
  ok(r4[1].grant === 0 && r4[1].capped === true, '④ 둘째도 지급0·capped');

  // ⑤ 경계에서 소진으로 전환: [남은 100 채우는 500, 그 뒤 50] → 100 부분지급 → 0 capped
  const r5 = allocateAchGrants(ACH_LIFETIME_CAP - 100, [500, 50]);
  ok(r5[0].grant === 100 && r5[0].capped === false, '⑤ 첫 아이템 100 부분지급(capped:false — 단건 라우트 applied 의미)');
  ok(r5[1].grant === 0 && r5[1].capped === true, '⑤ 둘째 아이템 소진 후 지급0·capped(409 cap 동의)');

  // ⑥ A/B 자가검증: 누적이 없었다면 ③의 둘째가 500 전액 통과했을 것(오라클 민감도)
  const wouldWithoutAccum = Math.min(500, ACH_LIFETIME_CAP - near); // 누적 무시(used만) = 700 → 500 전액
  ok(wouldWithoutAccum === 500, '⑥-AB[A] 누적 없으면 둘째도 500 전액(버그 재현 경로 — 합 1000 초과지급)');
  ok(r3[1].grant === 200, '⑥-AB[B] 실제는 누적으로 200(=오라클 민감·허위 아님)');

  // ── (b) 배치 멱등키 네임스페이스 ──
  console.log('── (b) 배치 멱등키 userId 네임스페이스(교차유저 선점 차단) ──');
  const u1 = 'user-uuid-1111';
  const u2 = 'user-uuid-2222';
  const k1 = walletIdemKey(u1, achKey(u1, 'first-title'));
  const k2 = walletIdemKey(u2, achKey(u2, 'first-title'));
  ok(k1.startsWith(`${u1}:`), `u1 저장키가 u1로 시작 (실측 ${k1})`);
  ok(k2.startsWith(`${u2}:`), `u2 저장키가 u2로 시작 (실측 ${k2})`);
  ok(k1 !== k2, '같은 achId라도 유저별 저장키 상이(충돌 0)');
  // 공격자가 피해자 userId를 임베드한 클라키를 보내도 저장키는 호출자(서버해석) userId로 시작
  const attackerStored = walletIdemKey(u1, achKey(u2, 'first-title'));
  ok(attackerStored.startsWith(`${u1}:`) && !attackerStored.startsWith(`${u2}:`), '피해자 userId 임베드 클라키도 저장키는 호출자 userId 프리픽스(선점 불가)');
  // 정당 재시도 동일성(dedupe 유지)
  ok(walletIdemKey(u1, achKey(u1, 'x')) === walletIdemKey(u1, achKey(u1, 'x')), '동일 유저+achId 재시도 → 동일 저장키(멱등 dedupe)');

  console.log(pass === total ? `\nEARNBATCH PASS (${pass}/${total})` : `\nEARNBATCH FAIL (${pass}/${total})`);
  return pass === total ? 0 : 1;
}

process.exit(main());
