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
check('51필드 전부 존재', Object.keys(SAVE_DEFAULTS).every((k) => k in s));

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
