// 로컬 Expo config 플러그인 (MONETIZATION_SYSTEM §3.2 — AdMob 빌드 수정, 2026-07-05)
//
// 왜: react-native-google-mobile-ads 16.4.0이 끌어온 play-services-ads 25.4.0은 Kotlin 2.3.0 메타데이터로 빌드됨.
//   그런데 Expo 54 프로젝트 Kotlin은 2.1.20, 게다가 KSP는 최대 2.2.20까지만 지원 → Kotlin을 2.3.0으로 올릴 수도 없다.
//   해결: Kotlin 컴파일러에 `-Xskip-metadata-version-check`를 줘 "신버전 메타데이터 거부" 검사만 건너뛴다
//   (실제 바이트코드/ABI는 호환 — API 호출만 하므로 안전. 이 오류의 표준 우회책).
//
// 방식: 루트 build.gradle(Groovy)에 allprojects Kotlin 컴파일 태스크로 freeCompilerArgs 추가.
const { withProjectBuildGradle } = require('@expo/config-plugins');

const SNIPPET = `
// [withKotlinMetadataSkip] play-services-ads(Kotlin 2.3.0 메타) vs 프로젝트 Kotlin 2.1.x 불일치 우회(§3.2)
allprojects {
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
        compilerOptions {
            freeCompilerArgs.add("-Xskip-metadata-version-check")
        }
    }
}
`;

module.exports = function withKotlinMetadataSkip(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg; // Groovy build.gradle만
    if (cfg.modResults.contents.includes('withKotlinMetadataSkip')) return cfg; // 멱등(중복 방지)
    cfg.modResults.contents += SNIPPET;
    return cfg;
  });
};
