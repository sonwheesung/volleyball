// 시즌 중 거래(in-season transaction) 선수 이중 소속 검증 — dynamics forward-pass.
//   npx tsx tools/simTxDup.ts
// 방출→FA풀→AI/수동 영입 churn을 주입하고 매치데이마다 불변식 검사:
//   (1) 한 선수가 두 팀 명단(rosterIdsOnDay)에 동시에 X
//   (2) 가용 FA(availableFAsOnDay) ∩ 그날 소속 선수 = ∅
//   (3) 정원 ≤ ROSTER_MAX
//   (4) 방출 선수는 방출일 이후 옛 팀 명단에 없음
//   (5) 외인 방출자는 어느 팀에도 재등장 안 함(리그 이탈)
//   + 적대적: 같은 FA를 두 팀이 (다른 날) 영입 시도 → 이중 소속이 막히는가

import { resetLeagueBase, LEAGUE, SEASON, currentRosters, getPlayer } from '../data/league';
import { setTxContext, rosterIdsOnDay, availableFAsOnDay, type Tx } from '../data/dynamics';
import { ROSTER_MAX } from '../engine/transactions';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();

const teams = LEAGUE.teams.map((t) => t.id);
const myTeam = teams[0];
const rosters = currentRosters();
const matchdays = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
const tname = (id: string) => LEAGUE.teams.find((t) => t.id === id)?.name ?? id;

// 외인 한 명 찾기(방출 → 리그 이탈 검증용)
let foreignId = '', foreignTeam = '';
for (const t of teams) for (const id of rosters[t]) { const p = getPlayer(id); if (p?.isForeign) { foreignId = id; foreignTeam = t; break; } if (foreignId) break; }

// ── 거래 시나리오 ──
const txs: Tx[] = [];
// 1) t1·t2·t3 각각 도메스틱 2명 방출(구멍 + FA 풀 유입)
for (const ti of [1, 2, 3]) {
  const t = teams[ti];
  const dom = rosters[t].filter((id) => !getPlayer(id)?.isForeign).slice(0, 2);
  for (const id of dom) txs.push({ day: 4, teamId: t, playerId: id, kind: 'release' });
}
// 2) 외인 방출(리그 이탈해야 함 — FA 풀로 안 감)
if (foreignId) txs.push({ day: 4, teamId: foreignTeam, playerId: foreignId, kind: 'release' });
// 3) 적대적 이중 영입: t2가 방출한 첫 선수를 t0(내 팀)이 day8에, t4가 day12에 둘 다 영입 시도
//    → 먼저 잡은 팀만 유효해야 한다(이중 소속 금지). 트레이드 없음이므로 둘째 영입은 무효.
const doubleTarget = rosters[teams[2]].filter((id) => !getPlayer(id)?.isForeign)[0];
txs.push({ day: 8, teamId: myTeam, playerId: doubleTarget, kind: 'sign' });
txs.push({ day: 12, teamId: teams[4], playerId: doubleTarget, kind: 'sign' });

setTxContext(txs, [], myTeam);

let violations = 0;
const fail = (msg: string) => { if (violations < 40) log(`  ❌ ${msg}`); violations++; };

const releasedAfter = new Map<string, { team: string; day: number }>();
for (const tx of txs) if (tx.kind === 'release') releasedAfter.set(tx.playerId, { team: tx.teamId, day: tx.day });

for (const d of matchdays) {
  const owner = new Map<string, string>();
  for (const t of teams) {
    const ids = rosterIdsOnDay(t, d);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) fail(`day${d}: 선수 ${id} ${tname(t)} 명단 중복`);
      seen.add(id);
      const prev = owner.get(id);
      if (prev && prev !== t) fail(`day${d}: 선수 ${id} 두 팀 동시 소속(${tname(prev)}·${tname(t)})`);
      owner.set(id, t);
    }
    if (ids.length > ROSTER_MAX) fail(`day${d}: ${tname(t)} 정원 ${ids.length} > ${ROSTER_MAX}`);
  }
  // FA 풀 ∩ 소속 = ∅
  for (const fa of availableFAsOnDay(d)) if (owner.has(fa)) fail(`day${d}: FA ${fa} 가 ${tname(owner.get(fa)!)} 소속인데 FA 풀에도 있음`);
  // 방출 선수는 방출일 이후 옛 팀에 없음
  for (const [pid, r] of releasedAfter) if (d > r.day && rosterIdsOnDay(r.team, d).includes(pid)) {
    // 단, 방출 후 같은 팀이 재영입했으면 예외 — 여기선 그런 tx 없음
    fail(`day${d}: 방출 선수 ${pid} 가 옛 팀 ${tname(r.team)} 명단에 남음`);
  }
  // 외인 방출자는 어느 팀에도 없음(리그 이탈)
  if (foreignId && d > 4 && owner.has(foreignId)) fail(`day${d}: 방출 외인 ${foreignId} 가 ${tname(owner.get(foreignId)!)} 에 재등장(리그 이탈 위반)`);
}

log(`\n═══ 시즌 중 거래 이중 소속 검증 (${matchdays.length} 매치데이) ═══`);
log(`주입: 방출 ${txs.filter((t) => t.kind === 'release').length} · 영입 ${txs.filter((t) => t.kind === 'sign').length} (적대적 이중영입 1쌍 포함)`);
log(violations === 0
  ? `\n✅ 위반 0건 — 시즌 중 거래에서 선수 이중 소속/FA 누수 없음`
  : `\n❌ 위반 ${violations}건 — 위 로그 확인`);
process.exit(violations === 0 ? 0 : 1);
