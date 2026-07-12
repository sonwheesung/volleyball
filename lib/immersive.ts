// 시스템 내비게이션 바 표시 — 안드로이드 하단 3버튼/제스처 바를 항상 보이게 유지한다.
// (2026-07-12 정정: 이전엔 몰입 모드로 숨겼으나, 내비게이션 접근성 위해 표시로 전환 — 사용자 요청.)
//
// AppState 'active' 복귀·화면 전환 후 시스템/타 코드가 상태를 바꿀 수 있어 재적용(reassert)한다.
import { Platform, AppState } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';

let installed = false;

async function apply(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    // 바를 항상 표시하고, 콘텐츠를 밀어내는 기본(inset) 동작으로 둔다.
    await NavigationBar.setBehaviorAsync('inset-swipe');
    await NavigationBar.setVisibilityAsync('visible');
  } catch {
    // 일부 기기/에뮬에서 edge-to-edge 조합에 따라 throw할 수 있음 — 부가 처리라 조용히 무시.
  }
}

/** 앱 시작 1회 — 내비바 표시 적용 + 포그라운드 복귀 시 재적용(시스템이 상태를 바꿀 수 있으므로). */
export function installImmersive(): void {
  if (installed || Platform.OS !== 'android') return;
  installed = true;
  void apply();
  AppState.addEventListener('change', (st) => { if (st === 'active') void apply(); });
}

/** 화면 포커스 전환 등에서 다시 표시를 확정하고 싶을 때 수동 호출. */
export function reassertImmersive(): void {
  void apply();
}
