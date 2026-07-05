// 광고 추상화 (MONETIZATION_SYSTEM §3 · §3.2 실연동) — 앱의 유일한 광고 연결점.
//
// 광고 2종:
//   • **시즌 시작 전면(Interstitial)** `showSeasonStartAd()` — "시즌 시작하기" 버튼에서. 보상 없음. 항상 resolve(reject 없음)
//     → 호출부 endSeason()이 광고 결과와 무관하게 실행(스킵·실패·오프라인·빈도캡이어도 진행 하드블록 없음). removeAds면 즉시 통과.
//   • **보상형(Rewarded)** `showRewardedForDiamonds()` — "광고 보고 +50💎". **완주(EARNED)해야만** earned:true → 호출부가 서버 지급.
//     실패/취소/미완주면 earned:false(지급·쿨다운 소모 없음 — free-faucet 차단 §3.2). removeAds여도 유지(자발적 opt-in).
//
// 원칙(리뷰 반영):
//   • **네이티브 모듈 지연 로드** — Expo Go/미설치면 admob()=null → 광고 no-op(앱은 정상, 관전·시즌 진행 무관).
//   • **__DEV__ = 구글 TestIds** — 실 광고단위로 개발 클릭 시 계정 정지(§3.2 불변식). 실ID는 운영 빌드만.
//   • **전면 하드 타임아웃 + 빈도캡** — 관전형은 시즌 연타로 광고 폭탄 위험 → N분 캡. 못 뜨면 즉시 진행.
//   • throw 없이 결과 반환. 로깅은 lib/log(운영 로그=AdMob 대시보드).

import { logError, logEvent } from './log';
import { AD_UNIT_REWARDED_ANDROID, AD_UNIT_INTERSTITIAL_ANDROID } from '../data/adConfig';

/** 선택적 네이티브 모듈 지연 로드. 미설치(Expo Go)·예외면 null(호출부 graceful). */
function admob(): any | null {
  try {
    // @ts-ignore — 운영 빌드에서 expo install. 미설치 시 throw → null.
    return require('react-native-google-mobile-ads');
  } catch {
    return null;
  }
}

const INTERSTITIAL_MIN_INTERVAL_MS = 4 * 60 * 1000; // 시즌 전면광고 빈도캡(4분) — 관전형 연타 폭탄 방지(§3.2)
const INTERSTITIAL_TIMEOUT_MS = 4000;               // 전면 로드 하드 타임아웃 — 못 뜨면 시즌 진행(오프라인·노필)
const REWARDED_TIMEOUT_MS = 10000;                  // 보상형 로드 타임아웃
let lastInterstitialAt = 0;                         // 메타(시드/결정론 무관 — UI 런타임). 앱 재시작 시 리셋(세션 캡)

// remove_ads 엔타이틀먼트 — IAP 구매/복원으로 갱신(lib/iap setRemoveAds). true면 시즌 전면광고 skip(보상형은 유지).
let removeAdsOwned = false;
export function setRemoveAds(owned: boolean): void { removeAdsOwned = owned; }
export function hasRemoveAds(): boolean { return removeAdsOwned; }

let initialized = false;
/** 앱 시작 1회 — SDK 초기화 + **UMP 동의(매 실행)**. EEA만 실제 폼 표시, 비EEA는 자동 무표시. dev/미설치 graceful(throw 없음). */
export async function initAds(): Promise<void> {
  const mod = admob();
  if (!mod) return;
  try {
    // UMP: 동의 정보 갱신 + 필요 시 폼 표시(원샷). 실패해도 광고는 비개인화로 계속.
    if (mod.AdsConsent?.gatherConsent) {
      try { await mod.AdsConsent.gatherConsent(); } catch (e) { logError('ads.consent', e); }
    }
    if (!initialized && mod.default) {
      // 테스트 광고 강제: 에뮬레이터는 자동. 실기기 테스트는 logcat의 test device ID를 아래 배열에 추가(실 광고 클릭=계정 정지 §3.2).
      try { await mod.default().setRequestConfiguration({ testDeviceIdentifiers: ['EMULATOR'] }); } catch { /* 구버전 무시 */ }
      await mod.default().initialize();
      initialized = true;
    }
  } catch (e) {
    logError('ads.initAds', e);
  }
}

/** 광고단위 ID — __DEV__은 SDK TestIds(계정 정지 방지 §3.2), 운영은 실ID. */
function unitId(mod: any, kind: 'interstitial' | 'rewarded'): string {
  if (__DEV__) return kind === 'rewarded' ? mod.TestIds.REWARDED : mod.TestIds.INTERSTITIAL;
  return kind === 'rewarded' ? AD_UNIT_REWARDED_ANDROID : AD_UNIT_INTERSTITIAL_ANDROID;
}

/**
 * "시즌 시작하기" 버튼 — 전면광고 표시 후(또는 스킵/실패/캡 즉시) resolve. **절대 reject 안 함**.
 * removeAds 소유·빈도캡·미설치·오프라인·로드실패 → 즉시 통과(하드블록 금지 — 관전형·오프라인 기둥).
 */
export async function showSeasonStartAd(): Promise<void> {
  if (removeAdsOwned) return;                                   // 광고 제거 구매자 — 즉시 통과
  const now = Date.now();
  if (now - lastInterstitialAt < INTERSTITIAL_MIN_INTERVAL_MS) { logEvent('ads:interstitial:capped'); return; } // 빈도캡
  const mod = admob();
  if (!mod) return;                                             // 미설치(Expo Go) — 통과

  try {
    const { InterstitialAd, AdEventType } = mod;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => { if (!done) { done = true; resolve(); } };
      const ad = InterstitialAd.createForAdRequest(unitId(mod, 'interstitial'));
      ad.addAdEventListener(AdEventType.LOADED, () => { ad.show().catch(finish); });
      ad.addAdEventListener(AdEventType.CLOSED, () => { lastInterstitialAt = Date.now(); finish(); }); // 닫으면 진행 + 캡 갱신
      ad.addAdEventListener(AdEventType.ERROR, finish);         // 노필·오프라인 → 즉시 진행
      ad.load();
      setTimeout(finish, INTERSTITIAL_TIMEOUT_MS);              // 하드 타임아웃 — 영영 안 뜨면 진행
    });
  } catch (e) {
    logError('ads.showSeasonStartAd', e);                      // 미설치·로드 실패 → 통과(하드블록 금지)
  }
}

export type RewardedResult =
  | { earned: true }
  | { earned: false; reason: 'unavailable' | 'no-fill' | 'dismissed' | 'error' };

/**
 * 보상형 광고 재생 — **완주(EARNED_REWARD) 시에만 earned:true**. 호출부(watchAdForDiamonds)가 그때만 서버 지급.
 * 미설치/노필/타임아웃=제안 못함, 취소=dismissed(미완주). 어느 경우도 여기선 지급 안 함(free-faucet 차단 §3.2).
 */
export async function showRewardedForDiamonds(): Promise<RewardedResult> {
  const mod = admob();
  if (!mod) return { earned: false, reason: 'unavailable' };   // 미설치 — 광고 못 봄
  try {
    const { RewardedAd, RewardedAdEventType, AdEventType } = mod;
    return await new Promise<RewardedResult>((resolve) => {
      let settled = false;
      let earned = false;
      const done = (r: RewardedResult): void => { if (!settled) { settled = true; resolve(r); } };
      const ad = RewardedAd.createForAdRequest(unitId(mod, 'rewarded'));
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => { ad.show().catch(() => done({ earned: false, reason: 'error' })); });
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; }); // 완주 — 실제 다이아는 서버가 지급
      ad.addAdEventListener(AdEventType.CLOSED, () => done(earned ? { earned: true } : { earned: false, reason: 'dismissed' }));
      ad.addAdEventListener(AdEventType.ERROR, () => done({ earned: false, reason: 'no-fill' }));
      ad.load();
      setTimeout(() => done({ earned: false, reason: 'no-fill' }), REWARDED_TIMEOUT_MS); // 로드 타임아웃
    });
  } catch (e) {
    logError('ads.showRewardedForDiamonds', e);
    return { earned: false, reason: 'error' };
  }
}
