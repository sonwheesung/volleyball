// OP 득점 해석 프로브 — box 단일 진실. 여러 "톱" 해석(팀별톱/리그최고/평균/외인OP) + 시즌·경기 환산.
// 용도: OP/외인 에이스 집중도 밸런스 검토(SALARY §1.1·FOREIGN_SYSTEM 형제 드리프트 follow-up). 회귀 baseline은 _dv_drift_posrate.
// 사용: npx tsx tools/_dv_op_interp.ts [경기수=10000]
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import type { BoxSink, BoxLine } from '../engine/rally';
import type { Position } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '10000', 10);
const teams = LEAGUE.teams.map((t) => t.id);
const pairs: [string, string][] = [];
for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) pairs.push([teams[i], teams[j]]);

const posOf = new Map<string, Position>(), teamOf = new Map<string, string>(), forOf = new Map<string, boolean>();
for (const t of teams) for (const p of availableTeamPlayers(t, 0)) { posOf.set(p.id, p.position); teamOf.set(p.id, t); forOf.set(p.id, !!p.isForeign); }

const agg = new Map<string, BoxLine>();
const add = (id: string, l: BoxLine) => { const c = agg.get(id); if (!c) { agg.set(id, { ...l }); return; } for (const k of Object.keys(l) as (keyof BoxLine)[]) c[k] += l[k]; };
let totalSets = 0; const teamSets = new Map<string, number>();
let s = 0;
for (let m = 0; m < N; m++) {
  const [ta, tb] = pairs[m % pairs.length];
  const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
  const base = { home: coachInfoOf(ta), away: coachInfoOf(tb) } as any;
  const box: BoxSink = new Map();
  const sim = simulateMatch(++s, A, B, { ...base, box });
  const ns = sim.setScores.length; totalSets += ns;
  teamSets.set(ta, (teamSets.get(ta) ?? 0) + ns); teamSets.set(tb, (teamSets.get(tb) ?? 0) + ns);
  for (const [id, l] of box) add(id, l);
}
const pts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce;
const setTeams = totalSets * 2;          // 코트-세트 단위(양팀)
const setsPerMatch = totalSets / N;

// 팀별 OP 톱(득점 1위) 세트당
const topByTeam = new Map<string, { id: string; perSet: number; isF: boolean }>();
for (const [id, l] of agg) {
  if (posOf.get(id) !== 'OP') continue;
  const t = teamOf.get(id)!; const ps = pts(l) / (teamSets.get(t) ?? 1);
  const cur = topByTeam.get(t);
  if (!cur || pts(l) > pts(agg.get(cur.id)!)) topByTeam.set(t, { id, perSet: ps, isF: !!forOf.get(id) });
}
const topVals = [...topByTeam.values()].map((x) => x.perSet);
const teamTopAvg = topVals.reduce((a, b) => a + b, 0) / topVals.length;
const leagueBest = Math.max(...topVals);

// OP 전체 평균(코트 1)
const opSum = [...agg].filter(([id]) => posOf.get(id) === 'OP').reduce((a, [, l]) => a + pts(l), 0);
const opAvgPerSet = opSum / setTeams;
// 외인 전체(아시아쿼터 포함) 세트당 / 외인 OP만
const forSum = [...agg].filter(([id]) => forOf.get(id)).reduce((a, [, l]) => a + pts(l), 0);
const forOpSum = [...agg].filter(([id]) => forOf.get(id) && posOf.get(id) === 'OP').reduce((a, [, l]) => a + pts(l), 0);
const forCnt = new Set([...agg].filter(([id]) => forOf.get(id)).map(([id]) => teamOf.get(id))).size; // 팀수 근사
// 외인 OP 시즌(36경기) 추정 = perSet * setsPerMatch * 36
const forOpPerSet = forOpSum / setTeams; // 코트당 외인 OP ~1

log(`표본 ${N}경기 · 총세트 ${totalSets} · 세트/경기 ${setsPerMatch.toFixed(2)}\n`);
log(`OP 톱 해석별 (세트당 / 경기당 / 시즌36경기):`);
const line = (name: string, perSet: number) =>
  log(`  ${name.padEnd(20)} ${perSet.toFixed(2)}/세트   ${(perSet * setsPerMatch).toFixed(1)}/경기   ${(perSet * setsPerMatch * 36).toFixed(0)}/시즌`);
line('팀별 OP톱 평균', teamTopAvg);
line('리그 최고 OP 1인', leagueBest);
line('OP 전체 평균(코트1)', opAvgPerSet);
line('외인 OP(코트1)', forOpPerSet);
log(`\n외인 전체(아쿼 포함) 세트당 합/팀수: ${(forSum / setTeams).toFixed(2)}/세트-팀`);
log(`문서 대조: SALARY §1.1 "OP 톱 ~5.3/세트(~21/경기)" · FOREIGN_SYSTEM "외인 ~702점/시즌(세트당 ≈6)"`);
log(`팀별 OP톱 isForeign: ${[...topByTeam.values()].filter((x) => x.isF).length}/${topByTeam.size}`);
