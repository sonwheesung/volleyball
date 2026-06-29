// INDEPENDENT GUARD — 샐러리캡 = 국내 선수 전용 (EC-CAP-01, 2026-06-30).
//   배경: 대시보드/단장실/시즌중이동/FA 화면이 **외인 포함** 총연봉을 **국내 전용 캡**(LEAGUE_CAP)과 비교해
//   멀쩡한 팀을 빨강(허위 초과)으로 표시 + 시즌 중 영입을 잘못 차단(기능 버그). 계약관리만 옳게 국내전용이었다.
//   인천 타이드(시작): 국내 30.6억 < 캡 35.0억 < 전체 37.7억 — 외인 7.1억이 캡을 허위로 넘긴 사례.
//   판정: day0 전 구단의 **국내 페이롤은 캡 이하**(시작 시 국내 캡 초과 팀 0) → 캡행 빨강은 곧 버그.
//   A/B(허위 오라클 방지): **외인 포함** 규칙으로 세면 ≥1팀이 캡 초과로 잡혀야(=필터가 판정을 바꾼다는 증거).
//   Usage: npx tsx tools/_dv_capdomestic.ts
import { resetLeagueBase, LEAGUE, getEvolvedTeamPlayers, getTeam } from '../data/league';
import { LEAGUE_CAP } from '../engine/cap';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const DAY = 0;
const f = (n: number) => (n / 10000).toFixed(1) + '억';

let domOver = 0;   // 국내 전용(수정 후) 캡 초과 팀 수 — 0이어야 정상
let allOver = 0;   // 외인 포함(버그) 캡 초과 팀 수 — ≥1이어야 A/B 민감
let incheonOk = false;
const rows: string[] = [];

for (const t of LEAGUE.teams) {
  const ps = getEvolvedTeamPlayers(t.id, DAY);
  const domPay = ps.filter((p) => !p.isForeign).reduce((s, p) => s + p.contract.salary, 0);
  const allPay = ps.reduce((s, p) => s + p.contract.salary, 0);
  if (domPay > LEAGUE_CAP) domOver++;
  if (allPay > LEAGUE_CAP) allOver++;
  const name = getTeam(t.id)?.name ?? t.id;
  // 인천 타이드 = 보고된 사례(국내<캡<전체)
  if (name.includes('인천') && domPay < LEAGUE_CAP && allPay > LEAGUE_CAP) incheonOk = true;
  rows.push(`  ${name.padEnd(10)} 국내 ${f(domPay)} | 전체 ${f(allPay)} | 캡 ${f(LEAGUE_CAP)}`);
}

log('[_dv_capdomestic] day0 팀별 페이롤 (국내 전용이 캡 기준):');
rows.forEach((r) => log(r));
log(`  국내 캡초과 팀(수정 후) = ${domOver} (기대 0) · 외인포함 캡초과 팀(버그) = ${allOver} (기대 ≥1)`);
log(`  인천 타이드 사례(국내<캡<전체) = ${incheonOk}`);

const pass = domOver === 0 && allOver >= 1 && incheonOk;
log(pass ? 'CAPDOMESTIC_GUARD PASS' : 'CAPDOMESTIC_GUARD FAIL');
process.exit(pass ? 0 : 2);
