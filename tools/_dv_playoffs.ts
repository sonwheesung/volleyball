// 포스트시즌(플레이오프 브라켓) 엔드투엔드 상비 가드 (SEASON_SYSTEM §5).
// 검증·실측=Fable 5 / 가드=Opus 에이전트, 2026-07-07.
//   npx tsx tools/_dv_playoffs.ts
//
// KOVO 여자부 방식(data/playoffs.ts buildPlayoffs · engine/playoffs.ts playSeries):
//   정규 1위 → 챔프전 직행(bye) / 2위(hi) vs 3위(lo) 준PO 3전2선승(PO_TARGET=2)
//   챔프전 1위(hi) vs PO 승자(lo) 5전3선승(FINAL_TARGET=3) / 상위시드 어드밴티지 HI_EDGE=1.03
//   결정론 시드: PO=90000+season*17, 결승=95000+season*17.
//   시드(진출 3팀) = computeStandings(MAX) 상위 3팀.
//
// 방법(고정 시드 위 몬테카를로): resetLeagueBase() 뒤 computeStandings 상위 3팀은 **불변**이다.
//   buildPlayoffs(s)의 season 인덱스는 오직 시리즈 RNG만 바꾸므로 — 같은 3팀을 두고 N=500회
//   서로 다른 시드로 플옵을 돌리는 몬테카를로가 된다. 매 판 불변식을 검사하고, 상위시드 승률·
//   챔피언 분포·시리즈 길이 분포를 집계한다.
//
// Fable 실측(이 가드가 재현/단언해야 하는 값, N=500):
//   · 불변식 위반 0/500
//   · 상위시드 승률: PO 2위(hi) 83.8% · 챔프전 1위(hi) 85.2% (둘 다 >50%)
//   · 챔피언 분포: 1위 85.2% · 2위 13.8% · 3위 1.0% (상위시드 우세, 이변 ~15% — 현실적)
//   · 시리즈 길이: PO 2게임=312/3게임=188 · 결승 3=214/4=172/5=114 (유효 best-of-3/5, 풀5차 결승 발생)
//   · 결정론: buildPlayoffs(7) 2회 → championId·시리즈 게임 완전 동일
//
// A/B 자가검증(허위 오라클 금지 — TEST_METHODOLOGY 빈 오라클 사각): 불변식 검사기가 이빨이 있는지
//   증명하려고 **의도적으로 오염된 Playoffs**(championId를 시드 밖 팀으로, po.hiId를 3시드로)를 만들어
//   검사기가 위반으로 잡아냄을 단언한 뒤, 실제 데이터는 통과함을 확인한다.
//   [mutant 결과] 오염 객체 → 4건 위반 검출(po.hiId≠seed2 · po.loId 잔존 대조 · championId∉seeds ·
//                championId≠final.winner), 실제 데이터 → 0 위반. 검사기 민감도 증명됨.

import { resetLeagueBase } from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs, type Playoffs } from '../data/playoffs';
import { buildPlayoffBox } from '../data/postseason'; // 보드 재생 바이트 공유 검증(2026-07-08 달력 편입)

const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };

const PO_TARGET = 2;    // 준PO 3전2선승
const FINAL_TARGET = 3; // 챔프전 5전3선승
const N = 500;

// ── 불변식 검사기 (한 판의 Playoffs가 KOVO 규칙을 지키는지) — 위반 사유 목록 반환 ──
function invariants(p: Playoffs, seeds: string[]): string[] {
  const v: string[] = [];
  const [s1, s2, s3] = seeds;
  // 진출 3팀 = 정규 상위 3팀
  if (p.seeds.length !== 3 || p.seeds[0] !== s1 || p.seeds[1] !== s2 || p.seeds[2] !== s3) {
    v.push(`seeds≠top3 [${p.seeds}]`);
  }
  // 준PO: 2위(hi) vs 3위(lo)
  if (!p.po) v.push('po 없음');
  else {
    if (p.po.hiId !== s2) v.push(`po.hiId=${p.po.hiId}≠seed2=${s2}`);
    if (p.po.loId !== s3) v.push(`po.loId=${p.po.loId}≠seed3=${s3}`);
    const g = p.po.series.games.length;
    if (g < PO_TARGET || g > 2 * PO_TARGET - 1) v.push(`po 게임수=${g} (2..3 밖)`);
    const w = Math.max(p.po.series.hiWins, p.po.series.loWins);
    if (w !== PO_TARGET) v.push(`po 승자 도달=${w}≠${PO_TARGET}`);
    if ((p.po.series.hiWon ? p.po.hiId : p.po.loId) !== p.po.winnerId) v.push('po winnerId 불일치');
  }
  // 챔프전: 1위(hi) vs PO 승자(lo)
  if (!p.final) v.push('final 없음');
  else {
    if (p.final.hiId !== s1) v.push(`final.hiId=${p.final.hiId}≠seed1=${s1}`);
    if (p.po && p.final.loId !== p.po.winnerId) v.push(`final.loId=${p.final.loId}≠PO승자=${p.po.winnerId}`);
    const g = p.final.series.games.length;
    if (g < FINAL_TARGET || g > 2 * FINAL_TARGET - 1) v.push(`final 게임수=${g} (3..5 밖)`);
    const w = Math.max(p.final.series.hiWins, p.final.series.loWins);
    if (w !== FINAL_TARGET) v.push(`final 승자 도달=${w}≠${FINAL_TARGET}`);
  }
  // 챔피언: 진출 3팀 중 하나, 그리고 챔프전 승자
  if (p.championId == null || !seeds.includes(p.championId)) v.push(`champion=${p.championId} ∉ seeds`);
  if (p.final && p.championId !== p.final.winnerId) v.push(`champion=${p.championId}≠final.winner=${p.final.winnerId}`);
  return v;
}

// 시리즈 승패 시퀀스 검증(hi 관점) — 각 게임 hiSets≠loSets, 승자 target 도달 후 종료
function seriesGamesValid(games: { hiSets: number; loSets: number }[], target: number): boolean {
  let hi = 0, lo = 0;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (g.hiSets === g.loSets) return false;      // 무승부 없음
    if (g.hiSets > g.loSets) hi++; else lo++;
    const done = hi === target || lo === target;
    if (done && i !== games.length - 1) return false; // 종료 후 추가 경기 없음
    if (!done && i === games.length - 1) return false; // 미종료로 끝남
  }
  return hi === target || lo === target;
}

// ── 준비: 정규 상위 3팀(불변 시드) ──
resetLeagueBase();
const standings = computeStandings(Number.MAX_SAFE_INTEGER);
const seeds = standings.slice(0, 3).map((s) => s.teamId);
log(`정규 상위 3팀(불변 시드): 1위=${seeds[0]} · 2위=${seeds[1]} · 3위=${seeds[2]}`);
log(`몬테카를로: 같은 3팀 위에 season=0..${N - 1} (시리즈 RNG만 변화) → N=${N}\n`);

// ── 몬테카를로: N=500 고정 시드 인덱스 ──
let violCount = 0;
let poHiWins = 0, finalHiWins = 0;
const champ = { s1: 0, s2: 0, s3: 0 };
const poLen: Record<number, number> = {};
const finalLen: Record<number, number> = {};
let seriesShapeBad = 0;

for (let s = 0; s < N; s++) {
  const p = buildPlayoffs(s);
  const v = invariants(p, seeds);
  if (v.length) { violCount++; if (violCount <= 5) log(`  위반 @season=${s}: ${v.join(' / ')}`); }

  if (p.po) {
    if (p.po.series.hiWon) poHiWins++;
    poLen[p.po.series.games.length] = (poLen[p.po.series.games.length] ?? 0) + 1;
    if (!seriesGamesValid(p.po.series.games, PO_TARGET)) seriesShapeBad++;
  }
  if (p.final) {
    if (p.final.series.hiWon) finalHiWins++;
    finalLen[p.final.series.games.length] = (finalLen[p.final.series.games.length] ?? 0) + 1;
    if (!seriesGamesValid(p.final.series.games, FINAL_TARGET)) seriesShapeBad++;
  }
  if (p.championId === seeds[0]) champ.s1++;
  else if (p.championId === seeds[1]) champ.s2++;
  else if (p.championId === seeds[2]) champ.s3++;
}

const pct = (n: number) => (100 * n / N).toFixed(1);
log('');
log(`불변식 위반: ${violCount}/${N}`);
log(`상위시드 승률: PO 2위(hi) ${pct(poHiWins)}% · 챔프전 1위(hi) ${pct(finalHiWins)}%`);
log(`챔피언 분포: 1위 ${pct(champ.s1)}% · 2위 ${pct(champ.s2)}% · 3위 ${pct(champ.s3)}%`);
log(`시리즈 길이 — PO: ${Object.entries(poLen).map(([k, n]) => `${k}게임=${n}`).join(' / ')}`);
log(`             결승: ${Object.entries(finalLen).map(([k, n]) => `${k}게임=${n}`).join(' / ')}`);
log('');

// ── (a) 불변식 0 위반 ──
check(violCount === 0, `불변식 위반 0/${N} (seeds=top3 · 2v3준PO · 1위직행결승 · champion∈seeds=final승자 · 시리즈 target도달)`);
check(seriesShapeBad === 0, `시리즈 승패 시퀀스 유효 0 이상(무승부 없음·target 도달 후 종료)`);

// ── (b) 상위시드 어드밴티지 ──
check(poHiWins / N > 0.5, `PO 상위시드(2위) 승률 > 50% — 실측 ${pct(poHiWins)}%`);
check(finalHiWins / N > 0.5, `챔프전 상위시드(1위) 승률 > 50% — 실측 ${pct(finalHiWins)}%`);
check(champ.s1 > champ.s2 && champ.s2 > champ.s3, `챔피언 분포 상위시드 우세 1위>2위>3위 (${champ.s1}>${champ.s2}>${champ.s3})`);

// ── (c) 결정론: buildPlayoffs(k) 두 번 동일 ──
{
  const K = 7;
  const a = buildPlayoffs(K), b = buildPlayoffs(K);
  const gamesEq = JSON.stringify(a.po?.series.games) === JSON.stringify(b.po?.series.games)
    && JSON.stringify(a.final?.series.games) === JSON.stringify(b.final?.series.games);
  check(a.championId === b.championId && gamesEq, `결정론: buildPlayoffs(${K}) 2회 → championId·시리즈 게임 동일`);
}

// ── A/B 자가검증(허위 오라클 금지): 오염 Playoffs를 검사기가 위반으로 잡는가 ──
{
  const good = buildPlayoffs(0);
  const realViol = invariants(good, seeds).length; // 실제 데이터 = 0 이어야
  // 오염: championId를 시드 밖 팀으로, po.hiId를 3시드로 바꿈(2v3 위반) — 검사기가 반드시 잡아야
  const corrupt: Playoffs = {
    seeds: good.seeds,
    po: good.po ? { ...good.po, hiId: seeds[2] } : null,      // hiId=3시드 → seed2 위반
    final: good.final,
    championId: 'ghost-team-XYZ',                              // 시드 밖 → ∉seeds 위반
  };
  const mutViol = invariants(corrupt, seeds).length;
  log(`  A/B: 오염객체(champion=시드밖 · po.hiId=3시드) → 위반 ${mutViol}건 검출 · 실제 데이터 → 위반 ${realViol}건`);
  check(mutViol >= 2, `mutant 감지: 오염 Playoffs가 ≥2건 위반으로 잡힘 (검사기 이빨 증명)`);
  check(realViol === 0, `실제 데이터는 0 위반 (오라클이 정상판을 잘못 잡지 않음)`);
}

// ── (d) 보드 재생 == series.games 바이트 동일(달력 편입 §5.1 — 최대 급소) ──
//   내 경기 보드는 buildPlayoffBox(playSeries 바이트 공유)로 재생 → 점수판(series.games[g])과 재생 세트스코어 일치.
//   box 빌더는 팀 무관 경로라 "내 팀(hi)·타 팀(lo) 매치업" 모두 같은 코드 — 준PO·결승 각 1케이스 + 전 시즌 스윕.
{
  let boardBad = 0, boardTotal = 0;
  for (let s = 0; s < 60; s++) {
    const p = buildPlayoffs(s);
    for (const round of ['po', 'final'] as const) {
      const m = round === 'po' ? p.po : p.final;
      if (!m) continue;
      for (let g = 0; g < m.series.games.length; g++) {
        boardTotal++;
        const box = buildPlayoffBox(s, round, g, p);
        if (box.sim.homeSets !== m.series.games[g].hiSets || box.sim.awaySets !== m.series.games[g].loSets) boardBad++;
      }
    }
  }
  check(boardBad === 0, `보드 재생 세트스코어 == series.games[g] (준PO·결승 전 게임, ${boardTotal}게임 전부 일치 · 내 팀=hi/타 팀=lo 공용 경로)`);
  // 명시 케이스: season 0 준PO g0(하위 시드=lo 관점) + 결승 g0(상위 시드=hi 관점)
  const p0 = buildPlayoffs(0);
  if (p0.po) { const b = buildPlayoffBox(0, 'po', 0, p0); check(b.sim.homeSets === p0.po.series.games[0].hiSets && b.sim.awaySets === p0.po.series.games[0].loSets, '보드재생 케이스: 준PO g0 세트스코어 == 점수판'); }
  if (p0.final) { const b = buildPlayoffBox(0, 'final', 0, p0); check(b.sim.homeSets === p0.final.series.games[0].hiSets && b.sim.awaySets === p0.final.series.games[0].loSets, '보드재생 케이스: 결승 g0 세트스코어 == 점수판'); }
}

log('');
if (fails.length) { log(`PLAYOFFS FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
const total = 11; // 상단 check 총수(기존 8 + 보드재생 스윕 1 + 명시 케이스 2)
log(`PLAYOFFS PASS (${total}/${total}) — 불변식 0/${N} · 상위시드 우세(PO ${pct(poHiWins)}%·결승 ${pct(finalHiWins)}%) · 챔피언 ${pct(champ.s1)}/${pct(champ.s2)}/${pct(champ.s3)} · 결정론 · mutant 자가검증`);
process.exit(0);
