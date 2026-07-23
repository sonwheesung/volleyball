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
| 결제 검증 | ~~Vercel 단독 직접~~ → **RevenueCat 게이트웨이**(2026-07-03 §13.18) | RC=검증·웹훅·엔타이틀먼트 |
| 결제 저장 | **다이아 지급=우리 원장** · 재무진실=RC 대시보드 | storeTxnId 멱등·웹훅+confirm 폴백 |
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
- **멱등 재시도는 *현재* 잔액을 반환(2026-07-06 버그수정, 검증 Opus 4.8)** — `applyWalletTx`가 중복키를 만나면 재적용은 안 하되
  반환 잔액은 원장의 그 거래 시점 `balanceAfter`(스냅샷)가 **아니라 지금 `users.balance`**를 읽어 준다. 스냅샷을 반환하면 *원 거래
  이후의 다른 거래*(지출·적립)가 반영 안 된 stale 잔액으로 클라를 덮어써 split-brain 표시가 난다. **에뮬 재현**: 환영 +1000 → 캠프
  −900 = 100인데, 전지훈련 화면 재진입이 `claimWelcomeDiamonds`(계정당 멱등)를 재호출 → 서버가 옛 1000을 반환 → 화면이 100을
  1000으로 되돌림(서버 spend 게이트는 안전해 무료강화는 아니나, 표시가 실제보다 많아 "다이아 부족" 혼란). 가드 `server/tools/_dv_walletreplay.ts`
  (라이브 dev DB, A/B로 원장 balanceAfter=1000 vs 수정본 100 대조 — 오라클 민감도 증명).
- **동시 same-key 충돌은 error 아닌 dedup으로 수렴(2026-07-17, prod 샌드박스 실결제 실측 — 사실상 매 결제 발생)** — 순차 재시도(선지급→후시도)는
  `applyWalletTx` dup 선조회가 걸러 주지만, **동시**에 같은 키 2건이 들어오면 둘 다 dup 선조회를 통과한 뒤 insert 단계에서 `ledger_proj_idem_uniq`
  유니크 충돌로 진 쪽 트랜잭션이 throw한다(RC 웹훅↔confirm 폴백이 ~100ms 내 동시 도착). 구현은 `applyWallet` catch가 무조건 `{ok:false, reason:'error'}`를
  반환해 (a)confirm이 지면 앱이 500(결제 실패 UX)·(b)웹훅이 지면 RC 불필요 재시도였다(돈은 정확 — 이중지급 0). **수정: catch가 `(proj, 키)` 원장 행을 재조회해
  존재하면**(=경쟁자가 이미 지급 완료) **`{ok:true, applied:false, balance:현재 잔액}`으로 수렴**(dup 경로와 동형 — balanceAfter 스냅샷 아닌 현재값,
  split-brain 방지). 유니크 충돌이 아닌 진짜 오류(DB 다운·FK — 키 행 없음)나 재조회 자체 실패는 현행대로 error(오류를 성공으로 위장 금지). 가드 `server/tools/walletConcurrency.ts`
  H2b(동시 2건: applied 1·dedup 1)·H2c(3방향: applied 1·dedup 2), 변이(구로직 catch)로 A/B 민감도 증명(진 쪽 error → bothOk=false FAIL).
- **멱등키**(이중지급/이중차감 차단) — 서버 UNIQUE는 `(proj_code, idempotency_key)`라 **키에 `userId`를 넣어 전역 유일**하게 만든다(안 넣으면 다른 유저가 같은 achId 수령 시 충돌):
  | 거래 | 멱등키(구현 2026-07-03) | 재설정 대칭 |
  |---|---|---|
  | 구매→다이아 | `purchase:<userId>:<transactionId>` | 스토어 transaction_id (P2) |
  | 광고→다이아 | `ad:<userId>:<dayIndex>:<count>` (스텁) → EAS `ssv:<userId>:<ssvTxId>` | 슬롯 결정론 — 같은 날 같은 슬롯 재시도만 dedupe |
  | 업적→다이아 | `ach:<userId>:<achId>` — **에폭 없음(계정 평생 1회)** | **비대칭 의도**: 세이브 리셋 후 재달성해도 재수령 0(파밍 차단). ↔ camp |
  | 전지훈련 차감 | `camp:<userId>:<saveId>:<season>:<playerId>` | **saveId(=walletEpoch, 세이브 생성 128비트 nonce)** 포함 → 세이브 지우고 새로 시작하면 같은 (season,playerId)라도 새 키 → 무료 재강화 버그 차단 |
- **결정론 격리(중요)**: 지갑은 메타라 시드 입력에 **절대 안 들어간다**. **전지훈련 차감은 서버 차감 성공 뒤에만 `campLog` 기록**
  → 서버 잔액과 로컬 campLog가 어긋날 일(split-brain) 자체가 없음. 잔액 *표시*만 캐시. (campLog = 로컬 시뮬 진실, 리플레이 재적용 — §MONETIZATION 11.2.)
  **재생 시 campLog만 로컬로 읽고 원장을 재조회하지 않는다** — 이 선이 결정론 격리의 성립 조건(독립리뷰 2026-07-03 §④-10).
- **업적 보상 배치 적립 `/api/wallet/earn-batch`(2026-07-07, 검증 Fable 5)**: 업적 수령은 미수령 업적 **여러 개를 한 번에** 지급한다.
  구 구현은 업적마다 단건 `/api/wallet/earn`을 **순차 await** → 수령당 (HTTPS+Vercel 콜드스타트+`requireUserId`(ensureUser 재실행)+
  `applyWallet` 트랜잭션 ~8왕복). Supabase 풀러 ~0.3~0.7s/왕복 × 직렬 → **4개 수령 ≈ 40s**(실측 진단). 배치 라우트는
  **`requireUserId` 1회 + `db.transaction` 1개** 안에서 N개의 값싼 in-tx `applyWalletTx`로 처리해 **≈2~4s**로 단축.
  · body `{ items: [{ amount, idempotencyKey, ref? }] }`, **reason은 서버가 `'achievement'` 강제**(임의 reason 불가 — ad/welcome/purchase 캡을 스코프 밖으로 격리),
    items ≤ 64. 각 amount는 `earnAmount('achievement',_)`로 서버 클램프([1,1000]), 하나라도 손상되면 전체 400.
  · **응답 유실 UX(운영 사고 2026-07-11)**: 배치+콜드스타트가 클라 기본 타임아웃 8s를 넘겨 "서버는 지급 완료·클라는 연결 오류 표시"가
    났고, 재시도는 멱등 dedup(applied:false)이라 "수령할 보상 없음"으로 보였다(재화는 무손상 — 이중지급 없음). 수정: ①earn-batch 클라
    타임아웃 20s ②전건 멱등 재시도(granted 0·confirmed>0)면 reason `'already'` → "이미 수령된 보상, 잔액에 반영" 안내 ③실패 문구를
    "이미 지급됐을 수 있어요 — 재시도해도 중복 지급 없음"으로 교정. 원칙: **멱등 재화 API의 클라 실패 문구는 '실패 확정'처럼 쓰지 않는다.**
  · **평생합 캡 보존**: 트랜잭션 진입 전 `sumReason(userId,'achievement')`를 **1회** baseline으로 읽고, 순수 함수 `allocateAchGrants(used, wanted[])`가
    `remaining = ACH_LIFETIME_CAP − used − grantedSoFar`를 **아이템 누적**으로 배분(부분 지급=applied·capped:false, 소진=grant0·capped:true=단건 409 cap 동의).
  · **멱등 보존**: 클라 `idempotencyKey`는 `achKey(userId,id)` 그대로, 서버가 `walletIdemKey(userId,_)`로 네임스페이스 → achId별 계정평생 dedup·교차유저 선점 차단 불변.
    응답 `{ ok, results:[{applied, capped?}], balance }`(results는 items와 동순서). throw 시 `{ ok:false, reason:'error' }`(500) → 클라는 아무것도 확정 안 하고 `syncWallet`로 수렴(원자적, 재수령은 서버가 dedupe).
  · **단건 `/api/wallet/earn`은 불변**(광고/환영 경로). 가드: 순수 조각(누적 배분·키 네임스페이스)은 `server/tools/_dv_earnbatch.ts`(DB 무의존, A/B 자가검증), 트랜잭션은 기존 `_dv_achearn` 라이브 가드.

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
| DB/ORM | **Drizzle + Postgres**(~~로컬 Docker `postgres:16`~~ → **Supabase Postgres**, ~~dev·prod 공통~~ **prod=Supabase 호스팅 / dev=로컬 Supabase**(2026-07-10 정정 §13.7·§13.7.1) — 2026-07-02 사용자 결정) | ~~SQLite~~ 폐기 — SQLite는 단일라이터라 **동시성 버그(이중지불)를 로컬서 가림**(리뷰 C2/H2). dev==prod로 Postgres 고정. **호스트를 로컬 Docker→Supabase로 전환**(개발부터 실 Postgres라 H2 동시성이 로컬서 그대로 드러남 — Docker Desktop 의존 제거). Drizzle=서버리스 콜드스타트 가벼움·SQL 우선(엔진 바이너리 없음). ⚠ **연결 규칙**(§13.7): 런타임=Transaction 풀러(:6543)+`prepare:false`, 마이그레이션=Session/Direct(:5432) |
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
`/api/health` · `/api/auth/login`(ID토큰→Bearer)·`/refresh` · `GET /api/wallet`(balance+최근 원장) · `POST /api/wallet/spend`·`/earn`(멱등키+**행 잠금 트랜잭션**) · ~~`POST /api/purchase/verify`·`/webhook/google`(RTDN)·`/apple`(ASSN)~~ → **정정(2026-07-03 §13.18)**: `POST /api/purchase/webhook/revenuecat`(RC 웹훅, Authorization 시크릿 검증 → applyWalletTx purchase/refund)·`POST /api/purchase/confirm`(클라 폴백, storeTxnId → RC REST 재검증 → 같은 키 지급) · `POST /api/ad/ssv`(AdMob 서명 검증 — RC 무관, 우리 몫) · `POST /api/log` · `/api/ticket`(create/list)·`/api/admin/ticket`(reply/snapshot) · `POST /api/snapshot` · `POST /api/telemetry` · `/api/admin/{coupon,announcement,setting,refund}` · 관리자 대시보드 페이지(인증 보호).

### 13.4 리스크 레지스터 (리뷰 지적 — 착수 전 반드시)
- **H1 결제 소비/환불**: DB `status:consumed` ≠ 실제 consume. 구글은 **미consume 소비성 구매를 ~3일 뒤 자동 환불**. 흐름=verify→grant(원장, transactionId 멱등)→**Play `purchases.products.consume`**(애플=finish)→consumed. **환불/차지백 웹훅→지갑 음수 차감 필수**(정책: 음수 허용+spend는 balance 게이트 → 환불된 고래가 계속 못 씀). **게이트 방향 명확화(2026-07-16, 결제표면 감사 P1)**: "spend는 balance 게이트"는 **차감(delta<0)에만** 적용된다는 뜻 — 음수 잔액 유저의 **적립(delta>0)은 부채 상환이라 항상 통과**한다. 구현이 delta 부호를 미구분해 적립까지 막던 결함을 교정(§13.17 P0-1 정정). 즉 환불된 고래는 **더 못 쓰되(spend 차단)**, **광고/업적/쿠폰으로 빚을 갚아 0으로 복귀는 가능**.
- **H2 이중지불 동시성**: 멱등키는 *같은 키 재시도*만 막음. 서로 다른 동시 spend 2건이 각자 balance 읽고 통과→초과지출. **`SELECT … FOR UPDATE` 행 잠금 트랜잭션 + `balance` 원자 갱신 + `CHECK(balance>=0)` 백스톱**. 동시 이중지불 유닛테스트로 증명(Postgres에서만 드러남).
- **H3 업적 다이아=클라 신뢰**: 서버가 시뮬 재실행 안 함(결정론 격리)→업적 자작 가능. **불가피 → 설계로 수용**: 업적/광고 다이아는 **1회·저가·평생 합계 상한**, **구매만 고가 소스**. MONETIZATION에 명시(이미 §2.5 유저 관대·§6 반영). **구현(2026-07-06)**: "평생 합계 상한"이 이제 실제로 구현됨 — earn 라우트가 `sumReason` 원장 합으로 `ACH_LIFETIME_CAP=20000`을 강제(그 전엔 문서 문구만 있고 코드는 호출당 클램프뿐이었음, A1). 정본 §13.12 P0-2.
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

### 13.7 Supabase 연결 (2026-07-02 확정 — ~~Docker 폐기, dev·prod 공통 호스트~~ · 2026-07-10 정정: dev는 로컬 Supabase 부활)
> DB 호스트를 로컬 Docker Postgres → **Supabase Postgres**로 전환(§13.1). ORM/스키마/쿼리는 전부 그대로(Supabase=순정 Postgres).
> Supabase는 **DB 호스트로만** 쓴다 — Auth·Realtime·Storage·PostgREST는 안 쓴다(인증은 §13.1 자체 Bearer, 서버리스 API는 Next.js).
> 결정론 격리 불변(§8)은 유지: 서버 DB는 재화·계정·결제·로그·문의·통계만. 시드/리플레이엔 안 들어간다.
>
> **정정(2026-07-10, 사용자 결정)**: ~~dev·prod 공통으로 Supabase 호스팅, 로컬 Docker 폐기~~ →
> **dev에 한해 로컬 Supabase(Supabase CLI `supabase start`, Postgres 단독) 부활**. 사유: 무료(호스팅 free-tier 프로젝트가
> 미사용 시 자동 정지되는 성가심 회피) + Docker Desktop 하나로 로컬 DB 완결. **prod는 Supabase 호스팅 유지**(아래 3종 연결 규칙은
> **호스팅 prod 전용** — 로컬은 PgBouncer 풀러가 없어 6543/`prepare:false`·5432 구분이 없다). dev 셋업 절차는 §13.7.1.

- **비밀은 `server/.env.local`**(gitignore됨, 커밋 금지 — M4). `.env.example`은 양식 견본만.
- **연결 문자열이 3종**(Supabase 대시보드 → Project Settings → Database) — **호스팅 prod 전용**(로컬 dev는 §13.7.1: 풀러 없음, DB 하나뿐):
  | 용도 | 연결 | 포트 | prepared stmt | 비고 |
  |---|---|---|---|---|
  | **런타임**(Vercel 서버리스 API·`db/index.ts`) | **Transaction 풀러** | 6543 | ✗ | PgBouncer transaction 모드 → `postgres()` 옵션에 **`prepare:false` 필수**(없으면 런타임 에러). 서버리스 커넥션 폭발 방지 |
  | **마이그레이션**(`drizzle-kit push`·`drizzle.config.ts`) | **Session/Direct** | 5432 | ✓ | DDL·prepared 필요 → 풀러(6543)로 하면 실패. Session 풀러(IPv4) 권장 |
  | **동시성 테스트**(`tools/walletConcurrency.ts`) | 런타임과 동일(6543) | 6543 | ✗ | `FOR UPDATE` 행잠금은 transaction 풀러서 정상 작동 → H2 이중지불 0 증명 |
- **`db/index.ts`**: `postgres(DATABASE_URL, { max: 10, prepare: false })` — `prepare:false`는 풀러 필수이면서 direct에서도 무해(항상 안전한 기본값)이라 무조건 켠다.
- **검증 순서**: `.env.local`(DATABASE_URL=런타임 6543 문자열) → `DATABASE_URL=<5432 문자열> npx drizzle-kit push`(스키마 생성) → `npm run dev`(부팅) → `GET /api/health` 200 → `tools/walletConcurrency.ts`로 H2 이중지불 0.

#### 13.7.1 로컬 dev DB 셋업 (2026-07-10 — 로컬 Supabase, 무료)
> dev는 로컬 Supabase Postgres(단독)로 돈다. prod(위 3종 연결·§13.8)와 완전 분리 — 로컬은 **풀러가 없어** 6543/`prepare:false`·5432 구분이 없고 DB 하나뿐이다.

1. **Docker Desktop** 실행(로컬 Supabase 컨테이너 호스트).
2. `cd server && npx supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor`
   — Postgres 컨테이너(`supabase_db_server`)만 기동(Auth·REST·Studio 등 나머지 서비스는 제외 — 우린 DB만 쓴다). `supabase/config.toml`은 이미 초기화됨.
3. **DB_URL** = `postgresql://postgres:postgres@127.0.0.1:54322/postgres`(로컬 고정).
4. 스키마 적용: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx drizzle-kit push`(11테이블). 로컬엔 풀러가 없으니 런타임/마이그레이션 URL이 동일하다.
5. **`server/.env.development.local`** 생성(`DATABASE_URL`·`MIGRATE_DATABASE_URL`=위 로컬 URL). Next dev는 `.env.development.local`을 `.env.local`(운영 크리덴셜)보다 **우선** 로드하므로 `npm run dev`가 자동으로 로컬 DB를 쓴다. `.env.local`(운영)은 그대로 둔다.
6. `npm run dev`(:3000) → dev 로그인→지갑 왕복으로 로컬 DB 확인.

- **가드(`tools/_*.ts`)도 dev DB를 때린다**: `tools/_env.ts`가 `.env.development.local`(있으면) 우선 → 없으면 `.env.local` 보충으로 주입(각 가드의 첫 import). 셸에 `DATABASE_URL`이 없으면 로컬 dev가 이긴다.
  **운영 DB를 명시적으로 검증**해야 하면 실행 셸에서 `DATABASE_URL=<prod 6543 문자열> npx tsx tools/_dv_*.ts`로 오버라이드(이미 설정된 키는 안 덮으므로 그게 이긴다).

### 13.8 Vercel 배포 (2026-07-02 프로덕션 라이브)
- **프로덕션 URL**: `https://volleyball-jet-nine.vercel.app` (프로덕션 alias — 배포마다 불변. 배포전용 `...-<hash>-sonws.vercel.app`와 별개).
- **배포 설정**: Vercel 대시보드 GitHub import(`sonwheesung/volleyball`) · **Root Directory=`server`**(루트가 Expo 앱이라 필수) · Framework=Next.js 자동 · env 3개(`DATABASE_URL` 6543 풀러·`SESSION_JWT_SECRET`·`ADMIN_TOKEN`, Production+Preview). `main` push마다 자동 재배포.
- **실환경 검증(Opus 4.8)**: 공개 URL `GET /api/health` 200 + `GET /api/wallet` **Vercel 서버리스 → Supabase 6543 풀러 DB 왕복 정상**(balance:0). 서버리스에서 `prepare:false` 필수 확인.
- **앱 연결**: 루트 `.env`의 `EXPO_PUBLIC_SERVER_URL=https://volleyball-jet-nine.vercel.app`(비밀 아님 → 커밋). 비면 오프라인 모드(§13.6). dev에서 로컬 서버로 바꾸려면 `.env.local`에 `EXPO_PUBLIC_SERVER_URL=http://localhost:3000` 오버라이드(단 실기기·에뮬레이터는 localhost 불가 → Vercel URL 사용).
- **TODO(출시 전)**: DB 비밀번호 회전(개발 중 채팅 노출분) → Supabase reset 후 `.env.local`·Vercel env 갱신. 2FA는 계정에 활성화됨(복구코드 보관 완료).
- **비밀·환경변수 회전 체크리스트(양쪽 동시 갱신 필수 — 한쪽만 돌리면 로그인/검증 전면 실패)**:
  - **구글 클라이언트 ID 회전 시 양쪽 동시 갱신**: 앱 `.env`의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`(빌드 인라인 → EAS 재빌드) **=** 서버 `GOOGLE_OAUTH_CLIENT_IDS`(콤마구분 목록에 같은 웹 클라이언트 ID 포함, `server/lib/googleVerify.ts` audience). 한쪽만 회전하면 audience 불일치로 **모든 구글 로그인이 fail-closed**로 거부된다. (SESSION_JWT_SECRET·ADMIN_TOKEN 회전은 위 §13.8 배포 env — 서버 단독이라 별개.)

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
     → **구현 정본 [AUTH_SYSTEM] §7(#119, 2026-07-15)**: 탈퇴=가명처리(providerId 비복원 파기+deletedAt+displayName/기기정보 null),
       `DELETE /api/account`(Bearer 필수·멱등), 미들웨어 라이브니스 게이트로 탈퇴 토큰 401. 연령 게이트(만14세)는 AUTH_SYSTEM §8. **`purgeExpired`는 `users` 미포함**(탈퇴 시 즉시 가명화라 잔존 PII 없음 — §7.5).
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

### 13.12 다이아 서버 진실화 (#42, 2026-07-03 — 독립 리뷰 5구멍 반영)
> **왜**: 앱 스토어의 다이아 변이 3곳(`watchAdForDiamonds`·`claimAchDiamonds`·`trainingCamp`)이 로컬 산술로 즉시 변이 → 서버 미경유(split-brain 위험). 사용자 최상위 원칙([[server-authoritative-currency]])대로 **서버 확정 후에만 반영**으로 전환. 독립 리뷰(general-purpose, 2026-07-03)가 뼈대 승인 + **5개 정합성 구멍**을 "스텁 핑계로 미루지 말라"고 지적 → 전부 닫음.

- **서버측 금액 권위(P0-2)** `server/lib/econ.ts`: 고정값 거래는 **서버가 금액을 계산**(클라 `amount` 무시). `ad`=+50·`camp`=~~−300~~ **−200** 서버 상수(~~2026-07-06 900→300 인하~~ → **정정 2026-07-23**: 문서 잔존 드리프트 — 실제 `server/lib/econ.CAMP_COST`는 **2026-07-17 300→200 인하**됨(MONETIZATION §11.6·econ.ts 실측). engine/diamonds.ts 락값 손복제, 드리프트 가드 `_dv_walletauth`가 대조). `achievement`만 클라 금액이되 ~~**평생합 상한 5000 캡**~~ → **정정(2026-07-06, 발견·검증=Fable 5 / 수정·문서=Opus 에이전트)**: 문서의 "평생합 5000 캡"은 실제론 **호출당 클램프**(`Math.min(a, 5000)`)였을 뿐 **평생 합계 체크는 미구현**(A1)이었고, 값 5000 자체도 카탈로그 정당 총합 **16,220**(86개, 실측 2026-07-06)과 **모순**(A2 — 문서대로면 정당 유저 11,220 손실)이었다. → **재설계**: **`ACH_MAX_PER_CLAIM=1000`**(호출당 클램프 = 카탈로그 최대 단건 — 한 호출이 그 이상 못 뜯음) + **`ACH_LIFETIME_CAP=20000`**(평생 합계 상한 = 16,220 + 확장 헤드룸). earn 라우트가 `sumReason(userId,'achievement')`(원장 delta 합·서버 진실)로 평생합을 **실제로 강제**: `remaining≤0`이면 409 `cap`(ad 캡과 동일 채널)·아니면 남은 만큼 잘라 지급. 동시 2건 레이스는 최대 per-claim(1000) 초과 가능하나 ad 백스톱과 같은 사전 체크 수준으로 수용(원장 멱등·잔액==Σledger 불변). **정당 유저는 총합 16,220 < 20,000이라 절대 안 닿음**(치터 전용 blast-radius 바운드). 라이브 가드 `_dv_achearn`(평생합 경계·409)·순수 가드 `_dv_walletauth`(호출당 클램프 + 카탈로그 총합≤캡 드리프트). 라우트 **reason 화이트리스트**(earn∈{ad,achievement,welcome}·spend∈{camp}) — 클라의 'purchase' 사칭 차단. `ad`는 서버가 오늘 원장 count ≥8 백스톱(스텁 멱등키 무한증가 방지).
- **광고 쿨다운 서버 백스톱(2026-07-17 사용자 결정, 결제 런칭 테스트 중)**: earn 라우트가 `reason==='ad'`일 때 하루 8회 상한(`countReasonToday`)에 더해 **최근 'ad' 원장 행 `created_at`이 `AD_COOLDOWN_MS`(2시간, `server/lib/econ.ts` 손복제) 이내면 409 `cooldown` 거부**(신 헬퍼 `lastReasonAt(userId,'ad')` — `ledger_user_idx` 활용, 날짜 무관 최근 1건이라 자정 넘는 쿨다운도 정확). ~~기존엔 하루 상한만 서버 강제~~였고 **쿨다운은 폰 로컬(`engine/diamonds.canWatchAd`)만** 검사 → 조작 클라가 쿨다운을 무시하고 상한(8회)까지 연타 가능했다. 이제 원장 시각 기반이라 **폰 시계·클라 조작 무력화**. 클라는 서버 'cooldown' 사유를 'cap'과 **구분**해 "다음 광고까지 잠시 기다려 주세요" 안내(store watchAdForDiamonds → mypage). 라이브 가드 `_dv_achearn`(ad 1회 성공→즉시 2회째 cooldown·원장 created_at 2h전 UPDATE 후 통과·A/B 백스톱 제거 시 통과 논증).
- **applied 게이팅 + 재진입 락(P0-1)**: `applyCampCourse`는 비멱등(+2/호출) → 버튼 연타로 서버가 dedupe(`applied:false`, ok:true)를 반환해도 클라가 재적용하면 무료 +4. **스탯/campLog는 `applied===true`에서만** 반영. store `walletBusy` in-flight 래치로 동시 호출 자체를 차단.
- **아웃박스(P0-4)**: camp만 spend 성공 후 로컬 스탯 적용 전 크래시 시 돈만 증발(earn은 getWallet 자가치유되나 camp는 로컬 결정론 변이라 durable-loss). 서버 호출 **전에** `pendingCamp`(같은 멱등키) persist → 성공 시 적용+clear → 재기동 시 `reconcilePendingCamp`가 같은 키로 재호출(dup→applied:false=이미 과금 확인) 후 스탯 적용·clear.
  - **상설 가드(발견·검증=Fable 5 / 가드·문서=Opus 에이전트, 2026-07-07)**: `tools/_dv_campoutbox.ts` — 실 store 액션(`trainingCamp`/`reconcilePendingCamp`/`persist.rehydrate`)을 구동하고 `lib/server`를 제어형 스텁으로 갈아끼워 ①정상 ②크래시 복구(dup applied:false→적용·이중과금 0) ③오프라인 pending 유지 ④이미적용(campTrained→spend 미호출·+4/+14 아님, A/B로 게이트 무력화 시 이중적용 실측) ⑤campLog 시드 재적용 ⑥게이트 봉인. README 루틴 등록.
- **캐시 수렴(P0-3)**: `insufficient`/`error`/`unauthorized` 응답은 balance를 드롭 → 스테일 캐시가 못 고쳐짐. store가 실패 시 **`syncWallet()`(getWallet)로 서버 잔액 리싱크**. 로그인 성공 직후 + 앱 포그라운드 복귀 시에도 syncWallet.
- **업적 비대칭 결정(P0-5)**: `ach:<userId>:<achId>`는 에폭 없음 = **계정 평생 1회**. 세이브 리셋 후 재달성해도 재수령 0(파밍 차단). camp는 saveId 에폭으로 재과금 허용(다시 돈 냄=정당). 이 비대칭은 **의식적**(업적=구단주 평생 트로피, 재플레이가 재지급 아님). claimAch는 **업적별 개별 earn 호출**(배치 아님) — achId별 dedup 정확.
- **saveId(=walletEpoch)**: 세이브 생성 시 128비트 nonce(store, Date.now/Math.random 허용 — 엔진 아님). 영속(SAVE_SYSTEM +1필드=54), migrate 없으면 생성. camp 멱등키 세이브 스코프.
- **검증(Opus 4.8)**: `tools/_dv_walletauth.ts`(순수 — 멱등키 빌더 유일성·세이브리셋 비충돌·applied 게이팅·econ 금액권위 A/B) + 라이브 E2E(실 Vercel 서버: camp amount=1 보내도 서버상수 강제[−900→−300 인하]·이중 spend 2번째 applied:false·insufficient 리싱크). 앱/서버 tsc 0.
- **파일**: `server/lib/econ.ts`(신)·`server/lib/wallet.ts`(countReasonToday·'coupon' reason)·`server/app/api/wallet/{earn,spend}/route.ts`·`lib/walletKeys.ts`(신, 순수)·`lib/server.ts`(earn/spend ref·cap reason)·`store/useGameStore.ts`(async 3함수+syncWallet+reconcilePendingCamp+applyCampLocal+saveId/pendingCamp/walletBusy)·`store/saveMigration.ts`(saveId/pendingCamp 정규화, 58필드)·`components/BootGate.tsx`(userId 확보/포그라운드 syncWallet)·`app/(tabs)/mypage.tsx`·`app/training-camp.tsx`.
- **EAS 승격 잔여**: 광고 금액/진위=AdMob SSV 서버검증, 업적=서버 재계산(현 캡만), 결제=영수증 검증(#43). 구조(서버확정·멱등·잔액게이트·applied게이팅·아웃박스)는 지금 실물과 동일.
- **우편함 수령 reason `mail`(2026-07-23 설계)**: 운영 보상·CS 개별 지급·이벤트 채널. 수령=`applyWalletTx(+amount,'mail',key='mail:<mailId>')`(전용 claim 라우트 — `/earn` 화이트리스트 밖, fail-closed)·통당 캡 `MAIL_MAX_GRANT`·보존 30일·`reason='mail'`은 매출/payer 집계 제외. 첨부 다이아·출석 패스(grantPass 재사용). 미확인 수는 `getWallet` unreadMailCount 편입(별 폴링 금지). 정본 `docs/MAILBOX_SYSTEM.md`.

### 13.13 공지사항 in-app 노출 (#57, 2026-07-03)
> **서버는 이미 완성**(§13.11 — `announcements` 테이블 + `/api/bootstrap`가 활성분 pinned·최신순 반환). 이번은 **앱 표시**만. 무푸시 관전형 유지 — 앱 진입 시에만 조용히 surface.

- **진입 모달**: BootGate가 게이트 통과 후 `boot.announcements` 중 **안 본 것**을 **하나의 리스트/페이징 모달**로(N연발 금지 — 관전형 nag 방지, 리뷰 지적). pinned은 정렬 우선일 뿐 "항상 표시" 규칙 없음.
- **읽음 추적**: 본 공지 id를 **기기 로컬**(`useAuthStore.readAnnouncements`, persist)에 저장 → 다음 실행 시 안 본 것만 모달. **prune는 서버 응답이 있을 때만 매 부팅 현재 활성 id와 교집합**(빈 배열 포함 — 활성 0개면 읽음 목록도 비움), **오프라인(boot=null)엔 스킵**(2026-07-06 정정 — 응답 없는데 prune하면 만료 아닌 공지 읽음까지 지워져 재노출됨). 다기기/재설치 재노출은 **의도된 트레이드오프**(서버 per-user 읽음테이블 불필요 — 관전형에 맞음).
- **재열람**: 마이페이지 → "공지사항" → 활성 공지 전체 목록(읽음 무관). `app/announcements.tsx`. **재열람도 나열된 공지를 읽음 처리**(2026-07-06 정정: 재열람 화면에서 본 공지를 `markAnnouncementsRead` → 다음 부팅 모달 중복 노출 방지 — 관전형 nag 방지 정합).
  - **화면 구조(2026-07-17 정정, 사용자 결정)**: ~~목록에 본문 전체 인라인~~ → **목록은 제목 + (pinned면 📌) + 등록일만**(본문 미노출), **행 클릭 → 상세 화면 `app/announcements/[id].tsx`(제목·등록일·본문)**. 공지·패치노트·개발자 노트(DEVNOTES §3.2) 3화면의 목록↔상세 구조를 통일. 등록일 = bootstrap이 내려주는 `startsAt`(노출 시작일=사용자에게 게시된 시점, devnotes `publishedAt`과 동일 역할)을 `YYYY.MM.DD`로 표시 — bootstrap 응답에 `startsAt` additive 추가(기존 클라 무해). **부팅 게이트 차단성 모달(위)은 무관 — 이 정정은 재열람 목록 화면만.**
- **정정 정책**: 같은 id 본문 수정은 이미 읽은 유저에 재노출 안 됨 → **정정은 신규 공지로**(관리자 운영 규칙).
- **파일**: `components/AnnouncementModal.tsx`(신)·`components/BootGate.tsx`(모달 오버레이)·`store/useAuthStore.ts`(readAnnouncements)·`app/announcements.tsx`(신)·`app/(tabs)/mypage.tsx`(진입점)·`app/_layout.tsx`(라우트).
- **검증 정정(2026-07-06, 발견·검증=Fable 5 / 수정·문서=Opus 에이전트)**: 재열람 화면이 `markAnnouncementsRead` 미호출로 다음 부팅 모달에 중복 노출(F2) → 재열람도 읽음 처리. prune 가드가 `activeAnns.length` 조건이라 활성 0개면 스킵되던 것을 **서버 응답 존재(`boot`) 기준으로 교정**(빈 배열도 prune, 오프라인만 스킵 — F3). 가드 `server/tools/_dv_announce.ts` 상설.

### 13.14 쿠폰 (#58, 2026-07-03 — 독립 리뷰 3구멍 반영)
> 전체용(모두)·개인용(특정 유저) 쿠폰, **둘 다 기간제**. 관리자가 발급(§13.15), 유저가 코드 입력으로 사용. 보상=다이아(서버 진실 — [[server-authoritative-currency]]).

- **스키마(신규 2테이블, Expand-only — [[prod-schema-migration-caution]] generate+migrate)**:
  - `coupons`(id, proj_code FK, `code`, rewardDiamonds int>0, `targetUserId` uuid null=전체·set=개인, startsAt, endsAt, disabled bool, createdAt) — `UNIQUE(proj_code, code)`(정규형=대문자+trim 저장/조회) + `index(proj_code)`.
  - `coupon_redemptions`(id, proj_code FK, couponId FK, userId FK, redeemedAt) — `UNIQUE(proj_code, couponId, userId)`=**유저당 1회** + `index(couponId)`·`index(userId)`.
- **사용 `POST /api/coupon/redeem {code}`**(Bearer→userId) — **단일 트랜잭션(P0-A)**: `redeemCoupon`이 ① 코드 정규화·조회 ② disabled ③ 기간(now∈[starts,ends]) ④ target 있으면 userId 일치(아니면 "유효하지 않은 쿠폰" — 남의 개인쿠폰 존재 은폐) ⑤ 소프트삭제 계정 거부 ⑥ redemption INSERT(`onConflictDoNothing`, rowcount==0=이미 사용) ⑦ `applyWalletTx(tx, +reward, 'coupon', 'coupon:<userId>:<couponId>', ref=code)`를 **한 트랜잭션**에 담음.
- **원자성(P0-A)**: `applyWallet`을 `applyWalletTx(tx,…)`(tx 주입)로 추출하고 `applyWallet`은 얇게 감싸 재사용(중복로직 0). redeem은 자체 `db.transaction`으로 위 전부를 원자화 → "기록만 남고 미지급" 크래시 창 제거. 이중지급은 redemption UNIQUE(직렬화·롤백) + ledger 멱등키 3중 백스톱.
- **앱**: 마이페이지 → "쿠폰 입력" → 코드 입력·등록 → `lib/server.redeemCoupon` → **성공 후 `syncWallet()`로만 캐시 갱신**(낙관적 반영 금지). 결과 reason은 typed(invalid·expired·used·not-eligible·offline). `app/coupon.tsx`.
- **보관기간(P0-C)**: `coupon_redemptions`는 **파기 제외**(활성/무기한 쿠폰 재수령 구멍 차단 — 현 `purgeExpired`가 wallet_ledger만 건드려 기본 안전, 명기). `wallet_ledger reason='coupon'`은 게임경제 원장 2년 티어(결제 아님 → 5년 아님, §13.9 정합).
- **결정론 격리**: 쿠폰 다이아는 balance 합류 순수 재화. camp campLog는 applied 게이팅·saveId 멱등이라 다이아 출처와 무관하게 결정론 불변. 엔진 무파급.

- **정정(2026-07-06, 발견·검증=Fable 5 / 수정·문서=Opus 에이전트)** — 쿠폰 라운드 4건 잠복(공지 라운드와 같은 날·같은 클래스). 상설 가드 `server/tools/_dv_coupon_live.ts`(12항+A/B)로 회귀 봉인:
  - **C1(MED-HIGH) — redeem 익명 폴백**: ~~`/api/coupon/redeem`가 `resolveUserId`(무토큰이면 공유 익명 `dev-user-1`로 폴백)~~ → **`requireUserId`로 교체, null이면 401 `unauthorized`**(§13.17 P0-5 정합). 증상: 세션 만료 유저가 쿠폰 사용 시 "지급 완료"로 보이는데 지급은 익명 버킷에 들어가 **본인 지갑 불변**(split-brain). 클라(`app/coupon.tsx`)는 이미 'unauthorized' 분기("로그인이 만료되었습니다")·`CouponRedeemResult` 타입에도 이미 포함 — 무수정.
  - **C2(MED-LOW) — endsAt date-only KST 함정(공지 F5 형제)**: ~~`new Date(b.endsAt)`(‘YYYY-MM-DD’=UTC 자정=KST 오전 9시라 9시간 일찍 만료)~~ → 공지 라우트의 `normalizeEndsAt`를 **공용 `server/lib/dates.ts`로 추출**(date-only→해당일 `T14:59:59.999Z`=KST 23:59:59.999), 공지·쿠폰 POST·PATCH가 **동일 헬퍼 공유**(startsAt은 무변경).
  - **C3(LOW) — POST 오류 뭉뚱그림**: ~~존재하지 않는 `targetUserId`(FK 위반)도 insert catch에서 전부 409 'duplicate'로 위장~~ → insert **전에** `users`에서 존재 확인(잘못된 uuid 형식은 select 자체가 throw할 수 있어 try로 감싸 실패도 동일 처리), 없으면 **400 `no-such-user`**. insert catch의 'duplicate' 409는 이제 실제 UNIQUE 충돌만. ops 콘솔은 `reason`을 그대로 표시(flash) → 무수정.
  - **C4(LOW) — 기간 판정 클럭 통일**: ~~`redeemCoupon`이 `Date.now()`(JS 클럭)로 기간 비교~~ → 트랜잭션 안에서 **DB `now()` 1회 조회** 후 그 값으로 startsAt/endsAt 비교. 발행측(admin POST)이 startsAt 미지정 시 DB `defaultNow()`를 쓰므로(스큐 회피) **판정도 같은 DB 클럭으로 통일**.
  - ~~**보류(의식적)**: `wallet earn/spend/get` 3종 라우트도 `resolveUserId`(익명 폴백)를 쓰나 … `requireUserId` 통일은 후속 과제.~~ → **완료(2026-07-07 SECURITY #6 — backend-verify 2026-07-15 D3에서 미정정 발견·정리)**: wallet 3종 포함 소비 라우트 전부 `requireUserId`(401) 통일. resolveUserId 호출부 0(AUTH §7.2).

### 13.15 관리자 대시보드 (#58 발급·#57 발행·#56 게이트, 2026-07-03 · **2026-07-04 UI 개편 + #46 통계**)
> 운영 콘솔(1인 운영). Next.js 페이지 + ADMIN_TOKEN 보호 API. 인라인 스타일 + 내장 `<style>`만(외부 스크립트 0, XSS 표면 최소), `noindex`.
> - **경로 은닉(2026-07-04 사용자 요청)**: `/admin` → **`/ops-9f3a2c`**(추측 차단 — 유저가 `/admin` 접근 우려). 실보안은 ADMIN_TOKEN(경로는 보조). `/admin` 라우트 삭제(404).
> - **UI 개편(2026-07-04)**: 폼 나열 콘솔 → **로그인 게이트 화면 → 사이드바 대시보드**(다크 모던, Vercel/Tremor 참조). 상세/수정/삭제는 **행 클릭→팝업 모달**(리스트 화면과 분리 — 사용자 지적 "조회에서 등록 별로"). 쿠폰·공지: 행 클릭→상세(정의목록)→모달 안에서 수정/삭제. 티켓: 유형·상태 필터(기본 전체·미답변), 환불 컨트롤은 **category==='refund'에만**(오류 티켓에 환불 안 뜸).
> - **CRUD 피드백 일관화(2026-07-11, 검증=Fable / 수정·문서=Opus 에이전트)**: 모든 저장/생성/수정/삭제/상태변경/환불 액션은 **성공 시 상단 토스트(`flash`) + 편집·상세 모달 자동 닫기 + 목록 새로고침(`reload`)**, **실패 시 인라인/토스트 에러 + 모달 유지**로 통일. 쿠폰·공지·설정은 이미 이 패턴(무변경). **티켓 모달(답변 저장·상태 변경·환불)만 인라인 `msg`로 성공해도 모달이 열린 채였던 것을 교정** — `flash` 주입해 성공=토스트+닫기+갱신, 실패=인라인 에러(danger 색)+모달 유지, 처리 중 버튼 비활성. 티켓은 **삭제 라우트 없음**(문의는 물리삭제 안 함 — 상태 워크플로로만 종결). **쿠폰 상세 모달 푸터 버튼 순서 = 수정(강조)·삭제(위험 빨강 `oc-btn red`)·닫기(중립, 최우측)** 로 재배치(삭제는 `window.confirm` 유지). 라이브 E2E 검증(토스트 문구·모달 닫힘·목록 갱신·삭제-불가 실패 시 모달 유지·버튼 순서 DOM 확인).
> - **메뉴 IA(2026-07-04 사용자 요청 "대시보드에 다 넣지 마라")**: 사이드바 **분석 그룹**(사용자·결제·광고·업적) + **운영 그룹**(쿠폰·공지·문의/환불·운영설정). **대시보드=한눈에 볼 핵심만**(6 KPI: 서버상태·실시간접속·DAU·총가입·미처리문의·결제전환율 + 차트 2개[DAU·신규가입]). 상세는 각 분석 메뉴로 분리:
>   - **사용자**(`/api/admin/users`): 가입일·최근접속(+상대시간)·상태(활성/비활성/탈퇴 pill)·provider·버전·다이아 목록 + 상태 필터 + 페이지네이션(50) + 신규가입·시간대별 차트.
>   - **결제**(`/api/admin/series?metric=revenue|refund` + `/api/admin/payments`): **일/주/월** 토글 차트(매출[statsDaily, #43 전 0]·결제건수·환불·환불다이아) + **개별 결제/환불 내역 목록**(사용자 목록처럼 — 시각·유저·종류(구매/환불)·상품(ref)·다이아(delta)·잔액, kind 필터·페이지네이션). 건별 KRW는 #43 후.
>   - **광고**(`/api/admin/series?metric=ad`): **일/주/월/연** 토글. 시청횟수·고유시청자·지급다이아(원장 reason='ad', 1회=+50).
>   - **업적**(`/api/admin/achievements`): 86개 카탈로그 카테고리별 + **달성율 바**. 원천=`walletLedger(reason='achievement', ref=업적id)` 고유유저/총가입 — 업적 보상 적립이 계정평생 1회(achKey 멱등)라 ref별 고유유저=달성자. **별도 텔레메트리 불필요·결정론 격리 유지**(원장=다이아 진실, 시드/리플레이 무관). 카탈로그(제목)는 ops 페이지가 미러(engine tsconfig 격리 — econ.ts와 동일 정책).
> - **통계(#46, `/api/admin/stats`)**: 대시보드/사용자용 KPI(총가입·실시간접속(최근30분)·DAU·신규·탈퇴·비활성·결제전환율·광고) + 14일 시계열(신규가입·DAU·매출·광고) + 시간대별. SVG 인라인 차트(그라데이션·베지어, 라이브러리 0). 시계열 일/주/월/연 집계는 `/api/admin/series`(UTC 버킷). **한계**: 진짜 실시간/시간대별은 하트비트 필요(미구현) — lastSeenAt(로그인 시 갱신) 근사. 다운로드는 Install Referrer(EAS) 후. 매출은 #43 후.

- **인증 `requireAdmin(req)` — fail-closed(P0-B)**: `Authorization: Bearer <ADMIN_TOKEN>` 상수시간 비교. **`ADMIN_TOKEN` 미설정/짧으면(<16자) 무조건 401/503**(크론의 fail-open 패턴 복제 금지 — env 누락=전면 거부). Bearer 헤더라 CSRF 내성(쿠키 인증 미도입). 토큰은 localStorage.
- **엔드포인트**(전부 requireAdmin): `POST/GET/PATCH/DELETE /api/admin/coupon`(발급/목록/수정/삭제 — 발급 시 code 정규화·reward>0·상한캡·UNIQUE 충돌 4xx, 삭제는 사용기록 FK 있으면 'has-redemptions' 409→비활성화 권장) · `GET /api/admin/coupon/redemptions?couponId=`(**쿠폰 사용 내역 — 누가·언제**, 상세 모달에 표시. 2026-07-04) · 사용자별 다이아 잔액은 `/api/admin/users` 목록 다이아 컬럼·`POST/GET/PATCH/DELETE /api/admin/announcement`(발행/목록/수정/삭제)·`POST/GET /api/admin/setting` · `GET /api/admin/stats`(대시보드 KPI+14일 시계열) · `GET /api/admin/users`(목록·상태필터·페이지네이션) · `GET /api/admin/series?metric=revenue|ad|refund&granularity=day|week|month|year`(UTC 버킷 시계열) · `GET /api/admin/payments?kind=all|purchase|refund`(개별 결제/환불 원장 목록·페이지네이션) · `GET /api/admin/achievements`(업적별 달성유저=원장 ref 고유유저) · `GET /api/admin/payment-events`(결제 단계 감사 로그 조회 — source·fail·txn 필터, §13.22).
- **레이아웃(2026-07-04)**: 콘텐츠 영역 `.oc-main`은 **max-width 1200 + margin auto 중앙 정렬**(사이드바 이후 영역 기준) — 풀폭은 너비가 넓어 가독성↓(사용자 지적), 좌측 쏠림도 해소. 전 메뉴 공통.
- **파일**: `server/lib/admin.ts`(requireAdmin)·`server/lib/coupon.ts`·`server/lib/wallet.ts`·`server/db/schema.ts`·`server/app/api/coupon/redeem/route.ts`·`server/app/api/admin/{coupon,announcement,setting,stats,users,series,achievements}/route.ts`·`server/app/ops-9f3a2c/{page,layout}.tsx`(운영 콘솔 UI — 로그인·대시보드·사용자·결제·광고·업적·쿠폰·공지·설정·문의)·`lib/server.ts`·`app/coupon.tsx`.
- **검증(Opus 4.8)**: 라이브 E2E(admin 발급→redeem +N·이중사용 "used"·개인쿠폰 타유저 거부·만료 거부·requireAdmin 토큰없이 401)·app/server/test tsc 0.
- **공지 라우트 정정(2026-07-06, 발견·검증=Fable 5 / 수정·문서=Opus 에이전트)**:
  - **DELETE proj 스코프 + 404 대칭(F1)**: `DELETE /api/admin/announcement`가 `id`만으로 삭제(projCode 미스코프 — §13.2 멀티게임 격리 위반, POST/GET/PATCH는 전부 스코프됨)에서 `and(projCode, id)` + `.returning` 0건이면 `{ok:false,reason:'not-found'}` **404**로 교정(PATCH와 대칭).
  - **endsAt date-only KST 정규화(F5)**: 콘솔은 `YYYY-MM-DD`만 입력받는데 `new Date('YYYY-MM-DD')`=UTC 자정=**KST 오전 9시 종료**(운영자 기대 "그날 밤까지"와 9시간 어긋남). 서버가 `/^\d{4}-\d{2}-\d{2}$/`(date-only) endsAt을 **KST 그날 23:59:59.999(= 해당일 `T14:59:59.999Z`)로 정규화**(POST·PATCH 양쪽, 파일 내 `normalizeEndsAt`). 시각 포함 ISO 전체 문자열은 그대로 파싱. **startsAt은 미건드림 — 예약발행(startsAt)은 서버만 지원·콘솔 미노출**.
  - **bootstrap 방어 limit(F6)**: `/api/bootstrap` 공지 쿼리에 `.limit(50)`(부팅 페이로드 방어 — admin 목록 `.limit(200)`과 별개).
  - **가드**: `server/tools/_dv_announce.ts` 상설(발행→노출·만료/미래 필터·pinned 정렬·PATCH/DELETE 404 대칭·proj 스코프·date-only 타임존·fail-closed 인증 8항목 + 만료 필터 민감도 A/B 자가검증).

### 13.16 소프트 업데이트 배너 + 스토어 URL (#56 소프트, 2026-07-03)
> **강제 업데이트**(minVersion 미만=진입 차단)는 BootGate가 이미 하드 게이트(§13.11·AUTH §4). 이번은 **소프트 안내**(latestVersion 미만) — 진입은 막지 않고 대시보드 상단 **배너**로 "업데이트 있어요". 관전형 무푸시 — 닫으면 그 버전은 다시 안 뜬다.

- **스토어 URL**: `server_setting.androidStoreUrl`·`iosStoreUrl`은 스키마(§13.11)·admin `/api/admin/setting` patch에 **기존 존재** → 이번은 **관리자 페이지 입력칸만** 추가. **애플은 미리 준비**(값 비워두면 iOS 배너는 안내만, 스토어 이동 버튼 숨김) — 인기 많으면 iosStoreUrl 채워 활성.
- **판정** `lib/bootstrap.needsSoftUpdate(appVer, {min,latest})` = `belowVersion(latest) && !belowVersion(min)`(강제 대상은 이미 하드 게이트가 막아 대시보드 도달 못 하므로 소프트만 남음). 배너는 `Platform.OS`별 스토어 URL로 이동.
- **닫음 추적**: `useAuthStore.dismissedUpdateVersion=latest`(persist) → 닫으면 그 latest는 재노출 안 함. **새 latest 발행 시 재노출**(dismissed ≠ 새 latest). 다기기/재설치 재노출은 읽음추적과 동일 트레이드오프.
- **boot 공유**: BootGate가 받은 bootstrap을 `useServerConfig`(비영속 zustand)에 넣어 배너가 재조회 없이 읽음.
- **파일**: `lib/bootstrap.ts`(needsSoftUpdate)·`store/useServerConfig.ts`(신)·`store/useAuthStore.ts`(dismissedUpdateVersion)·`components/SoftUpdateBanner.tsx`(신)·`components/BootGate.tsx`(setBoot)·`app/(tabs)/index.tsx`(배너)·`server/app/ops-9f3a2c/page.tsx`(스토어URL 입력). 검증 `tools/_dv_version.ts`(cmpVersion·belowVersion·needsSoftUpdate A/B).

### 13.17 기기 정보 + 문의(티켓) 서버 + 환불 (#45 서버·#46 환불, 2026-07-03 — 독립 리뷰 5구멍 반영)
> **왜**: 문의 화면(§13.6 #45)은 앱만 완성돼 있고 **서버 저장이 없었다**(제출이 offline로 소실). 이번에 ①로그인 기기정보 수집(진단 — "어떤 폰에서 깨지나") ②문의 서버화 + **환불 신청** 카테고리 ③관리자 **환불 처리**를 붙인다. 독립 리뷰(general-purpose)가 방향 승인 + 5구멍 지적.

- **기기 정보(§A)**: `users`에 `platform`(ios|android|web)·`osVersion`·`appVersion`·`lastSeenAt` 컬럼(nullable, Expand-only). **로그인 때** 클라가 `Platform.OS`(android/iOS 무설치 확실)·`Platform.Version`·앱버전을 login에 실어 서버가 user 갱신(마지막 로그인 기기, 보조용). **문제 난 그 기기의 진짜 근거는 티켓에 박힌 제출 시점 device 스냅**. 모델명은 expo-device 붙일 때(추후). 이력 테이블은 과설계라 안 만듦. 개인정보처리방침에 "진단 목적 OS·앱버전 수집" 한 줄 고지(PIPA 최소수집), 소프트삭제로 함께 처리.
- **티켓 서버(§B)**: `tickets`(id, proj FK, userId FK, category('bug'|'suggestion'|'question'|'etc'|**'refund'**), content, status('open'|'replied'|'resolved'|'refunded'), reply, platform/osVersion/appVersion 제출스냅, createdAt, repliedAt) + `diagnostic_snapshots`(id, ticketId FK, snapshot jsonb, createdAt) **분리 테이블**(P0-4 — 10시즌 재생 JSON이 커서 목록 쿼리에 안 붙이고 상세 열 때 lazy load). 엔드포인트: `POST/GET /api/ticket`·`POST /api/snapshot`(ticket 소유권 확인)·`GET /api/admin/ticket`(필터)·`GET /api/admin/ticket/snapshot`·`POST /api/admin/ticket/reply`.
- **익명 폴백 차단(P0-5)**: 티켓/환불/스냅샷은 `resolveUserId`(Bearer 없으면 dev-user-1 폴백)가 아니라 **`requireUserId`(진짜 Bearer sub 없으면 null→401)**. 안 그러면 비로그인 티켓이 dev-user-1 한 버킷에 붕괴. 하드 로그인 벽이라 정상 사용자엔 무영향.
- **환불(§C)**: `POST /api/admin/refund`(requireAdmin) {userId, amount>0(상한캡), note(필수), ticketId?, key} → **단일 트랜잭션**: `applyWalletTx(−amount, 'refund', key, ref=note)` + ticketId 있으면 status='refunded'+reply. **멱등키는 관리자 UI가 폼 열 때 1회 생성(P0-2)**(서버 생성 시 더블클릭=이중환불). dedup(applied:false)이어도 티켓 status는 refunded로 수렴(P0-3).
- **음수 balance 허용(P0-1)**: `applyWalletTx`가 **`reason==='refund'`일 때만** 잔액게이트(next<0) 우회 — 자유 플래그 아님(spend에 실수로 켜질 사고 차단). 다 써버린 고래 환불→음수→spend 게이트가 더는 못 쓰게 막음(§13.4 H1). **`balance==Σledger` 불변식 유지**(0 하한 대안은 불변식 깸→기각). 대시보드는 음수를 clamp 말고 그대로 표시.
  - **정정(2026-07-16, 결제표면 감사 P1 — 게이트 방향 미구분)**: ~~게이트 조건 `!allowsNegativeBalance(reason) && next < 0`~~ 은 **delta 부호를 안 봐서 적립(delta>0)도 거부**했다 — 환불로 음수(-700)가 된 유저가 **광고/업적/쿠폰으로 빚을 갚는 적립(next=-650)까지 'insufficient'로 거부**돼 음수에서 탈출 불가(광고 슬롯 미커밋이라 쿨다운도 안 걸려 무한 헛시청, 클라는 'insufficient'를 'error'로 뭉개 영구 실패를 "잠시 후 재시도"로 오인). **교정**: 게이트를 **차감에만** 적용 → `delta < 0 && next < 0 && !allowsNegativeBalance(reason)`일 때만 거부. **양수 적립은 잔액이 음수여도 항상 통과**(부채 상환 경로 — 유저가 광고/업적/쿠폰으로 빚을 갚아 0으로 복귀). refund 음수 허용은 현행 유지. **spend 게이트는 절대 약화 안 됨**(delta<0 && next<0이면 여전히 거부) — 라이브 가드 `server/tools/_dv_purchase.ts` §부채상환이 A/B로 봉인(음수서 earn 통과·같은 상태 spend 거부·0 도달 후 spend 재개, 구게이트 재현 검출). 광고 하루상한(`countReasonToday`)·쿨다운(`adKey` 슬롯)은 이 경로와 독립이라 불변.
- **환불 신청 ≠ 자동 환불(CS 리스크)**: 유저 "환불 신청"은 **접수(티켓)**일 뿐. 실제 결제 환불은 **구글/애플 스토어 정책 경유**(판매자가 스토어라 앱이 카드 직접 환불 못 함). admin 다이아 회수는 스토어 환불 확정 시 **재화 되받는 후속 조정**(수동, 자동 웹훅은 #43). 카피에 명시. **환불해도 이미 쓴 전지훈련 효과는 취소 안 됨**(재화만 회수, 과거 boost 불변).
- **관리자 콘솔 확장(2026-07-16, 결제표면 감사 P2-b/c/d — 티켓 없는 케이스 대응)**: 콘솔 ⑤ BM·수익화 섹션에 세 도구 추가(과한 대시보드 금지 — 운영 완결용 최소).
  - **수동 지갑 조정 폼(P2-b)**: userId·금액(**음수=회수/양수=지급**)·사유 메모 → 부호로 라우트 분기. **회수(음수)=기존 `POST /api/admin/refund`**(reason='refund', 음수 허용), **지급(양수)=신설 `POST /api/admin/grant`**(reason='adjust', requireAdmin fail-closed, 멱등키 `manual:<uuid>`=콘솔 폼 1회 생성으로 더블클릭 이중지급 차단, `purchase_event` 감사행 source='admin'). **왜 신설**: 디스코드 `refund.anonymous.dropped`(§13.18 B1)처럼 **티켓 없는 dropped 알림**은 티켓 UI의 환불 버튼(ticketId 필수)으로 못 처리 → curl 의존이었던 것을 콘솔로. 실행 후 결과 잔액 표시 + 멱등 재클릭 시 경고 분기(applied:false → "이미 처리됨", 기존 doRefund 패턴).
  - **유저 원장 조회(P2-c, §13.26 보상 완결)**: `/api/admin/payments`에 **reason 필터 확장**(purchase/refund만 → `camp`·`adjust`·`ad`·`achievement`·`coupon`·`welcome` 전 reason) + `userId`·`since` 파라미터. 콘솔에서 유저 원장을 사유·기간 필터로 조회하고 **합계 표시** → §13.26 백업 보상(백업 시점 이후 camp 차감 합)을 콘솔만으로 계산·개인 쿠폰 발급까지 완결.
  - **결제 이벤트 퍼널 표(P2-d)**: `/api/admin/payment-events`(§13.22) 재사용하는 **간단 테이블**(최근 N건·source[client/webhook/confirm/**admin**]/fail 필터). 진단용 표 하나만 — "돈 내고 0개"·dropped·수동조정을 콘솔에서 시간순 추적.
- **결정론 격리**: 기기정보·티켓·환불 전부 시드/리플레이 무관 순수 메타. 음수 다이아는 camp(차감)가 balance 게이트라 'insufficient'로 거부 → campLog 미기록 = 리플레이 불변(무해). (2026-07-16 P1 정정 후에도 동일 — 게이트는 **차감**에만 적용하므로 음수 잔액에서 camp 차감은 여전히 거부되고, 적립만 통과한다.)
- **보관·통계**: `snapshot` 90일(진단 티어 — 3년 묵은 재생 JSON은 가치 0), 티켓 3년, `reason='refund'` 원장 5년(감사·retention 이미 제외). **TODO(#43)**: `rollupRecent`가 purchase만 집계 → 실환불 웹훅 붙으면 순매출 과대계상, refund 차감 반영 필요.
- **파일**: `server/db/schema.ts`(users 컬럼·tickets·diagnostic_snapshots)·`server/lib/auth.ts`(requireUserId)·`server/lib/wallet.ts`(applyWalletTx refund 음수허용)·`server/app/api/{auth/login,ticket,snapshot}/route.ts`·`server/app/api/admin/{ticket,ticket/reply,ticket/snapshot,refund}/route.ts`·`server/app/admin/page.tsx`·`server/lib/retention.ts`(snapshot 90일)·`lib/device.ts`(신, getDeviceInfo)·`lib/server.ts`(login+device·createTicket+device·refund 타입·'refund' 카테고리)·`store/useAuthStore.ts`(로그인 시 device)·`app/support.tsx`(환불 카테고리·안내 카피). 검증 `tools/_dv_refund.ts`(음수허용 reason파생·멱등키) + 라이브 E2E.

### 13.18 결제 검증 — RevenueCat 게이트웨이 재채택 (#43, 2026-07-03 — 결정 재반전·독립 리뷰)
> **핑퐁 이력**: RevenueCat(원안) → ~~Vercel 직접검증(2026-07-01 §5·§6)~~ → **RevenueCat 게이트웨이(2026-07-03, 사용자 결정 — 실사용 개발자 추천)**. 전면 RC(원안)도 직접검증 단독(2026-07-01)도 아닌 **제3안: RC는 검증/웹훅/consume 게이트웨이, 다이아 잔액 진실은 계속 우리 원장.** 독립 리뷰(general-purpose)가 발견: 결제 라우트는 아직 백지(#43 미구현)·`lib/iap.ts`는 여전히 RC 스캐폴드 → 재채택 전환비용 거의 0(문서 정합화에 가까움).

- **진실 소유 분리(불변)**: **다이아(소모성) 잔액 = 우리 `wallet_ledger`**(영원히). **엔타이틀먼트(광고제거·DLC, 비소모) = RC `customerInfo`**(+스토어 복원, SDK 로컬 캐시가 오프라인 처리). **RC Virtual Currency 기능 금지**(쓰는 순간 "진실의 원천 2개" 부활 — 2026-07-01이 죽인 것).
- **검증 경로 통일**: 소모·비소모 **둘 다 RC SDK 한 경로**(`purchasePackage` 하나·웹훅 하나). "다이아=직접검증 / 엔타이틀먼트=RC" 하이브리드는 스택 2벌이라 **기각**(리뷰).
- **다이아 지급 = 서버 확정, 이중경로 수렴**:
  - **웹훅**: RC→`POST /api/purchase/webhook/revenuecat`(Authorization 시크릿 검증) → `applyWalletTx(+다이아, 'purchase', key, ref)`.
  - **폴백(필수)**: 클라 구매 resolve 후 `POST /api/purchase/confirm {storeTxnId}` → 서버가 **RC REST로 재검증** → 같은 키 지급. 웹훅 지연·유실 시 폴백이 메꿈("돈 내고 0개" 방지). 먼저 온 쪽 지급·둘째 `applied:false` dedupe(쿠폰·환불 패턴).
  - **멱등키 = `purchase:<userId>:<storeTransactionId>`** — **스토어 거래 id가 웹훅·폴백 두 경로 공유 자연키**(유일 정합성 불변식). productId로 키하면 소모성 재구매 차단됨(금지)·RC event id 단독도 이중지급(금지).
- **환불**: RC 환불 웹훅(CANCELLATION/REFUND) → `applyWalletTx(−다이아, 'refund', key=refund:<userId>:<storeTxnId>)`(음수 허용). **관리자 수동 환불(§13.17)과 이중차감 방지**: storeTxnId 파생 공유키로 둘째가 dedupe되게 하거나 "RC 자동 환불분은 관리자 수동 금지" 명문화.
- **RC app_user_id = 우리 userId**: 로그인 직후 `Purchases.logIn(userId)`(최대 함정 — 안 하면 웹훅 app_user_id가 유저에 안 붙어 지급 불가).
- **H1/H4 흡수 범위**: H1(미consume 자동환불)=RC가 consume/acknowledge 스토어측 흡수. H4(영수증 크립토 검증)=RC 흡수 → **우리는 웹훅 Authorization 시크릿만 검증**. **단 AdMob SSV(광고)는 RC 무관 → H4 광고측은 여전히 우리 몫**(착각 주의).
- **샌드박스 필터**: RC 웹훅 `environment:SANDBOX`는 서버가 무시(테스터가 prod 원장에 유령 다이아 발행 방지). **정정(2026-07-16, D1 — 결제표면 감사)**: 이 필터가 **웹훅에만 있고 confirm 폴백엔 없어** 두 지급경로가 비대칭이었음(샌드박스 테스터가 confirm으로 prod 원장에 유령 다이아 발행 가능). `rcVerifyPurchase`가 RC REST `non_subscriptions` 매칭 항목의 `is_sandbox===true`면 `reason:'sandbox'`로 지급 0 처리 + confirm 라우트가 웹훅 `webhook.sandbox.filtered`와 대칭인 `confirm.sandbox.filtered` 감사행 기록. **fail-closed 판정**: RC REST v1 스키마상 `is_sandbox`는 non_subscriptions 항목의 표준 boolean이고 실 샌드박스 거래는 확정적으로 `true`를 실어 오므로 **엄격히 `===true`일 때만** 필터, 부재/비불리언(스키마 이상)은 prod 간주(grant) — 샌드박스 1차 필터는 권위 있는 웹훅(최상위 `environment`)이고 confirm은 폴백이라 모호할 때 지급 편향이 정상결제 "돈 내고 0개"를 막음.
  - **샌드박스 지급 스위치 `RC_SANDBOX_GRANT`(정정 2026-07-17, D1 후속 — 라이선스 테스터 결제 실측)**: **실측** — Play 라이선스 테스터가 **내부 테스트 트랙**에서 실제 결제해도 RevenueCat이 `environment=SANDBOX`로 웹훅을 보냈고(라이선스 테스터 결제=SANDBOX 도착), 위 D1 필터가 이를 막아 **GPA 거래 2건이 `webhook.sandbox.filtered`로 지급 0** 처리됨. ~~"내부 테스트 트랙(프로덕션 빌드 서명) 결제면 environment가 지급 대상(PRODUCTION)이 된다"~~ 는 가정은 **틀림**(내부 테스트 트랙 결제도 SANDBOX). 테스터 전원이 결제 테스트를 해야 하므로 **환경변수 스위치** 신설:
    - **`RC_SANDBOX_GRANT`(server env)**: 값 `all`이면 샌드박스 지급 허용, **미설정 포함 그 외는 현행 필터 유지(off = fail-closed 기본)**. `sandboxGrantEnabled()`가 **요청 시점 read**(모듈 const 캐시 금지 — Vercel env 주입 재배포·테스트 A/B 즉시 반영).
    - **경로**: 웹훅 `decidePurchaseEvent`가 `environment===SANDBOX && !sandboxGrantEnabled()`일 때만 `ignore(sandbox)`; on이면 grant/refund 정상 진행(**환불 클로백도 샌드박스에서 검증**). confirm 폴백 `rcVerifyPurchase`의 `is_sandbox===true` 거절도 동일 스위치로 통과(대칭).
    - **매출 오염 방지**: 샌드박스 지급이 통과해도 `statsDaily` 매출(KRW)·건수·다이아 집계는 **전면 스킵**(호출부에서 `d.sandbox`/`v.sandbox` 분기 — `recordPurchaseRevenue`/`recordRevenueKrwOnce` 미호출). 원장(`wallet_ledger`) 지급은 정상 수행하되 **`ref`에 `productId:sandbox` 마커**(예: `dia_1000:sandbox`)로 감사 구분. **멱등키는 불변**(store txn 기반 `purchase:/refund:` — 마커 없음, 환불 dedup이 같은 키를 봐야 함).
    - **정정(2026-07-18, D1 후속 — prod `stats_daily` 실측)**: 위 "매출 오염 방지"는 **이벤트 시 지급 경로(웹훅·confirm)만** `d.sandbox`/`v.sandbox`로 스킵했을 뿐, **`statsDaily`를 쓰는 두 번째 라이터인 매일 크론 롤업**(`/api/cron/purge`→`lib/retention.ts rollupRecent()`)과 **관리자 파생 집계 2경로**(⑤ BM `admin/bm`·전환율 `admin/stats`)가 `:sandbox` ref를 **무관하게 재집계**해 지급 경로의 제외를 **덮어썼다**. 실측: prod `stats_daily`의 2026-07-17 행이 `revenueKrw=0 · purchaseCount=6 · diamondsPurchased=19100`(그날 실결제는 전부 샌드박스였는데 크론이 :sandbox 6건을 재집계). **★ statsDaily는 라이터가 둘**: ① 이벤트 시 증분(`recordPurchaseRevenue` 건수·다이아 +1 / `recordRevenueKrwOnce` KRW) ② 매일 크론 재집계(`rollupRecent`가 원장에서 **덮어쓰기 upsert**) → 샌드박스 제외는 **양쪽 다** 적용돼야 필터가 산다(정책을 한 라이터에만 걸면 다른 라이터가 무효화). → **집계 3경로 대칭 제외**: 크론 롤업 `pRows` 쿼리(raw SQL `AND (ref IS NULL OR ref NOT LIKE '%:sandbox')`)·관리자 BM(상품별 지급·전환 payer)·전환율(`admin/stats` payer)의 `reason='purchase'` 집계(drizzle `or(isNull(ref), notLike(ref, '%:sandbox'))`)에 NULL-안전 제외 추가. **원장 열람·감사 뷰(`admin/payments`)는 제외 안 함**(전 행 노출이 맞고 `:sandbox` 마커로 육안 구분 가능). 각 자리 주석에 "§13.18 D1 — 샌드박스 집계 제외(웹훅·크론·관리자 3경로 대칭)" 마커(정책 변경 시 grep 전수용). 7/17 행은 크론이 지난 데이터를 못 고칠 수 있어(그날 실구매 0이면 `pRows` 2일 윈도우에 그 날짜가 안 잡혀 upsert 스킵) **일회성 수동 UPDATE로 0 처리**(PAYMENT_LAUNCH_RUNBOOK 진행기록 2026-07-18). 가드 `_dv_purchase` **S1-e**로 봉인(아래 검증).
    - **보안 근거**: 샌드박스 결제는 Play 콘솔 **라이선스 테스터 목록(오너 통제)** 에 등록된 계정만 발생시킬 수 있음 → 스위치 on 기간에도 임의 유저가 유령 다이아를 발행할 수 없음. **출시 전 off 처리**(또는 유지 사유 기록)가 DoD 항목(PAYMENT_LAUNCH_RUNBOOK §6). 감사행 stage는 지급 시 기존 `webhook.grant.applied`/`confirm.grant.applied`로 자연스럽게 남고(purchase_event `environment='SANDBOX'` 마킹 유지), 매출롤업 stage(`revenue.krw`)는 안 남음(집계 제외).
- **수입 대시보드 역할 분리**: **재무·세무 진실=RC 대시보드**(실 KRW·환불), **다이아 지급 진실=우리 원장**. KRW가 우리 대시보드에 필요하면 RC 웹훅 `price_in_purchased_currency`를 Purchase 행에 적재(다이아 건수 역산 금지 — §13.17 rollup TODO와 함께).
- **결정론·관전형 격리·throw-none·부팅 비차단** 유지(RC는 purchase→grant 메타만·시드/리플레이 무관). confirm은 임계경로 밖 네트워크콜.
- **락인 낮음**: 게이트웨이 패턴이라 나중 RC 제거 = 웹훅/confirm만 직접검증으로 교체, 원장·지급 로직 불변. MTR $2.5k/월 무료·초과 1%(스토어 30% 컷 옆 반올림).
- **문서 정정 대상**: CLAUDE §8·BACKEND §0/§5/§6/§13.3/§13.4·MONETIZATION §6/§6.1/§11.4·PRE_LAUNCH §3 → 이 §13.18로 포인터. **§6.1 "RC 쓰면 우리 DB 불요"는 취소선 유지**(소모성 다이아 원장은 여전히 필요 — RC 재채택이 되살리지 않음).
- **서버측 구현 완료(2026-07-04, 검증 Opus 4.8)**: 결제 검증 머니패스(라우트·순수판정·매출롤업)를 §13.18대로 구현. **클라 SDK·스토어 상품·EAS·실결제 테스트는 별도**(구조상 서버 밖).
  - **파일**: `server/lib/products.ts`(다이아 팩 productId→다이아 매핑 = 서버 권위·클라값 무시 / 엔타이틀먼트는 RC customerInfo 소유·원장 무관)·`server/lib/revenuecat.ts`(`verifyWebhookAuth` fail-closed·`decidePurchaseEvent` 순수판정·`rcVerifyPurchase` REST 재검증·`purchaseKey/refundKey`·`recordPurchaseRevenue` statsDaily 롤업)·`server/app/api/purchase/webhook/revenuecat/route.ts`(웹훅)·`server/app/api/purchase/confirm/route.ts`(폴백). **샌드박스 집계 제외 3경로(2026-07-18)**: `server/lib/retention.ts`(크론 `rollupRecent` pRows)·`server/app/api/admin/bm/route.ts`(상품별 지급·전환 payer)·`server/app/api/admin/stats/route.ts`(전환율 payer) — 각 `reason='purchase'` 집계에 `:sandbox` ref 제외.
  - **env(운영 세팅 시 주입)**: `RC_WEBHOOK_SECRET`(웹훅 Authorization·≥16자·미설정=전거부)·`RC_REST_API_KEY`(confirm 폴백 재검증·미설정=confirm 503). Vercel 환경변수·`server/.env.local`.
  - **매출 롤업**: 지급이 **실제 적용된(applied)** 경우만 `statsDaily`(purchaseCount+1·diamondsPurchased += 다이아) 갱신 → 대시보드 매출/전환율 원천. ~~confirm이 grant 경쟁 승리 시 KRW만 유실(재무진실=RC 대시보드라 무해).~~ → **정정(2026-07-16, A1 — 결제표면 감사)**: confirm 선착(KRW 미상 → null) 후 웹훅이 뒤늦게 dedup되면 KRW가 **영구 ₩0**으로 남아 관리자 ⑤ BM 탭 매출이 안 잡혔음(purchaseCount만 증가·DoD "매출 1건 조회" 위반). **`recordRevenueKrwOnce(storeTxnId, priceKrw)`** 신설 — 건수·다이아 롤업(`recordPurchaseRevenue`)과 **KRW 롤업을 분리**하고, applied 경로·웹훅 후착 dedup 보충 경로가 **모두 이 함수를 거쳐 KRW 단일 진실점**. 멱등 = `purchase_event`에 이 storeTxnId의 `revenue.krw` 마커 존재 여부(**새 테이블 금지** — 기존 진단 테이블·pe_txn_idx 앵커, 마커+집계 한 트랜잭션 원자화)로 웹훅 재시도·경로 경쟁에도 KRW 이중집계 0. 환불은 원장만(대시보드 매출은 gross).
  - **엣지 처리(2026-07-04)**: ① **소모성 전용 타입만** — 지급=INITIAL/NON_RENEWING만, 회수=CANCELLATION/REFUND만. RENEWAL/UNCANCELLATION/EXPIRATION(구독)은 무시(UNCANCELLATION을 지급 두면 원구매 키와 dedup돼 환불 되돌림 어긋남). ② **익명 app_user_id 방어** — `$RCAnonymousID`·비-UUID면 무시(200, 재시도 폭풍 방지) → confirm 폴백이 메꿈(클라 `logIn` 누락 대비). **보강(2026-07-16, B1 — 결제표면 감사)**: 지급 익명은 confirm이 메꾸지만 **환불 익명은 웹훅 단일경로**라 200으로 삼키면 클로백이 **무흔적 유실**. `decidePurchaseEvent`가 익명 CANCELLATION/REFUND를 `reason:'anonymous-refund'`로 **구분**해 웹훅이 fail 코드 `refund.anonymous.dropped`(ok:false·txn·상품·금액)로 기록 + 디스코드 관측 알림(`notifyRefundDropped`, afterSafe 경유 — 머니패스 밖). 관리자는 storeTxnId로 원구매(confirm 지급)를 역추적해 수동 환불(§13.17) 판단. 지급 익명 무시는 현행 유지. ③ **순서역전 안전** — 가법 원장이라 환불이 지급보다 먼저 와도 순 0 수렴. ④ **이중 환불 dedup**(같은 txn 재전송). ⑤ **관리자 수동환불↔RC 자동환불 이중차감** — 키가 달라(ticket vs storeTxn) 자동 dedup 안 됨 → **운영 규칙 분리**(스토어 결제분은 RC만·수동 금지, `admin/refund` 주석 명문화).
  - **검증**: `server/tools/_dv_purchase.ts`(인증 fail-closed·샌드박스/엔타이틀먼트/미등록/구독타입/익명 무시·grant/refund·**멱등 dedup**·이중환불 dedup·순서역전 순0·라우트 통합 401/+1000/재전송 dedup/−1000·테스트유저 정리 + **결제표면 감사 2026-07-16**: D1 confirm×SANDBOX 필터·B1 익명환불 `refund.anonymous.dropped` 관측·A1 confirm선착→웹훅후착 KRW 보충 + **S1 `RC_SANDBOX_GRANT` 스위치(2026-07-17)**: off=현행 필터·on=SANDBOX grant 원장 지급+ref `:sandbox` 마커·매출KRW/건수/다이아 무증가·SANDBOX 환불 클로백·스위치 delete 시 재필터(웹훅·confirm 대칭 A/B), 각 A/B 민감도 실증 + 변이 자가검증 + **S1-e 크론 롤업 경로 대칭 제외(2026-07-18)**: dev DB에 실 원장행(ref=`dia_1000`)+샌드박스행(ref=`dia_1000:sandbox`) 삽입 → `rollupRecent()`가 **실 건만** 집계(Δ건수1·Δ다이아1000, 샌드박스 Δ0)·구/신 롤업 쿼리 A/B로 같은 2행 count 2↔1·dia 2000↔1000 민감도 실증(뮤턴트 박제 없이 가드 안 별도 실행)·statsDaily 스냅 원복(newUsers 포함)) 전항 PASS + server tsc 0.
  - ~~**남은 것(외부)**: `lib/iap.ts` 소모성 다이아 `purchasePackage` + `Purchases.logIn(userId)`(웹훅 귀속 필수) + 구매 resolve 후 `/api/purchase/confirm` 호출~~ → **클라측 코드 완료(2026-07-05·07-10)**. 진짜 남은 것 = RC 계정/대시보드·EAS·스토어 상품 등록(아래 운영 체크리스트).
- **클라 SDK 배선 완료(2026-07-10, 검증 Fable·수정 Opus 에이전트)** — `lib/iap.ts`는 완성형(`identifyUser`=`Purchases.logIn(userId)`·`logoutUser`=`logOut`·`purchaseDiamonds`=`purchasePackage`→`storeTxnId`→`confirmPurchase` 폴백)이었으나 **호출 배선 3지점**을 확정:
  - **로그인 성공 직후** → `store/useAuthStore.ts:81`(`signIn` 성공 경로에서 `void identifyUser(session.userId)`).
  - **앱 재시작 복원 경로** → `store/useAuthStore.ts:onRehydrateStorage`(저장 세션 자동로그인 지점 — 여기서도 `void identifyUser(state.session.userId)`. **안 하면 재시작 후 구매가 익명 RC id로 붙어 웹훅 지급 불가** = §13.18 "최대 함정"의 재시작 사각).
  - **로그아웃** → `store/useAuthStore.ts:88`(`signOut`에서 `void logoutUser()` — 다음 유저 오염 방지). 셋 다 fire-and-forget·graceful(dev/미설정 no-op, throw 없음 — 로그인/로그아웃 흐름 무차단).
  - **라우트 LIVE E2E 가드 등재**: `server/tools/_e2e_purchase_live.ts` — 실행 중 서버(:3000)에 **실제 HTTP 왕복**(_dv_purchase의 순수판정+in-process 호출이 못 덮는 층): ①dev 로그인→userId ②웹훅(Authorization 시크릿)→원장 +1000 ③같은 txn 재전송→dedup(불변) ④confirm 폴백(RC 키 없어 `rc-unconfigured` 503 관측·Bearer 없음 401) ⑤CANCELLATION 환불→−1000(잔액 0)·이중환불 dedup ⑥SANDBOX→무시(원장 무변) ⑦Authorization 불일치→401. 전항 PASS + 테스트 유저·원장·감사로그·매출롤업 복구. **로컬 전용 `RC_WEBHOOK_SECRET`은 `.env.development.local`에만**(운영 `.env.local` 무접촉) — 서버가 이 시크릿을 로드하려면 dev 서버 **재시작** 필요.
  - **남은 운영 체크리스트(출시 순서 — 코드 밖·수동)**:
    1. **RC 계정/앱 등록** — RevenueCat 대시보드에서 프로젝트+Android/iOS 앱 생성, 스토어 자격증명 연결.
    2. **public SDK 키** → `EXPO_PUBLIC_REVENUECAT_API_KEY`(EXPO_PUBLIC_*은 빌드타임 인라인 → **EAS 재빌드**해야 반영).
    3. **웹훅 URL + 시크릿** — RC 대시보드 웹훅에 `<prod>/api/purchase/webhook/revenuecat` + Authorization 커스텀 헤더값 등록, 같은 값을 Vercel `RC_WEBHOOK_SECRET`(≥16자, 미설정=전거부 fail-closed)에 주입.
    4. **RC REST 키** → Vercel `RC_REST_API_KEY`(confirm 폴백 재검증용, 미설정=confirm 503 `rc-unconfigured`).
    5. **스토어 상품 등록** — Google Play Console(+App Store) 소모성 다이아 팩을 `server/lib/products.ts` `DIAMOND_PRODUCTS`의 productId(`dia_100`…`dia_10000`)와 **정확히 일치**(오타=지급 0 fail-closed) + RC 대시보드 Products/Offerings 연결. **EAS 빌드 후** 스토어 등록 가능.
    6. **샌드박스 실결제** — 테스트 계정으로 실제 구매→웹훅 수신→원장 지급→confirm 폴백까지 왕복 확인. ~~SANDBOX는 서버가 무시하므로 지급 검증은 프로덕션 트랙 필요.~~ → **정정(2026-07-17)**: 라이선스 테스터 결제는 내부 테스트 트랙이라도 `environment=SANDBOX`로 도착(실측) → 지급 검증하려면 **`RC_SANDBOX_GRANT=all`** 스위치를 켜고 테스트(§13.18 D1 샌드박스 지급 스위치). 이 모드 지급은 원장에 `ref :sandbox` 마커로 남고 매출 집계는 제외. **출시 전 스위치 off 처리 결정**(PAYMENT_LAUNCH_RUNBOOK §6 DoD).

### 13.19 다이아 어뷰징 방어 — 구단 초기화·재설치 (2026-07-03, 사용자 보안 감사)
> **위협**: 구단 초기화(`selectTeam`/`resetSave`)가 `claimedAch`·`adState`를 로컬 리셋 → "다이아 공장(재수령·광고 재시청 farming)" 우려. **결론: 서버가 이미 막고 있음(라이브 E2E 검증) + 사용자 결정으로 계정 재화는 초기화해도 유지.**

- **farming 불가(서버 진실 — 검증)**:
  - 업적: 멱등키 `ach:<userId>:<achId>` **계정 평생 1회**(§13.12 P0-5) → 리셋 후 재달성해도 재수령 **0**(applied:false).
  - 광고: 키 `ad:<userId>:<dayIndex>:<count>` — 리셋으로 count 0이 돼도 **이미 쓴 슬롯과 충돌**(dedup) + earn 라우트 **하루 8회 서버 백스톱**(countReasonToday). 재지급 0.
  - 다이아 잔액: **서버 진실** — 리셋은 로컬 캐시만, 서버 balance 불변. syncWallet가 복원.
  - 전지훈련: saveId(walletEpoch)가 리셋 시 새로 발급 → camp 키 새로 → **재과금(정당·무료강화 아님)**.
- **개선(사용자 결정)**: 구단 초기화해도 **`diamonds`·`claimedAch`·`adState` 유지**(계정 소유 — 서버 진실·계정 평생). `saveId`만 새로. `selectTeam`·`resetSave` 둘 다.
- **광고 쿨다운/캡 서버 진실화**: `getWallet`가 `adToday{count, lastAtMs}`(오늘 UTC 원장 집계) 반환 → `syncWallet`가 `adState` 복원. ~~**재설치·기기변경·로컬 조작으로 쿨다운/캡 우회 불가**(earn 8회 백스톱이 하드 게이트, 로컬 adState는 UI 편의 캐시).~~ → **정정(2026-07-17)**: 이 시점(2026-07-03)엔 **하루 8회 상한만** 서버 하드 게이트였고 **쿨다운은 서버 미강제**였다 — `adToday.lastAtMs`는 `syncWallet`가 로컬 `adState`를 복원하는 **표시값**일 뿐 earn 라우트가 검사하지 않아, 조작 클라가 쿨다운을 무시할 수 있었다(캡까지는 막힘). **쿨다운 서버 백스톱은 §13.12(2026-07-17)에서 추가**(최근 'ad' 원장 시각 2시간 게이트, `lastReasonAt`). 캡은 종전대로 하드 게이트, 로컬 adState는 UI 편의 캐시.
- **검증(Opus 4.8)**: 라이브 E2E(리셋 후 ach 재수령 0·광고 슬롯 재사용 0·8회 캡·camp 새 saveId 재과금·adToday 반환) + app/server tsc 0.
- **파일**: `server/lib/wallet.ts`(adStatusToday·getWallet adToday)·`lib/server.ts`(getWallet adToday 타입)·`store/useGameStore.ts`(syncWallet adState 복원·selectTeam/resetSave 계정필드 유지).

### 13.20 진단 스냅샷 고도화 — 재현 키 + 로그 강화 (2026-07-04, GPT 리뷰 + 독립 리뷰 + 실측)
> **왜**: 현 진단 스냅샷(§13.17·`data/diagnosticSnapshot.ts`)은 **재계산된 결과(출력)** 만 담아, "기록/수상/다이아 정합성" 문의는 진단되나 **"이 경기가 이상하다"·크래시·"왜 이 상태가 됐나"는 재현 불가**(seed·results 없음). 결정론 엔진의 장점(같은 세이브=같은 리플레이)을 **운영 진단까지** 잇는다. GPT 리뷰(재현키 우선)+독립 리뷰(general-purpose, 8항)+**실측**으로 확정.

- **① 재현 키(replay) = persist 세이브 통째(verbatim)**: 스냅샷 jsonb에 `replay = partialize(state)`(영속 52필드 전부)를 넣는다. **seed-input만 추리지 않는다**(독립 리뷰): 로더 `onRehydrateStorage`가 `archive`·`simCache`·`campLog`·`coachPool`·`bonds` 등 "파생처럼 보이는" 필드를 실제로 소비 → 빼면 재현이 사용자 앱과 어긋남. 게다가 **`simCache`(앱이 계산) ↔ 신선 리플레이(엔진 재계산) 불일치**가 B전환(REALTIME_SIM) 이후 최대 버그류인데, 그걸 잡는 증거물이 바로 `simCache`라 뺄 수 없다. **미래 필드 추가도 자동 포함**(손 선별 금지 — 로더 계약="영속 객체 통째를 다시 먹여라").
- **크기: 측정으로 압축 장치 전면 제거(추정금지)**: `tools/_dv_savesize.ts`로 실측 — 1시즌 raw 201KB / 10시즌 384KB / 50시즌 596KB / **100시즌 743KB(gzip 113KB)**. Vercel 서버리스 본문 하드캡 ≈4.5MB의 **1/6**. 성장 sub-linear 수렴(playerBase ~270KB 고정·seasonLines 커리어 바운드·milestones 300캡·retirements 200캡). `simCache`는 **현재 시즌 1개분만**(시즌 수 무관 바운드) → 풀 워밍 더해도 최악 ~1MB. **∴ 클라 gzip·별도 bytea 컬럼·서버 사이즈가드·simCache 드롭·truncated 플래그 전부 불필요**(리뷰가 4.5MB 초과를 우려해 처방했으나 측정이 반증). 저장은 **Postgres `jsonb` TOAST가 디스크에서 자동 압축**(공짜).
- **② 전 문의 항상 첨부(게이팅 없음 — 사용자 결정)**: GPT ④(유형별 분리, 건의/질문서 재현키 제외)는 **뒤집는다**. "건의로 접수됐는데 실은 버그"가 흔하고, **capture-at-submit이 re-request를 이긴다**(나중 재요청 시 유저가 시즌 더 진행→그 순간 상태 소실). 크기가 작아 게이팅 이득이 없으므로 **모든 카테고리에 replay 항상 첨부**. 기존 경량 슬라이스(seasons/players/news/logs/wallet)는 **빠른 사람 트리아지용으로 유지**(replay와 중복이나 저비용).
- **③ snapshotVersion=2 (additive)**: `meta.snapshotVersion=2`. v1=무버전 → 운영툴이 `undefined ⇒ 1`로 해석(백필 없음). **write-once 증거물이라 in-place 마이그레이션 없음** — 읽기측만 version-dispatch. v2부터 replay 포함.
- **④-0 미처리 크래시 캡처(구현·검증 2026-07-04)**: **전역 핸들러 부재가 갭이었다** — 현재 `logError()`로 명시 로깅한 것만 진단버퍼에 남고, 미처리 예외(진짜 크래시)는 아무 데도(SaaS도 스냅샷도) 안 남았다. `lib/deviceLog.ts installCrashHandler()`가 `ErrorUtils.setGlobalHandler`로 미처리 예외를 `logError('uncaught[:fatal]')`→diag로 흘리고 **기존 핸들러(dev 레드박스·prod 종료) 보존**. `app/_layout.tsx`가 시작 시 설치. **라이브 검증(에뮬)**: logError·미처리 예외 둘 다 유발→logcat 확인→문의 제출→**DB 스냅샷 `logs`에 2건**(`cat:error, msg:dev-test` + `msg:uncaught:fatal`) 도착 확인. (Crashlytics/Sentry 없음 — 이 전역 핸들러+진단 스냅샷이 현재 유일한 크래시 가시성.)
- **④ 로그 강화 — 내 팀 확정 사건만**: `diag()`를 현 3곳(전지훈련·시즌종료·새게임)에서 확대. **위시 토글(`toggleDraftPick`·`signFA`·`toggleTryoutWish`·`setResign`)·AI 팀 트랜잭션은 로깅 금지**(되돌림 노이즈 + 오프시즌 전구단 루프가 수백 건 폭주 — 독립 리뷰). **`selectedTeamId`의 확정 사건만**: 재계약(`reSign`)·방출(`release`)·시즌중FA(`signInSeason`)·드래프트 지명 결과·외국인 영입/교체(`replaceForeign`)·감독 선임/해촉(`hireCoach`/`fireCoach`)·선발/벤치 건의(`suggestStart`/`suggestBench`). cadence는 사람 손(탭 단위)이라 4000상한+10시즌 prune으로 충분. 디바운스 tail은 같은 세션 무손실(in-memory buf), 앱 재시작 후만 유실(저위험).
- **결정론 격리(불변 — 캐럿아웃 명문화)**: replay를 서버가 저장하는 것은 격리 위반 **아님**. §8/§13.7이 금지하는 것은 *서버가 시뮬 루프의 일부가 되는 것*(엔진을 서버가 돌리거나 앱이 게임상태를 서버서 읽음). replay는 **서버가 해석하지 않는 write-only 불투명 증거물**이고 리플레이는 **out-of-band 운영도구 전용**. → **"관리자 편의 서버 리플레이 엔드포인트" 절대 금지**(만드는 순간 앱이 읽는 경로가 생기면 격리 붕괴).
- **[최대 리스크] 엔진버전 pin**: 운영툴이 `meta.engineVersion`과 **다른 엔진 빌드로 재생하면 유령 버그**(B전환이 engineVersion 게이트 쓰는 이유). 운영 리플레이 도구는 그 커밋을 pin, 불일치면 **거부/경고**. 재현 fidelity의 단일 최대 변수. 운영툴은 손파서 금지 — 앱 실제 로드 경로(`migrateSave`+`onRehydrateStorage`) 그대로 재사용해야 bit-identical.
- **보관·프라이버시**: replay는 게임 데이터라 PII 없음(가상 선수)이나 userId에 묶여 보관 → 개인정보처리방침에 **"문의 시 게임 저장 데이터 첨부"** 한 줄(§13.17 OS·앱버전 고지 확장, PIPA 최소수집). 스냅샷 90일 보관 유지(진단 티어).
- **구현 완료(2026-07-04, 검증 Opus 4.8)**: `data/diagnosticSnapshot.ts`(`SNAPSHOT_VERSION=2`·`meta.snapshotVersion`·`replay` 필드)·`app/support.tsx`(`replay: captureReplaySave()` 주입·전 카테고리)·`store/useGameStore.ts`(**`captureReplaySave()`** = persist.getOptions().partialize 재사용→{state,version} + diag 확정사건 8종: 재계약·방출·시즌중FA·외국인교체·감독선임/해촉·벤치/선발건의 + endSeason 드래프트지명)·`lib/deviceLog.ts`(무변경). **검증**: `tools/_dv_snapshot_replay.ts`(①replay==partialize+version 60필드 ②JSON왕복무손실 ③snapshotVersion=2+replay포함 ④diag발화 ⑤A/B민감도) 전항 PASS + `_e2e_twocycle`(액션·endSeason·결정론 정상) + tsc 0. `_dv_savesize.ts`(크기 회귀). **에뮬 E2E 실기**(문의 제출→DB 스냅샷에 `replay` 60필드·136선수·857KB·`snapshotVersion:2`·diag 3건 도착 확인). 운영툴 리플레이(migrate+하이드레이션 bit-identical)는 운영도구 몫(out-of-band).
- **업로드 타임아웃(실기 발견 2026-07-04)**: 재현키로 페이로드가 수백KB(실측 857KB)라 `lib/server.ts` 기본 8초 타임아웃이 `'Aborted'`로 유실. `call`에 timeoutMs 파라미터 추가, `uploadSnapshot`은 **30초**(백그라운드·비블로킹이라 무해). 대화형 호출(지갑·로그인)은 8초 유지.

### 13.21 Sentry 서버 관측 (2026-07-04, GPT 리뷰 — "지금 Sentry, Crashlytics는 EAS 이후")
> **왜**: 문의 시스템(진단 스냅샷·deviceLog·전역 크래시 핸들러 §13.20 ④-0)은 **게임 내부** "왜 이 상태가 됐나"를 잘 잡지만, **서버(API)에서 무슨 오류가 났는지**는 운영자가 볼 수단이 없었다(라우트가 catch로 삼켜 JSON만 반환). GPT+내 판단: **서버 오류 가시화가 현 단계 운영효율을 가장 크게 높인다** → Sentry(Node) 우선. Crashlytics(앱 네이티브 크래시)는 **EAS Build 이후**(Expo Go 불가)라 보류.

- **@sentry/node 채택(≠@sentry/nextjs)**: 서버가 "순수 API + 관리자 대시보드"라 `withSentryConfig` 빌드통합(소스맵/클라 번들/터널)이 불필요 → `@sentry/node`가 더 가볍고 부팅 안전. Next 16.2.9/React 19.
- **부팅 안전(핵심 — 광고/IAP와 동일 계약)**: **`SENTRY_DSN` 없으면 완전 no-op**. `instrumentation.ts register()`가 DSN 없으면 early-return(init 안 함), `lib/observability.ts reportError()`는 미init 시 `captureException` no-op(throw 없음, tsx 실증). dev·미연결에서도 서버가 정상 기동. Node 런타임에서만 init(`NEXT_RUNTIME==='nodejs'`, edge 제외).
- **캡처 2경로**: ① **`onRequestError`**(instrumentation) = 우리 catch가 못 삼킨 미처리 라우트 에러. ② **`reportError(e, where)`** = 라우트 catch가 삼키는 에러 — 16개 route.ts의 23개 catch를 `catch (e) { reportError(e, '<route>'); … }`로 스윕(where 태그=라우트 경로, 예 `wallet/spend`·`admin/refund`). catch는 여전히 JSON 반환(사용자 흐름 불변) + Sentry에도 보고.
- **결정론·throw-none 격리**: 관측은 재화·시드·리플레이와 무관한 순수 운영 메타(§8). 실패해도 요청 흐름 안 깸.
- **★ 서버리스 flush(함정 — 라이브서 발견 2026-07-04)**: `@sentry/node`는 이벤트를 **비동기 전송**하는데 Vercel 함수는 응답 직후 freeze → 전송 완료 전 죽어 **이벤트 유실**(로컬은 수동 flush라 정상, 운영만 누락). 수정: `reportError`가 Next **`after()`**(응답 후 실행, Vercel waitUntil로 함수 유지)로 `flush(2000)` — 응답 지연 0. `onRequestError`는 Next가 await하는 훅이라 직접 `await flush`. 요청 컨텍스트 밖(tsx 검증)은 after() throw→무시(호출부 직접 flush). **@sentry/nextjs 대신 @sentry/node를 쓸 때 반드시 챙길 것**(nextjs는 자동 처리).
- **활성화(사용자 몫)**: Sentry.io에서 Node 프로젝트 생성 → DSN을 `server/.env.local` **+ Vercel env**의 `SENTRY_DSN`에 넣으면 즉시 켜짐(env 추가 후 **Redeploy 필수**). 소스맵 업로드(스택트레이스 정확도)는 후속(`SENTRY_AUTH_TOKEN`+빌드 플러그인, 선택).
- **검증(Opus 4.8)**: 서버 tsc 0·build ✓ · 스윕 16파일/23catch import 경로 정확 · **부팅 안전 실증**(DSN 없이 reportError no-op, throw 0) · **로컬 라이브**(테스트 에러+메시지 2건 대시보드 도착, 스택·기기·브레드크럼 완비) · **운영 라이브**(Vercel DSN 주입+flush 수정 배포 후 깨진 JSON→`auth/login` catch→`environment:production` 이슈 도착).
- **파일**: `server/instrumentation.ts`(신·register+onRequestError)·`server/lib/observability.ts`(신·reportError)·`server/app/api/**/route.ts`(16파일 catch 스윕)·`server/.env.example`·`.env.local`(SENTRY_DSN·SENTRY_TRACES_SAMPLE_RATE). Crashlytics는 EAS 빌드 마일스톤에서(앱 네이티브·JS·ANR·기기별).

### 13.22 결제 이벤트 감사 로그 (#60, 2026-07-05 — 사용자 요청 "결제 로그 엄청 보강" + 리서치 에이전트 베스트프랙티스)
> **왜**: Sentry(§13.21)는 서버 *예외*는 잡지만 **결제 생애주기의 정상 흐름·판정·dedup·실패사유**는 안 남긴다 —
> "돈 내고 0개" 같은 결제 사건을 사후 재구성할 감사 로그가 없었다(웹훅/confirm이 catch에서 reportError만). 사용자 요청으로
> **전용 append-only 감사 테이블 + 단계별 로깅**을 추가. RevenueCat/Play Billing/StoreKit·PII 로깅 베스트프랙티스를 독립 리서치로 반영.

- **테이블 `purchase_event`(schema.ts, append-only)**: 돈 진실은 `wallet_ledger`(불변) — 여기는 **진단 전용**. 25컬럼:
  상관(`requestId`·`storeTxnId`·`rcEventId`·`idempotencyKey`)·결과(`source`[client|webhook|confirm]·`stage`·`ok`·`outcome`[applied|deduped|rejected|pending|cancelled|ignored|error]·`reasonCode`·`errorMessage`)·금액/환경(`productId`·`price`·`currency`·`diamondsDelta`·`balanceAfter`·`environment`·`platform`·`appVersion`)·`detail`(jsonb). 인덱스 4(user+time·txn·rcEvent·reason). `userId`/`rcAppUserId`=text(익명 `$RCAnonymousID`·비UUID도 로깅되게 — insert 실패 방지).
- **핵심 개선(리서치)**: ① **`requestId` 상관ID** — 클라 브레드크럼↔confirm↔웹훅을 한 결제로 잇는다(웹훅은 storeTxnId로 매칭). ② **`outcome`를 `ok`와 분리** — `deduped`(멱등 재시도로 짐)는 실패가 아니라 정상. ③ **`idempotencyKey` 컬럼** → `wallet_ledger`와 JOIN해 지급 여부 증명. **"돈 내고 0개" = 구매 성공행이 있는데 `*.grant.applied`가 어디에도 없음**(있으면 deduped라 정상).
- **로깅 단계**: 웹훅=`auth.rejected`/`received`/`sandbox.filtered`/`ignored`/`type.decided`/`grant.applied|deduped`/`refund.applied|deduped`/`*.error`. confirm=`auth.rejected`/`received`/`reverify.rejected`/`grant.applied|deduped`/`*.error`. 클라(iap.ts)=`offerings`/`purchase`/`ok`/`cancelled`/`error`(진단 버퍼) + confirm 호출에 requestId·platform·appVersion 동봉(서버행에 클라 컨텍스트 적재).
- **★ 서버리스 유실 수정(라이브 실측 발견 2026-07-05)**: 라우트가 `void logPaymentEvent()`(await 안 함)로 던지면 Vercel 함수가 **응답 직후 freeze** → DB insert 완료 전 죽어 **로그 전량 유실**(로컬은 살아서 통과 = 웹훅 200인데 0행). §13.21 Sentry flush와 **동일 함정**. 수정: **`logPaymentEventAfter`**(라우트 전용)가 `after(() => logPaymentEvent(e))`로 응답 후 waitUntil 실행 → insert 완료 보장(응답 지연 0). 요청 밖(테스트)이면 즉시 실행. 디스코드 알림도 동일하게 `after()`. **검증**: dd14616 라이브에서 웹훅→purchase_event 적재 실측(received·sandbox.filtered 2행).
- **안전 계약(§13.21과 동일 결)**: `logPaymentEvent`는 **fire-and-forget·절대 throw 없음**(로깅 실패가 지급/응답을 롤백하지 않게 — 원장 커밋 뒤 별도 insert, 실패는 Sentry로만). **PII/토큰/영수증/시크릿 금지**: `detail`은 화이트리스트 스크럽(키 deny-list=authorization·token·receipt·email·secret·api_key·signed…, 문자열 300자컷, 중첩객체 스킵 — 원본 웹훅 바디 덤프 금지). `errorMessage` 500자 truncate.
- **조회**: `GET /api/admin/payment-events`(requireAdmin) — `source`·`fail=1`(실패만)·`txn`(한 결제 시간순 추적)·페이지네이션. `/api/admin/payments`(원장 기반)와 별개(이건 단계 진단).
- **RC 재검증 실패 정규화**: confirm의 `rc-unconfigured→RC_UNCONFIGURED`·`unknown-product→ITEM_UNAVAILABLE`·`txn-not-found→RECEIPT_INVALID`·`rc-network→NETWORK`·`rc-http-*→BACKEND_ERROR`(원사유는 detail 보존).
- **검증(Opus 4.8)**: 클라/서버 tsc 0 · 테이블 push(additive Expand-only) · **왕복 실증**(logPaymentEvent 삽입→읽기 9/9: 2행 기록·outcome/ok·다이아/잔액·**detail PII(email)·시크릿(authorization) 스크럽·중첩객체 스킵**·실패행 reasonCode, 테스트행 정리). **미검증**: 실결제 단계 로깅은 RC 콘솔·EAS 후 실기기 결제 시 라이브 확인.
- **디스코드 알림(2026-07-05, 사용자 요청)**: `server/lib/notify.ts` — 공통 `postDiscord`(url 없으면 no-op·throw 없음·4초 타임아웃) 위에 두 종류.
  - **결제/환불**(`notifyPurchase`): 실제 지급된(applied=true) 것만 통지. **정확히 1건**(웹훅·confirm 중 원장에 반영된 쪽만 — dedup은 알림 없음). 임베드=상품·다이아·₩금액·환경·경로·유저. 채널=`DISCORD_WEBHOOK_URL`.
  - **신규 문의**(`notifyTicket`): `/api/ticket` POST 성공 시 통지. 임베드=분류(🐞버그/💡건의/❓질문/↩️환불/🗂기타)·유저·기기·내용(1000자 컷). 채널=`DISCORD_TICKET_WEBHOOK_URL`(없으면 `DISCORD_WEBHOOK_URL` 폴백).
  - 공통: `after(() => …)`로 **응답 후** 전송(응답 지연 0·서버리스 유실 방지). PII 금지(userId 뒤 6자 마스킹, 이메일·이름 없음). 활성화(사용자 몫): 디스코드 웹후크 URL → Vercel env. **검증**: 결제 임베드 로컬 캡처 왕복 + 라이브 실발사 2건(204). 문의 임베드 로컬 캡처.
- **`afterSafe` 공용 가드(2026-07-06, 발견 검증 Fable 5)**: `next/server`의 `after()`는 요청 컨텍스트 밖(tsx 테스트 하니스·스크립트)에서 **throw**한다. 라우트가 지갑 반영(applyWallet) 뒤 `after(() => notify…)`를 **무가드로 직접** 부르면 알림 예약 throw가 라우트 catch로 떨어져 **"돈은 이동했는데 응답 500"**(_dv_purchase 웹훅 통합테스트 2FAIL로 재현 — `r.applied===true`일 때만 그 줄 도달과 일치). 대조군 `logPaymentEventAfter`는 이미 `try{after}catch{즉시실행}` 가드라 통과했었다. 수정: 그 가드를 **`server/lib/afterSafe.ts`의 공용 `afterSafe(task)`**(요청 밖이면 즉시 실행·throw-none 관찰 task 전용)로 추출해 알림·감사로깅(`paymentLog`)·Sentry flush(`observability`) 전 라우트를 통일 — 관찰 사이드채널이 머니패스 응답을 오염시키지 못하게. 형제 가드: 라우트에 관찰 채널 추가 시 _dv_purchase 재실행(TEST_METHODOLOGY §4).
- **파일**: `server/db/schema.ts`(purchase_event)·`server/lib/paymentLog.ts`(신)·`server/lib/notify.ts`(신·디스코드)·`server/app/api/purchase/webhook/revenuecat/route.ts`·`.../confirm/route.ts`(단계 로깅+알림)·`server/app/api/admin/payment-events/route.ts`(신·조회)·`lib/iap.ts`·`lib/server.ts`(requestId 상관·클라 컨텍스트).

### 13.23 세이브 복구 채널 (손상 세이브 복구) — 📋 설계(2026-07-07, 미구현 — #43 결제/온라인 백엔드 뒤 착수)
> **아직 안 만듦.** 사용자와 확정한 설계만 기록한다. **#43 결제/온라인 백엔드가 자리 잡은 뒤 착수.**

- **배경/문제**: 게임 세이브는 **기기 로컬**(결정론 격리 — 서버는 재화·계정·결제·로그·문의·통계만, 시드/리플레이엔 안 들어감 §1·§8).
  서버에 세이브 사본이 없어, 모종의 사유로 사용자 세이브가 손상되면 **직접 복구할 길이 없다**. 현재 방어는 두 가지뿐:
  (a) **세이브 마이그레이션**(version/migrate/안전복원 — 구조 변경 안전, [SAVE_SYSTEM](./SAVE_SYSTEM.md)) + (b) **문의 진단 스냅샷**(사용자 세이브+리플레이가 서버로 업로드돼 관리자가 조회 §13.20).
  즉 "**안 깨지게** + **문제 재현**"까지만 커버하고, **고친 세이브를 기기로 되돌려주는 채널이 없다.**
- **설계(사용자 확정안 — 파일 주고받기 없음)**: 서버 `users`에 **`recoveryData` 컬럼(nullable)** 추가. 이 컬럼 하나가
  **권한 신호 + 실제 데이터(payload) + 자동 회수**를 겸한다:
  1. 관리자가 (진단 스냅샷으로 받은 손상 세이브를) 고쳐서 그 컬럼에 넣는다 → **값 존재 = 권한** → 그 계정 앱에 "데이터 복구하기" 버튼이 활성.
  2. 사용자가 버튼을 누르면 앱이 그 데이터를 받아 적용(로컬 세이브 교체).
  3. 적용 성공 → **서버가 그 컬럼을 삭제** → 버튼 자동 비활성(권한 소멸).
  - 사용자는 **아무것도 업로드하지 않는다**(서버가 배달) → **임의 세이브 주입 불가**(체크섬/파일검증 불필요). 개인 쿠폰(targetUserId §13.14)·공지(§13.13)와 같은 "계정별 서버 관리" 결.
- **완성 조건 3(필수)**:
  ① **적용 시 version/migrate/스키마 검증**(깨진 데이터 재주입 방지 — SAVE_SYSTEM 경유).
  ② **적용 직전 현재 세이브 자동 백업**(복구본이 잘못돼도 되돌리기).
  ③ **컬럼 삭제는 반드시 앱이 적용 성공을 서버에 보고한 뒤**(받자마자 삭제 금지 — 중간 크래시 시 복구본 소실 방지).
- **보안**: 게임 세이브는 **싱글플레이 + 로컬**이고 **다이아·결제는 서버 진실(세이브에 없음)** → 세이브를 교체해도 **과금 치팅 통로가 아니다**
  (이미 개발용 +1000💎와 같은 결 — §6 유저 관대). 서버 게이팅 + 서버 배달로 남용 원천 차단.
- **인프라 궁합 / 순서**: `recoveryData`는 개인 쿠폰·공지와 **동일한 계정별 서버 관리 패턴**. 앱은 **부팅(bootstrap)** 때 읽어 버튼 노출.
  관리자 대시보드(§13.15)에 **"복구본 입력(userId별)"** 추가. **#43 결제/온라인 백엔드가 자리 잡은 뒤 착수.**
  이 채널이 향후 **기기변경 이어하기·클라우드 백업(Phase 7)** 의 발판.
- **스키마 주의**: 운영 단계에서 컬럼 추가는 **Expand/Contract**(NOT NULL 추가 금지, **nullable**로) — 기존 prod-schema-migration 규율(§13.7) 준수.

### 13.24 dev 환경 구축 (온라인 기능 개발 전 필요) — 📋 설계(2026-07-07, 미구현 — 온라인 기능 개발 착수 시)
> **아직 안 갖춤.** #43 결제·#46 통계 등 온라인 기능을 dev에서 실제로 테스트하려면 dev용 서버/DB가 필요하다는 메모.

- **현재 문제**: dev 앱이 **prod Vercel/Supabase 하나**에 붙는다 → 보안수정 #2(b)가 **prod에서 dev provider를 401 차단**([SECURITY_AUDIT](./SECURITY_AUDIT.md)) →
  개발자 로그인이 **로컬 세션 폴백**(`useAuthStore` `__DEV__`, 커밋 7c8de2a)으로 **UI만 진입**, **온라인 기능(지갑·다이아·쿠폰·결제) 테스트 불가**.
- **셋업(#43 결제·#46 통계 등 온라인 기능 개발 착수 시)**:
  1. **두 번째 Supabase 프로젝트 = dev DB**(무료티어 2개 가능) + 마이그레이션.
  2. **Vercel `DATABASE_URL` 환경별 분리**(Production=prod / Preview·Development=dev) — Preview 배포는 `VERCEL_ENV=preview`라 **dev 로그인 자동 허용**(#2b는 production만 차단).
  3. **dev 앱 `EXPO_PUBLIC_SERVER_URL`=Preview URL 또는 로컬 `npm run dev`**.
- **효과**: dev DB가 생기면 못 돌린 **라이브 가드**(`walletConcurrency`·`_dv_walletreplay`·`_e2e_backend`)도 실행 가능.

### 13.25 관리자 대시보드 11섹션 지표 명세 — pull-and-cache 롤업·집계·화면 (🚧 지금-가능분 구현 2026-07-09 · 나머지 EAS 계측 후)
> **상태**: 사용자 확정(2026-07-09). **지금-가능분 구현 완료(2026-07-09)** — 11섹션 골격 재구성 + 원장/서버 파생 실데이터. 나머지(외부-sync·게임 도메인 [자체-롤업])는 **EAS 계측 후**. 이 절은 §13.15(관리자 대시보드) **확장**이며 서버측 정본(롤업 스키마·집계 라우트·ops 화면·CSV·이상징후).
> "무엇을 보여줄지(지표·출처 분류·track 이벤트)"는 **[ANALYTICS_PLAN §6](./ANALYTICS_PLAN.md)** 이 정본 — 이 절과 짝. 대부분 **EAS 계측(track()) 이후** 가능(원장 파생분·서버 근사·Sentry API는 그전).

> **✅ 지금-가능분 구현(2026-07-09)** — §F-1 스코프(원장·서버 보유분)만. 커밋 전 서버 tsc·`next build` PASS(신규 라우트 `/api/admin/bm`·`/api/admin/errors` 등록 확인).
> - **화면 재구성**: `ops-9f3a2c`를 11섹션 IA로 재정렬 — 대시보드(⑪ 메인 KPI 카드행 + ⑩ 운영 알림) · **분석 그룹** ①사용자현황 ②리텐션 ③플레이 ④오프시즌 ⑤BM ⑥광고 ⑦경기 ⑧선수 ·업적 · **운영 그룹** ⑨오류 ·쿠폰·공지·문의·설정. 기존 탭(쿠폰·공지·문의·환불·설정·업적) **무회귀 유지**(재배치일 뿐 삭제 아님).
> - **실데이터(구현)**: **①**(가입 추이 series `metric=signups` 일/주/월 토글 + 사용자 목록 + CSV) · **⑤ BM**(상품별 다이아 지급 건수·합·결제자 = 원장 reason='purchase' ref=productId `/api/admin/bm`; 결제전환·환불 기존 재사용) · **⑥ 광고**(원장 reason='ad' 기존 series 재사용 + CSV) · **⑨ 오류**(서버 머니패스 오류 = `purchaseEvent` ok=false 사유별·최근목록 `/api/admin/errors`) · **⑩ 운영 알림**(stats.alerts — 완결 어제 vs 그제 신규가입 급감·결제오류 급증 임계 판정, baseline 노이즈 차단) · **⑪ 메인 KPI**(DAU근사·총가입·신규·결제전환·매출[0] 실값). **CSV는 클라 생성**(BOM+escape — 서버 export 라우트는 데이터가 클라 fetch분을 넘을 때 도입, 현 볼륨 불요).
> - **placeholder(EAS 후)**: **②리텐션·③플레이·④오프시즌·⑦경기·⑧선수** = 골격 카드("무슨 지표를·언제 보여줄지" 명시) · ⑤ ARPU/ARPPU/상품별 매출액(RevenueCat #43 후) · ⑥ eCPM/노출/수익(AdMob API 후) · ⑨ Sentry(API키 후 pull; `SENTRY_API_TOKEN` 있으면 골격 통과·없으면 "미설정" 배지 throw-none)·Crashlytics(EAS 후) · ⑪ MAU·D1/D7/D30·ARPU 등 "—"+"EAS 후" 배지.
> - **Discord push**: ⑩ 알림은 **화면 카드**만 구현(GET마다 push=스팸이라 금지). Discord 발송은 §E대로 **Cron 배치**가 담당(배포 시 Vercel Cron + `DISCORD_WEBHOOK_URL` `notify.ts` 패턴) — 미배선.
> - **파일**: `server/app/api/admin/{stats(alerts 추가),series(signups 추가),bm(신),errors(신)}/route.ts` · `server/app/ops-9f3a2c/page.tsx`(11섹션) · `.env.example`(SENTRY_API_TOKEN 등 주석). 롤업 신테이블(externalDaily·gameRollupDaily)은 **EAS/외부-sync 단계에 도입**(현 실데이터는 기존 users·walletLedger·statsDaily·purchaseEvent로 충분).

**핵심 결정 — 모든 걸 우리 화면 한 곳에서(pull-and-cache)**: 관리자가 외부 콘솔(Firebase·RevenueCat·AdMob·Sentry)을 따로 열지 않고 **ops-9f3a2c 한 화면에서 11섹션 전부** 본다. 아키텍처:
```
[외부 원천]  GA4/BigQuery · RevenueCat · AdMob · Sentry/Crashlytics
     │  서버 배치가 외부 API/Export로 pull(일 1회 등)
     ▼
[서버 롤업/캐시]  statsDaily(확장) + externalDaily(신) + gameRollupDaily(신)
     ▼
[ops-9f3a2c]  11섹션 탭/카드 · 일/주/월 · 그래프+숫자 · CSV
```
- **진실 원천 분리 유지**(재계산·이중수집 금지): 외부 지표는 그 도구가 원천, 우리는 **값을 캐시만** 한다. 게임 도메인 지표는 우리가 직접 롤업.
- **결정론 격리 명시**: 통계·외부 sync 캐시는 **재화/시드/리플레이와 무관한 순수 메타**(§8). 시드/리플레이엔 안 들어가고, 통계 실패가 지급/응답을 롤백하지 않음(§13.21·13.22 관찰 사이드채널 계약과 동일 — `afterSafe`/throw-none).

**A. 서버 롤업/캐시 스키마 초안**(전부 `proj_code` FK — §13.2 멀티게임 격리, PK=`(projCode, day)`):
- **`statsDaily`(기존 확장)**: 현 컬럼(revenueKrw·purchaseCount·diamondsPurchased·newUsers) 유지 + **Expand-only 추가**(nullable/default 0 — prod 스키마 규율 §13.7): `dauApprox`·`wanU`·`manU`(서버 근사 활성, lastSeenAt 기반) · `withdrawn` · `adCount`·`adRevenueMicros`(원장/AdMob) · `payers`.
- **`externalDaily`(신, [외부-sync] 캐시)**: `source`(ga4|revenuecat|admob|sentry) · `day` · `metric`(dau|wau|mau|d1|d7|d30|arpu|arppu|sessionLenMs|ecpm|adImpressions|crashFreeRate|apiErrorCount…) · `valueNum` · `valueJson`(코호트 매트릭스 등 구조값) · `syncedAt`. **원천이 계산한 값을 그대로 적재**(우리가 재계산 안 함). PK `(projCode, source, day, metric)`.
- **`gameRollupDaily`(신, [자체-롤업])**: 게임 도메인 일별 집계 — `metric`(seasonComplete1|3|5|10 · offseasonFunnelStage · matchCount · avgMatchMs · avgSets · draftPickPos · foreignSign · retireAge · ovrGrowth · trainingCampRate …) · `dim`(포지션·팀·시즌번호 등 분해축) · `valueNum`. track() 이벤트 수신 집계 또는 BigQuery 쿼리 결과 적재. PK `(projCode, day, metric, dim)`.
- (선택) **`cohortRetention`(신)**: `installDay`·`dN`(1/3/7/14/30)·`retainedPct` — ② 코호트 표 전용(externalDaily.valueJson로 대체 가능, 표가 크면 분리).

**B. 외부 API sync 배치**(서버, [외부-sync] 공통 계약):
- **주기**: 기본 **일 1회 배치**(Vercel Cron `/api/admin/sync/*` 또는 스케줄 라우트). 실시간성 필요분(⑩ 알림 판정)은 앱 대시보드 열 때 on-demand 재sync 허용.
- **커넥터**: `POST /api/admin/sync/revenuecat`(RC REST → 매출·ARPU·ARPPU·상품별) · `/sync/ga4`(GA4 Data API → DAU/WAU/MAU·세션·리텐션) · `/sync/bigquery`(코호트 SQL) · `/sync/admob`(AdMob API → 노출·eCPM·수익) · `/sync/sentry`(Sentry API → API오류 건수·최근 이슈). 각각 `externalDaily` upsert.
- **인증**: 외부 API 키는 **서버 env 보관**(`RC_REST_API_KEY` 이미 존재 §13.18 · `GA4_*`·`ADMOB_*`·`SENTRY_API_TOKEN`·`BIGQUERY_SA_JSON` 신규 — `.env.example`만 커밋, 실키 연결단계 §12·M4). 클라 노출 0.
- **실패 폴백**: sync 실패 시 **마지막 캐시(externalDaily 직전 값) 표시** + "n시간 전 동기화" 배지. **화면 절대 안 막음**(throw-none). 실패는 Sentry/Discord로만.

**C. 집계·조회 라우트**(전부 `requireAdmin` fail-closed §13.15): 기존 `/api/admin/{stats,series,users,payments,achievements,payment-events}` **유지** + 신설:
- `GET /api/admin/dashboard?granularity=day|week|month` — 11섹션 **합성** 페이로드(메인 KPI + 각 섹션 요약). externalDaily+gameRollupDaily+statsDaily 조합.
- `GET /api/admin/section/{play|offseason|match|player|retention|error|alerts}?granularity=` — 섹션별 상세(그래프 시계열+표).
- `GET /api/admin/export?section=&granularity=&format=csv` — **CSV/엑셀 다운로드**(전 섹션 공통 요구). UTC 버킷·헤더행·escape. (§13.15 series의 UTC 버킷 규약 재사용.)
- `POST /api/admin/sync/{revenuecat|ga4|bigquery|admob|sentry}` — B의 커넥터(Cron/수동 트리거).

**D. ops-9f3a2c 화면 — 11섹션 IA**(§13.15 "분석/운영 그룹" 사이드바 확장. "대시보드에 다 넣지 마라" 원칙 유지 — 대시보드=합성 KPI만, 상세는 각 메뉴):
- **최상단 = ⑪ 메인 KPI 카드행**(가장 크게): DAU·MAU·D1·D7·D30·첫시즌완료율·평균플레이시간·결제율·ARPU·ARPPU·일매출·월매출. [외부-sync]+[자체-롤업] 합성.
- **⑩ 운영 알림 = 대시보드 상단 이상징후 카드**(빨강): D1급감·결제율급감·광고수익급감·서버오류증가·크래시증가. 배치가 전일 대비 임계 판정 → 카드 + Discord.
- **분석 그룹 메뉴**(각 탭, 일/주/월 토글 + 그래프+숫자 + CSV): ① 사용자현황 · ② 리텐션 코호트(설치일 매트릭스 표) · ③ 플레이(★시즌 진행률) · ④ 오프시즌 funnel · ⑤ BM · ⑥ 광고 · ⑦ 경기데이터 · ⑧ 선수데이터.
- **운영 그룹**: ⑨ 오류 모니터링(크래시·API·로그인 건수+최근로그) — 기존 쿠폰·공지·문의/환불·설정과 같은 그룹.
- **표시 규율**(§13.15 계승): 인라인 스타일 + 내장 `<style>`만(외부 스크립트 0·XSS 최소)·`noindex`·`.oc-main` max-width 1200 중앙정렬. 차트는 기존 SVG 인라인(라이브러리 0) 재사용.

**E. ⑩ 이상징후 판정**(서버 배치 — [합성]): 전일/전주 대비 임계(예: D1 −30%·결제율 −40%·광고수익 −40%·서버오류 +N배·크래시 +N배) 초과 시 `alerts` 생성 → **Discord 알림**(§13.22 `notify.ts` 패턴 재사용, `afterSafe`·PII 금지) + 대시보드 상단 카드. 임계는 setting으로 조정 가능하게.

**F. 의존성·순서**:
1. **지금~서버 단계**(원장·서버 보유): ⑤ 원장 파생(purchase 건수·다이아)·⑥ 원장 reason='ad'·① 서버 근사 DAU·⑨ Sentry API·⑩ 서버오류 알림. statsDaily 확장 + externalDaily(sentry) + 알림 배치.
2. **EAS 계측(track()) + 서버 이벤트 수신 파이프라인 후**: ③④⑦⑧ 게임 도메인 [자체-롤업](gameRollupDaily). track() 이벤트가 서버에 도달해야 집계.
3. **EAS 빌드 + 외부 API 키 연결 후**: [외부-sync] 전부(GA4/BigQuery 리텐션·플레이시간, RevenueCat ARPU/ARPPU, AdMob eCPM, Crashlytics).
> **track() 이벤트 수신 파이프라인**: 현재 track()은 Firebase/GameAnalytics로만 감(§2-1). 게임 도메인 [자체-롤업]은 **서버가 그 이벤트를 받거나(신 `/api/telemetry` 확장·이미 스키마 `TelemetrySession` 예정 §13.2) BigQuery Export를 쿼리**해야 함 — 둘 중 선택은 구현 시 결정(BigQuery 경유가 이중수집 없음).

**G. 검증(구현 시)**: 롤업 순수 집계는 `_dv_*`(DB 무의존 A/B 자가검증) · sync 커넥터는 폴백/throw-none 라이브 가드 · CSV escape/UTC 버킷 가드 · 이상징후 임계 판정 A/B. §13.15 라이브 E2E(requireAdmin 401·proj 스코프) 계승.

**H. 파일(구현 시 예상)**: `server/db/schema.ts`(statsDaily 확장·externalDaily·gameRollupDaily·cohortRetention)·`server/lib/rollup.ts`(게임 도메인 집계)·`server/lib/externalSync/{revenuecat,ga4,bigquery,admob,sentry}.ts`(커넥터)·`server/app/api/admin/{dashboard,section/*,export,sync/*}/route.ts`·`server/app/ops-9f3a2c/page.tsx`(11섹션 탭)·`.env.example`(외부 API 키). track 이벤트 taxonomy 개정은 앱 `lib/analytics`(ANALYTICS_PLAN §6.3).

### 13.26 시즌 종료 세이브 백업 (서버측 스냅샷 보관) — ✅ 서버측 구현(2026-07-16)
> **상태**: 서버측(스키마·업로드/목록/다운로드 라우트·라이브 가드) 구현 완료(2026-07-16). 클라이언트(시즌 종료 시 자동 업로드·복원 UI)는 병렬 작업.
> 이 절은 **API 계약이 인터페이스** — 아래 계약은 클라와 공유된 고정 계약이므로 서버는 이대로 응답한다.

- **배경/문제**: 게임 세이브는 **기기 로컬**(결정론 격리 — 서버는 재화·계정·결제·로그·문의·통계만, 시드/리플레이엔 안 들어감 §1·§8).
  §13.23(세이브 복구 채널)이 "관리자가 고쳐 되돌리는" **손상 복구**를 다룬다면, 이 절은 그 앞단 — **평시 자동 백업**이다:
  **앱 업데이트 중 크래시·기기 분실·마이그레이션 사고로 세이브가 통째로 날아가는 전손(全損)** 을 막는다. 세이브는 base 스냅샷+currentDay+results 리플레이라 작아(§8),
  **시즌 종료 순간의 내보내기 JSON을 통째로 서버 blob으로 보관**하면 최근 몇 시즌은 언제든 되돌릴 수 있다.
- **결정론 격리 유지(핵심 제약)**: 서버는 payload를 **불투명 blob으로 보관만** 한다 — **게임플레이에 일절 개입 안 함**(파싱해서 시드/리플레이/재화에 쓰지 않음).
  서버가 payload를 여는 건 **봉투 검증(app/kind)과 목록용 메타(version) 추출**까지뿐, **내용(state)은 신뢰하지 않는다**(진단 스냅샷 §13.20·개인 쿠폰 §13.14와 같은 "계정별 서버 관리 blob" 결).
- **API 계약(클라와 공유 — 고정)**:
  - `POST /api/save-backup` (Bearer 필수) — body `{ season:number, payload:string }`. payload는 클라 내보내기 JSON 문자열(`{app:'baeknyeon',kind:'save-export',version,state}` 직렬화본).
    응답 `{ ok:true, id, keptCount }`. 서버 검증: **크기 상한 3MB**(payload 바이트 초과 시 **413** 거부) · payload가 JSON 파싱되고 **app==='baeknyeon' && kind==='save-export'** (봉투만 확인, 내용 불신 — 불일치 시 **400**) · **season 정수**(아니면 400).
    `saveVersion`은 봉투 `version`에서 추출해 컬럼 저장(목록 표시용).
  - `GET /api/save-backup` (Bearer) → `{ ok:true, backups:[{ id, season, createdAt, sizeBytes, saveVersion }] }` — **payload 미포함**(목록은 가볍게), 최신순.
  - `GET /api/save-backup/<id>` (Bearer) → `{ ok:true, payload:string }` — **본인 것만**(타 유저 id 조회 = **404**, 존재 여부도 노출 안 함).
  - 인증은 `requireUserId`(fail-closed·익명 폴백 금지 §13.17 P0-5) — 무토큰/위조 = 401. proj 스코프(§13.2) 모든 쿼리에 적용.
- **보관 정책(롤링)**:
  - **유저당 최근 5개**만 보관. 삽입 후 그 유저 백업이 5개 초과면 **가장 오래된 것(created_at 오름차순)부터 삭제**.
  - **같은 season 재업로드 = 교체**(중복 행 방지) — 삽입 전에 같은 (projCode,userId,season) 행을 삭제하고 새로 넣는다(재업로드는 "새 백업"으로 최신화 → created_at 갱신, 슬롯 1개 유지). 하드 가드로 `(proj_code,user_id,season)` UNIQUE 인덱스.
  - **3MB 캡**: 세이브는 리플레이 기반이라 정상 크기는 수십~수백 KB. 3MB는 넉넉한 상한이자 남용/오류 방어(초과 413).
- **보상 정책(운영 — 복원 시 재화 정합)**:
  복원으로 유저가 잃는 것 = **백업 시점 이후의 진행**뿐. 그 구간에서 쓴 **전지훈련 다이아 차감**은 `wallet_ledger`에 `reason='camp'`·`created_at > 백업 시점`으로 **원장에 그대로 남아 식별 가능** →
  해당 구간 camp 차감 합을 **개인 쿠폰(targetUserId §13.14)으로 동액 재지급**한다(운영 수동). **원장 기준이라 분쟁 여지 없음**(재화 진실은 서버 §6, 세이브엔 재화 없음 — 세이브를 되돌려도 다이아는 서버에 그대로).
  즉 세이브 백업은 **게임 진행만** 되돌리고, **재화는 원장이 정본**이라 별도 정합(쿠폰 보상)으로 맞춘다.
  **콘솔 완결(2026-07-16, P2-c)**: 이 camp 차감 합 계산이 이전엔 콘솔에 없어(`/api/admin/payments`가 purchase/refund만) curl 의존이었다 → **⑤ BM 유저 원장 조회**(reason·기간 필터+합계, §13.17)로 백업 시점(`since`) 이후 `reason='camp'` 합을 콘솔에서 바로 산출 → 개인 쿠폰 발급까지 콘솔만으로 완결.
- **스키마**: `save_backups`(id·proj_code FK·user_id FK·season·payload text·size_bytes·save_version·created_at). 인덱스: `(proj_code,user_id)` 조회/롤링 + `(proj_code,user_id,season)` UNIQUE(교체 하드가드).
- **검증**: 라이브 가드 `server/tools/_dv_backup_live.ts` — ① 업로드→목록 등장(sizeBytes·saveVersion 정확) ② 6개→5개 유지(최고령 삭제) ③ 同시즌 재업로드=교체(행 수 불변) ④ 다운로드 payload 바이트 왕복 동일 ⑤ 무토큰 401·타유저 id 404 ⑥ 3MB 초과 413 ⑦ 쓰레기 payload(봉투 불일치) 400 + A/B(상한·봉투 검증 제거 모사 시 통과됐을 입력이 실제로 거부됨을 증명). 서버 가드 배터리에 추가(README 검증 루틴 등재는 메인 세션).
- **파일**: `server/db/schema.ts`(save_backups)·`server/app/api/save-backup/route.ts`(POST 업로드+GET 목록)·`server/app/api/save-backup/[id]/route.ts`(GET 다운로드)·`server/tools/_dv_backup_live.ts`(가드).
- **인프라 순서**: 세이브 백업은 **재화 진실과 무관한 순수 blob 보관**(§8 결정론 격리) — 온라인 백엔드(#43) 위에 얹히지만 결제/시드/리플레이엔 안 들어간다. 클라 자동 업로드(시즌 종료 훅)·복원 UI(부팅 시 백업 목록 노출)는 후속.
