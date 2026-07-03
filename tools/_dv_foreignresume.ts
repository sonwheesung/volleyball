// 외국인 이력 검증 (FOREIGN_SYSTEM §9) — 포텐 미참조·티어 단조·결정론·성적↔현재 상관·저장무.
import { createRng } from '../engine/rng';
import { makePlayer } from '../data/seed';
import { foreignResume, foreignRecordStats } from '../data/foreignResume';
import { overall } from '../engine/overall';
import type { Position, TrainableStat } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const rng = createRng(20260703);
const POS: Position[] = ['OP', 'OH', 'MB', 'S', 'L'];
const N = 20000;
const ps = Array.from({ length: N }, (_, i) => makePlayer(rng, `fr-${i}`, POS[i % 5], true, 23 + (i % 9), undefined));

console.log('── 포텐 미참조: 숨은 포텐 바꿔도 이력 완전 불변(용병은 포텐 게임 아님) ──');
let leak = 0;
for (const p of ps.slice(0, 4000)) {
  const pMax = { ...p, potential: Object.fromEntries(Object.keys(p.potential).map((k) => [k, 99])) as Record<TrainableStat, number> };
  for (const rv of [0.1, 0.5, 0.92]) if (JSON.stringify(foreignResume(p, rv)) !== JSON.stringify(foreignResume(pMax, rv))) { leak++; break; }
}
ok(leak === 0, `숨은 포텐 변경이 이력에 누출 0 (실측 ${leak})`);

console.log('── 스카우터 = 정보량 티어 단조(reveal↑ → 공개 정보 ⊇) ──');
const c = foreignResume(ps[3], 0.2), a = foreignResume(ps[3], 0.45), s = foreignResume(ps[3], 0.7);
ok(c.stats.length > 0 && a.stats.length > 0 && s.stats.length > 0, '성적은 전 등급 표시(C부터)');
ok(c.caps === null && c.recentForm === null && c.matches === null, 'C등급: 폼·출장·국대 비공개');
ok(a.caps !== null && a.recentForm !== null && a.matches !== null, 'A등급: 폼·출장·국대 공개');
ok(a.awards === null && a.injury === null && a.adapt === null && a.report === null, 'A등급: 수상·부상·적응·리포트 아직 비공개');
ok(s.awards !== null && s.injury !== null && s.adapt !== null && s.report !== null && s.report.length > 0, 'S등급: 수상·부상·적응·리포트 공개');
// 티어 경계
ok(foreignResume(ps[3], 0.34).caps === null && foreignResume(ps[3], 0.35).caps !== null, 'A 경계 0.35');
ok(foreignResume(ps[3], 0.59).injury === null && foreignResume(ps[3], 0.60).injury !== null, 'S 경계 0.60');

console.log('── 성적 ↔ 현재 실력 상관(비례하되 역산불가 노이즈) ──');
const xs = ps.map((p) => overall(p));
const ys = ps.map((p) => { const st = foreignRecordStats(p); return st[0].value; }); // 대표 지표(득점/블록/어시)
const corr = pearson(xs, ys);
console.log(`  corr(현재OVR, 대표성적) = ${corr.toFixed(3)}`);
ok(corr >= 0.3 && corr <= 0.85, `성적은 현재와 비례하되 완전역산 아님 (corr ${corr.toFixed(2)} ∈ [.3,.85])`);

console.log('── 날조 금지: 고정 어휘 + 성격/배경 단어 미출현 ──');
const BANNED = ['성실', '노력파', '근성', '이타', '헌신', '인성'];
let fab = 0;
for (const p of ps.slice(0, 4000)) {
  const r = foreignResume(p, 0.92);
  const txt = [r.recentForm, r.injury, r.adapt, ...(r.awards ?? []), ...(r.report ?? [])].join(' ');
  if (BANNED.some((b) => txt.includes(b))) fab++;
}
ok(fab === 0, `성격/배경 날조 단어 미출현 (위반 ${fab})`);

console.log('── 리포트 ↔ 폼 일관성(모순 금지 — 스모크서 발견한 케이스) ──');
let contradiction = 0;
for (const p of ps.slice(0, 4000)) {
  const r = foreignResume(p, 0.92);
  const rep = (r.report ?? []).join(' ');
  // 폼이 '기복 있음'인데 리포트가 '기복 없이 꾸준'이라 말하면 모순.
  if (r.recentForm === '기복 있음' && rep.includes('기복 없이')) contradiction++;
  if (r.recentForm === '꾸준한 편' && rep.includes('기복이 있는')) contradiction++;
}
ok(contradiction === 0, `리포트가 최근 폼과 모순되지 않음 (모순 ${contradiction})`);

console.log('── 결정론 · 저장무(재계산 일치) ──');
ok(JSON.stringify(foreignResume(ps[9], 0.6)) === JSON.stringify(foreignResume(ps[9], 0.6)), '같은 (선수,reveal) → 동일');
ok(caps200range(), '국가대표 A매치 0~130 범위');

console.log(fail === 0 ? '\n✅ PASS _dv_foreignresume' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);

function caps200range(): boolean {
  return ps.slice(0, 2000).every((p) => { const c = foreignResume(p, 0.5).caps; return c !== null && c >= 0 && c <= 130; });
}
function pearson(a: number[], b: number[]): number {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
}
