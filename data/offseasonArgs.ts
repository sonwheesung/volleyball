// 공용 오프시즌 인자 조립 — 화면(draft·draft-live·fa …)과 store.endSeason 이
//   buildDraftContext(From)/faMarketPreviewFrom 를 **동일 인자 튜플**로 호출하도록 강제하는 단일 소스.
//
// 배경(전수조사 2026-07-08): draft.tsx·draft-live.tsx·fa.tsx 가 오프시즌 해결 인자 중
//   tryoutWish·keepForeign·moneyOnlyIds·asianWish·keepAsian 를 누락(기본값 []·null 하드코드)해
//   endSeason(store)과 다른 인자로 컨텍스트를 만들었다 → 라이브 확정 픽 유실·FA 미리보기≠결과.
//   여기 한 곳에서 "해결 꼬리 튜플"을 만들어 spread 하면, 화면이 인자를 빠뜨리는 게 **구조적으로 불가능**.
//   상설 가드 `tools/_dv_uictx.ts` 가 이 튜플 == endSeason 인자 정합을 검사(EC-FA-09).

import type { Contract } from '../types';
import type { OwnerFx } from '../engine/owner';
import {
  buildDraftContext, buildDraftContextFrom, type DraftContext, type OffseasonBase,
} from './draftSetup';
import { faMarketPreviewFrom, type FAPreview } from './offseason';

/** 오프시즌 컨텍스트를 만드는 데 필요한 전체 입력(스토어 슬라이스와 1:1). */
export interface OffseasonInputs {
  my: string;
  resignDecisions: Record<string, boolean>;
  contractOverrides: Record<string, Contract>;
  faSignings: string[];
  faAggressive: boolean;
  protectedIds: string[];
  nextSeason: number;                  // season + 1
  ownerFx?: OwnerFx;                    // buildOwnerFx(interviews, season, my, fanScore)
  myCash?: number;                      // 화면=정산/현재 자금, endSeason=walletCash(정산+기조 보너스)
  tryoutWish: string[];
  keepForeign: boolean | null;
  moneyOnlyIds: string[];
  asianWish: string[];
  keepAsian: boolean | null;
}

/**
 * 해결 "꼬리" 인자 — buildDraftContextFrom / faMarketPreviewFrom / (buildDraftContext 의 my·resign·overrides 뒤)가
 * 공유하는 동일 순서 튜플. 세 진입점의 시그니처가 byte-동일하므로 하나로 조립해 spread 한다.
 */
export type OffseasonResolveArgs = [
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  nextSeason: number,
  ownerFx: OwnerFx | undefined,
  myCash: number | undefined,
  tryoutWish: string[],
  keepForeign: boolean | null,
  moneyOnlyIds: string[],
  asianWish: string[],
  keepAsian: boolean | null,
];

/** 입력 → 해결 꼬리 튜플(단일 소스). 순서·개수를 여기서만 정의한다. */
export function offseasonResolveArgs(inp: OffseasonInputs): OffseasonResolveArgs {
  return [
    inp.faSignings, inp.faAggressive, inp.protectedIds, inp.nextSeason, inp.ownerFx,
    inp.myCash, inp.tryoutWish, inp.keepForeign, inp.moneyOnlyIds, inp.asianWish, inp.keepAsian,
  ];
}

/** 드래프트 컨텍스트(스냅샷/해결 분리) — 화면이 메모한 base 에서 해결. draft·draft-live·tryout·asian-tryout 공용. */
export function resolveDraftContextFor(base: OffseasonBase, inp: OffseasonInputs): DraftContext {
  return buildDraftContextFrom(base, inp.my, ...offseasonResolveArgs(inp));
}

/** FA 센터 미리보기(스냅샷/해결 분리) — 화면이 메모한 base 에서 해결. fa 공용. */
export function resolveFAPreviewFor(base: OffseasonBase, inp: OffseasonInputs): FAPreview {
  return faMarketPreviewFrom(base, inp.my, ...offseasonResolveArgs(inp));
}

/**
 * 모놀리식 드래프트 컨텍스트(base 를 내부에서 빌드) — endSeason(store) 전환용(웨이브2).
 * endSeason 이 이 함수를 쓰면 `buildDraftContext(my, resign, overrides, …14 인자)` 손수 나열이 사라져
 * 화면과 **같은 튜플**이 구조적으로 보장된다(현재 endSeason 호출과 byte-동일 — `_dv_uictx` 검증).
 */
export function draftContextFor(inp: OffseasonInputs): DraftContext {
  return buildDraftContext(inp.my, inp.resignDecisions, inp.contractOverrides, ...offseasonResolveArgs(inp));
}
