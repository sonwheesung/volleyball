// 다이아 팩 카탈로그 (MONETIZATION §11.1) — 표시 가격(원)·지급 다이아·누진 할인.
//   ⚠ 지급 권위는 서버 `server/lib/products.ts DIAMOND_PRODUCTS`(productId→다이아). 여기 amount와 **반드시 일치**.
//   할인은 **가격(개당 원)에 누진** 반영 — 큰 팩일수록 개당 저렴(보너스 다이아 아님, 순수 가격 할인).
//   실제 청구 가격은 스토어(Google Play/App Store) 상품 등록값이 정본 — 여기 priceKrw는 표시/설계용(등록값과 맞출 것).

export interface DiamondTier { id: string; amount: number; priceKrw: number }

// 개당 기준가 ₩10(100개 ₩1,000)에서 팩이 커질수록 -4%→-16%로 누진 할인.
export const DIAMOND_TIERS: DiamondTier[] = [
  { id: 'dia_100',   amount: 100,   priceKrw: 1000 },   // ₩10.0/개 · 기준
  { id: 'dia_500',   amount: 500,   priceKrw: 4800 },   // ₩9.6/개  · -4%
  { id: 'dia_1000',  amount: 1000,  priceKrw: 9300 },   // ₩9.3/개  · -7%
  { id: 'dia_2500',  amount: 2500,  priceKrw: 22500 },  // ₩9.0/개  · -10%
  { id: 'dia_5000',  amount: 5000,  priceKrw: 43500 },  // ₩8.7/개  · -13%
  { id: 'dia_10000', amount: 10000, priceKrw: 84000 },  // ₩8.4/개  · -16%
];

const BASE_RATE = DIAMOND_TIERS[0].priceKrw / DIAMOND_TIERS[0].amount; // ₩/개 기준(가장 작은 팩)

/** 기준 팩(100개) 대비 개당 할인율(%) — 표시용 뱃지. 100개=0. */
export function tierDiscountPct(t: DiamondTier): number {
  return Math.round((1 - (t.priceKrw / t.amount) / BASE_RATE) * 100);
}

/** ₩ 천단위 콤마 표시. */
export const formatKrw = (n: number): string => '₩' + n.toLocaleString('en-US');
