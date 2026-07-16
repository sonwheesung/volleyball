// 시즌 종료 서버 백업 가드 (SAVE_SYSTEM §10.7) — 순수부만(라이브 왕복은 서버측 _dv_backup_live가 커버).
//   ① 페이로드 포맷: buildBackupBody.payload === serializeExport(buildExportPayload(cap)) + 봉투 복원 + season 패스스루
//   ② 재시도 판정 표: shouldRetryBackup(마지막백업, 현재, 온라인) 조합별 기대값
//   ③ endSeason 결정론 무영향: 실 store로 업로드 성공/실패/미호출 3케이스 구동 → 커밋 세이브 바이트 동일(fire-and-forget 봉인)
//   ④ A/B 민감도: 교란된 판정 변이에 ② 표를 돌리면 최소 1행 불일치(허위 오라클 차단)
//   Usage: npx tsx tools/_dv_save_backup.ts
import './_gt_mock';
import { readFileSync } from 'fs';
import { join } from 'path';

let fail = 0;
const check = (n: string, c: boolean, detail?: string) => { process.stdout.write(`${c ? '✅' : '❌'} ${n}${detail ? ' — ' + detail : ''}\n`); if (!c) fail++; };

async function main() {
  const { useGameStore, captureReplaySave } = await import('../store/useGameStore');
  const { useAuthStore } = await import('../store/useAuthStore');
  const { buildExportPayload, serializeExport, parseImportPayload, EXPORT_APP, EXPORT_KIND } = await import('../lib/saveTransfer');
  const { shouldRetryBackup, buildBackupBody, retryBackupOnBoot } = await import('../lib/saveBackup');
  const league = await import('../data/league');
  const dyn = await import('../data/dynamics');
  const mb = await import('../data/matchBox');
  const cal = await import('../engine/calendar');
  const G = () => useGameStore.getState();
  const my = league.LEAGUE.teams[0].id;

  await useGameStore.persist.rehydrate(); // 빈 스토리지 정착

  // ── ① 페이로드 포맷 동일 ────────────────────────────────────────────────
  process.stdout.write('\n[① 업로드 페이로드 = buildExportPayload+serializeExport(재사용, 새 포맷 금지)]\n');
  const corpus = JSON.parse(readFileSync(join(__dirname, '..', 'corpus', 'saves', 'v3_260716_progressed.json'), 'utf8')) as { state: Record<string, unknown>; version: number };
  const cap = { state: corpus.state, version: corpus.version };
  const body = buildBackupBody(cap, 7);
  check('payload === serializeExport(buildExportPayload(cap))', body.payload === serializeExport(buildExportPayload(cap)));
  check('season 패스스루', body.season === 7);
  const back = parseImportPayload(body.payload);
  check('payload 봉투 파싱 ok', back.ok === true);
  if (back.ok) {
    check('봉투 state 딥 동등(왕복 무손실)', JSON.stringify(back.state) === JSON.stringify(corpus.state));
    check('봉투 version 보존', back.version === corpus.version);
  }
  // 봉투 태그 직접 확인(파일 export와 동일 app/kind)
  const env = buildExportPayload(cap);
  check('봉투 app 태그', env.app === EXPORT_APP);
  check('봉투 kind 태그', env.kind === EXPORT_KIND);

  // ── ② 재시도 판정 표 ────────────────────────────────────────────────────
  process.stdout.write('\n[② shouldRetryBackup(마지막백업, 현재, 온라인) 조합 표]\n');
  // [last, current, online, 기대]
  const table: [number | null, number, boolean, boolean][] = [
    [null, 0, true, true],    // 이력 없음 + 진행 중(season0) → 최초 업로드
    [null, 5, true, true],    // 이력 없음 + 여러 시즌 → 업로드
    [2, 3, true, true],       // 마지막 백업(2)이 현재(3)보다 뒤처짐 → 재시도
    [3, 3, true, false],      // 이미 현재 시즌 백업됨 → 안 함
    [5, 3, true, false],      // 마지막 백업이 현재보다 앞섬(구세이브 import 등) → 안 함
    [2, 3, false, false],     // 오프라인 → 통과(안 함)
    [null, 5, false, false],  // 오프라인 → 통과
  ];
  let tableOk = true;
  for (const [last, cur, online, exp] of table) {
    const got = shouldRetryBackup(last, cur, online);
    const ok = got === exp;
    if (!ok) tableOk = false;
    check(`(last=${last}, cur=${cur}, online=${online}) → ${got}`, ok, ok ? undefined : `기대 ${exp}`);
  }
  check('② 표 전체 PASS', tableOk);

  // ── ③ endSeason 결정론 무영향 (실 store, 3케이스 바이트 동일) ──────────────
  process.stdout.write('\n[③ endSeason 결정론 무영향 — 업로드 성공/실패/미호출 3케이스 바이트 동일]\n');

  // dev 시즌 완료(_dv_endseason_order와 동일 산식) — 내 팀 미치름 경기 결정론 기록 + 시즌말일.
  const completeSeason = () => {
    for (const f of league.SEASON) {
      if ((f.homeTeamId === my || f.awayTeamId === my) && !G().results[f.id]) {
        const { sim } = mb.buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed, dyn.interventionsFor(f.id));
        G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
      }
    }
    G().setDay(cal.SEASON_DAYS);
  };

  // 오라클 = **런 내부 before/after 불변**: 백업은 endSeason이 set()으로 커밋한 **뒤** microtask에서 fire-and-forget로 돈다.
  //   따라서 endSeason 커밋 직후(동기) 상태 == 업로드 완료 후 상태 여야 한다(백업이 store를 건드리면 before≠after로 잡힘).
  //   이 within-run 오라클은 saveId(랜덤)·bonds(연속 시즌 드래프티 축적) 같은 endSeason 내재 비결정성에 무관하게
  //   "백업 훅이 커밋 상태에 미치는 영향"만 격리한다(_dv_endseason_order의 런 내부 오라클 패턴 준거).
  const realFetch = global.fetch;
  let fetchCalls = 0;
  const runCase = async (mode: 'success' | 'fail' | 'nocall'): Promise<{ mutated: boolean; calls: number }> => {
    fetchCalls = 0;
    if (mode === 'nocall') {
      useAuthStore.setState({ session: null });
      delete process.env.EXPO_PUBLIC_SERVER_URL;
    } else {
      useAuthStore.setState({ session: { userId: 'dev-local:guard', provider: 'dev', displayName: null, token: 'TESTTOKEN' } } as never);
      process.env.EXPO_PUBLIC_SERVER_URL = 'http://guard.local';
    }
    (global as { fetch: unknown }).fetch = async () => {
      fetchCalls++;
      if (mode === 'fail') throw new Error('network-fail-injected');
      return { ok: true, status: 200, json: async () => ({ ok: true, id: 'x', keptCount: 5 }) } as unknown as Response;
    };
    G().resetSave();
    G().selectTeam(my);
    completeSeason();
    G().endSeason();
    const before = JSON.stringify(captureReplaySave()!.state); // 커밋 직후(동기) — 업로드는 아직 안 돎
    // fire-and-forget 업로드 microtask/타임아웃 소진(성공·실패 케이스가 실제로 fetch를 타는지 확인)
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const after = JSON.stringify(captureReplaySave()!.state); // 업로드 완료 후 — 여전히 동일해야(store 무접촉)
    return { mutated: before !== after, calls: fetchCalls };
  };

  const cSuccess = await runCase('success');
  const cFail = await runCase('fail');
  const cNoCall = await runCase('nocall');
  (global as { fetch: unknown }).fetch = realFetch;

  check('성공 케이스: 업로드 후 커밋 세이브 바이트 동일(백업이 store 무접촉)', !cSuccess.mutated);
  check('실패 케이스: 업로드 후 커밋 세이브 바이트 동일', !cFail.mutated);
  check('미호출 케이스: 커밋 세이브 바이트 동일', !cNoCall.mutated);
  check('성공 케이스 fetch 호출됨(≥1)', cSuccess.calls >= 1, `calls=${cSuccess.calls}`);
  check('실패 케이스 fetch 호출됨(≥1)', cFail.calls >= 1, `calls=${cFail.calls}`);
  check('미호출 케이스 fetch 0회(세션 없음 → 조용히 통과)', cNoCall.calls === 0, `calls=${cNoCall.calls}`);
  check('3케이스가 실제로 다른 업로드 경로(성공/실패/미호출)를 탔다', cSuccess.calls >= 1 && cFail.calls >= 1 && cNoCall.calls === 0);

  // ── ④ A/B 민감도 — 교란 판정은 ② 표를 통과 못 한다 ────────────────────────
  process.stdout.write('\n[④ A/B — 판정 조건 교란 시 표 FAIL(허위 오라클 차단)]\n');
  // 변이 A: 온라인 게이트 제거(오프라인도 재시도) — 오프라인 행에서 어긋나야.
  const mutA = (last: number | null, cur: number, _online: boolean) => cur > (last ?? -1);
  // 변이 B: > 를 >= 로(같은 시즌도 재시도) — [3,3,true] 행에서 어긋나야.
  const mutB = (last: number | null, cur: number, online: boolean) => (online ? cur >= (last ?? -1) : false);
  const tableFailsFor = (fn: (l: number | null, c: number, o: boolean) => boolean) => table.some(([last, cur, online, exp]) => fn(last, cur, online) !== exp);
  check('변이 A(온라인 게이트 제거) 표 불일치(잡힘)', tableFailsFor(mutA));
  check('변이 B(> → >=) 표 불일치(잡힘)', tableFailsFor(mutB));
  check('대조: 실제 shouldRetryBackup은 표 전체 통과(위 ② PASS)', tableOk);

  // ── ⑤ 부팅 시퀀스 재현 — 이중 rehydrate(인증 전→후)에서 재시도가 실제로 발화하는가 ────────────
  //   에뮬 E2E 발견 버그: 진입 즉시 플래그 소진 시, 인증 전 rehydrate(세션 없음)가 플래그를 태워
  //   인증 후 rehydrate(세션 있음)가 영원히 스킵된다. 함수 격리 가드(②③)의 시퀀스 사각을 닫는다.
  process.stdout.write('\n[⑤ 부팅 시퀀스 — 인증 전(세션X) rehydrate → 인증 후(세션O) rehydrate 2회 발화]\n');
  {
    // 유효 세이브 확립(selectedTeamId 세팅) — retryBackupOnBoot의 cap 통과 조건.
    G().resetSave();
    G().selectTeam(my);
    process.env.EXPO_PUBLIC_SERVER_URL = 'http://guard.local';
    let uploads = 0;
    (global as { fetch: unknown }).fetch = async () => {
      uploads++;
      return { ok: true, status: 200, json: async () => ({ ok: true, id: 'x', keptCount: 5 }) } as unknown as Response;
    };
    const drain = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

    // ① 인증 전 rehydrate — auth 미하이드레이션(세션 없음). 업로드 0 + 플래그 소진 안 됨이어야.
    useAuthStore.setState({ session: null });
    await retryBackupOnBoot();
    await drain();
    const afterStep1 = uploads;
    check('① 인증 전(세션 없음): 업로드 0회', afterStep1 === 0, `uploads=${afterStep1}`);

    // ② 인증 후 rehydrate — switchSaveScope 계정 슬롯 로드(세션 있음). 재시도가 살아 있어 업로드 1회.
    useAuthStore.setState({ session: { userId: 'dev-local:boot', provider: 'dev', displayName: null, token: 'TESTTOKEN' } } as never);
    await retryBackupOnBoot();
    await drain();
    check('② 인증 후(세션 있음): 업로드 1회 발화(재시도 살아 있음)', uploads === 1, `uploads=${uploads}`);

    // ③ 같은 계정 재-rehydrate(설정 import 등): 계정당 1회 → 추가 업로드 없음.
    await retryBackupOnBoot();
    await drain();
    check('③ 같은 계정 재호출: 추가 업로드 없음(계정당 1회)', uploads === 1, `uploads=${uploads}`);

    // ④ 계정 전환(B 로그인): Set<userId>라 B도 1회 받는다.
    useAuthStore.setState({ session: { userId: 'dev-local:boot2', provider: 'dev', displayName: null, token: 'TESTTOKEN' } } as never);
    await retryBackupOnBoot();
    await drain();
    check('④ 계정 전환(다른 userId): 그 계정도 1회 재시도(총 2회)', uploads === 2, `uploads=${uploads}`);

    (global as { fetch: unknown }).fetch = realFetch;
    delete process.env.EXPO_PUBLIC_SERVER_URL;

    // ── A/B: 구버전 로직(진입 즉시 소진) 재현 — 같은 시퀀스에서 인증 후 업로드가 죽음을 증명 ──
    // 실제 코드가 아니라 "수정 전 소비 시점"을 로컬 모델로 재현(변이). 시퀀스 사각의 teeth.
    const buggyModel = () => {
      let done = false; // 구버전: boolean 플래그, 진입 즉시 소진
      let up = 0;
      const call = (hasSession: boolean, hasSave: boolean) => {
        if (done) return;
        done = true;                 // ★ 버그: 자격 확인 전에 소진
        if (!hasSession) return;     // 인증 전 rehydrate — 하지만 이미 소진됨
        if (!hasSave) return;
        up++;                        // (도달 시) 업로드
      };
      call(false, true);            // ① 인증 전(세션 없음)
      call(true, true);             // ② 인증 후(세션 있음) — done=true라 스킵됨
      return up;
    };
    const fixedModel = () => {
      const set = new Set<string>(); let up = 0;
      const call = (userId: string | null, hasSave: boolean) => {
        if (!userId) return;              // 세션 없음 → 소진 안 함
        if (set.has(userId)) return;
        if (!hasSave) return;
        set.add(userId);                  // 자격 있는 시도만 소진
        up++;
      };
      call(null, true);                   // ① 인증 전
      call('dev-local:boot', true);       // ② 인증 후 — 발화
      return up;
    };
    const buggyUploads = buggyModel();
    const fixedUploads = fixedModel();
    check('A/B 구버전(진입 즉시 소진): 인증 후 업로드 0회(재시도 죽음)', buggyUploads === 0, `uploads=${buggyUploads}`);
    check('A/B 수정본(자격 뒤 소진): 인증 후 업로드 1회', fixedUploads === 1, `uploads=${fixedUploads}`);
    check('A/B 격차 존재 — 시퀀스 사각을 가드가 잡는다', buggyUploads !== fixedUploads && uploads === 2);
  }

  process.stdout.write(fail === 0 ? '\n✅ ALL PASS — 시즌 종료 서버 백업(순수부) 안전\n' : `\n❌ ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
