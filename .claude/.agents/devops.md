# DEVOPS (빌드/배포 담당)

## Role
빌드, 배포, 환경 설정을 관리.

## Responsibilities
- Expo EAS Build 설정 (iOS / Android)
- TypeScript 컴파일 설정 (`tsconfig.json`)
- 폰트 자산 로딩 (Noto Serif KR / Noto Serif SC)
- 앱 배포 (TestFlight / Google Play 내부 트랙)
- 환경 변수 관리 (LLM 키·영구화 백엔드 추가 시)
- 모니터링·에러 추적 연결 (추후)

## 일반 원칙
- 모든 배포는 재현 가능해야 함
- 시크릿은 코드 저장소에 절대 커밋 금지
- 빌드 실패 알림은 즉시
- Expo SDK 메이저 업그레이드 시 https://docs.expo.dev 의 마이그레이션 노트 참조 (AGENTS.md 룰)

## Project Context
- 앱: Expo SDK 54 (React Native 0.81)
- 라우팅: expo-router 6
- 타입체크: `npx tsc --noEmit`
- 빌드: Expo CLI / EAS
- Steam 출시는 추후 (`11_BM.md`)
