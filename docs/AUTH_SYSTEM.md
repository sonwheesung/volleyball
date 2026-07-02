# 인증 시스템 (AUTH_SYSTEM) — 로그인 벽 · 세션 · 로그아웃

> **설계 확정 2026-07-02 (구단주 결정)**. 온라인 전환(BACKEND_SYSTEM)으로 계정이 재화·결제의 소유 주체가 되면서,
> 앱 진입에 **하드 로그인 벽**을 세운다. 구현은 **Expo Go 스텁 → EAS 실물 교체**(광고·IAP와 동일 패턴).

---

## 1. 결정 — 하드 로그인 벽 (M3 정정)

- **사용자 결정**: "앱 로그인 하지 않으면 로그인 화면 나오게" → **로그인 안 하면 게임 진입 불가**(하드 벽).
- **정정 대상**: BACKEND_SYSTEM §13.4 **M3 "부팅 게이트 금지 — 익명 캐시 플레이 기본"**. 계정이 결제·다이아의
  소유 주체라 익명 플레이를 더는 두지 않기로 함(구단주 권한 — 안티과금 기둥을 다이아로 뒤집은 것과 같은 결). 취소선 정정은 BACKEND §13.4에 보존.
- **관전형 기둥과의 화해(중요)**: 하드 벽이 관전형 오프라인 기둥을 깨지 않도록 —
  **최초 1회 로그인만 온라인 필요**. 로그인 성공 시 세션을 기기에 캐시하고, **이후 실행은 캐시 세션으로 오프라인 진입 허용**
  (네트워크 없어도 관전·시즌 시뮬 계속). 즉 벽은 "세션이 없을 때만" 막는다. 이는 BACKEND 표(로그인 최초1회 ✅ 캐시 신원 사용)와 정합.

## 2. 시점 — 스텁 now / 실물 EAS

- **네이티브 제약**: 실제 구글(`expo-auth-session`)·애플(`expo-apple-authentication`)·SecureStore는 네이티브라 **Expo Go 불가**.
  광고·IAP와 같은 이유 → **EAS 개발빌드**에서 활성(CLAUDE §8 "네이티브 모듈 사전확인").
- **현재(Expo Go 스텁)**: 로그인 화면·벽·로그아웃·세션 지속·서버 로그인 라운드트립까지 **전부 동작**. "로그인" 행위만
  스텁(실제 OAuth 없이 서버가 dev로 신뢰). EAS 때 `lib/auth.ts`의 프로바이더 획득 블록 한 곳만 실물 SDK로 교체(호출부·서버·UI 불변).
- **iOS 규칙**: 구글 로그인 제공 시 애플 로그인 병행 필수(App Store 4.8) — EAS 활성 때 애플 버튼 노출.

## 3. 아키텍처 (신원 → 세션 → 지갑 소유)

```
[클라] 프로바이더 ID토큰 획득(스텁: dev 신뢰)
   → POST /api/auth/login {provider, providerId, displayName, idToken?}
   → [서버] (스텁)신뢰 / (EAS)jose+JWKS 검증 → users upsert(provider+providerId) → 자체 세션 토큰 서명(HS256, SESSION_JWT_SECRET)
   → {token, userId, displayName}
[클라] useAuthStore 세션 저장(persist) + setServerToken(token)
   → 이후 모든 서버콜 Authorization: Bearer <token>
   → [서버] resolveUserId(req): Bearer 검증 → user (없거나 무효면 익명 dev 유저 폴백 — 하위호환)
```

- **세션 토큰**: 서버가 `SESSION_JWT_SECRET`으로 HMAC 서명한 미니 JWT(`sub=provider:providerId`, `iat`). 외부 의존성 0(node:crypto).
  EAS에서 ID토큰 검증(jose+JWKS)만 붙이면 되고 세션 메커니즘은 그대로. 정본 서버 코드 `server/lib/auth.ts`.
- **지갑 귀속**: `resolveUserId`가 Bearer→userId를 풀어, 지갑 GET/spend/earn·결제가 **로그인 계정에 귀속**(익명 폴백 유지 — 토큰 없으면 dev 유저).
- **클라 세션 스토어**: `store/useAuthStore.ts`(zustand persist+AsyncStorage) — 게임 스토어와 **분리**(SOLID 단일책임). `session|null`, `hydrated`.
  - `signIn(provider)`: 서버 로그인 → 세션 저장 + setServerToken. throw 없음(typed 결과 — `ok | offline | error`).
  - `signOut()`: 세션 clear + setServerToken(null) + persist. → 루트가 로그인 벽으로 복귀.
  - 재수화(rehydrate) 시 캐시 세션 있으면 setServerToken 재주입 → **오프라인 진입**.

## 4. 화면·게이트

- **`app/login.tsx`** — 브랜드 로그인 벽. 디자인 시스템(Screen/Card/Button/theme) 준수. 버튼: 구글로 계속·애플로 계속(iOS)·(개발)dev 로그인.
  스텁이라 "출시 시 실제 소셜 로그인 연결" 정직 안내 배지. 성공하면 루트가 세션 감지 → 게임 진입.
- **루트 게이트 `app/_layout.tsx`** — 인트로 스플래시(폰트+세이브+**auth 수화**) 완료 후: `session` 없으면 `<LoginScreen/>`만 렌더(Stack 차단),
  있으면 기존 Stack. 네트워크로 막지 않음(캐시 세션이면 통과) — online-first ≠ online-only.
- **로그아웃 — 마이페이지 최하단**(`app/(tabs)/mypage.tsx`) 버튼. confirm 후 `signOut()`. 위험 톤(theme.bad)·계정 표시(현재 로그인 계정) 곁들임.

## 5. 예외·안전

- 서버 미설정/오프라인 + **세션 없음** → 로그인 벽에서 "네트워크 필요(최초 로그인)" 안내. 게임 진입 불가(하드 벽 결정).
- 서버 오프라인 + **캐시 세션 있음** → 정상 진입(오프라인 관전). 지갑/결제만 "온라인 필요" 안내(§4 online-only 작업).
- 모든 인증 함수 throw 없음(typed) — 로그인 실패가 앱을 크래시시키지 않음(광고/IAP 계약과 동일).

## 6. 구현 현황

- 📋 문서 확정(2026-07-02).
- ✅ **서버(2026-07-03)**: `lib/auth.ts`(HS256 세션 토큰·resolveUserId)·`/api/auth/login`(dev 스텁 Bearer 발급)·`/api/bootstrap`(점검·버전·공지)·wallet 3라우트 userId 귀속. **검증: 로그인→토큰→지갑 귀속·위조토큰 익명폴백(남의 지갑 0)·bootstrap 응답**.
- ✅ **클라(2026-07-03)**: `store/useAuthStore.ts`(세션 persist·signIn/signOut·Bearer 재주입)·`components/LoginScreen.tsx`(로그인 벽)·`components/BootGate.tsx`(점검→강제버전→로그인 게이트, 오프라인 캐시세션 통과)·`lib/bootstrap.ts`(버전비교)·루트 `_layout.tsx` BootGate 래핑·`mypage.tsx` 최하단 로그아웃. **검증: 앱 tsc 0·버전비교 6케이스·게이트 데이터 경로 E2E(점검/min9.9.9/공지 bootstrap 반영·원복)**. ※로그인 화면은 라우트 아닌 컴포넌트(벽에서 이탈 불가).
- ⏳ EAS 실물(구글/애플 SDK·SecureStore·ID토큰 JWKS 검증) — EAS 빌드 단계. 실기기 렌더/터치 확인은 emulator-test.

> 관련: 결제·지갑은 [BACKEND_SYSTEM] §13, 다이아 SKU·상점은 [MONETIZATION_SYSTEM] §4, 오프라인 우선 계약은 BACKEND §13.6.
