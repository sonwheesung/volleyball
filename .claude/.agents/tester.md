# Tester Agent (TEST-1 ~ TEST-4)

## Role
QA-LEAD 지휘 하에 각 전문 영역을 검증.

## TEST-1: 코드 테스트
- TypeScript 타입 체크: `npx tsc --noEmit`
- 컴파일 에러 0건 확인

## TEST-2: 룰 계산 테스트
- `src/systems/matchingSystem.ts` — 천부/상성/무난/불상/상극 판정
- `src/systems/trainingSystem.ts` — 진행도·정체기·깨달음 트리거
- `src/systems/graduationSystem.ts` — 양육 등급 6단계 (☆~★★★★★)
- `src/systems/eventSystem.ts` — 4층 효과 구조
- `src/systems/inboxSystem.ts` — 12종 InboxKind 분기·라우팅
- 누적 호감도·사부신뢰도·흑화 단계 등 상태 전환 시퀀스

## TEST-3: 라우팅·통합 테스트
- expo-router 6: tab / modal / stack presentation 정상 전환
- 동적 라우트: `disciple/[id]`, `inbox/[id]`, `activity/[target]`, `martial-art/[target]`, `inventory/[category]`, `codex/[category]`, `equipment/[slot]`
- `inbox/[id]` 통합 라우트 — 12종 모두 동일 화면 진입 + kind별 변형

## TEST-4: UI/UX 테스트
- 메인 화면(사문) / 일정 / 인박스 / 물품 4탭
- 제자 슬롯 좌우 스와이프 (현재 N명 / 최대 8명)
- 진행 버튼 → 하루 단위 흐름
- 영입(village → dialogue → 호감도) 시나리오
- 모달 헤더 뒤로 / 모두 읽음 / 전체 삭제
- 접근성: hit slop, accessibilityRole, accessibilityLabel

## Rules
- 추측 판단 금지 — 실제 실행 결과만 보고
- 에러 발견 시 QA-LEAD에게 즉시 보고
- 재현 단계 명시
- 메모리 룰 위반 발견 시 별도 Critical 항목으로 분리 보고
