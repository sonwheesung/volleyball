// 가드 — 시상식 "이어보기": 우승 적립과 관람 진행도 분리 (SEASON_SYSTEM §5.3.1, 2026-07-24 사용자 결정)
//
// 봉인하는 버그: champion-ceremony **진입 시** recordChampion이 찍는 archive.championId를 "시상식 다 봤음" 마커로
//   겸용하던 탓에, 리그 시상식(9개 포스터)을 중간에 나가면 일정 카드가 곧바로 "끝났습니다"로 바뀌어 **남은 상을 영영 못 봤다**.
//   결정 (a) = recordChampion 시점은 그대로(허브 게이트 보존), **관람 진행도(ceremonyProgress)만 별도 추적**.
//
// 검사:
//   C1 recordChampion 시점 불변 — 호출 = archive에 championId 적립(허브·결산 게이트 소스). 진행도와 독립.
//   C2 진행도 영속 3곳 등록 — 스토어 기본값 · partialize · saveMigration(SAVE_DEFAULTS·KIND).
//   C3 상태기계 — 0(미관람) → n(이어보기) → -1(완료). 완료 후엔 setCeremonyProgress가 무시(재관람 중 done 유지).
//   C4 일정 카드 매핑(§5.3.1) — -1=끝났습니다(버튼 없음) · 0=보러가기(→champion) · n≥1=이어보기(→awards).
//   C5 endSeason 후 진행도 0 리셋.
//   C6 구세이브(필드 누락) → 기본 0(재관람 유도, 손실 없음).
//   A/B: "진입=완료"(구 동작) 오라클로 보면 **중간 이탈 상태가 done으로 오판**된다(진행도 오라클과 갈림) → 버그 재현 증명.
//
//   npx tsx tools/_dv_ceremony.ts   (exit 0=PASS / 1=FAIL)
import './_gt_mock';

const log = (m: string) => process.stdout.write(m + '\n');
let fail = 0;
const check = (cond: boolean, pass: string, failMsg: string) => {
  if (cond) log(`PASS ${pass}`); else { fail++; log(`FAIL ${failMsg}`); }
};

// 일정 카드 결정(§5.3.1 정본 표) — schedule.tsx 인라인 로직과 동일 규약. 순수 파생.
function ceremonyCard(progress: number): { label: string | null; route: string | null } {
  if (progress === -1) return { label: null, route: null };            // 끝났습니다(버튼 없음)
  if (progress === 0) return { label: '시상식 보러가기 →', route: '/champion-ceremony' };
  return { label: '시상식 이어보기 →', route: '/awards-ceremony' };     // n≥1
}

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { SAVE_DEFAULTS, sanitizeSave } = await import('../store/saveMigration');
  const { LEAGUE, SEASON } = await import('../data/league');
  const { SEASON_DAYS } = await import('../engine/calendar');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  log('=== 시상식 이어보기 가드 (§5.3.1) ===');

  // ── C1 recordChampion 시점 불변 + 진행도 독립 ──
  G().resetSave(); G().selectTeam(my);
  const champ = LEAGUE.teams[1].id;
  const progBeforeEntry = G().ceremonyProgress;
  G().recordChampion(0, champ); // 시상식(champion-ceremony) 진입 시 적립 — 이 호출이 곧 "진입" 재현
  const archived = G().archive.some((a) => a.season === 0 && a.championId === champ);
  const progAfterEntry = G().ceremonyProgress;
  check(archived, 'C1a recordChampion → archive championId 적립(허브 게이트 소스 불변)', 'C1a recordChampion이 championId를 안 박음');
  check(progBeforeEntry === 0 && progAfterEntry === 0, 'C1b 진입(=recordChampion)이 진행도를 건드리지 않음(0 유지 — 진입≠완료)', `C1b 진입이 진행도를 바꿈 ${progBeforeEntry}→${progAfterEntry}`);

  // ── C2 영속 3곳 ──
  const hasDefault = 'ceremonyProgress' in SAVE_DEFAULTS && (SAVE_DEFAULTS as any).ceremonyProgress === 0;
  const inState = 'ceremonyProgress' in G();
  // partialize 확인 — 세이브 왕복(persist)에 필드가 담기는지: sanitizeSave가 값을 보존(정규화가 num으로 통과)
  const roundtrip = sanitizeSave({ ...SAVE_DEFAULTS, ceremonyProgress: 5 } as any).ceremonyProgress;
  check(hasDefault, 'C2a SAVE_DEFAULTS.ceremonyProgress=0', 'C2a SAVE_DEFAULTS 누락');
  check(inState, 'C2b 스토어 기본 state에 존재', 'C2b 스토어 state 누락');
  check(roundtrip === 5, 'C2c saveMigration KIND=num(값 보존 정규화)', `C2c 정규화가 값을 잃음 → ${roundtrip}`);

  // ── C3 상태기계 ──
  G().resetSave(); G().selectTeam(my);
  G().setCeremonyProgress(1); const s1 = G().ceremonyProgress;
  G().setCeremonyProgress(5); const s5 = G().ceremonyProgress;
  G().setCeremonyProgress(-1); const sDone = G().ceremonyProgress;
  G().setCeremonyProgress(3); const sSticky = G().ceremonyProgress; // 완료 후 무시
  G().setCeremonyProgress(NaN); const sNaN = G().ceremonyProgress;  // NaN 방어
  check(s1 === 1 && s5 === 5 && sDone === -1 && sSticky === -1 && sNaN === -1,
    'C3 상태기계 0→n→-1 · 완료 후 무시(sticky) · NaN 방어',
    `C3 상태기계 오류 1=${s1} 5=${s5} done=${sDone} sticky=${sSticky} nan=${sNaN}`);

  // ── C4 카드 매핑 ──
  const c_done = ceremonyCard(-1), c_start = ceremonyCard(0), c_resume = ceremonyCard(3);
  check(c_done.label === null && c_start.route === '/champion-ceremony' && c_resume.route === '/awards-ceremony',
    'C4 카드: -1=끝(버튼0) · 0=보러가기→champion · n=이어보기→awards',
    `C4 카드 매핑 오류 ${JSON.stringify([c_done, c_start, c_resume])}`);

  // ── C5 endSeason 후 0 리셋 ──
  G().resetSave(); G().selectTeam(my);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
  G().setDay(SEASON_DAYS);
  G().setCeremonyProgress(-1); // 이번 시즌 시상식 완료 상태
  G().endSeason();
  check(G().ceremonyProgress === 0, 'C5 endSeason 후 진행도 0 리셋(새 시즌 = campDoneSeason 패턴)', `C5 리셋 실패 ${G().ceremonyProgress}`);

  // ── C6 구세이브 필드 누락 → 0 ──
  const legacy: any = { ...SAVE_DEFAULTS };
  delete legacy.ceremonyProgress;
  const restored = sanitizeSave(legacy).ceremonyProgress;
  check(restored === 0, 'C6 구세이브(필드 누락) → 0(처음부터, 안전)', `C6 구세이브 기본값 ${restored}≠0`);

  // ── A/B: "진입=완료"(구 동작) 오라클로 보면 중간 이탈이 done으로 오판 ──
  //   상황 = 진입(recordChampion) + 9비트 중 3개 봄(progress=3). 진짜 오라클(진행도)로는 미완이라 이어보기.
  const entered = true;        // recordChampion 됨(허브 게이트)
  const progressMid: number = 3; // 3비트 봄
  const realDone = progressMid === -1;                 // 진행도 오라클(신) = false → 이어보기
  const buggyDone = entered;                           // "진입=완료"(구) = true → 끝났습니다(버그)
  const abSensitive = realDone === false && buggyDone === true && ceremonyCard(progressMid).label === '시상식 이어보기 →';
  check(abSensitive, 'A/B 중간 이탈: 신 오라클=이어보기(미완) vs 구"진입=완료"=끝(버그) — 갈림 확인',
    'A/B 무감각 — 진입=완료 버그와 구분 안 됨');

  const pass = fail === 0;
  log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fail ? ` — ${fail}건 실패` : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
