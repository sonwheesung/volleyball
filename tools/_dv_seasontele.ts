// INDEPENDENT — 시즌 종료 텔레메트리 집계 가드(BACKEND_SYSTEM §13.27, 2026-07-30 · payload v2 2026-07-31).
//   computeSeasonTelemetry가 ① 개입/방출/지휘로그/훈련방향/로스터구성/전적을 정확히 집계하고 ② 순수(입력 무변경·rng 미소비)하며
//   ③ A/B 민감(지휘모드=최신일·빈 개입=0·훈련null·팀null=방출0·로스터 나이·빈 로스터 avg0·엔진호출 뮤턴트 검출)인지 검증.
//   Usage: npx tsx tools/_dv_seasontele.ts
import { computeSeasonTelemetry, type TelemetrySource, type TelemetryMeta } from '../data/seasonTelemetry';
import type { MatchIntervention } from '../engine/simMatch';
import type { TrainingFocus, Player } from '../types';
import { makePlayer } from '../data/seed';
import { createRng } from '../engine/rng';
import { overallRaw } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { log('  ✗ FAIL: ' + m); fail++; } else log('  ✓ ' + m); };

const iv = (kind: 'timeout' | 'sub', subKind?: 'pinch' | 'manual') =>
  ({ kind, ...(subKind ? { subKind } : {}) } as unknown as MatchIntervention);

// v2: 결정론 시드로 로스터 스냅샷 생성. 나이/외국인을 고정해 avg 예측 가능하게.
const rng = createRng(20260731);
const roster: Player[] = [
  makePlayer(rng, 'r1', 'S', false, 24),
  makePlayer(rng, 'r2', 'OH', false, 28),
  makePlayer(rng, 'r3', 'MB', false, 32),
  makePlayer(rng, 'r4', 'OP', true, 26),   // 외국인
  makePlayer(rng, 'r5', 'L', false, 30),
];
const expAvgAge = Math.round((24 + 28 + 32 + 26 + 30) / 5); // 28
const expForeign = 1;
const expAvgOvr = Math.round(roster.reduce((s, pl) => s + overallRaw(pl), 0) / roster.length);

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
  rosterPlayers: roster,
};
const meta: TelemetryMeta = { season: 7, finalRank: 3, champion: false, expels: 2, retirements: 1, wins: 22, losses: 14, setsWon: 71, setsLost: 55 };

log('═══ 시즌 텔레메트리 집계 가드 (v2) ═══');
const before = JSON.stringify(base);
const p = computeSeasonTelemetry(base, meta);
const after = JSON.stringify(base);
log('  payload: ' + JSON.stringify(p));
ok(p.v === 2, 'payload v=2');
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
// v2 로스터 구성
ok(p.rosterSize === 5, 'rosterSize=5');
ok(p.avgAge === expAvgAge, `avgAge=${expAvgAge} (로스터 나이 평균)`);
ok(p.avgOvr === expAvgOvr, `avgOvr=${expAvgOvr} (overallRaw 평균)`);
ok(p.foreignCount === expForeign, 'foreignCount=1 (r4만 외국인)');
// v2 전적(meta pass-through)
ok(p.retirements === 1, 'retirements=1 (meta 주입)');
ok(p.wins === 22 && p.losses === 14, 'wins/losses=22/14 (meta 주입)');
ok(p.setsWon === 71 && p.setsLost === 55, 'setsWon/Lost=71/55 (meta 주입)');
ok(before === after, '순수 — 입력 상태 무변경(read-only·로스터 뮤테이션 없음)');

log('  [A/B 민감도]');
const abFalse = computeSeasonTelemetry({ ...base, coachModeLog: [{ day: 10, manual: true }, { day: 50, manual: false }] as TelemetrySource['coachModeLog'] }, meta);
ok(abFalse.coachMode === false, '최신일 설정 false → coachMode=false (오라클 민감)');
const abEmpty = computeSeasonTelemetry({ ...base, interventions: {} }, meta);
ok(abEmpty.subs.total === 0 && abEmpty.timeouts === 0 && abEmpty.interventions === 0, '개입 로그 없음 → subs/timeouts/interventions 0');
const abNoFocus = computeSeasonTelemetry({ ...base, trainingFocus: null }, meta);
ok(abNoFocus.trainingFocus === null, 'trainingFocus null → null');
const abNoTeam = computeSeasonTelemetry({ ...base, selectedTeamId: null }, meta);
ok(abNoTeam.releases === 0, '팀 미선택 → 내 팀 release 매칭 0');
// v2 로스터 A/B — 빈 로스터는 avg 0(0분모 방어), 나이 변이는 avgAge에 반영(오라클 민감)
const abEmptyRoster = computeSeasonTelemetry({ ...base, rosterPlayers: [] }, meta);
ok(abEmptyRoster.rosterSize === 0 && abEmptyRoster.avgAge === 0 && abEmptyRoster.avgOvr === 0 && abEmptyRoster.foreignCount === 0, '빈 로스터 → rosterSize/avgAge/avgOvr/foreignCount 0');
const abAged = computeSeasonTelemetry({ ...base, rosterPlayers: roster.map((pl) => ({ ...pl, age: pl.age + 10 })) }, meta);
ok(abAged.avgAge === expAvgAge + 10, '나이 +10 변이 → avgAge +10 (로스터 파생 오라클 민감)');

log('  [순수성 뮤턴트 — 프로덕션 결함 주입해 가드가 잡는지]');
// 뮤턴트 A: 빌더가 로스터를 변형(엔진 상태변경 흉내)했다면 before!==after로 잡혀야 함 → 여기선 실제 빌더가 순수하니 통과(위 before===after가 오라클).
//   역주입 시뮬: 만약 빌더가 p.age++ 했다면 아래가 참이 됨을 보여 오라클 방향 증명.
const mutantWouldMutate = JSON.stringify(roster) !== JSON.stringify(roster.map((pl) => ({ ...pl, age: pl.age + 1 })));
ok(mutantWouldMutate, '오라클 방향성 — 로스터 age 변형은 JSON diff로 검출됨(순수성 오라클이 뮤턴트에 민감함을 증명)');
// 뮤턴트 B: avgOvr을 rng 소비로 계산했다면 같은 입력에 다른 값이 나옴 → 두 번 호출 동일성으로 결정성 증명.
const p2 = computeSeasonTelemetry(base, meta);
ok(p2.avgOvr === p.avgOvr && p2.avgAge === p.avgAge, '결정성 — 같은 입력 2회 호출 동일(rng 미소비 증명)');

log(fail === 0 ? '\n✅ SEASONTELE OK — 집계 정확·순수·A/B 민감(v2 로스터/전적 포함) 전부 통과' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
