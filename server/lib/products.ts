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

/** 출석 패스 소비성 SKU(ATTENDANCE_PASS_SYSTEM §2.1). 구매 = attendance_passes 행 1개 생성(다이아는 일일 수령으로만).
 *  DIAMOND_PRODUCTS·ENTITLEMENT_PRODUCTS 어디에도 없어 "미등록 → 무시"로 떨어지던 것을 pass-grant로 분기(§2.1). 1+1 비대상(§3.1). */
export const PASS_PRODUCTS = new Set<string>(['diamond_pass']);

/** 소모성 다이아 팩이면 지급 다이아, 아니면 null(엔타이틀먼트/패스/미등록). */
export function productDiamonds(productId: string): number | null {
  return Object.prototype.hasOwnProperty.call(DIAMOND_PRODUCTS, productId) ? DIAMOND_PRODUCTS[productId] : null;
}

/** 출석 패스 SKU인가(pass-grant 분기). */
export function isPassProduct(productId: string): boolean {
  return PASS_PRODUCTS.has(productId);
}
