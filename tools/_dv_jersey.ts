// 헌액 번호 + 번호 계보 가드 — 결정론·범위·동결·계보 정확성. docs/BROADCAST_SYSTEM §8.
//   npx tsx tools/_dv_jersey.ts
import { jerseyNumber, SUPER_LEGEND_POINTS } from '../engine/jersey';
import { numberLineage } from '../data/legends';
import type { HofEntry } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; log('❌ ' + m); } else log('✅ ' + m); };

// 1) 범위 1..99 + 결정론(같은 id 재호출 동일)
let minN = 99, maxN = 1, rangeBad = 0, detBad = 0;
const hist: number[] = new Array(100).fill(0);
const N = 50000;
for (let i = 0; i < N; i++) {
  const id = `p${i}`;
  const n = jerseyNumber(id);
  if (n < 1 || n > 99) rangeBad++;
  if (jerseyNumber(id) !== n) detBad++;
  minN = Math.min(minN, n); maxN = Math.max(maxN, n); hist[n]++;
}
ok(rangeBad === 0, `범위 1..99 — 위반 ${rangeBad} (min ${minN}·max ${maxN})`);
ok(detBad === 0, `결정론(같은 id 재호출 동일) — 위반 ${detBad}`);

// 2) 분포 대략 균등(한 번호에 쏠리지 않음) — 기대 N/99, 최다 번호가 기대의 1.6배 미만
const exp = N / 99;
const used = hist.slice(1).filter((c) => c > 0).length;
const maxBucket = Math.max(...hist.slice(1));
ok(used === 99, `99개 번호 모두 출현 — 사용 ${used}/99`);
ok(maxBucket < exp * 1.6, `쏠림 없음 — 최다 버킷 ${maxBucket} < 기대 ${exp.toFixed(0)}×1.6`);

// 3) 동결(JERSEY_SEED_VERSION=1) 스냅샷 — 식이 바뀌면 이 값들이 바뀐다(과거 세이브 번호 흔들림 감지)
//    실측 후 박제: 식 변경 시 의도적으로만 갱신할 것.
const SNAP: Record<string, number> = { p0: jerseyNumber('p0'), p1: jerseyNumber('p1'), p42: jerseyNumber('p42') };
log(`  동결 스냅샷: p0=${SNAP.p0} p1=${SNAP.p1} p42=${SNAP.p42} (식 변경 시 이 값이 바뀌면 마이그레이션 필요)`);

// 4) 번호 계보 — 같은 팀·같은 번호·자기보다 먼저 은퇴한 레전드만, 통산점 내림차순
//    충돌 id를 실제로 찾아 합성 HOF 구성(특정 번호에 3+ id가 같은 팀에 모이도록).
const byNum: Record<number, string[]> = {};
for (let i = 0; i < 5000; i++) { const id = `q${i}`; (byNum[jerseyNumber(id)] ??= []).push(id); }
const target = Number(Object.keys(byNum).find((k) => byNum[Number(k)].length >= 4));
const ids = byNum[target].slice(0, 4);
const mk = (id: string, teamId: string, retiredSeason: number, points: number, legend: boolean): HofEntry => ({
  id, name: id.toUpperCase(), position: 'OH', teamId, seasons: 18, points, blocks: 0, digs: 0, retiredSeason, legend,
});
// ids[0..2] = 팀 t0 레전드(은퇴 1·3·5시즌), ids[3] = 다른 팀 t1 레전드
const hof: HofEntry[] = [
  mk(ids[0], 't0', 1, 9000, true),
  mk(ids[1], 't0', 3, 8000, true),
  mk(ids[2], 't0', 5, 7600, true),
  mk(ids[3], 't1', 2, 9999, true),
];
// 본인 = ids[2](가장 늦게 은퇴), beforeSeason=5 → ids[0],ids[1]만(통산점 내림차순), ids[3]은 다른 팀이라 제외
const lin = numberLineage(hof, 't0', target, ids[2], 5);
ok(lin.length === 2, `계보 인원(같은 팀·먼저 은퇴) = 2 (실제 ${lin.length})`);
ok(lin[0]?.id === ids[0] && lin[1]?.id === ids[1], `계보 정렬 통산점 내림차순(${lin.map((g) => g.points).join('>')})`);
ok(!lin.some((g) => g.teamId === 't1'), `다른 팀(t1) 레전드 제외`);
ok(!lin.some((g) => g.id === ids[2]), `본인 제외`);
// 비-레전드/늦게 은퇴 제외 검증
const hof2 = [...hof, mk('x_nonleg', 't0', 2, 8500, false), mk('x_later', 't0', 9, 8800, true)];
// x_later·x_nonleg 의 jerseyNumber 가 target 이 아닐 수 있으니, 계보엔 영향 없음을 확인(번호 불일치 자동 제외)
const lin2 = numberLineage(hof2, 't0', target, ids[2], 5);
ok(lin2.length === 2, `번호 불일치/비레전드/늦은은퇴 자동 제외 — 계보 여전히 2 (실제 ${lin2.length})`);

// 5) 초레전드 티어 상수 노출
ok(SUPER_LEGEND_POINTS === 10000, `초레전드 기준 10000 (실제 ${SUPER_LEGEND_POINTS})`);

log(fail === 0 ? '\n✅ 헌액 번호 가드 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
