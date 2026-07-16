// 세이브 내보내기/가져오기 가드 (SAVE_SYSTEM §9.6) — lib/saveTransfer.ts 순수 함수 + 실 zustand persist 왕복.
//   (a) 왕복 동일성  (b) 미래버전 거부  (c) 쓰레기 입력 거부  (d) 드라이런 게이트가 현재 세이브 보호(바이트 불변)
//   (e) 실 store E2E(코퍼스 export→import→rehydrate, day80 복원)  (f) A/B: 게이트 없으면 fresh 리셋(전손)이 실재
//   npx tsx tools/_dv_save_transfer.ts
import './_gt_mock';
import { __asyncStorageMem } from './_gt_mock';
import { readFileSync } from 'fs';
import { join } from 'path';

let fail = 0;
const check = (n: string, c: boolean) => { process.stdout.write(`${c ? '✅' : '❌'} ${n}\n`); if (!c) fail++; };
const SENTINEL = '__XFER_SENTINEL__';

async function main() {
  const { useGameStore, SAVE_KEY: KEY } = await import('../store/useGameStore');
  const { resetLeagueBase } = await import('../data/league');
  const { flushGameSave } = await import('../store/persistStorage');
  const { SAVE_VERSION } = await import('../store/saveMigration');
  const {
    buildExportPayload, serializeExport, exportFileName,
    parseImportPayload, dryRunImport, EXPORT_APP, EXPORT_KIND,
  } = await import('../lib/saveTransfer');
  const G = () => useGameStore.getState();

  await useGameStore.persist.rehydrate(); // 빈 스토리지 정착

  // 코퍼스 진행 세이브({state, version}) — 실물 입력
  const corpus = JSON.parse(readFileSync(join(__dirname, '..', 'corpus', 'saves', 'v3_260716_progressed.json'), 'utf8')) as { state: Record<string, unknown>; version: number };

  // raw {state,version}를 슬롯 키에 쓰고 실제 rehydrate(센티넬 선주입 → "실제 로드됐는가" 판정). settings 적용 경로와 동형.
  const writeAndRehydrate = async (rawObj: { state: Record<string, unknown>; version: number }) => {
    resetLeagueBase();
    useGameStore.setState({ selectedTeamId: SENTINEL, currentDay: -1, season: -1, playerBase: null, rosters: null, hydrated: false });
    __asyncStorageMem.set(KEY, JSON.stringify(rawObj));
    let threw = false;
    try { await useGameStore.persist.rehydrate(); } catch { threw = true; }
    return { st: G(), threw };
  };

  // settings 가져오기 적용 경로(드라이런 게이트 포함) — 거부 시 현재 세이브 무접촉.
  const gatedImport = async (state: Record<string, unknown>, version: number): Promise<{ applied: boolean; reason?: string }> => {
    const dry = dryRunImport(state, version);
    if (!dry.ok) return { applied: false, reason: dry.reason }; // 현재 세이브 무접촉으로 거부
    await flushGameSave();
    resetLeagueBase();
    __asyncStorageMem.set(KEY, JSON.stringify({ state, version }));
    await useGameStore.persist.rehydrate();
    return { applied: true };
  };

  // commit-throw 손상 state(_dv_migrate_e2e ③ 크래시 벡터): playerBase 엔트리가 null → commitPlayerBase의 p.traits에서 throw.
  const corruptState = { selectedTeamId: 't4', season: 3, currentDay: 50, playerBase: { pBad: null }, rosters: { t4: ['pBad'] } } as Record<string, unknown>;

  // ── (a) 왕복 동일성 ──
  process.stdout.write('\n[(a) export→serialize→parse 왕복 동일성]\n');
  const cap = { state: corpus.state, version: corpus.version };
  const payload = buildExportPayload(cap);
  check('봉투 app 태그', payload.app === EXPORT_APP);
  check('봉투 kind 태그', payload.kind === EXPORT_KIND);
  check('봉투 version = 캡처 버전', payload.version === corpus.version);
  const text = serializeExport(payload);
  const parsed = parseImportPayload(text);
  check('parse ok', parsed.ok === true);
  if (parsed.ok) {
    check('state 딥 동등(왕복 무손실)', JSON.stringify(parsed.state) === JSON.stringify(corpus.state));
    check('version 보존', parsed.version === corpus.version);
  }
  check('파일명 s<season+1>-d<day>', exportFileName(corpus.state) === 'baeknyeon-save-s1-d80.json');

  // ── (b) 미래 버전 거부 ──
  process.stdout.write('\n[(b) 미래 버전(version=SAVE_VERSION+1) 거부]\n');
  const future = JSON.stringify({ app: EXPORT_APP, kind: EXPORT_KIND, version: SAVE_VERSION + 1, state: corpus.state });
  const rb = parseImportPayload(future);
  check('미래 버전 거부', rb.ok === false);
  check('사유에 "최신 업데이트" 취지', rb.ok === false && /최신/.test(rb.reason));

  // ── (c) 쓰레기 입력 거부 ──
  process.stdout.write('\n[(c) 쓰레기 입력 거부(비JSON·app불일치·state 배열/누락)]\n');
  const c1 = parseImportPayload('{not valid json');
  check('비-JSON 거부', c1.ok === false);
  const c2 = parseImportPayload(JSON.stringify({ app: 'otherapp', kind: EXPORT_KIND, version: SAVE_VERSION, state: {} }));
  check('app 불일치 거부', c2.ok === false);
  const c2b = parseImportPayload(JSON.stringify({ app: EXPORT_APP, kind: 'not-export', version: SAVE_VERSION, state: {} }));
  check('kind 불일치 거부', c2b.ok === false);
  const c3 = parseImportPayload(JSON.stringify({ app: EXPORT_APP, kind: EXPORT_KIND, version: SAVE_VERSION, state: [] }));
  check('state 배열 거부', c3.ok === false);
  const c4 = parseImportPayload(JSON.stringify({ app: EXPORT_APP, kind: EXPORT_KIND, version: SAVE_VERSION }));
  check('state 누락 거부', c4.ok === false);
  // 모든 거부는 사유 문자열을 동반
  check('모든 거부가 사유 동반', [c1, c2, c2b, c3, c4].every((r) => r.ok === false && typeof r.reason === 'string' && r.reason.length > 0));

  // ── (d) 드라이런 게이트가 현재 세이브를 보호(바이트 불변) ──
  process.stdout.write('\n[(d) 드라이런 게이트 — 손상 state 거부 + 기존 세이브 바이트 불변]\n');
  const base = await writeAndRehydrate(corpus); // 유효 세이브를 슬롯·store에 확립
  check('기준 세이브 로드(day80·t0)', !base.threw && base.st.currentDay === 80 && base.st.selectedTeamId === 't0');
  const bytesBefore = __asyncStorageMem.get(KEY)!;
  const dres = await gatedImport(corruptState, SAVE_VERSION);
  check('손상 state 가져오기 거부(applied=false)', dres.applied === false);
  check('거부 사유가 손상 선수 데이터 취지', typeof dres.reason === 'string' && /선수/.test(dres.reason!));
  const bytesAfter = __asyncStorageMem.get(KEY)!;
  check('슬롯 세이브 바이트 불변(현재 세이브 보호)', bytesBefore === bytesAfter);
  check('store 미변경(day80 유지 — 게이트가 store 무접촉)', G().currentDay === 80 && G().selectedTeamId === 't0');

  // ── (e) 실 store E2E — 코퍼스 export→import→rehydrate 완주(day80 복원) ──
  process.stdout.write('\n[(e) 실 store E2E — 코퍼스 export→import→rehydrate(day80 복원)]\n');
  // 빈 슬롯에서 시작(센티넬로 리셋) 후 게이트 통과 import
  resetLeagueBase();
  useGameStore.setState({ selectedTeamId: SENTINEL, currentDay: -1, season: -1, playerBase: null, rosters: null, hydrated: false });
  const ePayload = buildExportPayload({ state: corpus.state, version: corpus.version });
  const eParsed = parseImportPayload(serializeExport(ePayload));
  check('E2E parse ok', eParsed.ok === true);
  if (eParsed.ok) {
    const eres = await gatedImport(eParsed.state, eParsed.version);
    check('E2E 게이트 통과·적용', eres.applied === true);
    check('E2E rehydrate 후 selectedTeamId=t0', G().selectedTeamId === 't0');
    check('E2E rehydrate 후 currentDay=80(복원)', G().currentDay === 80);
    check('E2E 센티넬 소거(실제 로드됨)', G().selectedTeamId !== SENTINEL);
  }

  // ── (f) A/B 민감도 — 게이트 없었다면 손상 state가 fresh 리셋(전손)을 일으킴 ──
  process.stdout.write('\n[(f) A/B — 게이트 우회 시 손상 state가 fresh 리셋(현재 세이브 전손)]\n');
  const b2 = await writeAndRehydrate(corpus); // 다시 유효 세이브 확립(day80)
  check('기준 세이브 재확립(day80)', b2.st.currentDay === 80 && b2.st.selectedTeamId === 't0');
  // 게이트 없이(드라이런 스킵) 곧장 write+rehydrate — settings가 검증 없이 덮어썼을 때의 결과 재현.
  resetLeagueBase();
  useGameStore.setState({ selectedTeamId: SENTINEL, currentDay: -1, season: -1, playerBase: null, rosters: null, hydrated: false });
  __asyncStorageMem.set(KEY, JSON.stringify({ state: corruptState, version: SAVE_VERSION }));
  let ungThrew = false;
  try { await useGameStore.persist.rehydrate(); } catch { ungThrew = true; }
  const uSt = G();
  check('무예외(안전망이 삼킴)', !ungThrew);
  check('게이트 우회 → fresh 리셋: selectedTeamId=null(전손)', uSt.selectedTeamId === null);
  check('게이트 우회 → fresh 리셋: season=0', uSt.season === 0);
  check('게이트 우회 → fresh 리셋: currentDay=0(day80 소멸)', uSt.currentDay === 0);
  check('A/B 격차 — (d) 게이트는 같은 손상 state를 거부해 이 전손을 막았다', dres.applied === false && uSt.selectedTeamId === null);

  process.stdout.write(fail === 0 ? '\n✅ ALL PASS — 세이브 내보내기/가져오기 안전\n' : `\n❌ ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
