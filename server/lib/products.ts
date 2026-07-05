// 결제 상품 카탈로그 (BACKEND_SYSTEM §13.18) — 서버 권위 매핑.
// 소모성 다이아 팩 = 우리 원장 지급(productId → 다이아, 클라값 무시). 비소모 엔타이틀먼트 = RC customerInfo 소유(원장 무관).
// ⚠ 스토어(Google Play/App Store) 상품 등록 시 이 productId와 **정확히 일치**시킬 것. 미등록/오타면 지급 0(fail-closed).

/** 다이아 팩(소모성) → 지급 다이아. 스토어 상품 ID = 키. 클라 표시 카탈로그 `data/diamondTiers.ts`와 amount 일치.
 *  가격(누진 할인)은 스토어 등록값이 정본 — 여기선 productId→지급 다이아만(금액은 서버 권위, 클라값 무시). */
export const DIAMOND_PRODUCTS: Record<string, number> = {
  dia_100: 100,
  dia_500: 500,
  dia_1000: 1000,
  dia_2500: 2500,
  dia_5000: 5000,
  dia_10000: 10000,
};

/** 엔타이틀먼트(비소모) 상품 — RC customerInfo가 진실. 원장 미지급(§13.18). 참고용 집합. */
export const ENTITLEMENT_PRODUCTS = new Set<string>(['remove_ads', 'dlc_worldcup']);

/** 소모성 다이아 팩이면 지급 다이아, 아니면 null(엔타이틀먼트/미등록). */
export function productDiamonds(productId: string): number | null {
  return Object.prototype.hasOwnProperty.call(DIAMOND_PRODUCTS, productId) ? DIAMOND_PRODUCTS[productId] : null;
}
