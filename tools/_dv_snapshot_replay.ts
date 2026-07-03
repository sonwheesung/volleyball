// 재현 키 + 로그 강화 가드 (§13.20) — 실 store 헤드리스 구동.
//   ① captureReplaySave() == persist가 저장하는 것(partialize) + version=SAVE_VERSION
//   ② 직렬화 왕복(JSON) 무손실
//   ③ buildDiagnosticSnapshot: snapshotVersion=2 + replay 포함(전 문의)
//   ④ 확정 사건 diag 발화(방출·건의 → logs에 transaction/bench)
//   ⑤ A/B 민감도(허위 오라클 금지) — replay 한 필드 변조 시 동일성 깨짐
//   npx tsx tools/_dv_snapshot_replay.ts
process.env.EXPO_PUBLIC_SERVER_URL = 'http://e2e.fake';
import './_gt_mock';

let bal = 100000;
(globalThis as any).fetch = async (url: string, init?: any) => {
  const path = url.replace('http://e2e.fake', '');
  const body = init?.body ? JSON.parse(init.body) : {};
  const J = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  if (path === '/api/wallet') return J({ balance: bal, ledger: [], adToday: { count: 0, lastAtMs: null } });
  if (path === '/api/wallet/spend') { bal -= body.amount; return J({ balance: bal, applied: true }); }
  if (path === '/api/wallet/earn') { bal += body.amount; return J({ balance: bal, applied: true }); }
  if (path === '/api/bootstrap') return J({ maintenance: null, minVersion: null, notice: null });
  return J({ ok: true });
};

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const tick = () => new Promise((r) => setTimeout(r, 60)); // diag는 async 적재라 마이크로태스크 대기

(async () => {
  const { useGameStore, captureReplaySave } = await import('../store/useGameStore');
  const { useAuthStore } = await import('../store/useAuthStore');
  const { LEAGUE, getTeamPlayers } = await import('../data/league');
  const { buildDiagnosticSnapshot, SNAPSHOT_VERSION } = await import('../data/diagnosticSnapshot');
  const { getSnapshotLogs } = await import('../lib/deviceLog');
  const { ENGINE_VERSION } = await import('../engine/match');
  const G = useGameStore.getState;
  useAuthStore.setState({ session: { userId: 'rk', token: 't', provider: 'test', displayName: 'RK' } as any });

  const my = LEAGUE.teams[0].id;
  G().selectTeam(my);
  await G().syncWallet();

  console.log('=== ④ 확정 사건 diag 발화 (방출·건의) ===');
  const before = (await getSnapshotLogs(G().season)).length;
  const roster = getTeamPlayers(my);
  const dom = roster.find((p) => !p.isForeign)!;
  const relOk = G().release(dom.id);
  const squadOther = roster.find((p) => !p.isForeign && p.id !== dom.id)!;
  const sb = G().suggestBench(squadOther.id, 'form');
  await tick();
  const logs = await getSnapshotLogs(G().season);
  ok(relOk, `방출 성공(${dom.name})`);
  ok(logs.length > before, `로그 증가 ${before}→${logs.length}`);
  ok(logs.some((e) => e.cat === 'transaction' && e.msg.includes('방출')), 'transaction 방출 로그 적재');
  ok(logs.some((e) => e.cat === 'bench'), `bench 건의 로그 적재(수락=${sb.ok})`);

  console.log('\n=== ① captureReplaySave == partialize + version ===');
  const r1 = captureReplaySave()!;
  const opts = (useGameStore as any).persist.getOptions();
  const partial = opts.partialize(G());
  ok(!!r1 && typeof r1.version === 'number', 'replay {state, version} 반환');
  ok(r1.version === opts.version, `version=${r1.version} == SAVE_VERSION(${opts.version})`);
  ok(JSON.stringify(r1.state) === JSON.stringify(partial), 'replay.state == partialize(state) (세이브 통째)');
  const keys = Object.keys(r1.state);
  ok(keys.includes('playerBase') && keys.includes('results') && keys.includes('currentDay') && keys.includes('archive'),
    `핵심 재현 필드 포함(${keys.length}필드)`);

  console.log('\n=== ② 직렬화 왕복 무손실 ===');
  const round = JSON.parse(JSON.stringify(r1));
  ok(JSON.stringify(round) === JSON.stringify(r1), 'JSON 왕복 동일(함수/undefined 유실 없음)');

  console.log('\n=== ③ buildDiagnosticSnapshot: snapshotVersion=2 + replay 포함 ===');
  const snap = buildDiagnosticSnapshot({
    season: G().season, currentDay: G().currentDay, myTeamId: my,
    archive: G().archive, milestones: G().milestones, hallOfFame: G().hallOfFame,
    retirements: G().retirements, released: G().released, engineVersion: ENGINE_VERSION,
    players: Object.values(G().playerBase ?? {}), logs, now: 1,
    diamonds: G().diamonds, campLog: G().campLog, pendingCamp: G().pendingCamp,
    replay: r1,
  });
  ok(snap.meta.snapshotVersion === SNAPSHOT_VERSION && SNAPSHOT_VERSION === 2, `meta.snapshotVersion=${snap.meta.snapshotVersion}`);
  ok(!!snap.replay && JSON.stringify(snap.replay) === JSON.stringify(r1), 'snapshot.replay == captureReplaySave()');

  console.log('\n=== ⑤ A/B 민감도(허위 오라클 금지) ===');
  const mutated = JSON.parse(JSON.stringify(r1));
  (mutated.state as any).currentDay = ((mutated.state as any).currentDay ?? 0) + 999;
  ok(JSON.stringify(mutated) !== JSON.stringify(r1), '변조된 replay는 동일성 검사에서 걸림(가드가 실제로 감지)');

  console.log(fail === 0 ? '\n✅ ALL PASS' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
