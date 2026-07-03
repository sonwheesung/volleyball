// 서버 부팅 설정 캐시 (BACKEND_SYSTEM §13.16) — BootGate가 받은 bootstrap을 여기 넣어 배너 등이 재조회 없이 읽는다.
// 비영속(런타임 캐시) — 진실은 서버 bootstrap. 소프트 업데이트 배너·향후 공지 위젯이 공유.
import { create } from 'zustand';
import type { BootstrapData } from '../lib/server';

interface ServerConfigState {
  boot: BootstrapData | null;
  setBoot: (b: BootstrapData | null) => void;
}

export const useServerConfig = create<ServerConfigState>((set) => ({
  boot: null,
  setBoot: (boot) => set({ boot }),
}));
