// EC-FN-01 가드 — 모기업 기조 AI 입찰 stance가 **preview=result**인지(엣지스웜 2026-06-29 발견·수정).
//   버그: resolveFAMarket가 teamStanceOf(archive-only)로 stance 도출 → FA 프리뷰 시점(막 끝난 시즌 S가 archive에
//   아직 없음)엔 전원 normal, endSeason(S 포함) 시점엔 실제 stance → preview≠result.
//   수정: upcomingStances(라이브 병합 — computeStandings로 S를 덧댐)라 S의 archive 유무와 무관하게 동일 stance.
//   검증: 같은 (teams,S)에 대해 archive에 S엔트리 유무만 바꿔 ① upcomingStances 동일(=preview=result) ②
//   teamStanceOf(옛 경로)는 달라짐(>0 = 오라클 이빨·버그 실재). npx tsx tools/_dv_stance_preview.ts
import { resetLeagueBase, LEAGUE } from '../data/league';
import { computeStandings } from '../data/standings';
import { setSeasonHistory, upcomingStances, teamStanceOf } from '../data/leagueHistory';
import type { SeasonArchive } from '../types';

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
const liveStand = computeStandings(Number.MAX_SAFE_INTEGER).map((r) => r.teamId);
const SMAP = (teamIds: string[], S: number): Record<string, string> => {
  const m: Record<string, string> = {}; for (const t of teamIds) m[t] = teamStanceOf(t, S); return m;
};
const uMap = (S: number): Record<string, string> => upcomingStances(teams, S);

let previewResultMismatch = 0;   // 신규(upcomingStances) preview≠result = 버그
let oracleDiffs = 0;             // 옛(teamStanceOf) preview vs result 차이 = 오라클 이빨(버그 실재 증명)
let evalPts = 0, nonNormal = 0;

for (let S = 2; S <= 120; S++) {
  // 과거 archive(0..S-1) — 우승 회전(드래프트 트리거용)
  const past: SeasonArchive[] = [];
  for (let s = 0; s < S; s++) past.push({ season: s, championId: teams[s % teams.length], standings: [...teams] });
  const withS: SeasonArchive[] = [...past, { season: S, championId: liveStand[0], standings: [...liveStand] }];

  // 프리뷰 상태(archive에 S 없음)
  setSeasonHistory(past);
  const pu = uMap(S), pt = SMAP(teams, S);
  // 결과 상태(archive에 S 있음)
  setSeasonHistory(withS);
  const ru = uMap(S), rt = SMAP(teams, S);

  for (const t of teams) {
    evalPts++;
    if (pu[t] !== ru[t]) previewResultMismatch++;        // 신규 경로: 같아야(preview=result)
    if (pt[t] !== rt[t]) oracleDiffs++;                  // 옛 경로: 달랐음(버그)
    if (ru[t] !== 'normal') nonNormal++;
  }
}

console.log(`═══ 모기업 기조 preview=result (EC-FN-01) — ${evalPts} 팀-시즌 평가 ═══`);
console.log(`  신규(upcomingStances) preview≠result 불일치: ${previewResultMismatch} (0이어야 — 라이브 병합으로 S archive 유무 무관)`);
console.log(`  옛(teamStanceOf) preview vs result 차이: ${oracleDiffs} (>0이어야 — 버그 실재·오라클 이빨)`);
console.log(`  non-normal stance 관측: ${nonNormal}`);

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };
ck('① preview=result — upcomingStances는 S archive 유무 무관 동일', previewResultMismatch === 0, `${previewResultMismatch}`);
ck('② 오라클 이빨 — 옛 teamStanceOf 경로는 달라졌음(버그 실재)', oracleDiffs > 0, `${oracleDiffs}`);
ck('③ non-normal 발화(테스트 유효)', nonNormal > 0);
console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
process.exit(fail > 0 ? 1 : 0);
