// 인증 세션 스토어 (AUTH_SYSTEM §3) — 게임 스토어와 분리(SOLID 단일책임).
// 진실=서버. 여기 session은 "로그인 상태 + Bearer 캐시"일 뿐. 재화는 서버가 검증([[server-authoritative-currency]]).
// 캐시 세션 있으면 재수화 시 Bearer 재주입 → 오프라인 진입 허용(하드 벽은 세션 없을 때만).
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { login as serverLogin, setServerToken } from '../lib/server';

export interface Session {
  userId: string;
  provider: string; // google | apple | dev
  displayName: string | null;
  token: string; // 자체 Bearer(HS256). 서버가 발급, 여기 캐시.
}
export type SignInResult = { ok: true } | { ok: false; reason: 'offline' | 'error' };

interface AuthState {
  session: Session | null;
  deviceId: string | null; // 스텁 providerId(기기 안정). EAS에선 실제 소셜 sub로 대체.
  readAnnouncements: string[]; // 본 공지 id(기기 로컬 — BACKEND §13.13). 재노출 방지, 매 부팅 활성분과 교집합 prune.
  hydrated: boolean;
  signIn: (provider: 'google' | 'apple' | 'dev', displayName?: string) => Promise<SignInResult>;
  signOut: () => void;
  markAnnouncementsRead: (ids: string[]) => void; // 모달/재열람에서 본 공지 기록
  pruneReadAnnouncements: (activeIds: string[]) => void; // 활성 id와 교집합만 유지(무한증가 차단)
}

// 스텁용 기기 id(엔진 무관 — UI 런타임이라 Math.random 허용). 최초 로그인 때 1회 생성·영속.
const genDeviceId = (): string => 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      deviceId: null,
      readAnnouncements: [],
      hydrated: false,
      markAnnouncementsRead: (ids) => set((s) => ({ readAnnouncements: Array.from(new Set([...s.readAnnouncements, ...ids])) })),
      pruneReadAnnouncements: (activeIds) => set((s) => { const a = new Set(activeIds); return { readAnnouncements: s.readAnnouncements.filter((id) => a.has(id)) }; }),
      signIn: async (provider, displayName) => {
        let deviceId = get().deviceId;
        if (!deviceId) {
          deviceId = genDeviceId();
          set({ deviceId });
        }
        const r = await serverLogin(provider, deviceId, displayName);
        if (!r.ok) return { ok: false, reason: r.reason === 'offline' ? 'offline' : 'error' };
        const session: Session = { userId: r.userId, provider: r.provider, displayName: r.displayName, token: r.token };
        setServerToken(session.token); // 이후 서버콜에 Bearer
        set({ session });
        return { ok: true };
      },
      signOut: () => {
        setServerToken(null);
        set({ session: null });
      },
    }),
    {
      name: 'auth.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ session: s.session, deviceId: s.deviceId, readAnnouncements: s.readAnnouncements }),
      onRehydrateStorage: () => (state) => {
        if (state?.session?.token) setServerToken(state.session.token); // 캐시 세션 → 오프라인 진입
        useAuthStore.setState({ hydrated: true });
      },
    },
  ),
);
