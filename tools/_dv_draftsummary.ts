// 드래프트 종료 요약 검증 (UI_RULES DL-8 / ⑤ UX 개선) — 라운드 완결성·PASS 정합·prefix 불변식·결정론.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { generateDraftClass } from '../data/draftClass';
import { lotteryRound1, buildDraftOrder, resolveDraft, DRAFT_ROUNDS } from '../engine/draft';
import { myDraftSummary } from '../data/draftSummary';
import type { CoachStyle, Player, Position } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
const STYLES: CoachStyle[] = ['attack', 'defense', 'balanced'];

// order+sequence 정렬로 각 픽의 진짜 라운드 산출(팀별 등장 횟수). prefix 불변식 교차검증용 ground truth.
function trueRoundsForTeam(order: string[], sequence: { teamId: string; playerId: string }[], team: string): number[] {
  const cnt: Record<string, number> = {};
  let k = 0;
  const rounds: number[] = [];
  for (const t of order) {
    cnt[t] = (cnt[t] ?? 0) + 1;
    if (k < sequence.length && sequence[k].teamId === t) {
      if (t === team) rounds.push(cnt[t]);
      k++;
    }
  }
  return rounds;
}

let runs = 0, zeroPickSeasons = 0, maxPick = 0;
for (let season = 1; season <= 80; season++) {
  const rng = createRng(4200 + season);
  const teamIds = Array.from({ length: 7 }, (_, i) => `T${i}`);
  const my = teamIds[rng.int(0, 6)];
  const snapshot: Record<string, Player> = {};
  const rosters: Record<string, string[]> = {};
  for (const t of teamIds) {
    const ids: string[] = [];
    const rlen = rng.int(8, 17);
    for (let j = 0; j < rlen; j++) {
      const pos = POS[rng.int(0, 4)];
      const pl = { ...makeProspect(rng, `${t}_r${j}`, pos), age: rng.int(19, 34) };
      snapshot[pl.id] = pl; ids.push(pl.id);
    }
    rosters[t] = ids;
  }
  const cls = generateDraftClass(season, 40);
  const clsById = new Map(cls.map((p) => [p.id, p]));
  const getP = (id: string) => snapshot[id] ?? clsById.get(id);
  const wishlist = rng.next() < 0.5 ? cls.slice(0, rng.int(0, 4)).map((p) => p.id) : [];
  const order = buildDraftOrder(lotteryRound1(teamIds, rng), DRAFT_ROUNDS);
  const styleOf = (t: string): CoachStyle => STYLES[t.charCodeAt(1) % 3];
  const res = resolveDraft(order, cls, rosters, (id) => snapshot[id], my, wishlist, styleOf);

  const sum = myDraftSummary(res.sequence.map((s) => ({ teamId: s.teamId, playerId: s.playerId, reason: s.reason })), my, getP);
  runs++;
  maxPick = Math.max(maxPick, sum.pickCount);
  if (sum.pickCount === 0) zeroPickSeasons++;

  // 라운드 완결성 — 정확히 DRAFT_ROUNDS행, round 1..R
  if (sum.rows.length !== DRAFT_ROUNDS) { ok(false, `season${season}: 행 수 ${sum.rows.length}≠${DRAFT_ROUNDS}`); break; }
  if (!sum.rows.every((r, i) => r.round === i + 1)) { ok(false, `season${season}: 라운드 번호 비정상`); break; }

  // PASS 정합 — pass면 playerId 없음, 아니면 name/grade 있음
  for (const r of sum.rows) {
    if (r.pass && (r.playerId || r.name)) { ok(false, `season${season} R${r.round}: PASS인데 선수 존재`); break; }
    if (!r.pass && (!r.playerId || !r.name || !r.grade)) { ok(false, `season${season} R${r.round}: 지명인데 정보 결손`); break; }
  }

  // prefix 불변식 — 지명(비PASS)이 앞쪽 라운드에 연속(패스 뒤 지명 없음)
  const passIdx = sum.rows.findIndex((r) => r.pass);
  if (passIdx >= 0 && sum.rows.slice(passIdx).some((r) => !r.pass)) { ok(false, `season${season}: PASS 뒤에 지명 존재(prefix 위반)`); break; }
  // pickCount == 비PASS 행 수
  if (sum.pickCount !== sum.rows.filter((r) => !r.pass).length) { ok(false, `season${season}: pickCount 불일치`); break; }

  // ground truth 교차검증 — 내 실제 지명 라운드 == [1..pickCount]
  const gt = trueRoundsForTeam(order, res.sequence, my);
  const expected = Array.from({ length: sum.pickCount }, (_, i) => i + 1);
  if (JSON.stringify(gt) !== JSON.stringify(expected)) { ok(false, `season${season}: 실제 지명 라운드 ${JSON.stringify(gt)}≠prefix ${JSON.stringify(expected)}`); break; }
}
ok(fail === 0, `자연 런 ${runs}시즌: 라운드 완결성·PASS 정합·prefix 불변식 (최대 지명 ${maxPick} · 0지명 시즌 ${zeroPickSeasons})`);

// ── 결정론 ──
console.log('── 결정론 ──');
{
  const seq = [{ teamId: 'A', playerId: 'p1', reason: 'need' as const }, { teamId: 'A', playerId: 'p2', reason: 'best' as const }];
  const cls = generateDraftClass(1, 40);
  const get = (id: string) => (id === 'p1' ? cls[0] : id === 'p2' ? cls[1] : undefined);
  const a = JSON.stringify(myDraftSummary(seq, 'A', get));
  const b = JSON.stringify(myDraftSummary(seq, 'A', get));
  ok(a === b, '같은 입력 → 동일 요약');
}

console.log(fail === 0 ? '\n✅ PASS _dv_draftsummary' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
