// 외국인 트라이아웃 (FOREIGN_SYSTEM) — 매 오프시즌 풀 생성 + 지명 실행. data 계층(엔진 합성).
// 외인 성능 보장: 국내 평균 "그 이상"(설계 결정 2026-06-11) — 풀 바닥이 국내 평균을 깔고 시작한다.

import type { Player, Position } from '../types';
import { createRng, strSeed } from '../engine/rng';
import { overall } from '../engine/overall';
import { FOREIGN_SALARY, ASIAN_SALARY, FRESH_POOL_SIZE, tryoutOrder, resolveTryout, aiKeepsForeign, type TryoutPicks } from '../engine/foreign';
import { makePlayer, applyAsianIdentity, dedupeNames } from './seed';

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
    out.push({ ...p, contract: { salary: ASIAN_SALARY, years: 1, remaining: 1, signedAtAge: p.age } });
  }
  // 동명이인 방지 — fresh 배치 내부 + taken(현존 아시아쿼터) 회피. 이름+국적 묶음 재배정(FOREIGN_SYSTEM §8)
  dedupeNames(out, `asn:${season}`, taken);
  return out;
}

/**
 * 아시아쿼터 트라이아웃 — 외인과 동일 구조(재계약 우선권 → 풀 → 지명), 별도 순번·연봉·플래그.
 * snapshot/rosters 직접 갱신(오프시즌 체인 내부, 외인 트라이아웃 다음·FA 앞). resolveTryout 재사용.
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
): TryoutOutcome {
  const myCanAfford = myCash >= ASIAN_SALARY;
  const domestic = Object.values(rosters).flat()
    .map((id) => snapshot[id]).filter((p): p is Player => !!p && !p.isForeign);
  const domesticAvg = domestic.length
    ? domestic.reduce((s, p) => s + overall(p), 0) / domestic.length : 65;

  // 재계약 우선권(외인과 동일 AI 판정)
  const kept: Record<string, string> = {};
  const keptSet = new Set<string>();
  for (const [teamId, pid] of Object.entries(prevAsianOf)) {
    const p = snapshot[pid];
    if (!p || !returningAsian.includes(pid)) continue;
    if (teamId === myTeam && !myCanAfford) continue;
    const wants = teamId === myTeam && myKeep !== null ? myKeep : aiKeepsForeign(p, domesticAvg);
    if (!wants) continue;
    kept[teamId] = pid;
    keptSet.add(pid);
    snapshot[pid] = { ...p, contract: { salary: ASIAN_SALARY, years: 1, remaining: 1, signedAtAge: p.age } };
    rosters[teamId] = [...(rosters[teamId] ?? []), pid];
  }

  const takenAsian = Object.values(snapshot)
    .filter((p): p is Player => !!p && !!p.isAsianQuota).map((p) => p.name);
  const fresh = generateAsianPool(nextSeason, domesticAvg, FRESH_POOL_SIZE, takenAsian);
  for (const p of fresh) snapshot[p.id] = p;
  const poolIds = [...fresh.map((p) => p.id), ...returningAsian.filter((id) => snapshot[id] && !keptSet.has(id))];
  const pool = poolIds.map((id) => snapshot[id]).filter((p): p is Player => !!p);

  const order = tryoutOrder(nextSeason, Object.keys(rosters), 'asian-order')
    .filter((t) => !kept[t] && !(t === myTeam && !myCanAfford));
  const res = resolveTryout(order, pool, myTeam, myWish, nextSeason);
  for (const [t, pid] of Object.entries(kept)) res.picks[t] = pid;

  for (const [teamId, pid] of Object.entries(res.picks)) {
    if (keptSet.has(pid)) continue;
    const p = snapshot[pid];
    if (!p) continue;
    snapshot[pid] = { ...p, contract: { salary: ASIAN_SALARY, years: 1, remaining: 1, signedAtAge: p.age } };
    rosters[teamId] = [...(rosters[teamId] ?? []), pid];
  }
  // 미지명 아시아쿼터 청소(대체 풀 제외) — 외인 cleanup과 대칭(isAsianQuota만)
  const keep = new Set([...Object.values(res.picks), ...res.altPoolIds]);
  for (const id of Object.keys(snapshot)) {
    const p = snapshot[id];
    if (!p?.isAsianQuota) continue;
    const rostered = Object.values(rosters).some((r) => r.includes(id));
    if (!rostered && !keep.has(id)) delete snapshot[id];
  }
  return { ...res, poolIds };
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
): TryoutOutcome {
  // 내 팀: 외인 연봉(FOREIGN_SALARY)을 못 내면 이번 오프시즌 외인 영입/재계약 불가(AI는 모기업 보전 — 무관).
  const myCanAffordForeign = myCash >= FOREIGN_SALARY;
  // 국내 평균 = 현재 로스터(외인 제외) OVR 평균 — 외인 바닥의 기준선
  const domestic = Object.values(rosters).flat()
    .map((id) => snapshot[id]).filter((p): p is Player => !!p && !p.isForeign);
  const domesticAvg = domestic.length
    ? domestic.reduce((s, p) => s + overall(p), 0) / domestic.length : 65;

  // 재계약 우선권(실제 KOVO) — 드래프트 전에 구단이 자기 외인과 갱신. 잘하는 용병은 수 시즌 잔류
  const kept: Record<string, string> = {};
  const keptSet = new Set<string>();
  for (const [teamId, pid] of Object.entries(prevForeignOf)) {
    const p = snapshot[pid];
    if (!p || !returningForeign.includes(pid)) continue; // 은퇴/이탈자는 갱신 불가
    if (teamId === myTeam && !myCanAffordForeign) continue; // 자금 부족 — 내 외인 재계약 불가(공석)
    const wants = teamId === myTeam && myKeep !== null ? myKeep : aiKeepsForeign(p, domesticAvg);
    if (!wants) continue;
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
