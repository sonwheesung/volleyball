// KOVO 박스스코어 정밀 비교 — 엔진 시뮬을 KOVO 여자부 팀 기록 단위(세트당/팀당)로 정렬.
//
//   npx tsx tools/simKovo.ts [라운드로빈 반복수=40]
//
// 기준치: KOVO 여자부 정규리그(2022-23~2024-25) 팀 단위 근사 범위(학습 데이터 기반).
//   정밀 수치는 kovo.co.kr 팀 기록에서 변동 — 범위로 비교. 정의 차이는 각 행 주석.

import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { newRallyStats } from '../engine/rally';

const log = (m: string) => process.stdout.write(m + '\n');

function main(): void {
  const reps = Math.max(1, Number(process.argv[2]) || 40);
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  const sq: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
  for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

  const S = newRallyStats();
  let matches = 0, totalSets = 0;
  // 25점 세트(1~4세트)만 분리 — 5세트(15점제)가 평균을 끌어내리는 희석 방지
  let winPts25 = 0, losePts25 = 0, set25 = 0;

  let seed = 700000;
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        seed += 7;
        const sim = simulateMatch(seed, sq[ids[i]], sq[ids[j]], { home: coachInfoOf(ids[i]), away: coachInfoOf(ids[j]), stats: S });
        matches++;
        totalSets += sim.homeSets + sim.awaySets;
        sim.setScores.forEach((sc, idx) => {
          if (idx < 4) { // 25점 세트만
            winPts25 += Math.max(sc.home, sc.away);
            losePts25 += Math.min(sc.home, sc.away);
            set25++;
          }
        });
      }
    }
  }

  // 세트당·팀당 — 25점 세트 환산: (점수유형 비율) × (25점 세트 평균 양팀 총점) ÷ 2
  // (RallyStats는 세트 구분이 없으므로 비율은 전체, 절대값 스케일만 25점 세트 기준으로)
  const PTS25 = (winPts25 + losePts25) / set25; // 25점 세트 평균 양팀 총점
  const ps = (x: number) => (x / S.rallies) * PTS25 / 2;
  const f1 = (x: number) => x.toFixed(1);
  const f2 = (x: number) => x.toFixed(2);
  const pct = (x: number, d: number) => ((x / d) * 100).toFixed(1) + '%';

  const atkPts = S.kills + S.blockouts;                       // 공격 득점(킬+블록아웃 — KOVO 공격득점 정의)
  const oppErrs = S.serveErrs + S.attackErrs + S.faults;      // 상대 범실로 얻은 점수
  const inRange = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? '✓' : '⚠');

  const row = (label: string, mine: string, kovo: string, ok: string, note = '') =>
    log(`  ${label.padEnd(20)} 엔진 ${mine.padStart(7)}   KOVO ${kovo.padEnd(11)} ${ok}  ${note}`);

  log(`\n═══ KOVO 박스스코어 비교 — ${matches}경기 / ${totalSets}세트 (세트당·팀당) ═══`);
  log(`  ※ KOVO 기준 = 여자부 정규리그 팀 단위 근사 범위(시즌별 변동). 정의 차이는 주석.`);

  log('\n[득점 — 세트당 팀 득점 구성]');
  const tot = ps(S.rallies);
  row('총득점', f1(tot), '~22~23', inRange(tot, 21.5, 23.5), '(승자 25·패자 ~19~21)');
  const ap = ps(atkPts);
  row('공격 득점', f1(ap), '~12~13.5', inRange(ap, 11.5, 14), '킬+블록아웃(오픈·툴 포함)');
  const bp = ps(S.stuffs);
  row('블로킹 득점', f2(bp), '~2.0~2.6', inRange(bp, 1.9, 2.7), '스터프');
  const sp = ps(S.aces);
  row('서브 득점', f2(sp), '~0.9~1.3', inRange(sp, 0.85, 1.4), '에이스');
  const ep = ps(oppErrs);
  row('상대 범실 득점', f1(ep), '~6~7', inRange(ep, 5, 7.5), '엔진은 리시브범실·네트터치 등 기타범실 미모델 → 하단 참조');
  row('└ 범실 득점 비중', pct(oppErrs, S.rallies), '~27~30%', inRange((oppErrs / S.rallies) * 100, 20, 31), '');

  log('\n[실점(범실) — 세트당 팀 범실]');
  const se = ps(S.serveErrs);
  row('서브 범실', f2(se), '~1.5~2.2', inRange(se, 1.4, 2.3), '');
  const ae = ps(S.attackErrs);
  row('공격 범실', f2(ae), '~1.5~2.5', inRange(ae, 1.4, 2.6), '');
  const fe = ps(S.faults);
  row('포지션 폴트 등', f2(fe), '낮음', '✓', 'KOVO 기타범실(~2~3)은 리시브범실·네트터치 포함 — 엔진 미모델');

  log('\n[공격 — 세트당 팀]');
  const at = ps(S.attacks);
  row('공격 시도', f1(at), '~30~36', inRange(at, 28, 38), '');
  row('공격 성공률', pct(atkPts, S.attacks), '~33~40%', inRange((atkPts / S.attacks) * 100, 32, 41), '(성공/시도) — KOVO 정의');
  const effNum = atkPts - S.attackErrs - S.stuffs;
  row('공격 효율', pct(effNum, S.attacks), '~20~28%', inRange((effNum / S.attacks) * 100, 18, 29), '(성공-범실-피블록)/시도');
  row('피블로킹률', pct(S.stuffs, S.attacks), '~5~9%', inRange((S.stuffs / S.attacks) * 100, 4.5, 9.5), '');

  log('\n[서브/수비 — 세트당 팀]');
  const sv = ps(S.serves);
  row('서브 시도', f1(sv), '~22~23', inRange(sv, 21, 24), '(≈총 랠리/2)');
  row('서브 효율(에이스율)', pct(S.aces, S.serves), '~4~6%', inRange((S.aces / S.serves) * 100, 3.5, 6.5), '');
  row('서브 범실률', pct(S.serveErrs, S.serves), '~7~10%', inRange((S.serveErrs / S.serves) * 100, 6, 11), '');
  const dg = ps(S.digs);
  row('디그(강타 살림)', f1(dg), '~10~16', inRange(dg, 9, 17), 'KOVO "수비" 집계와 정의 차이(연결 제외) — 근사 비교');

  log('\n[세트 스코어 — 25점 세트(1~4세트) 기준]');
  const wAvg = winPts25 / set25, lAvg = losePts25 / set25;
  row('승자 평균 득점', f1(wAvg), '25.0~25.5', inRange(wAvg, 24.9, 25.8), '(듀스 포함)');
  row('패자 평균 득점', f1(lAvg), '~19~21', inRange(lAvg, 18.5, 21.5), '');
  row('평균 점수차', f1(wAvg - lAvg), '~4~6', inRange(wAvg - lAvg, 3.8, 6.5), '');

  log('\n  ✓=KOVO 범위 내 · ⚠=범위 밖(정의 차이 또는 튜닝 대상)');
}

main();
