# 결제 상품 런칭 런북 (#43)

> **성격**: 이 문서는 **실행 절차서**다. 집에 와서 위에서 아래로 체크박스를 따라가면 결제가 켜지도록 만든 순서표 + 테스트 범위.
> **설계 정본이 아니다** — 결제 구조·수익화·재화 진실 소유는 아래 정본이 결정하고, 이 런북은 그 결정을 "어떻게 실행하나"만 적는다.
> 절차와 설계가 어긋나 보이면 **정본이 이긴다**(이 문서를 고쳐 맞춘다).
>
> **정본**
> - `docs/BACKEND_SYSTEM.md` §13.18 (RC 게이트웨이 구조·env·멱등키), §13.19(어뷰징 방어), §13.22(결제 감사 로그·디스코드 알림)
> - `docs/MONETIZATION_SYSTEM.md` §4.1(엔타이틀먼트 카탈로그)·§11(다이아 팩·전지훈련)·§5(컴플라이언스)
> - `docs/PRE_LAUNCH_CHECKLIST.md` §2(EAS 실물 전환)·§3(결제·환불)
> - 배포·빌드 스킬: `.claude/skills/deploy-prod/SKILL.md` · `.claude/skills/release-build/SKILL.md`
> - 컴플라이언스: `payment-security-compliance` 스킬(유저레벨)
>
> **한 줄 구조(외우고 시작)**: 소모성 다이아 팩 = **우리 원장이 진실**(RC 웹훅 → `wallet_ledger` 지급). 비소모 엔타이틀먼트(광고 제거·월드컵 DLC) = **RC customerInfo가 진실**(원장 무관). **RC Virtual Currency 금지**(진실의 원천 2개 부활).

---

## 상품 카탈로그 — 이 표가 모든 등록의 기준 (실측 확인 2026-07-16, `_dv_walletauth` PASS)

콘솔·RC·서버가 **전부 이 id와 글자 단위로 일치**해야 한다. 오타 = 지급 0(fail-closed).

### 소모성 다이아 팩 6종 (Play Console: 인앱 상품 / 관리형 상품, 소비성)
| productId (스토어 = 서버 키) | 지급 다이아 | 표시가격(₩, 설계) | 개당 |
|---|---|---|---|
| `dia_100`   | 100    | 1,000  | ₩10.0 · 기준 |
| `dia_500`   | 500    | 4,800  | ₩9.6 · -4% |
| `dia_1000`  | 1,000  | 9,300  | ₩9.3 · -7% |
| `dia_2500`  | 2,500  | 22,500 | ₩9.0 · -10% |
| `dia_5000`  | 5,000  | 43,500 | ₩8.7 · -13% |
| `dia_10000` | 10,000 | 84,000 | ₩8.4 · -16% |

- productId 권위 = `server/lib/products.ts` `DIAMOND_PRODUCTS`. 지급 다이아는 **서버 권위**(클라 amount 무시).
- 표시가격 = `data/diamondTiers.ts priceKrw`(설계·표시용). **실제 청구가는 스토어 등록값이 정본** — 등록 시 위 ₩와 맞출 것(누진 할인은 가격에만, 보너스 다이아 아님).

### 비소모 엔타이틀먼트 (Play Console: 인앱 상품 / 비소비성)
| productId | 이름 | 표시가격 | 출시 등록 여부 |
|---|---|---|---|
| `remove_ads` | 광고 제거 | ₩5,000 | ✅ 등록·판매 |
| `dlc_worldcup` | 월드컵 시즌 | (별도) | ❌ **출시 시 등록 보류** — `data/flags.ts WORLDCUP_ENABLED=false`라 앱 상점에서 숨김. 기능 구현·플래그 true 전엔 팔지 않는다 |

- 엔타이틀먼트는 **RC customerInfo 소유가 진실**, 원장 미지급.
- **RC 엔타이틀먼트 id ≠ 구매 상품 id**: 광고제거는 엔타이틀먼트 id도 `remove_ads`(동일), 월드컵은 구매상품 `dlc_worldcup` ↔ **RC 엔타이틀먼트 id `worldcup`**(다른 두 문자열 — `lib/iap.ts RC_ENTITLEMENT_WORLDCUP`).

> ⚠ **SKU 명명 제약(코드 확인 결과)**: `lib/iap.ts`에는 SKU **형식(정규식) 검증이 없다**. SKU는 리터럴 상수(`SKU_REMOVE_ADS='remove_ads'` 등)이고, `productId`는 위 표의 문자열 그대로다. 가드 `_dv_walletauth` §8이 쓰는 정규식(`export const NAME = '([^']+)'`)은 **소스에서 상수를 추출**하는 용도지 SKU 형식을 강제하는 게 아니다. → **콘솔 등록 규칙 = "형식 자유, 위 표의 productId와 정확히 동일한 리터럴"**. 대소문자·언더스코어까지 1:1.

---

## §0 사전조건 현황판

- [x] **사업자등록** 완료 (2026-07-16 사용자 확인)
- [x] **통신판매업 신고** 완료 (2026-07-16 사용자 확인)
- [ ] **Play Console 개발자 계정** 활성(등록비 결제·계정 승인 완료) — 콘솔에서 확인
- [ ] **결제 프로필 / 판매자 계정(Google Payments merchant)** 생성·승인 — 인앱 상품 판매의 전제. 콘솔 "결제 프로필"에서 확인
- [ ] **세금 정보 / 수수료 프로필** 기입 — 콘솔에서 확인
- [ ] **판매자 정보에 통신판매업 신고번호 기입** (전자상거래법 표시의무) — 콘솔 스토어 등록정보 / 판매자 정보란에 기입, 앱 내 "사업자 정보" 노출 위치도 확인
- [ ] **개인정보 처리방침 URL** 게시(결제 5년·분쟁 3년 보존·진단 스냅샷 첨부 고지) — PRE_LAUNCH §3, 스토어 심사 필수
- [ ] **RevenueCat 계정** 생성 — §2에서 진행
- [ ] **Discord 웹훅 URL**(결제·문의 알림 채널) 준비 — 있으면 §3에서 주입, 없으면 후속

> 모르는 항목은 체크 안 함 = "콘솔에서 확인 필요". 사실이 아닌 상태를 미리 체크하지 말 것.

---

## §1 Play Console 상품 등록 (오늘 저녁 시작점)

> **의존 관계(먼저 확인)**: 인앱 상품을 만들려면 **앱이 이미 콘솔에 생성**돼 있어야 하고, 상품을 **활성 판매/테스트**하려면 앱이 **심사 트랙(최소 내부 테스트)** 에 빌드가 올라가 있고 **IARC 등급분류 설문**이 끝나 있어야 하는 게 일반적이다. IARC 설문은 **P2W(다이아=전력)·리워드 광고를 사실대로** 반영해 획득한다(MONETIZATION §5). ※과거 이슈 트래킹의 "IARC #108" 항목이 이 선행조건을 가리키는지는 **확인 필요** — 콘솔 "정책 > 앱 콘텐츠 > 콘텐츠 등급"에서 실제 상태를 본다. 상품 등록 자체는 빌드 없이도 초안 생성이 되나, **테스트 결제까지 가려면 §4의 내부 테스트 트랙 AAB 업로드가 선행**돼야 한다.

- [ ] Play Console > 해당 앱 > **수익 창출 > 상품 > 인앱 상품**으로 이동 (메뉴 명칭은 콘솔에서 확인)
- [ ] **소모성 다이아 팩 6종** 생성 — 상품 ID를 위 표의 `dia_100`…`dia_10000`와 **정확히 일치**, 가격을 표의 ₩로 설정, 상품 유형 = 소비성:
  - [ ] `dia_100`  · ₩1,000
  - [ ] `dia_500`  · ₩4,800
  - [ ] `dia_1000` · ₩9,300
  - [ ] `dia_2500` · ₩22,500
  - [ ] `dia_5000` · ₩43,500
  - [ ] `dia_10000` · ₩84,000
- [ ] **`remove_ads`(광고 제거) · ₩5,000** — 상품 유형 = 비소비성
- [ ] **`dlc_worldcup` 등록 보류** — 출시 카탈로그에 넣지 않는다(WORLDCUP_ENABLED=false). 나중에 기능 노출 시 등록
- [ ] 각 상품 **활성화**(초안→활성). 상품 설명·이름은 한국어로(스토어 노출)
- [ ] **라이선스 테스터 등록** — Play Console > 설정 > **라이선스 테스트**에 테스트 계정 Gmail 추가(테스트 결제 시 실제 청구 없음). 응답=`LICENSED`. 실기기의 Play 로그인 계정과 동일해야 함
- [ ] (등록 후) **스토어 SKU ↔ 서버 카탈로그 1:1 재확인** — `npx tsx tools/_dv_walletauth.ts`가 그린이면 서버↔클라 6팩이 정합. 콘솔 등록 id를 이 표와 눈으로 대조(가드는 콘솔을 못 봄)

---

## §2 RevenueCat 설정

> RC = 영수증 검증·환불 웹훅·엔타이틀먼트 게이트웨이. **다이아 잔액 진실은 계속 우리 원장**(RC Virtual Currency 기능 **금지**).

- [ ] RevenueCat 대시보드에서 **프로젝트 생성**
- [ ] **Android 앱 연결** — 패키지명 `com.son0925.volleyball`(app.json `android.package`)
- [ ] **Play 서비스 계정 JSON 발급·연결** — Google Cloud/Play Console에서 서비스 계정 생성 → **최소 권한**(재무·주문 조회/구독 관리에 필요한 것만) → JSON을 RC에 업로드. (스토어 크레덴셜은 **RC가 보관**, 우리 서버 미보관 — PRE_LAUNCH §3)
- [ ] **상품 임포트** — RC Products에 §1의 6팩 + `remove_ads` 임포트(id 동일)
- [ ] **엔타이틀먼트 매핑** — RC 엔타이틀먼트 `remove_ads`에 상품 `remove_ads` 연결. (월드컵은 출시 보류 — RC 엔타이틀먼트 `worldcup`은 기능 노출 시)
- [ ] **오퍼링 매핑** — 다이아 6팩 + remove_ads를 current offering의 패키지로. (`lib/iap.ts`는 `offerings.current.availablePackages`에서 `product.identifier === productId`로 찾음 — 패키지가 current offering에 없으면 "상품을 찾을 수 없음")
- [ ] **웹훅 등록** — RC > Integrations > Webhooks:
  - URL = `<prod 도메인>/api/purchase/webhook/revenuecat`
  - Authorization 커스텀 헤더 값 = **강한 시크릿**(≥16자). **dev와 다른 값**(dev는 `.env.development.local`의 로컬 전용). 이 값을 §3에서 Vercel `RC_WEBHOOK_SECRET`에 그대로 주입
- [ ] **RC 공개 SDK 키(publishable, Android)** 확보 → §4에서 `EXPO_PUBLIC_REVENUECAT_API_KEY`로
- [ ] **RC REST API 키(secret)** 확보 → §3에서 Vercel `RC_REST_API_KEY`로(confirm 폴백 재검증용)

> 값은 채팅/로그/커밋에 붙여넣지 말 것(시크릿). Vercel env·`.env`에 직접 입력.

---

## §3 서버 배포 (prod)

> 절차 정본 = `.claude/skills/deploy-prod/SKILL.md`. 여기선 결제 특화 항목만 추가.

- [ ] **prod 마이그레이션 잔여분 적용** — devnotes·account·save_backups 등 미적용 마이그레이션을 `deploy-prod` §1(**:5432 직결 `drizzle-kit migrate`**, push 아님)로. 파괴적 변경 없는지 스키마 diff 분류 먼저(SKILL 사전체크). 결제 테이블(`purchase_event`·`stats_daily`·`wallet_ledger`)은 이미 스키마에 존재
- [ ] **env 백업** — `cp server/.env.local server/.env.local.bak-$(date +%y%m%d%H%M)` (vercel CLI 덮어쓰기 사고 방지)
- [ ] **Vercel 환경변수 주입**(대시보드 또는 CLI — 값 노출 금지):
  - [ ] `RC_WEBHOOK_SECRET` = §2 웹훅 Authorization 값(≥16자, 미설정=웹훅 전거부 fail-closed)
  - [ ] `RC_REST_API_KEY` = RC REST 키(미설정=confirm 폴백 503 `rc-unconfigured`)
  - [ ] `DISCORD_WEBHOOK_URL`(결제·환불 알림) / `DISCORD_TICKET_WEBHOOK_URL`(문의 — 없으면 결제 채널 폴백) — 있으면
  - [ ] (이미 있어야) `SESSION_SECRET`·`ADMIN_TOKEN`·`DATABASE_URL`(prod)·`SENTRY_DSN`(선택)
- [ ] **`vercel --prod` 배포** — env 추가 후 **Redeploy 필수**(env는 재배포에 반영)
- [ ] **스모크**(읽기 전용, prod 원장 오염 금지):
  - [ ] `curl -s <prod>/api/devnotes` → `{"ok":true,...}`
  - [ ] 웹훅 경로 살아있음 확인 — 시크릿 없는 POST가 **401**(fail-closed)이어야. 실지급 테스트는 §5 샌드박스로(prod 원장에 테스트 지급 금지)

> `EXPO_PUBLIC_REVENUECAT_API_KEY`는 **서버 env 아님** — 클라 빌드타임 인라인이라 §4(앱 `.env` + EAS 재빌드).

---

## §4 클라 실물 연동 (EAS / 로컬 빌드)

> 절차 정본 = `.claude/skills/release-build/SKILL.md`. `react-native-purchases` = **네이티브 모듈 추가 → runtimeVersion 범프 + 재빌드**(OTA 불가).

- [ ] **`react-native-purchases` SDK 추가** (`npx expo install react-native-purchases`)
- [ ] **네이티브 변경이므로 runtimeVersion 범프** — app.json `runtimeVersion`("1.0.0" 고정 체제 → 수동 범프) + versionCode 증가. 범프 시 **재빌드+스토어 업로드가 OTA보다 선행**
- [ ] **`EXPO_PUBLIC_REVENUECAT_API_KEY`** = §2 RC 공개 SDK 키를 앱 `.env`에 → EXPO_PUBLIC_*은 **빌드타임 인라인**이라 **EAS/그래들 재빌드해야 반영**
- [ ] **스텁→실물 전환 지점 확인**(`lib/iap.ts`): 이미 배선 완료 — `rc()`가 `react-native-purchases`를 **지연 require**. Expo Go(미설치)·`__DEV__`·키 없음이면 **자동 스텁**(시뮬 알림), 실빌드+키 있으면 실물 결제. 코드 수정 불필요, **모듈 설치+키+빌드**만 하면 켜짐
  - dev 루프 보존: Expo Go에선 계속 스텁으로 동작(`initIap`·`purchase` 등 `__DEV__` early-return)
  - 로그인 직후 `identifyUser(userId)`(=`Purchases.logIn`)로 RC app_user_id를 우리 userId에 고정 — **이게 §13.18 "최대 함정"**(안 하면 웹훅 app_user_id가 유저에 안 붙어 지급 불가). 재시작 복원(`onRehydrateStorage`)·로그아웃(`logoutUser`)도 배선 완료
- [ ] **AAB 로컬 그래들 빌드**(release-build §B) — 키스토어(`credentials/`) 경로·비번 확인(분실=업데이트 영구 불가)
- [ ] **내부 테스트 트랙에 AAB 업로드** — 라이선스 테스터가 설치할 트랙. §5 실결제의 전제

---

## §5 테스트 매트릭스 (핵심 — 이 표 전부 통과 = 결제 켜짐)

> 확인 위치: **앱**(화면) / **서버DB**(`wallet_ledger`·`purchase_event`·`stats_daily`) / **관리자**(운영 콘솔 `/ops-9f3a2c`).
> 관리자 결제 감사 단계 로그는 UI 탭이 아니라 **API `GET /api/admin/payment-events`**(`source`·`fail=1`·`txn=<storeTxnId>` 파라미터, requireAdmin)로 본다 — 한 결제를 시간순 추적. 운영 콘솔 **⑤ BM·수익화 탭**은 원장 파생 롤업(매출·상품별 지급).

### A. 상설 가드 그린 유지 (코드/서버 변경 때마다 — 실결제 전에 항상)
| 가드 | 실행 | 검증 |
|---|---|---|
| `_dv_walletauth` | `npx tsx tools/_dv_walletauth.ts` | SKU 카탈로그 6팩 id·수량 정합 + 엔타이틀먼트 클라↔서버 + econ 미러. **콘솔 SKU도 이것과 1:1** |
| `_dv_refund` | `npx tsx tools/_dv_refund.ts` | 음수잔액 허용 = `refund`만(다른 reason 새면 무한소비) |
| `_dv_purchase` | `(cd server && node_modules/.bin/tsx tools/_dv_purchase.ts)` | 웹훅 인증 fail-closed·샌드박스/엔타이틀먼트/미등록 무시·grant/refund·멱등 dedup·afterSafe 오염차단 + **D1** confirm×SANDBOX 필터·**B1** 익명환불 `refund.anonymous.dropped` 관측·**A1** confirm선착→웹훅후착 KRW 보충 (DATABASE_URL 필요) |
| `_e2e_purchase_live` | `(cd server && node_modules/.bin/tsx tools/_e2e_purchase_live.ts)` | 실행 중 서버(:3000) 실 HTTP 왕복: 웹훅+1000·재전송 dedup·confirm 401/503·SANDBOX 무시·CANCELLATION −1000·이중환불 dedup·**⑧ 익명환불 dropped 감사행** |

- 라이브 2종 사전조건: **dev 서버 기동** + `.env.development.local`에 로컬 전용 `RC_WEBHOOK_SECRET`(≥16자) 넣고 **서버 재시작**.
- ⚠ 임시 Docker PG(55432) 체제면 라이브 가드에 `DATABASE_URL=...55432...` 오버라이드 필수(안 붙이면 스플릿브레인 허위 FAIL — README 서버 가드 배터리 주석).

### B. 샌드박스 실결제 (실기기 필수)
| # | 시나리오 | 수단 | 기대 | 확인 |
|---|---|---|---|---|
| B1 | 6팩 각 1회 구매 | 라이선스 테스터·실기기 | RC 웹훅 → 원장 +N → 앱 잔액 +N | 앱 잔액 / 서버DB `wallet_ledger`(reason=purchase, +N) / 관리자 ⑤ 상품별 지급 |
| B2 | 지급 경로 | — | 웹훅이 먼저면 confirm은 `deduped`, confirm이 먼저면 웹훅 `deduped` — **어느 쪽이든 최종 +N 1회** | `payment-events?txn=<txn>`에 `*.grant.applied` 정확히 1행 |
| B3 | remove_ads 구매 | 실기기 | 엔타이틀먼트 활성 → 전면광고 제거(보상형 버튼은 유지) | 앱 광고 사라짐 / RC customerInfo |

> ⚠ **에뮬레이터 Play 결제 제약**: 에뮬레이터는 Play 결제 흐름이 제한적 → **실기기**로. **샌드박스(SANDBOX) 결제는 서버가 무시**(테스터가 prod 원장에 유령 다이아 발행 방지)하므로, **원장 지급까지 검증하려면 내부 테스트 트랙(프로덕션 빌드 서명)** 로 라이선스 테스터 결제해야 environment가 지급 대상이 된다. "실결제인데 원장 0"이면 environment가 SANDBOX로 필터됐는지 `payment-events`에서 `webhook.sandbox.filtered` 확인.

### C. 멱등 / 환불 / 복원 / 소모 라이프사이클
| # | 시나리오 | 기대 | 확인 |
|---|---|---|---|
| C1 | **멱등**: RC 웹훅 재전송(같은 storeTxnId) | 이중지급 0 — 둘째 `applied:false` | `payment-events`에 `grant.deduped` 1행, 원장 +N 1회뿐 |
| C2 | **환불**: Play 콘솔 환불 → RC CANCELLATION/REFUND 웹훅 | 원장 −N 클로백. 잔액 **음수 허용은 refund만**(환불된 고래가 계속 못 씀) | 서버DB 원장(reason=refund, −N) / 관리자 ⑤ 환불 건수·회수 다이아 |
| C3 | **환불 이중차감 방지** | RC 자동환불 ↔ 관리자 수동환불이 storeTxnId 공유키로 둘째 dedupe | `refund:<userId>:<storeTxnId>` 키 1회만 반영 |
| C4 | **서포터/엔타이틀먼트 복원**: remove_ads 구매 후 재설치·기기 이전 → **구매 복원** | 엔타이틀먼트 재활성(광고 다시 제거) | 앱 "구매 복원" 버튼 → `restorePurchases` → RC customerInfo 복원 |
| C5 | **소모성 consume 라이프사이클(#43)**: 다이아 팩 재구매 가능 여부 | consume/acknowledge 완료돼 **재구매 됨**(미consume면 구글이 ~3일 뒤 자동환불 + 재구매 불가 재현). RC가 consume을 스토어측 흡수(§13.18 H1) | 같은 팩 2회 연속 구매 성공 / 원장 +N 2행 |

### D. 장애 내성 / 이상 경로
| # | 시나리오 | 기대 | 확인 |
|---|---|---|---|
| D1 | 결제 중 **네트워크 단절·앱 강제종료** | pending purchase 복구 — 재시작 후 RC가 미완료 거래 재개, confirm 폴백/웹훅으로 지급 수렴 | 앱 잔액 최종 +N / `syncWallet` 후 일치 |
| D2 | **웹훅 지연** | confirm 폴백이 메꿈("돈 내고 0개" 방지), 잔액 수렴 | `syncWallet()`로 서버 잔액 재동기 |
| D3 | **위조 웹훅**(시크릿 불일치/없음) | 401, 원장 무변 | `payment-events` `webhook.auth.rejected` |
| D4 | **RC 미설정**(confirm) | 503 `rc-unconfigured`(fail-closed) | confirm 응답 503 |
| D5 | **미등록 SKU** 웹훅 | 무시(지급 0) | `payment-events` `webhook.ignored`(reason=미등록) |

### E. 관리자 화면 확인란 (운영 콘솔 `/ops-9f3a2c`, ADMIN_TOKEN 로그인)
- [ ] **결제 단계 감사 로그** — `GET /api/admin/payment-events?txn=<storeTxnId>` 로 한 결제의 `received→type.decided→grant.applied` 단계 추적("돈 내고 0개" = 성공행 있는데 `grant.applied` 없음)
- [ ] **매출 롤업** — ⑤ **BM·수익화** 탭: 총 매출(₩)·결제 건수·결제 전환율·환불 건수(`stats_daily.revenueKrw`·`purchaseCount`·`diamondsPurchased`, applied 웹훅만 집계)
- [ ] **상품별 다이아 지급** — ⑤ 탭 하단 표(productId별 지급 건수·다이아 합·결제자, 원장 파생)
- [ ] **해당 유저 원장 조회** — ⑤ 탭 "결제·환불 내역"(kind 필터: 구매/환불, 유저·상품·다이아·잔액)
- [ ] **환불 반영** — ✉ **문의·환불** 탭: 환불 티켓 처리(관리자 다이아 회수, 멱등키 **티켓당 고정** → 금액 바꿔 재클릭해도 추가 차감 0)

### F. 컴플라이언스 스팟 (payment-security-compliance 스킬 참조)
- [ ] **가격 표시 = 콘솔 등록가** — 앱 상점 표시가가 스토어 청구가와 일치(₩ 오차 0)
- [ ] **미성년자 결제 게이트** — 기존 고지·플로우 확인(국내 앱 결제 요건, PRE_LAUNCH §3)
- [ ] **환불 정책 화면(운영정책) 노출** — "환불 신청 = 접수(티켓)일 뿐, 실제 환불은 스토어 정책 경유. **이미 쓴 전지훈련 효과는 취소 안 됨**(재화만 회수)"(§13.17). 앱에 카피 노출
- [ ] **사업자·통신판매업 정보 노출** — 앱 내 사업자 정보 화면에 상호·통신판매업 신고번호 표시(§0)

---

## §6 완료 판정(DoD) · 롤백

### DoD — #43 완료 조건
- [ ] §5 A 상설 가드 4종 전부 그린
- [ ] §5 B 6팩 실결제 → 원장 +N → 앱 잔액 반영(B1) + 지급 정확히 1회(B2)
- [ ] §5 C1 멱등(이중지급 0)·C2 환불 클로백·C4 복원·C5 재구매 통과
- [ ] §5 D3~D5 이상경로 fail-closed 확인
- [ ] **관리자에서 매출 1건 조회**(⑤ 탭 총 매출 ≥ 1건, `stats_daily.revenueKrw` 반영) = 머니패스 end-to-end 증명. **A1(2026-07-16) 이후**: confirm이 먼저 지급해도 뒤늦은 웹훅이 KRW를 `recordRevenueKrwOnce`로 보충하므로 매출 KRW가 영구 ₩0으로 남지 않음(경로 순서 무관 매출 집계). KRW는 웹훅이 `currency:KRW`로 실어와야 잡힘(비-KRW·미제공은 여전히 null → RC 대시보드가 재무 진실)
- [ ] §5 F 컴플라이언스 스팟 통과

### 롤백 / 문제 대응
- [ ] **상품 비활성화** — 지급/가격 사고 시 Play Console에서 해당 상품 **비활성화**(초안 전환) + RC 오퍼링에서 제외 → 신규 구매 차단. 이미 지급된 원장은 불변(감사 보존)
- [ ] **웹훅 실패 관측** — 디스코드 결제 채널(`DISCORD_WEBHOOK_URL`) 알림 + `payment-events?fail=1` + Sentry(`SENTRY_DSN`)로 실패 사유 확인. "돈 내고 0개"는 `payment-events`에서 성공행+`grant.applied` 부재로 특정
- [ ] **익명 환불 유실 대응(B1, 2026-07-16)** — 디스코드 "⚠️ 익명 환불 유실" 알림 또는 `payment-events?fail=1`에 `refund.anonymous.dropped`(stage)가 뜨면: 그 `storeTxnId`로 `payment-events?txn=<storeTxnId>`를 조회해 원구매(confirm 지급)의 유저를 찾고, **관리자 수동 환불(§13.17, ✉ 문의·환불 탭)로 다이아 회수**. 익명(비-UUID app_user_id) 환불 웹훅은 유저 귀속 불가라 자동 클로백이 안 되므로 이 이벤트가 곧 수동 처리 신호(RC 미구성/`logIn` 누락 시 발생 — 정상 배선이면 창이 좁음)
- [ ] **RC 웹훅 재전송** — RC 대시보드에서 실패 이벤트 수동 재전송(멱등이라 안전)
- [ ] **긴급 시크릿 회전** — `RC_WEBHOOK_SECRET` 유출 의심 시 RC·Vercel 양쪽 동시 교체 후 Redeploy

---

## 부록 — 실측·검증 기록
- 카탈로그 정합(6팩 `dia_100`~`dia_10000` · 엔타이틀먼트 `remove_ads`/`dlc_worldcup` · RC 엔타이틀먼트 id `worldcup`): `_dv_walletauth` PASS (2026-07-16).
- 환불 음수 게이트(refund만 허용): `_dv_refund` PASS (2026-07-16).
- 서버 머니패스(웹훅·confirm·멱등·환불): `_dv_purchase`·`_e2e_purchase_live`(dev 서버 라이브, §13.18 #43) — 상설 서버 가드 배터리.
- 실결제 단계 로깅은 RC 콘솔·EAS 실기기 결제 시 라이브 확인(구조상 서버 밖, §13.22 "미검증").
