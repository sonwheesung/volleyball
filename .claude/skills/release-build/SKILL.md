---
name: release-build
description: 안드로이드 릴리즈 산출물(AAB 로컬 그래들 빌드)과 OTA 업데이트(expo-updates) 절차 — runtimeVersion 규율·키스토어 보호·stale 번들 함정 포함. "릴리즈 빌드", "AAB 만들어줘", "스토어 올릴 빌드", "OTA 배포", "업데이트 푸시" 요청 시 호출. 정본은 ota-fingerprint-drift-trap 메모리 + eas.json/app.json — 이 스킬은 그 실행 절차화.
---

# release-build — 안드로이드 릴리즈 빌드 · OTA 규율

> **왜**: 릴리즈 산출물은 실수가 유저 기기로 나간다. 이 프로젝트의 확정 체제(2026-07 결정):
> **runtimeVersion 고정 문자열 + 네이티브 변경 시에만 수동 범프**(~~1.0.0~~ → 현재 1.1.0, 2026-07-16 결제 SDK 범프 — 현재값은 app.json이 정본), **AAB는 로컬 그래들 빌드**(EAS 클라우드 아님),
> **OTA는 `expo update -p android`**. 키스토어(credentials/)는 분실 시 스토어 업데이트 영구 불가.

## 판별 먼저 — OTA로 되나, 재빌드가 필요한가

| 변경 내용 | 배포 수단 |
|---|---|
| JS/TS·자산(이미지·오디오)만 | **OTA** (`expo update`) — 스토어 심사 불요 |
| 네이티브 모듈 추가/업그레이드·app.json 네이티브 설정(권한·플러그인)·expo SDK 업그레이드 | **재빌드 + runtimeVersion 범프 + 스토어 업로드** |

- 애매하면 `npx expo-doctor` + 변경 diff에서 `android/`·plugins·dependencies(네이티브 포함) 여부로 판정.
- **runtimeVersion을 안 올리고 네이티브를 바꾸면**: 구 바이너리에 신 JS가 OTA로 내려가 크래시. **범프 시엔 반드시 재빌드+스토어 업로드가 선행**.

## A. OTA 업데이트

```bash
cd /c/project/volleyball
npx tsc --noEmit && npm test                      # 최소 게이트(전체 배터리는 run-all-tests)
npx expo export --platform android                # 번들 성립 확인(끝나면 dist 삭제)
npx eas update -p android --channel <채널> -m "<YYMMDD :: 요약>"
```
- 채널은 eas.json의 build 채널과 일치(production 빌드=production 채널). 배포 후 실기기에서 **앱 완전 종료→재시작 2회**(1회차 다운로드, 2회차 적용) 확인.
- **"게시 성공 ≠ 전달" 함정(2026-07-17 발견, vc13·14 이틀 잠복)**: `eas update` exit 0은 **서버 게시**만 뜻한다 — 바이너리가 채널 헤더를 안 보내면 매핑이 있어도 기기가 못 받는다(게시측에선 그 부재가 안 보임). **로컬 그래들 빌드는 `eas.json build.channel`이 미적용**(EAS Build 전용). 채널은 반드시 app.json `updates.requestHeaders["expo-channel-name"]` → 매니페스트 `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY` 메타데이터로 **바이너리에 박혀야** 하고, `_dv_appconfig` ⓕⓖ가 app.json↔eas↔매니페스트 채널 정합을 상시 대조한다. 배포 후엔 **실기기 마커**(눈에 보이는 변경 문구)로 실제 전달을 확인 — 게시 exit 0을 전달로 오인 금지.
- **stale 번들 함정**: 기기 화면이 구버전으로 보이면 코드가 아니라 번들이 낡은 것 — force-relaunch로 확정 후 판단(emulator-stale-bundle-trap 메모리).

## B. AAB 로컬 그래들 빌드

```bash
cd /c/project/volleyball
# (네이티브 설정 변경이 있었으면) npx expo prebuild -p android --clean  ← android/ 재생성. 수동 패치가 android/에 있으면 clean 전 diff 확인!
cd android && ./gradlew bundleRelease             # 산출: android/app/build/outputs/bundle/release/app-release.aab
```
- **키스토어**: 서명 설정은 `credentials/` 의 업로드 키스토어 — **절대 삭제·분실 금지**(백업 위치 확인). gradle이 참조하는 경로/비밀번호가 살아 있는지 빌드 전 확인.
- **버전**: app.json `version`(사용자 표시)과 android versionCode(스토어는 매 업로드 증가 필수 — appVersionSource local)를 확인·범프.
- runtimeVersion을 범프했으면 app.json과 OTA 채널 정책을 함께 갱신.
- **OTA 채널 헤더(로컬 그래들 필수)**: 로컬 빌드는 `eas.json build.channel`을 **적용하지 않으므로**, 바이너리가 OTA 채널을 서버에 보내려면 app.json `updates.requestHeaders["expo-channel-name"]`가 있어야 하고, prebuild 산출물(`android/app/src/main/AndroidManifest.xml`)에 `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY` 메타데이터로 박혀야 한다. 빌드 전 `npx tsx tools/_dv_appconfig.ts`로 채널·runtimeVersion 정합(ⓕⓖⓗ)을 확인.

## C. 업로드 전 스모크 (릴리즈 바이너리 특성 — dev와 다름)

1. AAB에서 유니버설 APK 추출(bundletool) 또는 내부 테스트 트랙 업로드 후 실기기 설치.
2. 체크: 부팅 게이트(로그인·공지)·경기 관전 1경기·다이아 잔액 표시·광고(실 SDK 경로)·**성능(#84 체크리스트 — 릴리즈에서만 유효한 측정)**.
3. `__DEV__` 게이트 화면(감사·실험실·테스트경기)이 **안 보이는지** 확인(DEV_TOOLS 자동 숨김).

## 금지·주의

- 검증 안 된 커밋으로 빌드 금지(run-all-tests 그린 + 락 없는 상태).
- 키스토어·시크릿을 출력/로그에 노출 금지.
- prebuild --clean은 android/ 수동 패치를 지운다 — clean 전 `git status android/` 확인.
