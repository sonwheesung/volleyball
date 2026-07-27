// 경기 중 실시간 현수막(BROADCAST Phase 3) 가드. 추정 금지 — 실측.
//   buildLiveBanners(reconstructRallies(sim)) 를 다수 경기에 돌려:
//   ① 스포일러 안전(핵심): 각 배너 at은 rallies[0..at]만으로 재현(미래 미참조) + A/B 민감도(0..at-1엔 없음=오라클 비공허).
//   ② 세트 승자 정합: setwon 수==세트 수, 각 setwon side가 그 세트 최종 더 높은 점수(실제 승자).
//   ③ 빈도 sanity(스팸 아님): 경기당 배너 << 포인트 수, 0 아님. ④ 결정론(같은 sim 동일).
//   npx tsx tools/_dv_livebanner.ts [matches=40]
import { resetLeagueBase, LEAGUE, shortTeamName, getPlayer } from '../data/league';
import { buildMatchBox } from '../data/matchBox';
import { reconstructRallies, buildLiveBanners, type RallyState } from '../components/courtDirector';

const M = Math.max(4, Number(process.argv[2]) || 40);
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);

let totalBanners = 0, totalPoints = 0, totalMatches = 0;
let spoilerLeak = 0, oracleVacuous = 0, setMismatch = 0, detBad = 0, setwonTotal = 0, setCountMismatch = 0;
const kindTally: Record<string, number> = {};

let mi = 0;
outer:
for (let h = 0; h < ids.length; h++) {
  for (let a = 0; a < ids.length; a++) {
    if (h === a) continue;
    const seed = 1000 + mi * 7;
    const { sim, homeSquad, awaySquad } = buildMatchBox(ids[h], ids[a], 0, seed);
    const rallies = reconstructRallies(sim);
    const byId = new Map([...homeSquad, ...awaySquad].map((p) => [p.id, p] as const));
    const names = { homeName: shortTeamName(ids[h]), awayName: shortTeamName(ids[a]), nameOf: (pid: string) => byId.get(pid)?.name ?? getPlayer(pid)?.name ?? '선수' };
    const live = buildLiveBanners(rallies, 'home', names);

    totalMatches++; totalPoints += rallies.length; totalBanners += live.length;
    for (const b of live) kindTally[b.banner.kind] = (kindTally[b.banner.kind] ?? 0) + 1;

    // ① 스포일러: prefix 재현 + A/B 민감도
    for (const b of live) {
      const incl = buildLiveBanners(rallies.slice(0, b.at + 1), 'home', names); // 0..at 포함 → 재현돼야
      if (!incl.some((x) => x.at === b.at && x.banner.title === b.banner.title)) spoilerLeak++;
      const excl = buildLiveBanners(rallies.slice(0, b.at), 'home', names);      // 0..at-1 → at 배너 없어야(오라클 민감)
      if (excl.some((x) => x.at === b.at && x.banner.title === b.banner.title)) oracleVacuous++;
    }

    // ② 세트 승자 정합 — setwon banner side가 그 세트 최종 더 높은 점수
    const setwon = live.filter((b) => b.banner.kind === 'setwon');
    setwonTotal += setwon.length;
    const sets = sim.homeSets + sim.awaySets;
    if (setwon.length !== sets) setCountMismatch++;
    for (const b of setwon) {
      const r = rallies[b.at];
      const winnerHigher = r.scorer === 'home' ? r.home > r.away : r.away > r.home;
      const titledHome = b.banner.title.startsWith(names.homeName);
      if (!winnerHigher || (titledHome !== (r.scorer === 'home'))) setMismatch++;
    }

    // ④ 결정론 — 같은 sim 두 번 동일(제목 시퀀스)
    const live2 = buildLiveBanners(rallies, 'home', names);
    if (JSON.stringify(live.map((x) => [x.at, x.banner.title])) !== JSON.stringify(live2.map((x) => [x.at, x.banner.title]))) detBad++;

    if (++mi >= M) break outer;
  }
}

const perMatch = totalBanners / totalMatches;
console.log(`\n═══ 실시간 현수막 (${totalMatches}경기, 평균 ${(totalPoints / totalMatches).toFixed(0)}포인트) ═══`);
console.log(`  배너 ${totalBanners}건 · 경기당 ${perMatch.toFixed(1)} · 종류: ${Object.entries(kindTally).map(([k, c]) => `${k}:${c}`).join(' · ')}`);
console.log(`  스포일러 누출 ${spoilerLeak} · 오라클 공허 ${oracleVacuous} · 세트승자 불일치 ${setMismatch} · 세트수 불일치 ${setCountMismatch} · 결정론위반 ${detBad}`);

check('① 스포일러 안전 — 모든 배너 rallies[0..at]로 재현(미래 미참조)', spoilerLeak === 0, `${spoilerLeak}건`);
check('① A/B 민감도 — 0..at-1엔 그 배너 없음(prefix 오라클 비공허)', oracleVacuous === 0, `${oracleVacuous}건`);
check('② 세트 승자 정합 — setwon side==그 세트 최종 우위', setMismatch === 0, `${setMismatch}건`);
check('② 세트 수 정합 — setwon 수==경기 세트 수', setCountMismatch === 0, `${setCountMismatch}건`);
check('③ 빈도 sanity — 경기당 2~20건·포인트보다 훨씬 적음(스팸 아님)', perMatch >= 1 && perMatch <= 20 && totalBanners < totalPoints * 0.3, `경기당 ${perMatch.toFixed(1)}`);
check('④ 결정론 — 같은 sim 동일', detBad === 0, `${detBad}건`);
check('⑤ 세트 획득 배너 발화(>0)', setwonTotal > 0, `${setwonTotal}`);

// ── ⑥ 배너 에이스 = 직접(노터치) 에이스만 (정의 A/B, 2026-07-28) ──
//   엔진은 recvErr(리시브 범실 간접 에이스)에 byId를 안 실으므로(rally.ts recvId만) 실전 rallies엔
//   recvErr+byId 조합이 없다. 합성으로 "recvErr에 byId가 있다면"을 주입해도 배너가 안 떠야 정의(direct-only)가 성립.
//   옛 `|| r.how==='recvErr'` 분기(사문)면 이 합성이 acemulti를 띄운다 → mutant FAIL(오라클 이빨).
//   ※ 박스스코어 srvAce는 리시브범실 간접 에이스까지 포함(FIVB 공식) — 배너와 정의가 다름(BROADCAST §Phase3).
{
  const synNames = { homeName: '홈', awayName: '원', nameOf: (pid: string) => pid };
  const mkR = (how: 'ace' | 'recvErr', byId: string, i: number): RallyState => ({
    setNo: 1, home: i + 1, away: 0, scorer: 'home', how, byId,
    serving: 'home', homeRot: 0, awayRot: 0, homeSetsBefore: 0, awaySetsBefore: 0,
  });
  // A: 직접 에이스 3개(임계 ACE_TH=3) → acemulti 1건 발화(배너 에이스 살아있음)
  const aceBanners = buildLiveBanners([0, 1, 2].map((i) => mkR('ace', 'P_ace', i)), 'home', synNames).filter((b) => b.banner.kind === 'acemulti');
  // B: recvErr(byId 주입) 3개 → acemulti 0건(배너=직접만·recvErr 분기 제거)
  const recvBanners = buildLiveBanners([0, 1, 2].map((i) => mkR('recvErr', 'P_recv', i)), 'home', synNames).filter((b) => b.banner.kind === 'acemulti');
  check('⑥ 직접 에이스 3개 → acemulti 발화(배너 에이스 정의 살아있음)', aceBanners.length === 1, `${aceBanners.length}건(기대 1)`);
  check('⑥ A/B 민감도 — recvErr(byId 주입) 3개 → acemulti 0(배너=직접만·옛 recvErr 분기면 FAIL)', recvBanners.length === 0, `${recvBanners.length}건(기대 0)`);
}

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
process.exit(fail > 0 ? 1 : 0);
