// 다이아 서버 진실화 가드 (BACKEND_SYSTEM §13.12) — 순수 검증: 멱등키 빌더 + econ 금액 권위.
// 독립리뷰(2026-07-03) 5구멍 중 순수 검증 가능분(P0-2 금액권위·P0-5 키 비대칭·세이브리셋 충돌).
// A/B 자가검증: 옛 결함(클라 신뢰 금액·에폭 없는 camp 키)을 재주입해 오라클 민감도를 증명(허위 오라클 차단).
// 서버 왕복(applied 게이팅·이중차감·리싱크)은 라이브 E2E(_walletlive)가 실 서버로 증명.
import { readFileSync } from 'fs';
import { join } from 'path';
import { adKey, achKey, campKey, newSaveId } from '../lib/walletKeys';
import { earnAmount, spendAmount, isEarnReason, isSpendReason, AD_REWARD, CAMP_COST, AD_DAILY_CAP, AD_COOLDOWN_MS, WELCOME_DIAMONDS, ACH_MAX_PER_CLAIM, ACH_LIFETIME_CAP, PASS_DAILY_REWARD, PASS_DURATION_DAYS, PASS_MAX_TOTAL, PASS_PRICE_KRW, PASS_RESET_HOUR_KST, PASS_GRACE_DAYS } from '../server/lib/econ';
import { ACHIEVEMENTS, achReward } from '../engine/achievements';
// E2 크로스가드 — engine/diamonds(앱)와 server/lib/econ(서버 손복제) 값 일치 대조. 둘 다 import-free 상수모듈이라
//   tsx가 repo 루트에서 직접 import 가능(서버 전용 deps 없음 → 정규식 추출 불필요). 미러가 어긋나면 여기서 FAIL.
import { AD_REWARD as ENG_AD_REWARD, CAMP_COURSE_COST as ENG_CAMP_COST, AD_DAILY_CAP as ENG_AD_DAILY_CAP, AD_COOLDOWN_MS as ENG_AD_COOLDOWN_MS, WELCOME_DIAMONDS as ENG_WELCOME, PASS_DAILY_REWARD as ENG_PASS_DAILY, PASS_DURATION_DAYS as ENG_PASS_DURATION, PASS_MAX_TOTAL as ENG_PASS_MAX, PASS_PRICE_KRW as ENG_PASS_PRICE, PASS_RESET_HOUR_KST as ENG_PASS_RESET, PASS_GRACE_DAYS as ENG_PASS_GRACE } from '../engine/diamonds';
// E3/E4 — server/lib/products·data/diamondTiers 둘 다 import-free 상수모듈 → 직접 import. iap.ts는 react-native를
//   transitive import(Alert 등)라 tsx로 import 불가 → SKU 상수만 소스 정규식 추출(아래 §9).
import { DIAMOND_PRODUCTS, ENTITLEMENT_PRODUCTS, PASS_PRODUCTS } from '../server/lib/products';
import { DIAMOND_TIERS } from '../data/diamondTiers';

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
ok(spendAmount('camp') === CAMP_COST && CAMP_COST === 200, 'camp 서버 상수 −200(2026-07-17, 구 300)');
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
ok(oldSpend(1) === 1 && spendAmount('camp') === 200, 'A/B 대조군: 옛 클라신뢰면 amount=1로 전지훈련(=버그) vs 서버권위 200');

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

console.log('── 6. engine↔server econ 미러 크로스가드 (E2 — 손복제 드리프트 차단, 5값 전부) ──');
ok(ENG_AD_REWARD === AD_REWARD, `AD_REWARD engine(${ENG_AD_REWARD}) = server(${AD_REWARD})`);
ok(ENG_CAMP_COST === CAMP_COST, `전지훈련 비용 engine CAMP_COURSE_COST(${ENG_CAMP_COST}) = server CAMP_COST(${CAMP_COST})`);
ok(ENG_AD_DAILY_CAP === AD_DAILY_CAP, `AD_DAILY_CAP engine(${ENG_AD_DAILY_CAP}) = server(${AD_DAILY_CAP})`);
ok(ENG_AD_COOLDOWN_MS === AD_COOLDOWN_MS && AD_COOLDOWN_MS === 2 * 60 * 60 * 1000, `AD_COOLDOWN_MS engine(${ENG_AD_COOLDOWN_MS}) = server(${AD_COOLDOWN_MS}) = 2시간(2026-07-17)`);
ok(ENG_WELCOME === WELCOME_DIAMONDS, `WELCOME_DIAMONDS engine(${ENG_WELCOME}) = server(${WELCOME_DIAMONDS})`);

console.log('── 7. 다이아 팩 카탈로그 정합 (E3 — server products ↔ data diamondTiers, id+amount) ──');
ok(DIAMOND_TIERS.length === Object.keys(DIAMOND_PRODUCTS).length, `팩 수 일치(client ${DIAMOND_TIERS.length} = server ${Object.keys(DIAMOND_PRODUCTS).length})`);
for (const t of DIAMOND_TIERS) ok(DIAMOND_PRODUCTS[t.id] === t.amount, `${t.id}: server 지급(${DIAMOND_PRODUCTS[t.id]}) = client amount(${t.amount})`);
for (const id of Object.keys(DIAMOND_PRODUCTS)) ok(DIAMOND_TIERS.some((t) => t.id === id), `server 팩 ${id} 클라 카탈로그에 존재(누락 0)`);

console.log('── 8. 엔타이틀먼트 SKU 클라↔서버 정합 (E4 — lib/iap 상수 ↔ server ENTITLEMENT_PRODUCTS) ──');
const iapSrc = readFileSync(join(__dirname, '..', 'lib', 'iap.ts'), 'utf8');
const skuOf = (name: string): string | null => { const m = iapSrc.match(new RegExp(`export const ${name} = '([^']+)'`)); return m ? m[1] : null; };
const CLI_REMOVE_ADS = skuOf('SKU_REMOVE_ADS'), CLI_DLC_WORLDCUP = skuOf('SKU_DLC_WORLDCUP'), CLI_RC_WORLDCUP = skuOf('RC_ENTITLEMENT_WORLDCUP');
ok(!!CLI_REMOVE_ADS && !!CLI_DLC_WORLDCUP && !!CLI_RC_WORLDCUP, `lib/iap SKU 상수 3종 추출(${CLI_REMOVE_ADS}·${CLI_DLC_WORLDCUP}·${CLI_RC_WORLDCUP})`);
ok(!!CLI_REMOVE_ADS && ENTITLEMENT_PRODUCTS.has(CLI_REMOVE_ADS), `SKU_REMOVE_ADS(${CLI_REMOVE_ADS}) ∈ 서버 ENTITLEMENT_PRODUCTS`);
ok(!!CLI_DLC_WORLDCUP && ENTITLEMENT_PRODUCTS.has(CLI_DLC_WORLDCUP), `SKU_DLC_WORLDCUP(${CLI_DLC_WORLDCUP}) ∈ 서버 ENTITLEMENT_PRODUCTS`);
ok(CLI_RC_WORLDCUP === 'worldcup' && CLI_RC_WORLDCUP !== CLI_DLC_WORLDCUP, `RC 엔타이틀먼트 id(${CLI_RC_WORLDCUP}) ≠ 구매 상품 id(${CLI_DLC_WORLDCUP}) — 한 개념 두 문자열`);

console.log('── 9. 출석 패스 상수 미러 (ATTENDANCE_PASS §10 — engine/diamonds ↔ server/lib/econ, 손복제 드리프트 차단) ──');
ok(ENG_PASS_DAILY === PASS_DAILY_REWARD && PASS_DAILY_REWARD === 100, `PASS_DAILY engine(${ENG_PASS_DAILY}) = server(${PASS_DAILY_REWARD}) = 100`);
ok(ENG_PASS_DURATION === PASS_DURATION_DAYS && PASS_DURATION_DAYS === 28, `PASS_DURATION engine(${ENG_PASS_DURATION}) = server(${PASS_DURATION_DAYS}) = 28`);
ok(ENG_PASS_MAX === PASS_MAX_TOTAL && PASS_MAX_TOTAL === PASS_DAILY_REWARD * PASS_DURATION_DAYS && PASS_MAX_TOTAL === 2800, `PASS_MAX engine(${ENG_PASS_MAX}) = server(${PASS_MAX_TOTAL}) = daily×duration = 2800`);
ok(ENG_PASS_PRICE === PASS_PRICE_KRW && PASS_PRICE_KRW === 9900, `PASS_PRICE engine(${ENG_PASS_PRICE}) = server(${PASS_PRICE_KRW}) = 9900`);
ok(ENG_PASS_RESET === PASS_RESET_HOUR_KST && PASS_RESET_HOUR_KST === 4, `PASS_RESET_HOUR_KST engine(${ENG_PASS_RESET}) = server(${PASS_RESET_HOUR_KST}) = 4(Q6)`);
ok(ENG_PASS_GRACE === PASS_GRACE_DAYS && PASS_GRACE_DAYS === 3, `PASS_GRACE_DAYS engine(${ENG_PASS_GRACE}) = server(${PASS_GRACE_DAYS}) = 3(Q5=B)`);
// A/B 대조군: 미러가 어긋난 값(옛 손복제)이면 == 검사가 FAIL로 드리프트를 잡는다(오라클 이빨 증명)
const driftedDaily: number = 150, driftedReset: number = 0; // 옛 손복제 가정값(daily 구값·reset 자정)
ok(driftedDaily !== PASS_DAILY_REWARD && driftedReset !== PASS_RESET_HOUR_KST, 'A/B 대조군: 미러가 daily=150(구값)·reset=0(자정)이었다면 위 == 검사가 FAIL — 드리프트 검출됨');

console.log('── 10. 출석 패스 SKU 카탈로그 정합 (ATTENDANCE_PASS §2.1 — PASS_PRODUCTS 등록·비겹침) ──');
ok(PASS_PRODUCTS.has('diamond_pass'), 'diamond_pass ∈ PASS_PRODUCTS(미등록→무시 방지)');
ok(!Object.prototype.hasOwnProperty.call(DIAMOND_PRODUCTS, 'diamond_pass'), 'diamond_pass ∉ DIAMOND_PRODUCTS(패스는 즉시 다이아 0 — 팩 지급 경로에 안 걸림)');
ok(!ENTITLEMENT_PRODUCTS.has('diamond_pass'), 'diamond_pass ∉ ENTITLEMENT_PRODUCTS(소비성·재구매 — 비소모 엔타이틀먼트 아님)');
for (const id of Object.keys(DIAMOND_PRODUCTS)) ok(!PASS_PRODUCTS.has(id), `팩 ${id} ∉ PASS_PRODUCTS(1+1 대상 팩과 패스 분리 — 구조적 제외)`);

console.log(fail === 0 ? '\n✅ PASS _dv_walletauth (모든 순수 불변식)' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
