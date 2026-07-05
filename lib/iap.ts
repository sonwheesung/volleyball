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

export type Sku = 'remove_ads' | 'dlc_worldcup';
export type PurchaseResult =
  | { ok: true; sku: Sku }
  | { ok: false; reason: 'cancelled' | 'network' | 'unavailable' | 'error'; message?: string };

export interface Entitlements { removeAds: boolean; worldCup: boolean }

// P2: RevenueCat 대시보드에서 발급한 공개 API 키(플랫폼별)로 교체. 비면 configure 생략 → 전부 미소유(graceful).
const REVENUECAT_API_KEY = '';

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
