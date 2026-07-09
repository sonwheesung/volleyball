// 신인 드래프트 (FA_SYSTEM 3장). 순수 함수.
// 순번: 하위 팀 가중 추첨(1라운드) → 이후 라운드 동일 순서(KOVO식 간소화).
// 해석: 내 위시리스트 우선(순번 내에서) + 나머지는 AI 자동 지명.

import type { CoachStyle, Player, Position } from '../types';
import { type Rng, strSeed } from './rng';
import { overall } from './overall';
import { positionGap, ROSTER_IDEAL, needWeight, styleWeight, personalityFactor } from './aiGM';
import { ROSTER_CONTRACT_CAP } from './transactions';

/** KOVO 여자부 신인 드래프트 = 4라운드제(FA_SYSTEM §3.0). 각 라운드 순번대로 지명/패스. */
export const DRAFT_ROUNDS = 4;

/** 한 AI 픽의 사유 — wish(인간 위시) / super(특급 BPA) / need(부족 포지션) / best(필요없음→OVR+성격) */
export type PickReason = 'wish' | 'super' | 'need' | 'best';

type Lookup = (id: string) => Player | undefined;

/** 스카우팅 평가 노이즈 — 공개도(reveal) 낮을수록 유망주 가치 오판↑. 결정론(id+팀 해시). */
const SCOUT_NOISE = 0.2;
const hash01 = (s: string): number => (strSeed(s) % 100000) / 100000;
function scoutMult(playerId: string, teamId: string, reveal: number): number {
  if (reveal >= 1) return 1;
  return 1 + (hash01(`${playerId}:${teamId}`) * 2 - 1) * SCOUT_NOISE * (1 - reveal);
}

/** KOVO 1R 지명 순번 가중치(꼴찌→1위, FA_SYSTEM §3.0) — 7팀 = 35/30/20/8/4/2/1(합 100).
 *  하위 팀 우대(꼴찌 최고 확률)이되 보장 아님. 팀 수 변동 시 7-슬롯 곡선을 n점 재샘플(선형보간)해 일반화. */
export const KOVO_LOTTERY_WEIGHTS_7 = [35, 30, 20, 8, 4, 2, 1];

/** worstFirst.length 개 팀의 1R 추첨 가중치 배열(index 0=꼴찌). n=7이면 KOVO 정확표, 그 외는 곡선 재샘플. */
export function lotteryWeights(n: number): number[] {
  if (n <= 1) return n === 1 ? [1] : [];
  const base = KOVO_LOTTERY_WEIGHTS_7;
  if (n === base.length) return [...base];
  // base(7점, t=j/6)를 n점(t=i/(n-1))에서 선형보간 → 하위 우대 곡선 유지, 합은 무관(가중추첨은 비율만 사용)
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = t * (base.length - 1);
    const lo = Math.floor(x), hi = Math.min(base.length - 1, lo + 1);
    out.push(base[lo] + (base[hi] - base[lo]) * (x - lo));
  }
  return out;
}

/** 1라운드 순번 = 하위 팀 가중 추첨(KOVO 확률, FA_SYSTEM §3.0). worstFirst[0]=꼴찌(최고 가중). */
export function lotteryRound1(worstFirst: string[], rng: Rng): string[] {
  const w = lotteryWeights(worstFirst.length);
  const pool = worstFirst.map((id, i) => ({ id, w: w[i] }));
  const order: string[] = [];
  while (pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    order.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return order;
}

/** 전체 지명 순번(슬롯별 teamId) = 1R 순번 × rounds 라운드(KOVO 4라운드제, FA_SYSTEM §3.0).
 *  각 라운드 전 팀이 순번대로 등장하되, 실제 지명/패스는 resolveDraft가 슬롯마다 판정(팀당 지명 수 가변). */
export function buildDraftOrder(round1: string[], rounds: number = DRAFT_ROUNDS): string[] {
  const order: string[] = [];
  for (let r = 0; r < rounds; r++) order.push(...round1);
  return order;
}

/** AI 패스 판정(FA_SYSTEM §3.0) — 슬롯에서 지명 대신 패스할지. 순수·결정론.
 *  ①특급 있으면 절대 패스 안 함(BPA) ②계약 상한(20) 도달 시 패스 ③ideal(16) 구멍 있으면 라운드 무관 지명(발굴 니즈)
 *  ④구멍 없어도 로스터 여유(< PASS_COMFORT) 있으면 지명(발굴) ⑤구멍 없고 로스터 두터우면 패스(팽창 방지).
 *  로스터 균형(KOVO 12~17)을 유지하며 팀당 지명 가변 — 강팀 소수·약팀 다수. §E 검증·튜닝. */
export function aiShouldPass(rosterLen: number, needCount: number, round: number, hasSuper: boolean): boolean {
  if (rosterLen >= ROSTER_CONTRACT_CAP) return true; // 계약 상한(20) — 하드 자기억제(AI는 특급도 초과 안 함, 커밋 로스터 ≤20 불변식 보호)
  if (hasSuper) return false;                        // 특급은 무조건 지명(BPA)
  if (round <= 2) return false;                      // 1·2R 거의 무조건 지명(강팀도 — 미래 발굴, 빈자리≠픽수)
  if (needCount > 0) return false;                   // ideal 대비 구멍 있으면 3·4R도 지명
  // 3·4R & 구멍 없음 — 라운드 후반일수록·로스터 두터울수록만 패스(패스는 예외, 기본은 지명. 사용자 2026-07-09)
  return rosterLen >= (round <= 3 ? PASS_R3 : PASS_R4);
}
/** 3·4R 구멍없을 때 패스 문턱(로스터 두께). 후반일수록 낮춰(패스 쉬워짐) → 라운드별 패스율 단조↑. §E 튜닝. */
const PASS_R3 = 17;
const PASS_R4 = 15;
/** 발굴 여유 기준(로스터 두께) — 구멍 없어도 이 미만이면 지명(미래 발굴). ideal(16) 근처로 팽창 억제. §E 튜닝값. */
const PASS_COMFORT = 16;

export function neededPositions(rosterIds: string[], get: Lookup): Position[] {
  const have: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const id of rosterIds) {
    const p = get(id);
    if (p) have[p.position]++;
  }
  const out: Position[] = [];
  (Object.keys(ROSTER_IDEAL) as Position[]).forEach((pos) => {
    for (let i = 0; i < ROSTER_IDEAL[pos] - have[pos]; i++) out.push(pos);
  });
  return out;
}

/** 신인 종합 가치 = 현재 + 포텐(포텐 비중↑) */
export function prospectValue(p: Player): number {
  const pot = Math.max(...Object.values(p.potential));
  return overall(p) * 0.4 + pot * 0.6;
}

/** 특급(슈퍼) 유망주 컷 — 드래프트가치 ≥ 81(클래스 상위 ~10%, 측정 보정). 이상이면 포지션 무관 BPA(FA_SYSTEM 3.1).
 *  maxPot 단독(클래스 71%가 ≥88)은 변별 불가라 prospectValue(현재+포텐 0.6)로 정의. */
export const SUPER_PV = 81;
export const isSuperProspect = (p: Player): boolean => prospectValue(p) >= SUPER_PV;

// AI 유망주 가치 주입(스카우팅 2.0 3b, FA_SYSTEM §3.3) — data 계층이 setDraftValuer로 aiProspectValue(부분공개 포텐+아마추어성적)를 등록.
// engine→data 역참조를 피한 주입식(SOLID). 미등록(기본)이면 옛 전지적 prospectValue로 폴백 → 기존 로직·가드는 옛 동작 유지.
// data/draftSetup가 import 시 등록(OLD_AI env면 스킵=옛 AI 베이스라인 — 밸런스 A/B용). reveal은 팀 스카우팅 공개도.
let _valuer: ((p: Player, reveal: number) => number) | null = null;
let _superT = SUPER_PV;
/** AI 유망주 평가기 주입. fn=null이면 옛 전지적 prospectValue/SUPER_PV로 복귀. */
export function setDraftValuer(fn: ((p: Player, reveal: number) => number) | null, superThreshold: number = SUPER_PV): void {
  _valuer = fn;
  _superT = superThreshold;
}

function bestBy(arr: Player[], score: (p: Player) => number): Player {
  let best = arr[0];
  let bs = -Infinity;
  for (const p of arr) { const s = score(p); if (s > bs) { bs = s; best = p; } }
  return best;
}

/**
 * AI 픽(3티어, 사유 포함 — FA_SYSTEM 3.1):
 *  1) 슈퍼 유망주(prospectValue≥81=SUPER_PV) 있으면 포지션 무관 BPA(reason=super)
 *  2) 없으면 부족 포지션(gap>0)만 보고 가치×부족도×성향(reason=need)
 *  3) 부족 포지션 없으면 OVR×성격×성향(reason=best)
 */
export function pickWithReason(
  available: Player[],
  rosterIds: string[],
  get: Lookup,
  style: CoachStyle,
  teamId = '',
  reveal = 1,
): { player: Player; reason: PickReason } | null {
  if (available.length === 0) return null;
  const gap = positionGap(rosterIds, get);
  // 유망주 가치 — 주입된 aiProspectValue(reveal 의존)면 그걸, 아니면 옛 전지적 prospectValue. 특급 컷도 그에 맞춰 전환.
  const value = _valuer ? (p: Player) => _valuer!(p, reveal) : prospectValue;
  const superT = _valuer ? _superT : SUPER_PV;
  const styleScout = (p: Player) => styleWeight(p.position, style) * scoutMult(p.id, teamId, reveal);
  // 1) 특급 유망주 — 포지션 무관 베스트(BPA)
  const supers = available.filter((p) => value(p) >= superT);
  if (supers.length) return { player: bestBy(supers, (p) => value(p) * styleScout(p)), reason: 'super' };
  // 2) 부족 포지션 우선 — 잉여 포지션은 보지 않음(aiFillFromPool과 동일 정책)
  const needed = available.filter((p) => gap[p.position] > 0);
  if (needed.length) return { player: bestBy(needed, (p) => value(p) * needWeight(gap[p.position]) * styleScout(p)), reason: 'need' };
  // 3) 부족 없음 — 현재 실력(OVR) + 성격
  return { player: bestBy(available, (p) => overall(p) * personalityFactor(p) * styleScout(p)), reason: 'best' };
}

/** AI 지명(사유 없이 선수만) — 기존 호출부 호환. 내부는 3티어 pickWithReason. */
export function aiDraftPick(
  available: Player[],
  rosterIds: string[],
  get: Lookup,
  style: CoachStyle,
  teamId = '',
  reveal = 1, // 스카우팅 공개도(1=정밀, 낮을수록 오판)
): Player | null {
  return pickWithReason(available, rosterIds, get, style, teamId, reveal)?.player ?? null;
}

/**
 * 드래프트 해석(순수). 순번대로 진행:
 * - 내 슬롯(i번째): 확정 선택 `mySelections[i]`(라이브 인터랙티브 지명) 중 남아있으면 그것,
 *   없으면 위시리스트(찜 `draftPicks`, 우선순위) 중 남아있는 첫 선수, 그것도 없으면 AI 로직
 * - AI 슬롯: aiDraftPick
 * 반환: 갱신 로스터 + 지명된 선수 목록(레지스트리 추가용)
 * mySelections는 옵셔널(기본 [])이라 옛 8-인자 호출은 위시폴백=옛 동작 그대로(FA_SYSTEM §3.2.1 조정 E).
 */
export function resolveDraft(
  order: string[],
  cls: Player[],
  rostersIn: Record<string, string[]>,
  snapshotLookup: Lookup,
  myTeam: string,
  wishlist: string[],
  styleOf: (teamId: string) => CoachStyle,
  revealOf: (teamId: string) => number = () => 1, // 팀 스카우팅 공개도(기본 1=정밀)
  mySelections: string[] = [],                    // 내 슬롯 순서 확정 픽(라이브 인터랙티브, 조정 E). 슬롯 i가 소비
  targetOf: (teamId: string) => number = () => ROSTER_CONTRACT_CAP, // 팀 목표 로스터 크기(Phase 1.5) — 기본=하드 상한(옛 동작)
): { rosters: Record<string, string[]>; picked: Player[]; sequence: { teamId: string; playerId: string; reason: PickReason }[] } {
  const rosters: Record<string, string[]> = {};
  for (const k of Object.keys(rostersIn)) rosters[k] = [...rostersIn[k]];
  const clsById = new Map(cls.map((p) => [p.id, p]));
  const get: Lookup = (id) => snapshotLookup(id) ?? clsById.get(id);

  const available = [...cls];
  const wl = [...wishlist];
  const picked: Player[] = [];
  const sequence: { teamId: string; playerId: string; reason: PickReason }[] = [];
  let myPickIdx = 0; // 내 몇 번째 픽인가(내 슬롯마다 +1) — mySelections[myPickIdx] 매핑
  const roundOf: Record<string, number> = {}; // 팀별 등장 횟수 = 그 팀 현재 라운드(1..) — order 구조 무관 결정론

  for (const teamId of order) {
    const round = (roundOf[teamId] = (roundOf[teamId] ?? 0) + 1);
    let chosen: Player | null = null;
    let reason: PickReason = 'best';
    if (teamId === myTeam) {
      const sel = mySelections[myPickIdx]; // 이 슬롯의 확정 선택(있으면)
      myPickIdx++;                          // 내 슬롯마다 소비(선택 유무 무관 — 슬롯 i 고정)
      if (sel) {
        const idx = available.findIndex((a) => a.id === sel); // 아직 남아있으면 그대로, 앞선 픽에 소진됐으면 폴백
        if (idx >= 0) { chosen = available[idx]; reason = 'wish'; }
      }
      if (!chosen) {
        for (const id of wl) {
          const idx = available.findIndex((a) => a.id === id);
          if (idx >= 0) { chosen = available[idx]; reason = 'wish'; break; }
        }
      }
    }
    if (!chosen) {
      // AI(또는 위시 소진된 내 팀) 지명 — 패스 판정(FA_SYSTEM §3.0 4라운드제). 특급(super)은 패스 없음(BPA).
      const rosterLen = (rosters[teamId] ?? []).length;
      const r = pickWithReason(available, rosters[teamId] ?? [], get, styleOf(teamId), teamId, revealOf(teamId));
      if (r) {
        // 특급(super)이라도 계약 상한(20) 도달 시 패스 — 커밋 로스터 ≤20 불변식 보호(외인 포함 총원 기준). 특급은 목표 초과해도 지명(BPA).
        if (r.reason === 'super' && rosterLen < ROSTER_CONTRACT_CAP) { chosen = r.player; reason = r.reason; }
        else if (r.reason !== 'super') {
          // Phase 1.5: 팀 목표(targetOf) 도달 시 패스 — 드래프트가 로스터를 목표 위로 팽창시키지 않게(재계약·FA와 동일 목표).
          const target = targetOf(teamId);
          if (rosterLen < target) {
            const gap = positionGap(rosters[teamId] ?? [], get); // vs ROSTER_IDEAL — 발굴 니즈
            const needCount = Object.values(gap).filter((g) => g > 0).length;
            if (!aiShouldPass(rosterLen, needCount, round, false)) { chosen = r.player; reason = r.reason; }
            // else: 이 슬롯 패스(지명 없음) — 팀당 지명 수 가변
          }
          // else: 목표 도달 → 패스(로스터 크기 자율 관리)
        }
      }
    }
    if (!chosen) continue;
    const idx = available.findIndex((a) => a.id === chosen!.id);
    available.splice(idx, 1);
    rosters[teamId] = [...(rosters[teamId] ?? []), chosen.id];
    picked.push(chosen);
    sequence.push({ teamId, playerId: chosen.id, reason });
  }
  return { rosters, picked, sequence };
}
