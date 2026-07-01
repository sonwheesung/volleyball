// Expo 기본 Metro 설정. expo/metro-config 를 확장한다.
// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// /server(백엔드 Next.js 앱)는 Metro 번들 대상이 아니다 — Metro가 루트에서 크롤하면 /server/node_modules의
// 중복 React·Haste 모듈명 충돌로 번들이 깨진다(BACKEND_SYSTEM §13.4 M1). blockList로 해석에서 제외한다.
const prev = config.resolver.blockList;
const prevList = Array.isArray(prev) ? prev : prev ? [prev] : [];
config.resolver.blockList = [...prevList, /[\\/]server[\\/].*/];

module.exports = config;
