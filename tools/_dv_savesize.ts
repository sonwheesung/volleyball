// 세이브 크기 측정 (진단 스냅샷 재현키 첨부 설계 — 추정금지, 실측). 실 store 헤드리스 구동으로 N시즌 진행 후
// partialize 출력(=재현키가 될 세이브)의 raw/gzip 바이트 + 필드별 분해를 잰다. Vercel 본문 하드캡 ~4.5MB 대비.
//   npx tsx tools/_dv_savesize.ts
process.env.EXPO_PUBLIC_SERVER_URL = 'http://e2e.fake';
import './_gt_mock';
import zlib from 'node:zlib';

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

const CHECKPOINTS = [1, 10, 30, 50, 75, 100];
const kb = (b: number) => (b / 1024).toFixed(1) + 'KB';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { useAuthStore } = await import('../store/useAuthStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const G = useGameStore.getState;
  useAuthStore.setState({ session: { userId: 'sz', token: 't', provider: 'test', displayName: 'SZ' } as any });

  const my = LEAGUE.teams[0].id;
  const playSeason = () => { for (const f of SEASON.filter((x: any) => x.homeTeamId === my || x.awayTeamId === my)) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 }); };

  G().selectTeam(my);
  await G().syncWallet();

  const partialize = (useGameStore as any).persist.getOptions().partialize as (s: any) => Record<string, unknown>;

  const measure = (seasonsPlayed: number) => {
    const st = G();
    const partial = partialize(st);
    const json = JSON.stringify(partial);
    const raw = Buffer.byteLength(json, 'utf8');
    const gz = zlib.gzipSync(json).length;
    // 필드별 분해 — 큰 순 5개
    const fields = Object.keys(partial)
      .map((k) => ({ k, b: Buffer.byteLength(JSON.stringify((partial as any)[k] ?? null), 'utf8') }))
      .sort((a, b) => b.b - a.b);
    const pb: any[] = Object.values((st as any).playerBase ?? {});
    const totalLines = pb.reduce((n, p) => n + ((p?.seasonLines?.length) ?? 0), 0);
    console.log(
      `\n[${seasonsPlayed}시즌] raw ${kb(raw)}  gzip ${kb(gz)}  (${(raw / gz).toFixed(1)}x)  ` +
      `| 4.5MB캡 ${raw > 4.5e6 ? '★초과(raw)' : gz > 4.5e6 ? '★초과(gzip)' : 'OK'}`,
    );
    console.log(`    선수 ${pb.length}명 · seasonLines 총 ${totalLines} · archive ${(st as any).archive.length} · HOF ${(st as any).hallOfFame.length} · retirements ${(st as any).retirements.length} · milestones ${(st as any).milestones.length}`);
    console.log('    큰 필드: ' + fields.slice(0, 6).map((f) => `${f.k}=${kb(f.b)}`).join('  '));
  };

  let played = 0;
  const maxS = CHECKPOINTS[CHECKPOINTS.length - 1];
  for (let i = 0; i < maxS; i++) {
    playSeason();
    G().endSeason();
    played++;
    if (CHECKPOINTS.includes(played)) measure(played);
  }
  console.log('\n※ raw=uncompressed JSON, gzip=zlib 압축. Vercel 서버리스 요청 본문 하드캡 ≈ 4.5MB.');
})().catch((e) => { console.error(e); process.exit(1); });
