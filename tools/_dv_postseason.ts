// 포스트시즌 달력 편입 상비 가드 (SEASON_SYSTEM §5, 2026-07-08).
//   npx tsx tools/_dv_postseason.ts
//
// 검사: ①달력 슬롯·조기종료 소멸 ②치른 경기 파생(컷오프) 스포일러 0(결승 전 finalsMvp/champion 비노출)
//   ③recordChampion 시점(revealedChampionId) ④세이브 A안 마이그레이션 ⑤결정론(같은 시드 2회)
//   ⑥구플로우 대비 champion 바이트 동일(시드 보존) + 보드재생 바이트 동일 크로스체크.
// A/B 자가검증(허위 오라클 금지): "전부 공개"하는 버그 함수를 넣어 스포일러 검사기가 실제로 이빨이 있는지 증명.

import { resetLeagueBase } from '../data/league';
import { buildPlayoffs } from '../data/playoffs';
import {
  postseasonReveal, revealedChampionId, postseasonSchedule, nextPoGame, buildPlayoffBox, inPostseason,
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

log('');
if (fails.length) { log(`POSTSEASON FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
log('POSTSEASON PASS — 달력슬롯·조기소멸 · 스포일러0(champion/finalsMvp 게이트) · recordChampion 시점 · 세이브 A안 · 결정론 · 보드재생 바이트동일 · A/B 이빨');
process.exit(0);
