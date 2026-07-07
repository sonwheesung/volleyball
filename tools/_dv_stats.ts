// 선수 스탯 엔드투엔드 적용 상비 가드 (MATCH_SYSTEM). 검증·실측=Fable 5 / 가드=Opus 에이전트, 2026-07-07.
// 목적: 화면에 뜨는 15개 선수 스탯(밑단 신체4·공통2·멘탈3 + 기술6)이 **경기 엔진에서 실제로 작동**하는지
//   — 죽은 스탯(입력만 받고 결과에 안 쓰이는 것)이 하나도 없는지 — 를 동일 시드 페어드 A/B로 상시 감시한다.
//   배선 경로: engine/ratings.ts deriveRatings(밑단→윗단 spike/block/dig/receive/set/serve) + rally.ts 직접읽기
//   (focus/consistency/vq/reaction/staminaMax는 랠리 확률식이 원시값을 바로 읽음).
//   npx tsx tools/_dv_stats.ts
//
// 방법(동일 시드 페어드 A/B):
//   두 미러 팀(LEAGUE.teams[0]=A vs [1]=B). A의 로스터에서 **딱 한 스탯만** 고정폭 boost한 판을 만들고,
//   동일 시드(1..N)로 A(boost) vs B 와 A(baseline) vs B 를 각각 N경기 돌려 BoxSink로 A의 박스 스탯을 합산,
//   boost-arm vs baseline-arm의 지표(킬%/에이스%/블록/디그/리시브범실%/공격범실%)가 **올바른 방향**으로
//   움직이는지 assert. 엔진은 결정론이라 같은 시드=같은 결과 → 출력 100% 재현(비-flaky).
//   최적화: baseline(무boost A vs B)은 스탯마다 동일하므로 **1회만** 돌려 전 지표를 뽑고, 스탯별로 boost-arm만 추가.
//
// ★ 스케일 함정(이 가드의 핵심 — Fable가 잡은 실측도구 결함 재현):
//   대부분 스탯은 0~100 스케일 → boost +20, clamp 99. 그러나 **height는 센티미터(약 165~190cm)**다.
//   height를 0~100 스탯처럼 `Math.min(99, height+20)`로 clamp하면 182cm 선수가 99cm로 뭉개져
//   spike/block이 폭락 → 킬%·블록이 거꾸로(↓) 나와 "방향 틀림" 오탐이 뜬다(엔진은 정상). 실제로 Fable가
//   deriveRatings 단위 A/B로 도구결함임을 확인. 그래서 이 가드는 **필드별 스케일을 분리**한다(height=cm/+8/clamp210).
//   MUTANT 블록이 "잘못된 0~100 스케일로 height를 boost하면 방향이 ❌로 뒤집힌다"를 재현해 가드 민감도를 증명한다.
//
// 허위 오라클 금지(mutant 자가검증): ① height를 틀린 스케일로 boost → 킬% 방향이 뒤집혀 assert가 FAIL함을 재현.
//   ② 무boost(baseline vs baseline)면 지표가 동률 → 방향 assert가 성립 안 함(진짜 boost가 있어야 통과) 을 증명.
//   exit 0=PASS / 1=FAIL.

import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import type { BoxSink } from '../engine/rally';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };

const N = 600; // 고정 시드 1..600 — Fable 실측과 동일 표본(결정론 → 완전 재현)

resetLeagueBase();
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A0 = availableTeamPlayers(t0, 0);
const B0 = availableTeamPlayers(t1, 0);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;
const idsA = new Set(A0.map((p) => p.id));

// A의 박스 합계(자기 팀 선수만 귀속)
interface Box { atkAtt: number; atkKill: number; atkErr: number; srvAtt: number; srvAce: number; srvErr: number; recvAtt: number; recvErr: number; blockPt: number; digSucc: number }
const zero = (): Box => ({ atkAtt: 0, atkKill: 0, atkErr: 0, srvAtt: 0, srvAce: 0, srvErr: 0, recvAtt: 0, recvErr: 0, blockPt: 0, digSucc: 0 });

// rosterA(=boost 또는 baseline) vs B0 를 시드 1..N으로 돌려 A의 박스 합산. 결정론(동일 시드=동일 결과).
function runBox(rosterA: Player[]): Box {
  const acc = zero();
  for (let i = 1; i <= N; i++) {
    const bx: BoxSink = new Map();
    simulateMatch(i, rosterA, B0, { ...base, box: bx });
    for (const [id, l] of bx) if (idsA.has(id)) {
      acc.atkAtt += l.atkAtt; acc.atkKill += l.atkKill; acc.atkErr += l.atkErr;
      acc.srvAtt += l.srvAtt; acc.srvAce += l.srvAce; acc.srvErr += l.srvErr;
      acc.recvAtt += l.recvAtt; acc.recvErr += l.recvErr;
      acc.blockPt += l.blockPt; acc.digSucc += l.digSucc;
    }
  }
  return acc;
}

// 필드별 스케일 분리 boost — 여기가 함정 방지의 핵심. height만 cm 스케일(+8/clamp210), 나머지 0~100(+20/clamp99).
type Key = keyof Player;
const boostRoster = (key: Key, delta: number, clampHi: number): Player[] =>
  A0.map((p) => ({ ...p, [key]: Math.min(clampHi, (p[key] as number) + delta) }));
const boost = (key: Key): Player[] =>
  key === 'height' ? boostRoster('height', 8, 210) : boostRoster(key, 20, 99);

// 지표 계산기
const killPct = (b: Box) => 100 * b.atkKill / b.atkAtt;
const acePct = (b: Box) => 100 * b.srvAce / b.srvAtt;
const recvErrPct = (b: Box) => 100 * b.recvErr / b.recvAtt;
const atkErrPct = (b: Box) => 100 * b.atkErr / b.atkAtt;

log(`동일 시드 페어드 A/B — N=${N}(시드 1..${N}) · A=${LEAGUE.teams[0].name} vs B=${LEAGUE.teams[1].name}\n`);
log('baseline(무boost A vs B) 산출 중…');
const bl = runBox(A0); // 전 스탯 공통 기준선 — 1회만
log(`  baseline: 킬% ${killPct(bl).toFixed(2)} · 에이스% ${acePct(bl).toFixed(2)} · 리시브범실% ${recvErrPct(bl).toFixed(2)} · 공격범실% ${atkErrPct(bl).toFixed(2)} · 블록 ${bl.blockPt} · 디그 ${bl.digSucc}\n`);

// 스탯별 스펙: [키, 라벨, 지표추출, 방향('up'|'down'), 지표이름]
type Dir = 'up' | 'down';
interface Spec { key: Key; label: string; metric: (b: Box) => number; dir: Dir; unit: string }
const specs: Spec[] = [
  // 기술 6종 (deriveRatings 경유)
  { key: 'skSpike',   label: '스파이크기술', metric: killPct,    dir: 'up',   unit: '킬%' },
  { key: 'skSet',     label: '세팅기술',     metric: killPct,    dir: 'up',   unit: '킬%(세터=팀공격 승수)' },
  { key: 'skServe',   label: '서브기술',     metric: acePct,     dir: 'up',   unit: '에이스%' },
  { key: 'skBlock',   label: '블로킹기술',   metric: (b) => b.blockPt, dir: 'up', unit: '블록득점' },
  { key: 'skDig',     label: '디그기술',     metric: (b) => b.digSucc, dir: 'up', unit: '디그성공' },
  { key: 'skReceive', label: '리시브기술',   metric: recvErrPct, dir: 'down', unit: '리시브범실%' },
  // 신체 (deriveRatings 경유 — spikeHeight/blockHeight/jump/agility/staminaMax)
  { key: 'jump',       label: '점프력',   metric: (b) => b.blockPt, dir: 'up', unit: '블록득점(+킬도↑)' },
  { key: 'height',     label: '키(cm)',   metric: killPct,    dir: 'up',   unit: '킬%(+블록도↑) ★cm스케일' },
  { key: 'agility',    label: '민첩성',   metric: (b) => b.digSucc, dir: 'up', unit: '디그성공' },
  // 공통 (deriveRatings block/dig/receive 경유)
  { key: 'reaction',    label: '반응속도', metric: (b) => b.blockPt, dir: 'up', unit: '블록득점(+디그도↑)' },
  { key: 'positioning', label: '위치선정', metric: recvErrPct, dir: 'down', unit: '리시브범실%(+디그도↑)' },
  // 멘탈 (rally.ts 직접읽기 + deriveRatings set/serve)
  { key: 'focus',       label: '집중력',   metric: acePct,     dir: 'up',   unit: '에이스%' },
  { key: 'consistency', label: '기복',     metric: atkErrPct,  dir: 'down', unit: '공격범실%' },
  { key: 'vq',          label: '배구IQ',   metric: atkErrPct,  dir: 'down', unit: '공격범실%' },
  // 신체 — 체력 상한 (rally.ts 체력소모/deriveRatings 경유)
  { key: 'staminaMax',  label: '체력',     metric: killPct,    dir: 'up',   unit: '킬%' },
];

for (const s of specs) {
  const on = s.metric(runBox(boost(s.key)));
  const off = s.metric(bl);
  const ok = s.dir === 'up' ? on > off : on < off;
  const arrow = s.dir === 'up' ? '↑' : '↓';
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  check(ok, `${s.label.padEnd(6)} ${s.unit} ${fmt(off)}→${fmt(on)} ${arrow} (boost ${s.key === 'height' ? '+8cm' : '+20'})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MUTANT 자가검증(허위 오라클 금지) — 가드가 신호 제거/스케일 오류 시 실제로 FAIL함을 재현.
// ─────────────────────────────────────────────────────────────────────────────
log('\nMUTANT 자가검증(오라클 민감도):');

// ① 잘못된 스케일 함정 재현: height를 0~100 스탯처럼 Math.min(99,·)로 boost하면 182cm가 99cm로 뭉개져
//    킬%가 폭락(↓) → 방향 assert(up)가 뒤집혀 FAIL. 이게 바로 Fable가 잡은 실측도구 결함.
{
  const wrong = A0.map((p) => ({ ...p, height: Math.min(99, p.height + 20) })); // 틀린 0~100 스케일
  const killWrong = killPct(runBox(wrong));
  const killBase = killPct(bl);
  const flips = killWrong < killBase; // 정상 boost면 ↑여야 하는데 틀린 스케일은 ↓ (뒤집힘)
  log(`  ① height 틀린스케일(Math.min(99,·)): 킬% ${killBase.toFixed(2)}→${killWrong.toFixed(2)} (182cm→99cm 붕괴)`);
  check(flips, `틀린 스케일이면 height 킬% 방향이 ❌로 뒤집힘 재현 — 필드별 스케일 분리(cm/+8/210)의 근거`);
}

// ② 진짜 boost가 있어야 통과함을 증명: 무boost(baseline vs baseline)면 지표가 완전 동률 → 방향 assert 불성립.
{
  const same = killPct(runBox(A0)); // baseline 재실행 = bl과 바이트 동일(결정론)
  const tie = same === killPct(bl);
  log(`  ② 무boost 재실행 킬% ${same.toFixed(2)} == baseline ${killPct(bl).toFixed(2)} → 동률(방향 성립 X)`);
  check(tie, `무boost면 on==off 동률 → 'on>off' 불성립: 진짜 boost가 있어야만 ✅ (오라클이 우연히 통과 안 함)`);
  check(!(same > killPct(bl)), `동률에서 up-assert는 false — 신호 제거 시 가드가 FAIL함을 증명`);
}

log('');
if (fails.length) { log(`STATS FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
log(`STATS PASS (${specs.length}/${specs.length} 스탯 방향 A/B + height cm-스케일 mutant + 무boost 동률 자가검증)`);
process.exit(0);
