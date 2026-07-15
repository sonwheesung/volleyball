// 인증 세션 스토어 (AUTH_SYSTEM §3) — 게임 스토어와 분리(SOLID 단일책임).
// 진실=서버. 여기 session은 "로그인 상태 + Bearer 캐시"일 뿐. 재화는 서버가 검증([[server-authoritative-currency]]).
// 캐시 세션 있으면 재수화 시 Bearer 재주입 → 오프라인 진입 허용(하드 벽은 세션 없을 때만).
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { login as serverLogin, setServerToken } from '../lib/server';
import { identifyUser, logoutUser } from '../lib/iap';
import { signInGoogle, signOutGoogle } from '../lib/googleAuth';
import { getDeviceInfo } from '../lib/device';
import { track } from '../lib/analytics';

export interface Session {
  userId: string;
  provider: string; // google | apple | dev
  displayName: string | null;
  token: string; // 자체 Bearer(HS256). 서버가 발급, 여기 캐시.
}
export type SignInResult = { ok: true } | { ok: false; reason: 'offline' | 'error' | 'cancelled' | 'unavailable' };

interface AuthState {
  session: Session | null;
  deviceId: string | null; // 스텁 providerId(기기 안정). EAS에선 실제 소셜 sub로 대체.
  readAnnouncements: string[]; // 본 공지 id(기기 로컬 — BACKEND §13.13). 재노출 방지, 매 부팅 활성분과 교집합 prune.
  readDevnotes: string[]; // 읽은 개발자 노트/패치노트 id(기기 로컬 — DEVNOTES §3.3, 공지와 동일 논리). 안읽음 배지·재노출 방지.
  dismissedUpdateVersion: string | null; // 닫은 소프트 업데이트 latest(§13.16) — 새 latest 발행 시 재노출
  hydrated: boolean;
  signIn: (provider: 'google' | 'apple' | 'dev') => Promise<SignInResult>;
  signOut: () => void;
  markAnnouncementsRead: (ids: string[]) => void; // 모달/재열람에서 본 공지 기록
  pruneReadAnnouncements: (activeIds: string[]) => void; // 활성 id와 교집합만 유지(무한증가 차단)
  markDevnoteRead: (id: string) => void; // 노트 상세 진입 시 그 id 읽음 처리(DEVNOTES §3.3)
  pruneReadDevnotes: (activeIds: string[]) => void; // 게시글 id와 교집합만 유지 — **온라인 응답 시에만** 호출(§3.3 F 함정: 응답 없이 prune하면 유효 글 재노출)
  dismissUpdate: (latest: string) => void; // 소프트 업데이트 배너 닫음(그 latest는 재노출 안 함)
}

// 스텁용 기기 id(엔진 무관 — UI 런타임이라 Math.random 허용). 최초 로그인 때 1회 생성·영속.
const genDeviceId = (): string => 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      deviceId: null,
      readAnnouncements: [],
      readDevnotes: [],
      dismissedUpdateVersion: null,
      hydrated: false,
      markAnnouncementsRead: (ids) => set((s) => ({ readAnnouncements: Array.from(new Set([...s.readAnnouncements, ...ids])) })),
      pruneReadAnnouncements: (activeIds) => set((s) => { const a = new Set(activeIds); return { readAnnouncements: s.readAnnouncements.filter((id) => a.has(id)) }; }),
      markDevnoteRead: (id) => set((s) => (s.readDevnotes.includes(id) ? s : { readDevnotes: [...s.readDevnotes, id] })),
      pruneReadDevnotes: (activeIds) => set((s) => { const a = new Set(activeIds); return { readDevnotes: s.readDevnotes.filter((id) => a.has(id)) }; }),
      dismissUpdate: (latest) => set({ dismissedUpdateVersion: latest }),
      signIn: async (provider) => {
        const device = getDeviceInfo(); // 진단 기기정보 동봉(§13.17)
        // google=네이티브 계정선택 → idToken(서버가 검증해 sub만 저장). dev/apple=기기ID 스텁.
        let cred: { providerId?: string; idToken?: string };
        if (provider === 'google') {
          const g = await signInGoogle();
          if (!g.ok) return { ok: false, reason: g.reason === 'cancelled' ? 'cancelled' : g.reason === 'unavailable' ? 'unavailable' : 'error' };
          cred = { idToken: g.idToken };
        } else {
          let deviceId = get().deviceId;
          if (!deviceId) { deviceId = genDeviceId(); set({ deviceId }); }
          cred = { providerId: deviceId };
        }
        const r = await serverLogin(provider, cred, device);
        if (!r.ok) {
          // dev 로컬 폴백(__DEV__ 전용): 운영 서버는 계정 탈취 백도어를 막으려 dev provider를 401로 차단한다
          // (SECURITY_AUDIT #2(b), server .../auth/login: prod && provider!=='google' → 401). 그 차단은 유지돼야 한다.
          // 개발 빌드에서만, 서버가 dev를 거부하면(prod 401 등) 로컬 dev 세션을 합성해 UI/게임플레이 테스트 진입을 허용한다.
          // 운영 빌드엔 dev 버튼 자체가 없고(__DEV__===false) 서버도 계속 dev를 막으므로 이 폴백은 운영에서 아무것도 재개방하지 않는다.
          // 로컬 dev 세션은 서버 Bearer가 없어 온라인/지갑 기능은 typed 실패만 돌려준다 — 개발엔 무방.
          if (provider === 'dev' && __DEV__) {
            const deviceId = get().deviceId ?? genDeviceId();
            const session: Session = { userId: 'dev-local:' + deviceId, provider: 'dev', displayName: '개발자(로컬)', token: '' };
            setServerToken(null); // 유효한 서버 Bearer 없음 — 온라인 기능은 조용히 실패(관전/시뮬은 로컬이라 정상)
            set({ session });
            track('login', { provider });
            return { ok: true };
          }
          return { ok: false, reason: r.reason === 'offline' ? 'offline' : 'error' };
        }
        const session: Session = { userId: r.userId, provider: r.provider, displayName: r.displayName, token: r.token };
        setServerToken(session.token); // 이후 서버콜에 Bearer
        set({ session });
        void identifyUser(session.userId); // RC app_user_id=우리 userId 고정(§13.18 최대 함정) — 비동기, 결제 전 완료
        track('login', { provider });
        return { ok: true };
      },
      signOut: () => {
        track('logout');
        void signOutGoogle(); // 구글 세션도 정리(다음 로그인 계정 재선택)
        void logoutUser();     // RC도 익명으로(다음 로그인 계정 재귀속)
        setServerToken(null);
        set({ session: null });
      },
    }),
    {
      name: 'auth.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ session: s.session, deviceId: s.deviceId, readAnnouncements: s.readAnnouncements, readDevnotes: s.readDevnotes, dismissedUpdateVersion: s.dismissedUpdateVersion }),
      onRehydrateStorage: () => (state) => {
        if (state?.session?.token) setServerToken(state.session.token); // 캐시 세션 → 오프라인 진입
        // 재시작 복원 경로에서도 RC app_user_id를 우리 userId로 고정(§13.18 최대 함정) — 안 하면 앱 재시작 후
        // 자동 로그인된 유저의 구매가 익명 RC id로 붙어 웹훅 지급이 유저에 안 붙는다. fire-and-forget(graceful·dev no-op).
        if (state?.session?.userId) void identifyUser(state.session.userId);
        useAuthStore.setState({ hydrated: true });
      },
    },
  ),
);
