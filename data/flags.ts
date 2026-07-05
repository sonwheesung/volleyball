// 빌드/노출 플래그 — 개발용 도구를 실전(배포)에서 숨긴다.
// DEV_TOOLS=false 이면: 테스트 경기·보드 위치 검증·영입 무결성 감사 화면/버튼이 전부 비활성.
//   버튼은 렌더 안 하고, 화면에 직접 진입(딥링크)해도 홈으로 리다이렉트한다.
//
// __DEV__ 에 묶되 **수동 토글(SHOW_DEV_TOOLS)** 로 dev 모드에서도 숨길 수 있게 분리:
//   · 프로덕션 빌드(EAS release) → __DEV__=false → 항상 숨김(깜빡 잊을 일 없음).
//   · 개발 중 "운영 화면처럼 보고 싶다"(테스트 화면 숨김) + Fast Refresh(즉시 반영) 둘 다 원하면
//     SHOW_DEV_TOOLS=false 로 두고 **dev 모드(expo start)** 로 띄운다 — 운영 모드(--no-dev)는
//     Fast Refresh가 없어 변경이 폰에 안 붙는다(번들 캐시 정체). 도구를 다시 쓰려면 true로.
const SHOW_DEV_TOOLS = false; // ← 개발 도구 노출 토글(운영 확인 중엔 false)
export const DEV_TOOLS = __DEV__ && SHOW_DEV_TOOLS;

// 기능 노출 플래그 — 아직 안 만든 기능을 상점/메뉴에서 숨긴다(팔지 않는다).
//   월드컵 DLC(WORLDCUP_SYSTEM)는 설계만 있고 미구현(P0~P1 계획) → 구현 완료 시 true로.
export const WORLDCUP_ENABLED = false;
