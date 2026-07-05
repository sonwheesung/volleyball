// IAP 추상화 (MONETIZATION_SYSTEM) — 결제·복원·엔타이틀먼트의 유일한 연결점.
//
// **결제 게이트웨이 = RevenueCat**(정정 2026-07-03, BACKEND_SYSTEM §13.18 — 사용자 결정으로 RC 재채택).
//   ~~2026-07-01: RC 폐기 → 우리 서버가 스토어 API로 직접 검증~~ → **되돌림**: RC를 영수증검증·환불 웹훅·
//   엔타이틀먼트(광고제거·DLC) 게이트웨이로 쓴다. 단 **다이아 잔액 진실은 계속 우리 원장**(RC virtual currency 금지) —
//   다이아 소모품 결제는 RC 검증 후 서버 `wallet/earn`으로 지급(#43). 엔타이틀먼트(remove_ads·worldcup)는 RC가 직접 소유.
//   dev(__DEV__): 실제 청구 없이 **시뮬 알림**으로 흐름 확인. prod: RevenueCat SDK(`react-native-purchases`, 지연 require).
//   활성화: RC 대시보드 상품/엔타이틀먼트 + `REVENUECAT_API_KEY` + EAS 빌드(네이티브 모듈). 서버 RC 웹훅은 이미 구현.
//
// 원칙: **모든 함수는 throw하지 않고 결과를 반환**(예외는 전부 잡아 typed reason으로) → UI가 안전하게 분기·안내.
//   엔타이틀먼트(광고제거·DLC)는 표시/가용성만 게이트(엔진 격리, MONETIZATION §2.4). 비소모품은 스토어 복원 + 서버 엔타이틀먼트.

import { Alert } from 'react-native';
import { setRemoveAds } from './ads';
import { logEvent, logError } from './log';
import { confirmPurchase } from './server';
import { DIAMOND_TIERS } from '../data/diamondTiers';

export type Sku = 'remove_ads' | 'dlc_worldcup';
export type PurchaseResult =
  | { ok: true; sku: Sku }
  | { ok: false; reason: 'cancelled' | 'network' | 'unavailable' | 'error'; message?: string };

export interface Entitlements { removeAds: boolean; worldCup: boolean }

// RevenueCat 공개 SDK 키(publishable — 번들 인라인 OK, 구글 로그인 키와 동일 패턴). `.env`의 EXPO_PUBLIC_REVENUECAT_API_KEY로
// 주입 → EAS 재빌드해야 반영(EXPO_PUBLIC_*은 빌드타임 인라인). 비면 configure 생략 → 결제·엔타이틀먼트 전부 미소유(graceful).
const REVENUECAT_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

const SKU_LABEL: Record<Sku, string> = { remove_ads: '광고 제거', dlc_worldcup: '월드컵 시즌 구매' };
// RevenueCat 대시보드 엔타이틀먼트 식별자(설정값과 일치시킬 것)
const ENT_ID: Record<keyof Entitlements, string> = { removeAds: 'remove_ads', worldCup: 'worldcup' };

let cached: Entitlements = { removeAds: false, worldCup: false };
export function getEntitlements(): Entitlements { return cached; }

function apply(e: Entitlements): void {
  cached = e;
  setRemoveAds(e.removeAds);       // 광고 표시 토글(lib/ads). worldCup은 WORLDCUP_SYSTEM이 getEntitlements로 읽음.
  logEvent('iap:entitlements', { ...e });
}
function grant(sku: Sku): void {
  apply({ removeAds: cached.removeAds || sku === 'remove_ads', worldCup: cached.worldCup || sku === 'dlc_worldcup' });
}

/** RevenueCat SDK 지연 로드 — 미설치(Expo Go)·예외면 null(호출부가 graceful 처리). */
function rc(): any | null {
  try {
    // @ts-ignore — 선택적 네이티브 모듈(운영 빌드에서 expo install). 미설치 시 throw → null.
    return require('react-native-purchases').default;
  } catch {
    return null;
  }
}

function fromCustomerInfo(info: any): Entitlements {
  const active = info?.entitlements?.active ?? {};
  return { removeAds: !!active[ENT_ID.removeAds], worldCup: !!active[ENT_ID.worldCup] };
}

let configured = false;
/** 앱 시작 시 1회 — RevenueCat 초기화 + 엔타이틀먼트 로드. dev no-op. 실패해도 graceful(미소유로 앱 정상). */
export async function initIap(): Promise<void> {
  if (__DEV__) return;
  try {
    const Purchases = rc();
    if (!Purchases) return;
    if (!configured && REVENUECAT_API_KEY) { Purchases.configure({ apiKey: REVENUECAT_API_KEY }); configured = true; }
    await loadEntitlements();
  } catch (e) {
    logError('iap.initIap', e);
  }
}

/** 로그인 직후 1회 — RC app_user_id를 우리 userId로 고정(§13.18 "최대 함정": 안 하면 웹훅 app_user_id가
 *  유저에 안 붙어 지급 불가). dev/미설치/미설정이면 no-op. 실패해도 graceful(구매 시 confirm 폴백이 userId로 지급). */
export async function identifyUser(userId: string): Promise<void> {
  if (__DEV__ || !userId) return;
  try {
    const Purchases = rc();
    if (!Purchases || !REVENUECAT_API_KEY) return;
    if (!configured) { Purchases.configure({ apiKey: REVENUECAT_API_KEY }); configured = true; }
    await Purchases.logIn(userId);
    await loadEntitlements();               // 계정 전환 후 소유 엔타이틀먼트 재로드
  } catch (e) {
    logError('iap.identifyUser', e);
  }
}

/** 로그아웃 시 — RC 익명 사용자로 되돌림(다음 로그인 계정 재귀속). dev/미설치면 no-op. */
export async function logoutUser(): Promise<void> {
  if (__DEV__) return;
  try {
    const Purchases = rc();
    if (!Purchases || !REVENUECAT_API_KEY || !configured) return;
    await Purchases.logOut();
    apply({ removeAds: false, worldCup: false }); // 익명 = 미소유로 초기화
  } catch (e) {
    logError('iap.logoutUser', e);
  }
}

/** 소유 엔타이틀먼트 로드(오프라인이면 RevenueCat SDK 로컬 캐시). dev는 no-op(미소유 시작). */
export async function loadEntitlements(): Promise<void> {
  if (__DEV__) return;
  try {
    const Purchases = rc();
    if (!Purchases) return;                     // 미설치 — 전부 미소유로 안전 동작
    const info = await Purchases.getCustomerInfo();
    apply(fromCustomerInfo(info));
  } catch (e) {
    logError('iap.loadEntitlements', e);        // 실패해도 미소유로 graceful(앱은 정상 동작)
  }
}

/** 구매 — 항상 결과 반환(throw 없음). dev는 시뮬, prod는 RevenueCat. */
export async function purchase(sku: Sku): Promise<PurchaseResult> {
  logEvent('iap:purchase:start', { sku });
  if (__DEV__) {
    return await new Promise<PurchaseResult>((resolve) => {
      Alert.alert('결제 (개발)', `${SKU_LABEL[sku]} 구매 시뮬레이션\n운영 빌드에선 실제 결제(RevenueCat)가 진행됩니다.`, [
        { text: '취소', style: 'cancel', onPress: () => resolve({ ok: false, reason: 'cancelled' }) },
        { text: '구매(시뮬)', onPress: () => { grant(sku); resolve({ ok: true, sku }); } },
      ], { onDismiss: () => resolve({ ok: false, reason: 'cancelled' }) });
    });
  }
  try {
    const Purchases = rc();
    if (!Purchases) return { ok: false, reason: 'unavailable', message: 'IAP 모듈 없음' };
    const offerings = await Purchases.getOfferings();
    const pkgs: any[] = offerings?.current?.availablePackages ?? [];
    const pkg = pkgs.find((p) => p?.product?.identifier === sku || p?.identifier === sku);
    if (!pkg) return { ok: false, reason: 'unavailable', message: '상품을 찾을 수 없음' };
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    apply(fromCustomerInfo(customerInfo));
    logEvent('iap:purchase:ok', { sku });
    return { ok: true, sku };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, reason: 'cancelled' };  // 유저 취소 — 오류 아님
    logError('iap.purchase', e);
    const net = /network|offline|connection/i.test(String(e?.message ?? ''));
    return { ok: false, reason: net ? 'network' : 'error', message: String(e?.message ?? e) };
  }
}

/** 구매 복원(스토어 정책상 필수) — 재설치·기변 시. 항상 결과 반환. */
export async function restorePurchases(): Promise<{ ok: boolean; entitlements?: Entitlements; reason?: string }> {
  if (__DEV__) {
    return await new Promise((resolve) => {
      Alert.alert('구매 복원 (개발)', '운영 빌드에선 스토어에서 구매 내역을 복원합니다.', [
        { text: '확인', onPress: () => resolve({ ok: true, entitlements: cached }) },
      ], { onDismiss: () => resolve({ ok: true, entitlements: cached }) });
    });
  }
  try {
    const Purchases = rc();
    if (!Purchases) return { ok: false, reason: 'unavailable' };
    const info = await Purchases.restorePurchases();
    apply(fromCustomerInfo(info));
    return { ok: true, entitlements: cached };
  } catch (e) {
    logError('iap.restorePurchases', e);
    return { ok: false, reason: 'error' };
  }
}

export const skuLabel = (sku: Sku): string => SKU_LABEL[sku];

export type DiamondResult =
  | { ok: true; productId: string; amount: number }
  | { ok: false; reason: 'cancelled' | 'network' | 'unavailable' | 'error'; message?: string };

/** 다이아 팩(소모성) 구매 — 항상 결과 반환(throw 없음). 실지급은 **서버(영수증 검증)만**:
 *  dev=시뮬(미지급 — 서버가 'purchase' earn 사칭 차단). prod=RC 소모품 결제 → RC 웹훅이 서버 원장에 지급(§13.18)
 *  → 호출부가 `syncWallet()`으로 잔액 반영. 상품 amount는 서버 권위(`DIAMOND_PRODUCTS`), 여기 amount는 표시용. */
export async function purchaseDiamonds(productId: string): Promise<DiamondResult> {
  const tier = DIAMOND_TIERS.find((t) => t.id === productId);
  if (!tier) return { ok: false, reason: 'unavailable', message: '상품 없음' };
  logEvent('iap:diamonds:start', { productId });
  if (__DEV__) {
    return await new Promise<DiamondResult>((resolve) => {
      Alert.alert('다이아 구매 (개발)', `${tier.amount.toLocaleString()} 💎 구매 시뮬레이션\n운영 빌드에선 실제 결제(RevenueCat) → 서버 검증 후 지급됩니다.`, [
        { text: '취소', style: 'cancel', onPress: () => resolve({ ok: false, reason: 'cancelled' }) },
        { text: '구매(시뮬)', onPress: () => resolve({ ok: true, productId, amount: tier.amount }) },
      ], { onDismiss: () => resolve({ ok: false, reason: 'cancelled' }) });
    });
  }
  try {
    const Purchases = rc();
    if (!Purchases || !REVENUECAT_API_KEY) return { ok: false, reason: 'unavailable', message: 'IAP 미설정' }; // 키 없으면 "출시 빌드에서 연결" 안내
    const offerings = await Purchases.getOfferings();
    const pkgs: any[] = offerings?.current?.availablePackages ?? [];
    const pkg = pkgs.find((p) => p?.product?.identifier === productId || p?.identifier === productId);
    if (!pkg) return { ok: false, reason: 'unavailable', message: '상품을 찾을 수 없음' };
    const res: any = await Purchases.purchasePackage(pkg); // 결제 완료(취소면 throw). 지급은 서버 원장(웹훅+confirm 폴백)
    // 폴백(§13.18 필수): 스토어 거래id로 서버 재검증·지급 — 웹훅 지연·유실 시 "돈 내고 0개" 방지.
    //   웹훅과 동일 멱등키(purchase:<userId>:<storeTxnId>)라 먼저 온 쪽 지급·둘째 applied:false로 dedupe.
    const storeTxnId = String(res?.transaction?.transactionIdentifier ?? res?.transaction?.storeTransactionId ?? '');
    if (storeTxnId) {
      const c = await confirmPurchase(storeTxnId, productId);
      if (!c.ok) logError('iap.purchaseDiamonds.confirm', c.reason); // 폴백 실패해도 웹훅이 메꿈 → syncWallet로 수렴(치명 아님)
    } else {
      logError('iap.purchaseDiamonds', 'storeTxnId 없음 — 웹훅 단독 의존'); // 거래id 미추출: 웹훅만으로 지급(폴백 스킵)
    }
    logEvent('iap:diamonds:ok', { productId });
    return { ok: true, productId, amount: tier.amount };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, reason: 'cancelled' };
    logError('iap.purchaseDiamonds', e);
    const net = /network|offline|connection/i.test(String(e?.message ?? ''));
    return { ok: false, reason: net ? 'network' : 'error', message: String(e?.message ?? e) };
  }
}
