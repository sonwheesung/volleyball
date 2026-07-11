// 상설 가드 — 재계약 UX 격상(FA §2.5c-격상, EC-FA-17). 검증=Fable / 구현·문서=Opus.
//   npx tsx tools/_dv_resignfeedback.ts   (exit 0/1)
//
// 불변식:
//   ① 옵션 프리뷰 == resignOutlookNow(옵션 계약 override) — resignOptionOutlooks는 엔진 위임(재구현 아님). + 민감도 A/B(후하게 prob ≤ 표준, money).
//   ② reason/myResigned 분류가 실제 buildOffseason 버킷과 일치: pool→reason(refused/notOffered/capSqueezed)·roster→myResigned. 은퇴자는 둘 다 제외.
//   ③ 도장 뉴스가 수락자 집합과 일치(오프시즌 결산 1건) + resign은 개별 기사 미발화(스포일러 무해) + release 사유별 헤드라인.
//   ④ 결정론: buildOffseason·buildNewsFeed 재호출 동일.
import './_gt_mock';

import { resetLeagueBase, setMyTeamStaff, LEAGUE, getEvolvedTeamPlayers } from '../data/league';
import { buildOffseason } from '../data/offseason';
import { resignOptionOutlooks, resignOutlookNow } from '../data/owner';
import { marketVal } from '../data/awardSalary';
import { getPlayerProduction } from '../data/production';
import { willBeFA, prefWeightsOf } from '../engine/faMarket';
import { createRng, strSeed } from '../engine/rng';
import { buildNewsFeed } from '../data/news';
import type { OwnerFx } from '../engine/owner';
import type { Contract, SeasonArchive, Transfer } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

resetLeagueBase();
const my = LEAGUE.teams[0].id;
setMyTeamStaff(my);
const season = 0;
const nextSeason = 1;
const interviews: any[] = [];

// ── ① 옵션 프리뷰 == resignOutlookNow (엔진 위임 A/B) ──
{
  const DAY = 150;
  const players = getEvolvedTeamPlayers(my, DAY).filter((p) => !p.isForeign);
  let checked = 0, mismatch = 0, moneyTested = 0, monoOk = 0;
  for (const p of players) {
    const market = marketVal(p, getPlayerProduction(p.id, DAY));
    const oo = resignOptionOutlooks(p, market, my, DAY, interviews, season);
    for (const o of oo) {
      const contract: Contract = { salary: o.salary, years: o.years, remaining: o.years, signedAtAge: p.age };
      const expected = resignOutlookNow(p, my, DAY, interviews, season, { [p.id]: contract });
      checked++;
      if (Math.abs(o.outlook.prob - expected.prob) > 1e-9 || o.outlook.band !== expected.band) { mismatch++; if (mismatch <= 5) console.error(`   drift ${p.name}/${o.key}: ui=${o.outlook.prob} vs engine=${expected.prob}`); }
    }
    // 민감도(스텁/상수 아님): money 성향 선수는 후하게 prob ≤ 표준 prob(연봉↑→불만↓→거부↓)
    if (prefWeightsOf(p).money >= 0.25) {
      const std = oo.find((o) => o.key === 'standard')!.outlook.prob;
      const gen = oo.find((o) => o.key === 'generous')!.outlook.prob;
      moneyTested++;
      if (gen <= std + 1e-9) monoOk++;
    }
  }
  console.log(`── ① 옵션 프리뷰 위임 ── ${checked}옵션 검사 · 불일치 ${mismatch} · money 민감도 ${monoOk}/${moneyTested}`);
  ok(checked >= 9, `표본 충분(${checked})`);
  ok(mismatch === 0, `옵션 밴드·prob == resignOutlookNow(옵션 override) — 재구현 아님(불일치 ${mismatch})`);
  ok(moneyTested === 0 || monoOk === moneyTested, `money 후하게 prob ≤ 표준(단조 — 상수 아님, ${monoOk}/${moneyTested})`);
}

// ── ② reason/myResigned 분류 == 실제 버킷 (3 시나리오로 각 사유 강제) ──
const refusedRoll = (id: string, prob: number): boolean => {
  if (prob <= 0) return false;
  return createRng(strSeed(`resign-refuse:${id}:${nextSeason}`)).next() < prob;
};
let keptOff: ReturnType<typeof buildOffseason> | null = null; // ③에서 재사용(도장 뉴스)
{
  const expiringFA = getEvolvedTeamPlayers(my, 0).filter((p) => !p.isForeign && willBeFA(p));
  ok(expiringFA.length >= 2, `만료 FA 표본(${expiringFA.length})`);
  const seen: Record<string, number> = { refused: 0, notOffered: 0, capSqueezed: 0, resigned: 0 };
  let classChecked = 0, classBad = 0, retExcl = 0, retBad = 0, coverBad = 0;

  // 시나리오 3종: R=전원 refuseProb0.99(뿌리침) / N=전원 resignDecisions false·refuseProb0(미제안) / K=기본(잔류 도장)
  const scenarios: { tag: string; fx: OwnerFx; rd: Record<string, boolean> }[] = [
    { tag: 'R', fx: { refuseProb: Object.fromEntries(expiringFA.map((p) => [p.id, 0.99])), offerBias: {} }, rd: {} },
    { tag: 'N', fx: { refuseProb: {}, offerBias: {} }, rd: Object.fromEntries(expiringFA.map((p) => [p.id, false])) },
    { tag: 'K', fx: { refuseProb: {}, offerBias: {} }, rd: {} },
  ];
  for (const sc of scenarios) {
    const off = buildOffseason(my, sc.rd, {}, nextSeason, sc.fx);
    if (sc.tag === 'K') keptOff = off;
    const poolSet = new Set(off.pool);
    const rosterSet = new Set(off.rosters[my] ?? []);
    const retiredSet = new Set(off.retired);
    for (const p of expiringFA) {
      const id = p.id;
      if (retiredSet.has(id)) { retExcl++; if (off.myReleaseReasons[id] || off.myResigned.includes(id)) retBad++; continue; }
      classChecked++;
      if (poolSet.has(id)) {
        const reason = off.myReleaseReasons[id];
        const expected = refusedRoll(id, sc.fx.refuseProb[id] ?? 0) ? 'refused' : (sc.rd[id] === false ? 'notOffered' : 'capSqueezed');
        if (reason !== expected) { classBad++; if (classBad <= 5) console.error(`   [${sc.tag}] reason ${p.name}: got ${reason} want ${expected}`); }
        else seen[reason]++;
        if (off.myResigned.includes(id)) { classBad++; console.error(`   [${sc.tag}] ${p.name} pool+myResigned`); }
      } else if (rosterSet.has(id)) {
        if (!off.myResigned.includes(id)) { classBad++; if (classBad <= 5) console.error(`   [${sc.tag}] ${p.name} kept but not myResigned`); }
        else seen.resigned++;
        if (off.myReleaseReasons[id]) { classBad++; console.error(`   [${sc.tag}] ${p.name} kept but has reason`); }
      }
    }
    for (const id of Object.keys(off.myReleaseReasons)) if (!poolSet.has(id)) coverBad++;
    for (const id of off.myResigned) if (!rosterSet.has(id)) coverBad++;
  }
  console.log(`── ② 버킷 분류(3시나리오) ── 검사 ${classChecked} · 불일치 ${classBad} · 커버리지 오류 ${coverBad} · 관측 ${JSON.stringify(seen)} · 은퇴제외 ${retExcl}(위반 ${retBad})`);
  ok(classBad === 0, `reason/myResigned == 실제 버킷(불일치 ${classBad})`);
  ok(coverBad === 0, `사유맵⊆pool · 도장⊆roster(위반 ${coverBad})`);
  ok(retBad === 0, `은퇴자는 reason·도장 모두 제외(위반 ${retBad})`);
  ok(seen.refused >= 1 && seen.notOffered >= 1 && seen.resigned >= 1, `refused·notOffered·도장 모두 발화(${seen.refused}/${seen.notOffered}/${seen.resigned})`);
}

// ── ③ 도장 뉴스 == 수락자 집합 + resign 개별 미발화 + release 사유(body) ──
{
  const off = keptOff!;
  const resignT: Transfer[] = off.myResigned.map((id) => { const p = off.snapshot[id]; return { season, playerId: id, name: p.name, fromTeam: my, toTeam: my, kind: 'resign' as const, ovr: 80 }; });
  // 합성 방출(사유별) — 헤드라인 분기 확인용(내 팀 out, ovr 무관 발화)
  const relCap: Transfer = { season, playerId: 'z-cap', name: '가캡압', fromTeam: my, toTeam: '', kind: 'release', ovr: 70, reason: 'capSqueezed' };
  const relRef: Transfer = { season, playerId: 'z-ref', name: '나뿌림', fromTeam: my, toTeam: '', kind: 'release', ovr: 70, reason: 'refused' };
  const relNo: Transfer = { season, playerId: 'z-no', name: '다미제', fromTeam: my, toTeam: '', kind: 'release', ovr: 70, reason: 'notOffered' };
  const transfers: Transfer[] = [...resignT, relCap, relRef, relNo];
  const archive: SeasonArchive[] = [{ season, championId: '' }];
  const feed = buildNewsFeed(archive, [], [], nextSeason, [], [], Number.MAX_SAFE_INTEGER, my, transfers);
  const recap = feed.filter((n) => n.kind === 'offseason');
  const recapBody = recap.map((n) => (n.headline ?? '') + ' ' + (n.body ?? '')).join('\n');
  const resignNames = off.myResigned.map((id) => off.snapshot[id].name);
  const namesInRecap = resignNames.every((nm) => recapBody.includes(nm));
  ok(recap.length >= 1, `오프시즌 결산 뉴스 발화(${recap.length})`);
  ok(resignNames.length === 0 || (recapBody.includes('재계약 유지') && namesInRecap), `도장 ${resignNames.length}명 전원 결산에 표기·"재계약 유지"`);
  // resign 개별 기사 미발화(스포일러 무해) — resign 선수는 transfer/release 카테고리에 없어야
  const resignIdSet = new Set(off.myResigned);
  const standalone = feed.filter((n) => (n.kind === 'transfer' || n.kind === 'release') && n.body && resignNames.some((nm) => n.body!.includes(nm) && n.kind !== 'offseason'));
  ok(standalone.length === 0, `resign 선수 개별 이적/방출 기사 0(스포일러 무해, ${standalone.length})`);
  void resignIdSet;
  // release 사유별 리드(body — vh 헤드라인은 변주라 결정론 body로 검사)
  const relBodies = feed.filter((n) => n.kind === 'release').map((n) => n.body ?? '').join('\n');
  const hasCap = relBodies.includes('캡에 밀려');
  const hasRef = relBodies.includes('뿌리치고');
  const hasNo = relBodies.includes('제안하지 않아');
  ok(hasCap && hasRef && hasNo, `release 사유별 리드(캡압박·뿌리침·미제안: ${hasCap}/${hasRef}/${hasNo})`);

  // ── ④ 결정론 ── (K 시나리오 = 기본 입력 재호출)
  const off2 = buildOffseason(my, {}, {}, nextSeason, { refuseProb: {}, offerBias: {} });
  const sameReason = JSON.stringify(off.myReleaseReasons) === JSON.stringify(off2.myReleaseReasons);
  const sameResign = JSON.stringify([...off.myResigned].sort()) === JSON.stringify([...off2.myResigned].sort());
  const feed2 = buildNewsFeed(archive, [], [], nextSeason, [], [], Number.MAX_SAFE_INTEGER, my, transfers);
  const sameFeed = feed.length === feed2.length && feed.every((n, i) => n.headline === feed2[i].headline);
  ok(sameReason && sameResign, `buildOffseason 결정론(reason ${sameReason}·도장 ${sameResign})`);
  ok(sameFeed, `buildNewsFeed 결정론(${feed.length}==${feed2.length})`);
}

console.log(fail === 0 ? '\n✅ PASS — 재계약 UX 격상 가드 전항 통과' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
