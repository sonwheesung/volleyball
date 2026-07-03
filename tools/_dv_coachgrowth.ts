// 코치 성장·재생성 검증 (STAFF §8.1 phase②③) — 성장 상한·성과 차등·수렴·엘리트 유입·결정론.
import { coachSeasonGrowth, playerToCoach } from '../engine/staffLifecycle';
import { makePlayer } from '../data/seed';
import { createRng } from '../engine/rng';
import type { Player } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const TC = 7;

console.log('── 성장: 상한(92) 초과 없음 · 성과 차등 · 수렴 ──');
ok(coachSeasonGrowth(91.9, 1, TC) <= 92 && coachSeasonGrowth(60, 1, TC) <= 92, '성장 후에도 ≤92(상한)');
ok(coachSeasonGrowth(60, 1, TC) > 60, '성장분 > 0(배정 코치는 큰다)');
ok(coachSeasonGrowth(60, 1, TC) > coachSeasonGrowth(60, TC, TC), '상위팀(1위) 코치가 하위팀(꼴찌)보다 더 성장(성과 차등)');
// 상한 근처 둔화: 85에서의 성장분 < 60에서의 성장분
ok((coachSeasonGrowth(85, 1, TC) - 85) < (coachSeasonGrowth(60, 1, TC) - 60), '상한 근처 성장 둔화(수렴)');
// 반복 적용 수렴: 상위팀 코치 30시즌 → A대(78~92)로 수렴, 92 초과 없음
let r = 55; for (let i = 0; i < 30; i++) r = Math.round(coachSeasonGrowth(r, 1, TC));
console.log(`  상위팀 코치 30시즌: 55 → ${r}`);
ok(r >= 78 && r <= 92, '상위팀 장기 성장 → A대 도달(78~92), 상한 유지');
let rb = 55; for (let i = 0; i < 30; i++) rb = Math.round(coachSeasonGrowth(rb, TC, TC));
console.log(`  하위팀 코치 30시즌: 55 → ${rb}`);
ok(rb < r, '하위팀 코치는 상위팀보다 낮게 정체(성과 차등 장기 반영)');

console.log('── 재생성: 엘리트 은퇴자 → A급 코치 유입 ──');
const rng = createRng(20260703);
const mk = (vq: number, pos: number, reac: number): Player => ({ ...makePlayer(rng, `g-${vq}-${pos}`, 'OH', false, 34), vq, positioning: pos, reaction: reac });
const eliteR = playerToCoach(mk(95, 92, 90), false).rating; // 최상급 지도자질
const midR = playerToCoach(mk(80, 78, 76), false).rating;
const lowR = playerToCoach(mk(70, 68, 66), false).rating;
console.log(`  코치 전환 역량: 엘리트 ${eliteR} · 중급 ${midR} · 하급 ${lowR}`);
ok(eliteR >= 80, '엘리트 은퇴자 → A급(≥80) 코치 유입(상위 공급 회복)');
ok(eliteR > midR && midR > lowR, '지도자질 높을수록 높은 역량(단조 — 명장 소질 반영)');
ok(playerToCoach(mk(95, 92, 90), true).rating >= playerToCoach(mk(95, 92, 90), false).rating, '레전드 보너스(같은 자질이면 레전드가 ≥)');

console.log('── 결정론 ──');
ok(coachSeasonGrowth(70, 2, TC) === coachSeasonGrowth(70, 2, TC), '성장 값 기반 결정론');
ok(playerToCoach(mk(88, 85, 82), false).rating === playerToCoach(mk(88, 85, 82), false).rating, '전환 역량 결정론(id 시드)');

console.log(fail === 0 ? '\n✅ PASS _dv_coachgrowth' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
