// INDEPENDENT — 리베로 점프 토스 금지(BOARD_RULES 룰 70, 사용자 보고 2026-07-30).
//   리베로(후위 MB 슬롯)가 **전위(3m 라인 안)** 에서 세트하면 오버핸드 점프 세트 불가(수비 스페셜리스트).
//   → courtPath가 toss WP에 noJump=true를 스탬프하고 렌더(jumpersFor)가 마커 점프를 끈다.
//   불변식: 세터(토스 WP 직전 pass WP의 idx)가 리베로 슬롯 && 그 위치가 전위 → noJump=true여야.
//   판별(민감도): ① 전위 리베로 세트가 실제로 존재(>0, 무의미 가드 방지) ② 위반 0(전부 noJump)
//     ③ 오탐 0(비리베로·후위 리베로 세트는 noJump 없음 — 백존 점프 세트는 합법이라 허용해야).
//   A/B: 구 코드(noJump 필드 없음)면 전위 리베로 toss가 전부 위반(noJump 미설정) → 이 가드 FAIL.
//   Usage: npx tsx tools/_dv_libero_toss.ts [경기=40]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { buildLineup } from '../engine/lineup';
import { simulateMatch } from '../engine/match';
import { ballPath, type Lineups } from '../components/courtPath';
import { reconstructRallies } from '../components/courtDirector';
import { lineupIdxAt } from '../components/courtLayout';

const W = 360, H = 500, SERVE_OUT = 22;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 40);
resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

let liberoFrontToss = 0, violations = 0, falsePositive = 0, backZoneLiberoToss = 0, totalToss = 0;
for (let m = 0; m < N; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 424242 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  let prevLast: { x: number; y: number } | undefined;
  for (const r of reconstructRallies(sim)) {
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    for (let i = 1; i < path.length; i++) {
      const to = path[i], from = path[i - 1];
      if (to.kind !== 'toss' || from.kind !== 'pass') continue;
      totalToss++;
      const side = to.side; // 토스 WP·직전 pass WP 모두 공격(세트)팀
      const rot = side === 'home' ? r.homeRot : r.awayRot;
      const six = (side === 'home' ? L.home : L.away).six;
      const liberoSlot = [1, 5, 6].map((z) => lineupIdxAt(rot, z)).find((s) => six[s]?.position === 'MB');
      const setterIdx = from.idx; // 세터 = pass WP 처리자(점프 주체)
      const inFront = side === 'home' ? from.y < 0.66 * H : from.y > 0.34 * H;
      const isLibero = setterIdx === liberoSlot;
      if (isLibero && inFront) {
        liberoFrontToss++;
        if (!to.noJump) violations++;
      } else {
        if (to.noJump) falsePositive++;        // 비리베로·후위 리베로엔 noJump 금지(백존 점프 세트 합법)
        if (isLibero && !inFront) backZoneLiberoToss++;
      }
    }
  }
}
log('═══ 리베로 점프 토스 금지(룰 70) 검사 ═══');
log(`전체 토스 WP ${totalToss}건`);
log(`  · 전위 리베로 세트 **${liberoFrontToss}건** (>0이어야 — 시나리오 존재, 무의미 가드 방지)`);
log(`    └ 그중 noJump 누락(위반) **${violations}건** (0이어야 — 전부 점프 억제)`);
log(`  · 후위 리베로 세트 ${backZoneLiberoToss}건 (백존 점프 세트는 합법 → noJump 없어야 = 오탐에 안 잡힘)`);
log(`  · noJump 오탐(비리베로·후위 리베로에 설정) **${falsePositive}건** (0이어야 — 전위 리베로만 억제)`);
const ok = liberoFrontToss > 0 && violations === 0 && falsePositive === 0;
log(`\nLIBERO_TOSS OK = ${ok}`);
process.exit(ok ? 0 : 2);
