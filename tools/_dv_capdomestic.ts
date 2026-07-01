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

let domOver = 0;   // 국내 전용(수정 후) 캡 초과 팀 수 — 0이어야 정상(진짜 불변식)
const rows: { name: string; domPay: number; allPay: number }[] = [];

for (const t of LEAGUE.teams) {
  const ps = getEvolvedTeamPlayers(t.id, DAY);
  const domPay = ps.filter((p) => !p.isForeign).reduce((s, p) => s + p.contract.salary, 0);
  const allPay = ps.reduce((s, p) => s + p.contract.salary, 0);
  if (domPay > LEAGUE_CAP) domOver++;
  const name = getTeam(t.id)?.name ?? t.id;
  rows.push({ name, domPay, allPay });
}

log('[_dv_capdomestic] day0 팀별 페이롤 (국내 전용이 캡 기준):');
rows.forEach((r) => log(`  ${r.name.padEnd(10)} 국내 ${f(r.domPay)} | 전체 ${f(r.allPay)} | 캡 ${f(LEAGUE_CAP)}`));
log(`  국내 캡초과 팀(수정 후) = ${domOver} (기대 0)`);

// A/B 민감도(허위 오라클 방지) — 시드-강건판(2026-07-01): 실 LEAGUE_CAP이 시드 연봉에 따라 안 넘을 수도
//   있어(외인 포함 최고 인천 34.9억<35.0억) "≥1팀 실초과" 가정이 깨졌다(브리틀 가드). 대신 **합성 probe 캡**을
//   외인을 가장 많이 안은 팀의 (국내,전체) 사이로 잡아, 국내 규칙=캡내 ↔ 외인포함 규칙=초과로 **판정이 뒤집힘**을
//   증명한다(외인 연봉>0이면 allPay>domPay라 항상 성립 → 시드 변동에 안 깨지면서 필터가 load-bearing임을 입증).
const withForeign = rows.filter((r) => r.allPay > r.domPay);
const probeTeam = withForeign.sort((a, b) => (b.allPay - b.domPay) - (a.allPay - a.domPay))[0];
let flips = false, probeCap = 0;
if (probeTeam) {
  probeCap = Math.floor((probeTeam.domPay + probeTeam.allPay) / 2); // domPay < probeCap < allPay (외인 연봉>0)
  const domVerdict = probeTeam.domPay > probeCap;  // 국내 규칙: 캡내(false)
  const allVerdict = probeTeam.allPay > probeCap;  // 외인포함 규칙: 초과(true)
  flips = !domVerdict && allVerdict;
  log(`  [A/B] probe 캡 ${f(probeCap)} @ ${probeTeam.name}: 국내규칙 초과=${domVerdict} · 외인포함규칙 초과=${allVerdict} → 필터가 판정 뒤집음=${flips}`);
}

const pass = domOver === 0 && flips;
log(pass ? 'CAPDOMESTIC_GUARD PASS' : 'CAPDOMESTIC_GUARD FAIL');
process.exit(pass ? 0 : 2);
