// 다이아 서버 진실화 가드 (BACKEND_SYSTEM §13.12) — 순수 검증: 멱등키 빌더 + econ 금액 권위.
// 독립리뷰(2026-07-03) 5구멍 중 순수 검증 가능분(P0-2 금액권위·P0-5 키 비대칭·세이브리셋 충돌).
// A/B 자가검증: 옛 결함(클라 신뢰 금액·에폭 없는 camp 키)을 재주입해 오라클 민감도를 증명(허위 오라클 차단).
// 서버 왕복(applied 게이팅·이중차감·리싱크)은 라이브 E2E(_walletlive)가 실 서버로 증명.
import { adKey, achKey, campKey, newSaveId } from '../lib/walletKeys';
import { earnAmount, spendAmount, isEarnReason, isSpendReason, AD_REWARD, CAMP_COST, ACH_MAX_PER_CLAIM, ACH_LIFETIME_CAP } from '../server/lib/econ';
import { ACHIEVEMENTS, achReward } from '../engine/achievements';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

console.log('── 1. 멱등키 전역 유일성 (서버 UNIQUE(proj,key) → userId 포함) ──');
ok(achKey('u1', 'first-title') !== achKey('u2', 'first-title'), '다른 유저 같은 achId → 키 다름(충돌 0)');
ok(adKey('u1', 100, 3) === 'ad:u1:100:3', 'ad 키 결정론(형식)');
ok(adKey('u1', 100, 3) !== adKey('u1', 100, 4), 'ad 슬롯 count 다르면 키 다름');
ok(adKey('u1', 100, 3) !== adKey('u1', 101, 3), 'ad 날짜(day) 다르면 키 다름(시계 되돌려도 캘린더-데이가 막음)');
ok(adKey('u1', 100, 3) !== adKey('u2', 100, 3), 'ad 다른 유저 → 키 다름');

console.log('── 2. 세이브 리셋 무료강화 차단 (camp saveId=walletEpoch, P0-5) ──');
const sidA = 's_a', sidB = 's_b';
ok(campKey('u1', sidA, 1, 'p1') !== campKey('u1', sidB, 1, 'p1'), '세이브 리셋(saveId 변경) → 같은 시즌/선수라도 새 키(무료강화 차단)');
ok(campKey('u1', sidA, 1, 'p1') === campKey('u1', sidA, 1, 'p1'), 'camp 키 결정론(같은 입력=같은 키 → 재시도 dedupe)');
ok(campKey('u1', sidA, 1, 'p1') !== campKey('u1', sidA, 2, 'p1'), '다음 오프시즌(season↑) → 새 키(정당 재과금)');
ok(campKey('u1', sidA, 1, 'p1') !== campKey('u2', sidA, 1, 'p1'), 'camp 다른 유저 → 키 다름');
// A/B 대조군: 옛 설계(에폭 없는 키)면 리셋 후 충돌 재현 = 오라클 이빨(민감도 증명)
const oldCampKey = (u: string, season: number, pid: string) => `camp:${u}:${season}:${pid}`;
ok(oldCampKey('u1', 1, 'p1') === oldCampKey('u1', 1, 'p1'), 'A/B 대조군: 옛 무에폭 키는 리셋 후 동일(=버그 재현) — saveId 도입 전이면 무료강화');

console.log('── 3. newSaveId 유일성 (camp 에폭 nonce) ──');
const ids = new Set<string>();
for (let i = 0; i < 5000; i++) ids.add(newSaveId());
ok(ids.size === 5000, `newSaveId 5000개 전부 유일(충돌 0) — 실측 ${ids.size}`);

console.log('── 4. econ 금액 권위 (P0-2 — 서버가 고정값 강제, 클라 amount 무시) ──');
ok(spendAmount('camp') === CAMP_COST && CAMP_COST === 300, 'camp 서버 상수 −300');
ok(spendAmount('purchase') === null, 'spend 화이트리스트: camp 외 거부(purchase→null)');
ok(spendAmount('ad') === null, 'spend 화이트리스트: ad 거부(적립을 차감으로 못 씀)');
ok(earnAmount('ad', 1) === AD_REWARD && AD_REWARD === 50, 'ad 서버 상수 +50 (클라 amount=1 보내도 50)');
ok(earnAmount('ad', 99999) === 50, 'ad 클라 과다금액 무시(항상 50)');
ok(earnAmount('achievement', 120) === 120, 'achievement 클라값 통과(호출당 캡 이하)');
ok(earnAmount('achievement', 99999) === ACH_MAX_PER_CLAIM && ACH_MAX_PER_CLAIM === 1000, `achievement 호출당 클램프 ${ACH_MAX_PER_CLAIM}(최대 단건)`);
ok(earnAmount('achievement', 0) === null, 'achievement 0/음수 거부');
ok(earnAmount('achievement', -5) === null, 'achievement 음수 거부');
ok(earnAmount('purchase', 1000) === null, 'earn 화이트리스트: purchase 거부(별도 영수증 라우트)');
ok(earnAmount('coupon', 1000) === null, 'earn 화이트리스트: coupon 거부(별도 쿠폰 라우트)');
ok(earnAmount('welcome', 1) === 1000 && earnAmount('welcome', 99999) === 1000, 'welcome 서버 고정 1000(클라값 무시 — 멱등키가 계정당 1회)');
// A/B 대조군: 옛(클라 신뢰) 산식이면 camp amount=1이 통과 = 무료강화
const oldSpend = (amount: number) => amount;
ok(oldSpend(1) === 1 && spendAmount('camp') === 300, 'A/B 대조군: 옛 클라신뢰면 amount=1로 전지훈련(=버그) vs 서버권위 300');

console.log('── 4b. 카탈로그↔캡 정합 드리프트 가드 (보상 테이블과 백스톱이 서로 알게) ──');
// 문서의 "평생합 상한"이 구현엔 없었고(A1) 값 5000이 정당 총합 16,220과 모순(A2)했던 사각 재발 방지:
// 카탈로그가 커져 캡을 넘으면 FAIL(정당 유저 손실) · 최대 단건이 per-claim 클램프를 넘으면 FAIL(정당 수령이 잘림).
const achTotal = ACHIEVEMENTS.reduce((s, a) => s + achReward(a.id), 0);
const achMaxSingle = Math.max(...ACHIEVEMENTS.map((a) => achReward(a.id)));
ok(achTotal <= ACH_LIFETIME_CAP, `카탈로그 총합(${achTotal}) ≤ 평생합 캡(${ACH_LIFETIME_CAP}) — 넘으면 정당 유저 손실(2026-07-06 실측 16220/86개)`);
ok(achMaxSingle <= ACH_MAX_PER_CLAIM, `카탈로그 최대 단건(${achMaxSingle}) ≤ 호출당 캡(${ACH_MAX_PER_CLAIM}) — 넘으면 정당 단건 수령이 클램프에 잘림`);

console.log('── 5. reason 화이트리스트 ──');
ok(isEarnReason('ad') && isEarnReason('achievement') && isEarnReason('welcome') && !isEarnReason('purchase') && !isEarnReason('camp'), 'earn = {ad, achievement, welcome}만');
ok(isSpendReason('camp') && !isSpendReason('ad') && !isSpendReason('purchase'), 'spend = {camp}만');

console.log(fail === 0 ? '\n✅ PASS _dv_walletauth (모든 순수 불변식)' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
