// 드리프트 검출 — KOVO 득점유형 분포: 문서 약속값 vs 코드 실측(box 단일 진실 경로).
//
// 문서(둘 다 동일 수치 인용):
//   docs/SALARY_SYSTEM.md §1.1: "공격킬 57.9% / 스터프 9.0% / 에이스 5.7% / 상대범실 27.4%
//                                (N=2,571경기·44.4만 랠리 — tools/simStatRecord.ts)"
//   docs/KOVO_RULES_COMPARISON.md / CLAUDE.md 10장: 킬~56%·스터프~10%·에이스~6%
// 위 수치는 **production(attributeProduction) 경로**의 자체 난수 귀속으로 측정됐다(simStatRecord).
// 그러나 2026-06-24 통계 단일화로 **게임이 실제 쓰는 단일 진실은 스코어박스(box)**다.
// → STATS_PROTOCOL §3: 측정 경로/엔진 로직이 바뀌면 기존 통계는 재측정 대상.
//   이 도구는 box 경로의 득점유형 분포를 재측정해 문서값과 대조(드리프트 검출).
//
// box 득점유형 귀속: 한 점은 box.atkKill↑면 킬 · box.blockPt↑면 스터프 · how='ace'면 에이스
//   · 셋 다 아니면 상대범실(무귀속). 합계 = 총 득점. → 분포 산출.
// ⚠ 에이스는 box.srvAce가 아니라 **종결유형 how='ace'(노터치 direct)**로 센다(2026-07-06 이원화):
//   box.srvAce는 이제 FIVB 공식 inclusive(direct + 리시브범실 indirect)라 개인 기록용. KOVO '득점유형' 분포에선
//   리시브범실 실점을 '상대범실'로 집계(내부 유형분류=stats/how) — 분포 튜닝 기준을 보존하려 how='ace'만 에이스로.
//
// A/B 자가검증(허위 오라클 차단):
//   (대조) box 유형 합 == 총 득점(home+away points) 이어야(모든 점이 정확히 한 유형). 안 맞으면 도구 결함.
//   (실측) box 분포 vs 문서값 — 차이가 임계(±2%p) 넘으면 드리프트.
// 사용: npx tsx tools/_dv_drift_kovo.ts [경기수=3000]
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import type { BoxSink } from '../engine/rally';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const N = parseInt(process.argv[2] || '3000', 10);

// 여러 팀 매치업으로 표본 다양화(특정 두 팀 편향 방지) — 라운드로빈 일부
const teams = LEAGUE.teams.map((t) => t.id);
const pairs: [string, string][] = [];
for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) pairs.push([teams[i], teams[j]]);

let kill = 0, stuff = 0, ace = 0, oppErr = 0, totalPts = 0, rallyCount = 0;
let s = 0;
let m = 0;
while (m < N) {
  const [ta, tb] = pairs[m % pairs.length];
  const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
  const base = { home: coachInfoOf(ta), away: coachInfoOf(tb) } as any;
  const box: BoxSink = new Map();
  const sim = simulateMatch(++s, A, B, { ...base, box });
  // 총 득점 = 양팀 모든 세트 점수 합
  let pts = 0;
  for (const sc of sim.setScores) pts += sc.home + sc.away;
  totalPts += pts;
  rallyCount += sim.points.length;
  // box 라인 합산(킬·스터프) + 종결유형(에이스=how='ace' direct만) — box.srvAce 대신(위 이원화 주석)
  let k = 0, st = 0, ac = 0;
  for (const [, l] of box) { k += l.atkKill; st += l.blockPt; }
  for (const p of sim.points) if (p.how === 'ace') ac++;
  kill += k; stuff += st; ace += ac;
  oppErr += pts - k - st - ac;
  m++;
}

const pct = (x: number) => (x / totalPts * 100);
log(`KOVO 득점유형 분포 — box(단일 진실) 경로 실측`);
log(`표본: ${N}경기(시드 1..${s}) · 총 득점 ${totalPts} · 랠리(point) ${rallyCount}\n`);
log(`유형        실측%      문서값%    차이(%p)`);
const rows: [string, number, number][] = [
  ['공격킬', pct(kill), 57.9],
  ['스터프', pct(stuff), 9.0],
  ['에이스', pct(ace), 5.7],
  ['상대범실', pct(oppErr), 27.4],
];
let maxDrift = 0;
for (const [name, got, doc] of rows) {
  const d = got - doc;
  if (Math.abs(d) > Math.abs(maxDrift)) maxDrift = d;
  const flag = Math.abs(d) > 2 ? '  ⚠️드리프트' : '';
  log(`${name.padEnd(10)} ${got.toFixed(1).padStart(6)}   ${doc.toFixed(1).padStart(8)}   ${(d >= 0 ? '+' : '') + d.toFixed(1)}${flag}`);
}

// A/B 자가검증
const typeSum = kill + stuff + ace + oppErr;
const conserved = typeSum === totalPts;
log(`\n[A/B 자가검증]`);
log(`  대조(보존): 유형합(${typeSum}) == 총득점(${totalPts})  → ${conserved ? 'PASS' : 'FAIL(도구결함)'}`);
log(`  실측: 위 표 — 임계 ±2%p 초과 시 드리프트 플래그`);
log(`\n최대 드리프트: ${(maxDrift >= 0 ? '+' : '') + maxDrift.toFixed(1)}%p`);
if (!conserved) { log('도구 결함 — 측정 무효'); process.exit(2); }
