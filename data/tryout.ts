// 외국인 트라이아웃 (FOREIGN_SYSTEM) — 매 오프시즌 풀 생성 + 지명 실행. data 계층(엔진 합성).
// 외인 성능 보장: 국내 평균 "그 이상"(설계 결정 2026-06-11) — 풀 바닥이 국내 평균을 깔고 시작한다.

import type { Player, Position } from '../types';
import { createRng, strSeed } from '../engine/rng';
import { overall } from '../engine/overall';
import type { ProdLine } from '../engine/production';
import { FOREIGN_SALARY, ASIAN_SALARY_Y1, ASIAN_SALARY_Y2, ALT_POOL_SIZE, FRESH_POOL_SIZE, tryoutOrder, resolveTryout, type TryoutPicks } from '../engine/foreign';
import { offerScore, acceptProb, SIT_OUT, prefWeightsOf } from '../engine/faMarket';
import { aiRetainProb, medianOvr, positionGap } from '../engine/aiGM';
import { makePlayer, applyAsianIdentity, dedupeNames } from './seed';

// ─── 수입선수 재계약 활약도 계수 (FOREIGN_SYSTEM §7.1 재계약, #77 2026-07-09) ───
// aiRetainProb(OVR·나이 연속 확률, 국내 FA·아시아쿼터 공용)에 **직전 시즌 실제 생산** 기반 곱수를 얹는다.
// 이진 게이트(aiKeepsForeign)의 절벽·활약도 무시·OVR 무의미를 근본 해소 — "OVR이 높아도 못했으면 덜 남기고,
// 맹활약했으면 노장도 붙든다". 엔진 순수성: aiRetainProb은 불변(국내 FA 무영향), perfMult 곱은 이 호출부(data)에서만.
export interface PerfCtx {
  prodOf: (id: string) => ProdLine | undefined; // 직전 시즌 선수별 생산(leagueProduction)
  awardOf: (id: string) => number;              // 통산 수상 점수 0~1(awardScoreOf)
}
// 계수는 placeholder(튜닝 대상) — simForeign A/B 잔류율로 조정. 생산만 [FLOOR, PROD_CEIL], 수상 가산 후 [FLOOR, CEIL].
const PERF_FLOOR = 0.6;      // 부진(저생산) 최저 배수
const PERF_CEIL = 1.30;      // 최종 천장(수상 헤드룸 포함)
const PERF_PROD_CEIL = 1.25; // 생산만의 천장(맹활약, 수상 전)
const PERF_LO = 0.40;        // ratio 이 이하 → 바닥(중앙값의 40% 미만 생산)
const PERF_HI = 1.70;        // ratio 이 이상 → 생산 천장(중앙값의 170%+ 생산)
const AWARD_W = 0.08;        // 수상 가산(작게 — 수상은 OVR과 대부분 중복, 리뷰 §)
// 외인 전용 재계약 감쇠(#77 A/B 튜닝, 2026-07-09) — 확률형 aiRetainProb은 고OVR 외인(avg~85.5, 엘리트 플로어)에
// near-1이라 확률형 통일만으로 잔류율이 68%→83%로 과잉(§0 "매년 강제 도박=새 얼굴" 기둥을 무디게 하고 parity 소폭 악화).
// perfMult(어떤 외인이 남는지=성능 인지)는 유지하고, 임계값에 외인만 감쇠를 곱해 검증 baseline ~68%로 되돌린다.
// 아시아쿼터엔 미적용(#77 전에도 aiRetainProb 기반이라 잔류율 안정 — 외인만 문제). 롤 소비 불변(임계값만 조정).
export const IMPORT_RETAIN_ATTRITION = 0.70;

function smoothstep01(x: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** 동류(외인 or 아시아쿼터) 직전 시즌 득점 중앙값 = 활약도 기준선. 생산한(matches>0 → points>0) 선수만.
 *  중앙값은 이상치에 강건 + 자기보정(시대 앵커 불필요 — 같은 시즌 동류 대비). 없으면 0(→ perfMult 중립). */
function importBaseline(snapshot: Record<string, Player>, ctx: PerfCtx | undefined, asian: boolean): number {
  if (!ctx) return 0;
  const pts = Object.values(snapshot)
    .filter((p): p is Player => !!p && !!p.isForeign && (asian ? !!p.isAsianQuota : !p.isAsianQuota))
    .map((p) => ctx.prodOf(p.id)?.points ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (!pts.length) return 0;
  const m = Math.floor(pts.length / 2);
  return pts.length % 2 ? pts[m] : (pts[m - 1] + pts[m]) / 2;
}

/** 직전 시즌 생산 대비 활약도 → 재계약 확률 곱수. ratio = 선수 득점 / 동류 중앙값(baseline).
 *  두 조각 피벗(ratio=1=기대치를 정확히 1.0× 통과, 양끝 완만한 smoothstep) — 부진→<1×, 맹활약→>1×.
 *  수상 소폭 가산(작게). 생산 없거나 baseline 0(초기·동류 부재)이면 중립 1.0(측정 불가 → 무보정, 가짜인과 금지). */
export function perfMult(p: Player, ctx: PerfCtx | undefined, baseline: number): number {
  if (!ctx || baseline <= 0) return 1;
  const ratio = (ctx.prodOf(p.id)?.points ?? 0) / baseline;
  const prod = ratio <= 1
    ? PERF_FLOOR + (1 - PERF_FLOOR) * smoothstep01(ratio, PERF_LO, 1)
    : 1 + (PERF_PROD_CEIL - 1) * smoothstep01(ratio, 1, PERF_HI);
  return Math.max(PERF_FLOOR, Math.min(PERF_CEIL, prod + AWARD_W * ctx.awardOf(p.id)));
}

const clampS = (v: number) => Math.max(20, Math.min(96, Math.round(v)));
const LIFT_KEYS = ['jump', 'agility', 'reaction', 'positioning', 'focus', 'consistency', 'vq',
  'skSpike', 'skBlock', 'skDig', 'skReceive', 'skSet', 'skServe'] as const;

/** 능력 일괄 상향(키·체력 제외) — 바닥 보장용 */
function lift(p: Player, delta: number): Player {
  const out = { ...p };
  for (const k of LIFT_KEYS) (out as Record<string, unknown>)[k] = clampS((p[k] as number) + delta);
  return out;
}

/** 매년 새 외인 풀 — 전원 국내 평균 +2 이상(상위권~슈퍼스타). OP 중심(여자부 현실) */
export function generateForeignPool(season: number, domesticAvg: number, count = FRESH_POOL_SIZE, taken: Iterable<string> = []): Player[] {
  const rng = createRng(strSeed(`tryout-pool:${season}`));
  const out: Player[] = [];
  for (let i = 0; i < count; i++) {
    const pos: Position = rng.next() < 0.8 ? 'OP' : 'OH';
    const age = rng.int(23, 31);
    const bias = 6 + rng.int(0, 12); // 상위권 기본 — 분산은 도박의 재료
    let p = makePlayer(rng, `fgn-s${season}-${i}`, pos, true, age, bias);
    // 바닥 보장: 국내 평균 그 이상. lift는 키·체력 미상향이라 overall 천장(~89~93)이 존재 →
    // domesticAvg가 천장 근처(≥~87, 장기 인플레/손상·도핑 세이브)면 무캡 while가 영구루프=앱 프리즈
    // (edge-swarm 5세션 합의 발견 2026-06-27). best-effort 캡으로 종료 보장(정상 domesticAvg~64면 ~3회로 자연 종료, 불변).
    for (let g = 0; g < 60 && overall(p) < domesticAvg + 2; g++) p = lift(p, 3);
    out.push({ ...p, contract: { salary: FOREIGN_SALARY, years: 1, remaining: 1, signedAtAge: p.age } });
  }
  // 동명이인 방지 — fresh 배치 내부 + taken(현존 외인) 회피. 풀 화면=fresh+잔류 합쳐도 무중복(FOREIGN_SYSTEM §8)
  dedupeNames(out, `fgn:${season}`, taken);
  return out;
}

export interface TryoutOutcome extends TryoutPicks {
  poolIds: string[]; // 그 해 트라이아웃 전체 풀(미리보기 표시용)
}

// ─── 아시아쿼터 (FOREIGN_SYSTEM 7) — 외인과 별도 트라이아웃·슬롯. 포지션 유연·연봉 낮음 ───
// 여자부 아시아쿼터는 공격수/블로커 중심(수입 세터는 드묾). OH 다수·MB·OP.
const ASIAN_POS: Position[] = ['OH', 'OH', 'OH', 'MB', 'OP'];

/** 매년 아시아쿼터 풀 — 국내 평균 이상(외인은 +2). OH 중심 변주, 외인보다 한 티어 낮음 */
export function generateAsianPool(season: number, domesticAvg: number, count = FRESH_POOL_SIZE, taken: Iterable<string> = []): Player[] {
  const rng = createRng(strSeed(`asian-pool:${season}`));
  const out: Player[] = [];
  for (let i = 0; i < count; i++) {
    const pos = ASIAN_POS[rng.int(0, ASIAN_POS.length - 1)];
    const age = rng.int(22, 30);
    const bias = 2 + rng.int(0, 9); // 외인(6+0~12)보다 낮은 티어
    let p: Player = { ...makePlayer(rng, `asn-s${season}-${i}`, pos, true, age, bias), isAsianQuota: true };
    // 바닥 = 국내 평균(외인은 +2). 외인과 동일 무한루프 위험(아시아는 +2 마진 없어 임계 더 낮음) → best-effort 캡.
    for (let g = 0; g < 60 && overall(p) < domesticAvg; g++) p = { ...lift(p, 3), isAsianQuota: true };
    p = applyAsianIdentity(p); // 아시아 이름·국적(id 결정론)
    out.push({ ...p, contract: { salary: ASIAN_SALARY_Y1, years: 1, remaining: 1, signedAtAge: p.age } });
  }
  // 동명이인 방지 — fresh 배치 내부 + taken(현존 아시아쿼터) 회피. 이름+국적 묶음 재배정(FOREIGN_SYSTEM §8)
  dedupeNames(out, `asn:${season}`, taken);
  return out;
}

/**
 * 아시아쿼터 FA (FOREIGN_SYSTEM §7.4, 2026-27 실규칙) — 트라이아웃 폐지, 구단 직접 협상.
 * 트라이아웃 셸 유지하되 세 가지만 바꿈: 연봉 티어(Y1/Y2)·보유권 확률+증액+거부→아웃·경쟁 배정(선수 선택).
 * `offerScore`/`acceptProb` 프리미티브만 빌려 전용 소형 리졸버(자체 시드·슬롯가드·안정 타이브레이크·alt방출).
 * snapshot/rosters 직접 갱신(오프시즌 체인 내부, 외인 트라이아웃 다음·국내 FA 앞).
 */
export function runAsianQuota(
  snapshot: Record<string, Player>,
  rosters: Record<string, string[]>,
  returningAsian: string[],
  nextSeason: number,
  myTeam: string,
  myWish: string[],
  prevAsianOf: Record<string, string>,
  myKeep: boolean | null = null,
  myCash: number = Number.POSITIVE_INFINITY,
  perf?: PerfCtx, // 직전 시즌 활약도(생산·수상) — 미주입 시 perfMult 중립 1.0(구 호출부·테스트 호환)
): TryoutOutcome {
  const teamIds = Object.keys(rosters).sort(); // 안정 순회(결정론)
  const get = (id: string): Player | undefined => snapshot[id];
  const domestic = Object.values(rosters).flat()
    .map((id) => snapshot[id]).filter((p): p is Player => !!p && !p.isForeign);
  const domesticAvg = domestic.length
    ? domestic.reduce((s, p) => s + overall(p), 0) / domestic.length : 65;
  const domesticMed = medianOvr(domestic); // 상대 앵커(FA_SYSTEM 4) — 아시아쿼터 잔류 확률도 시대 보정
  const teamOvr = (t: string): number => {
    const ps = (rosters[t] ?? []).map((id) => snapshot[id]).filter((p): p is Player => !!p);
    return ps.length ? ps.reduce((s, p) => s + overall(p), 0) / ps.length : 60;
  };
  const hasAsian = (t: string): boolean => (rosters[t] ?? []).some((id) => snapshot[id]?.isAsianQuota);
  // 전용 시드(국내 FA rng 무오염 — 리뷰 §2). 롤 소비는 분기 무관하게 결정론.
  const retainRng = createRng(strSeed(`asian-retain:${nextSeason}`));
  const faRng = createRng(strSeed(`asian-fa:${nextSeason}`));
  const perfBaseline = importBaseline(snapshot, perf, true); // 아시아쿼터 동류 득점 중앙값(활약도 기준선)

  // ── 1) 보유권 (기존 구단 우선권) — Y2 증액 제시, 거부→시즌아웃 ──
  const picks: Record<string, string> = {};
  const keptSet = new Set<string>();
  const satOut = new Set<string>();
  for (const teamId of teamIds) {
    const pid = prevAsianOf[teamId];
    if (!pid) continue;
    const p = snapshot[pid];
    if (!p || !returningAsian.includes(pid)) continue; // 은퇴/이탈자는 갱신 불가
    const wantRoll = retainRng.next() < aiRetainProb(p, domesticMed) * perfMult(p, perf, perfBaseline); // 항상 소비(분기 무관 결정론). 활약도 곱(부진→↓·맹활약→↑)
    const rand = retainRng.next();
    const accRoll = retainRng.next();
    const canAffordY2 = teamId === myTeam ? myCash >= ASIAN_SALARY_Y2 : true;
    const wantRetain = teamId === myTeam ? (myKeep !== null ? myKeep : wantRoll) : wantRoll;
    if (!wantRetain || !canAffordY2) continue; // 미행사 → 자유 FA(아래 openPool에서 처리)
    // 증액 Y2 제안 → 선수 수락(보유권=강한 잔류, 거부는 드묾)
    const acc = acceptProb(offerScore({
      teamOvr: teamOvr(teamId), prestige: 0, posGap: 1, isOriginal: true, isFranchise: true,
      isPreferred: false, offerSalary: ASIAN_SALARY_Y2, asking: ASIAN_SALARY_Y2, w: prefWeightsOf(p), rand,
    }));
    if (accRoll < acc) {
      keptSet.add(pid);
      picks[teamId] = pid;
      snapshot[pid] = { ...p, contract: { salary: ASIAN_SALARY_Y2, years: 1, remaining: 1, signedAtAge: p.age } };
      rosters[teamId] = [...(rosters[teamId] ?? []), pid];
    } else {
      satOut.add(pid); // 증액 거부 → 한 시즌 타팀 계약 불가(리그 이탈)
    }
  }

  // ── 2) 자유 아시아 풀 = 신규 생성 + 보유권 미행사 복귀(잔류/시즌아웃 제외) ──
  const takenAsian = Object.values(snapshot)
    .filter((p): p is Player => !!p && !!p.isAsianQuota).map((p) => p.name);
  const fresh = generateAsianPool(nextSeason, domesticAvg, FRESH_POOL_SIZE, takenAsian);
  for (const p of fresh) snapshot[p.id] = p;
  const openIds = [
    ...fresh.map((p) => p.id),
    ...returningAsian.filter((id) => snapshot[id] && !keptSet.has(id) && !satOut.has(id)),
  ];
  // OVR desc · id 타이브레이크(결정론)
  const openPool = openIds.map((id) => snapshot[id]).filter((p): p is Player => !!p)
    .sort((a, b) => overall(b) - overall(a) || (a.id < b.id ? -1 : 1));

  // ── 3) 경쟁 배정 (선수 선택) — 관심팀={아시아 없음}∩{포지션 니즈}∩{Y1 지불력} ──
  const signed = new Set<string>();
  const signTo = (t: string, p: Player, salary: number) => {
    picks[t] = p.id;
    signed.add(p.id);
    snapshot[p.id] = { ...p, contract: { salary, years: 1, remaining: 1, signedAtAge: p.age } };
    rosters[t] = [...(rosters[t] ?? []), p.id];
  };
  for (const p of openPool) {
    const interested = teamIds.filter((t) => {
      if (hasAsian(t)) return false; // 슬롯 가드 — 팀당 1
      if (t === myTeam && myCash < ASIAN_SALARY_Y1) return false; // 내 지불력
      return (positionGap(rosters[t] ?? [], get)[p.position] ?? 0) > 0; // 포지션 니즈
    });
    if (!interested.length) continue;
    const scored = interested.map((t) => {
      const gap = positionGap(rosters[t] ?? [], get)[p.position] ?? 0;
      const wished = t === myTeam && myWish.includes(p.id);
      const score = offerScore({
        teamOvr: teamOvr(t), prestige: 0, posGap: gap, isOriginal: false, isFranchise: false,
        isPreferred: false, offerSalary: ASIAN_SALARY_Y1, asking: ASIAN_SALARY_Y1, w: prefWeightsOf(p),
        rand: faRng.next(), talkBias: wished ? 0.15 : 0, // 내 위시=소폭 선호(현장 협상 의지)
      });
      return { t, score };
    }).sort((a, b) => b.score - a.score || (a.t < b.t ? -1 : 1)); // 안정 타이브레이크
    if (scored[0].score >= SIT_OUT) signTo(scored[0].t, p, ASIAN_SALARY_Y1); // 최고 오퍼가 시원찮으면 미서명(드묾)
  }
  // ── 3.5) 멸종 방지 폴백 — 아시아 없는 팀은 남은 풀 최상위를 서명(구단은 슬롯을 채운다) ──
  for (const t of teamIds) {
    if (hasAsian(t)) continue;
    if (t === myTeam && myCash < ASIAN_SALARY_Y1) continue; // 내 팀은 지불 못하면 공석(자금 게이트 일관)
    const avail = openPool.find((p) => !signed.has(p.id));
    if (avail) signTo(t, avail, ASIAN_SALARY_Y1);
  }

  // ── 4) alt-pool(시즌 중 교체 대체) = 미서명 fresh 상위 OVR + 청소 ──
  const unsigned = openPool.filter((p) => !signed.has(p.id)
    && !Object.values(rosters).some((r) => r.includes(p.id)));
  const altPoolIds = unsigned.slice(0, ALT_POOL_SIZE).map((p) => p.id);
  const leftIds = unsigned.slice(ALT_POOL_SIZE).map((p) => p.id);
  const keep = new Set([...Object.values(picks), ...altPoolIds]);
  for (const id of Object.keys(snapshot)) {
    const p = snapshot[id];
    if (!p?.isAsianQuota) continue;
    const rostered = Object.values(rosters).some((r) => r.includes(id));
    if (!rostered && !keep.has(id)) delete snapshot[id];
  }
  const poolIds = [...fresh.map((p) => p.id), ...openIds.filter((id) => snapshot[id] && !fresh.some((f) => f.id === id))];
  return { picks, altPoolIds, leftIds, poolIds };
}

/**
 * 트라이아웃 실행 — snapshot/rosters를 직접 갱신(오프시즌 체인 내부, FA 시장 앞).
 * returningForeign: 전 시즌 외인(롤오버 생존자) — 재참가, 재지명되면 기록·근속 연속.
 */
export function runTryout(
  snapshot: Record<string, Player>,
  rosters: Record<string, string[]>,
  returningForeign: string[],
  nextSeason: number,
  myTeam: string,
  myWish: string[],
  prevForeignOf: Record<string, string>, // 전 시즌 팀별 외인(재계약 우선권의 주체)
  myKeep: boolean | null = null,         // 내 재계약 결정(null=자동 — AI 판단과 동일)
  myCash: number = Number.POSITIVE_INFINITY, // 내 운영 자금 — 외인 연봉 못 내면 외인 공석(시즌 중 교체와 일관)
  perf?: PerfCtx, // 직전 시즌 활약도(생산·수상) — 미주입 시 perfMult 중립 1.0(구 호출부·테스트 호환)
): TryoutOutcome {
  // 내 팀: 외인 연봉(FOREIGN_SALARY)을 못 내면 이번 오프시즌 외인 영입/재계약 불가(AI는 모기업 보전 — 무관).
  const myCanAffordForeign = myCash >= FOREIGN_SALARY;
  // 국내 평균 = 현재 로스터(외인 제외) OVR 평균 — 외인 바닥의 기준선
  const domestic = Object.values(rosters).flat()
    .map((id) => snapshot[id]).filter((p): p is Player => !!p && !p.isForeign);
  const domesticAvg = domestic.length
    ? domestic.reduce((s, p) => s + overall(p), 0) / domestic.length : 65;

  // 재계약 우선권(실제 KOVO) — 드래프트 전에 구단이 자기 외인과 갱신. 잘하는 용병은 수 시즌 잔류.
  //   이진 게이트(aiKeepsForeign) → 확률형 aiRetainProb × 활약도(perfMult)로 통일(#77) — 아시아쿼터·국내 FA와 같은 모델.
  //   전용 시드(국내 FA·드래프트 rng 무오염). 롤은 분기 무관 항상 소비(결정론) — 아시아쿼터 보유권 루프 미러.
  const domesticMed = medianOvr(domestic);                 // 시대 앵커(aiRetainProb) — 잔류 확률도 시대 보정
  const perfBaseline = importBaseline(snapshot, perf, false); // 외인 동류 득점 중앙값(활약도 기준선)
  const retainRng = createRng(strSeed(`foreign-retain:${nextSeason}`));
  const kept: Record<string, string> = {};
  const keptSet = new Set<string>();
  for (const teamId of Object.keys(rosters).sort()) {      // 안정 순회(결정론 — Object.entries 순서 비의존)
    const pid = prevForeignOf[teamId];
    if (!pid) continue;
    const p = snapshot[pid];
    if (!p || !returningForeign.includes(pid)) continue;   // 은퇴/이탈자는 갱신 불가
    const wantRoll = retainRng.next() < aiRetainProb(p, domesticMed) * perfMult(p, perf, perfBaseline) * IMPORT_RETAIN_ATTRITION; // 항상 소비(분기 무관). 활약도 곱 + 외인 전용 감쇠(§0 도박 기둥)
    const canAfford = teamId === myTeam ? myCanAffordForeign : true; // 자금 부족 — 내 외인 재계약 불가(공석)
    const wantRetain = teamId === myTeam ? (myKeep !== null ? myKeep : wantRoll) : wantRoll;
    if (!wantRetain || !canAfford) continue;
    kept[teamId] = pid;
    keptSet.add(pid);
    snapshot[pid] = { ...p, contract: { salary: FOREIGN_SALARY, years: 1, remaining: 1, signedAtAge: p.age } };
    rosters[teamId] = [...(rosters[teamId] ?? []), pid];
  }

  const takenForeign = Object.values(snapshot)
    .filter((p): p is Player => !!p && p.isForeign && !p.isAsianQuota).map((p) => p.name);
  const fresh = generateForeignPool(nextSeason, domesticAvg, FRESH_POOL_SIZE, takenForeign);
  for (const p of fresh) snapshot[p.id] = p;
  const poolIds = [...fresh.map((p) => p.id), ...returningForeign.filter((id) => snapshot[id] && !keptSet.has(id))];
  const pool = poolIds.map((id) => snapshot[id]).filter((p): p is Player => !!p);

  // 재계약한 팀은 드래프트를 건너뛴다(팀당 1명). 내 팀은 자금 부족 시 트라이아웃 지명도 제외(공석)
  const order = tryoutOrder(nextSeason, Object.keys(rosters))
    .filter((t) => !kept[t] && !(t === myTeam && !myCanAffordForeign));
  const res = resolveTryout(order, pool, myTeam, myWish, nextSeason);
  for (const [t, pid] of Object.entries(kept)) res.picks[t] = pid; // 결과 합치기(표시용)

  // 지명자 → 1년 계약으로 로스터 합류 (재계약자는 위에서 이미 합류 — 중복 금지)
  for (const [teamId, pid] of Object.entries(res.picks)) {
    if (keptSet.has(pid)) continue;
    const p = snapshot[pid];
    if (!p) continue;
    snapshot[pid] = { ...p, contract: { salary: FOREIGN_SALARY, years: 1, remaining: 1, signedAtAge: p.age } };
    rosters[teamId] = [...(rosters[teamId] ?? []), pid];
  }
  // 미지명자(대체 풀 제외)는 리그를 떠난다 + 과거 잔류물(전 시즌 대체 풀 등) 청소 — 세이브 다이어트
  const keep = new Set([...Object.values(res.picks), ...res.altPoolIds]);
  for (const id of Object.keys(snapshot)) {
    const p = snapshot[id];
    if (!p?.isForeign || p.isAsianQuota) continue; // 아시아쿼터는 별도 트라이아웃 소관 — 외인 cleanup서 제외(FOREIGN_SYSTEM 7)
    const rostered = Object.values(rosters).some((r) => r.includes(id));
    if (!rostered && !keep.has(id)) delete snapshot[id];
  }
  return { ...res, poolIds };
}
