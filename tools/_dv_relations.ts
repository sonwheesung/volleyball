// 인간관계망 모델 가드 (RELATIONSHIP_SYSTEM §8) — Phase 1a 순수 모델.
//   npx tsx tools/_dv_relations.ts
// 검증: 결정론·대칭(A,B==B,A)·innate 분포(중립 다수)·외인 제외·포지션 라이벌(−)·bond 단조(+·라이벌 완화)·teamAffinity 범위.
import { resetLeagueBase, LEAGUE, getTeamPlayers } from '../data/league';
import { affinity, innateAffinity, pairKey, BOND_MAX } from '../engine/relationships';
import { teamAffinity, relationsOf } from '../data/relationships';
import type { Player } from '../types';

resetLeagueBase();
let fail = 0;
const check = (n: string, c: boolean) => { process.stdout.write(`${c ? '✅' : '❌'} ${n}\n`); if (!c) fail++; };

// 전 구단 국내 선수 수집
const domestic: Player[] = [];
const foreign: Player[] = [];
for (const t of LEAGUE.teams) for (const p of getTeamPlayers(t.id)) (p.isForeign ? foreign : domestic).push(p);
const byId = new Map(domestic.map((p) => [p.id, p]));

// ── 결정론·대칭 ──
let symOk = true, detOk = true;
for (let i = 0; i < domestic.length; i += 7) for (let j = i + 1; j < domestic.length; j += 11) {
  const a = domestic[i], b = domestic[j];
  if (affinity(a, b) !== affinity(a, b)) detOk = false;
  if (Math.abs(affinity(a, b, 0.1, true) - affinity(b, a, 0.1, true)) > 1e-9) symOk = false;
}
check('결정론(같은 입력 동일)', detOk);
check('대칭 affinity(A,B)==affinity(B,A)', symOk);
check('pairKey 대칭', pairKey('z', 'a') === pairKey('a', 'z'));

// ── innate 분포(중립 다수) ──
let neu = 0, pos = 0, neg = 0, tot = 0;
for (let i = 0; i < domestic.length; i++) for (let j = i + 1; j < domestic.length; j++) {
  const v = innateAffinity(domestic[i].id, domestic[j].id);
  tot++; if (v === 0) neu++; else if (v > 0) pos++; else neg++;
}
const neuPct = neu / tot * 100;
process.stdout.write(`  innate 분포(${tot}쌍): 중립 ${neuPct.toFixed(1)}% · 친구 ${(pos / tot * 100).toFixed(1)}% · 라이벌 ${(neg / tot * 100).toFixed(1)}%\n`);
check('중립 다수(52~68%)', neuPct >= 52 && neuPct <= 68);
check('친구·라이벌 둘 다 존재', pos > 0 && neg > 0);
check('라이벌 ≥ 친구(앙숙 약간 많게)', neg >= pos * 0.9);

// ── 외인 제외 ──
if (foreign.length) {
  check('affinity(외인, 국내)=0', affinity(foreign[0], domestic[0]) === 0);
  check('teamAffinity(외인)=0', teamAffinity(foreign[0].id, LEAGUE.teams[0].id) === 0);
  check('relationsOf(외인) 빈', relationsOf(foreign[0].id).friends.length === 0 && relationsOf(foreign[0].id).rivals.length === 0);
} else check('외인 존재(스킵)', true);

// ── 포지션 라이벌(−): 같은 포지션 쌍 affinity ≤ innate(라이벌 빼기), 다른 포지션 == innate ──
let samePos: [Player, Player] | null = null, diffPos: [Player, Player] | null = null;
for (const t of LEAGUE.teams) {
  const ps = getTeamPlayers(t.id).filter((p) => !p.isForeign);
  for (let i = 0; i < ps.length && (!samePos || !diffPos); i++) for (let j = i + 1; j < ps.length; j++) {
    if (!samePos && ps[i].position === ps[j].position) samePos = [ps[i], ps[j]];
    if (!diffPos && ps[i].position !== ps[j].position) diffPos = [ps[i], ps[j]];
  }
}
if (samePos) {
  const inn = innateAffinity(samePos[0].id, samePos[1].id);
  const aff = affinity(samePos[0], samePos[1], 0, true);
  check('같은 포지션 같은 팀 → affinity ≤ innate(라이벌 −)', aff <= inn + 1e-9 && aff < inn + 0.01);
  check('같은 포지션 라이벌 실제 감점(aff<innate)', aff < inn - 1e-9);
} else check('같은 포지션 쌍(스킵)', true);
if (diffPos) {
  const inn = innateAffinity(diffPos[0].id, diffPos[1].id);
  check('다른 포지션 → affinity==innate(라이벌 없음, bond 0)', Math.abs(affinity(diffPos[0], diffPos[1], 0, true) - inn) < 1e-9);
} else check('다른 포지션 쌍(스킵)', true);

// ── bond 단조(+ · 라이벌 완화) ──
if (samePos) {
  const a0 = affinity(samePos[0], samePos[1], 0, true);
  const aB = affinity(samePos[0], samePos[1], BOND_MAX, true);
  check('bond↑ → affinity↑(우정+라이벌완화)', aB > a0 + 1e-9);
}
if (diffPos) {
  const lo = affinity(diffPos[0], diffPos[1], 0, true);
  const hi = affinity(diffPos[0], diffPos[1], 0.15, true);
  check('bond 단조(다른 포지션)', hi >= lo);
}

// ── teamAffinity 범위 + 부호 sanity ──
let rangeOk = true; const vals: number[] = [];
for (const p of domestic.slice(0, 30)) for (const t of LEAGUE.teams) {
  const v = teamAffinity(p.id, t.id); vals.push(v);
  if (v < -1 - 1e-9 || v > 1 + 1e-9) rangeOk = false;
}
check('teamAffinity ∈ [-1,1]', rangeOk);
check('teamAffinity 양·음 둘 다 발생(±)', vals.some((v) => v > 0.02) && vals.some((v) => v < -0.02));

process.stdout.write(fail === 0 ? '\n✅ ALL PASS\n' : `\n❌ ${fail} FAIL\n`);
process.exit(fail === 0 ? 0 : 1);
