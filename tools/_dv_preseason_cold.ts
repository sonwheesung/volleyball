// 시즌 시작 전(구단 선택 플로우 day0) 선수/구단 화면 콜드 진입 비용 가드 (2026-06-28)
//
// 버그(사용자 보고): 구단 선택 > 구단 정보 > 선수 클릭 = 폰에서 ~15초. 원인 = day0(경기 0개)인데도
// **세 갈래 전 시즌 시드 재생**이 콜드로 돌았다 — ① getPlayerProduction→allProdRows ② availableTeamPlayers→dyn()
// ③ popularityNow의 leagueProduction(MAX)+seasonScandals()→dyn(). 수정: 빈 구간/일자<0/시작전 가드로
// 시작 전엔 재생을 아예 안 탄다(생산·dynamics·owner). 본 가드는 콜드 day0 비용이 충분히 작은지 + A/B로
// "중반 콜드는 여전히 무겁다(측정이 진짜 재생을 가린다는 증명)"를 확인한다(허위 오라클 차단, STATS_PROTOCOL 0장).

import { LEAGUE, getTeamPlayers, getEvolvedPlayer, currentRosters } from '../data/league';
import { getPlayerProduction, leagueProduction } from '../data/production';
import { leagueDisplayDay } from '../data/standings';
import { relationsOf } from '../data/relationships';
import { availableTeamPlayers, suspendedOnDay, teamInjuriesOn } from '../data/dynamics';
import { popularityNow } from '../data/owner';
import { buildLineup } from '../engine/lineup';

const COLD_BUDGET_MS = 500; // day0 가드 경로(실측 ~3ms)와 전 시즌 콜드 재생(~1.3s+)을 확실히 가르는 임계

const team = LEAGUE.teams[0];
const pid = getTeamPlayers(team.id)[0].id;

// ── A: day0(구단 선택, 팀 미선택) 선수 화면이 부르는 셀렉터 전부 — 콜드 ──
const displayDay = leagueDisplayDay(0); // -1
const tA = Date.now();
const p = getEvolvedPlayer(pid, 0)!;
getPlayerProduction(pid, displayDay);
popularityNow(p, 0, []);
popularityNow(p, 0, []);
relationsOf(pid, [] as never);
const rs = currentRosters();
let teamOfP: string | null = null;
for (const t of Object.keys(rs)) if (rs[t].includes(pid)) { teamOfP = t; break; }
if (teamOfP) {
  const avail = availableTeamPlayers(teamOfP, displayDay);
  suspendedOnDay(displayDay);
  teamInjuriesOn(teamOfP, displayDay);
  buildLineup(avail);
}
const coldDay0 = Date.now() - tA;

// ── B(A/B 민감도): 중반 시점 생산은 여전히 콜드 전 시즌 재생 → 무거워야 한다(측정이 재생을 포착한다는 증명) ──
const tB = Date.now();
leagueProduction(80); // 캐시 콜드(위 경로는 day0 가드라 allProdRows를 안 데웠다) → 전 경기 시뮬
const coldMid = Date.now() - tB;

const pass = coldDay0 < COLD_BUDGET_MS;
const sensitive = coldMid > COLD_BUDGET_MS; // B가 빠르면 측정이 재생을 못 가리는 것(허위 오라클)

console.log(`A day0 콜드 선수화면 셀렉터: ${coldDay0}ms (예산 <${COLD_BUDGET_MS}ms) → ${pass ? '✅' : '❌'}`);
console.log(`B 중반 leagueProduction(80) 콜드: ${coldMid}ms (전 시즌 재생, >${COLD_BUDGET_MS}ms여야 측정 신뢰) → ${sensitive ? '✅' : '❌ 허위오라클'}`);
console.log(pass && sensitive ? '\n결론: ✅ 시작 전 화면은 전 시즌 재생을 안 탄다(가드 유효) + 측정 민감(A/B)' : '\n결론: ❌ FAIL');
process.exit(pass && sensitive ? 0 : 1);
