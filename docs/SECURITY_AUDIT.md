# 백엔드 보안 감사 (SECURITY_AUDIT)

> 온라인 백엔드(`server/`)에 대한 **방어적(defensive) 보안 감사** — 2026-07-07 수행.
> 대상: 소셜 로그인·자체 Bearer 세션·다이아 지갑(원장)·쿠폰·결제(RC)·문의/스냅샷·관리자·크론.
> 정본 설계는 [BACKEND_SYSTEM](./BACKEND_SYSTEM.md)(특히 §4 다이아 지갑·§13.12 서버 진실화·§13.14 쿠폰·§13.17 문의/환불),
> 인증은 [AUTH_SYSTEM](./AUTH_SYSTEM.md). 출시 전 처리 트래킹은 [PRE_LAUNCH_CHECKLIST](./PRE_LAUNCH_CHECKLIST.md) §1(비밀키·보안).

> **검증·발견 = Fable 5(메인, 치명항목 직접 재검증) / 병렬 조사 4세션 / 문서화 = Opus 에이전트, 2026-07-07**

> ⚠ **본 문서는 READ-ONLY 발견 기록이다 — 아직 어떤 코드도 고치지 않았다.** 각 항목은 사용자가
> 나중에 이어서 처리할 수 있도록 **상태 체크리스트**(`⬜ 미착수` → `✅ 완료`)로 관리한다.
> 추정 금지 원칙(CLAUDE.md 11장)에 따라 여기 기록된 심각도·경로·익스플로잇은 감사에서 확인된 것만이며,
> 실제 수정은 **문서 먼저 → 개발 → 검증(A/B·상설 가드)** 순서를 따른다(DOC_DISCIPLINE §1).

---

## 심각도 요약

| 심각도 | # | 항목 | 상태 |
|---|---|---|---|
| 🔴 CRITICAL | 1 | 무한 다이아 발행(`welcome` 캡 부재, **배포된 코드에 존재**) | ✅ 수정+검증(2026-07-07) |
| 🔴 CRITICAL/HIGH | 2 | 세션 시크릿 fail-open(라이브 완화·코드 잠재) + dev/apple 로그인 백도어(라이브 오픈, 계정 탈취) | ✅ 수정+검증(2026-07-07) — #2(b) Apple은 JWKS 검증 구현 전까지 prod 차단 유지 |
| 🟠 HIGH | 3 | 서버 전역 레이트리밋 부재 | ⬜ 미착수(Q2 대기) |
| 🟠 HIGH | 4 | `/api/snapshot` 무제한 JSON blob 저장 → 스토리지 고갈 | ✅ 수정+검증(2026-07-07) |
| 🟡 MEDIUM | 5 | 멱등키 userId 미바인딩 → 피해자 적립 선점(griefing) | ✅ 수정+검증(2026-07-07) |
| 🟡 MEDIUM | 6 | `wallet/earn·spend`가 `resolveUserId`(익명 폴백) 사용 | ✅ 수정+검증(2026-07-07) |
| ⚪ LOW(잠재) | 7 | `cron/purge` 시크릿 미설정 시 fail-open(프로덕션 시크릿 설정됨 → 라이브 트리거 불가) | ✅ 수정+검증(2026-07-07) |
| ⚪ LOW | 8 | 방어심화·패키지(세션 만료·상수시간 비교·DB CHECK 등) | ⬜ 미착수 |

> **라이브 vs 잠재:** #2의 시크릿 fail-open(a)과 #7은 §1 기록(2026-07-04 프로덕션 시크릿 설정+검증)으로
> **현재 프로덕션에선 완화**됐고 남는 건 코드의 fail-open 패턴(env 슬립 시 재앙 — 잠재 footgun).
> **라이브로 열려 있는 실질 최우선은 #1(welcome 무한발행)·#2(b)(dev/apple 백도어)·#3·#4.**
> 실행 순서는 아래 [지금 당장](#지금-당장-우선순위) 참조.

---

## 🔴 1. CRITICAL — 무한 다이아 발행 (배포된 코드에 존재)

- **상태:** ✅ 수정+코드검증(2026-07-07, Fable 재검증: _dv_security 23/23·서버 tsc exit0·정적 diff) — 라이브 dedup은 기존 UNIQUE 증명(walletConcurrency) 승계·dev DB 있으면 재확인 권장
  - **수정 내용:** `server/lib/walletKey.ts`(순수) 신설 — `earnClientKeyPart('welcome', k)`가 클라 키를 무시하고 상수 `'welcome'` 반환.
    earn 라우트가 저장키를 `walletIdemKey(userId, 'welcome')` = `${userId}:welcome`로 강제 → 모든 반복이 UNIQUE(proj_code, idempotency_key)로 1행 dedupe(무한발행 차단).
- **경로:** `server/lib/econ.ts:20,30` → `server/app/api/wallet/earn/route.ts:26,34,42`
- **익스플로잇:** `welcome`이 EARN_OK 화이트리스트에 있고 `earnAmount('welcome')`이 서버 고정 1000을 반환하는데,
  earn 라우트의 백스톱은 ad(하루 8회 `countReasonToday`)·achievement(평생 20,000 `sumReason`)뿐이라
  **welcome은 어느 캡에도 안 걸린다.** `idempotencyKey`가 body에서 온 클라 통제 값이라, 모드 클라가
  `reason:"welcome"`에 키만 바꿔가며(`welcome:x1`, `welcome:x2` …) 반복하면 각 키가 새 원장 행이 되어 **무제한 +1000**.
  멱등 `UNIQUE(proj_code, idempotency_key)`는 동일 키 재시도만 dedupe. `econ.ts:30` 주석의 "멱등키가 계정당 1회 보장"은
  그 키가 클라 통제라 거짓(서버가 `sumReason(userId,'welcome')`를 확인 안 함). achievement는 서버 원장합 백스톱이 있는데
  welcome만 없는 **비대칭이 의도치 않음의 증거**. 기존 가드 `_dv_walletreplay`는 고정 `welcome:<PID>` 키 1개만 시험해
  varying-key 경로를 못 잡는다.
- **수정 방향:** welcome은 클라 키를 무시하고 서버가 `idempotencyKey=welcome:${userId}`로 강제 +
  `sumReason(userId,'welcome')>0`이면 거부(achievement 백스톱 패턴 미러).
- **수정 후 검증:** 새 가드가 varying-key welcome 반복 후에도 원장 welcome 합이 정확히 1000인지 확인
  (A/B: 수정 전=무한, 수정 후=1000 캡).

---

## 🔴 2. CRITICAL/HIGH — 세션 시크릿 fail-open + dev/apple 로그인 백도어 (계정 탈취)

- **상태:** ✅ 수정+코드검증(2026-07-07, Fable 재검증: _dv_security 23/23·서버 tsc exit0·정적 diff) — 라이브 dedup은 기존 UNIQUE 증명(walletConcurrency) 승계·dev DB 있으면 재확인 권장. **#2(b) Apple은 실 JWKS 검증 구현 전까지 prod 차단 유지(팔로우업).**
  - **수정 내용 (a):** `server/lib/auth.ts` — 시크릿을 **호출 시점**에 읽고, 프로덕션(`VERCEL_ENV`/`NODE_ENV==='production'`)에서 `SESSION_JWT_SECRET`이 미설정/32자 미만/기본값이면 `signToken` throw·`verifyToken` null(fail-closed). 로컬 dev는 기본키 유지(경고 1회). ④ `verifyToken`이 iat 기준 TTL(180일) 초과 토큰 거부(관대).
  - **수정 내용 (b):** `server/app/api/auth/login/route.ts` — 프로덕션에선 실 idToken 검증하는 `google`만 허용, `dev`·`apple`은 401. 비프로덕션은 스텁 유지. Apple JWKS(appleid.apple.com) 서명·audience·iss/exp 검증은 **Apple 로그인 출시 전 필수 팔로우업**(주석 명시).
- **경로:** `server/lib/auth.ts:6` · `server/app/api/auth/login/route.ts:22-30`
- **라이브 상태(2026-07-07 재검증):**
  - **(a) 시크릿 fail-open = 프로덕션에선 이미 완화됨(잠재 footgun).** [PRE_LAUNCH_CHECKLIST](./PRE_LAUNCH_CHECKLIST.md) §1이
    `SESSION_JWT_SECRET`을 **2026-07-04 강random으로 설정+Vercel 재배포+라이브 검증(로그인 토큰 발급 정상)** 했다고 기록.
    따라서 "기본 시크릿으로 임의 계정 위조"는 **현재 프로덕션에서 불가.** 남는 리스크 = ① 코드의 fail-open 패턴 자체
    (env 슬립 시 재앙 — 여전히 fail-closed 부팅 가드로 고쳐야 함) ② 회전값이 채팅 경유라 **출시 직전 채팅 무경유 값으로 최종 1회 더 회전 필요**(§1 ⚠ 항목에 이미 기록).
  - **(b) dev/apple 로그인 백도어 = 시크릿과 무관하게 라이브로 완전히 열려 있음** → 그대로 **CRITICAL/HIGH 유지.**
  - → 심각도 표/제목은 유지하되, 실질 라이브 위험은 (b)에 있다.
- **익스플로잇 (a):** `const SECRET = process.env.SESSION_JWT_SECRET ?? 'dev-only-change-me'`. 프로덕션 Vercel에
  이 env가 미설정이면 HMAC 키가 리포에 있는 공개 문자열이 되어, 공격자가 `signToken('google:<피해자sub>')`를
  오프라인 계산 → Bearer로 전송 → **구글 계정 포함 임의 계정 완전 탈취**. 같은 코드베이스의
  `admin.ts:11`·`revenuecat.ts:25`는 시크릿 없으면 fail-closed인데 auth만 fail-open.
- **익스플로잇 (b):** login 라우트에서 provider가 google/apple이 아니면 dev로 폴백해 클라가 준 providerId를 무검증 신뢰.
  apple도 Apple 토큰 검증이 없어 providerId 그대로 신뢰. 코드 주석이 직접 `⚠ TODO(보안): prod에서 provider='dev' 백도어 차단`이라
  명시했지만 NODE_ENV/VERCEL_ENV 게이트가 없어 프로덕션에 살아 있음 → **무제한 위조 세션(#3~#6의 증폭기).**
- **견고한 부분:** 구글 로그인 자체는 견고(`googleVerify.ts` — 서명·audience·만료 검증, sub만 저장, fail-closed).
  문제는 secret 폴백과 우회 프로바이더.
- **수정 방향:**
  ① `SESSION_JWT_SECRET` 미설정/32자 미만이면 부팅 거부(fail-closed)
  ② `provider==='dev'`를 `VERCEL_ENV!=='production'`로 게이트
  ③ Apple 실 토큰 검증(JWKS `appleid.apple.com`, audience=bundle id, iss/exp) — EAS Apple 로그인 출시 전 필수
  ④ 토큰 exp 추가(`verifyToken`이 iat만 쓰고 만료 미검사).
- **수정 후 검증:** 기본 시크릿으로 서명한 토큰이 401인지, `provider:'dev'`가 prod 모드에서 401인지.

---

## 🟠 3. HIGH — 서버 전역 레이트리밋 부재

- **상태:** ⬜ 미착수 (Q2 레이트리밋 구현 방식 결정 대기 — 2026-07-07 Q2-독립 수정 라운드에서 **의도적 제외**)
- **경로:** 전 라우트 (`server/middleware.ts` 부재, rate-limit 유틸/의존성 0)
- **익스플로잇:** 인증 없는 auth/login 플러딩(+users 행 무한 생성 via `ensureUser`), 쿠폰 무차별 대입
  (coupon/redeem 락아웃 없음, 각 시도가 다중쿼리 트랜잭션), 문의 폭주(+Discord 웹훅 스팸).
  **#2 위조 세션과 결합 시 per-user 캡(ad/achievement)도 신원마다 리셋.**
- **수정 방향:** IP+userId 키 레이트리밋 유틸 1개를 login·coupon·ticket·snapshot에 적용.
  방식은 [OPEN QUESTION](#open-questions-수정-착수-전-사용자-답-대기)(Vercel KV / Upstash / DB 카운터).
- **수정 후 검증:** (수정 방식 확정 후) 임계 초과 요청이 429로 차단되는지 + 정상 사용자 무영향 A/B.

---

## 🟠 4. HIGH — /api/snapshot 무제한 JSON blob 저장 → 스토리지 고갈

- **상태:** ✅ 수정+코드검증(2026-07-07, Fable 재검증: _dv_security 23/23·서버 tsc exit0·정적 diff) — 라이브 dedup은 기존 UNIQUE 증명(walletConcurrency) 승계·dev DB 있으면 재확인 권장
  - **수정 내용:** `server/app/api/snapshot/route.ts` — `SNAPSHOT_MAX_BYTES=262144`(256KB) 상한. `JSON.stringify(b.snapshot).length > 상한`이면 INSERT 전 413(too-large). 소유권 체크는 유지.
- **경로:** `server/app/api/snapshot/route.ts:17,22`
- **익스플로잇:** `b.snapshot`(임의 unknown JSON)을 크기 검증 없이 그대로 INSERT(유일 체크는 `!== undefined`).
  `next.config`에 body limit 없어 Vercel ~4.5MB까지 blob 루프 → `diagnostic_snapshots`에 90일 보존되는
  **다GB 스토리지+쓰기 컴퓨트, 전부 공격자 통제.** 소유권 체크(`tickets.userId=userId`)는 파라미터화돼 안전.
- **수정 방향:** `JSON.stringify(b.snapshot).length` 상한(예 256KB) 초과 거부 + (선택)티켓당 스냅샷 수 캡.
- **수정 후 검증:** 상한 초과 페이로드가 거부(4xx)되고 정상 스냅샷(~수백KB)은 통과하는지 경계 A/B.

---

## 🟡 5. MEDIUM — 멱등키 userId 미바인딩 → 피해자 적립 선점(griefing)

- **상태:** ✅ 수정+코드검증(2026-07-07, Fable 재검증: _dv_security 23/23·서버 tsc exit0·정적 diff) — 라이브 dedup은 기존 UNIQUE 증명(walletConcurrency) 승계·dev DB 있으면 재확인 권장
  - **수정 내용:** earn/spend 라우트가 저장키를 `walletIdemKey(userId, clientKey)` = `${userId}:${clientKey}`로 서버해석 userId 프리픽스. 공격자가 피해자 userId를 임베드한 클라키로 선점 시도해도 저장키는 공격자 userId로 시작 → 교차유저 선점 불가. 정당 재시도(동일 userId+클라키)는 동일 저장키라 dedupe 유지. (coupon/purchase는 이미 서버측 userId 임베드 — 미변경.)
- **경로:** `server/db/schema.ts:63`(`ledger_proj_idem_uniq = (projCode, idempotencyKey)`, userId 제외) ·
  `earn/route.ts:42` · `spend/route.ts:24`
- **익스플로잇:** 서버 빌드 키(`coupon:${userId}:${id}`, `purchase:<userId>:<txn>`)는 userId 임베드라 안전하지만,
  earn/spend는 `body.idempotencyKey`를 raw로 받아 userId 포함 검증 안 함. dup-check가 `(proj, key)`로 유저 무관 매칭이라,
  공격자 A가 `ad:<B-userId>:<날>:<슬롯>` 키로 미리 적립하면 **피해자 B의 정당 적립이 `applied:false`로 선점됨.**
  userId가 랜덤 UUID(`defaultRandom`)라 피해자 UUID를 먼저 알아야 해서 MEDIUM.
- **수정 방향:** 저장 키를 서버에서 `${userId}:${clientKey}`로 네임스페이스(또는 UNIQUE/dup-check에 userId 추가).
- **수정 후 검증:** 타 userId를 임베드한 키로 선점 시도해도 피해자 적립이 정상 반영되는지 A/B(수정 전=선점, 수정 후=무영향).

---

## 🟡 6. MEDIUM — wallet/earn·spend가 resolveUserId(익명 dev-user-1 폴백) 사용

- **상태:** ✅ 수정+코드검증(2026-07-07, Fable 재검증: _dv_security 23/23·서버 tsc exit0·정적 diff) — 라이브 dedup은 기존 UNIQUE 증명(walletConcurrency) 승계·dev DB 있으면 재확인 권장
  - **수정 내용:** `wallet/earn`·`wallet/spend`·`wallet` GET을 `requireUserId`로 전환(→ 유효 Bearer 없으면 401 `{ok:false, reason:'unauthorized'}`). 키 빌드 전에 실 userId 확정. coupon/ticket/snapshot/purchase와 일관(§13.17 P0-5 익명 폴백 금지).
- **경로:** `server/lib/auth.ts:34-45` · `wallet/route.ts:11` · `earn/route.ts:24` · `spend/route.ts:23`
- **익스플로잇:** `resolveUserId`는 Bearer 없거나 무효면 공유 `ensureUser('dev-user-1','dev')`로 조용히 폴백.
  세션 만료 중 전지훈련 차감(spend)이 엉뚱한 지갑에 가고 클라는 `applied===true`로 지불 진행 → **스플릿브레인.**
  쿠폰(§13.14 C1)·purchase/confirm은 이미 `requireUserId`로 고쳤는데 earn/spend만 누락(§13.17 P0-5 "익명 폴백 금지" 위반).
- **수정 방향:** earn/spend/wallet GET을 `requireUserId`로 통일(→401).
- **수정 후 검증:** Bearer 없이/무효 토큰으로 earn·spend·wallet GET 호출 시 401인지(dev-user-1 버킷에 안 붙는지).

---

## ⚪ 7. LOW(잠재) — cron/purge 시크릿 미설정 시 fail-open

- **상태:** ✅ 수정+코드검증(2026-07-07, Fable 재검증: _dv_security 23/23·서버 tsc exit0·정적 diff) — 라이브 dedup은 기존 UNIQUE 증명(walletConcurrency) 승계·dev DB 있으면 재확인 권장
  - **수정 내용:** `server/app/api/cron/purge/route.ts` — `if (!secret || 헤더!==Bearer secret)`로 fail-closed(admin.ts 패턴 미러). `CRON_SECRET` 미설정 시 가드 스킵되던 구 `if (secret && ...)` 제거 → 시크릿 설정+일치할 때만 통과.
- **경로:** `server/app/api/cron/purge/route.ts:11-14`
- **라이브 상태(2026-07-07 재검증):** [PRE_LAUNCH_CHECKLIST](./PRE_LAUNCH_CHECKLIST.md) §1이 `CRON_SECRET`을
  **2026-07-04 Vercel Production+Preview 설정 확인**으로 기록 → **라이브 익스플로잇 닫힘(현재 트리거 불가).**
  남는 건 코드의 fail-open 패턴(env 슬립 시 무방비 — 잠재 footgun). 그래서 🟡 MEDIUM → **⚪ LOW(잠재)** 로 조정.
- **익스플로잇(코드 패턴):** `if (secret && req.headers... !== Bearer ${secret})` — `CRON_SECRET` 미설정이면 가드 스킵 →
  누구나 `GET /api/cron/purge`로 purge/rollup 잡 트리거. 잡이 가벼워(만료분만 삭제) 영향 작지만,
  `admin.ts:11`(fail-closed)과 달리 **데이터변경 잡이 fail-open.**
- **수정 방향:** `CRON_SECRET` 미설정 시 거부(fail-closed), `isAdmin` 패턴 미러.
- **수정 후 검증:** 시크릿 미설정/오설정 요청이 401이고 정상 시크릿만 통과하는지.

---

## ⚪ 8. LOW / 방어심화 / 패키지

- **상태:** ⬜ 미착수
- 세션 토큰 **만료 없음**(`auth.ts:11-31`, iat 미검사) — #2④에 포함.
- RC 웹훅 시크릿 `h === RC_WEBHOOK_SECRET` **비상수시간 비교**(`revenuecat.ts:24-28`) — `timingSafeEqual` 권장(fail-closed 자체는 양호).
- `users.balance`에 **DB CHECK(balance>=0) 백스톱 없음**(`schema.ts:34`) — 현재 앱 게이트(FOR UPDATE + next<0 거부)로 안전하나
  doc §13.4 H2 권고 미구현. 환불의 의도적 음수 때문에 조건부/트리거 필요.
- achievement 평생캡 **TOCTOU**(`earn/route.ts:33-41`): `sumReason`이 트랜잭션 밖이라 동시 2건이 같은 remaining 읽어
  최대 per-claim(1000) 초과 가능 — 코드·§13.12에 **명시·수용됨(WAI**, 정당 유저는 캡 미도달).
- 패키지: 인터넷 대면 `server/`는 `npm audit` high/critical **0건**(moderate 6건 전부 drizzle-kit·Next 빌드툴, 런타임 무관).
  RN 앱 undici high 1건은 Expo CLI(`@expo/cli`) 빌드 체인 경유라 서버·앱 런타임 비노출. `.env`가 git 커밋됐으나
  값 전부 `EXPO_PUBLIC_*`(설계상 공개 키)라 실 서버 비밀 노출 없음 — 단 `.gitignore`에 평문 `.env` 추가 권장(현재 `.env*.local`만).

---

## 지금 당장 (우선순위)

> **라이브로 열려 있는 실질 최우선 = #1(welcome 무한발행)·#2(b)(dev/apple 백도어)·#3·#4.** 시크릿 3종(#2a·#7)은
> §1 기록상 2026-07-04 프로덕션 설정+검증됨 — 신규 설정이 아니라 **재확인 + 출시 직전 최종 회전** 과제.

1. **Vercel 프로덕션 env 재확인 + 최종 회전** — `SESSION_JWT_SECRET`·`ADMIN_TOKEN`·`CRON_SECRET`은 §1 기록상 2026-07-04
   설정+검증됨. 미설정이 아니라 (i) **지금도 설정돼 있는지 재확인** + (ii) `SESSION_JWT_SECRET`·`ADMIN_TOKEN`은 채팅 경유값이라
   **출시 직전 채팅 무경유 최종 회전**(§1 ⚠ 항목). → [OPEN QUESTION 1](#open-questions-수정-착수-전-사용자-답-대기)
2. **#1 welcome 무한 발행 패치**(실경제 코드의 유일 shipped 버그 — **라이브**).
3. **#2(b) dev/apple 로그인 백도어 게이트 + Apple 검증**(**라이브 오픈**, EAS 실 로그인/실결제 출시 전).
   (#2(a) 코드 fail-open 부팅 가드는 잠재 footgun 차원에서 동반 수정.)
4. **레이트리밋 유틸+스냅샷 상한(#3·#4 — 라이브), cron fail-closed(#7 잠재), earn/spend requireUserId(#6).**

---

## OPEN QUESTIONS (수정 착수 전 — 사용자 답 대기)

> 아래 두 질문의 답이 나와야 해당 항목 수정을 마무리할 수 있다.

1. **시크릿 3종 재확인 + 최종 회전** — ✅ **ANSWERED(2026-07-07)** — 사용자 Vercel 스크린샷으로 `SESSION_JWT_SECRET`·`ADMIN_TOKEN`·`CRON_SECRET`
   3개 모두 **Production+Preview 설정 확인**. 잔여: 출시 직전 채팅 무경유 최종 회전(`SESSION_JWT_SECRET`·`ADMIN_TOKEN`).
   (원문 보존) [PRE_LAUNCH_CHECKLIST](./PRE_LAUNCH_CHECKLIST.md) §1이
   `SESSION_JWT_SECRET`·`ADMIN_TOKEN`·`CRON_SECRET` 모두 **2026-07-04 프로덕션 설정+라이브 검증**을 기록했다("미지"가 아님).
   사용자에게 필요한 건 (i) 그 값들이 **지금도** Vercel 프로덕션에 설정돼 있는지 재확인(에이전트/메인은 대시보드 값 조회 불가) +
   (ii) `SESSION_JWT_SECRET`·`ADMIN_TOKEN`은 회전값이 **채팅 경유**라 **출시 직전 채팅 무경유 값으로 최종 1회 더 회전**(§1 ⚠ 항목).
   → 이 재확인/최종회전이 #2(a)·#7의 "라이브 완화" 전제를 보증한다.
2. **레이트리밋 구현 방식: Vercel KV / Upstash Redis / DB 카운터 중?** (#3 수정 방식 결정.)

---

## 견고한 것 (확인됨, SAFE)

> 구멍만이 아니라, 감사에서 **안전하다고 검증된 것**도 기록한다(회귀 시 재확인 기준).

- **지갑 동시성:** `applyWalletTx`가 `SELECT...FOR UPDATE`(users 행)로 직렬화 후 balance 게이트+atomic update+ledger insert 한 트랜잭션.
  `walletConcurrency.ts`로 K=50/N=200 → 정확히 50 성공, balance 0, 음수 없음, `balance==Σledger` 증명.
- **이중지급:** 같은 키 2건이 pre-check 통과해도 두 번째 insert가 `ledger_proj_idem_uniq` 위반 → throw →
  applyWallet catch가 error 반환. **정확히 1회.**
- **금액 서버 권위:** `earnAmount`/`spendAmount` 서버 계산(ad/welcome/camp 고정, achievement [1,1000] 클램프),
  음수/0 → null → 400. spend는 항상 `-amount`(amount>0 검증)라 credit 불가.
- **구매 forge/replay:** 웹훅 `verifyWebhookAuth` 시크릿 fail-closed, `decidePurchaseEvent` 서버 권위(productDiamonds),
  SANDBOX/비UUID app_user_id 드롭. confirm은 RC REST 재검증. 둘 다 `purchase:<userId>:<storeTxnId>` 자연키로 replay dedupe.
- **쿠폰:** 단일 트랜잭션(존재→disabled→DB `now()` 기간→personal-target 소유권→soft-delete→redemption UNIQUE insert
  `onConflictDoNothing`→`applyWalletTx` 서버키), `requireUserId`, 이중/동시 redeem은 UNIQUE로 직렬화.
- **관리자 인증:** 14개 admin 라우트 전부 `isAdmin(req)` 첫 문장 호출, fail-closed(token<16자 거부),
  `timingSafeEqual`+길이 사전체크, Bearer(CSRF 내성).
- **SQL injection:** 전 표면 파라미터 바인딩(Drizzle `sql\`${x}\``=$1 바인드, postgres-js 태그드템플릿).
  `sql.raw`·문자열 연결·동적 식별자 0건. 26개 라우트 + libs 전수. **0건.**
- **Google 로그인:** `googleVerify.ts` `verifyIdToken`(audience=CLIENT_IDS)로 서명·발급자·audience·만료 검증,
  fail-closed, sub만 신뢰.

---

## 처리 이력

- 2026-07-07 — 감사 수행·본 문서 작성(READ-ONLY 발견 기록, 코드 미변경). 8개 발견 전부 `⬜ 미착수`.
  수정 착수 시 각 항목 상태를 `✅ 완료`로 갱신하고 "수정 후 검증" 가드를 README 검증 루틴/서버 가드 배터리에 등록.
- 2026-07-07 — Q2-독립 수정 착수(#1·#2·#4·#5·#6·#7): 멱등키 서버강제/userId바인딩·requireUserId·시크릿 prod fail-closed+토큰만료·dev/apple prod차단·스냅샷256KB상한·cron fail-closed.
  가드 _dv_security(순수). #3 레이트리밋은 Q2 대기. 구현=Opus/검증·커밋=Fable 5.
  (상태는 `🔧 수정함` — Fable이 독립 재검증 후 `✅ 완료`로 전환. 라이브 dedup은 dev DB에서 walletConcurrency/_dv_walletreplay로 재확인 권장.)
