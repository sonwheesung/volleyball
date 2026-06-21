// 파생데이터 무결성 퍼저 — 시상/마일스톤/HOF/통산누적(careerLog·careerTotals)은 경기 리플레이로
// 재계산 불가라 스토어가 endSeason마다 직접 누적한다. 장기 churn에서 중복(HOF·마일스톤)·이중집계·
// NaN·음수·미래참조가 끼는지, 실제 store.endSeason을 구동해 라이브 상태로 검사한다(재구현 오라클 금지).
// 추가로 도달 가능한 적대 입력(연속 endSeason 더블탭)이 파생데이터를 깨는지 찌른다.
// Usage: npx tsx tools/_gt_derived.ts [seasons] [seed]
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE } = await import('../data/league');
  const { evalAchievements, achievementSummary } = await import('../engine/achievements');
  const { ACHIEVEMENTS } = await import('../engine/achievements');

  const SEASONS = parseInt(process.argv[2] ?? '120', 10);
  const SEED = parseInt(process.argv[3] ?? '777', 10);
  const SEASON_END_DAY = 164;
  const LEGEND_POINTS = 7500;

  let rs = SEED >>> 0;
  const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  const pick = <T>(a: T[]): T | undefined => (a.length ? a[Math.floor(rnd() * a.length)] : undefined);

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  type V = { check: string; msg: string };
  const fin = (v: any) => typeof v === 'number' && Number.isFinite(v);

  // ── 파생 불변식 검사기 (라이브 상태) ──
  function checkDerived(tag: string): V[] {
    const out: V[] = [];
    const s = G();
    const season = s.season; // 현재(=다음) 시즌. 모든 영속 기록의 season < 현재 시즌이어야

    // 1) HOF — 중복 id 금지·수치 유한 비음수·legend⟹points≥LEGEND·은퇴시즌 과거
    const hofSeen = new Set<string>();
    for (const h of s.hallOfFame) {
      if (hofSeen.has(h.id)) out.push({ check: 'hofDup', msg: `${tag}: HOF dup id ${h.id}` });
      hofSeen.add(h.id);
      for (const k of ['points', 'blocks', 'digs', 'spikes', 'aces', 'assists', 'seasons'] as const) {
        if (!fin((h as any)[k]) || (h as any)[k] < 0) out.push({ check: 'hofNum', msg: `${tag}: HOF ${h.id} ${k}=${(h as any)[k]}` });
      }
      if (h.legend && h.points < LEGEND_POINTS) out.push({ check: 'hofLegend', msg: `${tag}: HOF ${h.id} legend but points=${h.points}` });
      if (!fin(h.retiredSeason) || h.retiredSeason >= season) out.push({ check: 'hofFuture', msg: `${tag}: HOF ${h.id} retired=${h.retiredSeason} >= cur ${season}` });
      if (!h.name) out.push({ check: 'hofName', msg: `${tag}: HOF ${h.id} empty name` });
    }

    // 2) archive — 시즌 중복 금지·미래 금지
    const archSeen = new Set<number>();
    for (const a of s.archive) {
      if (archSeen.has(a.season)) out.push({ check: 'archDup', msg: `${tag}: archive dup season ${a.season}` });
      archSeen.add(a.season);
      if (a.season >= season) out.push({ check: 'archFuture', msg: `${tag}: archive season ${a.season} >= cur ${season}` });
      if (a.standings && new Set(a.standings).size !== a.standings.length) out.push({ check: 'archStandDup', msg: `${tag}: archive ${a.season} standings dup` });
    }

    // 3) 마일스톤 — 정확 중복 금지(season+playerId+text)·미래 금지·바운드(big + 비big≤300)
    const msSeen = new Set<string>();
    let nonBig = 0;
    for (const m of s.milestones) {
      const key = `${m.season}|${m.playerId}|${m.text}`;
      if (msSeen.has(key)) out.push({ check: 'msDup', msg: `${tag}: milestone dup ${key}` });
      msSeen.add(key);
      if (m.season >= season) out.push({ check: 'msFuture', msg: `${tag}: milestone season ${m.season} >= cur ${season}` });
      if (!m.big) nonBig++;
    }
    if (nonBig > 300) out.push({ check: 'msBound', msg: `${tag}: non-big milestones ${nonBig} > 300` });

    // 4) careerTotals / careerLog — 유한 비음수
    for (const [k, v] of Object.entries(s.careerTotals)) if (!fin(v) || v < 0) out.push({ check: 'totNum', msg: `${tag}: careerTotals ${k}=${v}` });
    for (const [k, v] of Object.entries(s.careerLog)) if (!fin(v) || v < 0) out.push({ check: 'logNum', msg: `${tag}: careerLog ${k}=${v}` });

    // 5) evalAchievements(라이브) — cur 유한·0≤cur≤target·unlocked⟹cur==target·summary 정합
    const statuses = evalAchievements({
      myTeamId: my, archive: s.archive, hof: s.hallOfFame, milestones: s.milestones,
      cash: s.cash, fanScore: s.fanScore, careerLog: s.careerLog, careerTotals: s.careerTotals,
    });
    for (const st of statuses) {
      if (!fin(st.cur) || st.cur < 0 || st.cur > st.ach.target) out.push({ check: 'achCur', msg: `${tag}: ach ${st.ach.id} cur=${st.cur}/${st.ach.target}` });
      if (st.unlocked && st.cur !== st.ach.target) out.push({ check: 'achUnlock', msg: `${tag}: ach ${st.ach.id} unlocked but cur=${st.cur}!=${st.ach.target}` });
    }
    const sum = achievementSummary(statuses);
    if (sum.total !== ACHIEVEMENTS.length || sum.done > sum.total) out.push({ check: 'achSum', msg: `${tag}: summary ${sum.done}/${sum.total}` });

    return out;
  }

  // ── 누적기 단조성 추적(현실 churn에서 통산 누적은 비감소여야) ──
  let prevTot: Record<string, number> = {};
  let prevLog: Record<string, number> = {};
  let prevHof = 0, prevArch = 0;
  // 누적-기반 업적(cash/fan 제외)의 unlock 수는 비감소여야 — 회귀/이중집계 보정 누락 검출
  const cumIds = new Set(ACHIEVEMENTS.filter((a) => !a.id.startsWith('cash_') && !a.id.startsWith('fan_')).map((a) => a.id));
  let prevCumUnlocked = 0;

  function checkMonotone(tag: string): V[] {
    const out: V[] = [];
    const s = G();
    for (const [k, v] of Object.entries(s.careerTotals)) { if ((v as number) < (prevTot[k] ?? 0)) out.push({ check: 'totMono', msg: `${tag}: careerTotals.${k} ${prevTot[k]}→${v} 감소` }); }
    for (const [k, v] of Object.entries(s.careerLog)) { if ((v as number) < (prevLog[k] ?? 0)) out.push({ check: 'logMono', msg: `${tag}: careerLog.${k} ${prevLog[k]}→${v} 감소` }); }
    if (s.hallOfFame.length < prevHof) out.push({ check: 'hofMono', msg: `${tag}: HOF ${prevHof}→${s.hallOfFame.length} 감소` });
    if (s.archive.length < prevArch) out.push({ check: 'archMono', msg: `${tag}: archive ${prevArch}→${s.archive.length} 감소` });
    prevTot = { ...s.careerTotals } as any; prevLog = { ...s.careerLog } as any;
    prevHof = s.hallOfFame.length; prevArch = s.archive.length;
    const statuses = evalAchievements({ myTeamId: my, archive: s.archive, hof: s.hallOfFame, milestones: s.milestones, cash: s.cash, fanScore: s.fanScore, careerLog: s.careerLog, careerTotals: s.careerTotals });
    const cumUnlocked = statuses.filter((st) => st.unlocked && cumIds.has(st.ach.id)).length;
    if (cumUnlocked < prevCumUnlocked) out.push({ check: 'achMono', msg: `${tag}: 누적업적 unlock ${prevCumUnlocked}→${cumUnlocked} 감소` });
    prevCumUnlocked = cumUnlocked;
    return out;
  }

  G().resetSave();
  G().selectTeam(my);
  const violations: V[] = [];

  // ── 장기 churn: 시즌 완주(setDay) + 가벼운 GM 액션 섞고 endSeason ──
  for (let yr = 0; yr < SEASONS; yr++) {
    // 시즌 중 GM 활동(careerLog 성장: 면담·코치·스카우터)
    if (rnd() < 0.5) { const id = pick(useGameStore.getState().selectedTeamId ? (await import('../data/league')).currentRosters()[my] ?? [] : []); if (id) try { G().requestInterview(id, 'reinforce'); } catch {} }
    if (rnd() < 0.3) { const c = pick((await import('../data/league')).availableCoaches(my)); if (c) G().hireCoach(c.id); }
    if (rnd() < 0.3) { const sc = pick((await import('../data/league')).availableScouts()); if (sc) G().hireScout(sc.id); }
    G().setDay(SEASON_END_DAY); // 정규시즌 완주 — 리플레이가 전 경기 생산을 채움
    try { G().endSeason(); } catch (e: any) { violations.push({ check: 'CRASH', msg: `yr${yr} endSeason: ${e?.message}` }); break; }
    violations.push(...checkDerived(`yr${yr}`));
    violations.push(...checkMonotone(`yr${yr}`));
    if (violations.length > 80) break;
  }

  const cleanSeasons = G().season;
  const cleanViolations = violations.length;
  console.log(`=== DERIVED churn (${SEASONS} seasons, seed=${SEED}) ===`);
  console.log(`도달 시즌=${cleanSeasons} · HOF=${G().hallOfFame.length} · archive=${G().archive.length} · milestones=${G().milestones.length}`);
  console.log(`careerTotals=${JSON.stringify(G().careerTotals)}`);
  console.log(`clean 불변식 위반=${cleanViolations}`);
  violations.slice(0, 20).forEach((v) => console.log(`  (${v.check}) ${v.msg}`));

  // ── 적대 1: 도달 가능한 더블탭 — endSeason 직후 또 endSeason(빈 시즌 전진) ──
  const beforeHof = G().hallOfFame.length, beforeArch = G().archive.length, beforeSeason = G().season;
  const beforeTot = { ...G().careerTotals };
  G().endSeason(); // 더블탭(경기 0 플레이된 빈 시즌)
  const dtV = checkDerived('doubletap');
  const dtHofDup = G().hallOfFame.length - beforeHof; // 빈 시즌이라 HOF 추가는 0이 정상(중복 아님)
  const dtSeasonJump = G().season - beforeSeason;
  console.log(`\n--- 적대1: endSeason 더블탭(도달가능) ---`);
  console.log(`season ${beforeSeason}→${G().season}(+${dtSeasonJump}) · HOF +${dtHofDup} · archive +${G().archive.length - beforeArch}`);
  console.log(`careerTotals 변화: pts +${G().careerTotals.points - beforeTot.points} (빈 시즌이면 0 근처)`);
  console.log(`더블탭 후 파생 불변식 위반=${dtV.length}`);
  dtV.slice(0, 10).forEach((v) => console.log(`  (${v.check}) ${v.msg}`));

  // ── A/B 자가검증 — 깨진 상태 주입 시 각 체크가 잡는가 ──
  const ab: string[] = [];
  const dupH = G().hallOfFame[0];
  if (dupH) { useGameStore.setState({ hallOfFame: [...G().hallOfFame, { ...dupH }] }); ab.push(`hofDup검출=${checkDerived('ab').some((v) => v.check === 'hofDup')}`); }
  useGameStore.setState({ careerTotals: { ...G().careerTotals, points: NaN } as any });
  ab.push(`totNaN검출=${checkDerived('ab').some((v) => v.check === 'totNum')}`);
  useGameStore.setState({ careerTotals: { points: 0, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 } });
  useGameStore.setState({ milestones: [...G().milestones, { season: G().season + 5, playerId: 'x', name: 'x', teamId: my, kind: 'career', text: 'future', big: false }] });
  ab.push(`msFuture검출=${checkDerived('ab').some((v) => v.check === 'msFuture')}`);
  console.log(`\n[A/B] ${ab.join(' · ')} (전부 true여야 신뢰)`);

  const abAllTrue = ab.every((x) => x.endsWith('true'));
  const ok = cleanViolations === 0 && dtV.length === 0 && abAllTrue && cleanSeasons >= SEASONS;
  console.log(`\nDERIVED OK = ${ok}`);
  process.exit(ok ? 0 : 2);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
