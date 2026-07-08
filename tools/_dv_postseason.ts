// 포스트시즌 달력 편입 상비 가드 (SEASON_SYSTEM §5, 2026-07-08).
//   npx tsx tools/_dv_postseason.ts
//
// 검사: ①달력 슬롯·조기종료 소멸 ②치른 경기 파생(컷오프) 스포일러 0(결승 전 finalsMvp/champion 비노출)
//   ③recordChampion 시점(revealedChampionId) ④세이브 A안 마이그레이션 ⑤결정론(같은 시드 2회)
//   ⑥구플로우 대비 champion 바이트 동일(시드 보존) + 보드재생 바이트 동일 크로스체크.
// A/B 자가검증(허위 오라클 금지): "전부 공개"하는 버그 함수를 넣어 스포일러 검사기가 실제로 이빨이 있는지 증명.

import './_gt_mock'; // AsyncStorage/react-native 스텁 — ⑦ store 지갑·명단 액션 구동용(BEFORE store import)
import { resetLeagueBase } from '../data/league';
import { buildPlayoffs } from '../data/playoffs';
import {
  postseasonReveal, revealedChampionId, postseasonSchedule, nextPoGame, buildPlayoffBox, inPostseason,
  myPostseasonCalendarRows,
} from '../data/postseason';
import { currentSeasonAwards } from '../data/awards';
import { buildNewsFeed, newsKey } from '../data/news';
import { PO_SLOTS, FINAL_SLOTS, POSTSEASON_LAST_DAY, SEASON_DAYS } from '../engine/calendar';
import { migrateSave } from '../store/saveMigration';

const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };

resetLeagueBase();

// ── ① 달력 슬롯 매핑 + 조기종료 소멸 ──────────────────────────────
let slotOk = true, vanishOk = true;
for (let s = 0; s < 60; s++) {
  const p = buildPlayoffs(s);
  const sched = postseasonSchedule(p, null);
  for (const g of sched) {
    const slots = g.round === 'po' ? PO_SLOTS : FINAL_SLOTS;
    if (g.day !== slots[g.g]) slotOk = false;
  }
  // 조기종료 소멸: 스케줄 항목 수 == 실제 치른 게임 수(없는 g에 슬롯을 만들지 않음)
  const expected = (p.po ? p.po.series.games.length : 0) + (p.final ? p.final.series.games.length : 0);
  if (sched.length !== expected) vanishOk = false;
}
check(slotOk, '게임 인덱스 g → 고정 슬롯 day 매핑 정확(PO 167/169/171 · 결승 175/177/179/181/183)');
check(vanishOk, '시리즈 조기 종료 시 남은 슬롯 자연 소멸(스케줄 항목 == 치른 게임 수, N=60)');
check(POSTSEASON_LAST_DAY === FINAL_SLOTS[FINAL_SLOTS.length - 1] && POSTSEASON_LAST_DAY === 183, 'POSTSEASON_LAST_DAY=183(결승 마지막 슬롯)');
check(inPostseason(SEASON_DAYS + 1) && inPostseason(183) && !inPostseason(SEASON_DAYS) && !inPostseason(184), 'inPostseason 경계(165..183만 true)');

// ── ② 치른 경기 파생(컷오프) 스포일러 0 ───────────────────────────
// 진행 경로를 재현: currentDay를 슬롯마다 올리며 공개 게임이 단조 증가하고, 결승 마지막 슬롯 전엔 champion 비노출.
let spoilerLeak = 0, monotoneOk = true, finalsMvpLeak = 0;
for (let s = 0; s < 40; s++) {
  const p = buildPlayoffs(s);
  if (!p.final) continue;
  const lastFinalDay = FINAL_SLOTS[p.final.series.games.length - 1];
  let prevPo = 0, prevFinal = 0;
  for (let day = SEASON_DAYS; day <= POSTSEASON_LAST_DAY; day++) {
    const r = postseasonReveal(p, day);
    if (r.poRevealed < prevPo || r.finalRevealed < prevFinal) monotoneOk = false; // 단조 증가
    prevPo = r.poRevealed; prevFinal = r.finalRevealed;
    // 결승 마지막 슬롯 도달 전엔 champion·finalsMvp 비노출
    if (day < lastFinalDay) {
      if (r.championRevealed || revealedChampionId(p, day) !== null) spoilerLeak++;
      // 시상 게이트: seasonDone(uptoDay=164) but poDay=day<결승끝 → finalsMvp null(SeasonAwards엔 championId 필드 없음 — 챔프MVP가 우승 스포일러 표면)
      const aw = currentSeasonAwards(s, SEASON_DAYS, day);
      if (aw.finalsMvp !== null) finalsMvpLeak++;
    } else {
      if (revealedChampionId(p, day) !== p.championId) spoilerLeak++; // 도달 후엔 실제 챔피언
    }
  }
}
check(spoilerLeak === 0, '결승 전 게임 공개 전까지 champion 비노출 · 공개 후 실제 챔피언 (N=40 × 전 슬롯일)');
check(monotoneOk, '공개 게임 수는 currentDay 진행에 단조 증가(과거로 안 돌아감)');
check(finalsMvpLeak === 0, '시상 게이트: 결승 확정 전 currentSeasonAwards.finalsMvp = null(챔프MVP=우승 스포일러 0)');

// ── ②b 뉴스(playoff kind) — 치른 경기까지만 기사화 · 결승 확정 전 우승 기사 0 ─────
{
  const S = 3;
  const p = buildPlayoffs(S);
  const lastFinalDay = p.final ? FINAL_SLOTS[p.final.series.games.length - 1] : SEASON_DAYS;
  // recordChampion 전(archive 빈) 상태를 재현 — 결승 진행 중엔 champion 기사 0 + playoff 기사 = 공개 게임 수(+PO확정 기사).
  let newsLeak = 0, countBad = 0, monotone = true; let prevCount = -1;
  for (let day = SEASON_DAYS + 1; day < lastFinalDay; day++) {
    const feed = buildNewsFeed([], [], [], S, [], [], SEASON_DAYS, '', [], [], [], [], day);
    if (feed.some((n) => n.kind === 'champion' && n.season === S)) newsLeak++; // 우승 기사 누출
    const rv = postseasonReveal(p, day);
    const expect = rv.poRevealed + rv.finalRevealed + (rv.poDone ? 1 : 0); // 게임 기사 + PO확정(결승 대진) 기사
    const got = feed.filter((n) => n.kind === 'playoff').length;
    if (got !== expect) countBad++;
    if (got < prevCount) monotone = false;
    prevCount = got;
  }
  check(newsLeak === 0, '뉴스: 결승 확정 전 우승(champion) 기사 0 — archive(recordChampion) 게이트 경유');
  check(countBad === 0, '뉴스: playoff 기사 수 == 공개 게임 수 + PO확정 기사(치른 경기 파생 — 미래 게임 기사 0)');
  check(monotone, '뉴스: playoff 기사 수 단조 증가(진행 역행 없음)');
  // 결정론 + 읽음키 안정: 같은 day 두 번 == 동일 키 시퀀스, 진행해도 기존 기사 키 불변(append-only)
  const keysAt = (day: number) => buildNewsFeed([], [], [], S, [], [], SEASON_DAYS, '', [], [], [], [], day)
    .filter((n) => n.kind === 'playoff').map(newsKey).sort();
  const midDay = PO_SLOTS[1];
  const a = keysAt(midDay), b = keysAt(midDay), c = keysAt(POSTSEASON_LAST_DAY);
  check(JSON.stringify(a) === JSON.stringify(b), '뉴스: 같은 day 2회 → playoff 기사 키 동일(결정론)');
  check(a.every((k) => c.includes(k)), '뉴스: 진행 후에도 기존 기사 읽음키 불변(append-only — 읽음추적 안정)');
}

// ── ②c 시리즈 스코어 관점 축 — 경기 기사는 **승자 관점**(하위 시드 승리도 "승자 (시리즈 a-b)"에서 a=승자 누적) ───
//   버그: 시드 관점(hiW-loW)으로 쓰면 하위 시드가 이겨도 "화성 승리 (시리즈 0-1)"로 승자가 뒤지는 것처럼 읽힘.
//   불변식: 각 playoff 경기 기사의 시리즈 스코어 첫 수 = 그 경기 승자의 누적 승수(≥1, 방금 이겼으므로) · 둘째 수 = 패자 누적.
//   A/B: 시드 관점으로 되뒤집는 뮤턴트가 하위 시드 승리 경기에서 a<1(=0)을 내며 실패 → 검사기 이빨 증명.
{
  const parseSeries = (body: string): [number, number] | null => {
    const mm = /시리즈 스코어 (\d+)-(\d+)\./.exec(body);
    return mm ? [Number(mm[1]), Number(mm[2])] : null;
  };
  let perspBad = 0, checked = 0, mutantWouldFail = 0, lowerSeedWins = 0;
  for (let s = 0; s < 60; s++) {
    const p = buildPlayoffs(s);
    const feed = buildNewsFeed([], [], [], s, [], [], SEASON_DAYS, '', [], [], [], [], POSTSEASON_LAST_DAY);
    for (const [round, refBase] of [['po', 'po'], ['final', 'final']] as const) {
      const m = round === 'po' ? p.po : p.final;
      if (!m) continue;
      let hiW = 0, loW = 0;
      for (let g = 0; g < m.series.games.length; g++) {
        const gm = m.series.games[g];
        const hiWon = gm.hiSets > gm.loSets;
        if (hiWon) hiW++; else loW++;
        if (!hiWon) lowerSeedWins++;
        const wW = hiWon ? hiW : loW, lW = hiWon ? loW : hiW;                 // 승자 관점(정답)
        const buggyA = hiW;                                                    // 시드 관점(뮤턴트) 첫 수
        if (buggyA !== wW) mutantWouldFail++;                                  // 뮤턴트가 정답과 갈라지는 경기(=하위 시드 승)
        const art = feed.find((n) => n.kind === 'playoff' && n.ref === `${refBase}:${g}` && n.season === s);
        if (!art || !art.body) { perspBad++; continue; }
        const parsed = parseSeries(art.body);
        checked++;
        if (!parsed || parsed[0] !== wW || parsed[1] !== lW || parsed[0] < 1) perspBad++;
      }
    }
  }
  check(perspBad === 0, `뉴스: playoff 경기 기사 시리즈 스코어 = 승자 관점(첫 수=승자 누적≥1) — ${checked}기사 · N=60시즌`);
  check(lowerSeedWins > 0 && mutantWouldFail > 0,
    `A/B 이빨: 하위 시드 승리 경기 존재(${lowerSeedWins}건) → 시드 관점 뮤턴트는 그 경기에서 승자 누적을 오기(${mutantWouldFail}건)`);
}

// ── ③ recordChampion 시점(revealedChampionId) ─────────────────────
{
  const p = buildPlayoffs(3);
  const lastFinalDay = p.final ? FINAL_SLOTS[p.final.series.games.length - 1] : SEASON_DAYS;
  check(revealedChampionId(p, lastFinalDay - 1) === null, `recordChampion 게이트: 결승 확정(day ${lastFinalDay}) 직전엔 null`);
  check(revealedChampionId(p, lastFinalDay) === p.championId, `recordChampion 게이트: 결승 확정일에 실제 champion(${p.championId})`);
}

// ── ④ 세이브 A안 마이그레이션 ─────────────────────────────────────
{
  const base = { selectedTeamId: 't1', season: 5, currentDay: 164 };
  // (a) 우승 확정된 시즌(archive에 championId) + currentDay<183 → 183으로 승격
  const doneSave = migrateSave({ ...base, archive: [{ season: 5, championId: 'teamX' }] }, 2);
  check(doneSave.currentDay === 183, `A안: 정규완료+championId 존재 세이브 → currentDay 183 승격(실제 ${doneSave.currentDay})`);
  // (b) championId 없는(플옵 미소비) 세이브 → currentDay 불변
  const midSave = migrateSave({ ...base, currentDay: 100, archive: [] }, 2);
  check(midSave.currentDay === 100, `A안: 미소비 세이브(championId 없음) → currentDay 불변(실제 ${midSave.currentDay})`);
  // (c) 이미 183+인 신규 포스트시즌 세이브 → 불변(중복 승격 없음)
  const newSave = migrateSave({ ...base, currentDay: 183, archive: [{ season: 5, championId: 'teamX' }] }, 3);
  check(newSave.currentDay === 183, 'A안: 이미 183 세이브 → 불변');
}

// ── ⑤ 결정론(같은 시드 2회) ───────────────────────────────────────
{
  const a = buildPlayoffBox(11, 'final', 0);
  const b = buildPlayoffBox(11, 'final', 0);
  const eq = a.sim.homeSets === b.sim.homeSets && a.sim.awaySets === b.sim.awaySets
    && JSON.stringify(a.sim.setScores) === JSON.stringify(b.sim.setScores);
  check(eq, '결정론: buildPlayoffBox(11,final,0) 2회 → 세트스코어·세트별점수 동일');
}

// ── ⑥ 보드 재생 == series.games 바이트 동일(시드 보존) ────────────
{
  let bad = 0, total = 0;
  for (let s = 0; s < 40; s++) {
    const p = buildPlayoffs(s);
    for (const round of ['po', 'final'] as const) {
      const m = round === 'po' ? p.po : p.final;
      if (!m) continue;
      for (let g = 0; g < m.series.games.length; g++) {
        total++;
        const box = buildPlayoffBox(s, round, g, p);
        if (box.sim.homeSets !== m.series.games[g].hiSets || box.sim.awaySets !== m.series.games[g].loSets) bad++;
      }
    }
  }
  check(bad === 0, `보드 재생 세트스코어 == series.games[g] (내 팀·타 팀 매치업 공용 경로, ${total}게임 전부 일치)`);
  // 챔피언 시드 보존: 진화 클램프/시드 리팩터 후에도 buildPlayoffs.championId == 전 슬롯 진행 후 공개 챔피언
  let champOk = true;
  for (let s = 0; s < 40; s++) { const p = buildPlayoffs(s); if (revealedChampionId(p, POSTSEASON_LAST_DAY) !== p.championId) champOk = false; }
  check(champOk, '구플로우 대비 champion 바이트 동일(전 슬롯 진행 후 = buildPlayoffs.championId)');
}

// ── ⑧ 우리 팀 일정 포스트시즌 편입(app/calendar.tsx, SEASON §5.1.3) ──────────────
// teamScheduleEntries(정규만)의 구조적 누락을 캘린더가 myPostseasonCalendarRows로 메운다. 이 파생 로직을 검증:
//   진출 3팀은 각 ≥1경기 편입 · 첫 플옵 전(day165)엔 치른 경기 0(미래 결과 누수 0) · 미래는 다음 1경기만(브라켓 스포일러 0) · 미진출 0행.
{
  let entered = 0, rowsOk = true, spoilerOk = true, nextOnlyOk = true, resultOk = true;
  for (let s = 0; s < 40; s++) {
    const p = buildPlayoffs(s);
    if (p.seeds.length < 3) continue;
    for (const my of p.seeds) { // 진출 3팀
      entered++;
      // 포스트시즌 마지막 날 = 내 팀 전 경기 공개
      const rowsEnd = myPostseasonCalendarRows(p, my, POSTSEASON_LAST_DAY);
      if (rowsEnd.length === 0) rowsOk = false; // 진출팀은 최소 1경기
      // 편입 행의 세트스코어가 실제 시리즈 게임과 일치(내 팀 시점) — 결과 정합
      for (const r of rowsEnd) {
        const m = r.round === 'po' ? p.po! : p.final!;
        const g = m.series.games[r.g];
        const iAmHi = m.hiId === my;
        const myS = iAmHi ? g.hiSets : g.loSets, oppS = iAmHi ? g.loSets : g.hiSets;
        if (r.played && (r.myS !== myS || r.oppS !== oppS || r.win !== (myS > oppS) || r.isHome !== iAmHi)) resultOk = false;
      }
      // 첫 플옵 경기(167) 전날 = day165: 치른 경기 0, 예정(미래)은 다음 1경기만
      const rowsStart = myPostseasonCalendarRows(p, my, SEASON_DAYS + 1);
      if (rowsStart.some((r) => r.played)) spoilerOk = false;
      if (rowsStart.filter((r) => !r.played).length > 1) nextOnlyOk = false;
    }
  }
  check(rowsOk && entered > 0, `우리 팀 일정: 포스트시즌 진출 3팀 각 최소 1경기 편입(${entered} 팀·시즌)`);
  check(resultOk, '우리 팀 일정: 편입 행 세트스코어·홈/원정·승패 = 실제 시리즈 게임(내 팀 시점) 일치');
  check(spoilerOk, '우리 팀 일정: 첫 플옵 전(day165)엔 치른 경기 0(미래 결과 누수 0)');
  check(nextOnlyOk, '우리 팀 일정: 미래 경기는 "다음 1경기"만(더 깊은 브라켓 스포일러 0)');
  // 미진출(비참가) 팀 = 0행
  const p0 = buildPlayoffs(0);
  check(myPostseasonCalendarRows(p0, '__notInPlayoffs__', POSTSEASON_LAST_DAY).length === 0, '우리 팀 일정: 미진출 팀은 포스트시즌 경기 0행');
}

// ── A/B 자가검증: "전부 공개" 버그 함수가 스포일러를 낸다 → 검사기 이빨 증명 ──
{
  const p = buildPlayoffs(0);
  const lastFinalDay = p.final ? FINAL_SLOTS[p.final.series.games.length - 1] : SEASON_DAYS;
  const midDay = SEASON_DAYS + 2; // 결승 한참 전
  // 버그 오라클: 슬롯 무시하고 항상 챔피언 공개
  const buggyReveal = (): string | null => p.championId;
  const realHides = revealedChampionId(p, midDay) === null;
  const buggyLeaks = buggyReveal() !== null && midDay < lastFinalDay;
  log(`  A/B: 실제 revealedChampionId(day ${midDay})=${revealedChampionId(p, midDay)} · 버그오라클=${buggyReveal()}`);
  check(realHides && buggyLeaks, 'mutant 감지: "전부 공개" 버그는 결승 전 챔피언을 새고(누수), 실제 컷오프는 숨김(검사기 이빨)');
}

// ── ⑦ 플옵 기간 개입 차단 — store 지갑·명단 액션(SEASON §5.0, 2026-07-08) ──────────
// release·signInSeason·replaceForeign·replaceAsian 는 currentDay>SEASON_DAYS(플옵)면 no-op(false)이고
// 지갑(cash)·교체권(foreignSubUsed/asianSubUsed)·명단(inSeasonTx/released)을 절대 안 건드려야 한다.
//   플옵 엔트리는 164 동결이라 새 선수는 0경기 뛰는데 지갑·시즌1회 교체권만 소모되는 사각을 막는 가드.
// A/B 자가검증(경계 이빨 = "게이트 제거 모사"): 같은 셋업을 day=SEASON_DAYS(164, 정규 마지막날)에서 돌리면
//   성공(true·상태변경)해야 한다 — day를 1 올려 경계(>164)를 넘는 것만으로 결과가 뒤집힘 = 게이트가 유일한 차단 원인.
//   게이트를 제거하면 165 호출도 164처럼 성공해 아래 "차단" 검사가 FAIL하므로, 이 A/B가 오라클의 이빨을 증명한다.
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, evolveOnDay } = await import('../data/league');
  const { rosterIdsOnDay, setTxContext } = await import('../data/dynamics');
  const { FOREIGN_SALARY, ASIAN_SALARY } = await import('../engine/foreign');
  const G = () => useGameStore.getState();
  const REG = SEASON_DAYS;      // 164 — 정규 마지막날(허용)
  const PO = SEASON_DAYS + 1;   // 165 — 첫 포스트시즌 구간(차단)
  const my = LEAGUE.teams[0].id;
  const other = LEAGUE.teams[1].id;
  const ros = (t: string) => rosterIdsOnDay(t, 0).map((id) => evolveOnDay(id, 0));
  const domId = ros(my).find((p) => p && !p.isForeign)!.id;
  const altF = ros(other).find((p) => p && p.isForeign && !p.isAsianQuota)!.id; // 실 선수 id(setTxContext 안전)
  const altA = ros(other).find((p) => p && p.isAsianQuota)!.id;
  const fresh = () => { G().resetSave(); G().selectTeam(my); };

  // ⑦a release
  fresh(); G().setDay(REG);
  const relReg = G().release(domId) && G().released.length === 1 && G().inSeasonTx.length === 1;
  fresh(); G().setDay(PO); const cB = G().cash;
  const relPo = !G().release(domId) && G().released.length === 0 && G().inSeasonTx.length === 0 && G().cash === cB;
  check(relPo, 'release 플옵(day165) 차단 — false·released/inSeasonTx/cash 무변화');
  check(relReg, 'A/B: release 정규(day164) 성공·명단변경 — 경계 1일차로 뒤집힘(게이트가 유일 원인)');

  // ⑦b signInSeason — 방출로 FA 풀 주입 후 재영입
  const setupFA = (day: number) => {
    fresh();
    const tx: any[] = [{ day: 0, teamId: my, playerId: domId, kind: 'release' }];
    useGameStore.setState({ inSeasonTx: tx, released: [domId], cash: 9_999_999 });
    setTxContext(tx, G().faPool, my, 0);
    G().setDay(day);
  };
  setupFA(REG);
  const sigReg = G().signInSeason(domId) && G().inSeasonTx.some((t) => t.kind === 'sign' && t.playerId === domId);
  setupFA(PO); const cB2 = G().cash;
  const sigPo = !G().signInSeason(domId) && !G().inSeasonTx.some((t) => t.kind === 'sign') && G().cash === cB2;
  check(sigPo, 'signInSeason 플옵(day165) 차단 — false·sign tx/cash 무변화');
  check(sigReg, 'A/B: signInSeason 정규(day164) 성공(FA 재영입·경계 뒤집힘)');

  // ⑦c replaceForeign
  fresh(); useGameStore.setState({ foreignAltPool: [altF] }); G().setDay(REG);
  const cashF0 = G().cash;
  const frReg = G().replaceForeign(altF) && G().foreignSubUsed && G().cash === cashF0 - FOREIGN_SALARY;
  fresh(); useGameStore.setState({ foreignAltPool: [altF] }); G().setDay(PO); const cB3 = G().cash;
  const frPo = !G().replaceForeign(altF) && !G().foreignSubUsed && G().cash === cB3 && G().foreignAltPool.includes(altF) && G().inSeasonTx.length === 0;
  check(frPo, 'replaceForeign 플옵(day165) 차단 — false·교체권/cash/altPool/명단 무변화');
  check(frReg, 'A/B: replaceForeign 정규(day164) 성공·교체권소모·cash차감(경계 뒤집힘)');

  // ⑦d replaceAsian
  fresh(); useGameStore.setState({ asianAltPool: [altA] }); G().setDay(REG);
  const cashA0 = G().cash;
  const arReg = G().replaceAsian(altA) && G().asianSubUsed && G().cash === cashA0 - ASIAN_SALARY;
  fresh(); useGameStore.setState({ asianAltPool: [altA] }); G().setDay(PO); const cB4 = G().cash;
  const arPo = !G().replaceAsian(altA) && !G().asianSubUsed && G().cash === cB4 && G().asianAltPool.includes(altA) && G().inSeasonTx.length === 0;
  check(arPo, 'replaceAsian 플옵(day165) 차단 — false·교체권/cash/altPool/명단 무변화');
  check(arReg, 'A/B: replaceAsian 정규(day164) 성공·교체권소모·cash차감(경계 뒤집힘)');

  log('');
  if (fails.length) { log(`POSTSEASON FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
  log('POSTSEASON PASS — 달력슬롯·조기소멸 · 스포일러0(champion/finalsMvp 게이트) · recordChampion 시점 · 세이브 A안 · 결정론 · 보드재생 바이트동일 · 플옵개입차단(지갑4종) · A/B 이빨');
  process.exit(0);
})().catch((e) => { log(`POSTSEASON FAIL(exception) — ${e?.stack || e}`); process.exit(1); });
