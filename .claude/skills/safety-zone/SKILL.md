---
name: safety-zone
description: Wrap every page in app/ with <SafetyZone> so SafeArea edges (notch, status bar, home indicator), paper background, and edge handling stay consistent across tab/modal/stack routes. Invoke after adding new pages, when refactoring inconsistent SafeArea usage, or when the user says "세이프티 존" / "safety zone" / "모든 페이지 safe area".
---

# Safety Zone — 모든 페이지 SafeArea 래핑

Shidao 프로젝트의 페이지는 모두 `<SafetyZone>` 컴포넌트로 감싼다. SafeArea·배경색·edge 처리를 한 곳에서 관리해서 새 페이지가 들어와도 톤이 깨지지 않게 한다.

## 컴포넌트

`src/components/common/SafetyZone.tsx`

```tsx
<SafetyZone variant="tab|modal|stack" edges={...} background={...}>
  ...children...
</SafetyZone>
```

- `variant` 기본값 `"tab"`
  - `tab`: `['top', 'left', 'right']` (하단은 탭바)
  - `modal`: `['top', 'left', 'right', 'bottom']` (홈 인디케이터까지 보호)
  - `stack`: `['top', 'left', 'right']`
- `edges` 직접 지정 시 variant 무시
- `background` 기본 `colors.paper`

`ScreenStub`은 내부적으로 `SafetyZone`을 사용하므로 placeholder 페이지는 `ScreenStub`의 `variant` prop만 전달.

## 실행 절차

1. **탐색**: `Glob` `app/**/*.tsx`. `_layout.tsx`는 제외 (레이아웃 자체는 SafeArea 책임 없음).
2. **분류**: 각 파일이 어떤 라우트인지 결정.
   - `app/(tabs)/*.tsx` → `variant="tab"`
   - `app/schedule/`, `app/conversation/`, `app/event/[id].tsx` → `variant="modal"` (현재 `_layout.tsx`에서 `presentation: 'modal'`)
   - `app/disciple/[id].tsx`, 그 외 stack 라우트 → `variant="stack"` (또는 기본값)
   - 다른 모달 추가 시 `app/_layout.tsx`의 `presentation` 옵션을 기준으로 판단.
3. **점검**: 페이지 루트 JSX가 다음 중 하나인지 확인.
   - `<SafetyZone ...>` 직접 사용 ✓
   - `<ScreenStub variant="...">` 사용 ✓ (변형 누락 시 추가)
   - `<View>`, `<SafeAreaView>`, 기타 직접 사용 ✗ → 리팩토링.
4. **리팩토링** (필요 시):
   - 루트의 `<SafeAreaView edges={...} style={{ flex:1, backgroundColor: ... }}>`를 `<SafetyZone variant="...">`로 교체.
   - `import { SafeAreaView } from 'react-native-safe-area-context';` 제거 (다른 곳에서 사용 안 하면).
   - 루트 `View`에 직접 `flex:1`, `backgroundColor: colors.paper` 둔 경우 SafetyZone으로 흡수.
   - 자식 컴포넌트의 SafetyZone 중첩 금지 — 한 페이지에 SafetyZone 하나만.
5. **검증**: `npx tsc --noEmit` 0 오류 확인.
6. **보고**: 어떤 파일을 어떤 variant로 정리했는지 표로 한 줄씩.

## Edge 결정 가이드 (예외)

- 화면 전체를 이미지가 채우는 경우 (hero 배경이 status bar 뒤까지 보여야 할 때): SafetyZone 안에 두지 말고 별도로 절대 위치, 그 위에 SafetyZone으로 콘텐츠 감싸기.
- 키보드 입력 화면: SafetyZone 안에 `KeyboardAvoidingView`를 둠 (반대 아님).
- ScrollView 페이지: SafetyZone 안에 ScrollView. ScrollView가 직접 SafeArea 처리하지 않도록.

## 하지 말 것

- `<SafeAreaView>` (react-native 내장)는 사용 금지. 반드시 `react-native-safe-area-context`. 단, `SafetyZone`이 이미 그것을 쓰므로 페이지에서 직접 import할 필요 없음.
- `useSafeAreaInsets()`를 페이지에서 직접 호출해 padding 계산하지 말 것 — 레이아웃 외 특수 케이스에서만.
- `edges`를 라우트 성격과 다르게 지정하지 말 것. modal에서 `bottom`을 빼면 홈 인디케이터 충돌.
