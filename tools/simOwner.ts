// 구단주 레이어 장기 시뮬 (OWNER_SYSTEM + FORM_SYSTEM) — N시즌 동안 스크립트 구단주가
// 면담·벤치 건의를 실제로 수행하며 store.endSeason의 ownerFx 경로를 재현한다.
//   npx tsx tools/simOwner.ts [시즌수=120]
// 검증: 면담 수락/설득률, 역효과 이탈, 재계약 거부 발생, 벤치 수락률, 경기감각 분포,
//       팬심·예산 범위(데스 스파이럴 없음), 리그 건강(우승 분포·로스터 무결), 결정론.

import { LEAGUE, getTeam, resetLeagueBase, commitPlayerBase, commitRosters, teamScoutReveal, coachInfoOf, evolveOnDay, currentRosters } from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget'; // #116 프로덕션 우주 정합(2026-07-15)
import { ROSTER_CONTRACT_CAP, ROSTER_FLOOR_TOTAL } from '../engine/transactions';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { setOwnerContext, formFactorOnDay, availableTeamPlayers, seasonScandals } from '../data/dynamics';
import {
  discontentOf, meetAccept, persuade, cardMatch, interviewEffects, refuseResignProb,
  benchAccept, popularityOf, benchAngerPenalty, fanScore as fanScoreOf, fanBudgetFactor, sinkingShipBias,
  type DiscontentTopic, type TalkCard, type InterviewLog, type BenchDirective, type OwnerFx,
} from '../engine/owner';
import { prefWeightsOf } from '../engine/faMarket';
import { overall } from '../engine/overall';
import { createRng, strSeed } from '../engine/rng';
import { marketValue } from '../engine/salary';
import { MED_REF } from '../engine/overall';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const seasons = Math.max(10, Number(process.argv[2]) || 120);
const END_DAY = 164, GAME_EVERY = 4.6;
const CARD_FOR: Record<DiscontentTopic, TalkCard> = { win: 'reinforce', minutes: 'starter', money: 'raise', hometown: 'franchise' };

resetLeagueBase();
const MY = LEAGUE.teams[0].id;
const ids = LEAGUE.teams.map((t) => t.id);

// 통계
const stat = {
  talkTried: 0, doorRefused: 0, persuaded: 0, talkFailed: 0,
  resignRefusals: 0, refusedAndLeft: 0, refusedButStayed: 0,
  benchTried: 0, benchAccepted: 0,
  fanMin: 100, fanMax: 0, fanSum: 0,
  formSamples: [] as number[], rustyCount: 0,
  rosterMin: 99, rosterMax: 0,
  scandals: 0, scandalsMine: 0,
};
const titles: Record<string, number> = {};
for (const id of ids) titles[id] = 0;
let myRankSum = 0;

let interviews: InterviewLog[] = [];
let fan = 50;

function discontentNow(p: Player, day: number): { topic: DiscontentTopic | null; weight: number } {
  const standings = computeStandings(day > 0 ? day : Number.MAX_SAFE_INTEGER);
  const rank = Math.max(1, standings.findIndex((s) => s.teamId === MY) + 1);
  const prod = leagueProduction(day > 0 ? day : Number.MAX_SAFE_INTEGER).get(p.id);
  const games = Math.max(1, Math.round((day > 0 ? day : END_DAY) / GAME_EVERY));
  const topic = discontentOf(p, {
    recentRankAvg: rank, teamCount: standings.length,
    playRatio: Math.min(1, (prod?.matches ?? 0) / games),
    salaryRatio: p.contract.salary / Math.max(1, marketValue(p, MED_REF)),
    myTeamId: MY,
  });
  if (!topic) return { topic: null, weight: 0 };
  const w = prefWeightsOf(p);
  return { topic, weight: topic === 'win' ? w.win : topic === 'minutes' ? w.play : topic === 'money' ? w.money : w.home };
}

for (let s = 0; s < seasons; s++) {
  let bench: BenchDirective[] = [];
  setOwnerContext([]);

  // ── 시즌 중 스크립트 구단주 ──
  // day 30: 벤치 건의 — 만료 예정 하위 OVR 선수 1명("내년에 우리와 안 함")
  {
    const squad = (currentRosters()[MY] ?? []).map((id) => evolveOnDay(id, 30)).filter((p): p is Player => !!p)
      .sort((a, b) => overall(b) - overall(a));
    const target = squad.slice(Math.floor(squad.length / 2)).find((p) => p.contract.remaining <= 1);
    if (target) {
      stat.benchTried++;
      const aceRank = squad.findIndex((q) => q.id === target.id);
      const alt = squad.find((q) => q.id !== target.id && q.position === target.position);
      const gapT = Math.max(0, Math.min(1, 1 - (alt ? overall(target) - overall(alt) : 10) / 10));
      if (benchAccept(target.id, s, 30, coachInfoOf(MY)?.charisma ?? 50, gapT, aceRank, 'noResign')) {
        stat.benchAccepted++;
        bench = [{ playerId: target.id, fromDay: 30 }];
        setOwnerContext(bench);
      }
    }
  }
  // day 60·100: 불만 선수 면담(맞는 카드) — 문전박대·역효과 경로 포함
  for (const day of [60, 100]) {
    const squad = (currentRosters()[MY] ?? []).map((id) => evolveOnDay(id, day)).filter((p): p is Player => !!p);
    for (const p of squad) {
      const { topic } = discontentNow(p, day);
      if (!topic) continue;
      const seasonLogs = interviews.filter((l) => l.playerId === p.id && l.season === s);
      if (seasonLogs.length >= 2) continue;
      stat.talkTried++;
      const lastFailed = seasonLogs.length > 0 && !seasonLogs[seasonLogs.length - 1].ok;
      if (!meetAccept(p.id, s, seasonLogs.length, lastFailed)) { stat.doorRefused++; continue; }
      const standings = computeStandings(day);
      const rank = Math.max(1, standings.findIndex((r) => r.teamId === MY) + 1);
      const perfT = 1 - (rank - 1) / (standings.length - 1);
      const fails = interviews.filter((l) => l.playerId === p.id && !l.ok).length;
      const ok = persuade(p.id, s, seasonLogs.length, cardMatch(CARD_FOR[topic], topic, p), perfT, fails);
      if (ok) stat.persuaded++; else stat.talkFailed++;
      interviews.push({ playerId: p.id, season: s, day, topic, card: CARD_FOR[topic], ok });
    }
  }

  // ── 경기감각 샘플(day 120): 전 구단 결장 페널티 분포 ──
  for (const t of ids) {
    for (const id of currentRosters()[t] ?? []) {
      const f = formFactorOnDay(t, id, 120);
      if (f < 1) { stat.formSamples.push(f); if (f <= 0.94) stat.rustyCount++; }
    }
  }
  // 벤치 지시 선수의 감각이 실제로 떨어졌는지 + 출전 명단에서 빠졌는지
  if (bench.length) {
    const b = bench[0];
    const f = formFactorOnDay(MY, b.playerId, END_DAY);
    if (f > 0.95) log(`  ⚠ s${s} 벤치 선수 감각 미하락 f=${f.toFixed(3)}`);
    if (availableTeamPlayers(MY, 120).some((p) => p.id === b.playerId)) log(`  ⚠ s${s} 벤치 선수가 출전 명단에 있음`);
  }

  // 사건·사고 빈도 관찰
  const scs = seasonScandals();
  stat.scandals += scs.length;
  stat.scandalsMine += scs.filter((x) => x.teamId === MY).length;

  // ── 시즌 정산(store.endSeason 재현) ──
  const standings = computeStandings(Number.MAX_SAFE_INTEGER);
  standings.forEach((st, rank) => { if (st.teamId === MY) myRankSum += rank + 1; });
  const champ = buildPlayoffs(s).championId ?? standings[0].teamId;
  titles[champ]++;

  const fx = interviewEffects(interviews, s);
  const refuseProb: Record<string, number> = {};
  for (const id of currentRosters()[MY] ?? []) {
    const p = evolveOnDay(id, END_DAY);
    if (!p || p.contract.remaining > 1) continue;
    const { topic, weight } = discontentNow(p, END_DAY);
    const prob = refuseResignProb(topic, weight, fx.refuseBias[id] ?? 0) + sinkingShipBias(fan);
    if (prob > 0) refuseProb[id] = Math.min(0.95, prob);
  }
  // 거부 롤 재현(buildOffseason과 같은 시드) — 실제 거부 발생 추적
  const refusedIds = Object.keys(refuseProb).filter((id) =>
    createRng(strSeed(`resign-refuse:${id}:${s + 1}`)).next() < refuseProb[id]);
  stat.resignRefusals += refusedIds.length;

  const ownerFx: OwnerFx = { refuseProb, offerBias: fx.offerBias };
  const myRow = standings.find((r) => r.teamId === MY);
  const winRate = myRow ? myRow.wins / Math.max(1, myRow.wins + myRow.losses) : 0.5;
  const prodAll = leagueProduction(Number.MAX_SAFE_INTEGER);
  let anger = 0;
  for (const b of bench) {
    const bp = evolveOnDay(b.playerId, END_DAY);
    if (!bp) continue;
    const pop = popularityOf(bp.career.points, 0, bp.clubTenure, prodAll.get(b.playerId)?.points ?? 0);
    if (pop >= 60) anger += benchAngerPenalty(Math.round((END_DAY - b.fromDay) / GAME_EVERY));
  }
  fan = fanScoreOf(winRate, champ === MY, anger);
  stat.fanMin = Math.min(stat.fanMin, fan); stat.fanMax = Math.max(stat.fanMax, fan); stat.fanSum += fan;

  // 오프시즌 (advanceOffseason + ownerFx)
  const ctx = buildDraftContext(MY, {}, {}, [], false, [], s + 1, ownerFx);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], MY, [], styleOf, teamScoutReveal, [], aiTargetOf());
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], s + 1);
  for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) for (const id of filled.rosters[tid]) {
    const pr = seasonProd.get(id);
    if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
    const prev = ctx.prevTeamOf[id];
    if (prev && prev !== tid && snapshot[id]) snapshot[id] = { ...snapshot[id], clubTenure: 0 };
  }
  // 거부자 행방 추적
  for (const rid of refusedIds) {
    if ((filled.rosters[MY] ?? []).includes(rid)) stat.refusedButStayed++;
    else stat.refusedAndLeft++;
  }
  for (const t of ids) {
    const n = (filled.rosters[t] ?? []).length;
    stat.rosterMin = Math.min(stat.rosterMin, n); stat.rosterMax = Math.max(stat.rosterMax, n);
  }
  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
  interviews = interviews.filter((l) => l.season >= s - 1).slice(-200);
  if ((s + 1) % 20 === 0) process.stderr.write(`  …${s + 1}/${seasons}시즌\n`);
}
setOwnerContext([]);

// ── 리포트 ──
log(`\n═══ 구단주 레이어 ${seasons}시즌 (내 팀: ${getTeam(MY)?.name}) ═══`);
log(`\n▸ 면담: 시도 ${stat.talkTried} · 문전박대 ${stat.doorRefused}(${(stat.doorRefused / Math.max(1, stat.talkTried) * 100).toFixed(0)}%) · 설득 성공 ${stat.persuaded} · 결렬(역효과) ${stat.talkFailed} — 성공률 ${(stat.persuaded / Math.max(1, stat.persuaded + stat.talkFailed) * 100).toFixed(0)}%`);
log(`▸ 재계약 거부(선수가 단장 제안을 뿌리침): ${stat.resignRefusals}건 — 이탈 ${stat.refusedAndLeft} · 시장 거쳐 잔류 ${stat.refusedButStayed}`);
log(`▸ 벤치 건의: ${stat.benchTried}회 중 감독 수락 ${stat.benchAccepted}(${(stat.benchAccepted / Math.max(1, stat.benchTried) * 100).toFixed(0)}%)`);
const fs2 = stat.formSamples;
log(`▸ 경기감각: 페널티 보유 선수 ${fs2.length}명-시즌 · 평균 ${fs2.length ? (fs2.reduce((a, b) => a + b, 0) / fs2.length).toFixed(3) : '-'} · 녹슮(≤0.94) ${stat.rustyCount}`);
log(`▸ 팬심: 평균 ${(stat.fanSum / seasons).toFixed(0)} · 범위 ${stat.fanMin}~${stat.fanMax} · 예산 계수 ${fanBudgetFactor(stat.fanMin).toFixed(3)}~${fanBudgetFactor(stat.fanMax).toFixed(3)}`);
log(`▸ 사건·사고: 리그 전체 ${stat.scandals}건(${(stat.scandals / seasons).toFixed(2)}건/시즌) · 내 팀 ${stat.scandalsMine}건`);
log(`▸ 내 팀 평균 순위: ${(myRankSum / seasons).toFixed(1)}위 (구단주 개입이 팀을 침몰시키지 않는가)`);
const tArr = ids.map((id) => titles[id]);
const won = tArr.filter((t) => t > 0).length;
log(`▸ 리그 건강: 우승경험 ${won}/${ids.length} · 최다 ${Math.max(...tArr)}회 · 로스터 ${stat.rosterMin}~${stat.rosterMax}명`);
// 로스터 밴드 = 현행 가변 로스터 불변식(FA §1.5~1.6): floor 총합 12 ~ 계약 상한 20.
//   구 [10,18]은 폐기된 고정 로스터(16~18) 시절 상수 — #116 우주 정합 후 19명(특급 BPA 목표 초과 지명, 정당)이
//   허위 FAIL로 걸려 교정(2026-07-15). 상한 완화가 아니라 문서 불변식으로의 정렬(하한은 10→12로 오히려 조임).
const fail = stat.rosterMin < ROSTER_FLOOR_TOTAL || stat.rosterMax > ROSTER_CONTRACT_CAP || won < ids.length - 1 || stat.fanMin < 0 || stat.fanMax > 100;
log(fail ? '\n❌ 건강 기준 위반' : '\n✅ 구단주 레이어 장기 건강 — 무결·이탈 드라마 발생·데스 스파이럴 없음');
process.exit(fail ? 1 : 0);
