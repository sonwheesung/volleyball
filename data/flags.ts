// 빌드/노출 플래그 — 개발용 도구를 실전(배포)에서 숨긴다.
// DEV_TOOLS=false 이면: 테스트 경기·보드 위치 검증·영입 무결성 감사 화면/버튼이 전부 비활성.
//   버튼은 렌더 안 하고, 화면에 직접 진입(딥링크)해도 홈으로 리다이렉트한다.
//
// __DEV__ 에 묶되 **수동 토글(SHOW_DEV_TOOLS)** 로 dev 모드에서도 숨길 수 있게 분리:
//   · 프로덕션 빌드(EAS release) → __DEV__=false → 항상 숨김(깜빡 잊을 일 없음).
//   · 개발 중 "운영 화면처럼 보고 싶다"(테스트 화면 숨김) + Fast Refresh(즉시 반영) 둘 다 원하면
//     SHOW_DEV_TOOLS=false 로 두고 **dev 모드(expo start)** 로 띄운다 — 운영 모드(--no-dev)는
//     Fast Refresh가 없어 변경이 폰에 안 붙는다(번들 캐시 정체). 도구를 다시 쓰려면 true로.
const SHOW_DEV_TOOLS = true; // ← 개발 도구 노출 토글(dev에서 마이페이지 초기화·+1000💎 등 노출. 운영처럼 미리보려면 false)
export const DEV_TOOLS = __DEV__ && SHOW_DEV_TOOLS;

// 기능 노출 플래그 — 아직 안 만든 기능을 상점/메뉴에서 숨긴다(팔지 않는다).
//   월드컵 DLC(WORLDCUP_SYSTEM)는 설계만 있고 미구현(P0~P1 계획) → 구현 완료 시 true로.
export const WORLDCUP_ENABLED = false;

// 출석 패스·월 1+1 노출 플래그(ATTENDANCE_PASS_SYSTEM §7 출시 게이팅 — WORLDCUP_ENABLED 패턴).
//   · ATTENDANCE_PASS_ENABLED: 상점 패스 카드·마이페이지 수령 현황·포그라운드 자동 수령 배선을 노출.
//   · PROMO_1P1_ENABLED: 팩 카드 "이번 달 1+1" 뱃지를 노출(실 가용 여부는 서버 파생 bonus1p1Available가 최종 게이트).
// 기본 **__DEV__만 true** — diamond_pass 스토어/RC 등록·샌드박스 실결제 완료(Phase ③ #43) 전엔 운영에서 false.
//   false면 패스 카드·뱃지를 렌더하지 않아 기존 상점과 **바이트 동일 동작**(추가 노출 0).
export const ATTENDANCE_PASS_ENABLED = __DEV__;
export const PROMO_1P1_ENABLED = __DEV__;
