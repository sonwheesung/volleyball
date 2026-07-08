// 은퇴 재정비 — 0단계 베이스라인 측정 (코드 변경 전 A/B의 A팔).
//   npx tsx tools/_dv_retire_baseline.ts [시즌수=150] [유니버스수=8]
// (a) 30세+ 국내 raw OVR(overall()) 분포 + 시즌별 리그 국내 중앙값(δ 캘리브레이션 근거)
// (b) 전지훈련 1코스가 30대 raw OVR 평균 몇 점 올리는가(즉효 current+3)
// (c) 현행 공식 지표: 평균연령·37~39 현역비중·40+ 현역·팀당 신인유입·parity/왕조·HOF유입·FA풀 규모
// SOLID: 엔진/데이터 순수 함수만(simLeague.advanceOffseason 재사용).

import { LEAGUE, resetLeagueBase, reseedLeague, currentBasePlayers, currentRosters, getPlayer } from '../data/league';
import { overall } from '../engine/overall';
import { medianOvr } from '../engine/aiGM';
import { applyCampCourse, CAMP_COURSES, type CampCourse } from '../engine/diamonds';
import { advanceOffseason } from './simLeague';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const stdev = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

// 포지션별 대표 코스(전지훈련 즉효 측정용)
const POS_COURSE: Record<string, CampCourse> = { OH: 'attack', OP: 'attack', MB: 'block', S: 'setter', L: 'defense' };

function main() {
  const seasons = Math.max(1, Number(process.argv[2]) || 150);
  const universes = Math.max(1, Number(process.argv[3]) || 8);

  // 집계 버킷
  const ovr30plus: number[] = [];          // 30~39 국내 OVR 분포
  const ovrByAge: Record<number, number[]> = {}; // 나이별 OVR
  const medEachSeason: number[] = [];      // 시즌별 국내 중앙값
  const campDelta: number[] = [];          // 30대 코스 즉효 ΔOVR
  const avgAgeArr: number[] = [];          // 시즌별 로스터 평균연령
  const share3739: number[] = [];          // 37~39 현역 비중
  const age40plus: number[] = [];          // 40+ 현역 수
  const rookiesPerTeamYear: number[] = []; // 팀당 연간 신규 유입(전 시즌 대비 신규 id)
  const faPool: number[] = [];             // (근사) 은퇴+미충원으로 생긴 로스터 공백
  let hofInflux = 0;                       // 통산 관측(간이) — 은퇴자 중 통산점수 상위
  const parityStdArr: number[] = [];
  const dynastyArr: number[] = [];

  for (let u = 0; u < universes; u++) {
    if (u === 0) resetLeagueBase();
    else reseedLeague(20251018 + u * 101, 777 + u * 13);

    const ids = LEAGUE.teams.map((t) => t.id);
    const titles: Record<string, number> = {};
    for (const id of ids) titles[id] = 0;
    let curTeam = '', curStreak = 0, longestStreak = 0;
    let prevPop = new Set<string>(currentBasePlayers().map((p) => p.id));

    for (let s = 0; s < seasons; s++) {
      // 우승/왕조
      const standings = computeStandings(Number.MAX_SAFE_INTEGER);
      const champ = buildPlayoffs(s).championId ?? standings[0].teamId;
      titles[champ]++;
      if (champ === curTeam) curStreak++; else { curTeam = champ; curStreak = 1; }
      if (curStreak > longestStreak) longestStreak = curStreak;

      // 샘플: 현재 로스터 국내 선수
      const domestic = currentBasePlayers().filter((p) => !p.isForeign);
      if (s >= 20) { // 워밍업 후 정상상태만
        medEachSeason.push(medianOvr(domestic));
        const ages = domestic.map((p) => p.age);
        avgAgeArr.push(mean(ages));
        share3739.push(domestic.filter((p) => p.age >= 37 && p.age <= 39).length / Math.max(1, domestic.length) * 100);
        age40plus.push(domestic.filter((p) => p.age >= 40).length);
        for (const p of domestic) {
          if (p.age >= 30 && p.age <= 39) {
            const o = overall(p);
            ovr30plus.push(o);
            (ovrByAge[p.age] ??= []).push(o);
            // 코스 즉효(현재 로스터 30대만, 첫 유니버스 워밍업 후 일부만 — 비용 절감)
            if (u === 0 && s % 10 === 0) {
              const course = POS_COURSE[p.position];
              if (course && CAMP_COURSES[course].forPos.includes(p.position)) {
                campDelta.push(overall(applyCampCourse(p, course)) - o);
              }
            }
          }
        }
      }

      advanceOffseason(s, champ, standings.map((st) => st.teamId));

      // 신규 유입(전 시즌 대비 새 id) = 드래프트+충원 신인
      const newPop = new Set<string>(currentBasePlayers().map((p) => p.id));
      let fresh = 0;
      for (const id of newPop) if (!prevPop.has(id)) fresh++;
      if (s >= 20) rookiesPerTeamYear.push(fresh / ids.length);
      // 로스터 공백(FA 근사): 팀당 16 목표 대비 부족(은퇴/미충원)
      const rost = currentRosters();
      let holes = 0;
      for (const t of ids) holes += Math.max(0, 16 - (rost[t]?.length ?? 0));
      if (s >= 20) faPool.push(holes);
      prevPop = newPop;
    }
    const titleArr = ids.map((id) => titles[id]);
    parityStdArr.push(stdev(titleArr));
    dynastyArr.push(longestStreak);
    process.stderr.write(`  …유니버스 ${u + 1}/${universes}\n`);
  }

  log(`\n═══ 은퇴 베이스라인 (현행 공식) · ${universes}유니버스 × ${seasons}시즌 (s≥20 정상상태) ═══`);
  log(`\n▸ (a) 30~39세 국내 OVR(overall) 분포  N=${ovr30plus.length}`);
  log(`   평균 ${mean(ovr30plus).toFixed(1)}  중앙 ${pct(ovr30plus, 0.5)}  p10 ${pct(ovr30plus, 0.1)}  p25 ${pct(ovr30plus, 0.25)}  p75 ${pct(ovr30plus, 0.75)}  p90 ${pct(ovr30plus, 0.9)}  min ${Math.min(...ovr30plus)}  max ${Math.max(...ovr30plus)}`);
  log(`   시즌별 국내 중앙값(medianOvr): 평균 ${mean(medEachSeason).toFixed(1)} ± ${stdev(medEachSeason).toFixed(2)}  범위 ${Math.min(...medEachSeason)}~${Math.max(...medEachSeason)}`);
  log(`\n▸ 나이별 OVR 분포(평균 / p25 / 중앙 / p75 / N):`);
  for (let a = 30; a <= 41; a++) {
    const arr = ovrByAge[a];
    if (!arr || !arr.length) { log(`   ${a}세: (없음)`); continue; }
    log(`   ${a}세: 평균 ${mean(arr).toFixed(1)}  p25 ${pct(arr, 0.25)}  중앙 ${pct(arr, 0.5)}  p75 ${pct(arr, 0.75)}  N ${arr.length}`);
  }
  log(`\n▸ (b) 전지훈련 1코스 즉효 ΔOVR(30대):  평균 +${mean(campDelta).toFixed(2)}  중앙 +${pct(campDelta, 0.5)}  범위 +${Math.min(...campDelta)}~+${Math.max(...campDelta)}  N=${campDelta.length}`);
  log(`\n▸ (c) 현행 공식 지표(정상상태 평균):`);
  log(`   로스터 평균연령        ${mean(avgAgeArr).toFixed(2)}세  ± ${stdev(avgAgeArr).toFixed(2)}`);
  log(`   37~39세 현역 비중       ${mean(share3739).toFixed(2)}%`);
  log(`   40세+ 현역(팀당 아님, 리그 전체/시즌)  ${mean(age40plus).toFixed(3)}명  (max ${Math.max(...age40plus)})`);
  log(`   팀당 연간 신규 유입      ${mean(rookiesPerTeamYear).toFixed(2)}명/팀/시즌`);
  log(`   로스터 공백(FA 근사)     ${mean(faPool).toFixed(2)}자리/시즌`);
  log(`   parity 표준편차         ${mean(parityStdArr).toFixed(2)} ± ${stdev(parityStdArr).toFixed(2)}`);
  log(`   최장 왕조(연속우승)      평균 ${mean(dynastyArr).toFixed(1)}  최대 ${Math.max(...dynastyArr)}`);
}

main();
