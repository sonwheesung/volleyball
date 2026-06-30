// 광고 추상화 (MONETIZATION_SYSTEM §3) — 앱의 유일한 광고 연결점.
//
// 환경 분기(사용자 결정 2026-06-30):
//   • 개발 환경(__DEV__: Expo Go·dev 빌드) — 실제 광고 대신 **"광고 출력" 알림**으로 게이트 흐름만 확인.
//   • 운영 환경(production 빌드) — **실제 AdMob 동영상**(react-native-google-mobile-ads, 지연 require).
//
// 운영 활성화(P0/P2): ① `npx expo install react-native-google-mobile-ads` + app.json config plugin(AdMob 앱ID)
//   ② EAS production 빌드 ③ AD_UNIT_SEASON_START를 실 광고단위 ID로 교체. 호출부는 안 건드린다.
//   패키지 미설치·오프라인·로드 실패면 catch로 **즉시 통과(진행 하드블록 금지)** — 운영에서도 광고 없이 시즌은 시작된다.
//
// 원칙(MONETIZATION_SYSTEM): 항상 resolve(reject 없음) · removeAds 소유면 skip · 스킵/실패/오프라인이어도
//   시즌이 안 열리면 안 됨(관전형·오프라인 기둥). 첫 시즌은 endSeason 자체가 없어 자연 제외.

import { Alert } from 'react-native';
import { logError } from './log';

// 실 광고단위 ID — 운영 빌드 전 AdMob 콘솔에서 발급받아 교체(TODO). 비면 로드 실패 → 통과.
const AD_UNIT_SEASON_START = '';

// remove_ads 엔타이틀먼트 — P2에서 IAP 구매/복원으로 갱신(setRemoveAds). true면 모든 광고 skip.
let removeAdsOwned = false;
/** P2: 엔타이틀먼트 로드/구매/복원 시 호출해 광고 표시를 끈다. */
export function setRemoveAds(owned: boolean): void {
  removeAdsOwned = owned;
}
export function hasRemoveAds(): boolean {
  return removeAdsOwned;
}

/**
 * "시즌 시작하기" 버튼에서 호출 — 동영상 광고를 보여주고 끝나면(또는 스킵/실패 시 즉시) resolve.
 * 항상 resolve(절대 reject 안 함) → 호출부의 endSeason()이 광고 결과와 무관하게 실행(하드블록 금지).
 */
export async function showSeasonStartAd(): Promise<void> {
  if (removeAdsOwned) return; // 광고 제거 구매자 — 즉시 통과

  // ── 개발 환경: "광고 출력" 알림(실제 광고 대신 — 게이트 흐름 확인용) ──
  if (__DEV__) {
    await new Promise<void>((resolve) => {
      Alert.alert(
        '동영상 광고',
        '광고 출력 (개발 환경)\n운영 빌드에선 실제 AdMob 동영상이 재생됩니다.',
        [{ text: '확인', onPress: () => resolve() }],
        { onDismiss: () => resolve() },
      );
    });
    return;
  }

  // ── 운영 환경: 실제 AdMob 보상형 동영상(지연 require — 미설치/Expo Go면 catch로 통과) ──
  try {
    // @ts-ignore — 선택적 네이티브 모듈(운영 빌드에서 expo install). 미설치 시 throw → catch에서 통과.
    const ads = require('react-native-google-mobile-ads');
    const { RewardedAd, RewardedAdEventType, AdEventType } = ads;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => { if (!done) { done = true; resolve(); } };
      const ad = RewardedAd.createForAdRequest(AD_UNIT_SEASON_START);
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => { ad.show().catch(finish); });
      ad.addAdEventListener(AdEventType.CLOSED, finish); // 광고 닫으면(스킵 포함) 진행 — 비징벌
      ad.addAdEventListener(AdEventType.ERROR, finish);  // 오프라인·로드 실패 → 즉시 진행(하드블록 금지)
      ad.load();
      setTimeout(finish, 8000); // 안전 타임아웃 — 광고가 영영 안 뜨면 진행
    });
  } catch (e) {
    logError('ads.showSeasonStartAd', e); // 모듈 미설치(Expo Go 등)·로드 실패 → 통과(하드블록 금지)
  }
}
