// INDEPENDENT — 시즌 종료 텔레메트리 집계 가드(BACKEND_SYSTEM §13.27, 2026-07-30).
//   computeSeasonTelemetry가 ① 개입/방출/지휘로그/훈련방향을 정확히 집계하고 ② 순수(입력 무변경·rng 미소비)하며
//   ③ A/B 민감(지휘모드=최신일·빈 개입=0·훈련null·팀null=방출0)인지 검증. 에이전트 인라인 검증을 영속화.
//   Usage: npx tsx tools/_dv_seasontele.ts
import { computeSeasonTelemetry, type TelemetrySource, type TelemetryMeta } from '../data/seasonTelemetry';
import type { MatchIntervention } from '../engine/simMatch';
import type { TrainingFocus } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { log('  ✗ FAIL: ' + m); fail++; } else log('  ✓ ' + m); };

const iv = (kind: 'timeout' | 'sub', subKind?: 'pinch' | 'manual') =>
  ({ kind, ...(subKind ? { subKind } : {}) } as unknown as MatchIntervention);

const base: TelemetrySource = {
  selectedTeamId: 't1',
  interventions: {
    fa: [iv('sub', 'manual'), iv('sub', 'manual'), iv('timeout')],       // manual2 + timeout1
    fb: [iv('sub', 'pinch'), iv('timeout'), iv('sub', 'manual')],         // pinch1 + timeout1 + manual1
  },
  coachModeLog: [{ day: 10, manual: true }, { day: 40, manual: true }, { day: 25, manual: false }] as TelemetrySource['coachModeLog'],
  benchDirectives: [{ playerId: 'p1' }, { playerId: 'p2' }, { playerId: 'p3' }],
  inSeasonTx: [{ teamId: 't1', kind: 'release' }, { teamId: 't1', kind: 'release' }, { teamId: 't2', kind: 'release' }, { teamId: 't1', kind: 'sign' }],
  trainingFocus: { primary: [4, 6], secondary: [1, 10, 12] } as unknown as TrainingFocus,
  campTrainedThisOffseason: ['a', 'b', 'c', 'd'],
};
const meta: TelemetryMeta = { season: 7, finalRank: 3, champion: false, expels: 2 };

log('═══ 시즌 텔레메트리 집계 가드 ═══');
const before = JSON.stringify(base);
const p = computeSeasonTelemetry(base, meta);
const after = JSON.stringify(base);
log('  payload: ' + JSON.stringify(p));
ok(p.subs.manual === 3, 'subs.manual=3 (fa 2 + fb 1)');
ok(p.subs.pinch === 1, 'subs.pinch=1');
ok(p.subs.total === 4, 'subs.total=4');
ok(p.timeouts === 2, 'timeouts=2');
ok(p.interventions === 6, 'interventions=6 (3+3)');
ok(p.lineupChanges === 3, 'lineupChanges=3 (benchDirectives)');
ok(p.coachMode === true, 'coachMode=true (최신일 40=manual)');
ok(p.releases === 2, 'releases=2 (내 팀 release만 — t2·sign 제외)');
ok(p.expels === 2, 'expels=2 (meta 주입)');
ok(p.campCount === 4, 'campCount=4');
ok(p.trainingFocus === '4,6|1,10,12', 'trainingFocus 인코딩');
ok(p.season === 7 && p.finalRank === 3 && p.champion === false, 'meta 스칼라 전달');
ok(before === after, '순수 — 입력 상태 무변경(read-only)');

log('  [A/B 민감도]');
const abFalse = computeSeasonTelemetry({ ...base, coachModeLog: [{ day: 10, manual: true }, { day: 50, manual: false }] as TelemetrySource['coachModeLog'] }, meta);
ok(abFalse.coachMode === false, '최신일 설정 false → coachMode=false (오라클 민감)');
const abEmpty = computeSeasonTelemetry({ ...base, interventions: {} }, meta);
ok(abEmpty.subs.total === 0 && abEmpty.timeouts === 0 && abEmpty.interventions === 0, '개입 로그 없음 → subs/timeouts/interventions 0');
const abNoFocus = computeSeasonTelemetry({ ...base, trainingFocus: null }, meta);
ok(abNoFocus.trainingFocus === null, 'trainingFocus null → null');
const abNoTeam = computeSeasonTelemetry({ ...base, selectedTeamId: null }, meta);
ok(abNoTeam.releases === 0, '팀 미선택 → 내 팀 release 매칭 0');

log(fail === 0 ? '\n✅ SEASONTELE OK — 집계 정확·순수·A/B 민감 전부 통과' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
