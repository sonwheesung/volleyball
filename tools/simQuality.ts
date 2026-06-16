// 패스 품질(q) 분포 측정 — 서브 리시브 품질과 랠리 중 디그(전환) 품질의 평균·분포를 1만 판으로 확인.
// q = "얼마나 깔끔하게 받았나"(0~1). 0.32 미만이면 찬스볼(속공 불가·세트 품질 −15%).
//
//   npx tsx tools/simQuality.ts [경기수=10000]
//
// 계측은 RallyStats 싱크(결과 불변 — 텔레메트리 전용). 셰이크(리시브 범실)는 인플레이 q에서 제외.

import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { newRallyStats } from '../engine/rally';

const log = (m: string) => process.stdout.write(m + '\n');

function main(): void {
  const target = Math.max(1, Number(process.argv[2]) || 10000);
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  const sq: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
  for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

  const S = newRallyStats();
  let matches = 0;
  let seed = 900000;
  outer: for (let r = 0; ; r++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        seed += 7;
        simulateMatch(seed, sq[ids[i]], sq[ids[j]], { home: coachInfoOf(ids[i]), away: coachInfoOf(ids[j]), stats: S });
        if (++matches >= target) break outer;
      }
    }
  }

  const f2 = (x: number) => x.toFixed(3);
  const pct = (x: number, d: number) => ((x / d) * 100).toFixed(1) + '%';

  const recvAvg = S.recvQSum / Math.max(1, S.recvQN);
  const digN = S.digRegN + S.digTipN + S.digSoftN;
  const digSum = S.digRegSum + S.digTipSum + S.digSoftSum;
  const digAvg = digSum / Math.max(1, digN);
  const avg = (s: number, n: number) => f2(s / Math.max(1, n));

  log(`\n═══ 패스 품질(q) 측정 — ${matches.toLocaleString()}경기 / 랠리 ${S.rallies.toLocaleString()} ═══\n`);

  log('▸ 서브 리시브 품질 (인플레이 리시브만 — 에이스·서브범실·리시브범실 제외)');
  log(`  표본              ${S.recvQN.toLocaleString()}회`);
  log(`  평균 q            ${f2(recvAvg)}`);
  log(`  분포  좋음(≥0.60)  ${pct(S.recvGood, S.recvQN)}`);
  log(`        보통(0.45~)  ${pct(S.recvOk, S.recvQN)}`);
  log(`        난조(0.32~)  ${pct(S.recvPoor, S.recvQN)}`);
  log(`        찬스볼(<0.32) ${pct(S.recvChance, S.recvQN)}  ← 속공 불가·세트 −15%`);

  log('\n▸ 랠리 중 전환 품질 — 종류별 분리 (소프트블록 인플레 분리)');
  log(`  종류        평균 q   표본        비중`);
  log(`  일반 디그   ${avg(S.digRegSum, S.digRegN)}   ${S.digRegN.toLocaleString().padStart(9)}   ${pct(S.digRegN, digN)}`);
  log(`  팁 디그     ${avg(S.digTipSum, S.digTipN)}   ${S.digTipN.toLocaleString().padStart(9)}   ${pct(S.digTipN, digN)}`);
  log(`  소프트블록  ${avg(S.digSoftSum, S.digSoftN)}   ${S.digSoftN.toLocaleString().padStart(9)}   ${pct(S.digSoftN, digN)}`);
  log(`  ─ 전체 가중평균 ${f2(digAvg)} (${digN.toLocaleString()}회)`);
  log(`  ⇒ 리시브 vs 일반디그: ${f2(recvAvg)} vs ${avg(S.digRegSum, S.digRegN)} — 일반디그가 ${recvAvg > S.digRegSum / Math.max(1, S.digRegN) ? '더 낮음(정상: 디그가 어렵다)' : '더 높음(이상)'}`);

  // 참고: 셰이크 비율(리시브 범실) — 인플레이에서 빠진 부분
  const recvAttempts = S.recvQN + S.recvErrs; // 인플레이 + 셰이크
  log('\n▸ 참고');
  log(`  리시브 범실(셰이크) ${pct(S.recvErrs, recvAttempts)} (전체 리시브 시도 ${recvAttempts.toLocaleString()} 중)`);
  log(`  찬스볼 빈도(전체 리시브 대비) ${pct(S.recvChance, S.recvQN)}`);
  log('');
}

main();
