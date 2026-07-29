// 체력 곡선 가드(2026-06-28 · 2026-07-07 지표 재정의) — 경기 중 체력이 실제로 빠지고 세트가 쌓일수록
// 누적되는지 검증. 옛 버그(회복≈소모로 전 세트 평균 ~95% 평탄 → 체력 무의미)를 회귀로 막는다.
//
// 지표 재정의(2026-07-07, 피로 교체 1.3e 도입에 맞춰): 원래는 **타임아웃 시점 코트 평균 체력**을 봤는데,
// 피로 교체가 코트 구성을 흔들어 생리 곡선과 교체 구성이 뒤섞였다(도구가 움직이는 표적). → **각 팀 선발 6 +
// 리베로(스냅샷 시점에 코트에 있든 없든)** 의 체력으로 재정의 = 교체 구성과 분리한 순수 생리 지표.
// `TimeoutEvent`(보드 계약)는 안 건드리고, `simulateMatch` opts의 **계측 전용 훅 `stamProbe`**(rng-중립·결과
// 불변)로 매 타임아웃/TTO에서 선발 체력을 관측한다. court-only(옛 지표)도 비교용으로 함께 출력.
//
// PASS(2026-07-29 피로 극화 재밴드): ① 세트1→세트5 가파른 하락(≥30%p) ② 세트5 선발-지표 평균이 밴드(33~47%,
//       주공격수 ~30%대) ③ 경기당 피로 교체율(1.3e)이 [1.5, 4.5] — 피로 메타의 정상 발동 범위(사멸/폭주 차단).
//       구 밴드(≥8%p·60~82%·[0.05,0.5])는 완만 구곡선용. 정본 MATCH_SYSTEM §7.1.
import { LEAGUE, getEvolvedTeamPlayers } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import type { Side } from '../types';

const N = Number(process.argv[2] || 3000);
const home = getEvolvedTeamPlayers(LEAGUE.teams[0].id, 0);
const away = getEvolvedTeamPlayers(LEAGUE.teams[1].id, 0);

// 선발6+리베로 id(경기 내내 고정 — 팀이 매 경기 동일) — 생리 지표는 이 선수들 체력만 본다(코트 이탈 무관).
const startersOf = (players: typeof home): string[] => {
  const lu = buildLineup(players);
  return [...lu.six, ...(lu.libero ? [lu.libero] : [])].map((p) => p.id);
};
const starters: Record<Side, string[]> = { home: startersOf(home), away: startersOf(away) };

// 선발-지표(재정의): 스냅샷 시점 선발6+리베로 체력 평균(코트에 있든 없든)
const bySetStarters: Record<number, { sum: number; cnt: number }> = {};
// court-only(옛 지표): 타임아웃 스냅샷의 코트 평균 — 비교용
const bySetCourt: Record<number, { sum: number; cnt: number }> = {};

let restSubs = 0; // 피로 교체(kind:'rest') 총 투입(enter) 건수

for (let i = 0; i < N; i++) {
  const sim = simulateMatch(1000 + i, home, away, {
    // 계측 훅 — 매 타임아웃/TTO에서 선발 체력을 세트별 누적(rng 미소비·결과 불변)
    stamProbe: (setNo, stam) => {
      const vals = [
        ...starters.home.map((id) => stam.home.get(id) ?? 1),
        ...starters.away.map((id) => stam.away.get(id) ?? 1),
      ];
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const a = (bySetStarters[setNo] ??= { sum: 0, cnt: 0 });
      a.sum += avg; a.cnt++;
    },
  });
  // court-only(비교) — 기존 TimeoutEvent 스냅샷
  for (const t of sim.timeouts ?? []) {
    const vals = [...t.stamHome.map((s) => s.stam), ...t.stamAway.map((s) => s.stam)];
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const a = (bySetCourt[t.setNo] ??= { sum: 0, cnt: 0 });
    a.sum += avg; a.cnt++;
  }
  // 피로 교체율
  for (const e of sim.subEvents ?? []) if (e.kind === 'rest' && e.enter) restSubs++;
}

const avgOf = (m: Record<number, { sum: number; cnt: number }>, set: number) =>
  (m[set] && m[set].cnt ? (m[set].sum / m[set].cnt) * 100 : NaN);

console.log(`체력 곡선 (N=${N}):`);
console.log(`  세트   선발6+리베로(생리 지표, 재정의)   코트평균(옛 지표, 비교)`);
for (const s of [1, 2, 3, 4, 5]) {
  const st = avgOf(bySetStarters, s), co = avgOf(bySetCourt, s);
  console.log(`   ${s}세트        ${st.toFixed(1)}%                    ${co.toFixed(1)}%`);
}

const s1 = avgOf(bySetStarters, 1), s5 = avgOf(bySetStarters, 5);
const drop = s1 - s5;
const restRate = restSubs / N;
// 밴드 재정의(2026-07-29 피로 곡선 극화 — 사용자 "5세트 30%대까지 될만하게"). 구 밴드(set5 60~82·교체율 0.05~0.5)는
//   완만한 구곡선용. 극화 재튜닝(REGEN 0.005→0.0015·SET_REST 0.035→0.012·HOP 0.024→0.026·REST_THRESHOLD 0.35→0.15)으로
//   실측(N=10000): set5 선발 39.7%·교체율 2.85/경기·KOVO 분포 전부 ✓(simKovo). 밴드를 실측 주변으로 재설정.
const visible = drop >= 30;           // 극화 후 하락폭 ~47%p — 완만-회귀(구 8%p) 넘어 "가파른 피로"를 강제
const inBand = s5 >= 33 && s5 <= 47;  // 세트5 선발 평균 ~40%(주공격수 ~30%대·세터/리베로 상위) — 과소(밋밋)/과다(붕괴) 차단
const restOk = restRate >= 1.5 && restRate <= 4.5; // 피로 메타에선 감독이 후반 지친 주전을 더 자주 쉼(구 0.5 상한은 완만곡선용) — 사멸/폭주만 차단

console.log(`\n세트1→세트5 하락 ${drop.toFixed(1)}%p (≥30 필요) → ${visible ? 'PASS' : 'FAIL'}`);
console.log(`세트5 선발-지표 평균 ${s5.toFixed(1)}% (33~47 밴드) → ${inBand ? 'PASS' : 'FAIL'}`);
console.log(`피로 교체율 ${restRate.toFixed(3)}/경기 (총 ${restSubs}건, 밴드 1.5~4.5) → ${restOk ? 'PASS' : 'FAIL'}`);

const ok = visible && inBand && restOk;
console.log(ok ? '\nPASS — 체력 곡선 정상(생리 지표) + 피로 교체 정상 발동' : '\nFAIL — 체력 곡선/피로 교체 점검(TTO_REST·REST_* 튜닝)');
process.exit(ok ? 0 : 1);
