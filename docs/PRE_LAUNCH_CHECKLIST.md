# 출시 전 수정사항 (PRE_LAUNCH_CHECKLIST)

> 출시(스토어 심사 제출) 전에 반드시 처리할 항목을 한곳에 모은다. 개발 중 스텁·플레이스홀더·노출된 비밀키를
> 실물로 교체하는 게 핵심. 각 항목은 **정본 문서**를 링크하고, 코드 위치·완료조건을 명시한다.
> 새 출시 전 이슈가 생기면 여기 먼저 추가한다(표준 작업 순서 — 문서 먼저).

**우선순위**: 🔴 필수(안 하면 사고/반려) · 🟡 출시 품질 · 🟢 있으면 좋음
**상태**: ⬜ 미착수 · 🔶 진행 · ✅ 완료

---

## 0. 실측 갱신 요약 (2026-08-05 — 코드/prod 대조)

> 이 문서 본문 주석 중 일부가 뒤처져 있어 실측으로 정정. **진짜 남은 출시 블로커는 대부분 "코드가 아니라 설정·스토어 등록"** 이다.

**🔴 진짜 남은 블로커 (거의 손님 콘솔 작업)**
1. ~~#43 결제 활성화~~ **✅ #43 결제 서버 검증 완료(2026-08-06 prod 원장 실측)** — Play 상품 등록·RC 매핑·웹훅 시크릿·샌드박스 실결제 전부 비공개 테스트에서 동작. 실측: **SANDBOX applied 12/12 원장 안착 · webhook 경유 지급 · 멱등(confirm deduped·이중지급 0) · 금액 정확(dia_100~10000 = 1,000~84,000₩) · 잔액 정합(18950→37950)**. purchase 원장 12건 +38,200dia. **go-live 잔여 = ① 프로덕션 상품 활성(스토어 설정 플립) ② 테스트 데이터 초기화(§0.5).** (7/6 합성 테스트 이벤트 52건이 `purchase_event`에 PRODUCTION으로 잔존 — 매출진실=원장이라 무해하나 초기화 대상.)
2. **스토어 업데이트 게이트 값** — prod `/api/bootstrap` 실측 **`androidStoreUrl·minVersion·latestVersion` 전부 null**(§4). 관리자 콘솔에서 입력 필요.
3. **시크릿 최종 회전** — ~~DB 비번(채팅 노출분) 미회전~~ **✅ DB 비번 회전 완료(2026-08-07 — Supabase reset → 로컬 2줄 + Vercel Production → 재배포, [SERVER_OPS §3.5](./SERVER_OPS.md))**
   ⚠ 단 **잔여 위험: 새 값 = stg 비번(동일 값)** — 월 1회 정기 회전의 다음 회차에 서로 다른 무작위 값으로 분리(§1) ·
   JWT/ADMIN 출시직전 채팅-무경유 최종 회전 · ~~TELEMETRY_SALT~~ **✅ TELEMETRY_SALT 완료(2026-08-05 — Vercel Pro 전환과 함께 prod env 지정·재배포·스모크, [[telemetry-pseudonymized]])**.

> **아래 §0.5 = "운영 승인 시(출시 확정) 진행"** — 스토어 주소/출시일 확정이 트리거라 지금은 대기하고 그때 일괄 처리하는 항목 모음.

**🟡 품질**: 앱 버전 `0.1.0`→`1.0.0`(app.json, 재빌드) · 최종 AAB 매니페스트 육안(설정은 이미 정확) · 폰트 XL · 에뮬 전체 시나리오 · iOS Apple 로그인은 **iOS 트랙**(Android 먼저면 블로커 아님) · `expo-device` deviceModel 미수집(부차).

**✅ 체크리스트가 미완으로 적었지만 이미 완료(정정)**: 사업자 정보 기입(privacy/terms 휘성게임즈·손휘성·749-25 채워짐) · 공개 처리방침/운영정책 게시 + 필수항목 정합(2026-08-05) · **Google 소셜 로그인 패키지 설치 + 클라이언트 ID 설정** · IAP/AdMob 네이티브 패키지 설치 · 매니페스트 보안(allowBackup:false·RECORD_AUDIO 차단) · 약관 날짜/포맷 정합(2026-08-05 — ISO 통일·최종수정 갱신, effective는 '서비스 출시일' 유지, 출시일 확정 시 스왑).

---

## 0.5 운영 승인 시(출시 확정) 진행 — 스토어 주소·실서비스 확정 후 일괄 🔴

> **트리거 = 스토어 심사 승인 / Play 리스팅 URL 확정 / 출시일 확정.** 아래는 "지금 미리 하면 안 되거나(스토어 주소 부재),
> 출시 직전에 해야 안전한(시크릿 채팅노출 방지)" 항목만 모은 **go-live 체크리스트**. 그 전엔 대기. 사용자 결정(2026-08-05): 스토어 주소 확정 후 진행.

- 🟡 🔶 **스토어 게이트 값 입력** (관리자 콘솔 `ops-9f3a2c` → 운영 설정) — `androidStoreUrl` ✅ **입력됨**(2026-08-08 운영 DB 실측: `play.google.com/store/apps/details?id=com.son0925.volleyball`). ~~셋 다 null~~ → **`latestVersion`·`minVersion`은 여전히 null** = 업데이트 안내·강제게이트 미작동(당장은 무해 — 배포된 빌드가 한 종류라 안내할 대상이 없다). (BACKEND §13.16)
  - ⚠ **선행 문제: semver가 한 번도 안 올라갔다.** 게이트는 `versionCode`(29)가 아니라 **`app.json`의 `version` semver를 비교**한다(`lib/bootstrap.ts cmpVersion`). 그런데 `version`은 최초 커밋의 `0.1.0`에서 **vc1~vc29 내내 그대로**다(git 실측) → **지금 구 빌드와 신 빌드를 구분할 방법 자체가 없다.** 값을 넣어봐야 전원이 같은 `0.1.0`이라 아무도 안 걸린다.
  - ⇒ 순서: **다음 AAB에서 semver를 올리고(아래 `1.0.0` 항목) 그때 `latestVersion`을 그 값으로 넣는다.** 그전에 넣을 값은 없다.
  - ☠ **절대 하지 말 것: `latestVersion`/`minVersion`에 `29` 같은 versionCode를 넣기.** `cmpVersion('0.1.0','29') < 0` 이라 **설치된 전 유저가 즉시 업데이트 벽에 갇힌다**(minVersion이면 진입 불가).
- 🔴 ⬜ **약관 시행일 스왑** — `data/legalText.ts` TERMS·POLICY의 `effective: '서비스 출시일'` → **실제 출시일**로 교체(부칙·web `/terms`·`/privacy` 표기 동반). 출시일 확정 후.
- 🔴 🔶 **시크릿 최종 회전(채팅 무경유)** — 출시 직전 본인 터미널 생성값으로 최종 1회 회전: ~~DB 비번(Supabase reset → `DATABASE_URL`·`MIGRATE_DATABASE_URL` 로컬+Vercel 동시 갱신)~~ **✅ DB 비번 2026-08-07 회전 완료**(잔여 위험: 값이 stg와 동일 → 다음 정기 회전에서 분리, §1) · `SESSION_JWT_SECRET` · `ADMIN_TOKEN` **잔여**. 개발 중 채팅 노출분 무효화. (TELEMETRY_SALT는 ✅ 2026-08-05 완료. 상세 §1)
- 🔴 ⬜ **#43 결제 — 프로덕션 상품 활성만 잔여** — ✅ 결제 파이프라인 서버 검증 완료(2026-08-06, 비공개 테스트 샌드박스 실결제 → webhook 지급 → 원장 12/12 안착·멱등·금액 정합, [PAYMENT_LAUNCH_RUNBOOK](./PAYMENT_LAUNCH_RUNBOOK.md)). ~~go-live에 **Play 콘솔 상품을 프로덕션으로 활성**(스토어 설정 플립)만 남음.~~ → **✅ 확인 완료(2026-08-08, 콘솔·공개 스토어·RC 3중 대조)**: 일회성 제품 8개 전부 활성 구매옵션 1 · RC 7 products 전부 Published + `default` 오퍼링 7 packages · 공개 스토어 페이지에 "광고 포함 · 인앱 구매" 노출 · 개발자 계정 **활성**. 
  - ⚠ **`diamond_pass`는 반쪽**: Play 콘솔엔 등록·활성(7/27)인데 **RC에는 없고** 앱도 `ATTENDANCE_PASS_ENABLED = __DEV__`라 운영 미노출 → **설계대로의 미완**(DIAMOND_PASS_SYSTEM §9 Phase ③ ②③④ 잔여). 사용자 결정(2026-08-08): **나중에** — 유저가 붙은 뒤 착수. 완주 시 플래그가 JS라 **OTA로 배포 가능**(AAB 재빌드 불필요).
  - ⚠ **판매자 결제 수단 미인증** — 계좌 ••••5811 `확인 대기중`, Play 콘솔 정책 이슈 1건(**2026-09-06까지 미해결 시 개발자 프로필·앱 삭제**). 소액 입금액 입력이 유일한 해결. 판매가 아니라 **지급**을 막는 건이며, 실결제 파이프라인은 이미 실증됨(7월 매트릭스).
- 🔴 ⬜ **운영 DB 초기화(테스트 데이터 삭제)** — 승인 후 [STAGING_PROD_RESET_RUNBOOK](./STAGING_PROD_RESET_RUNBOOK.md) 절차대로: stg 복사(백업)→대조→백업→**사용자 명시 승인**→유저 데이터 TRUNCATE(users·wallet_ledger·purchase_event·telemetry·문의·세이브 — 샌드박스 결제/7-6 합성 이벤트 포함)→검증. **설정·관리자 콘텐츠(공지·노트·쿠폰정의·전체우편)는 보존**. ⚠ 실결제 발생 전 1회성. 사용자 계획(2026-08-06 "승인 나면 삭제").
- 🟡 ⬜ **앱 버전 `1.0.0`** — `app.json` `0.1.0`→`1.0.0` + versionCode 범프 + 재빌드(AAB) + 스토어 업로드.
  - **릴리즈 규율(2026-08-08 신설)**: 이제부터 **AAB를 낼 때 `versionCode`와 `version`(semver)을 같이 올린다.** versionCode만 올리면 버전 게이트가 영원히 장님이다(위 항목의 실측 근거). 올린 semver를 관리자 콘솔 `latestVersion`에 그대로 넣어야 구 빌드 유저에게 소프트 업데이트 안내가 뜬다.
- 🟢 ⬜ **iOS 트랙(별도)** — `iosStoreUrl` 채움 · Apple 로그인(`expo-apple-authentication`) 추가. Android 선출시면 블로커 아님.

---

## 1. 보안 · 비밀키 회전 🔴

> 개발 중 **채팅/문서에 노출된 비밀키**는 그대로 출시하면 안 된다. 전부 새 값으로 회전 후 `.env.local`(로컬)·Vercel 환경변수(운영)에 반영.

> 📋 **백엔드 보안 감사(2026-07-07) → [SECURITY_AUDIT](./SECURITY_AUDIT.md)**: `server/`의 8개 발견(🔴 무한 다이아 발행·🔴 세션 fail-open+로그인 백도어·🟠 레이트리밋/스냅샷·🟡 멱등키/익명폴백/크론)을 상태 체크리스트로 추적. 출시 전 처리 필수 — 특히 아래 세 키의 **프로덕션 실제 설정 여부**가 #2·#7 실심각도를 좌우(SECURITY_AUDIT OPEN QUESTION 1).

- 🔴 ✅ **DB 비밀번호 회전 — 완료(2026-08-07)** — Supabase Reset password → 로컬 `.env.local` **두 줄**(`DATABASE_URL` 6543 ·
  `MIGRATE_DATABASE_URL` 5432) → Vercel `DATABASE_URL`(**Production 스코프**) → **Production 재배포**까지 실행.
  ~~**미완**(로컬까지 동시 갱신 필요, 다음 세션).~~ 절차·실측 함정(연결문자열 전체 필수 / `MIGRATE_` 동반 갱신 / 옛 값 변형 금지)
  정본 [SERVER_OPS §3.5](./SERVER_OPS.md), 배경 [BACKEND_SYSTEM §13.8](./BACKEND_SYSTEM.md).
  - ⚠️ **잔여 위험(인지·수용됨)**: 새 값이 **stg DB 비밀번호와 동일**해 "stg 크리덴셜 하나로 운영 DB가 열리는" 상태다.
    유저 2명 시점의 위험 대비 비용으로 사용자가 수용. **월 1회 정기 회전** 정책의 **다음 회전 때 prod·stg를 서로 다른
    무작위 값으로 분리**해 해소한다. → [SECURITY_AUDIT](./SECURITY_AUDIT.md) 오픈 항목으로 추적.
- 🔴 🔶 **`SESSION_JWT_SECRET` 회전** — 세션 토큰 서명키. 회전 시 기존 세션 전부 무효(재로그인) — 출시 전이라 무해. 32바이트+ 랜덤. **2026-07-04 강random으로 회전+Vercel 재배포+라이브 검증(로그인 토큰 발급 정상)**. ⚠️ 단 회전값이 채팅 경유 → **출시 직전 채팅 무경유 값으로 최종 1회 더 회전 필요**.
- 🔴 🔶 **`ADMIN_TOKEN` 회전** — 관리자 대시보드 마스터키(= 이거 알면 쿠폰 발급·점검·환불 다 됨). 32바이트+ 랜덤, **16자 이상 필수**(`requireAdmin` fail-closed, §13.15). 로컬 dev 값(`dev-admin-token-000`)과 운영 값 분리. **2026-07-04 강random(43자)으로 회전+검증(가짜/무토큰 401 fail-closed)**. ⚠️ 채팅 경유값 → 출시 직전 최종 회전.
- 🔴 ✅ **`CRON_SECRET`을 Vercel env에 설정** — 미설정 시 크론 라우트가 통과되나 무방비. 스케줄 `0 18 * * *`(3am KST). (§13.10) **2026-07-04 Vercel Production+Preview 설정 확인.**
  ⚠ 이 "Production+Preview"는 **당시 상태 기록**이며 **현재 권장 스코프가 아니다** — 운영 값은 `Production` 전용, stg는 별도 값을 `Preview`+`staging` 브랜치 지정(§6 정정 참조).
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
- 🟡 ✅ **수입 롤업에 환불 반영**(2026-08-07 — 실결제·실환불로 실증 후 수정) — ~~`rollupRecent`가 `reason='purchase'`만 집계 → 실환불 붙으면 순매출 과대계상.~~ 실환불(`dia_500` ₩4,800) 처리 시 다이아 −500은 정상인데 **관리자 "오늘 매출"이 ₩4,800 그대로**(= 예고된 과대계상 실현). **`reverseRevenueKrwOnce(storeTxnId)`** 신설로 환불 웹훅이 `statsDaily.revenueKrw`를 차감 — 금액은 **원구매의 `revenue.krw` 마커 행 price**에서 회수(환불 웹훅 바디는 `price=0`이라 신뢰 금지), `revenue.krw.refund` 마커로 멱등(재전송 이중차감 0), 귀속일=환불일, 음수 클램프 없음. `purchaseCount`·`diamondsPurchased`는 **gross 정의로 고정**(크론 `rollupRecent`가 원장에서 덮어쓰므로 감산 불가) — 환불 측은 `admin/series?metric=refund`로 분리 조회. 가드 `_dv_purchase.ts` **A2**(A/B 민감도 포함). (§13.18 A2·§13.17)
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
- 🟡 ⬜ **Vercel 환경변수 전량 확인** — DATABASE_URL(6543 풀러 `prepare:false`)·SESSION_JWT_SECRET·ADMIN_TOKEN·CRON_SECRET.
  ~~(Production+Preview)~~ → 🔴 **정정(2026-08-07, stg 신설): 운영 값은 `Production` 전용으로 둔다.**
  "Production and Preview"면 **stg Preview가 운영 값을 상속**해 **스테이징 서버가 운영 DB에 붙는다**(2026-08-07 실제 발생 —
  응답·화면이 정상이라 눈으로 못 잡고 `/api/health`의 `dbRef` 지문으로 발견). stg용 값은 **`Preview` + `staging` 브랜치 지정**으로
  별도 등록하고(브랜치 지정 값이 일반 Preview 값보다 우선), 알림·관측 키(`DISCORD_*`·`SENTRY_DSN`·`UPSTASH_*`/`KV_REST_API_*`)는
  **stg에 빈 값으로 덮어** 끈다. ⚠ 운영 변수는 **열지 말 것** — Sensitive 변수는 편집 화면에서 값이 비어 보여
  스코프만 바꾸려다 **빈 값으로 저장해 운영을 끊을 위험**이 있다(덮어쓰기 방식이면 열 필요조차 없다).
  절차 정본 [STAGING_PROD_RESET_RUNBOOK §3.5.6·함정 ③](./STAGING_PROD_RESET_RUNBOOK.md) · 운용 [SERVER_OPS §0·§3.6](./SERVER_OPS.md). (§13.7·§13.8)
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
