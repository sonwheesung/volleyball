// 은퇴 곡선 analytic 출력 — 채택 상수의 나이×OVR 확률표(문서 기입용). 순수(엔진 함수 직접).
//   RT_DELTA=7 RT_ALO=0.008 RT_AHI=0.065 npx tsx tools/_dv_retire_curve.ts [medOvr=66]
import { retireChance, RETIRE_PARAMS, RETIRE_AGE } from '../engine/retire';
const log = (m: string) => process.stdout.write(m + '\n');
const med = Number(process.argv[2]) || 66;
const P = RETIRE_PARAMS;
const HIGH = med + P.highDelta;
log(`\n채택 상수: δ=${P.highDelta} aLo=${P.aLo} aHi=${P.aHi} late×${P.lateMult} headSig=${P.headroomSig} cap=${P.chanceCap}`);
log(`medOvr=${med} → HIGH=${HIGH} (이 이상 은퇴 0)  ·  정년=${RETIRE_AGE}세(=1)\n`);
const ages = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
const ovrs = [HIGH, HIGH - 1, HIGH - 3, HIGH - 5, HIGH - 8, HIGH - 12, HIGH - 16];
log('OVR\\age ' + ages.map((a) => String(a).padStart(5)).join(''));
for (const o of ovrs) {
  const gap = HIGH - o;
  const row = ages.map((a) => (retireChance(a, o, med) * 100).toFixed(0).padStart(5));
  log(`${String(o).padStart(3)}(gap${String(gap).padStart(2)})` + row.join(''));
}
log(`\n※ 각 셀 = 은퇴 확률(%). 40세 열은 정년 하드월(100). gap 1점당 확률 단조 증가(절벽 없음).`);
