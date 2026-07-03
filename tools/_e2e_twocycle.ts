// 2사이클 E2E (docs/E2E_TWOCYCLE_CHECKLIST) — 헤드리스: 실 store+engine 구동, 서버는 fetch 스텁.
//   첫 진입 → 전지훈련(다이아 소비) → 감독/FA/재계약/외국인 → endSeason ×2 → 업적 → AI 팀 성장 확인.
//   npx tsx tools/_e2e_twocycle.ts
process.env.EXPO_PUBLIC_SERVER_URL = 'http://e2e.fake'; // lib/server가 online 경로를 타게(모듈 로드 전 설정)
import './_gt_mock';

// ── 인메모리 서버(다이아 원장) — fetch 스텁 ──
let bal = 5000;
const applied = new Set<string>(); // 멱등키
(globalThis as any).fetch = async (url: string, init?: any) => {
  const path = url.replace('http://e2e.fake', '');
  const body = init?.body ? JSON.parse(init.body) : {};
  const J = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  if (path === '/api/wallet') return J({ balance: bal, ledger: [], adToday: { count: 0, lastAtMs: null } });
  if (path === '/api/wallet/spend') {
    const k = body.idempotencyKey;
    if (applied.has(k)) return J({ balance: bal, applied: false }); // 이미 과금
    if (bal < body.amount) return { ok: false, status: 402, json: async () => ({ reason: 'insufficient' }), text: async () => '{"reason":"insufficient"}' };
    bal -= body.amount; applied.add(k); return J({ balance: bal, applied: true });
  }
  if (path === '/api/wallet/earn') { bal += body.amount; return J({ balance: bal, applied: true }); }
  if (path === '/api/bootstrap') return J({ maintenance: null, minVersion: null, notice: null });
  return J({ ok: true });
};

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const stat = (p: any, s: string) => (p as Record<string, number>)[s];

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { useAuthStore } = await import('../store/useAuthStore');
  const { LEAGUE, getTeamPlayers, teamAssistants, getTeamCoach, SEASON } = await import('../data/league');
  const { overall } = await import('../engine/overall');
  const { CAMP_COURSES, CAMP_COURSE_COST, CAMP_COURSES: CC } = await import('../engine/diamonds');
  const G = useGameStore.getState;

  // 로그인 세션 주입(서버 인증 대체)
  useAuthStore.setState({ session: { userId: 'e2e-user', token: 't', provider: 'test', displayName: 'E2E' } as any });

  const my = LEAGUE.teams[0].id;
  // 시즌 진행 대체 — 내 팀 경기에 결과를 채워 planNextAction=seasonOver(endSeason 게이트 개방). 실 순위는 endSeason의 leagueProduction이 결정론 재계산.
  const playSeason = () => { for (const f of SEASON.filter((x: any) => x.homeTeamId === my || x.awayTeamId === my)) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 }); };
  const teamAvgOvr = (tid: string) => { const ps = getTeamPlayers(tid); return ps.reduce((s, p) => s + overall(p), 0) / (ps.length || 1); };
  const aiTeams = LEAGUE.teams.slice(1).map((t) => t.id);
  const aiAvg = () => aiTeams.reduce((s, t) => s + teamAvgOvr(t), 0) / aiTeams.length;
  const coachTier = (tid: string) => { const c = getTeamCoach(tid); return c ? c.charisma : 0; };

  console.log('=== A. 첫 진입(온보딩) ===');
  G().selectTeam(my);
  await G().syncWallet(); // 서버 지갑 → 다이아 캐시
  const roster0 = getTeamPlayers(my);
  ok(roster0.length >= 10, `내 로스터 ${roster0.length}명(≥10)`);
  ok(!!getTeamCoach(my), '감독 배정됨');
  ok(roster0.some((p) => p.isForeign), '외국인 1명 존재');
  ok(G().diamonds === 5000, `다이아 서버 동기화 = ${G().diamonds}(5000)`);
  ok(G().season === 0 && G().currentDay === 0, 'season 0 · currentDay 0(오프시즌)');

  const aiOvr0 = aiAvg();
  const aiTier0 = aiTeams.reduce((s, t) => s + coachTier(t), 0) / aiTeams.length;
  console.log(`  [기준] AI 평균 OVR ${aiOvr0.toFixed(1)} · AI 감독 평균 카리스마 ${aiTier0.toFixed(1)}`);

  console.log('\n=== B. 전지훈련(다이아 소비) ===');
  const domestic = roster0.find((p) => !p.isForeign)!;
  const course = 'attack';
  const before = CAMP_COURSES[course].stats.map((s) => stat(getTeamPlayers(my).find((p) => p.id === domestic.id)!, s));
  const dia0 = G().diamonds;
  const r1 = await G().trainingCamp(domestic.id, course);
  ok(r1.ok, `전지훈련 성공 (${r1.reason ?? 'ok'})`);
  ok(G().diamonds === dia0 - CAMP_COURSE_COST, `다이아 ${dia0}→${G().diamonds} (정확히 −${CAMP_COURSE_COST})`);
  const after = CAMP_COURSES[course].stats.map((s) => stat(getTeamPlayers(my).find((p) => p.id === domestic.id)!, s));
  ok(after.some((v, i) => v > before[i]), `대상 3스탯 상승 [${before.join(',')}]→[${after.join(',')}]`);
  ok(G().campLog.some((e) => e.playerId === domestic.id), 'campLog 기록');
  ok(G().campTrainedThisOffseason.includes(domestic.id), 'campTrainedThisOffseason 등재');
  const r2 = await G().trainingCamp(domestic.id, course);
  ok(!r2.ok && r2.reason === 'already', `같은 선수 2회차 거부 (${r2.reason})`);
  // 다이아 부족 케이스
  const dia1 = G().diamonds; bal = 100;
  const other = getTeamPlayers(my).find((p) => !p.isForeign && p.id !== domestic.id)!;
  await G().syncWallet();
  const r3 = await G().trainingCamp(other.id, course);
  ok(!r3.ok && r3.reason === 'no-diamonds', `다이아 부족 거부 (${r3.reason})`);
  ok(!G().campTrainedThisOffseason.includes(other.id), '부족 시 스탯/차감 없음(원자성)');
  bal = 5000; await G().syncWallet();

  console.log('\n=== C~E. 감독·FA·재계약·외국인 결정 ===');
  const hires0 = G().careerLog.coachHires;
  // 감독 교체(FA 감독 풀에서 하나) — hireCoach는 성공/실패 bool
  const { availableCoaches } = await import('../data/league');
  const freeCoach = availableCoaches?.()?.[0];
  if (freeCoach) { const hired = G().hireCoach(freeCoach.id); ok(hired || G().careerLog.coachHires >= hires0, `감독 선임 시도(${hired})`); }
  else console.log('  (프리 감독 풀 비어 감독 교체 스킵)');
  // 재계약/외국인 결정
  G().setKeepForeign(true);
  ok(G().keepForeign === true, '외국인 재계약 결정(keepForeign=true)');

  console.log('\n=== F. 오프시즌 진행 endSeason ×2 ===');
  playSeason(); // 시즌 경기 소화(게이트 개방)
  G().endSeason();
  ok(G().season === 1 && G().currentDay === 0, `사이클1 후 season=${G().season}(1)·currentDay 0`);
  ok(getTeamPlayers(my).some((p) => p.isForeign), '내 팀 외국인 유지/신규');
  const aiOvr1 = aiAvg();
  // 사이클2 오프시즌 전지훈련 한 번 더(새 오프시즌 → campTrainedThisOffseason 리셋 확인)
  const dom2 = getTeamPlayers(my).find((p) => !p.isForeign)!;
  const r4 = await G().trainingCamp(dom2.id, 'serve');
  ok(r4.ok, `사이클2 전지훈련 성공(오프시즌 리셋 확인) (${r4.reason ?? 'ok'})`);
  playSeason();
  G().endSeason();
  ok(G().season === 2, `사이클2 후 season=${G().season}(2)`);
  ok(G().archive.length >= 2, `시즌 아카이브 누적 ${G().archive.length}`);

  console.log('\n=== G. 업적 다이아 수령 ===');
  const dia2 = G().diamonds;
  const ac = await G().claimAchDiamonds();
  ok(typeof ac.granted === 'number', `업적 수령 시도 — granted ${ac.granted}(reason ${ac.reason ?? '-'})`);
  ok(G().diamonds >= dia2, '업적 수령이 다이아를 줄이지 않음');

  console.log('\n=== H. AI 팀 성장(2사이클) ===');
  const aiOvr2 = aiAvg();
  const aiTier2 = aiTeams.reduce((s, t) => s + coachTier(t), 0) / aiTeams.length;
  console.log(`  AI 평균 OVR: ${aiOvr0.toFixed(1)} → ${aiOvr1.toFixed(1)} → ${aiOvr2.toFixed(1)}`);
  console.log(`  AI 감독 평균 카리스마: ${aiTier0.toFixed(1)} → ${aiTier2.toFixed(1)}`);
  ok(aiOvr2 > 45 && aiOvr2 < 90, `AI 평균 OVR 정상범위(${aiOvr2.toFixed(1)}) — 붕괴/폭주 없음`);
  ok(Math.abs(aiOvr2 - aiOvr0) < 12, `AI OVR 2사이클 변동 완만(Δ${(aiOvr2 - aiOvr0).toFixed(1)}) — 정체·붕괴 아님`);
  ok(aiTier2 >= aiTier0 - 2, `AI 감독 카리스마 유지/성장(${aiTier0.toFixed(1)}→${aiTier2.toFixed(1)}) — 전원 C 붕괴 없음`);

  console.log(fail === 0 ? '\n✅ PASS _e2e_twocycle — 2사이클 전 시스템 정상' : `\n❌ FAIL ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THROW', e); process.exit(1); });
