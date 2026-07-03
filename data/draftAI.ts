// AI 드래프트 평가 (FA_SYSTEM §3.3 스카우팅 2.0 3b) — 전지적 maxPot 제거, 플레이어와 동일 정보.
//
// 데이터 계층(순수 파생)에 두고 engine/draft.resolveDraft에 **주입**한다(engine→data 역참조 회피, SOLID).
// AI가 보는 가치 = 현재 실력(즉전) + **스카우터가 공개한 부분 포텐**(못 보면 현재로 폴백) + 아마추어 성적 인상.
//   → 스카우터 좋은 팀이 천장을 더 봄(현실적 비대칭). 은닉된 gem/반짝은 아무도 확신 못 함(도박).
import type { Player } from '../types';
import { overall } from '../engine/overall';
import { amateurScore } from './amateurRecord';
import { potentialEstimate } from './prospectScout';

/** AI/단장이 실제로 보는 유망주 가치 — reveal(팀 스카우팅 공개도)에 의존. 전지적 maxPot 안 씀. */
export function aiProspectValue(p: Player, reveal: number): number {
  const cur = overall(p);                           // 현재 실력(즉전)
  const pot = potentialEstimate(p, reveal);         // 천장 추정(공개분=포텐·나머지=현재, reveal 단조)
  const amateurAdj = (amateurScore(p) - 0.5) * 12;  // 성적이 현재보다 좋/나쁨 ±6(성적 신호)
  return cur * 0.4 + pot * 0.6 + amateurAdj;
}

// 특급(BPA) 컷 — 옛 SUPER_PV(전지적 maxPot 기반 81)를 부분공개 스케일로 재보정(_dv_draftai가 ~3% 상위 실측 확정).
export const AI_SUPER_PV = 72;
export const isAiSuper = (p: Player, reveal: number): boolean => aiProspectValue(p, reveal) >= AI_SUPER_PV;
