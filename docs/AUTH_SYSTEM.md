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

---

## 7. 계정 삭제(탈퇴) — 가명처리 소프트삭제 (#119, 2026-07-15, 출시 필수)

> **왜 필수**: 구글 플레이 데이터 삭제 정책(앱 안·밖에서 삭제 요청 가능) + 개인정보보호법 §22의2(동의 철회·삭제권).
> **정본 스펙 앵커**: `data/legalText.ts` PRIVACY 3·4·8조 + BACKEND_SYSTEM §13.9(법정 5년 보존·소프트삭제). 이 절은 그 방침의
> 서술 동작("즉시 접근 차단→비필수 우선 파기→법정 보존분 만료 후 파기")을 **코드 스펙**으로 확정한다.

### 7.1 결정 — 하드삭제가 아니라 **가명처리(pseudonymize)**
결제·재화 원장(`wallet_ledger` reason=purchase/refund)은 전자상거래법상 **5년 법정 보존**이라 행 삭제 불가(BACKEND §13.9).
그래서 탈퇴는 계정 행을 지우지 않고 **개인 식별성을 비복원 파기**한다 — 원장은 내부 `userId`(uuid, 그 자체로는 비식별)만
남아 **가명화**된다.

탈퇴 시 `users` 행 처리(멱등):
1. `deletedAt = now()` — 소프트삭제 마킹(이미 스키마에 존재).
2. **소셜 식별자 비복원 파기**: `providerId`(구글/애플 sub — 실명 확인 매칭 키)를 `deleted:<row-uuid>` 토움스톤으로 덮어씀.
   원본 sub는 사라져 **재로그인 매칭 불가**(=탈퇴 효력) + `(proj, provider, providerId)` UNIQUE 슬롯이 비어 **재가입이 새 행으로**.
3. **비필수 개인정보 즉시 파기**: `displayName=null`, 진단 기기정보(`platform/osVersion/appVersion`)=null.
4. **잔액·원장은 보존**(`balance`·`wallet_ledger` 유지 — 법정 5년·수입 무결). 내부 userId로만 가명 존속.

### 7.2 세션 무효 — 탈퇴 계정 토큰 거부
`verifyToken`(순수 crypto, DB 없음)은 그대로. **DB 라이브니스 게이트는 미들웨어 층**(`resolveUserId`/`requireUserId`)에 둔다:
- `requireUserId`: 토큰 sub → `(provider, providerId)` **라이브 조회**(생성 안 함). 행이 없거나 `deletedAt`이면 `null` → 라우트 401.
  탈퇴로 providerId가 토움스톤이 되면 옛 토큰의 sub는 **어떤 라이브 행에도 안 맞아** 지갑·문의 등 후속 호출이 401.
- `resolveUserId`(익명 폴백 허용 라우트): 라이브 조회 실패 시 옛 sub로 **유령 계정을 되살리지 않고** 익명 dev로 폴백.

### 7.3 재가입 = 새 계정
같은 소셜로 재로그인하면 구글/애플 sub는 동일하지만, 옛 행의 providerId가 토움스톤이라 **매칭되는 라이브 행이 없어
새 행 생성**(새 userId). **유상 다이아·세이브 연동은 소멸**(옛 userId 원장과 단절). → 앱 확인 단계에서 **잔액 표시 + 경고**
("환불이 필요하면 탈퇴 전 문의")를 반드시 노출.

> **엣지(재가입 후 옛 토큰 재활성, 가드 검증)**: 세션 토큰 sub는 `provider:providerId`라, 재가입으로 같은 providerId가
> 새 라이브 행으로 부활하면 **탈퇴 전 발급된 옛 토큰이 새 계정을 가리키게 된다**(같은 소셜=같은 기기 사용자 본인이라
> 보안 문제 아님). 그래서 "탈퇴 토큰 거부(§7.2)"·"이중 탈퇴 멱등(§7.4)"은 **재가입 이전** 시점의 계약이다 —
> `_dv_account_live` 가드도 멱등(④)을 재로그인(②) **이전에** 검증한다.

### 7.4 API — `DELETE /api/account`
- **Bearer 필수(본인만)**. 라우트가 직접 sub를 검증: 토큰 없음/위조/만료(`verifyToken` null) → **401**.
- 멱등: 유효 서명이지만 라이브 행 없음(이미 토움스톤) 또는 이미 `deletedAt` → **200(동일 응답, alreadyDeleted)**.
  → "탈퇴 후 옛 토큰 후속 호출 401"(§7.2, 지갑 등)과 "이중 탈퇴 200"(계정 라우트 자기 자신)은 모순 아님:
  전자는 라이브 조회 실패=거부, 후자는 계정 라우트가 "유효서명+행없음=이미 탈퇴"로 해석해 200.
- `reportError` 관측, 레이트리밋은 기존 미들웨어 계열(필요 시). 응답 후 클라가 로컬 세션 정리.

### 7.5 파기 크론과의 관계 (실태 — 범위 밖)
BACKEND §13.10 `purgeExpired`(`server/lib/retention.ts`)는 `wallet_ledger`(비결제 2년)·`diagnostic_snapshots`(90일)·
`tickets`(3년)만 경과분 파기하고 **`users` 행은 건드리지 않는다**. 본 설계는 탈퇴 **시점에** 즉시 가명화(providerId 파기·
displayName null)하므로 `users` 행에 **잔존 PII가 없어** 후속 크론 파기가 불필요하다(행은 5년 원장 FK 앵커로 존속).
완전한 행 하드삭제(원장 만료 후)를 원하면 크론에 `users where deletedAt < now()-1825d` 티어를 추가하는 **별도 작업** — 이번 범위 아님.

### 7.6 앱 진입점
`app/settings.tsx` 데이터 섹션의 "세이브 초기화" 인근에 **"계정 삭제"**(위험 톤). `showAlert` **2단 확인**:
1차(잔액·소멸 경고 — 유상 다이아/세이브 연동 소멸, 환불은 탈퇴 전 문의), 2차(최종 확인, destructive).
성공 시 `useAuthStore.deleteAccount()` → 서버 확정 후 `signOut()`(세션 clear) → BootGate가 로그인 벽으로 복귀.
로컬 게임 세이브는 로그아웃 관례대로 유지(기기 로컬·비PII·결정론 — 재로그인 시 새 서버 계정과 무관하게 존속).
> ※로그아웃 버튼 자체는 `app/(tabs)/mypage.tsx` 최하단(§4). 계정 삭제는 파괴적 프런트 작업이라 설정(데이터)에 배치.

---

## 8. 연령 게이트 — 만 14세 (#110, 2026-07-15, 출시 필수)

> **왜 필수**: 개인정보보호법상 만 14세 미만 아동은 법정대리인 동의가 필요 — 본 서비스는 수집 자체를 제한한다.
> **스펙 앵커**: `data/legalText.ts` PRIVACY 4조("가입 시 연령 확인 절차로 만 14세 미만 가입 제한").

### 8.1 결정 — **신규 생성만** 게이트
- **로그인 벽**(`components/LoginScreen.tsx`)에서 "만 14세 이상입니다" **체크박스**로 로그인 버튼을 게이팅(미확인 시 진행 차단·안내).
  구글/애플/dev 버튼 공통 — 최초 가입 경로의 확인.
- 서버 `POST /api/auth/login`에 `ageConfirmed: boolean` 전달. **행을 새로 생성할 때만** `ageConfirmed===true` 요구 —
  없거나 false면 **400(age-required)**. 생성 성공 시 `users.ageConfirmedAt = now()` 기록.
- **기존 계정(라이브 행 존재)은 소급 강제하지 않음** — 다음 로그인에서 `ageConfirmed` 없이도 통과(신규 생성만 게이트).
  **근거**: 이미 가입한 사용자에게 재확인을 서버에서 강제하면 캐시 세션·기존 유저에 불필요한 마찰. 게이트의 목적은
  "미성년 신규 유입 차단"이므로 생성 시점 1회로 충분하고, 확인 사실(`ageConfirmedAt`)은 그 행에 영구 기록된다.
- **Expo Go dev 경로**: dev 버튼도 체크박스 게이트를 거쳐 `ageConfirmed=true`를 보내 통과. dev-local 합성 세션(서버 미연결
  폴백, token='')은 서버 계정 생성이 없어 게이트 무관.

### 8.2 스키마
`users.ageConfirmedAt timestamptz`(nullable, additive). null=미확인(익명 폴백/구버전/게스트 생성). 신규 소셜 가입은 non-null.

### 8.3 미확정/드리프트 메모
- `ensureUser`(저수준 upsert·익명 폴백·가드용)는 `ageConfirmedAt`을 세팅하지 않는다 — 연령 게이트는 **login 라우트 층**에서만
  강제(진짜 소셜 가입 경로). 익명 dev-user·가드 생성 유저는 `ageConfirmedAt=null`이어도 무방(실사용자 아님).

---

## 9. 구현 현황 (계정삭제·연령 — #119·#110, 2026-07-15)

- 📋 문서(§7·§8) 확정 → 스키마(`ageConfirmedAt` additive)·마이그레이션(`0001` 멱등 ADD COLUMN)·`lib/auth.ts` 라이브니스 게이트·
  `lib/wallet.ts`(`findUserRow`/`createUser`)·`login` 라우트(연령 게이트)·`DELETE /api/account`(가명화·멱등)·정적 삭제 안내
  `server/app/delete-account/page.tsx`·상설 가드 `server/tools/_dv_account_live.ts`·클라(`LoginScreen` 체크박스·`settings` 계정삭제·
  `useAuthStore.deleteAccount`·`lib/server.deleteAccount`) 구현.
- 검증: app tsc 0 · server tsc 0 · npm test · copylint · 라이브 가드(임시 Postgres) — 6항목(토큰거부·sub파기·원장보존·멱등·무토큰401·연령400/200) + A/B.
