// 세이브 코퍼스(골든 마스터) 가드 — OpenTTD 관행 차용(SAVE_SYSTEM §9).
//   corpus/saves/*.json(실제 게임 진행으로 박제한 세이브)을 전부 모킹 AsyncStorage에 넣고
//   진짜 zustand persist 파이프라인(migrate→merge→onRehydrateStorage)을 완주시켜
//   "출시 후 과거 버전 세이브가 새 코드에서 열리는가"를 상시 지킨다.
//   _dv_migrate_e2e(합성 손상 입력)와 달리 이건 실제 진행 세이브를 박제한 회귀 코퍼스다.
//
//   npx tsx tools/_dv_save_corpus.ts             # 코퍼스 전체 로드 검증
//   npx tsx tools/_dv_save_corpus.ts --selftest  # 팬텀 A/B(절단 입력을 가드가 "로드 실패"로 검출하는지)
import './_gt_mock';
import { __asyncStorageMem } from './_gt_mock';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const SELFTEST = process.argv.includes('--selftest');
const CORPUS_DIR = join(__dirname, '..', 'corpus', 'saves');
let fail = 0;
const check = (n: string, c: boolean) => { process.stdout.write(`${c ? '✅' : '❌'} ${n}\n`); if (!c) fail++; };

// 파일에 박제된 selectedTeamId(=리셋 아님 판정 기준)를 파일 바이트에서 직접 파싱(로더 신뢰 안 함).
function expectedTeamOf(raw: string): string | null {
  try { const j = JSON.parse(raw); return (j?.state?.selectedTeamId ?? null) as string | null; } catch { return null; }
}

async function main() {
  const { useGameStore, SAVE_KEY: KEY } = await import('../store/useGameStore');
  const { resetLeagueBase, currentRosters } = await import('../data/league');
  const { availableTeamPlayers } = await import('../data/dynamics');
  const { buildLineup } = await import('../engine/lineup');
  const G = () => useGameStore.getState();

  // 초기 auto-rehydrate(빈 스토리지) 정착
  await useGameStore.persist.rehydrate();

  // 한 세이브 raw 문자열을 스토리지에 넣고 실제 rehydrate. 로드 전 센티넬로 리셋해
  // "rehydrate가 실제로 아무것도 안 실었는지"(무변화 false-pass)를 차단한다.
  const SENTINEL = '__CORPUS_SENTINEL__';
  const load = async (raw: string) => {
    resetLeagueBase();
    useGameStore.setState({ selectedTeamId: SENTINEL, currentDay: -1, season: -1, playerBase: null, rosters: null, hydrated: false });
    __asyncStorageMem.set(KEY, raw);
    let threw = false;
    try { await useGameStore.persist.rehydrate(); } catch { threw = true; }
    return { st: G(), threw };
  };

  // 로드된 store가 "유효한 세이브"인가 — ① throw 없음 ② 리셋 아님(team이 파일 값과 일치)
  // ③ 마이그레이션 후 유효(내 팀 로스터로 buildLineup 성립). 반환 ok=전부 만족.
  const validate = (raw: string, r: { st: ReturnType<typeof G>; threw: boolean }): { ok: boolean; why: string } => {
    if (r.threw) return { ok: false, why: 'rehydrate throw' };
    const expTeam = expectedTeamOf(raw);
    const st = r.st;
    if (st.selectedTeamId === SENTINEL) return { ok: false, why: '센티넬 잔존(rehydrate 미적용)' };
    if (expTeam !== null && st.selectedTeamId !== expTeam) return { ok: false, why: `team 불일치(리셋됨): exp=${expTeam} got=${st.selectedTeamId}` };
    const team = st.selectedTeamId;
    if (!team) return { ok: false, why: 'selectedTeamId 없음' };
    // 로스터 존재(시즌0=시드 재구성, 시즌≥1=커밋 base) — 그리고 실 경기 라인업이 성립하는가.
    const roster = currentRosters()[team] ?? [];
    if (roster.length === 0) return { ok: false, why: '내 팀 로스터 비어있음' };
    try {
      const day = Math.max(0, st.currentDay);
      const avail = availableTeamPlayers(team, day);
      if (avail.length === 0) return { ok: false, why: '출전 가능 인원 0' };
      const lu = buildLineup(avail);
      if (lu.six.filter(Boolean).length < 6) return { ok: false, why: '선발 6인 미충족' };
    } catch (e) {
      return { ok: false, why: `buildLineup throw: ${(e as Error).message}` };
    }
    return { ok: true, why: '' };
  };

  // ── 비공허 증명 ⓐ — 코퍼스 디렉터리가 비면 FAIL(무의미 그린 방지) ──
  let files: string[] = [];
  try { files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json')); } catch { /* dir 없음 → files=[] */ }
  process.stdout.write(`\n[코퍼스 로드 — ${CORPUS_DIR} · ${files.length}개 파일]\n`);
  check('코퍼스 비공허(≥1 세이브 박제됨)', files.length > 0);

  // ── 각 코퍼스 파일 로드·검증 ──
  for (const f of files.sort()) {
    const raw = readFileSync(join(CORPUS_DIR, f), 'utf8');
    const r = await load(raw);
    const v = validate(raw, r);
    check(`${f} — 로드·유효(team=${r.st.selectedTeamId} day=${r.st.currentDay} season=${r.st.season})`, v.ok);
    if (!v.ok) process.stdout.write(`      ↳ ${v.why}\n`);
  }

  // ── 비공허 증명 ⓑ(--selftest) — 절단(truncate) 입력을 가드가 "로드 실패"로 검출하는가(팬텀 A/B) ──
  if (SELFTEST) {
    process.stdout.write('\n[--selftest 팬텀 A/B — 코퍼스 파일을 메모리에서 절단해 주입]\n');
    if (files.length === 0) { check('selftest 불가(코퍼스 비어있음)', false); }
    else {
      const victim = files.sort()[0];
      const rawFull = readFileSync(join(CORPUS_DIR, victim), 'utf8');
      // 원본은 정상 로드(A) → 절단본은 로드 실패(B). 두 결과의 격차가 가드 민감도.
      const good = validate(rawFull, await load(rawFull));
      check(`A: 원본 ${victim} 정상 로드(유효)`, good.ok);
      // 절단 — 문자열 절반에서 잘라 JSON 파괴(불완전 세이브 모사). 프로덕션 파일은 손대지 않음(메모리만).
      const truncated = rawFull.slice(0, Math.floor(rawFull.length / 2));
      const bad = validate(rawFull /* expTeam은 원본에서 */, await load(truncated));
      check('B: 절단본은 가드가 "로드 실패"로 검출(그린이면 팬텀)', bad.ok === false);
      process.stdout.write(`      ↳ 검출 사유: ${bad.why || '(없음 — 팬텀!)'}\n`);
      check('A/B 격차 존재(원본 OK · 절단본 FAIL) — 가드 민감', good.ok && bad.ok === false);
    }
  }

  process.stdout.write(fail === 0 ? '\n✅ ALL PASS — 코퍼스 전체가 현재 코드에서 로드됨\n' : `\n❌ ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
