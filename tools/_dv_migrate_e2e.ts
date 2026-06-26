// 세이브 마이그레이션 E2E 가드 (SAVE_SYSTEM) — 실제 AsyncStorage(모킹)에 세이브를 넣고
// 진짜 zustand persist 파이프라인(migrate → merge → onRehydrateStorage → commit)을 끝까지 태운다.
// _dv_migrate(순수 함수)와 달리 "실제로 잘 타는지"를 실 store로 검증.
//   npx tsx tools/_dv_migrate_e2e.ts
import './_gt_mock';
import { __asyncStorageMem } from './_gt_mock';

const KEY = 'baeknyeon-save';
let fail = 0;
const check = (n: string, c: boolean) => { process.stdout.write(`${c ? '✅' : '❌'} ${n}\n`); if (!c) fail++; };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

async function main() {
  const { useGameStore } = await import('../store/useGameStore');
  // 초기 auto-rehydrate(빈 스토리지) 정착
  await useGameStore.persist.rehydrate();

  // 한 세이브를 스토리지에 넣고 실제 rehydrate
  const load = async (state: Record<string, unknown>, version = 0) => {
    __asyncStorageMem.set(KEY, JSON.stringify({ state, version }));
    let threw = false;
    try { await useGameStore.persist.rehydrate(); } catch { threw = true; }
    return { st: useGameStore.getState(), threw };
  };

  // ── ① 손상 타입 세이브(v0) → 실제 파이프라인서 sanitize 로드(크래시·리셋 없이) ──
  process.stdout.write('\n[① 손상 타입 세이브 → 실 store 정상 로드(sanitize)]\n');
  const r1 = await load({
    selectedTeamId: 't0',          // 유효 — 보존되어야(리셋 아님 증명)
    season: null, currentDay: 'x', // 손상 scalar
    inSeasonTx: {}, faPool: 7, archive: 'x', benchDirectives: 'no', // 손상 array
    staffHead: [], results: 5,     // 손상 record
    cash: 'lots', fanScore: NaN,   // 손상 num
    playerBase: null, rosters: null, // commit 안 탐(throw 회피 — ①은 sanitize 경로 증명)
    coachPool: [], trainingFocus: { primary: 'bad' },
  });
  check('rehydrate 무예외', !r1.threw);
  check('hydrated=true', r1.st.hydrated === true);
  check('selectedTeamId "t0" 보존(=리셋 아님)', r1.st.selectedTeamId === 't0');
  check('season null → 0', r1.st.season === 0);
  check('currentDay "x" → 0', r1.st.currentDay === 0);
  check('inSeasonTx {} → []', Array.isArray(r1.st.inSeasonTx) && r1.st.inSeasonTx.length === 0);
  check('faPool 7 → []', Array.isArray(r1.st.faPool));
  check('archive "x" → []', Array.isArray(r1.st.archive));
  check('benchDirectives "no" → []', Array.isArray(r1.st.benchDirectives));
  check('staffHead [] → {}', isObj(r1.st.staffHead));
  check('results 5 → {}', isObj(r1.st.results));
  check('cash "lots" → 50000', r1.st.cash === 50000);
  check('fanScore NaN → 50', r1.st.fanScore === 50);
  check('coachPool [] → null', r1.st.coachPool === null);
  check('trainingFocus malformed → null', r1.st.trainingFocus === null);

  // ── ② 유효 세이브(v0) → 값 보존 + base 커밋(getPlayer 동작) ──
  process.stdout.write('\n[② 유효 세이브 → 값 보존·base 커밋]\n');
  const { getPlayer, resetLeagueBase } = await import('../data/league');
  resetLeagueBase(); // 깨끗한 레지스트리에서 시작
  const r2 = await load({
    selectedTeamId: 't1', season: 9, currentDay: 40, cash: 33333,
    inSeasonTx: [{ day: 2, teamId: 't1', playerId: 'pX', kind: 'sign' }],
    playerBase: { pX: { id: 'pX', name: '테스트선수', age: 25, position: 'OH', traits: [] } },
    rosters: { t1: ['pX'] },
    archive: [{ season: 0, championId: 't2' }],
  });
  check('rehydrate 무예외', !r2.threw);
  check('hydrated=true', r2.st.hydrated === true);
  check('season 9 보존', r2.st.season === 9);
  check('selectedTeamId t1 보존', r2.st.selectedTeamId === 't1');
  check('cash 33333 보존', r2.st.cash === 33333);
  check('inSeasonTx 보존(kind sign)', (r2.st.inSeasonTx as any)[0]?.kind === 'sign');
  check('archive 보존', (r2.st.archive as any)[0]?.championId === 't2');
  check('playerBase 실제 커밋 → getPlayer("pX") 동작', getPlayer('pX')?.name === '테스트선수');

  // ── ③ 안전망 — sanitize 통과하나 commit이 throw하는 세이브 → fresh 리셋(크래시 루프 차단) ──
  process.stdout.write('\n[③ 안전망 — commit throw → try/catch fresh 리셋]\n');
  const r3 = await load({
    selectedTeamId: 't3', season: 4,
    playerBase: { pBad: null }, // record라 sanitize 통과 → commitPlayerBase서 null.traits throw 유발
    rosters: { t3: ['pBad'] },
  });
  check('rehydrate 무예외(catch가 삼킴)', !r3.threw);
  check('hydrated=true(앱 진입 가능)', r3.st.hydrated === true);
  check('fresh 리셋됨 — selectedTeamId null', r3.st.selectedTeamId === null);
  check('fresh 리셋됨 — season 0', r3.st.season === 0);

  process.stdout.write(fail === 0 ? '\n✅ ALL PASS — 실제 persist 파이프라인 정상 동작\n' : `\n❌ ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
