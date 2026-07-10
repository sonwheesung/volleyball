// 세이브 마이그레이션·정규화 가드 (SAVE_SYSTEM §6) — 손상/구버전 입력이 안전하게 로드되는지.
//   npx tsx tools/_dv_migrate.ts
// 검증: ① 손상 입력 정규화(컨테이너 모양 강제) ② 정상 입력 멱등 ③ A/B(정규화 없이 실제 복원 경로 크래시 실증)
//      ④ migrate 버전 ⑤ drift(SAVE_DEFAULTS 키 == partialize 키). A/B 자가검증으로 가드 신뢰 입증.
import './_gt_mock';
import { sanitizeSave, migrateSave, SAVE_DEFAULTS, SAVE_VERSION } from '../store/saveMigration';
import { setTxContext } from '../data/dynamics';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
let fail = 0;
const check = (name: string, cond: boolean) => { process.stdout.write(`${cond ? '✅' : '❌'} ${name}\n`); if (!cond) fail++; };

// ── ① 손상 입력 정규화 ──────────────────────────────────────────────
const corrupt: Record<string, unknown> = {
  inSeasonTx: {}, faPool: 'oops', benchDirectives: 42, archive: 'x', milestones: null,
  results: [], watchProgress: 7, rosters: [1, 2], playerBase: 'str', coachPool: [],
  staffHead: [], staffAssistants: 'no', trainingFocus: { primary: 'bad' },
  careerLog: null, careerTotals: { points: 'NaN', aces: 3 }, lastFinance: [],
  cash: 'lots', fanScore: NaN, season: null, currentDay: undefined, selectedTeamId: 99,
  keepForeign: 'maybe', foreignSubUsed: 1, sfxEnabled: 'yes', seenTips: [],
  faOffers: 'bad', // FA 오퍼(§2.8) — 손상 → {}
};
const s = sanitizeSave(corrupt);
process.stdout.write('\n[① 손상 입력 → 유효 스키마]\n');
check('inSeasonTx {} → []', Array.isArray(s.inSeasonTx) && (s.inSeasonTx as unknown[]).length === 0);
check('faPool "oops" → []', Array.isArray(s.faPool));
check('benchDirectives 42 → []', Array.isArray(s.benchDirectives));
check('archive "x" → []', Array.isArray(s.archive));
check('milestones null → []', Array.isArray(s.milestones));
check('results [] → {}', isObj(s.results));
check('watchProgress 7 → {}', isObj(s.watchProgress));
check('rosters [1,2] → null(nullable rec)', s.rosters === null);
check('playerBase "str" → null', s.playerBase === null);
check('coachPool [] → null', s.coachPool === null);
check('staffHead [] → {}', isObj(s.staffHead));
check('staffAssistants "no" → {}', isObj(s.staffAssistants));
check('trainingFocus malformed → null', s.trainingFocus === null);
check('careerLog null → {0×4}', isObj(s.careerLog) && (s.careerLog as any).faSigns === 0 && (s.careerLog as any).interviews === 0);
check('careerTotals points "NaN"→0, aces 3 보존', (s.careerTotals as any).points === 0 && (s.careerTotals as any).aces === 3);
check('lastFinance [] → null', s.lastFinance === null);
check('cash "lots" → 50000', s.cash === 50000);
check('fanScore NaN → 50', s.fanScore === 50);
check('season null → 0', s.season === 0);
check('currentDay undefined → 0', s.currentDay === 0);
check('selectedTeamId 99 → null', s.selectedTeamId === null);
check('keepForeign "maybe" → null', s.keepForeign === null);
check('foreignSubUsed 1 → false', s.foreignSubUsed === false);
check('sfxEnabled "yes" → true(기본)', s.sfxEnabled === true);
check('seenTips [] → {}', isObj(s.seenTips));
check('faOffers "bad" → {}', isObj(s.faOffers) && Object.keys(s.faOffers as object).length === 0);
check('전 필드 존재(SAVE_DEFAULTS 키 집합)', Object.keys(SAVE_DEFAULTS).every((k) => k in s));

// ── ①b faOffers 엔트리 정규화(FA_SYSTEM §2.8) ──────────────────────
process.stdout.write('\n[①b faOffers 엔트리 코어스]\n');
const foRaw = { faOffers: { p1: { salary: 'auto', years: 9, starterGuarantee: 'x', promises: 7, counterTolerance: { salaryUp: 0 } }, p2: { salary: 42, years: 3, starterGuarantee: true, promises: { captain: true }, aggressive: true, counterTolerance: { salaryUp: 5000 } }, p3: { salary: 'auto', years: 2, starterGuarantee: false, promises: {}, counterTolerance: { salaryUp: 'bad' } }, bad: 5 } };
const fo = sanitizeSave(foRaw).faOffers as Record<string, any>;
check('p1: years 9→2·보장 "x"→false·promises 7→{}', fo.p1 && fo.p1.years === 2 && fo.p1.starterGuarantee === false && isObj(fo.p1.promises) && Object.keys(fo.p1.promises).length === 0);
check('p1: salary "auto" 보존', fo.p1.salary === 'auto');
check('p1: counterTolerance salaryUp 0 → 드롭(§2.8.6 — 0=미설정)', fo.p1.counterTolerance === undefined);
check('p2: salary 42·years 3·보장 true·promises{captain}·aggressive true 보존', fo.p2 && fo.p2.salary === 42 && fo.p2.years === 3 && fo.p2.starterGuarantee === true && fo.p2.promises.captain === true && fo.p2.aggressive === true);
check('p2: counterTolerance{salaryUp:5000} 보존(round-trip)', isObj(fo.p2.counterTolerance) && fo.p2.counterTolerance.salaryUp === 5000);
check('p3: counterTolerance salaryUp "bad" → 드롭', fo.p3 && fo.p3.counterTolerance === undefined);
check('bad(5) 엔트리 제거', !('bad' in fo));

// ── ①c 구 faSignings+faAggressive → faOffers 마이그레이션 ───────────
process.stdout.write('\n[①c faSignings+faAggressive → faOffers 변환]\n');
const migAgg = migrateSave({ faSignings: ['a', 'b'], faAggressive: true, selectedTeamId: 't0' }, 0).faOffers as Record<string, any>;
check('구 aggressive=on → 전 오퍼 aggressive:true(×1.2 재현)', migAgg.a && migAgg.a.aggressive === true && migAgg.b.aggressive === true && migAgg.a.salary === 'auto' && migAgg.a.years === 2);
const migPlain = migrateSave({ faSignings: ['c'], faAggressive: false, selectedTeamId: 't0' }, 0).faOffers as Record<string, any>;
check('구 aggressive=off → aggressive 마커 없음(×1)', migPlain.c && migPlain.c.aggressive === undefined && migPlain.c.salary === 'auto');
const migNew = migrateSave({ faOffers: { z: { salary: 'auto', years: 2, starterGuarantee: false, promises: {} } }, selectedTeamId: 't0' }, 0).faOffers as Record<string, any>;
check('신 세이브(faOffers 존재) → 변환 안 함(z 보존)', migNew.z && !migNew.a);

// ── ② 정상 입력 멱등(의미 보존) ─────────────────────────────────────
process.stdout.write('\n[② 정상 입력 멱등]\n');
const valid: Record<string, unknown> = {
  ...SAVE_DEFAULTS, season: 5, cash: 12345, selectedTeamId: 't0',
  archive: [{ season: 0, championId: 't1' }],
  inSeasonTx: [{ day: 1, teamId: 't0', playerId: 'p', kind: 'sign' }],
  playerBase: { p0: { id: 'p0', name: 'X' } }, rosters: { t0: ['p0'] },
  careerTotals: { points: 999, aces: 10, setsWon: 5, setsLost: 2, matchWins: 3, matchLosses: 1 },
  keepForeign: true, trainingFocus: { primary: [1, 2], secondary: [3, 4, 5] },
  coachPool: { coaches: [{ id: 'c0' }], assistants: [] },
};
const v = sanitizeSave(valid);
check('season 5 보존', v.season === 5);
check('cash 12345 보존', v.cash === 12345);
check('selectedTeamId 보존', v.selectedTeamId === 't0');
check('archive 보존', Array.isArray(v.archive) && (v.archive as any)[0].championId === 't1');
check('inSeasonTx 보존', (v.inSeasonTx as any)[0].kind === 'sign');
check('playerBase 레코드 보존', isObj(v.playerBase) && (v.playerBase as any).p0.name === 'X');
check('rosters 보존', isObj(v.rosters) && (v.rosters as any).t0[0] === 'p0');
check('careerTotals 보존', (v.careerTotals as any).points === 999);
check('keepForeign true 보존', v.keepForeign === true);
check('trainingFocus 유효 보존', isObj(v.trainingFocus) && Array.isArray((v.trainingFocus as any).primary));
check('coachPool 유효 보존', isObj(v.coachPool) && (v.coachPool as any).coaches[0].id === 'c0');

// ── ③ A/B 자가검증 — 정규화가 실제로 크래시를 막는가 ────────────────
process.stdout.write('\n[③ A/B — 실제 복원 경로(setTxContext) 크래시 실증]\n');
let crashedRaw = false;
try { setTxContext(corrupt.inSeasonTx as any, corrupt.faPool as any, ''); } catch { crashedRaw = true; }
check('A) 정규화 없이 손상 입력 → setTxContext 크래시(가드 민감)', crashedRaw);
let crashedSan = false;
try { setTxContext(s.inSeasonTx as any, s.faPool as any, ''); } catch { crashedSan = true; }
check('B) 정규화 후 → setTxContext 무크래시', !crashedSan);

// ── ④ migrate 버전 ─────────────────────────────────────────────────
process.stdout.write('\n[④ migrate 버전]\n');
check('migrateSave(undefined,0) 유효 스키마', Object.keys(SAVE_DEFAULTS).every((k) => k in migrateSave(undefined, 0)));
check('migrateSave(손상,0) 무크래시', Object.keys(migrateSave(corrupt, 0)).length === Object.keys(SAVE_DEFAULTS).length);
check('SAVE_VERSION ≥ 1', SAVE_VERSION >= 1);

// ── ⑤ drift — SAVE_DEFAULTS 키 == partialize 키 ────────────────────
process.stdout.write('\n[⑤ drift — partialize ↔ SAVE_DEFAULTS 키 일치]\n');
import('../store/useGameStore').then(({ useGameStore }) => {
  const part = useGameStore.persist.getOptions().partialize as undefined | ((s: any) => Record<string, unknown>);
  if (!part) { check('partialize 존재', false); finish(); return; }
  const pk = Object.keys(part(useGameStore.getState()));
  const dk = Object.keys(SAVE_DEFAULTS);
  const missing = pk.filter((k) => !dk.includes(k));   // partialize엔 있는데 SAVE_DEFAULTS에 없음 → 정규화 누락
  const extra = dk.filter((k) => !pk.includes(k));     // SAVE_DEFAULTS엔 있는데 저장 안 됨 → 불필요
  check(`partialize ⊆ SAVE_DEFAULTS (누락: ${missing.join(',') || '없음'})`, missing.length === 0);
  check(`SAVE_DEFAULTS ⊆ partialize (잉여: ${extra.join(',') || '없음'})`, extra.length === 0);
  finish();
});

function finish() {
  process.stdout.write(fail === 0 ? '\n✅ ALL PASS\n' : `\n❌ ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
