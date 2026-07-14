// 타팀 지명 사유 검증 (UI_RULES DL-6 / ③ UX 개선) — 누출0·날조0·reason 정합·결정론.
//   자연 런 수백 픽 전수 + 매핑표 8문장 브랜치 타겟 테스트.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { generateDraftClass } from '../data/draftClass';
import { lotteryRound1, buildDraftOrder, resolveDraft } from '../engine/draft';
import { pickReasonProse } from '../data/draftPickReason';
import { prospectGradeLabel } from '../data/prospectGrade';
import { iGa } from '../lib/josa';
import type { CoachStyle, Player, Position } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

const POS_KO: Record<Position, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };

// 매핑표 8문장(+wish 폴백)의 stem 집합 — 이 밖의 문장이 나오면 날조.
function allowedStems(): Set<string> {
  const s = new Set<string>([
    '특급 유망주는 놓칠 수 없다 — 자리와 무관하게',
    '이상적 구성은 갖췄다 — 미래를 위한 최고 자원 확보',
    '구단이 점찍은 지명',
    '외국인에 기댄 아포짓 — 국내 자원을 키운다',
    '세터 백업 확보',
  ]);
  for (const pos of Object.keys(POS_KO) as Position[]) {
    const k = POS_KO[pos];
    s.add(`주전 ${k}의 세대교체를 대비한 지명`); // "노쇠" 사용자 노출 금지 정정(CLAUDE 5.1 라벨) — 제품 카피 추종(2026-07-14)
    s.add(`${iGa(k)} 얇다 — 즉시 채운다`); // 조사 받침 분기(EC-DR-05)
    s.add(`${k} 백업(뎁스) 확보`);
    s.add(`${k} 자원 보강`);
  }
  return s;
}
const STEMS = allowedStems();

// prose에서 " — {name}, {grade}" 꼬리를 떼어 stem 추출.
function stemOf(prose: string, p: Player, reveal: number): string {
  const tail = ` — ${p.name}, ${prospectGradeLabel(p, reveal)}`;
  return prose.endsWith(tail) ? prose.slice(0, -tail.length) : `__NO_TAIL__(${prose})`;
}

// ── 브랜치 타겟(매핑표 각 문장이 조건에서만 켜짐) ──
console.log('── 매핑표 브랜치 타겟 ──');
const rng0 = createRng(999);
const base = makeProspect(rng0, 'base', 'OH');
const mk = (over: Partial<Player>): Player => ({ ...base, ...over });
const get1 = (roster: Player[]) => (id: string) => roster.find((x) => x.id === id);
function prose(player: Player, reason: 'super' | 'need' | 'best' | 'wish', roster: Player[]): string {
  return pickReasonProse({ player, reason }, roster.map((x) => x.id), get1(roster), 1);
}
// super
ok(stemOf(prose(mk({ id: 'd', position: 'MB' }), 'super', []), mk({ id: 'd', position: 'MB' }), 1) === '특급 유망주는 놓칠 수 없다 — 자리와 무관하게', 'super → BPA 문장(자리 무관)');
// best
ok(stemOf(prose(mk({ id: 'd', position: 'MB' }), 'best', []), mk({ id: 'd', position: 'MB' }), 1) === '이상적 구성은 갖췄다 — 미래를 위한 최고 자원 확보', 'best → 이상 구성 문장');
// OP 외국인 의존
{
  const drafted = mk({ id: 'd', position: 'OP', isForeign: false });
  const roster = [mk({ id: 's1', position: 'OP', isForeign: true, age: 27 })];
  ok(stemOf(prose(drafted, 'need', roster), drafted, 1) === '외국인에 기댄 아포짓 — 국내 자원을 키운다', 'need+OP+주전외국인 → 국내 자원 문장');
}
// 주전 노쇠(OH, age>=30)
{
  const drafted = mk({ id: 'd', position: 'OH' });
  const roster = [mk({ id: 's1', position: 'OH', age: 31 })];
  ok(stemOf(prose(drafted, 'need', roster), drafted, 1) === '주전 아웃사이드의 세대교체를 대비한 지명', 'need+주전노쇠 → 세대교체 대비 문장');
}
// MB 노쇠 임계 28
{
  const drafted = mk({ id: 'd', position: 'MB' });
  const rosterOld = [mk({ id: 's1', position: 'MB', age: 28 })];
  ok(stemOf(prose(drafted, 'need', rosterOld), drafted, 1) === '주전 미들의 세대교체를 대비한 지명', 'MB 주전 28세 → 세대교체(임계 28)');
}
// 얇다(OH 1명 → gap 4)
{
  const drafted = mk({ id: 'd', position: 'OH' });
  const roster = [mk({ id: 's1', position: 'OH', age: 24 })];
  ok(stemOf(prose(drafted, 'need', roster), drafted, 1) === '아웃사이드가 얇다 — 즉시 채운다', 'need+큰 gap → 얇다 문장');
}
// 백업(OP 1명 젊음 → gap 1)
{
  const drafted = mk({ id: 'd', position: 'OP', isForeign: false });
  const roster = [mk({ id: 's1', position: 'OP', isForeign: false, age: 24 })];
  ok(stemOf(prose(drafted, 'need', roster), drafted, 1) === '아포짓 백업(뎁스) 확보', 'need+주전젊음+gap1 → 백업 문장');
}
// 세터 백업 특수 표기(S ideal 3, 2명 젊음 → gap 1)
{
  const drafted = mk({ id: 'd', position: 'S' });
  const roster = [mk({ id: 's1', position: 'S', age: 24 }), mk({ id: 's2', position: 'S', age: 25 })];
  ok(stemOf(prose(drafted, 'need', roster), drafted, 1) === '세터 백업 확보', 'S 백업 → "세터 백업 확보"');
}

// ── 자연 런 전수(수백 픽) — 날조0 + reason 정합 ──
console.log('── 자연 런 전수(날조0·reason 정합) ──');
const STYLES: CoachStyle[] = ['attack', 'defense', 'balanced'];
let picks = 0, fabricated = 0, mismatched = 0, noTail = 0;
for (let season = 1; season <= 30; season++) {
  const rng = createRng(7000 + season);
  const teamIds = Array.from({ length: 7 }, (_, i) => `T${i}`);
  const snapshot: Record<string, Player> = {};
  const rosters: Record<string, string[]> = {};
  const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
  for (const t of teamIds) {
    const ids: string[] = [];
    const rlen = rng.int(8, 16);
    for (let j = 0; j < rlen; j++) {
      const pos = POS[rng.int(0, 4)];
      const pl = { ...makeProspect(rng, `${t}_r${j}`, pos), age: rng.int(19, 34), isForeign: pos === 'OP' && rng.next() < 0.4 };
      snapshot[pl.id] = pl; ids.push(pl.id);
    }
    rosters[t] = ids;
  }
  const cls = generateDraftClass(season, 40);
  const order = buildDraftOrder(lotteryRound1(teamIds, rng), 4);
  const styleOf = (t: string): CoachStyle => STYLES[(t.charCodeAt(1)) % 3];
  const res = resolveDraft(order, cls, rosters, (id) => snapshot[id], '__none__', [], styleOf);
  const clsById = new Map(cls.map((p) => [p.id, p]));
  const getP = (id: string) => snapshot[id] ?? clsById.get(id);
  // 픽 직전 로스터 재구성
  const acc: Record<string, string[]> = {}; for (const k of Object.keys(rosters)) acc[k] = [...rosters[k]];
  for (const s of res.sequence) {
    const player = clsById.get(s.playerId)!;
    const before = [...(acc[s.teamId] ?? [])];
    acc[s.teamId] = [...before, s.playerId];
    const text = pickReasonProse({ player, reason: s.reason }, before, getP, 1);
    const stem = stemOf(text, player, 1);
    picks++;
    if (stem.startsWith('__NO_TAIL__')) { noTail++; continue; }
    if (!STEMS.has(stem)) { fabricated++; if (fabricated <= 3) console.error('    날조:', stem); }
    // reason 정합
    const isSuper = stem === '특급 유망주는 놓칠 수 없다 — 자리와 무관하게';
    const isBest = stem === '이상적 구성은 갖췄다 — 미래를 위한 최고 자원 확보';
    if (s.reason === 'super' && !isSuper) mismatched++;
    if (s.reason === 'best' && !isBest) mismatched++;
    if (s.reason === 'need' && (isSuper || isBest)) mismatched++;
  }
}
console.log(`  전수 픽 ${picks} · 날조 ${fabricated} · reason 모순 ${mismatched} · 꼬리누락 ${noTail}`);
ok(noTail === 0, '모든 사유가 "— 이름, 등급" 꼬리 포함');
ok(fabricated === 0, `매핑표 밖 문장 0건(날조0) — ${fabricated}`);
ok(mismatched === 0, `엔진 reason과 문장 정합(super/best/need) — 모순 ${mismatched}`);

// ── 누출 0: 숨은 포텐 변이 시 사유 불변(reveal 0) ──
console.log('── 누출 0(reveal 0) ──');
{
  const cls = generateDraftClass(5, 40);
  const p = cls[0];
  const pMax = { ...p, potential: Object.fromEntries(Object.keys(p.potential).map((k) => [k, 99])) } as Player;
  const roster = [mk({ id: 's1', position: p.position, age: 31 })];
  const a = pickReasonProse({ player: p, reason: 'need' }, roster.map((x) => x.id), get1(roster), 0);
  const b = pickReasonProse({ player: pMax, reason: 'need' }, roster.map((x) => x.id), get1(roster), 0);
  ok(a === b, `reveal 0: 숨은 포텐 변이 시 사유 문장 불변 (누출 ${a === b ? 0 : 1})`);
}

// ── 결정론 ──
console.log('── 결정론 ──');
{
  const roster = [mk({ id: 's1', position: 'OH', age: 31 })];
  const d = mk({ id: 'd', position: 'OH' });
  ok(prose(d, 'need', roster) === prose(d, 'need', roster), '같은 입력 → 동일 문장');
}

console.log(fail === 0 ? '\n✅ PASS _dv_pickreason' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
