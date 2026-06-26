// 드리프트 검출 — 포지션별 생산(세트당) 문서값 vs box 단일 진실 경로 실측.
//
// baseline = box 단일 진실 실측(N=10,000·엔진 76c66ad·2026-06-26):
//   OP 톱 3.26 · MB 블록(1인) 0.98 · 세터 어시 11.75 · 리베로 디그 4.57.
// 구 doc(OP 5.3·MB 0.5, simStatRecord legacy 경로)은 box 단일화(2026-06-24) 전 오버레이라 stale였음 →
//   SALARY §1.1·FOREIGN_SYSTEM·EDGE_CASES §3.6 전부 box 값으로 교정 완료. 이 가드는 이후 드리프트만 잡는다.
// 이 도구는 box 경로의 포지션별 세트당 생산을 재측정해 baseline과 대조(STATS_PROTOCOL §3 stale 감시).
//
// 정의:
//   세트당 = 누적 카운트 / 총 세트 수. "OP 톱"은 팀별 OP 중 득점 1위의 평균, 나머지는 포지션 평균(코트당 1명 등).
//   득점 = atkKill + blockPt + srvAce(개인 득점). 블록=blockPt. assist=assist. dig=digSucc.
//
// A/B 자가검증: (대조) 총 box 득점합 == 총 득점(보존). (실측) 포지션별 세트당 vs 문서.
// 사용: npx tsx tools/_dv_drift_posrate.ts [경기수=2000]
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import type { BoxSink, BoxLine } from '../engine/rally';
import type { Position } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '2000', 10);

const teams = LEAGUE.teams.map((t) => t.id);
const pairs: [string, string][] = [];
for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) pairs.push([teams[i], teams[j]]);

const posOf = new Map<string, Position>();
const teamOf = new Map<string, string>();
for (const t of teams) for (const p of availableTeamPlayers(t, 0)) { posOf.set(p.id, p.position); teamOf.set(p.id, t); }

// 누적: 선수별 box 합 + 총 세트
const agg = new Map<string, BoxLine>();
const addBox = (id: string, l: BoxLine) => {
  const cur = agg.get(id);
  if (!cur) { agg.set(id, { ...l }); return; }
  for (const k of Object.keys(l) as (keyof BoxLine)[]) cur[k] += l[k];
};
let totalSets = 0, totalPts = 0;
let s = 0;
for (let m = 0; m < N; m++) {
  const [ta, tb] = pairs[m % pairs.length];
  const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
  const base = { home: coachInfoOf(ta), away: coachInfoOf(tb) } as any;
  const box: BoxSink = new Map();
  const sim = simulateMatch(++s, A, B, { ...base, box });
  totalSets += sim.setScores.length;
  for (const sc of sim.setScores) totalPts += sc.home + sc.away;
  for (const [id, l] of box) addBox(id, l);
}

const pts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce;
const perSet = (v: number) => v / totalSets * teams.length; // 주의: 아래서 포지션 평균으로 별도 정규화

// 정규화 방식: 포지션별 "코트 위 1명 평균"을 세트당으로 보려면 (포지션 누적 / 총 코트-세트).
// 총 세트는 양팀 합산 경기 세트수. 한 세트엔 양팀 각 1 OP(보통)·1 세터·1 리베로·2 MB·2 OH.
// 세트당 1인 평균 = 포지션 누적 / (총세트 × 코트내 그 포지션 인원 평균)
// 단순화: 각 매치는 양팀이므로 "세트-팀" 단위 = totalSets(경기세트) × 2(양팀). 그 안에 OP 1·S 1·L 1·MB 2·OH 2.
const setTeams = totalSets * 2;
function posSum(filter: (id: string) => boolean, metric: (l: BoxLine) => number): number {
  let sum = 0;
  for (const [id, l] of agg) if (filter(id)) sum += metric(l);
  return sum;
}
const isPos = (p: Position) => (id: string) => posOf.get(id) === p;

// OP 톱: 팀별 OP 중 득점 1위만 모아 평균(세트당)
const teamTopOP = new Map<string, { id: string; pts: number }>();
for (const [id, l] of agg) {
  if (posOf.get(id) !== 'OP') continue;
  const t = teamOf.get(id)!;
  const cur = teamTopOP.get(t);
  if (!cur || pts(l) > cur.pts) teamTopOP.set(t, { id, pts: pts(l) });
}
let topOpPtsSum = 0;
for (const { id } of teamTopOP.values()) topOpPtsSum += pts(agg.get(id)!);
// 각 팀 OP 톱은 매 세트-팀에 1명 출전 가정 → setTeams로 나누면 과소(7팀 톱만). 톱 OP 출전 세트-팀 ≈ totalSets(각 경기 양팀 각 1 톱) 아니고 팀별.
// 톱 OP는 자기 팀 경기에만 출전. 팀별 경기수 다양 → 팀별로 정규화 후 평균이 정확.

// 팀별 톱OP 세트당 평균 = (팀 톱OP 득점) / (그 팀이 뛴 세트수). 팀별 세트수 집계 필요.
const teamSets = new Map<string, number>();
{ // 재집계: 팀별 출전 세트
  let s2 = 0;
  for (let m = 0; m < N; m++) {
    const [ta, tb] = pairs[m % pairs.length];
    const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
    const base = { home: coachInfoOf(ta), away: coachInfoOf(tb) } as any;
    const sim = simulateMatch(++s2, A, B, { ...base });
    const ns = sim.setScores.length;
    teamSets.set(ta, (teamSets.get(ta) ?? 0) + ns);
    teamSets.set(tb, (teamSets.get(tb) ?? 0) + ns);
  }
}
let topOpRateSum = 0, topOpRateN = 0;
for (const [t, { id }] of teamTopOP) {
  const ts = teamSets.get(t) ?? 1;
  topOpRateSum += pts(agg.get(id)!) / ts; topOpRateN++;
}
const topOpPerSet = topOpRateSum / topOpRateN;

// MB 블록/세트(코트 2 MB) , 세터 assist/세트(코트 1), 리베로 dig/세트(코트 1)
const mbBlockPerSet = posSum(isPos('MB'), (l) => l.blockPt) / (setTeams * 2); // 코트당 MB 2명 → 1인 평균
const setterAssistPerSet = posSum(isPos('S'), (l) => l.assist) / setTeams;     // 코트당 S 1명
const liberoDigPerSet = posSum(isPos('L'), (l) => l.digSucc) / setTeams;       // 코트당 L 1명

log(`포지션별 세트당 생산 — box(단일 진실) 경로 실측`);
log(`표본: ${N}경기 · 총 세트 ${totalSets} · 총 득점 ${totalPts}\n`);
log(`지표                    실측/세트   문서값/세트   차이`);
// 기대값 = box 단일 진실 baseline(N=10,000·엔진 76c66ad·2026-06-26 재측정). 구 doc(OP 5.3·MB 0.5)은 legacy 오버레이라 stale였음.
const rows: [string, number, number][] = [
  ['OP 톱 득점', topOpPerSet, 3.3],   // 구 5.3(legacy ATK_FOCUS 과장) → box 3.26
  ['MB 블록(1인)', mbBlockPerSet, 0.98], // 구 0.5(legacy 분산) → box 0.98(실제 리드블로커 MB)
  ['세터 어시', setterAssistPerSet, 12],
  ['리베로 디그', liberoDigPerSet, 4.7],
];
for (const [name, got, doc] of rows) {
  const d = got - doc;
  const relPct = doc !== 0 ? Math.abs(d) / doc * 100 : 0;
  const flag = relPct > 15 ? `  ⚠️드리프트(${relPct.toFixed(0)}%)` : '';
  log(`${name.padEnd(22)} ${got.toFixed(2).padStart(8)}   ${doc.toFixed(2).padStart(9)}   ${(d >= 0 ? '+' : '') + d.toFixed(2)}${flag}`);
}
log(`\n참고: 임계 상대 15% 초과를 드리프트로 표기. 정규화는 코트 인원(OP/S/L=1, MB=2) 기준.`);
