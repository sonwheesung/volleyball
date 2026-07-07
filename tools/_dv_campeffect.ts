// INDEPENDENT — 코스형 전지훈련 순효과 가드 (MONETIZATION §11.2 H4 · 2026-07-02, 2026-07-08 재보정).
// "기능 순효과(effect A/B)" 렌즈: 배선+결정론+문서화 ≠ 효과 있음(경기경험·감독선호·구 전지훈련이 그렇게 죽었음).
// 영건에 코스 적용(with) vs 미적용(without)을 같은 시드로 N시즌 성장시켜 ΔOVR을 실측한다.
//
// 재보정 배경(2026-07-08 사용자 결정): 포텐 +7 → 대칭 +3/+3. 실현 폭이 축소됐다(구 +7: avg +1.76 → 신 +3: avg ≈ +1.0,
//   n≥100). 유료 체감 하한은 유지하되 "죽은 기능 재발(≈+0.06)"만 잡도록 밴드를 실측 현실 주변으로 내렸다.
//   통과: 평균 Δ ≥ 0.7 OVR(실측 avg≈1.0 아래 마진 — 소표본 변동 흡수 · 죽은기능 0.06과는 크게 이격) ·
//   전 케이스 Δ ≥ 0(캠프가 해가 되지 않음) · 결정론(같은 입력 2회 동일) · null-대조(무적용 arm 스스로 Δ0) ·
//   소급 보존(구 엔트리 = cur/pot 없음 → 레거시 +2/+7 재현, 신 = +3/+3, 둘이 실제로 다름 = 게인 인자 관통 A/B).
//   npx tsx tools/_dv_campeffect.ts [시즌=5] [표본=60]
import { makeProspect } from '../data/seed';
import { createRng, strSeed } from '../engine/rng';
import { rolloverPlayer } from '../engine/rollover';
import { MED_REF, overall } from '../engine/overall';
import { applyCampCourse, CAMP_COURSES, CAMP_CUR_GAIN, CAMP_POT_GAIN, CAMP_LEGACY_CUR_GAIN, CAMP_LEGACY_POT_GAIN, type CampCourse } from '../engine/diamonds';
import type { Player, Position, TrainingFocus } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const SEASONS = Math.max(1, Number(process.argv[2]) || 5);
const N = Math.max(5, Number(process.argv[3]) || 60);
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

// 소급 보존(H3) — 구 코스 엔트리(campLog에 cur/pot 없음)는 재적용 시 레거시 +2/+7로 재현돼야 결정론이 깨지지 않는다.
// 스토어 재적용 경로가 `applyCampCourse(p, course, e.cur ?? LEGACY_CUR, e.pot ?? LEGACY_POT)`이므로 여기서
// 같은 산식을 엔진 레이어로 직접 재현: 레거시 인자 = +2/+7, 기본 인자 = 신 +3/+3. 둘이 실제로 달라야 게인 인자가 관통(A/B).
let retroOk = true;
let mutantOk = true;
{
  const rp = makeProspect(createRng(strSeed('ce-retro')), 'ce-retro', 'OP');
  const course: CampCourse = 'attack';
  const stats = CAMP_COURSES[course].stats;
  const base = stats.map((s) => ({ cur: (rp as unknown as Record<string, number>)[s], pot: rp.potential[s] ?? 0 }));
  const legacy = applyCampCourse(rp, course, CAMP_LEGACY_CUR_GAIN, CAMP_LEGACY_POT_GAIN); // 구 엔트리(cur/pot 없음)의 폴백
  const fresh = applyCampCourse(rp, course);                                              // 신 엔트리(기본 = 상수 3/3)
  const lc = legacy as unknown as Record<string, number>;
  const fc = fresh as unknown as Record<string, number>;
  retroOk = stats.every((s, i) =>
    lc[s] === Math.min(99, base[i].cur + 2) && legacy.potential[s] === Math.min(99, base[i].pot + 7));
  // A/B 뮤턴트 감도: 게인 인자가 무시되면(applyCampCourse가 상수만 쓰면) legacy===fresh가 되어 이 대조가 죽는다.
  // 최소 한 스탯이라도 cur 또는 pot이 달라야 인자가 실제로 관통함을 증명(캡 안 걸린 칸 기준).
  mutantOk = stats.some((s) => lc[s] !== fc[s] || legacy.potential[s] !== fresh.potential[s]);
}

log(`=== 코스형 전지훈련 순효과 (${SEASONS}시즌 성장 · n=${N}, 포지션 정합 코스) ===`);
log(`ΔOVR(with−without): 평균 ${avg.toFixed(2)} · 분포 ${Math.min(...deltas)}~${Math.max(...deltas)} · 음수 ${negatives}건  [신 +${CAMP_CUR_GAIN}/+${CAMP_POT_GAIN}]`);
log(`결정론: ${det ? '✅' : '❌'} · null-대조 Δ ${nullDelta} (0이어야 — 하네스 결정성)`);
log(`소급 보존: 구 엔트리(cur/pot 없음) → 레거시 +2/+7 재현 ${retroOk ? '✅' : '❌'} · 게인 인자 관통(A/B, legacy≠fresh) ${mutantOk ? '✅' : '❌'}`);

const FLOOR = 0.7; // 실측 avg≈1.0(n≥100) 아래 마진(소표본 변동 흡수) · 죽은기능 0.06과는 크게 이격
const pass = avg >= FLOOR && negatives === 0 && det && nullDelta === 0 && retroOk && mutantOk;
log(`\nCAMPEFFECT ${pass ? 'PASS' : 'FAIL'} (평균 Δ ${avg.toFixed(2)} ≥ ${FLOOR} · 음수 0 · 결정론 · null 0 · 소급 +2/+7 · A/B)`);
process.exit(pass ? 0 : 1);
