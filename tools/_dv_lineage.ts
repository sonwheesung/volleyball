// INDEPENDENT — 헌액 번호 계보 길이 실측 (EDGE_CASES §3.12 감시①: numberLineage 무한 증가?).
// 추정 금지: 실제 시즌 루프(드래프트·은퇴·career 누적)를 N시즌 굴려 레전드(career.points≥LEGEND_POINTS)를
// 쌓고, (구단·헌액번호)별 최대 계보 길이를 측정한다 → 표시 캡이 필요한지 데이터로 판단.
//   npx tsx tools/_dv_lineage.ts [시즌=60]
// 결정론: rnd 분기(코치 능동영입) 제외한 순수 진행. 같은 N=같은 결과.
import { resetLeagueBase, LEAGUE, getPlayer, currentRosters, commitPlayerBase, commitRosters, teamScoutReveal } from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { computeStandings } from '../data/standings';
import { leagueProduction } from '../data/production';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { overall } from '../engine/overall';
import { jerseyNumber } from '../engine/jersey';
import { numberLineage } from '../data/legends';
import type { HofEntry } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(2, Number(process.argv[2]) || 60);
// 출처: store/useGameStore.ts:54 const LEGEND_POINTS = 7500 (영구결번급). 동결값 — 바뀌면 갱신.
const LEGEND_POINTS = 7500;
resetLeagueBase();
const teamIds = LEAGUE.teams.map((t) => t.id);

// 선수 id → 마지막 소속 팀(은퇴 시점 귀속). 매 시즌 로스터로 갱신.
const teamOf = new Map<string, string>();
const hof: HofEntry[] = [];
const seenRetired = new Set<string>();

for (let s = 1; s <= N; s++) {
  // 소속 갱신
  const rs = currentRosters();
  for (const t of teamIds) for (const id of rs[t] ?? []) teamOf.set(id, t);

  computeStandings(Number.MAX_SAFE_INTEGER);
  const ctx = buildDraftContext(teamIds[0], {}, {}, [], true, [], s, undefined, 9_999_999);
  const snapshot = ctx.snapshot;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);

  // 은퇴 처리 → 명전 엔트리(레전드 = career.points ≥ LEGEND_POINTS, 마지막 소속)
  for (const rid of ctx.retired) {
    if (seenRetired.has(rid)) continue;
    seenRetired.add(rid);
    const p = snapshot[rid] ?? getPlayer(rid);
    const pts = p?.career?.points ?? 0;
    const teamId = teamOf.get(rid) ?? '';
    if (!teamId) continue;
    hof.push({
      id: rid, name: p?.name ?? rid, position: (p?.position ?? 'OH'), teamId,
      seasons: p?.career?.seasons ?? 0, points: pts, blocks: 0, digs: 0,
      retiredSeason: s, legend: pts >= LEGEND_POINTS,
    } as HofEntry);
  }

  // 진행: 드래프트 + 신인 + career 누적
  const styleOf = (tid: string) => LEAGUE.teams.find((t) => t.id === tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], teamIds[0], [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) {
    const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr);
  }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

const legends = hof.filter((h) => h.legend);
// (팀·번호)별 레전드 수(계보 천장 — beforeSeason 무관) + 실제 계보 길이(먼저 은퇴만)
const binCount = new Map<string, number>();
for (const L of legends) binCount.set(`${L.teamId}#${jerseyNumber(L.id)}`, (binCount.get(`${L.teamId}#${jerseyNumber(L.id)}`) ?? 0) + 1);
let maxBin = 0, maxBinKey = '';
for (const [k, c] of binCount) if (c > maxBin) { maxBin = c; maxBinKey = k; }

let maxLineage = 0, maxLinName = '';
const lenHist = new Map<number, number>();
for (const L of legends) {
  const len = numberLineage(hof, L.teamId, jerseyNumber(L.id), L.id, L.retiredSeason).length;
  lenHist.set(len, (lenHist.get(len) ?? 0) + 1);
  if (len > maxLineage) { maxLineage = len; maxLinName = `${L.name}(${L.teamId}#${jerseyNumber(L.id)})`; }
}

// 결정론 재실행(같은 N=같은 레전드 집합)
const idsSig = legends.map((l) => l.id).sort().join(',');

log(`═══ 헌액 번호 계보 길이 실측 (${N}시즌·${teamIds.length}팀) ═══`);
log(`은퇴 총 ${hof.length}명 · 레전드(≥${LEGEND_POINTS}점) ${legends.length}명 (${(100 * legends.length / Math.max(1, hof.length)).toFixed(1)}%)`);
log(`레전드/팀 평균 ${(legends.length / teamIds.length).toFixed(1)}명`);
log(`(팀·번호)별 최대 레전드 수(계보 천장): ${maxBin}명 @ ${maxBinKey}`);
log(`실제 numberLineage 최대 길이(먼저 은퇴만): ${maxLineage} @ ${maxLinName || '-'}`);
log(`계보 길이 분포: ${[...lenHist.entries()].sort((a, b) => a[0] - b[0]).map(([l, c]) => `${l}:${c}`).join(' · ')}`);
// 판정: HofView 한 줄 표시가 감당할 범위인가. 표시 캡 없이 ~6 이하면 WAI(캡 불요), 초과면 캡 권고.
const CAP_ADVISE = 6;
const need = maxLineage > CAP_ADVISE;
log(`\n판정: 최대 계보 길이 ${maxLineage} ${need ? `> ${CAP_ADVISE} → ⚠ 표시 캡 권고(상위 N+"외 k명")` : `≤ ${CAP_ADVISE} → ✅ 현 표시로 충분(캡 불요, WAI)`}`);
log(`결정론 서명(레전드 ids 해시 길이): ${idsSig.length}자 — 동일 N 재실행 시 불변이어야`);
process.exit(0);
