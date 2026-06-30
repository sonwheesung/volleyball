// 디바운스 영속 스토리지 (A6 성능 — 2026-07-01) — zustand persist의 쓰기 폭주를 합친다.
//
// 문제: persist는 매 set()마다 partialize → JSON.stringify(전체 세이브: results·simCache·playerBase·archive…)
//   → AsyncStorage.setItem 을 동기로 돌린다. 시즌이 쌓이면 이 직렬화+쓰기가 커져, 트라이아웃 위시 토글처럼
//   연속 set이 일어나는 화면에서 매 탭이 수초씩 멈췄다(실기기 5~10초 — A6). 계산(오프시즌 재생)은 ~100ms로 평탄,
//   범인은 영속 쓰기였다.
//
// 해결: 직렬화+쓰기를 디바운스로 **합쳐** 연타가 멈춘 뒤 한 번만 수행. **저장 내용은 그대로**(무엇을 저장하는지
//   안 바뀜 → 세이브/결정론 불변). 마지막 상태만 보관(이전 대기분 덮어씀). 앱이 백그라운드로 가면 즉시 flush해
//   미저장 손실 방지. 크래시가 디바운스 창(기본 500ms) 안에 나도 잃는 건 마지막 변화뿐이고 결정론이라 재계산 가능.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

const WRITE_DEBOUNCE_MS = 500;

export function debouncedAsyncStorage<S>(debounceMs = WRITE_DEBOUNCE_MS): PersistStorage<S> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: StorageValue<S> } | null = null;

  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    try {
      // 직렬화+쓰기를 여기서 한 번에(연타 시 1회만 — createJSONStorage가 매번 하던 걸 합침).
      void AsyncStorage.setItem(name, JSON.stringify(value));
    } catch { /* 영속 실패는 진행을 막지 않음(결정론 — 재계산 가능) */ }
  };

  // 앱이 비활성(백그라운드/종료 전환)되면 대기분 즉시 저장.
  AppState.addEventListener('change', (st) => { if (st !== 'active') flush(); });

  return {
    getItem: async (name) => {
      const s = await AsyncStorage.getItem(name);
      return s ? (JSON.parse(s) as StorageValue<S>) : null;
    },
    setItem: (name, value) => {
      pending = { name, value };              // 최신만 보관
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);  // 연타가 멈춘 뒤 한 번만 직렬화+쓰기
    },
    removeItem: (name) => {
      pending = null;
      if (timer) { clearTimeout(timer); timer = null; }
      return AsyncStorage.removeItem(name);
    },
  };
}
