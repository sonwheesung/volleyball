# 출시 전 수정사항 (PRE_LAUNCH_CHECKLIST)

> 출시(스토어 심사 제출) 전에 반드시 처리할 항목을 한곳에 모은다. 개발 중 스텁·플레이스홀더·노출된 비밀키를
> 실물로 교체하는 게 핵심. 각 항목은 **정본 문서**를 링크하고, 코드 위치·완료조건을 명시한다.
> 새 출시 전 이슈가 생기면 여기 먼저 추가한다(표준 작업 순서 — 문서 먼저).

**우선순위**: 🔴 필수(안 하면 사고/반려) · 🟡 출시 품질 · 🟢 있으면 좋음
**상태**: ⬜ 미착수 · 🔶 진행 · ✅ 완료

---

## 1. 보안 · 비밀키 회전 🔴

> 개발 중 **채팅/문서에 노출된 비밀키**는 그대로 출시하면 안 된다. 전부 새 값으로 회전 후 `.env.local`(로컬)·Vercel 환경변수(운영)에 반영.

> 📋 **백엔드 보안 감사(2026-07-07) → [SECURITY_AUDIT](./SECURITY_AUDIT.md)**: `server/`의 8개 발견(🔴 무한 다이아 발행·🔴 세션 fail-open+로그인 백도어·🟠 레이트리밋/스냅샷·🟡 멱등키/익명폴백/크론)을 상태 체크리스트로 추적. 출시 전 처리 필수 — 특히 아래 세 키의 **프로덕션 실제 설정 여부**가 #2·#7 실심각도를 좌우(SECURITY_AUDIT OPEN QUESTION 1).

- 🔴 ⬜ **DB 비밀번호 회전** — Supabase Dashboard → Database → Reset password → `DATABASE_URL`·`MIGRATE_DATABASE_URL`(로컬 `.env.local` + Vercel env) 갱신. (개발 중 채팅 노출분. 정본 [BACKEND_SYSTEM](./BACKEND_SYSTEM.md) §13.8) — **미완**(로컬까지 동시 갱신 필요, 다음 세션).
- 🔴 🔶 **`SESSION_JWT_SECRET` 회전** — 세션 토큰 서명키. 회전 시 기존 세션 전부 무효(재로그인) — 출시 전이라 무해. 32바이트+ 랜덤. **2026-07-04 강random으로 회전+Vercel 재배포+라이브 검증(로그인 토큰 발급 정상)**. ⚠️ 단 회전값이 채팅 경유 → **출시 직전 채팅 무경유 값으로 최종 1회 더 회전 필요**.
- 🔴 🔶 **`ADMIN_TOKEN` 회전** — 관리자 대시보드 마스터키(= 이거 알면 쿠폰 발급·점검·환불 다 됨). 32바이트+ 랜덤, **16자 이상 필수**(`requireAdmin` fail-closed, §13.15). 로컬 dev 값(`dev-admin-token-000`)과 운영 값 분리. **2026-07-04 강random(43자)으로 회전+검증(가짜/무토큰 401 fail-closed)**. ⚠️ 채팅 경유값 → 출시 직전 최종 회전.
- 🔴 ✅ **`CRON_SECRET`을 Vercel env에 설정** — 미설정 시 크론 라우트가 통과되나 무방비. 스케줄 `0 18 * * *`(3am KST). (§13.10) **2026-07-04 Vercel Production+Preview 설정 확인.**
- 🟡 ⬜ `.env.local`은 **절대 커밋 금지** 재확인(`.gitignore` 차단됨). `.env.example`만 커밋(양식). (§13.4 M4)
- 🟢 ⬜ Supabase 2FA·복구코드 보관 확인(이미 활성).

---

## 2. EAS 실물 전환 (네이티브 모듈 — Expo Go 불가) 🔴

> 현재 Expo Go 스텁으로 흐름·서버 왕복은 전부 동작. 네이티브 SDK만 **EAS 개발빌드**에서 교체(호출부·서버·UI 대부분 불변).

- 🔴 ⬜ **소셜 로그인 실물** — 구글(`expo-auth-session`)·애플(`expo-apple-authentication`)·SecureStore. `lib/auth.ts`(클라)의 프로바이더 획득 블록 + 서버 `server/lib/auth.ts` ID토큰 검증(jose+JWKS)만 교체. (정본 [AUTH_SYSTEM](./AUTH_SYSTEM.md) §2·§6)
- 🔴 ⬜ **iOS 애플 로그인 버튼 노출** — 구글 로그인 제공 시 애플 병행 필수(App Store 4.8). `components/LoginScreen.tsx`. (AUTH §2)
- 🔴 ⬜ **인앱결제(IAP) 실물** — 다이아 구매·광고제거·DLC. `lib/iap.ts` SDK 연결. 결제 검증은 서버 직접(#43). (정본 [MONETIZATION_SYSTEM](./MONETIZATION_SYSTEM.md))
- 🔴 ⬜ **AdMob SSV 광고** — 보상형 광고 + 서버 서명검증 콜백(`POST /api/ad/ssv`). 광고 멱등키 `ad:<userId>:<day>:<count>`(스텁) → `ssv:<userId>:<ssvTxId>`(실물). `lib/ads.ts`. (BACKEND §4·§13.12)
- 🟡 ⬜ **기기 모델명 수집** — `expo-device`(네이티브)로 `deviceModel` 추가(현재 `Platform.OS`로 android/iOS만). `lib/device.ts`·`users.deviceModel` 컬럼. (BACKEND §13.17 §A)
- 🟡 ⬜ EAS 빌드 후 **실기기 렌더/터치 확인** — `emulator-test` 스킬 + [EMULATOR_E2E](./EMULATOR_E2E.md) 대본.
- 🟡 ⬜ **발열/CPU 릴리즈 재측정**(#84 연계) — 에뮬 dev 실측(2026-07-15, 상대 비교): 경기 관전 **95%**(방치 10.1%의 9.4배 — 코트 연출 ~78%p·오디오 ~13%p)·BGM 상시 +6.6%p·일시정지/백그라운드 깨끗. 릴리즈 실기기에서 재측정 후 뜨거우면 보드 프레임/리렌더·BGM 디코딩 최적화(태스크 #122).
- 🟡 ⬜ **분석/운영 SDK 계측** — Firebase(Analytics·Crashlytics)·GameAnalytics·Install Referrer(안드) + `track()` 래퍼. 서버측(Vercel Observability·Discord webhook·UptimeRobot)은 EAS 전에도 구축 가능. 정본 [ANALYTICS_PLAN](./ANALYTICS_PLAN.md).

---

## 3. 결제 · 환불 (#43 — 결제 모델 확정 후) 🔴

> 사용자 결정: **결제는 모델을 바꿔 진행**(추후). 아래는 그때 처리.

> **결제 방식 = RevenueCat 게이트웨이**(2026-07-03 재채택, §13.18). RC가 영수증 검증·consume·크로스스토어를 흡수하고, 다이아 지급은 웹훅→우리 원장.

- 🔴 ⬜ **RevenueCat 연동** — `react-native-purchases` SDK(EAS), 로그인 직후 `Purchases.logIn(userId)`(app_user_id=우리 userId — 최대 함정). SKU를 RC 대시보드에 등록. (BACKEND §13.18)
- 🔴 ⬜ **RC 웹훅 + 폴백** — `POST /api/purchase/webhook/revenuecat`(Authorization 시크릿 검증)·`POST /api/purchase/confirm`(클라 폴백). 멱등키 `purchase:<userId>:<storeTxnId>`. 샌드박스(`environment:SANDBOX`) 필터. (§13.18)
- 🔴 ⬜ **RC 환불 웹훅** — CANCELLATION/REFUND → 다이아 음수 차감(`refund:<userId>:<storeTxnId>`). 관리자 수동 환불(§13.17)과 이중차감 방지 규칙. (§13.18)
- 🟡 ⬜ **수입 롤업에 환불 반영** — `rollupRecent`가 `reason='purchase'`만 집계 → 실환불 붙으면 순매출 과대계상. 재무진실=RC 대시보드, KRW 필요 시 RC 웹훅 `price_in_purchased_currency` 적재. (`server/lib/retention.ts` TODO, §13.17·§13.18)
- 🟢 ⬜ 스토어 결제 크레덴셜(구글 서비스계정·애플 `.p8`)은 **RC 대시보드에 등록**(우리 서버 미보관). 웹훅 시크릿만 `.env`.

---

## 4. 스토어 등록 정보 (관리자 대시보드에서 설정) 🟡

> `/admin` 페이지 → 운영 설정. DB(`server_setting`)에 저장, 앱은 `/api/bootstrap`로 읽음.

- 🔴 ⬜ **플레이스토어 주소(`androidStoreUrl`)** 설정 — 소프트 업데이트 배너·강제 업데이트 게이트의 이동 링크. (BACKEND §13.16)
- 🟡 ⬜ **`minVersion`(강제)·`latestVersion`(소프트)** 초기값 설정 — 출시 버전 기준.
- 🟢 ⬜ **앱스토어 주소(`iosStoreUrl`)** — 애플 출시 시 채움(비우면 iOS 배너는 안내만·이동버튼 숨김 — 미리 준비됨). (§13.16)

---

## 5. 법무 · 개인정보 (스토어 심사 필수) 🔴

- 🔴 ⬜ **이용약관·운영정책 날짜 확정** — `data/legalText.ts`의 `updated`(최종수정일)·`effective`("서비스 출시일" → 실제 날짜). (마이페이지 → 약관/정책)
- 🔴 ✅ **개인정보 처리방침 공개 페이지 게시**(2026-07-17) — prod Vercel 공개 URL `/privacy`(`server/app/privacy/page.tsx`). 진단 기기정보·결제/데이터 보존기간(결제 5년·분쟁 3년·표시광고 6개월·진단 90일)·위탁·국외이전·만14세·이용자권리 반영. 앱 내 정본 `data/legalText.ts` PRIVACY와 정합(이메일 미수집·Supabase 서울). **잔여**: `{사업자 상호}`·`{사업자등록번호}` placeholder 사용자 기입 + 스토어 심사 폼에 URL 등록. (BACKEND §13.9·§13.17)
- 🔴 ✅ **운영·환불 정책 공개 페이지 게시**(2026-07-17) — prod Vercel 공개 URL `/terms`(`server/app/terms/page.tsx`). 유료 재화(유상/무상·무상 우선 소진)·청약철회/환불·**서비스 종료 30일 전 고지 + 미사용 유상 다이아 환불**(#107) 반영. 런북 `docs/SHUTDOWN_POLICY.md`, 환불 산정 `server/tools/shutdownRefundReport.ts`.
- 🟡 ⬜ 약관 내 "특별훈련=다이아 유일 소비처·정상 소비 환불 불가"가 실제 정책과 일치하는지 최종 확인(약관 11·12·13조·정책 2절).
- 🟢 ⬜ 미성년자 결제·청약철회 등 국내 앱 결제 고지 요건 점검.

---

## 6. 운영 · 인프라 🟡

- 🟡 ⬜ **`EXPO_PUBLIC_SERVER_URL`** = 운영 Vercel URL 확인(현재 `https://volleyball-jet-nine.vercel.app`). 루트 `.env`(커밋됨 — 비밀 아님). (§13.8)
- 🟡 ⬜ **Vercel 환경변수 전량 확인** — DATABASE_URL(6543 풀러 `prepare:false`)·SESSION_JWT_SECRET·ADMIN_TOKEN·CRON_SECRET (Production+Preview). (§13.7·§13.8)
- 🟢 ⬜ **운영 스키마 변경 주의** — 출시 후 DB 변경은 Expand/Contract 3단계(NOT NULL 추가·rename·삭제 금지). `drizzle-kit generate`+`migrate`(push 아님). ([[prod-schema-migration-caution]], §13.7)
- 🟢 ⬜ Supabase 요금제·백업 정책 확인(무료 티어 한도).
- 🟡 ⬜ 📋 **dev 환경 구축(2026-07-07 설계, 미구현 — 온라인 기능 개발 전 필요)** — 현재 dev 앱이 prod Vercel/Supabase 하나에 붙어 보안수정 #2(b)가 dev provider를 401 차단 → 개발자 로그인이 로컬 세션 폴백(UI만 진입)이라 **온라인 기능(지갑·다이아·쿠폰·결제) 테스트 불가**. #43 결제·#46 통계 착수 시 셋업: 두 번째 Supabase 프로젝트=dev DB(무료티어 2개)+마이그레이션 · Vercel `DATABASE_URL` 환경별 분리(Production=prod / Preview·Development=dev, Preview는 `VERCEL_ENV=preview`라 dev 로그인 자동 허용) · dev 앱 `EXPO_PUBLIC_SERVER_URL`=Preview URL 또는 로컬 `npm run dev`. dev DB 생기면 라이브 가드(`walletConcurrency`·`_dv_walletreplay`·`_e2e_backend`) 실행 가능. (정본 [BACKEND_SYSTEM](./BACKEND_SYSTEM.md) §13.24)

---

## 7. QA (출시 직전) 🟡

- 🟡 ⬜ **에뮬레이터 전체 시나리오** — C1(온보딩)~C5. 크래시 0·잘린 텍스트/placeholder(`{}`) 0. (`emulator-test` 스킬, [EMULATOR_E2E](./EMULATOR_E2E.md))
- 🟡 ⬜ **부팅 게이트 실동작** — 점검/강제버전/공지/로그인 벽을 관리자에서 켜고 실기기 확인.
- 🟡 ⬜ **다이아 전 경로 서버 왕복** — 광고 적립·업적 수령·전지훈련 차감·쿠폰·환불이 실서버(운영 URL)에서 정상. (오프라인이면 "온라인 필요" 안내)
- 🟢 ⬜ **개발 화면 숨김 확인** — 감사·실험실·테스트경기 등 `DEV_TOOLS`(운영 빌드 자동 숨김 — 완료됨, [[audit-screen-dev-only]]).
- 🔴 ⬜ **최종 매니페스트 보안 설정 확인**(EAS 릴리즈 산출물, 2026-07-16 디바이스 감사 → [SECURITY_AUDIT](./SECURITY_AUDIT.md) D1~D3) — AAB/APK를 풀어 `AndroidManifest.xml`에서:
  - **`RECORD_AUDIO` 부재** — 마이크 권한이 최종 병합 매니페스트에 없어야 함(app.json blockedPermissions로 제거, 게임 심사·신뢰). `MODIFY_AUDIO_SETTINGS`는 광고/오디오용 정상 잔존.
  - **`android:allowBackup="false"`** — 구글 자동백업 차단(평문 세션/세이브 유출·부활 방지). prebuild 재생성 시 되돌아가지 않았는지 확인. (상시 감시: 가드 `_dv_appconfig` ⓐⓑ)
- 🟡 ⬜ **폰트 XL 육안 확인** — 에뮬/실기기 시스템 설정 → 글꼴 크기·화면 크기를 **최대**로 놓고 주요 화면(대시보드·스탯표·점수판·현수막·쿠폰/문의 입력)에서 잘림·겹침 없음 확인. 전역 상한 `maxFontSizeMultiplier=1.3`(app/_layout.tsx)로 접근성 확대와 레이아웃 보전 절충. (D3 인접 — 디바이스 감사 2026-07-16)

---

## 8. 이미 처리됨 (참고) ✅

- ✅ 하드 로그인 벽 + 로그아웃 + 부팅 게이트(점검/강제버전/공지) — d2de11f (AUTH_SYSTEM)
- ✅ 다이아 서버 진실화(멱등·잔액게이트·아웃박스) — §13.12
- ✅ 공지 in-app + 쿠폰 + 관리자 대시보드 — §13.13~15
- ✅ 소프트 업데이트 배너 + 스토어 URL 관리자 입력 — §13.16
- ✅ 기기정보 + 문의 서버화 + 환불(신청·관리자 처리) — §13.17
- ✅ 이용약관·운영정책 화면 — `data/legalText.ts`
- ✅ 보관기간 법정 조사 + 삭제 스케줄러 + 수입 롤업 — §13.9·§13.10
- ✅ 세이브 마이그레이션(출시 후 구조 변경 안전) — [SAVE_SYSTEM](./SAVE_SYSTEM.md)
- ✅ `ADMIN_TOKEN` fail-closed(≥16자) — §13.15
