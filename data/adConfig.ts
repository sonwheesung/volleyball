// AdMob 광고단위 ID (MONETIZATION_SYSTEM §3.2) — **공개값**(커밋 OK, 비밀 아님). AdMob 콘솔 발급.
//   앱 ID는 app.json 플러그인(androidAppId)에. 여기는 광고단위 ID(런타임 로드용).
//   ⚠ __DEV__ 선택(TestIds vs 실ID)은 `lib/ads.ts`에서 — 실 광고단위로 개발 중 클릭하면 계정 정지(§3.2 불변식).
//   따라서 이 파일은 **운영 실ID만** 보관하고, dev 분기는 ads.ts가 SDK의 TestIds로 처리한다.

// 앱 ID(참고 — 실제 적용은 app.json `react-native-google-mobile-ads.androidAppId`)
export const ADMOB_APP_ID_ANDROID = 'ca-app-pub-2731473780180274~2622190257';

// 보상형(rewarded_diamonds) — "광고 보고 +50💎"
export const AD_UNIT_REWARDED_ANDROID = 'ca-app-pub-2731473780180274/6184206919';

// 전면(interstitial_season) — "시즌 시작하기" 광고
export const AD_UNIT_INTERSTITIAL_ANDROID = 'ca-app-pub-2731473780180274/4947146860';
