// 광고 추상화 (MONETIZATION_SYSTEM §3) — 앱의 유일한 광고 연결점.
//
// ★ 현재: AdMob은 **네이티브 모듈이라 Expo Go에서 못 돈다.** 그래서 지금은 **스텁**(즉시 resolve, 광고 없음).
//   게임 흐름은 완성돼 있고("시즌 시작하기" 버튼 → showSeasonStartAd() → endSeason()), 광고만 안 뜬다.
//
// ★ 활성화(P2 — EAS 개발 빌드 후): 아래 3단계만 하면 켜진다(호출부는 안 건드림).
//   1) `npx expo install react-native-google-mobile-ads` + app.json에 config plugin(앱ID) 추가.
//   2) EAS 개발 빌드(`eas build --profile development`) — Expo Go 아님.
//   3) 아래 `showSeasonStartAd`의 "=== P2 ===" 블록 주석을 실제 SDK 코드로 교체 + AD_UNIT_ID 실값.
//
// 원칙(MONETIZATION_SYSTEM): 오프라인·로드 실패면 **즉시 resolve(진행 하드블록 금지)** · removeAds 소유면 skip ·
//   보상형 동영상이라도 스킵/실패로 시즌이 안 열리면 안 됨(관전형·오프라인 기둥).

// remove_ads 엔타이틀먼트 — P2에서 IAP 복원/구매로 갱신(setRemoveAds). true면 모든 광고 skip.
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
 * 항상 resolve(절대 reject 안 함) → 호출부의 endSeason()이 광고 결과와 무관하게 실행된다(하드블록 금지).
 * 첫 시즌은 endSeason 자체가 없어(팀 선택에서 시작) 자연히 광고 없음 — "첫 시즌 제외"가 구조적으로 성립.
 */
export async function showSeasonStartAd(): Promise<void> {
  if (removeAdsOwned) return; // 광고 제거 구매자 — 즉시 통과

  // === P2: AdMob 연결 지점 (react-native-google-mobile-ads) ===
  // try {
  //   const { RewardedAd, RewardedAdEventType, AdEventType, TestIds } = require('react-native-google-mobile-ads');
  //   const unitId = __DEV__ ? TestIds.REWARDED : AD_UNIT_SEASON_START; // 실 광고 단위 ID로 교체
  //   await new Promise<void>((resolve) => {
  //     const ad = RewardedAd.createForAdRequest(unitId);
  //     let done = false;
  //     const finish = () => { if (!done) { done = true; resolve(); } };
  //     ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show().catch(finish));
  //     ad.addAdEventListener(AdEventType.CLOSED, finish);
  //     ad.addAdEventListener(AdEventType.ERROR, finish); // 오프라인·로드 실패 → 즉시 진행(하드블록 금지)
  //     ad.load();
  //     setTimeout(finish, 8000); // 안전 타임아웃 — 광고가 영영 안 뜨면 진행
  //   });
  // } catch { /* 모듈 없음(Expo Go) 등 — 그냥 통과 */ }
  // === 현재: Expo Go 스텁 — no-op(즉시 통과) ===
  return;
}
