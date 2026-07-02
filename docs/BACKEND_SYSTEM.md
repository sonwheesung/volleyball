# 백엔드 시스템 (BACKEND_SYSTEM) — 온라인 전환 · 다이아 지갑 · 결제 · 로그 · 문의 · 관리자 대시보드

> **신설 2026-07-01.** 사용자 결정으로 게임을 **온라인 기반**으로 전환하고, **Vercel 서버**를 다이아 지갑·결제·로그·문의·통계의
> 진실의 원천으로 둔다. 수익화 정책은 `MONETIZATION_SYSTEM.md`(이 문서가 백엔드 정본). 표준 작업 순서 1.5단계
> **독립 리뷰 거침**(아래 §9에 결론·반영). **현재 = 설계·로컬 우선 구현 단계**(Vercel 배포 전엔 로컬 서버 실행).

---

## 0. 잠긴 결정 (사용자, 2026-06-30~07-01)

| 항목 | 결정 | 비고 |
|---|---|---|
| 계정/식별 | **소셜 로그인(구글/애플)** | 기기변경·재설치에도 다이아·구매 따라옴 |
| 오프라인 기둥 | **폐기 → 온라인 우선** | 관전·시뮬은 캐시로 계속, 다이아·결제만 온라인 필수 |
| 결제 검증 | **Vercel 단독**(구글 Play/애플 API 직접) | RevenueCat 미사용 |
| 결제 저장 | **우리 DB(Vercel)** | 영수증·거래·환불 |
| 배포 | Vercel(나중) · **지금은 로컬 서버 실행** | Vercel 호환 구조로 |

---

## 1. 두 기둥과의 관계 (안 깨는 것)

- **관전형 1순위 유지** — 온라인은 *계정·지갑·결제*에만 필요. **관전·시즌 시뮬은 연결이 끊겨도 캐시로 계속 동작**한다
  (독립 리뷰 핵심 권고 — "online-first ≠ online-only"). 앱 진입/관전을 네트워크로 하드 게이트하지 않는다.
- **데이터 누적 서사 유지** — 시즌 시뮬은 여전히 로컬 결정론(base+currentDay+results 시드 리플레이). 서버는 시드/리플레이에 안 들어간다.
- **무저장 결정론(재정의)** — *시뮬 입력*은 무저장 재계산. **지갑은 메타 원장**(시드 무관). 둘은 격리한다.

## 2. 온라인 우선 모델 (네트워크 경계)

| 동작 | 온라인 필요? | 끊겼을 때 |
|---|---|---|
| 앱 진입·관전·시즌 시뮬·기록 열람 | ❌ | 캐시로 정상 동작 |
| 로그인(최초 1회) | ✅ | 캐시된 신원 사용, 진입 막지 않음 |
| 다이아 잔액 **표시** | ❌ | 마지막 캐시 표시 |
| 다이아 **사용(전지훈련)** | ✅ | 서버 차감 성공 후에만 반영(아래 §4) |
| 다이아 **적립(광고/업적)** | ✅ | 서버 확인 후 반영 |
| 결제(구매) | ✅ (유일한 하드 게이트) | 버튼 비활성 + "온라인 필요" |

> 모든 서버 콜은 **throw 없이 typed 결과**(광고 `showSeasonStartAd` 계약과 동일). 관전/시뮬은 어떤 경우에도 안 막는다.

## 3. 신원 (소셜 로그인)

- 구글/애플 로그인 → 서버가 사용자 레코드 발급(`userId`, provider, providerId). 토큰·기본 지갑 캐시.
- 기기변경·재설치 시 같은 소셜 계정으로 로그인하면 지갑·구매 복원.

## 4. 다이아 지갑 (append-only 원장)

- **balance = fold(ledger)** — 잔액을 직접 증감하지 않고 원장 합으로 계산(재시도 안전).
- **멱등키**(이중지급/이중차감 차단):
  | 거래 | 멱등키 |
  |---|---|
  | 구매→다이아 | 스토어 transaction_id |
  | 광고→다이아 | AdMob SSV transaction id |
  | 업적→다이아 | 업적 id (영구 1회) |
  | 전지훈련 차감 | (saveId, season, playerId, stat) ≈ `campTrainedThisOffseason` |
- **결정론 격리(중요)**: 지갑은 메타라 시드 입력에 **절대 안 들어간다**. **전지훈련 차감은 서버 차감 성공 뒤에만 `campLog` 기록**
  → 서버 잔액과 로컬 campLog가 어긋날 일(split-brain) 자체가 없음. 잔액 *표시*만 캐시. (campLog = 로컬 시뮬 진실, 리플레이 재적용 — §MONETIZATION 11.2.)

## 5. 결제 (Vercel 직접 검증)

- **구매→검증→지급→consume**를 서버 주도·멱등으로. 구매 시 클라가 영수증/토큰을 서버로 → 서버가 구글 Play Developer API /
  애플 App Store Server API로 검증 → transaction_id로 1회 지급 → consume(소비성).
- **함정(리뷰 경고)**: 구글은 **미consume 구매를 ~3일 뒤 자동 환불** → 지급 실패 시 "돈 내고 0개" 발생. 지급 확정 전 클라는
  **"지급 처리 중"** 표기(완료 아님). consume/acknowledge까지 서버가 책임.
- **환불 웹훅 P1에 구축**(미루지 않음 — 리뷰가 "진짜 유지비"라 경고): 구글 RTDN(Pub/Sub) · 애플 App Store Server Notifications V2(.p8 JWT).
- 비소모(광고제거·월드컵 DLC)는 스토어가 복원 보장 + 서버 엔타이틀먼트. 소비성 다이아는 복원되지 않음(상점 UI에서 구분 표기).

## 6. 부정 방지 (등급별)

| 적립 | 방식 |
|---|---|
| 구매 | 서버 직접 영수증 검증 + transaction_id 멱등 (머니 패스 — 철벽) |
| 광고 | **AdMob 보상형 SSV**(AdMob이 우리 서버로 서명 콜백 → 검증 후 지급). 클라 "봤다" 신뢰 안 함 |
| 업적 | **서버 id 멱등 dedupe + 상한**만(서버 리플레이 안 함). 싱글·유저 관대라 의식적 선택 — 로그로 남김 |

> 업적-다이아는 이론상 자작 클라가 86개 자가지급 가능하나, 싱글플레이라 치팅은 본인 세이브만 싸게 만든다(유저 관대 §MONETIZATION 2.5). 머니 패스(구매)·광고 SSV에 엄격함을 집중.

## 7. 로그 (진단·유지보수)

- **기기 로컬 롤링 버퍼**: 진단 로그(이벤트·오류·상태 전이)를 폰에 쌓되 **최근 10시즌만 유지**, `[max(1, 현재시즌-10) .. 현재]`
  밖 시즌 로그는 prune(예: 15시즌이면 4시즌 이하 삭제). ※게임 기록(통산·아카이브)이 아니라 **유지보수용 로그**.
- **서버 로그**: 결제·핵심 이벤트·오류를 Vercel DB에 적재(대시보드 조회). `lib/log` 확장(현재 dev 콘솔 → 서버 전송 추가).

## 8. 문의하기 + 진단 스냅샷

- **진입**: 마이페이지 "문의하기" → 목록(없으면 "문의 내역이 없습니다" 빈 상태) → **우상단 [문의] 버튼** → 등록 화면
  (**카테고리: 오류·건의·질문·기타** + 내용). 관리자 답변 → 사용자에게 표시.
- **진단 스냅샷(핵심)**: 제출 시 **비동기로** 최근 **`[max(1, 현재-10) .. 현재]` 시즌**(5시즌→1~5, 15시즌→5~15)의
  **비저장 데이터까지 시드 리플레이로 재계산**해 티켓에 첨부 — 선수 이동(FA·영입·방출·재계약)·성장·드래프트·외국인,
  뉴스 기사, 경기 결과, 대회 기록 등 + 로컬 로그 버퍼. 무거우니 백그라운드 생성 후 업로드. (대부분 문의가 히스토리 오류라 분석에 필수.)
  무저장 결정론이라 **클라가 재생해서 보내는 구조**와 정확히 맞음.

## 9. 관리자 대시보드 (Vercel · 나 전용)

- 로그인 보호. **조회**: 사용자·지갑·원장·결제·로그·문의(스냅샷 포함). **답변**: 문의에 답글.
- **통계**: DAU(하루 평균 접속) · 플레이타임(최대·중앙값·평균) · 결제액(일/주/월/연) · ARPU·전환율·다이아 획득원(광고/업적/구매) 분해·전지훈련 사용률.
  → 집계 위해 클라가 세션 시작/하트비트/이벤트를 서버로 전송.

## 10. 독립 리뷰 결론 (1.5단계, 2026-07-01)

- **채택**: ① **online-first(online-only 아님)** — 관전/시뮬은 오프라인 캐시로 유지, 막는 건 결제/적립뿐. ② 지갑=메타 원장, balance=fold,
  멱등키 자연키. ③ 전지훈련 차감은 서버 성공 후 campLog → split-brain 제거. ④ 광고=AdMob SSV, 업적=id 멱등(서버 리플레이 안 함, 의식적). ⑤ 환불 웹훅+consume를 P1에.
- **사용자 보강**: 다이아 사용/적립/결제는 **무조건 온라인**(낙관적 오프라인 큐 대신 — 더 단순·안전).
- **문서 부채 정리**: 리뷰가 지적한 CLAUDE §2/§8·MONETIZATION §2.2/§6/§6.1/§11.4의 오프라인·RevenueCat 모순 → 취소선 정정 완료(2026-07-01).

## 11. Phase 로드맵

- **P0** 게임 내 개선(A1~A8) — 서버 무관. (A4 ✅·A7 ✅·A6 ✅ 2026-07-01 / A1·A2·A3·A8 진행 예정)
- **P1** 백엔드 스캐폴드(로컬 실행, Vercel 호환): Next.js route handlers + DB + 소셜 로그인 + 지갑 원장 + **영수증 검증·환불 웹훅** + 관리자 대시보드 + 문의/스냅샷 + 통계. 타입드 클라이언트(`lib/server.ts`, throw 없음).
- **P2** AdMob SSV · 실결제 연결 · EAS 빌드(네이티브) · Vercel 배포.

## 12. 빌드 전제 / 필요 비밀키 (P1~P2)

- 내 손에서: 로컬 서버·DB·문의 UI·스냅샷 생성기·대시보드 골격·타입드 클라이언트.
- 사용자 계정/키 필요(연결만): Vercel 프로젝트·DB, 구글/애플 OAuth 클라이언트, 스토어 결제 API 서비스계정(.p8/서비스계정 JSON), AdMob SSV, EAS 빌드. 그 단계에서 안내.

---

## 13. 구현 아키텍처 (P1 스캐폴드 — 2026-07-01 독립 리뷰 반영)

> 표준 작업 순서 1.5 독립 리뷰를 거쳐 **기반 기술을 확정**했다. 리뷰가 원안(Auth.js·SQLite)의 치명적 오류 2건을
> 잡아 아래로 교정. 리뷰 원문 요지는 §13.4 리스크 레지스터에 흡수.

### 13.1 확정 스택
| 층 | 선택 | 이유(리뷰 반영) |
|---|---|---|
| 서버 | **Next.js(App Router)** — `/server` 독립 패키지 | API 라우트 핸들러 + 관리자 대시보드 페이지 일체, Vercel 네이티브, 로컬 `next dev` |
| DB/ORM | **Drizzle + Postgres**(~~로컬 Docker `postgres:16`~~ → **Supabase Postgres**, dev·prod 공통 — 2026-07-02 사용자 결정) | ~~SQLite~~ 폐기 — SQLite는 단일라이터라 **동시성 버그(이중지불)를 로컬서 가림**(리뷰 C2/H2). dev==prod로 Postgres 고정. **호스트를 로컬 Docker→Supabase로 전환**(개발부터 실 Postgres라 H2 동시성이 로컬서 그대로 드러남 — Docker Desktop 의존 제거). Drizzle=서버리스 콜드스타트 가벼움·SQL 우선(엔진 바이너리 없음). ⚠ **연결 규칙**(§13.7): 런타임=Transaction 풀러(:6543)+`prepare:false`, 마이그레이션=Session/Direct(:5432) |
| 인증 | **네이티브 ID토큰 검증(jose+JWKS) → 자체 Bearer 토큰** | ~~Auth.js(NextAuth)~~ 폐기(리뷰 C1) — Auth.js는 **브라우저 쿠키/리다이렉트** 전제라 RN 네이티브 클라에 안 맞음. 클라가 `expo-auth-session`/`expo-apple-authentication`로 ID토큰 획득→서버가 JWKS로 검증→자체 세션 JWT 발급→클라 `expo-secure-store` 보관→`Authorization: Bearer`. 쿠키 0. (구글 로그인 제공 시 iOS는 Apple 로그인 병행 필수 — App Store 4.8) |
| 클라이언트 | `lib/server.ts`(Expo 앱) — **throw 없는** 타입드 | 광고 스텁과 동일 계약. 잔액 *표시*=캐시, 사용/적립/결제=서버 확인 후. **어떤 서버콜도 앱 렌더 임계경로에 두지 않음**(리뷰 M3 — 오프라인 부팅 보장) |

### 13.2 데이터 모델(Drizzle 스키마)
**멀티게임 구조(2026-07-02 사용자 결정)**: 이 서버는 배구명가로 시작하되 **향후 타 스포츠게임이 같은 재화·결제 구조를 공유**한다.
부모 테이블 **`ProjInfo`**(`proj_code` PK — 'volleyball' 등)를 두고, **모든 데이터 테이블에 `proj_code` FK→ProjInfo**를 박아
게임별로 완전 격리한다. 유니크 제약도 게임 스코프(예: users `(proj_code, provider, providerId)`, ledger `(proj_code, idempotencyKey)`).
서버 상수 `PROJ_CODE`('volleyball') 단일 소스로 모든 write에 주입.

- `ProjInfo`(`proj_code` PK, name, createdAt) — 게임 카탈로그(부모).
- `User`(`proj_code` FK, provider, providerId, `balance` 영속, **`deletedAt` 소프트삭제**) · UNIQUE`(proj_code, provider, providerId)`.
  - **balance 영속**=fold O(n) 회피 + 동시성 잠금 대상. **deletedAt**=계정삭제 시 하드삭제 대신 소프트삭제(결제 원장 법정보존 §13.9).
- `WalletLedger`(append-only 감사, `proj_code` FK, userId FK, signed `delta`, `reason`, **`ref`**, balanceAfter) · UNIQUE`(proj_code, idempotencyKey)`.
  - `reason`=범주(purchase|ad|achievement|camp|refund|adjust). **`ref`(신규)=획득/사용 출처 상세 감사**("어떻게 얻었나" — 업적id·상품id·SSV id·전지훈련 playerId:stat). 사용자 요청(감사 필수).
- (이후) `Purchase`(`proj_code` FK, `transactionId` unique/proj, status pending→granted→consumed→refunded, platform, productId, rawReceipt) · `AdReward`(`ssvTransactionId` unique) · `AchievementClaim`(`userId+achievementId` unique) · `Log`(proj_code, level, tag, season) · `Ticket`+`TicketMessage`(proj_code, userId, 카테고리) · `DiagnosticSnapshot`(JSON) · `TelemetrySession`+`Heartbeat`. 전부 `proj_code` FK 포함 신설.

### 13.3 엔드포인트
`/api/health` · `/api/auth/login`(ID토큰→Bearer)·`/refresh` · `GET /api/wallet`(balance+최근 원장) · `POST /api/wallet/spend`·`/earn`(멱등키+**행 잠금 트랜잭션**) · `POST /api/purchase/verify`(→grant→**스토어 consume/finish 호출**) · `POST /api/purchase/webhook/google`(RTDN Pub/Sub, JWT 검증)·`/apple`(ASSN V2, JWS 검증) → **환불 시 음수 원장 차감** · `POST /api/ad/ssv`(AdMob 서명 검증) · `POST /api/log` · `/api/ticket`(create/list/reply) · `POST /api/snapshot` · `POST /api/telemetry` · 관리자 대시보드 페이지(인증 보호).

### 13.4 리스크 레지스터 (리뷰 지적 — 착수 전 반드시)
- **H1 결제 소비/환불**: DB `status:consumed` ≠ 실제 consume. 구글은 **미consume 소비성 구매를 ~3일 뒤 자동 환불**. 흐름=verify→grant(원장, transactionId 멱등)→**Play `purchases.products.consume`**(애플=finish)→consumed. **환불/차지백 웹훅→지갑 음수 차감 필수**(정책: 음수 허용+spend는 balance 게이트 → 환불된 고래가 계속 못 씀).
- **H2 이중지불 동시성**: 멱등키는 *같은 키 재시도*만 막음. 서로 다른 동시 spend 2건이 각자 balance 읽고 통과→초과지출. **`SELECT … FOR UPDATE` 행 잠금 트랜잭션 + `balance` 원자 갱신 + `CHECK(balance>=0)` 백스톱**. 동시 이중지불 유닛테스트로 증명(Postgres에서만 드러남).
- **H3 업적 다이아=클라 신뢰**: 서버가 시뮬 재실행 안 함(결정론 격리)→업적 자작 가능. **불가피 → 설계로 수용**: 업적/광고 다이아는 **1회·저가·평생 합계 상한**, **구매만 고가 소스**. MONETIZATION에 명시(이미 §2.5 유저 관대·§6 반영).
- **H4 서버-서버 웹훅 서명검증**: SSV/RTDN/ASSN은 유저 세션 없이 구글·애플 서버가 호출 → **암호서명 검증 필수**(AdMob 회전키·구글 서명 JWT·애플 JWS). SSV는 `custom_data`로 유저 바인딩+`ssvTransactionId` 멱등.
- **M1 Metro가 /server 크롤**: 별도 package.json이어도 Metro는 루트서 감시→Haste 충돌·중복 React. **`metro.config.js` blockList에 /server 제외**(이번 커밋 포함).
- **M3 부팅 게이트 금지**: 로그인/지갑을 부팅에 await하면 online-first 위반. **익명 캐시 플레이 기본, 세션은 spend/earn/결제 순간만**.
- **M4 비밀키**: 서비스계정 JSON·애플 .p8·OAuth 클라ID·AdMob·세션서명키 — `.env.example`만 커밋, 실키는 연결단계. 로컬은 stub 프로바이더로 무자격 부팅.

### 13.5 빌드 순서(작은 러너블 먼저)
1. **스켈레톤+health**(/server 독립·Metro blockList) — `next dev` 응답 + Expo 번들 무손상. ✅ **완료(2026-07-01)** — `GET /api/health` 200·server tsc 0·blockList /server 제외 확인.
2. **Postgres+지갑 코어**(Drizzle, User+WalletLedger+balance, spend/earn = FOR UPDATE+멱등+가드, 동시 이중지불 테스트). ✅ **완료·런타임 검증(2026-07-02, Supabase)** — ~~로컬 Docker Desktop~~ → **Supabase Postgres 17.6**(ap-northeast-2 Seoul) 연결(§13.7): `server/.env.local` `DATABASE_URL`(풀러:6543 `prepare:false`) → `drizzle-kit push`(Session:5432) 스키마 생성 → `tools/walletConcurrency.ts` **K=50·N=200 이중지불 0 증명(성공 정확히 50·음수 0·원장==잔액)** + `GET /api/health` 200·`GET /api/wallet` DB 왕복 확인. 파일: `db/schema.ts`·`db/index.ts`(`prepare:false`)·`lib/wallet.ts`·`app/api/wallet/*`·`tools/walletConcurrency.ts`. ~~`docker-compose.yml`~~(삭제 — Supabase 전환). (검증: Opus 4.8)
3. **모바일 인증**(ID토큰 검증→Bearer→SecureStore, 부팅 익명 유지).

### 13.6 클라이언트 인터페이스 — 오프라인 우선 선구현 (2026-07-01, DB 연결 전)
> 사용자가 DB(Supabase)를 집에서 연결하기로 → 서버 DB 없이도 **완성·검증 가능한 클라이언트 측**을 먼저 만든다.
> 서버가 안 떠도 앱은 오프라인으로 정상 동작(online-first ≠ online-only)해야 하므로, 이 계층은 지금 완성해도 안전.
- **`lib/server.ts`(앱)** — 유일한 서버 연결점. **throw 없는 typed 결과**(광고 계약과 동일). `EXPO_PUBLIC_SERVER_URL`이
  비면(로컬/미배포) 즉시 `{ok:false, reason:'offline'}` — fetch 자체를 안 함. Bearer 토큰은 마일스톤3에서 주입(`setServerToken`).
  메서드: getWallet·spendDiamonds·earnDiamonds(멱등키)·uploadLogs·createTicket·listTickets·uploadSnapshot·telemetry.
  **잔액 표시=캐시, 사용/적립=서버 확정 후에만**(offline이면 "온라인 필요" 안내, 낙관적 반영 안 함 — §2·§4).
- **`lib/deviceLog.ts`(#44 기기 절반)** — 진단 로그 롤링 버퍼(시즌 태그, 최근 10시즌 유지·이전 prune). AsyncStorage 링.
  `lib/log.ts`의 옛 "RevenueCat·자체 로그백엔드 없음(local-first)" 주석은 온라인 전환으로 폐기(취소선 정정).
- **진단 스냅샷 생성기 `data/diagnosticSnapshot.ts`(#45 코어)** — `[max(1,cur-10)..cur]` 시즌의 **비저장 데이터**를
  시드 리플레이로 재계산(선수 이동·성장·드래프트·외인, 뉴스, 경기 결과, 대회 기록) + 로컬 로그 버퍼 → JSON 블롭.
  **순수 클라/엔진이라 PG 무관·tsx로 완전 검증**(재계산 결정론·시즌 범위·크기). 업로드는 `lib/server.ts`가 담당.
- **문의하기 UI `app/support*`(#45 표면)** — 마이페이지 진입 → 목록(빈 상태) → 우상단 [문의] → 등록(카테고리
  오류/건의/질문/기타 + 내용) → 제출 시 스냅샷 비동기 첨부. 관리자 답변 표시. 제출/조회는 `lib/server.ts`(offline면 대기 안내).
4. **`lib/server.ts`**(throw 없는 클라, 캐시표시/서버확정) — 앱서 다이아 적립/사용 E2E.
5. **결제**(verify→consume→환불 웹훅 차감) — 머니패스, 환불→차감 왕복 테스트.
6. **AdMob SSV + 업적**(서명검증·상한·1회).
7. **로그/문의/텔레메트리** → **관리자 대시보드**(맨 마지막, 데이터 존재 후 read-only).

### 13.7 Supabase 연결 (2026-07-02 확정 — Docker 폐기, dev·prod 공통 호스트)
> DB 호스트를 로컬 Docker Postgres → **Supabase Postgres**로 전환(§13.1). ORM/스키마/쿼리는 전부 그대로(Supabase=순정 Postgres).
> Supabase는 **DB 호스트로만** 쓴다 — Auth·Realtime·Storage·PostgREST는 안 쓴다(인증은 §13.1 자체 Bearer, 서버리스 API는 Next.js).
> 결정론 격리 불변(§8)은 유지: 서버 DB는 재화·계정·결제·로그·문의·통계만. 시드/리플레이엔 안 들어간다.

- **비밀은 `server/.env.local`**(gitignore됨, 커밋 금지 — M4). `.env.example`은 양식 견본만.
- **연결 문자열이 3종**(Supabase 대시보드 → Project Settings → Database):
  | 용도 | 연결 | 포트 | prepared stmt | 비고 |
  |---|---|---|---|---|
  | **런타임**(Vercel 서버리스 API·`db/index.ts`) | **Transaction 풀러** | 6543 | ✗ | PgBouncer transaction 모드 → `postgres()` 옵션에 **`prepare:false` 필수**(없으면 런타임 에러). 서버리스 커넥션 폭발 방지 |
  | **마이그레이션**(`drizzle-kit push`·`drizzle.config.ts`) | **Session/Direct** | 5432 | ✓ | DDL·prepared 필요 → 풀러(6543)로 하면 실패. Session 풀러(IPv4) 권장 |
  | **동시성 테스트**(`tools/walletConcurrency.ts`) | 런타임과 동일(6543) | 6543 | ✗ | `FOR UPDATE` 행잠금은 transaction 풀러서 정상 작동 → H2 이중지불 0 증명 |
- **`db/index.ts`**: `postgres(DATABASE_URL, { max: 10, prepare: false })` — `prepare:false`는 풀러 필수이면서 direct에서도 무해(항상 안전한 기본값)이라 무조건 켠다.
- **검증 순서**: `.env.local`(DATABASE_URL=런타임 6543 문자열) → `DATABASE_URL=<5432 문자열> npx drizzle-kit push`(스키마 생성) → `npm run dev`(부팅) → `GET /api/health` 200 → `tools/walletConcurrency.ts`로 H2 이중지불 0.

### 13.8 Vercel 배포 (2026-07-02 프로덕션 라이브)
- **프로덕션 URL**: `https://volleyball-jet-nine.vercel.app` (프로덕션 alias — 배포마다 불변. 배포전용 `...-<hash>-sonws.vercel.app`와 별개).
- **배포 설정**: Vercel 대시보드 GitHub import(`sonwheesung/volleyball`) · **Root Directory=`server`**(루트가 Expo 앱이라 필수) · Framework=Next.js 자동 · env 3개(`DATABASE_URL` 6543 풀러·`SESSION_JWT_SECRET`·`ADMIN_TOKEN`, Production+Preview). `main` push마다 자동 재배포.
- **실환경 검증(Opus 4.8)**: 공개 URL `GET /api/health` 200 + `GET /api/wallet` **Vercel 서버리스 → Supabase 6543 풀러 DB 왕복 정상**(balance:0). 서버리스에서 `prepare:false` 필수 확인.
- **앱 연결**: 루트 `.env`의 `EXPO_PUBLIC_SERVER_URL=https://volleyball-jet-nine.vercel.app`(비밀 아님 → 커밋). 비면 오프라인 모드(§13.6). dev에서 로컬 서버로 바꾸려면 `.env.local`에 `EXPO_PUBLIC_SERVER_URL=http://localhost:3000` 오버라이드(단 실기기·에뮬레이터는 localhost 불가 → Vercel URL 사용).
- **TODO(출시 전)**: DB 비밀번호 회전(개발 중 채팅 노출분) → Supabase reset 후 `.env.local`·Vercel env 갱신. 2FA는 계정에 활성화됨(복구코드 보관 완료).

### 13.9 데이터 보관·파기 (법정 — 2026-07-02 조사)
> 결제·개인정보 보관은 **추정 금지 — 실제 법령 조사**(전자상거래법 시행령 제6조). 근거: law.go.kr·easylaw.go.kr.

- **법정 보존기간**(전자상거래 등에서의 소비자보호법 시행령 §6):
  | 기록 | 보존 |
  |---|---|
  | 대금결제·재화 공급 | **5년** |
  | 계약·청약철회 | **5년** |
  | 소비자 불만·분쟁처리(문의하기) | **3년** |
  | 표시·광고 | 6개월 |
- **핵심 함의**: 사용자가 **계정을 삭제해도 결제 원장(WalletLedger reason=purchase/refund·Purchase)은 5년 보존 의무.** 개인정보보호법상
  목적달성 시 파기가 원칙이나, **법정 보존기간 동안은 거래주체 식별정보를 동의철회에도 보존 가능**(합법 예외).
- **설계**:
  1. **계정삭제 = 소프트삭제**(`User.deletedAt`) — 로그인/플레이는 막되 결제 원장은 유지. 개인정보 최소화(displayName 등 비필수 필드는 파기 가능).
  2. **보관기간 만료 파기 잡** — §13.10 크론 스케줄러가 티어별 경과분을 hard-purge(구현).
  3. **개인정보 처리방침 고지** — 출시 시 앱·스토어에 보존기간 명시(스토어 심사 필수).
- **다이아 감사(사용자 요청)**: 모든 획득/사용을 `WalletLedger`에 `reason`+`ref`로 남겨 **"언제·어떻게·얼마"**를 추적. 결제/환불 원장은 **5년 보존**(법정+수입), 게임경제 원장(ad/업적/전지훈련)은 2년 후 파기(재무 아님). balance는 영속 컬럼이라 원장 일부 파기돼도 잔액 무결(fold 재계산 안 함).

### 13.10 삭제 스케줄러 + 수입 롤업 (2026-07-03 — 데이터 수명주기)
> 데이터 폭증 방지: **필요없는 로그는 파기, 수입 집계는 영구.** 크론 방식은 조사(Vercel Hobby=일1회 크론, 무료·시간 부정확 OK — 파기는 시간 민감 아님).

- **보관 티어**(`server/lib/retention.ts` 단일 소스 — `RETENTION_DAYS`):
  | 데이터 | 테이블 | 보관 | 비고 |
  |---|---|---|---|
  | 결제·환불 원장 | walletLedger(reason=purchase/refund) | **5년(1825d)** | 법정+수입 |
  | 게임경제 원장 | walletLedger(그 외 reason) | 2년(730d) | 재무 아님·벌크 |
  | 문의(분쟁) | tickets(미래) | 3년(1095d) | 법정 |
  | 서버 진단로그 | logs(미래) | 90d | 유지보수·벌크 |
  | 텔레메트리 원본 | heartbeat(미래) | 90d → 일집계 영구 | DAU/플레이타임 |
  | **수입 일집계** | **statsDaily** | **영구(파기 안 함)** | 원본 파기돼도 총수입 생존 |
- **스케줄러**: `vercel.json` crons → `POST /api/cron/purge`(매일). **`CRON_SECRET` Bearer 검증**(Vercel이 크론콜에 자동 첨부 — 외부 무단호출 차단). 순서: ① 어제치 **롤업**(결제→statsDaily 매출/카운트) → ② 티어별 **파기**(경과 기준 delete). 각 단계 typed 결과·count 반환, throw 없음.
- **수입 대시보드(사용자 요청 — "총 수입 영구 보관")**: `statsDaily`(proj_code, date, revenueKrw, purchaseCount, newUsers…)는 **절대 파기 안 함**. 원본 결제가 5년 뒤 사라져도 **일별 매출 합 = 총수입**이 영구 생존 → 관리자 대시보드(#46)가 즉시 조회(5년 스캔 불필요). KRW 매출은 `Purchase` 테이블(#43) 연결 시 완성(지금은 뼈대 — 결제 원장 카운트/신규유저).
- **파기 안전**: 파기는 **경과 기준 delete만**(현재 데이터 무영향). 결제 원장 5년은 수년간 트리거 안 됨. 파기 전 반드시 롤업 선행(집계 유실 방지). 운영 마이그레이션 주의(§13.9 소프트삭제)와 별개 — 이건 시간경과 정리.
- **크론 보안**: `CRON_SECRET`을 **Vercel env에도 설정**해야 Vercel이 크론콜에 `Authorization: Bearer`를 자동 첨부하고 라우트가 검증한다(미설정 시 라우트는 통과시키되 무방비 — 출시 전 필수 설정). 스케줄 `0 18 * * *`(=3am KST) 일 1회(Hobby 허용).

### 13.11 운영 설정 — 버전 게이트 + 서버 점검 (`server_setting`, 2026-07-03)
> **전부 DB로 저장·서버 조회**(사용자 원칙 — 앱 로컬 신뢰 금지 [[server-authoritative-currency]]). 스토어 강제업데이트에 의존하지 않고 DB로 우회.

- **`server_setting`**(게임별 1행, `proj_code` PK FK): `minVersion`(미만=강제 업데이트·진입 차단)·`latestVersion`(미만=소프트 안내)·`android/iosStoreUrl`·`maintenance`(bool)·`maintenanceTitle`·`maintenanceBody`·`updatedAt`. 관리자(#58)가 갱신.
- **부팅 게이트(구현 예정 #56·#57)**: 앱 진입 시 **단일 `/api/bootstrap`** 조회 → `{maintenance, version, announcements}`. 루트 레이아웃 순서 **점검 차단 → 강제버전 차단 → 로그인 벽 → 게임**. 공지사항은 기간제·앱 진입 시에만(무푸시 관전형 유지).
- 스키마·시드('volleyball' 1행, maintenance=false)는 이번 커밋에 완료. 조회 엔드포인트·클라 게이트는 후속.
