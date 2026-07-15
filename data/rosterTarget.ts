// AI 로스터 크기 목표 — 직전 순위(성적) 기반 평균회귀만 (FA_SYSTEM §1.5~1.7, Phase 1.5 2026-07-09).
//   ⚠ 구단 정체성 nudge는 **폐기**(아래 12~16행 참조 — parity 서열 고착으로 제거). 목표는 순수 성적 기반, 정체성은 씨앗(간접)일 뿐.
//   data 계층(엔진 aiRosterTarget 순수 함수 + 표준 셀렉터 computeStandings/clubIdentity 합성).
//   오프시즌이 이 목표를 3층 상한으로 나눠 써 로스터가 상한 20이 아니라 팀별 목표(12~18)에 앉는다:
//     ├ 드래프트 상한 = T(총원 목표)                : resolveDraft targetOf — 이 위로는 지명 안 함
//     ├ AI FA 상한   = T − RESERVE(총원, 예약분 양보): resolveFAMarket rosterCeil — 드래프트에 ~RESERVE칸 남김
//     └ 국내 재계약/방출 상한 = T − RESERVE − IMPORTS(국내만): buildOffseason — 트라이아웃이 채울 외인/아시아 자리까지 비워둠
//   → 커밋 로스터 ≈ T = 국내(재계약/방출 후) + 외인·아시아(트라이아웃) + 드래프트 신인 + fillRosters(floor 복원).

import { computeStandings, type Standing } from './standings';
import { aiRosterTarget } from '../engine/aiGM';

// 구단 정체성(명문/신생 등)은 **로스터 목표에 직접(영구) 반영하지 않는다** — 기둥6 "정체성 = 시작 조건이라 수 시즌 뒤
// 평균회귀"·엔진 무파급을 지키기 위함. (초기 검토판의 정체성 ±1 nudge는 parity A/B에서 **순위 지속성(서열 고착)을
// 0.13→0.68로 악화**시켜 폐기 — 영구 편향은 100시즌에 걸쳐 서열을 잠갔다.) 정체성의 로스터 색깔은 **간접적**으로 나온다:
// CLUB_IDENTITY가 초기 전력·나이 분포를 정해 초반 성적이 갈리고, 그 성적이 아래 성적기반 목표를 통해 로스터 두께로 이어진다
// (명문은 초반 강 → 두껍게, 그러나 몰락하면 얇아짐 = 평균회귀). 즉 목표는 **순수 성적 기반**이고 정체성은 씨앗일 뿐이다.

/** 드래프트(발굴)에 남겨두는 슬롯 수(FA_SYSTEM §1.7·§3.0, Phase 1.5) — 재계약·AI FA는 **목표−RESERVE** 까지만 잡아
 *  매 오프시즌 ~RESERVE칸을 신인에게 비운다(드래프트가 주 공급원 = KOVO식). 지명 수 ≈ RESERVE(팀당 2~4). §E 튜닝. */
export const DRAFT_RESERVE = 2;
/** AI FA에 남겨두는 슬롯(FA_SYSTEM §2, Phase 1.5) — 재계약(국내 상한)을 이만큼 더 낮춰 **AI FA가 풀에서 수혈할 자리**를 만든다.
 *  0이면 재계약+수입이 FA 상한을 꽉 채워 **AI FA 시장이 죽는다**(_dv_uictx (B) 감지 = FA 등급 재정렬 불가). §E 튜닝. */
export const FA_RESERVE = 2;
/** 트라이아웃이 드래프트 전에 채우는 수입 슬롯(외인 OP 1 + 아시아쿼터 ~1) — 국내 재계약/방출 상한 계산에서 빼둔다.
 *  이 자리를 국내 선수로 채우면 커밋 총원이 목표를 넘으므로, 국내 상한 = 총원상한 − DRAFT − FA − IMPORTS. */
export const IMPORT_SLOTS = 2;
/** 국내 재계약/방출 상한의 하한(경기 floor 12보다 낮게) — floor 밑까지 비워도 드래프트+fillRosters가 뒤에서 floor로 복원.
 *  이 값이 높으면 예약이 안 생겨 드래프트가 굶는다. 커밋 로스터는 항상 floor(12) 이상(fillRosters 보장). */
export const DOMESTIC_FLOOR = 7;

// §7.8(#111) — pre 주입: endSeason이 commitRosters **후** buildDraftContext/resolveDraft에서 이 목표를 계산하는데,
//   commit이 순위 캐시를 무효화해 여기서 computeStandings(MAX)가 COLD 풀시뮬(126)로 돈다(A블록 풀시뮬을 B로 옮긴 잔여
//   비용 — §7.8 4-지점 목록이 놓친 5번째 사이트). endSeason은 커밋 전 캡처 순위(seasonClose.standings)를 pre로 주입해
//   관전 우주 + COLD 재시뮬 0회로 통일한다. 미제공(프리뷰/시뮬/감사)=현행 라이브 읽기(무변경).

/** 팀별 AI 목표 로스터 크기(최종·드래프트 상한 T) — 직전 시즌 최종 순위(평균회귀)만. 순수(결정론). */
export function aiRosterTargets(pre?: Standing[]): Record<string, number> {
  const standings = pre ?? computeStandings(Number.MAX_SAFE_INTEGER); // §7.8 주입 시 캡처 순위
  const n = standings.length;
  const out: Record<string, number> = {};
  standings.forEach((st, i) => { out[st.teamId] = aiRosterTarget(i + 1, n); });
  return out;
}

/** 팀별 AI FA 상한(총원) = 목표 − RESERVE(RESERVE 하한 없이, 드래프트 자리 확보). resolveFAMarket rosterCeil. */
export function aiReserveTargets(pre?: Standing[]): Record<string, number> {
  const t = aiRosterTargets(pre);
  const out: Record<string, number> = {};
  for (const id of Object.keys(t)) out[id] = Math.max(DOMESTIC_FLOOR + IMPORT_SLOTS, t[id] - DRAFT_RESERVE);
  return out;
}

/** 팀별 국내 재계약/방출 상한 = 목표 − DRAFT − FA − IMPORTS(국내만). buildOffseason이 재계약·능동방출을 여기서 끊는다.
 *  드래프트·AI FA·트라이아웃이 뒤에서 채울 자리를 국내로 메우지 않게 미리 비워둔다 → 커밋 총원 ≈ 목표. floor(12)보다 낮을 수 있음(의도). */
export function aiDomesticCaps(pre?: Standing[]): Record<string, number> {
  const t = aiRosterTargets(pre);
  const out: Record<string, number> = {};
  for (const id of Object.keys(t)) out[id] = Math.max(DOMESTIC_FLOOR, t[id] - DRAFT_RESERVE - FA_RESERVE - IMPORT_SLOTS);
  return out;
}

/** resolveDraft(targetOf) 주입용 — 팀별 총원 목표 조회 함수(미상 팀은 중앙값 14). */
export function aiTargetOf(pre?: Standing[]): (teamId: string) => number {
  const t = aiRosterTargets(pre);
  return (id) => t[id] ?? 14;
}
