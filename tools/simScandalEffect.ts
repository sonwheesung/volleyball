// 사건·사고 효과 검증 — 3가지를 한 번에:
//   ① 정지 출전: 출장정지 선수가 정지 기간 경기 명단(availableTeamPlayers)에 없는가
//   ② 영구제명: 제명자가 이후 어떤 시즌에도 로스터·출전 명단에 재등장하지 않는가
//   ③ 재계약 반영: 사고 선수의 다음 시즌 시장가치가 무사고 대비 낮은가(반사실 비교)
//   npx tsx tools/simScandalEffect.ts [시즌=120]

import {
  LEAGUE, SEASON, getTeam, getPlayer, resetLeagueBase, commitPlayerBase, commitRosters,
  teamScoutReveal, currentRosters, currentBasePlayers, focusOf, effectsOf,
} from '../data/league';
import { availableTeamPlayers, seasonScandals } from '../data/dynamics';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { rolloverPlayer, renewedContract } from '../engine/rollover';
import { scandalRepMul } from '../engine/scandal';
import { overall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');
const seasons = Math.max(10, Number(process.argv[2]) || 120);
const matchdays = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
const tn = (id: string) => (getTeam(id)?.name ?? id).split(' ').slice(-1)[0];

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);

let vPlay = 0, vExpel = 0;        // 위반 수
let suspChecks = 0;               // 정지×매치데이 검사 횟수
const expelledEver = new Map<string, { season: number; teamId: string }>();
// ③ 재계약 반영 측정
let scandalContracts = 0, reflectedLower = 0, mvDropSum = 0;
const examples: string[] = [];

for (let s = 0; s < seasons; s++) {
  const rosters = currentRosters();
  const scs = seasonScandals();

  // ① 정지 출전 — 정지 기간 매치데이에 출전 명단에 없어야
  for (const sc of scs) {
    for (const d of matchdays) {
      if (d < sc.from || d > sc.to) continue;
      suspChecks++;
      if (availableTeamPlayers(sc.teamId, d).some((p) => p.id === sc.playerId))
        { if (vPlay < 8) log(`  ❌[출전] s${s} ${getPlayer(sc.playerId)?.name}(${tn(sc.teamId)}) 정지 중 day${d} 출전 명단에 있음`); vPlay++; }
    }
  }

  // ② 영구제명 — 과거 제명자가 현재 로스터·출전 명단에 있으면 위반
  const liveIds = new Set(Object.values(rosters).flat());
  for (const [pid, info] of expelledEver) {
    if (liveIds.has(pid)) { if (vExpel < 8) log(`  ❌[제명] s${s} ${pid}(s${info.season} 제명) 가 로스터에 재등장`); vExpel++; }
    for (const t of ids) if (availableTeamPlayers(t, matchdays[0]).some((p) => p.id === pid))
      { if (vExpel < 8) log(`  ❌[제명] s${s} ${pid} 가 ${tn(t)} 출전 명단에 재등장`); vExpel++; }
  }

  // ③ 재계약 반영 — 사고 선수의 다음 시즌 재계약 연봉(성장정체 + 평판할인) vs 무사고 반사실
  const round100 = (x: number) => Math.round(x / 100) * 100;
  for (const sc of scs) {
    const base = currentBasePlayers().find((p) => p.id === sc.playerId);
    if (!base || base.isForeign) continue; // 외인은 재계약 없음(1년 트라이아웃 고정연봉) — 계약 패널티 대상 외
    const lost = Math.max(0, sc.to - sc.from);
    const rep = scandalRepMul(sc.missMatches);
    const actual = rolloverPlayer(base, focusOf(base), undefined, effectsOf(base), lost);   // 사고: 훈련정지
    const clean = rolloverPlayer(base, focusOf(base), undefined, effectsOf(base), 0);        // 무사고 가정
    const salA = round100(renewedContract(actual).salary * rep);                              // 사고: 성장↓ × 평판할인
    const salC = renewedContract(clean).salary;                                               // 무사고 재계약
    scandalContracts++;
    if (salA < salC) reflectedLower++;
    mvDropSum += (salC - salA);
    if (examples.length < 8 && salC - salA > 0)
      examples.push(`  ${base.name}(${base.age}세·${tn(sc.teamId)}) ${sc.missMatches}경기정지 → OVR ${overall(clean)}→${overall(actual)} · 재계약 ${salC}→${salA}(−${salC - salA}만, 평판×${rep.toFixed(2)})`);
  }

  // 오프시즌 진행(전 구단 AI) — 제명자 수집
  const ctx = buildDraftContext('', {}, {}, [], false, [], s + 1);
  const snapshot = ctx.snapshot;
  for (const e of ctx.expelled) expelledEver.set(e.playerId, { season: s, teamId: e.teamId });
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], s + 1);
  for (const r of filled.newPlayers) snapshot[r.id] = r;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) for (const id of filled.rosters[tid]) {
    const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
  }
  commitPlayerBase(snapshot); commitRosters(filled.rosters);
  if ((s + 1) % 30 === 0) process.stderr.write(`  …${s + 1}/${seasons}\n`);
}

log(`\n═══ 사건·사고 효과 검증 — ${seasons}시즌 ═══`);
log(`\n① 정지 출전: ${suspChecks}회 검사(정지×매치데이) · 위반 ${vPlay} — ${vPlay === 0 ? '정지 중 출전 없음 ✅' : '❌'}`);
log(`② 영구제명: 누적 제명 ${expelledEver.size}명 · 이후 재등장 위반 ${vExpel} — ${vExpel === 0 ? '완전 퇴출 ✅' : '❌'}`);
log(`\n③ 재계약 반영: 사고 계약 ${scandalContracts}건 중 다음 재계약 연봉 하락 ${reflectedLower}건(${scandalContracts ? Math.round(reflectedLower / scandalContracts * 100) : 0}%)`);
log(`   평균 재계약 연봉 하락 ${scandalContracts ? Math.round(mvDropSum / scandalContracts) : 0}만 (성장 정체 + 평판 할인 합산, 무사고 대비)`);
for (const e of examples) log(e);

const ok = vPlay === 0 && vExpel === 0;
log(ok ? `\n✅ 정지 출전 차단·영구 퇴출 정합 (재계약 반영은 위 수치로 확인)` : `\n❌ 위반 발생 — 위 로그 확인`);
process.exit(ok ? 0 : 1);
