// 드리프트 원인 분리 — box 경로 vs 레거시 production 경로의 포지션별 세트당 생산 A/B.
// 문서값(OP톱 5.3·MB블록 0.5·세터어시 12·리베로디그 4.7)은 구 production(simStatRecord) 경로 측정.
// 같은 시드·명단으로 두 경로를 나란히 재서, 드리프트가 "경로 차이(box≠prod)"인지 "내 정규화 오류"인지 가린다.
//   - 레거시 prod가 문서값에 가깝고 box가 멀면 → 통계 단일화로 문서 stale(경로 드리프트).
//   - 둘 다 문서와 멀면 → 내 정규화/정의가 문서와 다른 것(드리프트 아님).
// 사용: npx tsx tools/_dv_drift_ab.ts [경기수=1500]
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';
import type { BoxSink, BoxLine } from '../engine/rally';
import type { Position } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '1500', 10);
const teams = LEAGUE.teams.map((t) => t.id);
const pairs: [string, string][] = [];
for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) pairs.push([teams[i], teams[j]]);
const posOf = new Map<string, Position>();
const teamOf = new Map<string, string>();
for (const t of teams) for (const p of availableTeamPlayers(t, 0)) { posOf.set(p.id, p.position); teamOf.set(p.id, t); }

const boxAgg = new Map<string, BoxLine>();
const prodAgg = new Map<string, any>();
const teamSets = new Map<string, number>();
let totalSets = 0;
let s = 0;
for (let m = 0; m < N; m++) {
  const [ta, tb] = pairs[m % pairs.length];
  const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
  const base = { home: coachInfoOf(ta), away: coachInfoOf(tb) } as any;
  const box: BoxSink = new Map();
  const sim = simulateMatch(++s, A, B, { ...base, box });
  const ns = sim.setScores.length;
  totalSets += ns;
  teamSets.set(ta, (teamSets.get(ta) ?? 0) + ns);
  teamSets.set(tb, (teamSets.get(tb) ?? 0) + ns);
  for (const [id, l] of box) { const c = boxAgg.get(id); if (!c) boxAgg.set(id, { ...l }); else for (const k of Object.keys(l) as (keyof BoxLine)[]) c[k] += l[k]; }
  const prod = attributeProduction(sim, A, B, s); // 레거시(box 미주입) 경로
  for (const [id, l] of prod) { const c = prodAgg.get(id) ?? {}; for (const k of Object.keys(l)) c[k] = (c[k] ?? 0) + (l as any)[k]; prodAgg.set(id, c); }
}
const setTeams = totalSets * 2;

// box 지표
const boxPts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce;
function boxPosSum(p: Position, metric: (l: BoxLine) => number) { let x = 0; for (const [id, l] of boxAgg) if (posOf.get(id) === p) x += metric(l); return x; }
// prod 지표(production ProdLine: points/blocks/assists/digs)
function prodPosSum(p: Position, metric: (l: any) => number) { let x = 0; for (const [id, l] of prodAgg) if (posOf.get(id) === p) x += metric(l); return x; }

// 톱OP 세트당(팀별 정규화 평균)
function topOpPerSet(get: (id: string) => number) {
  const top = new Map<string, { id: string; v: number }>();
  const ids = new Set([...boxAgg.keys(), ...prodAgg.keys()]);
  for (const id of ids) { if (posOf.get(id) !== 'OP') continue; const t = teamOf.get(id)!; const v = get(id); const cur = top.get(t); if (!cur || v > cur.v) top.set(t, { id, v }); }
  let sum = 0, n = 0;
  for (const [t, { id }] of top) { sum += get(id) / (teamSets.get(t) ?? 1); n++; }
  return sum / n;
}
const boxGetPts = (id: string) => boxAgg.has(id) ? boxPts(boxAgg.get(id)!) : 0;
const prodGetPts = (id: string) => prodAgg.has(id) ? (prodAgg.get(id).points ?? 0) : 0;

const rows = [
  { name: 'OP 톱 득점', doc: 5.3, box: topOpPerSet(boxGetPts), prod: topOpPerSet(prodGetPts) },
  { name: 'MB 블록(1인)', doc: 0.5, box: boxPosSum('MB', (l) => l.blockPt) / (setTeams * 2), prod: prodPosSum('MB', (l) => l.blocks ?? 0) / (setTeams * 2) },
  { name: '세터 어시', doc: 12, box: boxPosSum('S', (l) => l.assist) / setTeams, prod: prodPosSum('S', (l) => l.assists ?? 0) / setTeams },
  { name: '리베로 디그', doc: 4.7, box: boxPosSum('L', (l) => l.digSucc) / setTeams, prod: prodPosSum('L', (l) => l.digs ?? 0) / setTeams },
];
log(`A/B 경로 대조 — box(게임 단일진실) vs 레거시 prod(문서 측정 경로) · ${N}경기 · 총세트 ${totalSets}\n`);
log(`지표                  문서값    box실측   prod실측   box-문서   prod-문서`);
for (const r of rows) {
  log(`${r.name.padEnd(18)} ${r.doc.toFixed(2).padStart(7)} ${r.box.toFixed(2).padStart(9)} ${r.prod.toFixed(2).padStart(9)}  ${(r.box - r.doc >= 0 ? '+' : '') + (r.box - r.doc).toFixed(2)}     ${(r.prod - r.doc >= 0 ? '+' : '') + (r.prod - r.doc).toFixed(2)}`);
}
log(`\n해석: prod가 문서에 가까우면 = 통계단일화로 문서 stale(경로 드리프트). 둘 다 멀면 = 정규화 정의차.`);
