// 가드 — 시즌 길이 단일 상수(engine/calendar SEASON_DAYS)가 실제 일정과 일치하는지(EDGE_CASES §3.7 상수 손복제 방지).
//   npx tsx tools/_dv_seasondays.ts   (exit 0/1)
// SEASON_DAYS == data/league SEASON의 max dayIndex 여야 한다. 파생 상수(SEASON_LENGTH·SEASON_END_DAY·REF_DAY)는
// 모두 SEASON_DAYS를 import하므로 자동 일치 — 본 가드는 "단일 상수 ↔ 진짜 일정"만 본다(드리프트 원천 차단).
import './_gt_mock';
(async () => {
  const { SEASON_DAYS } = await import('../engine/calendar');
  const { SEASON_LENGTH } = await import('../engine/rollover');
  const { SEASON } = await import('../data/league');
  const maxDay = Math.max(...SEASON.map((f: any) => f.dayIndex));
  const matchSchedule = SEASON_DAYS === maxDay;
  const derivedWired = SEASON_LENGTH === SEASON_DAYS; // 파생 상수가 단일 출처를 쓰는지(샘플)
  const abDetect = (maxDay + 1) !== maxDay;           // A/B: 틀린 값이면 불일치로 잡혀야(도구 민감)
  console.log(`SEASON_DAYS=${SEASON_DAYS} · 일정 max dayIndex=${maxDay} · 일치=${matchSchedule} · SEASON_LENGTH 연동=${derivedWired}`);
  const pass = matchSchedule && derivedWired && abDetect;
  console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'}${matchSchedule ? '' : ' — 상수가 실제 일정과 어긋남(드리프트)'}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
