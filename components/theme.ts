// 테마 시스템 (다크/라이트 토글, 2026-07-01) — UI_RULES 참조.
//   RN StyleSheet.create는 로드 시 색을 박제하므로, 테마 색을 쓰는 StyleSheet는 컴포넌트에서
//   useThemedStyles(makeStyles)로 "렌더 시" 생성해야 토글·콜드부팅에서 올바르게 반영된다.
//   theme 객체는 **동일 identity 유지 + 값만 Object.assign**(인라인 theme.x 사용처는 리렌더로 자동 반영).
//   전환은 인스턴트(리로드 없음). 콜드부팅 시 기본(다크)→저장모드 적용 사이 순간은 스플래시가 가린다.
import { useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'dark' | 'light';
const STORAGE_KEY = 'themeMode';

// 공통 색(모드 무관) — 카테고리/상태 색은 두 모드에서 동일 유지(v1). 필요 시 모드별 분리 가능.
const SHARED = {
  accent: '#19C2AE', good: '#2BD17E', warn: '#F2A93B', bad: '#FF6B5A', elite: '#5B9BFF',
  accentGlass: 'rgba(25,194,174,0.16)', gold: '#E8C46A', violet: '#9B7BFF', sky: '#46C8FF', rose: '#FF7BA6',
};

// 다크 = 변경 전(원본) · 라이트 = 밝은 코트 테스트본
const DARK = {
  bg: '#0B1018', card: 'rgba(16,22,34,0.86)', cardAlt: 'rgba(40,50,68,0.92)',
  text: '#F2F5FA', muted: '#9AA7BC', mutedBright: '#B4BFCE', border: 'rgba(255,255,255,0.14)',
  tabBar: '#0E1521', popup: '#161E2E', ...SHARED, // popup=불투명 팝업 표면(반투명 card는 배경에 묻힘). 탭바 솔리드 — 모드별(UI-25). mutedBright=muted보다 한 톤 밝은 회색(선수 메타 등)
};
const LIGHT = {
  bg: '#EAF0F6', card: 'rgba(255,255,255,0.93)', cardAlt: 'rgba(228,235,244,0.92)',
  text: '#16202C', muted: '#5A6678', mutedBright: '#6E7A8C', border: 'rgba(0,0,0,0.12)',
  tabBar: '#FFFFFF', popup: '#FFFFFF', ...SHARED, // popup 밝은 표면 — 라이트 모드에서 다크 팝업+검정 텍스트(안 보임) 버그 교정(2026-07-04)
};

// 모드별 배경 이미지·스크림 (Screen이 렌더 시 읽음)
export const BG_DARK = require('../assets/bg/court.png');
export const BG_LIGHT = require('../assets/bg/court-bright.png');
const ASSETS = {
  dark: { bg: BG_DARK, scrim: 'rgba(7,10,16,0.62)' },
  light: { bg: BG_LIGHT, scrim: 'rgba(236,241,247,0.72)' },
};

// 활성 theme — identity 고정, 값만 교체. 기본 다크.
export const theme = { ...DARK };
export let themeMode: ThemeMode = 'dark';
export let themeAssets = ASSETS.dark;

// 버전 구독(useSyncExternalStore) — 토글 시 useThemedStyles/Screen이 리렌더
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getVersion = () => version;

// StyleSheet 재빌더 — themedStyles로 감싼 스타일들을 모드 변경 때 다시 만든다(박제 해제).
const rebuilders: Array<() => void> = [];

/** 테마 색 StyleSheet를 감싼다 — 프록시가 항상 "현재 테마로 만든" 스타일을 반환.
 *  사용: `const styles = themedStyles(() => StyleSheet.create({...theme...}))`. 사용처(styles.x)는 그대로.
 *  모드 변경 시 재빌드되고, 루트 리마운트로 전 화면이 새 스타일로 리렌더된다(App _layout key). */
export function themedStyles<T extends object>(make: () => T): T {
  let cur = make();
  rebuilders.push(() => { cur = make(); });
  return new Proxy({} as T, {
    get: (_t, key) => (cur as Record<string | symbol, unknown>)[key],
    has: (_t, key) => key in (cur as object),
    ownKeys: () => Reflect.ownKeys(cur as object),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}

/** 모드 적용(값 교체 + 스타일 재빌드 + 리렌더 신호). 저장은 별도(setThemeMode). */
function applyMode(m: ThemeMode): void {
  Object.assign(theme, m === 'light' ? LIGHT : DARK);
  themeMode = m;
  themeAssets = ASSETS[m];
  rebuilders.forEach((r) => r());
  version++;
  listeners.forEach((l) => l());
}

/** 토글/설정 — 적용 + AsyncStorage 저장(다음 콜드부팅 반영). 인스턴트. */
export function setThemeMode(m: ThemeMode): void {
  applyMode(m);
  AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
}

/** 앱 시작 시 저장 모드 로드·적용(_layout에서 1회 호출). */
export async function loadThemeMode(): Promise<void> {
  try { const m = await AsyncStorage.getItem(STORAGE_KEY); if (m === 'light' || m === 'dark') applyMode(m); } catch { /* 기본 다크 */ }
}

/** 현재 모드 구독 훅 — 토글 시 리렌더. */
export function useThemeMode(): ThemeMode {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return themeMode;
}

/** 테마 색을 쓰는 StyleSheet는 이걸로 — 렌더 시 makeStyles()를 호출해 현재 theme 반영(토글·부팅 정확). */
export function useThemedStyles<T>(makeStyles: () => T): T {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  return useMemo(() => makeStyles(), [v]); // eslint-disable-line react-hooks/exhaustive-deps
}
