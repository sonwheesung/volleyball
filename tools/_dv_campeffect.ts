// INDEPENDENT — 코스형 전지훈련 순효과 가드 (MONETIZATION §11.2 H4, 2026-07-02).
// "기능 순효과(effect A/B)" 렌즈: 배선+결정론+문서화 ≠ 효과 있음(경기경험·감독선호·구 전지훈련이 그렇게 죽었음).
// 영건에 코스 적용(with) vs 미적용(without)을 같은 시드로 N시즌 성장시켜 ΔOVR을 실측한다.
//   통과: 평균 Δ ≥ +1.0 OVR(유료 체감 하한 — 구 모델은 +0.06/부위였음) · 전 케이스 Δ ≥ 0(캠프가 해가 되지 않음)
//   · 결정론(같은 입력 2회 동일) · null-대조(무적용 arm 스스로 Δ0 = 오라클이 차이만 잡음).
//   npx tsx tools/_dv_campeffect.ts [시즌=5] [표본=25]
import { makeProspect } from '../data/seed';
import { createRng, strSeed } from '../engine/rng';
import { rolloverPlayer } from '../engine/rollover';
import { MED_REF, overall } from '../engine/overall';
import { applyCampCourse, CAMP_COURSES, type CampCourse } from '../engine/diamonds';
import type { Player, Position, TrainingFocus } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const SEASONS = Math.max(1, Number(process.argv[2]) || 5);
const N = Math.max(5, Number(process.argv[3]) || 25);
const FOCUS: TrainingFocus = { primary: [4, 1], secondary: [6, 7, 8] }; // 밸런스형 감독(공격+웨이트)

// 포지션에 맞는 코스(§11.2 forPos 첫 매칭) — 실사용 시나리오(미스매치는 경고만이라 여기선 정합 코스로 측정)
const courseFor = (pos: Position): CampCourse =>
  (Object.keys(CAMP_COURSES) as CampCourse[]).find((k) => CAMP_COURSES[k].forPos.includes(pos)) ?? 'serve';

const growSeasons = (p0: Player, seasons: number): Player => {
  let p = p0;
  for (let s = 0; s < seasons; s++) p = rolloverPlayer(p, FOCUS, MED_REF);
  return p;
};

const POS: Position[] = ['OH', 'OP', 'MB', 'S', 'L'];
const deltas: number[] = [];
let negatives = 0;
for (let i = 0; i < N; i++) {
  const pos = POS[i % POS.length];
  const p0 = makeProspect(createRng(strSeed(`ce-${i}`)), `ce-${i}`, pos);
  const course = courseFor(pos);
  const withCamp = growSeasons(applyCampCourse(p0, course), SEASONS);
  const without = growSeasons(p0, SEASONS);
  const d = overall(withCamp) - overall(without);
  deltas.push(d);
  if (d < 0) negatives++;
}
const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;

// 결정론 — 같은 입력 2회 동일
const pd = makeProspect(createRng(strSeed('ce-det')), 'ce-det', 'OH');
const d1 = overall(growSeasons(applyCampCourse(pd, 'attack'), SEASONS));
const d2 = overall(growSeasons(applyCampCourse(pd, 'attack'), SEASONS));
const det = d1 === d2;

// null-대조(오라클 민감도) — 캠프 대신 아무것도 안 한 arm끼리 비교하면 Δ는 정확히 0이어야
// (0이 아니면 성장 하네스 자체가 비결정 → Δ 측정을 신뢰할 수 없음 = 허위 오라클)
const nc = makeProspect(createRng(strSeed('ce-null')), 'ce-null', 'MB');
const nullDelta = overall(growSeasons(nc, SEASONS)) - overall(growSeasons(nc, SEASONS));

log(`=== 코스형 전지훈련 순효과 (${SEASONS}시즌 성장 · n=${N}, 포지션 정합 코스) ===`);
log(`ΔOVR(with−without): 평균 ${avg.toFixed(2)} · 분포 ${Math.min(...deltas)}~${Math.max(...deltas)} · 음수 ${negatives}건`);
log(`결정론: ${det ? '✅' : '❌'} · null-대조 Δ ${nullDelta} (0이어야 — 하네스 결정성)`);

const pass = avg >= 1.0 && negatives === 0 && det && nullDelta === 0;
log(`\nCAMPEFFECT ${pass ? 'PASS' : 'FAIL'} (평균 Δ ${avg.toFixed(2)} ≥ 1.0 · 음수 0 · 결정론 · null 0)`);
process.exit(pass ? 0 : 1);
