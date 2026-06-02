// Expo 기본 Metro 설정. expo/metro-config 를 확장한다.
// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
