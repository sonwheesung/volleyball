// 감독 명성 산식 가드 (STAFF §9.6-B) — npx tsx tools/_dv_reputation.ts
//   (a) 기대 대비 방향성  (b) 절대 순위 무영향  (c) clamp·결정론  (d) 로그 재계산 멱등  (e) 연봉 base+프리미엄 구조.
//   + A/B 자가검증: 오염된 명성 산식(절대순위 하락·기대 무시)을 주입해 오라클이 그 결함을 검출(FAIL)함을 실증(허위 오라클 금지).
import {
  reputationOf, rowDelta, type CoachCareerRow, LEGEND_RENOWN, reputationTier, reputationPremium, REP_PREMIUM_PER,
} from '../engine/reputation';
import { headCoachSalary } from '../engine/staff';

let fail = 0;
const check = (name: string, cond: boolean) => { process.stdout.write(`${cond ? '✅' : '❌'} ${name}\n`); if (!cond) fail++; };

// 합성 로그 헬퍼(한 감독 한 시즌 행)
const row = (season: number, predictedRank: number, actualRank: number, extra: Partial<CoachCareerRow> = {}): CoachCareerRow =>
  ({ season, coachId: 'C', teamId: 'tX', predictedRank, actualRank, playoff: 'none', champion: false, midSeasonFired: false, ...extra });
const COACH = { id: 'C', renown: 40 }; // 인정받는 감독(중립 기준선)

// ── (a) 기대 대비 방향성 — 예상7→실제4(상승) > 예상대로 > 예상2→실제5(하락) ──
const repRise = reputationOf([row(1, 7, 4)], COACH);   // +3칸 초과달성
const repFlat = reputationOf([row(1, 4, 4)], COACH);   // 예상대로
const repDrop = reputationOf([row(1, 2, 5)], COACH);   // −3칸 미달
process.stdout.write(`\n[a 기대 대비 방향성] 상승 ${repRise} · 유지 ${repFlat} · 하락 ${repDrop} (기준 ${COACH.renown})\n`);
check('a1 초과달성(예상7→실제4) > 예상대로', repRise > repFlat);
check('a2 예상대로 > 미달(예상2→실제5)', repFlat > repDrop);
check('a3 예상대로 ≈ 기준선(delta 0)', repFlat === COACH.renown);
check('a4 초과달성 > 기준선 · 미달 < 기준선', repRise > COACH.renown && repDrop < COACH.renown);

// ── (b) 절대 순위 무영향 — 예상 꼴찌→실제 꼴찌 감독은 하락 없음(리빌딩 불이익 금지) ──
const repBottom = reputationOf([row(1, 7, 7)], COACH);       // 예상 꼴찌 그대로 꼴찌
const repBottomMulti = reputationOf([row(1, 7, 7), row(2, 7, 7), row(3, 7, 7)], COACH); // 3시즌 연속 예상대로 꼴찌
process.stdout.write(`\n[b 절대 순위 무영향] 꼴찌예상→꼴찌 ${repBottom} · 3연속 ${repBottomMulti} (기준 ${COACH.renown})\n`);
check('b1 예상 꼴찌→실제 꼴찌 하락 없음(=기준선)', repBottom === COACH.renown);
check('b2 예상대로 꼴찌 3연속도 하락 없음', repBottomMulti === COACH.renown);

// ── (c) clamp·결정론 ──
const extremeUp = reputationOf(Array.from({ length: 30 }, (_, i) => row(i, 7, 1, { champion: true })), COACH);
const extremeDown = reputationOf(Array.from({ length: 30 }, (_, i) => row(i, 1, 7, { midSeasonFired: true })), COACH);
check('c1 극단 상승 clamp ≤ 100', extremeUp <= 100 && extremeUp >= 0);
check('c2 극단 하락 clamp ≥ 0', extremeDown >= 0 && extremeDown <= 100);
const logRnd = Array.from({ length: 12 }, (_, i) => row(i, 3 + (i % 5), 1 + (i % 6), { champion: i % 4 === 0 }));
check('c3 결정론(같은 로그 두 번 = 동일)', reputationOf(logRnd, COACH) === reputationOf(logRnd, COACH));

// ── (d) 로그 재계산 멱등 — 로그 복제/재fold 동일(누적 변수 저장 없음 확인) ──
check('d1 로그 사본 재계산 동일', reputationOf([...logRnd], COACH) === reputationOf(logRnd, COACH));
check('d2 무관 감독 행 무영향(coachId 필터)', reputationOf([...logRnd, row(1, 1, 7, { coachId: 'OTHER', midSeasonFired: true } as Partial<CoachCareerRow>)], COACH) === reputationOf(logRnd, COACH));
check('d3 빈 로그 = renown 기준선', reputationOf([], COACH) === COACH.renown);
check('d4 renown 흡수(레전드 출신 높게 시작)', reputationOf([], { id: 'C', renown: LEGEND_RENOWN }) === LEGEND_RENOWN);

// ── (e) 연봉 base + 프리미엄 구조(대체 금지 §9.4) ──
const base80 = headCoachSalary(80, 0);
const prem80_100 = headCoachSalary(80, 100);
check('e1 명성 0 = base만(프리미엄 0)', headCoachSalary(80, 0) === base80 && reputationPremium(0) === 0);
check('e2 base + 프리미엄 = 총연봉', prem80_100 === base80 + reputationPremium(100));
check('e3 프리미엄 캡(rep100 = +4.0k)', reputationPremium(100) === Math.round(REP_PREMIUM_PER * 100) * 100 && reputationPremium(100) === 4000);
check('e4 프리미엄 단조(명성↑ → 연봉↑)', headCoachSalary(80, 100) > headCoachSalary(80, 50) && headCoachSalary(80, 50) > headCoachSalary(80, 0));
check('e5 base는 OVR 단조(명성 고정)', headCoachSalary(95, 30) > headCoachSalary(45, 30));

// ── 티어 경계 sanity ──
check('t1 티어 경계(0 무명·20 주목·40 인정·60 명장·80 거장)',
  reputationTier(0).label === '무명' && reputationTier(20).label === '주목' && reputationTier(40).label === '인정받는 감독'
  && reputationTier(60).label === '명장' && reputationTier(80).label === '거장');

// ════════════════════════════════════════════════════════════════════
// A/B 자가검증 — 오염된 산식을 주입해 위 오라클(a·b)이 결함을 검출(FAIL)함을 실증.
//   프로덕션 코드엔 시임 없음 — 여기 로컬 mutant로만.
process.stdout.write('\n[A/B 민감도 — 오염 산식이 오라클에 걸리는가]\n');
const clamp = (n: number) => (n < 0 ? 0 : n > 100 ? 100 : n);
// 변이1: 절대 순위 하락(꼴찌면 깎음 — 리빌딩 불이익). (b)가 잡아야 함.
const badAbsRank = (log: CoachCareerRow[], c: { id: string; renown?: number }) => {
  let rep = c.renown ?? 40;
  for (const r of log.filter((x) => x.coachId === c.id)) { rep += rowDelta(r); if (r.actualRank >= 6) rep -= 15; }
  return Math.round(clamp(rep));
};
// 변이2: 기대 무시(절대 순위 좋을수록만 가산 — 기대 대비 무시). (a)가 잡아야 함(예상2→실제5가 예상7→실제4보다 높아짐).
const badIgnoreExp = (log: CoachCareerRow[], c: { id: string; renown?: number }) => {
  let rep = c.renown ?? 40;
  for (const r of log.filter((x) => x.coachId === c.id)) rep += (8 - r.actualRank) * 3; // 실제 순위만
  return Math.round(clamp(rep));
};
// (b) 오라클: 예상 꼴찌→실제 꼴찌 감독은 기준선 유지. 진짜=유지, 변이1(절대순위 하락)=깎임 → 검출.
const bOracle = (fn: typeof reputationOf) => fn([row(1, 7, 7)], COACH) === COACH.renown;
check('AB0 b-오라클: 진짜 산식은 통과(기준선 유지)', bOracle(reputationOf));
check('AB1 변이1(절대순위 하락)을 b-오라클이 검출', !bOracle(badAbsRank)); // 변이는 꼴찌라 깎임 → 오라클 위반 감지
// (a) 오라클: 기대 대비 초과달성 > 미달. 절대순위와 기대가 어긋나는 케이스로 변별
//   초과달성(예상7→실제4, 절대 중위) vs 미달(예상1→실제3, 절대 상위) — 기대는 전자 우위, 절대순위는 후자 우위.
const overLog = [row(1, 7, 4)];  // +3칸(초과달성)
const underLog = [row(1, 1, 3)]; // −2칸(미달)이지만 실제 순위는 더 높음
const aOracle = (fn: typeof reputationOf) => fn(overLog, COACH) > fn(underLog, COACH);
check('AB2a a-오라클: 진짜 산식은 통과(초과달성 > 미달)', aOracle(reputationOf));
check('AB2b 변이2(기대 무시=절대순위만)를 a-오라클이 검출', !aOracle(badIgnoreExp)); // 변이는 실제3위>4위라 역전 → 검출

process.stdout.write(fail === 0 ? '\n✅ 명성 산식 전건 PASS + A/B 민감도 2/2 검출\n' : `\n❌ ${fail}건 실패\n`);
process.exit(fail === 0 ? 0 : 1);
