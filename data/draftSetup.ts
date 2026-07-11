// 드래프트 컨텍스트 — 드래프트 직전 상태 + 순번 + 클래스. 결정론.
// 드래프트 센터와 store.endSeason 이 동일 함수로 미리보기=결과 보장.

import type { Contract, Player } from '../types';
import { createRng } from '../engine/rng';
import { positionGap } from '../engine/aiGM';
import { buildDraftOrder, lotteryRound1, setDraftValuer, DRAFT_ROUNDS } from '../engine/draft';
import { aiProspectValue, AI_SUPER_PV } from './draftAI';
import { generateDraftClass } from './draftClass';
import { resolvePreDraftFrom, buildOffseasonBase, type ExpelEvent, type OffseasonBase } from './offseason';
import { standingsWorstFirst } from './standings';

/** 드래프트 클래스 규모 = ~40명/년(KOVO 지원 규모, FA_SYSTEM §3.0). 4라운드×7팀=28슬롯 + 미지명 여유. */
const DRAFT_CLASS_SIZE = 40;

// 스카우팅 2.0 3b(FA_SYSTEM §3.3) — AI 유망주 평가를 부분공개 포텐+아마추어성적(플레이어와 동일 정보)로 주입.
// engine/draft.pickWithReason 이 이 밸류어를 쓴다. OLD_AI env면 등록 스킵 → 옛 전지적 prospectValue 유지(밸런스 A/B 베이스라인).
if (!(typeof process !== 'undefined' && process.env && process.env.OLD_AI)) {
  setDraftValuer(aiProspectValue, AI_SUPER_PV);
}

export interface DraftContext {
  snapshot: Record<string, Player>;
  rosters: Record<string, string[]>;     // 드래프트 전
  prevTeamOf: Record<string, string>;
  retired: string[];                      // 오프시즌 은퇴자 id(명예의전당)
  expelled: ExpelEvent[];                 // 오프시즌 영구제명자(승부조작·학폭 — 불명예 퇴출)
  order: string[];                        // 슬롯별 teamId
  cls: Player[];                          // 드래프트 클래스
  myHoles: number;
  myPickSlots: number[];                  // order 내 내 지명 순번(0-based)
  tryout: import('./tryout').TryoutOutcome; // 외국인 트라이아웃 결과(미리보기=결과 공유)
  asianTryout: import('./tryout').TryoutOutcome; // 아시아쿼터 트라이아웃 결과(FOREIGN_SYSTEM 7)
  compCash: number;                       // 내가 낸 FA 보상금 합(운영 자금 차감)
  counterFired: Record<string, { from: number; to: number }>; // 카운터 발동 관측(FA_SYSTEM §2.8.6 — endSeason 뉴스 ①)
  faSatOut: string[];                     // SIT_OUT+bids>0 잔류자(§2.8.6 뉴스 ②)
  myReleaseReasons: Record<string, import('./offseason').ReleaseReason>; // 내 팀 만료FA 재계약 불발 사유(FA §2.5c-격상 — endSeason 뉴스 사유)
  myResigned: string[];                   // 내 팀 만료FA 재계약 성사(도장) — endSeason 결산 뉴스
}

// 스냅샷/해결 분리(REALTIME_SIM §7.3) 재노출 — 앱이 base(안정 deps)를 따로 메모하게. buildOffseasonBase는 offseason 정본.
export { buildOffseasonBase, type OffseasonBase } from './offseason';

/** 드래프트 컨텍스트 해결부(가벼움) — 메모된 base에서 FA 해결 + 드래프트 순번·클래스. 토글만 재실행. */
export function buildDraftContextFrom(
  base: OffseasonBase,
  myTeam: string,
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  nextSeason: number,
  ownerFx?: import('../engine/owner').OwnerFx,
  myCash?: number,
  tryoutWish: string[] = [],
  myKeepForeign: boolean | null = null,
  moneyOnlyIds: string[] = [],
  asianWish: string[] = [],
  myKeepAsian: boolean | null = null,
  faOffers?: Record<string, import('../types').FAOffer>, // FA 오퍼 다레버(§2.8 Phase1)
): DraftContext {
  const pre = resolvePreDraftFrom(base, myTeam, faSignings, aggressive, protectedIds, nextSeason, ownerFx, myCash, tryoutWish, myKeepForeign, moneyOnlyIds, asianWish, myKeepAsian, faOffers);
  // KOVO 4라운드제(FA_SYSTEM §3.0): 순번 = 1R 가중추첨 × 4라운드. 팀별 지명 수는 resolveDraft가 슬롯마다 지명/패스 판정.
  const r1 = lotteryRound1(standingsWorstFirst(), createRng(60000 + nextSeason * 331));
  const order = buildDraftOrder(r1, DRAFT_ROUNDS);
  // 드래프트 클래스 ~40명(KOVO 지원 규모) — 리그 현 국내 선수 이름을 taken으로 줘 동명이인 방지(FOREIGN_SYSTEM §8)
  const takenKorean = Object.values(pre.snapshot)
    .filter((p): p is Player => !!p && !p.isForeign).map((p) => p.name);
  const cls = generateDraftClass(nextSeason, DRAFT_CLASS_SIZE, takenKorean);

  const myPickSlots: number[] = [];
  order.forEach((t, i) => {
    if (t === myTeam) myPickSlots.push(i);
  });
  // myHoles = ideal(16) 대비 발굴 여지(표시용) — floor↔ideal 간극. 지명권은 4라운드 고정(발굴 모델, 로스터 무관).
  const myGap = positionGap(pre.rosters[myTeam] ?? [], (id) => pre.snapshot[id]);
  const myHoles = Object.values(myGap).reduce((a, g) => a + Math.max(0, g), 0);

  return {
    snapshot: pre.snapshot,
    rosters: pre.rosters,
    prevTeamOf: pre.prevTeamOf,
    retired: pre.retired,
    expelled: pre.expelled,
    order,
    cls,
    myHoles,
    myPickSlots,
    tryout: pre.tryout,
    asianTryout: pre.asianTryout,
    compCash: pre.compCash,
    counterFired: pre.counterFired,
    faSatOut: pre.faSatOut,
    myReleaseReasons: base.off.myReleaseReasons ?? {}, // 버킷팅 진실(FA §2.5c-격상) — resolve는 이 사유맵을 안 바꿈(재계약자는 keep, 풀행자는 사유 기록됨)
    myResigned: base.off.myResigned ?? [],
  };
}

/** 드래프트 컨텍스트 = base 빌드 + 해결 합성(시그니처·결과 byte-동일). 헤드리스/합성 호출용. */
export function buildDraftContext(
  myTeam: string,
  resignDecisions: Record<string, boolean>,
  overrides: Record<string, Contract>,
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  nextSeason: number,
  ownerFx?: import('../engine/owner').OwnerFx,
  myCash?: number,
  tryoutWish: string[] = [],
  myKeepForeign: boolean | null = null,
  moneyOnlyIds: string[] = [],
  asianWish: string[] = [],
  myKeepAsian: boolean | null = null,
  faOffers?: Record<string, import('../types').FAOffer>, // FA 오퍼 다레버(§2.8 Phase1)
): DraftContext {
  const base = buildOffseasonBase(myTeam, resignDecisions, overrides, nextSeason, ownerFx);
  return buildDraftContextFrom(base, myTeam, faSignings, aggressive, protectedIds, nextSeason, ownerFx, myCash, tryoutWish, myKeepForeign, moneyOnlyIds, asianWish, myKeepAsian, faOffers);
}
