// 커리어 유형 회고 검증 (FA §3.3 4d) — 드래프트 출신 게이트(날조 금지 핵심)·결정론·비율.
import { prospectArc, prospectArcRetro, isDrafteeId } from '../data/seed';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

console.log('── 날조 금지 핵심: 시드(초기) 선수는 아크가 실제 적용 안 됐으니 회고 없음 ──');
// 비드래프티 id(팀 초기선수 형식 `{team}p{i}`) 중 prospectArc가 우연히 non-null인 것들 → 회고는 반드시 null.
let seedArcButNull = 0, seedLeak = 0, checked = 0;
const TEAMS = ['SEOUL', 'INCHEON', 'SUWON', 'GIMCHEON', 'GWANGJU', 'DAEJEON', 'HWASEONG'];
for (const t of TEAMS) for (let i = 0; i < 3000; i++) {
  const id = `${t}p${i}`;
  if (isDrafteeId(id)) continue;
  checked++;
  if (prospectArc(id)) { seedArcButNull++; if (prospectArcRetro(id) !== null) seedLeak++; }
}
console.log(`  비드래프티 ${checked}개 중 prospectArc non-null ${seedArcButNull}개 — 그중 회고 누출 ${seedLeak}`);
ok(seedArcButNull > 100, '테스트 유효성: 비드래프티에도 prospectArc는 값이 나옴(게이트가 진짜 필요)');
ok(seedLeak === 0, '비드래프티는 아크 회고 항상 null(날조 0)');

console.log('── 드래프트 출신은 아크 있으면 회고 노출 ──');
let dArc = 0, dRetro = 0, dTotal = 0;
for (let s = 1; s <= 40; s++) for (let i = 0; i < 80; i++) {
  const id = `d${s}_${i}`;
  dTotal++;
  const a = prospectArc(id);
  if (a) { dArc++; const r = prospectArcRetro(id); if (r) { dRetro++;
    const wantLate = a === 'late_bloomer' && r.includes('대기만성');
    const wantFlash = a === 'flash' && r.includes('즉시전력');
    if (!wantLate && !wantFlash) { console.error('  ✗ 문형 불일치', a, r); fail++; }
  } }
}
const rate = (dArc / dTotal) * 100;
console.log(`  드래프티 ${dTotal}개: 아크 ${dArc}(${rate.toFixed(1)}%) · 회고 노출 ${dRetro}`);
ok(dArc === dRetro, '드래프트 출신은 아크=회고 1:1(누락 0)');
ok(rate >= 4 && rate <= 8, `아크 비율 ~6%(대기만성3+반짝3) — 실측 ${rate.toFixed(1)}%`);

console.log('── 결정론 ──');
ok(prospectArcRetro('d5_10') === prospectArcRetro('d5_10'), '같은 id → 동일');
ok(isDrafteeId('d3_7') && !isDrafteeId('SEOULp3') && !isDrafteeId('d3') && !isDrafteeId('foreign_x'), 'isDrafteeId 형식 판별 정확');

console.log(fail === 0 ? '\n✅ PASS _dv_arcretro' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
