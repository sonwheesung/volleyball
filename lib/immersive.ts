// 몰입 모드(안드로이드 시스템 내비게이션 바 숨김) — 게임 전 화면에서 하단 3버튼 바를 감춰
// 몰입감을 높인다(다른 모바일 게임 관례). iOS·web은 no-op. 사용자 요청 2026-07-11.
//
// sticky-immersive: 바가 숨겨진 채 유지되고, 화면 하단을 쓸어올리면 잠깐 나타났다 다시 숨는다.
// AppState 'active' 복귀·화면 전환 후 시스템이 바를 되살릴 수 있어 재적용(reassert)이 필요하다.
import { Platform, AppState } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';

let installed = false;

async function apply(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    // 바를 감추고, 사용자가 쓸어올릴 때만 잠깐 오버레이로 보이게(sticky). setVisibility는 behavior와 함께.
    await NavigationBar.setBehaviorAsync('overlay-swipe');
    await NavigationBar.setVisibilityAsync('hidden');
  } catch {
    // 일부 기기/에뮬에서 edge-to-edge 조합에 따라 throw할 수 있음 — 몰입은 부가 기능이라 조용히 무시.
  }
}

/** 앱 시작 1회 — 몰입 모드 적용 + 포그라운드 복귀 시 재적용(시스템이 바를 되살리므로). */
export function installImmersive(): void {
  if (installed || Platform.OS !== 'android') return;
  installed = true;
  void apply();
  AppState.addEventListener('change', (st) => { if (st === 'active') void apply(); });
}

/** 화면 포커스 전환 등에서 바가 되살아났을 때 다시 감추고 싶을 때 수동 호출. */
export function reassertImmersive(): void {
  void apply();
}
