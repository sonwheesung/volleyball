// 경기 수치 ↔ 실제 여자배구(KOVO) 비교 — 풀 랠리 엔진을 N판 돌려 랠리/점수유형/포지션 생산을 측정.
//
//   npx tsx tools/simStats.ts [라운드로빈 반복수=40]
//
// 랠리 엔진의 선택적 통계 싱크(RallyStats)로 에이스·킬·스터프·블록아웃·범실을 집계하고,
// SimResult로 세트분포·듀스·스윕을, attributeProduction으로 포지션별 생산을 측정해 KOVO 범위와 비교.

import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { newRallyStats } from '../engine/rally';
import { attributeProduction, splitLineup, type ProdLine } from '../engine/production';
import type { Position } from '../types';

function main(): void {
  const reps = Math.max(1, Number(process.argv[2]) || 40);
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  const sq: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
  for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

  const S = newRallyStats();
  let matches = 0, totalSets = 0, deuceSets = 0, m30 = 0, m31 = 0, m32 = 0;

  // 포지션별 생산 누적(선발만)
  const prodByPos: Record<Position, ProdLine> = {
    S: blank(), OH: blank(), OP: blank(), MB: blank(), L: blank(),
  };
  const setsByPos: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };

  let seed = 500000;
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        seed += 7;
        const a = ids[i], b = ids[j];
        const sim = simulateMatch(seed, sq[a], sq[b], { home: coachInfoOf(a), away: coachInfoOf(b), stats: S });
        matches++;
        const nSets = sim.homeSets + sim.awaySets;
        totalSets += nSets;
        const margin = Math.abs(sim.homeSets - sim.awaySets);
        if (margin === 3) m30++; else if (margin === 2) m31++; else m32++;
        for (const sc of sim.setScores) if (Math.max(sc.home, sc.away) >= 26) deuceSets++;

        const prod = attributeProduction(sim, sq[a], sq[b], seed);
        for (const team of [a, b]) {
          const { starters } = splitLineup(sq[team]);
          for (const p of starters) {
            const l = prod.get(p.id);
            if (!l) continue;
            add(prodByPos[p.position], l);
            setsByPos[p.position] += nSets;
          }
        }
      }
    }
  }

  const pts = S.rallies; // 총 득점 = 총 랠리
  const pct = (x: number, d: number) => (d > 0 ? (x / d * 100) : 0).toFixed(1) + '%';
  const per = (x: number, d: number) => (d > 0 ? x / d : 0).toFixed(2);

  const L = (m: string) => process.stdout.write(m + '\n');
  L(`\n═══ 경기 수치 vs 여자배구(KOVO) — ${matches}경기 / ${totalSets}세트 ═══`);

  L('\n[점수 유형 분포 — 전체 득점 대비]');
  row('공격 킬(스파이크)', pct(S.kills, pts), '~50~58%');
  row('블록아웃 득점', pct(S.blockouts, pts), '~4~6%');
  row('스터프 블록 득점', pct(S.stuffs, pts), '~7~10%');
  row('서브 에이스', pct(S.aces, pts), '~5~7%');
  row('상대 공격범실 유도', pct(S.attackErrs, pts), '(범실군)');
  row('상대 서브범실 유도', pct(S.serveErrs, pts), '(범실군)');
  row('포지션 폴트', pct(S.faults, pts), '드묾');

  L('\n[공격 효율 — 공격 시도 대비]');
  row('공격 성공률(킬)', pct(S.kills, S.attacks), '~40~50%');
  row('공격 범실률', pct(S.attackErrs, S.attacks), '~8~14%');
  row('피블로킹률(스터프)', pct(S.stuffs, S.attacks), '~7~12%');

  L('\n[랠리/경기]');
  row('랠리당 공격 횟수(공방)', per(S.attacks, S.rallies), '~1.4~1.7'); // KOVO 시도(~33)/총득점(~22) 실측 비
  row('사이드아웃 성공률', pct(S.sideouts, S.rallies), '~58~68%');
  row('경기당 세트', per(totalSets, matches), '~3.5~3.9');
  row('듀스(26점+) 세트 비율', pct(deuceSets, totalSets), '~12~18%');
  row('스트레이트(3-0)', pct(m30, matches), '~38~42%');
  row('3-1', pct(m31, matches), '~33~38%');
  row('풀세트(3-2)', pct(m32, matches), '~22~28%');

  L('\n[포지션별 생산 — 세트당]');
  row('OP(아포짓) 득점', per(prodByPos.OP.points, setsByPos.OP), '~4.5~6 (톱)');
  row('OH(레프트) 득점', per(prodByPos.OH.points, setsByPos.OH), '~2.5~4');
  row('MB(센터) 득점', per(prodByPos.MB.points, setsByPos.MB), '~1.5~2.5');
  row('MB(센터) 블록', per(prodByPos.MB.blocks, setsByPos.MB), '~0.4~0.7');
  row('S(세터) 어시스트', per(prodByPos.S.assists, setsByPos.S), '~10~13');
  row('L(리베로) 디그', per(prodByPos.L.digs, setsByPos.L), '~4~6');
}

function blank(): ProdLine {
  return { matches: 0, points: 0, spikes: 0, blocks: 0, aces: 0, assists: 0, digs: 0 };
}
function add(acc: ProdLine, l: ProdLine): void {
  acc.points += l.points; acc.spikes += l.spikes; acc.blocks += l.blocks;
  acc.aces += l.aces; acc.assists += l.assists; acc.digs += l.digs; acc.matches += l.matches;
}
function row(label: string, mine: string, kovo: string): void {
  process.stdout.write(`  ${label.padEnd(22)} 엔진 ${mine.padStart(7)}   KOVO ${kovo}\n`);
}

main();
