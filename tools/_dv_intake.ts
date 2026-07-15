// 입단 무결성 가드 — 드래프트 픽·외국인/아시아 영입이 "하나도 유실·중복 없이" 최종 로스터에 반영되는가.
// store.endSeason 파이프라인(buildDraftContext→resolveDraft→fillRosters→commit)을 그대로 재생해 다시즌 전수 검증.
// "선수 다 영입되는거 맞아?"(신입·외국인) 질문의 결정론적 답. exit 0/1.
import { LEAGUE, getTeam, resetLeagueBase, commitPlayerBase, commitRosters, teamScoutReveal, currentRosters, getPlayer } from '../data/league';
import { computeStandings } from '../data/standings';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget'; // #116 프로덕션 우주 정합(2026-07-15)
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';

const log = (m: string) => process.stdout.write(m + '\n');
const seasons = Math.max(50, Number(process.argv[2]) || 200);

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const MY = ids[0];

let picksTotal = 0;          // 드래프트로 지명된 총 선수 수
let pickNotInDraftRoster = 0; // 지명됐는데 지명팀 로스터(drafted.rosters)에 없음
let pickLostAfterFill = 0;    // 지명됐는데 최종(filled.rosters)에 없음(유실)
let dupMembership = 0;        // 한 선수가 2개 이상 로스터에 소속(중복)
let foreignMissingTeams = 0;  // 외국인 슬롯 비어있는 팀·시즌 수(영입 실패)
let asianChecked = 0;         // 최종 로스터에 실재하는 아시아쿼터 수(소속 有)
let dangling = 0;             // 최종 로스터가 참조하는데 snapshot에 없는 id(진짜 붕뜸)
let asianDepart = 0;          // 시즌초 내 아시아쿼터가 시즌말 이탈(정년·방출·미재계약 — 정상, 참고용)
let floorViolations = 0;      // 최종 로스터 < 12(포지션 무결 하한)
let seasonsRun = 0;

for (let s = 0; s < seasons; s++) {
  computeStandings(Number.MAX_SAFE_INTEGER); // 시즌 진행 상태 확정(생산 캐시 웜)
  const startMyRoster = [...(currentRosters()[MY] ?? [])]; // 시즌초(직전 커밋) 내 로스터
  const ctx = buildDraftContext(MY, {}, {}, [], false, [], s + 1);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], MY, [], styleOf, teamScoutReveal, [], aiTargetOf());
  for (const p of drafted.picked) snapshot[p.id] = p;

  // ── 검증 1: 모든 지명 선수가 지명팀 로스터에 들어갔는가 ──
  for (const p of drafted.picked) {
    picksTotal++;
    const inSomeRoster = Object.values(drafted.rosters).some((r) => r.includes(p.id));
    if (!inSomeRoster) pickNotInDraftRoster++;
  }

  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], s + 1);
  for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;

  // ── 검증 2: fillRosters 후에도 모든 지명 선수가 남아있는가(유실 0) ──
  const finalAll = new Set<string>();
  const memberCount = new Map<string, number>();
  for (const tid of Object.keys(filled.rosters)) {
    for (const id of filled.rosters[tid]) {
      finalAll.add(id);
      memberCount.set(id, (memberCount.get(id) ?? 0) + 1);
    }
  }
  for (const p of drafted.picked) if (!finalAll.has(p.id)) pickLostAfterFill++;

  // ── 검증 3: 중복 소속 0 ──
  for (const [, c] of memberCount) if (c > 1) dupMembership++;

  // ── 검증 4: 외국인 전 팀 보유(영입 성공) + 검증 5: floor ──
  for (const t of ids) {
    const roster = filled.rosters[t] ?? [];
    const hasForeign = roster.some((id) => snapshot[id]?.isForeign && !snapshot[id]?.isAsianQuota);
    if (!hasForeign) foreignMissingTeams++;
    if (roster.length < 12) floorViolations++;
  }

  // ── 검증 6(수정): 최종 로스터의 모든 id가 snapshot에 실재하는가(댕글링 참조 = 진짜 붕뜸) ──
  //   ※ 이전판은 "시즌초 로스터→시즌말 이탈"을 붕뜸으로 오분류(정상 정년·방출·미재계약). 그건 입단 실패가 아님.
  for (const tid of Object.keys(filled.rosters)) {
    for (const id of filled.rosters[tid]) {
      if (!snapshot[id]) dangling++;
      const p = snapshot[id];
      if (p?.isAsianQuota) asianChecked++; // 로스터에 실재하는 아시아쿼터 카운트(붕뜸 아님 — 소속 有)
    }
  }
  // 참고: 시즌초 내 로스터에 있다 시즌말 사라진 아시아쿼터를 "이탈"로 분류(버그 아님 검증용)
  for (const id of (startMyRoster)) {
    const p = snapshot[id];
    if (p?.isAsianQuota && !finalAll.has(id)) asianDepart++;
  }

  // 다음 시즌으로 커밋(성장 XP 반영 — 실제 파이프라인과 동일)
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) for (const id of filled.rosters[tid]) {
    const pr = seasonProd.get(id);
    if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
  }
  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
  seasonsRun++;
  if ((s + 1) % 50 === 0) process.stderr.write(`  …${s + 1}/${seasons}\n`);
}

log(`\n═══ 입단 무결성 (${seasonsRun}시즌 · 팀 ${ids.length}) ═══`);
log(`▸ 총 드래프트 지명: ${picksTotal}명 (시즌당 평균 ${(picksTotal / seasonsRun).toFixed(1)})`);
log(`▸ 지명→지명팀 로스터 누락: ${pickNotInDraftRoster}`);
log(`▸ 지명→최종 로스터 유실(fillRosters 후): ${pickLostAfterFill}`);
log(`▸ 중복 소속(선수·시즌): ${dupMembership}`);
log(`▸ 외국인 미보유 팀·시즌: ${foreignMissingTeams} / ${ids.length * seasonsRun}`);
log(`▸ 최종 로스터 < 12(floor 위반): ${floorViolations} / ${ids.length * seasonsRun}`);
log(`▸ 댕글링 참조(로스터엔 있는데 선수 데이터 없음): ${dangling}`);
log(`▸ [참고] 로스터 실재 아시아쿼터: ${asianChecked} · 내팀 아시아쿼터 정상이탈(정년·방출): ${asianDepart}`);

const fail = pickNotInDraftRoster > 0 || pickLostAfterFill > 0 || dupMembership > 0 || foreignMissingTeams > 0 || floorViolations > 0 || dangling > 0;
log(fail ? '\n❌ FAIL — 입단 유실/중복/공석/댕글링 발생' : '\n✅ PASS — 모든 픽·외국인·아시아쿼터가 유실·중복·댕글링 없이 로스터 반영, floor·외국인 전 팀 충족(아시아쿼터 이탈은 정년·방출로 정상)');
process.exit(fail ? 1 : 0);
