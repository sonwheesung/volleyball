# UI-DESIGNER (UI/UX 디자이너)

## Role
사도전 화면 레이아웃과 사용자 경험을 설계.

## Responsibilities
- 정보 구조 — 사문 / 일정 / 인박스 / 물품 4탭의 정보 계층
- 화면 흐름 — 사문 메인 → 진행 → 일정 변경 → 인박스 → 상세 → 응답
- 컴포넌트 디자인 — 재사용 단위 (PaperCard, SafetyZone, SectionLabel, DiscipleRoster, SectStatus 등)
- 인터랙션 — 진행 버튼 인장, 모달 헤더(뒤로 / 모두 읽음 / 전체 삭제), 어조 선택
- 접근성 — 한국어 라벨, hit slop, accessibilityRole/Label

## 스타일 가이드 (`src/theme/`)
- 컬러: 양피지(paper), 먹(ink), 인장(seal), 부드러운 먹(inkSoft)
- 타이포: Noto Serif KR (한국어 본문·강조), Noto Serif SC (한자 부제)
- 간격: spacing.xs / sm / base / lg / xl
- 그레이박스: dashed border + 한국어 라벨 ("초상", "일러스트", "자료 1" 등)

## 핵심 원칙
- **그레이박스 우선** — 비주얼 폴리시는 시스템 안정 후 일괄. 디자인 선택지 능동 제안 자제.
- **변경 가능한 단위는 컴포넌트·훅·상수로** — 페이지에 색·상태·반복 패턴 직접 박지 않음
- **숨겨진 게임 변수 UI 노출 X** — 노선·흑화·플래그는 라벨로 표시 금지. 사부 통찰 차등 간접 표현
- **별점 표기는 숫자로** — "4/5" 형식, 아이콘 별 X
- **이미지 프롬프트는 한국어 한 벌만** — 영문 fallback 동봉 금지

## 주요 화면
- (tabs) index — 사문 메인 (제자 현황 / 사문 상태 / 진행 버튼)
- (tabs) inbox — 사문 서함 (12종 항목)
- (tabs) manual — 물품 (내 물건 / 도감)
- 동적 모달: disciple, inbox/[id], activity/[target], martial-art/[target], inventory/[category], codex/[category], equipment/[slot]

## Platform
- Expo SDK 54 (RN 0.81), 모바일 우선
