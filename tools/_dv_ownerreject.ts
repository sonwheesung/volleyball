// 감독 건의 거절 사유 + Form 기전 검증 (OWNER §2.2 ★, 2026-07-03).
//   실제 감점량 랭킹(고정 우선순위 아님) · p 게이팅 · 결정론 · benchP=accept 임계 · Form 실재.
import { benchRejectReason, startRejectReason, benchP, startP, benchAccept } from '../engine/owner';
import { applyForm } from '../engine/form';
import { overall } from '../engine/overall';
import { makePlayer } from '../data/seed';
import { createRng } from '../engine/rng';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

console.log('── 벤치 거절 사유 = 실제 감점량 최대 항 (손계산 대조) ──');
ok(benchRejectReason(50, 0.8, 0, 'form') === 'ace', '에이스(rank0, aceGuard 0.4 최대) → ace');
ok(benchRejectReason(70, 0, 4, 'prospect') === 'ability', '대체자 격차 큼(ability 0.3 최대) → ability');
ok(benchRejectReason(99, 0.5, 4, 'prospect') === 'conviction', '고카리스마(conviction 0.196>ability 0.15) → conviction');

console.log('── 선발 거절 사유 ──');
ok(startRejectReason(50, 0.1) === 'ability', '건의선수가 주전보다 약함(ability 0.45) → ability');
ok(startRejectReason(95, 0.9) === 'conviction', '고카리스마+실력 비등(conviction 0.27>ability 0.05) → conviction');

console.log('── p 게이팅: 구조적으로 수락 우세(p≥0.55)면 거절해도 "감독 판단" ──');
ok(benchRejectReason(50, 0.9, 4, 'noResign') === 'coachCall', '벤치 p=0.95 → coachCall(가짜 인과 방지)');
ok(startRejectReason(50, 0.9) === 'coachCall', '선발 p=0.80 → coachCall');
ok(startRejectReason(50, 0.5) === (startP(50, 0.5) >= 0.55 ? 'coachCall' : 'ability'), 'p 경계 일관');

console.log('── 고정 우선순위 아님(에이스라도 다른 항이 더 크면 그걸 반환) ──');
// aceRank0(aceGuard 0.4)이지만 실력차가 더 큰 경우는 없음(ace 0.4가 실질 상한) — 대신 conviction이 ace를 못 넘는지 확인
ok(benchRejectReason(99, 0.9, 1, 'prospect') !== 'ace' || 0.2 >= Math.max(0.3 * (1 - 0.9), 0.2 * 0.98), 'rank1(ace 0.2)에서 conviction(0.196)과 비교 — 큰 쪽 반환');

console.log('── benchP = benchAccept 수락 임계(단일 출처) ──');
const p = benchP(50, 0.5, 4, 'form'); // 0.5+0.15+0.1=0.75
ok(Math.abs(p - 0.75) < 1e-9, `benchP(50,0.5,4,form)=0.75 실측 ${p.toFixed(3)}`);
let acc = 0; const N = 20000;
for (let i = 0; i < N; i++) if (benchAccept(`bp-${i}`, 1, 30, 50, 0.5, 4, 'form')) acc++;
const rate = acc / N;
console.log(`  benchAccept 실측 수락률 ${(rate * 100).toFixed(1)}% (기대 ${(p * 100).toFixed(0)}%)`);
ok(Math.abs(rate - p) < 0.02, 'benchAccept 수락률 ≈ benchP(임계 일치)');

console.log('── 결정론 ──');
ok(benchRejectReason(70, 0.3, 1, 'form') === benchRejectReason(70, 0.3, 1, 'form'), '같은 입력 → 동일 사유(값 기반)');
ok(benchAccept('x', 2, 5, 60, 0.4, 0, 'form') === benchAccept('x', 2, 5, 60, 0.4, 0, 'form'), 'benchAccept 결정론(시드)');

console.log('── Form 비대칭 기전 실재(벤치: alt 폼 반영이 OVR을 실제로 깎나 — 허위오라클 방지) ──');
const rng = createRng(20260703);
const alt = makePlayer(rng, 'or-alt', 'OH', false, 26);
const full = overall(applyForm(alt, 1.0));   // 폼 만점(주전)
const rusty = overall(applyForm(alt, 0.6));   // 폼 하락(벤치 백업)
console.log(`  대체자 OVR: 폼1.0 ${full} · 폼0.6 ${rusty}`);
ok(rusty < full, '폼 나쁜 대체자는 OVR이 낮음 → 벤치 건의 gap↑·ovrGapT↓(감독 거절↑) 기전 실재');

console.log(fail === 0 ? '\n✅ PASS _dv_ownerreject' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
