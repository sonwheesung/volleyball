// 선수 기록 저장 정합성 검증 — 개인 생산 귀속(attributeProduction)이 내부적으로 일관·결정론·누수
// 없이 저장되는지 전수 검사. (주의: 이 귀속은 SALARY_SYSTEM 1.1 "간이 귀속" — 실제 랠리 참가자가
// 아니라 점수 시퀀스에서 통계적으로 재구성한 값. 본 도구는 그 재구성의 *정합성*을 검증한다.)
//   npx tsx tools/simStatRecord.ts [경기수=2000]
// 불변식:
//   (D) 결정론 — 같은 시드 두 번 → 동일 귀속
//   (L) 팀 누수 없음 — 홈 득점(points)은 홈 코트 선수만·어웨이는 어웨이만, 디그는 반대 진영
//   (C) 보존 — 팀 Σpoints = 그 팀 귀속 득점(킬+블록+에이스), 무귀속(상대범실) = 팀점수 − Σpoints ≥ 0
//   (A) 어시스트 = 스파이크 — 공격 득점당 세터 1어시스트(팀별 Σassists == Σspikes)
//   (G) 디그 = 킬 총량 — 공격 득점 1점당 수비 1디그(전체 Σdigs == 전체 Σspikes)
//   (M) 출전 — 선발은 matches=1

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { attributeProduction, splitLineup, type ProdLine } from '../engine/production';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 2000);
resetLeagueBase();

const ids = LEAGUE.teams.map((t) => t.id);
const squads: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
for (const id of ids) squads[id] = getEvolvedTeamPlayers(id, 0);

let violations = 0;
const fail = (msg: string) => { if (violations < 12) log(`  ❌ ${msg}`); violations++; };

// 분포 누적(정상 케이스 확인용)
let totPts = 0, totSpk = 0, totBlk = 0, totAce = 0, totAst = 0, totDig = 0, totErrPts = 0, totRallies = 0;
let matches = 0;

let seed = 500000;
for (let m = 0; m < N; m++) {
  const hi = ids[m % ids.length];
  const ai = ids[(m * 3 + 1) % ids.length];
  if (hi === ai) continue;
  seed += 13;
  const home = squads[hi], away = squads[ai];
  const sim = simulateMatch(seed, home, away, {});
  const lines = attributeProduction(sim, home, away, seed);

  // (D) 결정론
  const lines2 = attributeProduction(sim, home, away, seed);
  for (const [id, l] of lines) {
    const l2 = lines2.get(id);
    if (!l2 || JSON.stringify(l) !== JSON.stringify(l2)) fail(`결정론 깨짐 — ${id} 재계산 불일치`);
  }

  const homeIds = new Set(home.map((p) => p.id));
  const awayIds = new Set(away.map((p) => p.id));
  const sum = (sel: (l: ProdLine) => number, idset: Set<string>) => {
    let s = 0; for (const [id, l] of lines) if (idset.has(id)) s += sel(l); return s;
  };

  // (L) 팀 누수 — 모든 귀속 id는 홈/어웨이 둘 중 정확히 한 코트
  for (const [id] of lines) {
    if (!homeIds.has(id) && !awayIds.has(id)) fail(`누수 — ${id} 가 양 팀 어디에도 없는데 기록 보유`);
    if (homeIds.has(id) && awayIds.has(id)) fail(`중복 — ${id} 가 양 팀 모두에 (대진 중복)`);
  }

  // 팀 점수(시뮬 실제 결과)
  let homeScore = 0, awayScore = 0;
  for (const pt of sim.points) { if (pt.scorer === 'home') homeScore++; else awayScore++; }

  for (const [side, idset, score] of [['home', homeIds, homeScore], ['away', awayIds, awayScore]] as const) {
    const pts = sum((l) => l.points, idset);
    const spk = sum((l) => l.spikes, idset);
    const blk = sum((l) => l.blocks, idset);
    const ace = sum((l) => l.aces, idset);
    const ast = sum((l) => l.assists, idset);
    // (C) 보존: points = 귀속 득점(킬+블록+에이스)
    if (pts !== spk + blk + ace) fail(`보존 — ${side} points ${pts} ≠ 킬+블록+에이스 ${spk + blk + ace}`);
    // (C) 무귀속(상대범실) = 팀점수 − 귀속 득점 ≥ 0
    const errPts = score - pts;
    if (errPts < 0) fail(`보존 — ${side} 귀속 득점 ${pts} > 팀점수 ${score} (음수 범실)`);
    // (A) 어시스트 = 스파이크(공격 득점당 세터 1)
    if (ast !== spk) fail(`어시스트 — ${side} assists ${ast} ≠ spikes ${spk}`);
    totErrPts += errPts;
  }

  // (G) 디그 총량 = 킬 총량(공격 득점 1점당 수비 1디그)
  const allSpk = sum((l) => l.spikes, homeIds) + sum((l) => l.spikes, awayIds);
  const allDig = sum((l) => l.digs, homeIds) + sum((l) => l.digs, awayIds);
  if (allDig !== allSpk) fail(`디그총량 — Σdigs ${allDig} ≠ Σspikes ${allSpk}`);

  // (M) 선발 출전 = 1
  const starters = [...splitLineup(home).starters, ...splitLineup(away).starters];
  for (const p of starters) {
    const l = lines.get(p.id);
    if (!l || l.matches < 1) fail(`출전 — 선발 ${p.id} matches ${l?.matches ?? 0} < 1`);
  }

  // 분포 누적
  totPts += sum((l) => l.points, homeIds) + sum((l) => l.points, awayIds);
  totSpk += allSpk; totDig += allDig;
  totBlk += sum((l) => l.blocks, homeIds) + sum((l) => l.blocks, awayIds);
  totAce += sum((l) => l.aces, homeIds) + sum((l) => l.aces, awayIds);
  totAst += sum((l) => l.assists, homeIds) + sum((l) => l.assists, awayIds);
  totRallies += sim.points.length;
  matches++;
}

const pct = (x: number) => ((x / totRallies) * 100).toFixed(1) + '%';
log(`\n═══ 선수 기록 저장 정합성 — ${matches}경기 / ${totRallies.toLocaleString()}랠리 ═══`);
log(`▸ 귀속 분포: 공격킬 ${pct(totSpk)} · 블록 ${pct(totBlk)} · 에이스 ${pct(totAce)} · 상대범실(무귀속) ${pct(totErrPts)}`);
log(`▸ 보존 확인: 총 득점귀속 ${totPts.toLocaleString()} + 범실 ${totErrPts.toLocaleString()} = ${(totPts + totErrPts).toLocaleString()} (총 랠리 ${totRallies.toLocaleString()})`);
log(`▸ 어시스트 ${totAst.toLocaleString()} = 스파이크 ${totSpk.toLocaleString()} · 디그 ${totDig.toLocaleString()} = 스파이크`);
if (totPts + totErrPts !== totRallies) fail(`전체 보존 — 득점귀속+범실 ${totPts + totErrPts} ≠ 총 랠리 ${totRallies}`);
log(violations === 0
  ? `\n✅ 위반 0건 — 개인 귀속 결정론·팀 누수 없음·개인 합=팀 박스·보존 정합 (저장 정확)`
  : `\n❌ 위반 ${violations}건 — 위 로그 확인`);
process.exit(violations === 0 ? 0 : 1);
