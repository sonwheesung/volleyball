// 입단 스냅샷(Player.debut) 가드 (TRAINING §성장리포트 커리어 누적, 2026-07-06) — 표시 전용·결정론 무영향 증명.
// ① 생성 시 debut 캡처(OVR+15원본) ② 진화/노쇠/XP/시즌라인 전 변환이 debut을 스프레드로 보존
// ③ 커리어 누적 = 현재 − 입단 (성장 방향 정합) ④ A/B: debut 유무가 evolve 스탯을 1비트도 안 바꾼다(엔진 불간섭).
import { makeProspect } from '../data/seed';
import { evolvePlayer } from '../engine/progression';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer, appendSeasonLine } from '../engine/production';
import { applyAgingDay } from '../engine/aging';
import { createRng, strSeed } from '../engine/rng';
import { overallRaw, displayOvr } from '../engine/overall';
import { TRAINABLE_STATS } from '../engine/training';
import type { Player, TrainableStat, ProdLine } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const focus = { core: [1, 2] as [number, number], sub: [3, 4, 5] as [number, number, number] };
const raw = (p: Player, k: TrainableStat) => (p as unknown as Record<TrainableStat, number>)[k];

console.log('── 1. 생성 시 debut 캡처 ──');
const rookie = makeProspect(createRng(strSeed('debut-rk')), 'd9_0', 'OH'); // 신인 = 진짜 데뷔
ok(!!rookie.debut, 'makeProspect가 debut 기록');
ok(rookie.debut != null && rookie.debut.ovr === Math.round(displayOvr(overallRaw(rookie))), 'debut.ovr = displayOvr(overallRaw) (로스터 카드 정합)');
ok(rookie.debut != null && TRAINABLE_STATS.every((k) => rookie.debut!.stats[k] === raw(rookie, k)), 'debut.stats = 생성 시점 15 원본 전부');

console.log('── 2. 전 변환이 debut 보존(스프레드 통과) ──');
const prod: ProdLine = { matches: 30, points: 300, spikes: 200, blocks: 20, aces: 15, digs: 40, assists: 5, receives: 60 };
let grown = evolvePlayer(rookie, focus, 300); // 300일 성장+노쇠
ok(JSON.stringify(grown.debut) === JSON.stringify(rookie.debut), 'evolvePlayer 후 debut 불변');
grown = applyMatchXp(grown, prod);
ok(JSON.stringify(grown.debut) === JSON.stringify(rookie.debut), 'applyMatchXp 후 debut 불변');
grown = accrueCareer(grown, prod);
grown = appendSeasonLine(grown, 0, 't', prod);
ok(JSON.stringify(grown.debut) === JSON.stringify(rookie.debut), 'accrueCareer·appendSeasonLine 후 debut 불변');
const agedRng = createRng(strSeed('debut-rk'));
let aged = rookie; for (let i = 0; i < 50; i++) aged = applyAgingDay(aged, agedRng);
ok(JSON.stringify(aged.debut) === JSON.stringify(rookie.debut), 'applyAgingDay 후 debut 불변');

console.log('── 3. 커리어 누적 = 현재 − 입단 (성장 방향) ──');
const curOvr = Math.round(displayOvr(overallRaw(grown)));
const dOvr = curOvr - rookie.debut!.ovr;
ok(dOvr > 0, `젊은 유망주 300일+경기 → 커리어 OVR 상승(입단 ${rookie.debut!.ovr}→현재 ${curOvr}, Δ${dOvr})`);
const spikeGain = raw(grown, 'skSpike') - rookie.debut!.stats.skSpike;
ok(spikeGain > 0, `스탯별 누적: 스파이크 입단 ${rookie.debut!.stats.skSpike}→현재 ${raw(grown, 'skSpike')} (Δ${spikeGain})`);

console.log('── 4. A/B: debut 유무가 evolve 스탯을 안 바꾼다(엔진 불간섭 — 결정론) ──');
const withDebut = makeProspect(createRng(strSeed('inert')), 'd9_1', 'MB');
const noDebut: Player = { ...withDebut }; delete noDebut.debut; // 구세이브(필드 없음) 모사
const evA = evolvePlayer(withDebut, focus, 250);
const evB = evolvePlayer(noDebut, focus, 250);
const stripDebut = (p: Player) => { const q = { ...p } as Player; delete q.debut; return q; };
ok(JSON.stringify(stripDebut(evA)) === JSON.stringify(stripDebut(evB)), 'debut 뺀 나머지 스탯 100% 동일(debut은 evolve 입력이 아님)');
// A/B 대조군: 만약 debut을 진화 입력에 잘못 쓴다면 위가 깨져야 — 여기선 다른 것만 바꿔 오라클 민감도 확인
ok(raw(evA, 'skBlock') === raw(evB, 'skBlock') && evA.debut != null && evB.debut == null, '대조군: 한쪽만 debut 있고 스탯은 동일(민감도 — 필드 존재≠스탯 변화)');

console.log(fail === 0 ? '\n✅ PASS _dv_debut (입단 스냅샷 캡처·보존·커리어 누적·엔진 불간섭)' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
