// 면담 풀 트레이스 감사 — "선수가 면담에서 말한 대로 행동하는가"(서사-사실 일관성).
//   npx tsx tools/simTalkTrace.ts [시즌수=60]
// 면담마다 기록: 선수 성격(아키타입·가중치)·팀 상황(순위)·팀 구성(동포지션 서열)·카드·결과.
// 추적: 그 선수가 재계약을 거부했는가 → FA로 어디 갔는가 → 행선지가 불만 주제와 맞는가.
//   win   → 더 강한/높은 순위 팀으로 갔는가
//   minutes → 새 팀에서 동포지션 상위(주전권)인가
//   money → 연봉이 올랐는가
//   hometown → 선호팀으로 갔는가
// + 설득 성공자 vs 결렬자의 실제 잔류율 차이(면담이 효과가 있는가).

import { LEAGUE, getTeam, resetLeagueBase, commitPlayerBase, commitRosters, teamScoutReveal, coachInfoOf, evolveOnDay, currentRosters } from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget'; // #116 프로덕션 우주 정합(2026-07-15)
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { setOwnerContext } from '../data/dynamics';
import {
  discontentOf, meetAccept, persuade, cardMatch, interviewEffects, refuseResignProb, CARD_KO,
  type DiscontentTopic, type TalkCard, type InterviewLog, type OwnerFx,
} from '../engine/owner';
import { prefWeightsOf } from '../engine/faMarket';
import { overall, teamOverall } from '../engine/overall';
import { createRng, strSeed } from '../engine/rng';
import { marketValue } from '../engine/salary';
import { MED_REF } from '../engine/overall';
import type { Player, Position } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const seasons = Math.max(10, Number(process.argv[2]) || 60);
const END_DAY = 164, GAME_EVERY = 4.6;
const CARD_FOR: Record<DiscontentTopic, TalkCard> = { win: 'reinforce', minutes: 'starter', money: 'raise', hometown: 'franchise' };
const TOPIC_KO: Record<DiscontentTopic, string> = { win: '우승하고 싶다', minutes: '뛰고 싶다', money: '연봉이 박하다', hometown: '연고팀에 가고 싶다' };

resetLeagueBase();
const MY = LEAGUE.teams[0].id;
const tName = (id: string | undefined) => (id ? getTeam(id)?.name ?? id : '-');

interface TalkCase {
  season: number; name: string; pos: Position; age: number;
  archetype: string; weight: number;           // 성격
  myRank: number; posRank: number; posCount: number; // 팀 상황·구성(동포지션 서열)
  topic: DiscontentTopic; card: TalkCard; met: boolean; ok?: boolean;
  expiring: boolean; // 이번 시즌 계약 만료(거부권 행사 가능) — 면담 효과는 이들에게서 측정
  // 추적 결과
  refused?: boolean; stayed?: boolean; destTeam?: string;
  destRank?: number; destPosRank?: number; oldSalary?: number; newSalary?: number; preferred?: string;
  consistent?: boolean | null; // 행선지가 불만 주제와 일치? (잔류 시 null)
}
const cases: TalkCase[] = [];
let interviews: InterviewLog[] = [];

function discontentNow(p: Player, day: number): { topic: DiscontentTopic | null; weight: number } {
  const standings = computeStandings(day);
  const rank = Math.max(1, standings.findIndex((s) => s.teamId === MY) + 1);
  const prod = leagueProduction(day).get(p.id);
  const games = Math.max(1, Math.round(day / GAME_EVERY));
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

const posRankOf = (roster: Player[], p: Player): { rank: number; count: number } => {
  const same = roster.filter((q) => q.position === p.position).sort((a, b) => overall(b) - overall(a));
  return { rank: same.findIndex((q) => q.id === p.id) + 1, count: same.length };
};

for (let s = 0; s < seasons; s++) {
  setOwnerContext([]);
  const seasonCases: TalkCase[] = [];

  // day 60·100 면담 (simOwner와 동일 스크립트)
  for (const day of [60, 100]) {
    const squad = (currentRosters()[MY] ?? []).map((id) => evolveOnDay(id, day)).filter((p): p is Player => !!p);
    const standings = computeStandings(day);
    const myRank = Math.max(1, standings.findIndex((r) => r.teamId === MY) + 1);
    for (const p of squad) {
      const { topic, weight } = discontentNow(p, day);
      if (!topic) continue;
      const seasonLogs = interviews.filter((l) => l.playerId === p.id && l.season === s);
      if (seasonLogs.length >= 2) continue;
      const pr = posRankOf(squad, p);
      const c: TalkCase = {
        season: s, name: p.name, pos: p.position, age: p.age,
        archetype: p.faPref?.archetype ?? '?', weight: Math.round(weight * 100) / 100,
        myRank, posRank: pr.rank, posCount: pr.count,
        topic, card: CARD_FOR[topic], met: false,
        expiring: p.contract.remaining <= 1,
        oldSalary: p.contract.salary, preferred: p.faPref?.preferredTeamId,
      };
      const lastFailed = seasonLogs.length > 0 && !seasonLogs[seasonLogs.length - 1].ok;
      if (meetAccept(p.id, s, seasonLogs.length, lastFailed)) {
        c.met = true;
        const perfT = 1 - (myRank - 1) / (standings.length - 1);
        const fails = interviews.filter((l) => l.playerId === p.id && !l.ok).length;
        c.ok = persuade(p.id, s, seasonLogs.length, cardMatch(c.card, topic, p), perfT, fails);
        interviews.push({ playerId: p.id, season: s, day, topic, card: c.card, ok: c.ok });
      }
      (c as TalkCase & { pid?: string }).pid = p.id;
      seasonCases.push(c);
    }
  }

  // 시즌 정산 + 오프시즌(ownerFx 경로)
  const finalStandings = computeStandings(Number.MAX_SAFE_INTEGER);
  buildPlayoffs(s);
  const fx = interviewEffects(interviews, s);
  const refuseProb: Record<string, number> = {};
  for (const id of currentRosters()[MY] ?? []) {
    const p = evolveOnDay(id, END_DAY);
    if (!p || p.contract.remaining > 1) continue;
    const { topic, weight } = discontentNow(p, END_DAY);
    const prob = refuseResignProb(topic, weight, fx.refuseBias[id] ?? 0);
    if (prob > 0) refuseProb[id] = Math.min(0.95, prob);
  }
  const refusedIds = new Set(Object.keys(refuseProb).filter((id) =>
    createRng(strSeed(`resign-refuse:${id}:${s + 1}`)).next() < refuseProb[id]));
  const ownerFx: OwnerFx = { refuseProb, offerBias: fx.offerBias };

  const ctx = buildDraftContext(MY, {}, {}, [], false, [], s + 1, ownerFx);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], MY, [], styleOf, teamScoutReveal, [], aiTargetOf());
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], s + 1);
  for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) for (const id of filled.rosters[tid]) {
    const pr2 = seasonProd.get(id);
    if (pr2 && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr2);
    const prev = ctx.prevTeamOf[id];
    if (prev && prev !== tid && snapshot[id]) snapshot[id] = { ...snapshot[id], clubTenure: 0 };
  }

  // ── 면담 케이스 행방 추적 ──
  const teamOf = (pid: string): string | undefined =>
    Object.keys(filled.rosters).find((t) => filled.rosters[t].includes(pid));
  for (const c of seasonCases) {
    const pid = (c as TalkCase & { pid?: string }).pid!;
    c.refused = refusedIds.has(pid);
    const dest = teamOf(pid);
    c.stayed = dest === MY;
    if (!c.stayed && dest) {
      c.destTeam = dest;
      c.destRank = Math.max(1, finalStandings.findIndex((r) => r.teamId === dest) + 1);
      const destSquad = filled.rosters[dest].map((id) => snapshot[id]).filter((q): q is Player => !!q);
      const me = snapshot[pid];
      if (me) {
        c.destPosRank = posRankOf(destSquad, me).rank;
        c.newSalary = me.contract.salary;
      }
      // 행선지-불만 일관성
      const destOvr = teamOverall(destSquad);
      const myOvr = teamOverall((filled.rosters[MY] ?? []).map((id) => snapshot[id]).filter((q): q is Player => !!q));
      c.consistent =
        c.topic === 'win' ? (c.destRank < c.myRank || destOvr >= myOvr) :
        c.topic === 'minutes' ? (c.destPosRank ?? 9) <= 2 :
        c.topic === 'money' ? (c.newSalary ?? 0) >= (c.oldSalary ?? 0) :
        dest === c.preferred;
    } else c.consistent = null;
    cases.push(c);
  }

  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
  interviews = interviews.filter((l) => l.season >= s - 1).slice(-200);
  if ((s + 1) % 20 === 0) process.stderr.write(`  …${s + 1}/${seasons}\n`);
}
setOwnerContext([]);

// ── 리포트 ──
log(`\n═══ 면담 풀 트레이스 — ${seasons}시즌 · ${cases.length}건 ═══`);

// 표본: 이탈 사례(주제별 1건씩) 풀 트레이스
log(`\n▸ 표본 케이스 (이탈자, 주제별):`);
const shownTopics = new Set<string>();
for (const c of cases) {
  if (c.stayed !== false || !c.destTeam || shownTopics.has(c.topic)) continue;
  shownTopics.add(c.topic);
  log(`\n  [S${c.season + 1}] ${c.name} (${c.pos}·${c.age}세) — 성격: ${c.archetype}(가중 ${c.weight})`);
  log(`    팀 상황: ${c.myRank}위 · 팀 내 동포지션 ${c.posRank}/${c.posCount}번째`);
  log(`    면담: "${TOPIC_KO[c.topic]}" → 카드 "${CARD_KO[c.card]}" → ${!c.met ? '문전박대' : c.ok ? '설득 성공' : '결렬'}`);
  log(`    행방: 재계약 ${c.refused ? '거부' : '-'} → ${tName(c.destTeam)}(${c.destRank}위) 이적 · 동포지션 ${c.destPosRank}번째 · 연봉 ${c.oldSalary}→${c.newSalary}`);
  log(`    일관성: ${c.consistent ? '✅ 말한 대로 갔다' : '❌ 말과 다른 선택'}`);
}

// 집계 1: 설득 성공 vs 결렬 vs 문전박대 — 실제 잔류율
const byOutcome = (f: (c: TalkCase) => boolean) => {
  const xs = cases.filter(f);
  const stayed = xs.filter((c) => c.stayed).length;
  return { n: xs.length, stay: xs.length ? (stayed / xs.length * 100).toFixed(0) : '-' };
};
const okC = byOutcome((c) => c.met && c.ok === true);
const failC = byOutcome((c) => c.met && c.ok === false);
const doorC = byOutcome((c) => !c.met);
log(`\n▸ 면담 효과(잔류율, 전체): 설득 성공 ${okC.stay}% (${okC.n}건) vs 결렬 ${failC.stay}% (${failC.n}건) vs 문전박대 ${doorC.stay}% (${doorC.n}건)`);
// 핵심 측정: 만료자(거부권 행사 가능)만 — 면담이 실제로 마음을 잡는가
const okE = byOutcome((c) => c.expiring && c.met && c.ok === true);
const failE = byOutcome((c) => c.expiring && c.met && c.ok === false);
const doorE = byOutcome((c) => c.expiring && !c.met);
log(`▸ 면담 효과(잔류율, 계약 만료자만): 설득 성공 ${okE.stay}% (${okE.n}건) vs 결렬 ${failE.stay}% (${failE.n}건) vs 문전박대 ${doorE.stay}% (${doorE.n}건)`);

// 집계 2: 이탈자 행선지 일관성(주제별)
log(`▸ 이탈자 행선지 일관성 ("말한 대로 갔는가"):`);
for (const t of ['win', 'minutes', 'money', 'hometown'] as DiscontentTopic[]) {
  const left = cases.filter((c) => c.topic === t && c.stayed === false && c.consistent !== null);
  if (!left.length) { log(`    ${TOPIC_KO[t]}: 이탈 0건`); continue; }
  const yes = left.filter((c) => c.consistent).length;
  log(`    ${TOPIC_KO[t]}: ${left.length}건 이탈 — 일치 ${yes} (${(yes / left.length * 100).toFixed(0)}%)`);
}

const leftAll = cases.filter((c) => c.stayed === false && c.consistent !== null);
const consistAll = leftAll.filter((c) => c.consistent).length;
const okStay = Number(okC.stay), failStay = Number(failC.stay);
const healthy = okC.n > 10 && failC.n > 10 && okStay > failStay && (leftAll.length === 0 || consistAll / leftAll.length >= 0.6);
log(healthy
  ? `\n✅ 면담 서사 일관 — 설득이 잔류를 만들고(${okC.stay}%>${failC.stay}%), 이탈자 ${leftAll.length}명 중 ${consistAll}명(${(consistAll / Math.max(1, leftAll.length) * 100).toFixed(0)}%)이 말한 대로 갔다`
  : `\n❌ 서사 불일치 — 수치 점검 필요 (성공잔류 ${okC.stay}% vs 결렬잔류 ${failC.stay}%, 행선지 일치 ${leftAll.length ? (consistAll / leftAll.length * 100).toFixed(0) : '-'}%)`);
process.exit(healthy ? 0 : 1);
