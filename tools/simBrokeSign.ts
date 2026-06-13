// 돈 없는데 영입? — 매 시즌 (정산 후 현금) vs (실제 영입 지출)을 비교해 과지출 탐지.
//   npx tsx tools/simBrokeSign.ts [시즌=40]
// 스토어 endSeason 현금 흐름 재현: cash → settled=정산후 → faSpend(FA연봉+보상금) → cash=max(0,settled-faSpend).
// settled - faSpend < 0 이면 "돈 없는데 영입"(클램프로 숨겨진 과지출). 공격적으로 상위 FA를 노려 압박.
// 외인 트라이아웃 영입(비게이팅 가능)도 incoming 으로 잡아 비용에 포함.

import {
  resetLeagueBase, setMyTeamStaff, LEAGUE, getTeam, teamScoutReveal, commitPlayerBase, commitRosters,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { faMarketPreview } from '../data/offseason';
import { projectSettledCash } from '../data/financeProjection';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { overall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(2, Number(process.argv[2]) || 40);
resetLeagueBase();
const myTeam = LEAGUE.teams[0].id;
setMyTeamStaff(myTeam);
const tname = (id: string) => getTeam(id)?.name ?? id;
const money = (v: number) => `${(v / 10000).toFixed(2)}억`;

let cash = 50000; // 시작 운영 예비금(스토어 기본)
const fanScore = 50;
let overspends = 0, foreignOverInc = 0;
const samples: string[] = [];

for (let s = 1; s <= N; s++) {
  // 정산 후 현금(endSeason과 동일 기준)
  const settled = projectSettledCash(myTeam, s, cash, fanScore, []);

  // 상위 FA 6명 공격적으로 노림(현금 압박)
  const peek = faMarketPreview(myTeam, {}, {}, [], true, [], s, undefined, settled);
  const wish = [...peek.pool].map((id) => peek.snapshot[id]).filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => overall(b) - overall(a)).slice(0, 6).map((p) => p.id);

  const ctx = buildDraftContext(myTeam, {}, {}, wish, true, [], s, undefined, settled);
  const snapshot = ctx.snapshot;

  // 실제 영입 지출(스토어 faSpend 동일 규칙) — 내 새 명단의 타팀 출신 연봉 + 보상금
  let faSpend = ctx.compCash;
  let foreignInc = 0;
  for (const id of ctx.rosters[myTeam] ?? []) {
    const prev = ctx.prevTeamOf[id];
    if (prev && prev !== myTeam) {
      const sal = snapshot[id]?.contract.salary ?? 0;
      faSpend += sal;
      if (snapshot[id]?.isForeign) foreignInc += sal; // 외인 영입분(트라이아웃 — 현금 비게이팅 의심)
    }
  }

  if (settled - faSpend < 0) {
    overspends++;
    if (foreignInc > 0 && settled - (faSpend - foreignInc) >= 0) foreignOverInc++; // 외인 비용만 빼면 흑자 → 외인이 원인
    if (samples.length < 12) samples.push(`S${s}: 정산후 ${money(settled)} < 영입지출 ${money(faSpend)} (보상금 ${money(ctx.compCash)}·외인 ${money(foreignInc)}) → ${money(faSpend - settled)} 초과`);
  }

  cash = Math.max(0, settled - faSpend);

  // 진행
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal);
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
}

log(`\n═══ 돈 없는데 영입? ${N}시즌 (공격적 영입) ═══`);
for (const sm of samples) log(`  ⚠ ${sm}`);
log(`과지출(정산후 현금 < 영입지출) ${overspends}건${foreignOverInc ? ` · 그중 외인 트라이아웃이 원인 ${foreignOverInc}건` : ''}`);
log(overspends === 0
  ? `\n✅ 돈 없는데 영입한 경우 없음 — 현금 게이팅 정상`
  : `\n❌ ${overspends}건 — 보유 현금 초과 영입(클램프로 숨겨진 과지출)`);
process.exit(overspends === 0 ? 0 : 1);
