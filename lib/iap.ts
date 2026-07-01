// IAP 추상화 (MONETIZATION_SYSTEM) — 결제·복원·엔타이틀먼트의 유일한 연결점.
//
// ~~검증·저장·로그 = RevenueCat(서버측). 앱은 SDK만 호출 → 자체 결제 서버/DB/로그 불필요(Supabase 불요).~~
//   → **정정(2026-07-01, 온라인 전환)**: RevenueCat 폐기. 결제 검증·저장·로그 = **우리 Vercel 서버가 직접**
//   (구글 Play/애플 App Store Server API 직접 검증 + consume/환불 웹훅, BACKEND_SYSTEM §5·§13.4 H1). 즉 결제 흐름은
//   **client가 스토어 결제 → 영수증/토큰을 `lib/server.ts`로 전송 → 서버가 검증·지급·consume**로 재작성 예정(#43, PG 연결 후).
//   dev(__DEV__): 실제 청구 없이 **시뮬 알림**으로 흐름 확인(현행 유지). prod: 네이티브 결제(react-native-iap 등, 지연 require)
//   + 서버 검증. 활성화(P2): 스토어 상품 등록 + EAS 빌드 + 서버 결제 라우트 연결.
//
// 원칙: **모든 함수는 throw하지 않고 결과를 반환**(예외는 전부 잡아 typed reason으로) → UI가 안전하게 분기·안내.
//   엔타이틀먼트(광고제거·DLC)는 표시/가용성만 게이트(엔진 격리, MONETIZATION §2.4). 비소모품은 스토어 복원 + 서버 엔타이틀먼트.
//   ⚠ 현재 구현은 아직 RevenueCat 잔재(아래) — #43에서 서버 직접검증으로 교체. 지금은 dev 스텁으로 흐름만 동작.

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
