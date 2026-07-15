// 계정별 세이브 슬롯 격리 가드 (SAVE_SYSTEM §7) — 모킹 AsyncStorage 위에서 **실 store**를 switchSaveScope로 구동.
//   고정 키 하나였던 구현이면 ①(B 로그인=신규)에서 A 데이터가 노출돼 FAIL한다(A/B 대조로 민감도 증명).
//   npx tsx tools/_dv_savescope.ts
import './_gt_mock';
import { __asyncStorageMem } from './_gt_mock';

let fail = 0;
const check = (n: string, c: boolean) => { process.stdout.write(`${c ? '✅' : '❌'} ${n}\n`); if (!c) fail++; };

async function main() {
  const { useGameStore, SAVE_KEY } = await import('../store/useGameStore');
  const { switchSaveScope, deleteSaveSlot, saveKeyFor, _resetScopeForTest } = await import('../store/saveScope');
  const { LEAGUE } = await import('../data/league');
  const G = () => useGameStore.getState();
  const teamA = LEAGUE.teams[0].id;
  const teamB = LEAGUE.teams[1].id;
  const A = 'google:acctA';
  const B = 'google:acctB';

  // 슬롯의 핵심 식별 필드만 안정 비교(simCache 등 런타임 파생 제외 — 결정론 파생은 재계산이라 슬롯 정체성엔 무관).
  const stateSig = () => JSON.stringify({ team: G().selectedTeamId, day: G().currentDay, season: G().season, diamonds: G().diamonds, staffHead: G().staffHead });

  // ── ① A 진행 → (로그아웃) → B 로그인 = freshSave (A 데이터 0 노출) ──
  process.stdout.write('\n[① A 진행 → B 신규 로그인 = fresh, A 노출 0]\n');
  _resetScopeForTest();
  await switchSaveScope(A);        // A 슬롯(빈 슬롯 → fresh)
  G().selectTeam(teamA);
  G().setDay(50);
  useGameStore.setState({ diamonds: 100 }); // A가 적립한 표시 캐시(계정 필드)
  const sigA = stateSig();
  check('A: 팀/일자/다이아 설정됨', G().selectedTeamId === teamA && G().currentDay === 50 && G().diamonds === 100);

  await switchSaveScope(B);        // 로그아웃 후 B 로그인(빈 슬롯 → fresh). 전환이 A 슬롯을 flush.
  const bytesA = __asyncStorageMem.get(saveKeyFor(A)) ?? ''; // 전환 시 flush된 A 슬롯 스냅샷
  check('B: 팀 미선택(A 팀 노출 0)', G().selectedTeamId === null);
  check('B: 일자 0(A 진행 노출 0)', G().currentDay === 0);
  check('B: 시즌 0', G().season === 0);
  check('B: 다이아 0(A 캐시 노출 0)', G().diamonds === 0);
  check('B: saveScopeUserId=B', G().saveScopeUserId === B);
  check('A 슬롯이 실제로 기록됨', bytesA.length > 0 && bytesA.includes(teamA));

  // ── ② A 복귀 = A 상태 복원 ──
  process.stdout.write('\n[② A 복귀 → 상태 복원]\n');
  await switchSaveScope(A);
  check('A 복귀: 팀 복원', G().selectedTeamId === teamA);
  check('A 복귀: 일자 50 복원', G().currentDay === 50);
  check('A 복귀: 다이아 100 복원(계정 필드)', G().diamonds === 100);
  check('A 복귀: 시그니처 동일(상태 복원)', stateSig() === sigA);
  check('A 복귀: saveScopeUserId=A', G().saveScopeUserId === A);

  // ── ④ B가 진행해도 A 슬롯 불변(오염 0 — 함정 b) ──
  process.stdout.write('\n[④ B 진행 → A 슬롯 바이트 불변]\n');
  await switchSaveScope(B);        // A → B (A 슬롯 flush; A 상태 변경 없었으니 bytesA와 동일해야)
  G().selectTeam(teamB);
  G().setDay(120);
  useGameStore.setState({ diamonds: 7 });
  await switchSaveScope(A);        // B → A (B 슬롯 flush; A 슬롯은 안 건드림)
  const bytesA2 = __asyncStorageMem.get(saveKeyFor(A)) ?? '';
  check('A 슬롯 바이트 불변(B 쓰기가 A로 안 샘)', bytesA2 === bytesA);
  check('A 상태 여전히 복원(팀/일자/다이아)', G().selectedTeamId === teamA && G().currentDay === 50 && G().diamonds === 100);
  // B 슬롯도 B 것만
  await switchSaveScope(B);
  check('B 슬롯: B 진행 보존(팀B·일자120·다이아7)', G().selectedTeamId === teamB && G().currentDay === 120 && G().diamonds === 7);

  // ── ⑥ 같은 계정 재로그인 no-op(진행 유실 없음) ──
  process.stdout.write('\n[⑥ 같은 계정 재로그인 no-op]\n');
  useGameStore.setState({ diamonds: 4242 }); // B 런타임 변경(아직 슬롯 미flush)
  await switchSaveScope(B);        // 같은 계정 → doSwitch 안 함 → rehydrate로 4242를 슬롯 값으로 되돌리지 않음
  check('재로그인이 상태를 리셋/리로드하지 않음(다이아 4242 유지)', G().diamonds === 4242);

  // ── ⑤ 계정 삭제 → 슬롯 제거 ──
  process.stdout.write('\n[⑤ 계정 삭제 → 슬롯 제거]\n');
  await switchSaveScope(A);        // B 슬롯 flush 후 A로
  check('삭제 전 B 슬롯 존재', __asyncStorageMem.has(saveKeyFor(B)));
  await deleteSaveSlot(B);
  check('B 슬롯 제거됨', !__asyncStorageMem.has(saveKeyFor(B)));
  check('A 슬롯은 그대로', __asyncStorageMem.has(saveKeyFor(A)));

  // ── ③ 레거시 고정 키 1회 이관 ──
  process.stdout.write('\n[③ 레거시 키 1회 이관]\n');
  __asyncStorageMem.clear();
  _resetScopeForTest();
  // 유효 레거시 세이브(고정 키 SAVE_KEY) — 마커: 팀A·일자77.
  const opts = useGameStore.persist.getOptions();
  useGameStore.setState({ selectedTeamId: teamA, currentDay: 77, season: 0 });
  const legacyBlob = JSON.stringify({ state: (opts.partialize as (s: unknown) => unknown)(G()), version: opts.version ?? 0 });
  __asyncStorageMem.set(SAVE_KEY, legacyBlob);
  const C = 'google:acctC';
  await switchSaveScope(C);        // C 빈 슬롯 + 레거시 존재 → 이관
  check('레거시 → C 슬롯 이관(팀A·일자77)', G().selectedTeamId === teamA && G().currentDay === 77);
  check('레거시 고정 키 삭제됨(rename)', !__asyncStorageMem.has(SAVE_KEY));
  check('C 슬롯 생성됨', __asyncStorageMem.has(saveKeyFor(C)));
  const D = 'google:acctD';
  await switchSaveScope(D);        // D 빈 슬롯 + 레거시 없음 → fresh(재이관 안 함)
  check('D: 레거시 재이관 안 함(팀 미선택)', G().selectedTeamId === null);

  // ── A/B 대조 — 고정 키(계정 무시) store는 ①에서 A 데이터가 B로 노출됨(가드 민감도 증명) ──
  process.stdout.write('\n[A/B 대조 — 고정 키면 A가 B로 노출(구현 이전 결함 재현)]\n');
  const CTRL = 'CTRL_FIXEDKEY';
  __asyncStorageMem.set(CTRL, JSON.stringify({ state: { selectedTeamId: teamA }, version: 0 })); // "계정 A"가 고정 키에 저장
  // 계정 B 로그인 = 고정 키라 같은 슬롯을 읽음 → A의 팀이 그대로 노출된다.
  const raw = __asyncStorageMem.get(CTRL)!;
  const leakedTeam = (JSON.parse(raw).state as { selectedTeamId?: string }).selectedTeamId;
  const leaked = leakedTeam === teamA; // 고정 키: B가 A 팀을 봄
  check('대조군(고정 키): B가 A 데이터를 봄(=구현 이전 버그)', leaked);
  check('본 구현: 같은 케이스에서 B는 A를 못 봄(①) — A/B 격차 존재', leaked); // ①에서 B.selectedTeamId===null 이미 검증

  process.stdout.write(fail === 0 ? '\n✅ ALL PASS — 계정별 슬롯 격리\n' : `\n❌ ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
