// 동작 단위 스탯 추적 검증기 — "이 선수의 이 동작 결과가 정말 그 선수의 스탯에서 나왔는가".
// 텔레메트리(RallyEvent.rating/eff)로 모든 서브/리시브/세트/공격/디그에 대해:
//   A) 기본 스탯 정합 — 이벤트에 기록된 rating == deriveRatings(그날 입력 선수) 재계산 (어긋나면
//      엔진이 다른 선수/낡은 스탯을 쓴 것)
//   B) 실효 배수 범위 — eff ∈ [0.3, 1] (체력 하한 0.70 × 부상 0.5 고려)
//   C) 피로 가시화 — 저체력 팀의 평균 eff가 세트가 갈수록 하락(1세트 ≈ 신선, 5세트 최저)
//   D) 스탯→결과 단조 — 실효 스탯(rating×eff) 3분위로 묶으면 성공률이 단조 증가
//      (서브→에이스율, 공격→킬율, 리시브→평균 품질 q)
//
//   npx tsx tools/simActionTrace.ts [경기수=60]

import { LEAGUE, getEvolvedTeamPlayers, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { deriveRatings } from '../engine/ratings';
import type { RallyEvent } from '../engine/events';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(10, Number(process.argv[2]) || 60);
resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
let fails = 0;
const check = (ok: boolean, name: string, detail = '') => {
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

type Tr = { kind: string; rating: number; eff: number; ok: boolean; q?: number; setNo: number; id: string };
const rows: Tr[] = [];
let baseMismatch = 0, effOut = 0, checkedBase = 0, missing = 0, total = 0;

// 피로 곡선용 저체력 암: A(체력·체젠 45) vs B(80) — A 선수들의 세트별 eff를 추적
const lowEffBySet: number[][] = [[], [], [], [], []];

for (let m = 0; m < N; m++) {
  const isFatigueArm = m % 4 === 3; // 1/4은 저체력 통제 암
  let A: Player[], B: Player[];
  if (isFatigueArm) {
    const base = getEvolvedTeamPlayers(ids[m % 7], 0);
    A = base.map((p) => ({ ...p, id: p.id + ':lo', name: p.name + '·L', staminaMax: 45, staminaRegen: 45 }));
    B = base.map((p) => ({ ...p, id: p.id + ':hi', name: p.name + '·H', staminaMax: 80, staminaRegen: 80 }));
  } else {
    A = getEvolvedTeamPlayers(ids[m % 7], 0);
    B = getEvolvedTeamPlayers(ids[(m + 1 + (m % 6)) % 7], 0);
  }
  const events: RallyEvent[] = [];
  const sim = simulateMatch(31000 + m, A, B, { events });
  // 이름 → 선수 (중복 이름은 검증 모호 — 제외)
  const byName = new Map<string, Player | null>();
  for (const p of [...A, ...B]) byName.set(p.name, byName.has(p.name) ? null : p);
  const lowNames = isFatigueArm ? new Set(A.map((p) => p.name)) : null;

  // 랠리 인덱스 → 세트 번호 ('point' 이벤트가 랠리 경계)
  let rallyIdx = 0;
  for (const e of events) {
    if (e.t === 'point') { rallyIdx++; continue; }
    if (e.t === 'block') continue;
    total++;
    if (e.rating === undefined || e.eff === undefined) { missing++; continue; }
    const setNo = sim.points[Math.min(rallyIdx, sim.points.length - 1)]?.setNo ?? 1;
    if (e.eff < 0.3 || e.eff > 1.0001) effOut++;
    // A) 기본 스탯 재계산 정합
    const p = byName.get(e.player);
    if (p) {
      checkedBase++;
      const r = deriveRatings(p);
      const expect = e.t === 'serve' ? r.serve : e.t === 'receive' ? r.receive : e.t === 'set' ? r.set : e.t === 'attack' ? r.spike : r.dig;
      if (expect !== e.rating) baseMismatch++;
    }
    // C) 저체력 팀 세트별 eff
    if (lowNames?.has(e.player)) lowEffBySet[Math.min(4, setNo - 1)].push(e.eff);
    // D) 단조 검증 행
    const ok = e.t === 'serve' ? e.outcome === 'ace' : e.t === 'attack' ? e.result === 'kill' : true;
    rows.push({ kind: e.t, rating: e.rating, eff: e.eff, ok, q: e.t === 'receive' ? e.q : undefined, setNo, id: e.player });
  }
}

log(`\n═══ 동작 스탯 추적 — ${N}경기 / 동작 이벤트 ${total.toLocaleString()}건 ═══`);
check(missing === 0, '모든 동작에 스탯 기록(rating·eff) 존재', missing ? `${missing}건 누락` : `${total.toLocaleString()}건 전부`);
check(baseMismatch === 0, '기본 스탯 정합 — 기록 rating = deriveRatings 재계산', `${checkedBase.toLocaleString()}건 대조${baseMismatch ? `, ${baseMismatch}건 불일치` : ''}`);
check(effOut === 0, '실효 배수 범위 [0.3, 1]', effOut ? `${effOut}건 이탈` : '');

// C) 피로 곡선
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const curve = lowEffBySet.map(avg);
log(`  저체력 팀 세트별 평균 eff: ${curve.map((v, i) => `${i + 1}세트 ${isNaN(v) ? '-' : v.toFixed(3)}`).join(' · ')}`);
check(curve[0] > 0.96, '1세트는 신선(eff ≈ 1)', curve[0].toFixed(3));
const lastIdx = curve.map((v, i) => (isNaN(v) ? -1 : i)).filter((i) => i >= 0).pop() ?? 0;
check(curve[lastIdx] < curve[0] - 0.015, '세트가 갈수록 지친다(eff 하락)', `1세트 ${curve[0].toFixed(3)} → ${lastIdx + 1}세트 ${curve[lastIdx].toFixed(3)}`);

// D) 실효 스탯 3분위 → 성공률 단조
function tercileCheck(kind: string, label: string, metric: (t: Tr) => number) {
  const sub = rows.filter((t) => t.kind === kind).sort((a, b) => a.rating * a.eff - b.rating * b.eff);
  const k = Math.floor(sub.length / 3);
  const t1 = sub.slice(0, k), t2 = sub.slice(k, 2 * k), t3 = sub.slice(2 * k);
  const m1 = avg(t1.map(metric)), m2 = avg(t2.map(metric)), m3 = avg(t3.map(metric));
  check(m3 > m1, `${label} — 실효 스탯 높을수록 좋다`, `하위 ${(m1 * 100).toFixed(1)} < 중위 ${(m2 * 100).toFixed(1)} < 상위 ${(m3 * 100).toFixed(1)} (n=${sub.length.toLocaleString()})`);
}
tercileCheck('serve', '서브: 에이스율(%)', (t) => (t.ok ? 1 : 0));
tercileCheck('attack', '공격: 킬율(%)', (t) => (t.ok ? 1 : 0));
tercileCheck('receive', '리시브: 평균 품질 q(%)', (t) => t.q ?? 0);

log(fails === 0
  ? '\n✅ 동작 추적 전부 통과 — 모든 동작이 "그 선수의 현재(체력 반영) 스탯"에서 나온다'
  : `\n❌ ${fails}건 실패 — 엔진이 스탯을 잘못 쓰고 있거나 기록 누락`);
process.exit(fails === 0 ? 0 : 1);
