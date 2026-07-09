// 외국인 선수 (FOREIGN_SYSTEM) — 트라이아웃 시대 모델의 순수 결정 로직.
// 1년 계약·연봉 고정·추첨 순번·팀당 1명. 풀 "생성"은 data 계층(data/tryout.ts), 여기는 판정만.

import type { Player } from '../types';
import { createRng, strSeed } from './rng';
import { overall } from './overall';
import { RETIRE_AGE } from './retire';

/** 수입선수 정년(FOREIGN_SYSTEM §1.6) — 리그 정년 40세는 외인·아시아쿼터에도 적용.
 *  p = 롤오버된(다음 시즌) 나이 기준. true면 리그를 떠난다(keep·풀 재참가·AI 픽 모두 불가). 39세는 마지막 시즌 가능. */
export function importAgesOut(p: Player): boolean {
  return p.age >= RETIRE_AGE;
}

/** 외인 연봉 — 전 구단 동일(30만 달러 상당). 샐러리캡 제외, 운영 자금(FINANCE)에서 지출 */
export const FOREIGN_SALARY = 41000;
// 아시아쿼터 연봉 — FA 전환(2026-27 실규칙, FOREIGN_SYSTEM §7.4)으로 **연차 상한**. 여자부: 1년 $150k·2년 $170k.
// 엔진 단위 환산(FOREIGN_SALARY=41000≈$300k 기준): Y1≈20500·Y2≈23000. 캡 제외·운영 자금 지출.
export const ASIAN_SALARY_Y1 = 20500; // 1년차(신규 서명) 상한
export const ASIAN_SALARY_Y2 = 23000; // 2년차 이상(기존 구단 보유권 증액) 상한
/** @deprecated FA 전환 후 티어(asianSalary)를 쓴다. 신규 서명 기본값=Y1(구 호출부 호환). */
export const ASIAN_SALARY = ASIAN_SALARY_Y1;
/** 아시아쿼터 연봉 — 신규 서명 Y1, 재계약(보유권 증액) Y2. */
export function asianSalary(retained: boolean): number {
  return retained ? ASIAN_SALARY_Y2 : ASIAN_SALARY_Y1;
}
/** 시즌 중 교체 대체 풀 크기(트라이아웃 미지명자 중 잔류 희망 상위) */
export const ALT_POOL_SIZE = 4;
/** 신규 외인 풀 크기(매년) — 재참가자가 더해진다 */
export const FRESH_POOL_SIZE = 10;

/** 지명 순번 — 추첨(성적 무관, 현실 그대로. 꼴찌도 1픽을 못 받을 수 있는 비정함).
 *  tag로 독립 추첨 분리(외인 vs 아시아쿼터 순번이 달라야 함). 기본값=외인(기존 동작 보존). */
export function tryoutOrder(season: number, teamIds: string[], tag = 'tryout-order'): string[] {
  const rng = createRng(strSeed(`${tag}:${season}`));
  const arr = [...teamIds].sort();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** @deprecated (#77, 2026-07-09) 외인 재계약이 이진 게이트 → 확률형 `aiRetainProb × perfMult`(활약도)로 통일됨
 *  (data/tryout.ts runTryout, 아시아쿼터·국내 FA와 같은 모델). 이 함수는 호출부에서 제거됨 — 레거시 테스트
 *  (engine/foreign.test.ts)만 참조. 문제였던 점: ①이진 절벽(±1 OVR에 −4 잔류) ②시즌 실제 활약 무시
 *  ③외인풀 OVR이 이미 게이트 초과(격차~18>15)라 OVR 항 사실상 무의미. 삭제 금지(테스트 보존).
 *  재계약 우선권(실제 KOVO) — 구단은 자기 외인과 드래프트 없이 갱신할 수 있다(1년 단위). */
export function aiKeepsForeign(p: Player, domesticAvg: number): boolean {
  return overall(p) >= domesticAvg + 15 && p.age <= 32; // 확실한 에이스급만 — 애매하면 새 얼굴 도박(현실 잔류 ~절반)
}

/** AI 지명 — 실제 OVR + 약간의 안개(트라이아웃 며칠로는 다 못 본다) */
export function aiForeignChoice(pool: Player[], season: number, teamId: string): Player | null {
  if (!pool.length) return null;
  const rng = createRng(strSeed(`tryout-pick:${season}:${teamId}`));
  return [...pool]
    .map((p) => ({ p, score: overall(p) + rng.range(-3, 3) }))
    .sort((a, b) => b.score - a.score)[0].p;
}

export interface TryoutPicks {
  picks: Record<string, string>; // teamId → playerId
  altPoolIds: string[];          // 시즌 중 교체 대체 후보(미지명 상위)
  leftIds: string[];             // 리그를 떠나는 미지명자(스냅샷에서 제거 대상)
}

/**
 * 트라이아웃 해석 — 순번대로 팀당 1명. 내 팀은 위시리스트 우선(뺏기면 차순위), 없으면 AI 로직.
 * 순수: 풀과 순번을 받아 배정만 결정(스냅샷 변형은 data 계층).
 */
export function resolveTryout(
  order: string[],
  pool: Player[],
  myTeam: string,
  myWish: string[],
  season: number,
): TryoutPicks {
  let remain = [...pool];
  const picks: Record<string, string> = {};
  for (const t of order) {
    let chosen: Player | null = null;
    if (t === myTeam && myWish.length) {
      for (const wid of myWish) {
        const found = remain.find((p) => p.id === wid);
        if (found) { chosen = found; break; }
      }
    }
    if (!chosen) chosen = aiForeignChoice(remain, season, t);
    if (!chosen) break;
    picks[t] = chosen.id;
    remain = remain.filter((p) => p.id !== chosen!.id);
  }
  // 대체 풀 = 미지명자 중 OVR 상위(잔류 희망) — 시즌 중 부진 외인 교체용
  const sorted = [...remain].sort((a, b) => overall(b) - overall(a));
  return {
    picks,
    altPoolIds: sorted.slice(0, ALT_POOL_SIZE).map((p) => p.id),
    leftIds: sorted.slice(ALT_POOL_SIZE).map((p) => p.id),
  };
}
