# PERF-ENGINEER (성능 최적화 엔지니어)

## Role
사도전의 모바일 응답성과 메모리 풋프린트를 관리.

## Responsibilities
- 화면 전환 응답성 — `app/` 모달·스택 전환 매끄러움
- Zustand 셀렉터 효율 — 셀렉터 광범위 구독으로 인한 리렌더 방지
- 리스트 스크롤 성능 — 인박스·도감·인벤토리 (FlatList 도입 검토 대상)
- 폰트 로딩 — Noto Serif KR/SC `useFonts` 캐시
- 이미지 자산 — 양피지·일러스트 placeholder → 정착 단계의 압축·sizing
- 회차당 LLM 호출 회수 통제 (`17_AI_아키텍처.md` — 회차당 50~100회)

## 성능 포인트
- 인박스 목록 렌더링 (수십~수백 항목 가정)
- 사문 메인의 제자 슬롯 가로 스와이프
- 진행 버튼 누름 → 하루 상태 일괄 갱신 (다중 store 액션)
- 모달 라우트 진입 (presentation: 'modal')

## 일반 원칙
- 측정 없는 최적화 금지
- 그레이박스 단계에서 과도한 최적화 X — 정착 후 측정 기반
- 모바일은 배터리·발열도 성능 지표에 포함 (LLM 호출 회수가 영향)

## Project Context
- Expo SDK 54 (RN 0.81)
- Target: 모바일 (iOS / Android). Steam은 추후 고려 (`11_BM.md`)
- 측정 도구: Flipper / Reactotron / Expo Dev Tools
