# 결제 상품 런칭 런북 (#43)

> **진행 기록 (2026-07-17 새벽, 사용자+Fable 5 공동 실행)**
> - ✅ §1 완료 — 일회성 제품 7종 등록·활성(dia_100~dia_10000 소비성, remove_ads 비소비성), 결제 SDK 포함 AAB(versionCode 13) 내부 테스트 게시
> - ✅ §2 완료 — RC 서비스계정 연결(credentials 2/3 초록, 구독검증 1건은 재무권한 전파 대기 — 구독 미판매라 무영향), 상품 7종 임포트(Consumable/Non-consumable 지정), 엔타이틀먼트 remove_ads, default offering 패키지 7개, 웹훅 등록(Both env·All events)
> - ✅ §3 완료 — prod 스키마 push(devnotes·save_backups 신설, DROP 0 확인), RC_WEBHOOK_SECRET·RC_REST_API_KEY 교체 주입(11일 전 구값 대체), redeploy, 스모크 3종(devnotes ok / 무인증 401 / 정시크릿 TEST 200 ignored = **RC↔Vercel 시크릿 일치 실증**)
> - ✅ §4 일부 — react-native-purchases 10.4.3 설치·runtimeVersion 1.1.0·EXPO_PUBLIC_REVENUECAT_API_KEY .env 반영(미추적 로컬)
> - ✅ §4 재빌드 완료(2026-07-17 낮) — **키 포함 AAB versionCode 14** 빌드(gradlew bundleRelease 2m32s). 검증: AAB 매니페스트 versionCode="14" bundletool 대조 + RC 공개키 번들 내 1회 검출(실증). 산출물 `android/app/build/outputs/bundle/release/app-release.aab`(121.7MB). 커밋 223e44d
> - ✅ §5-B 1차(2026-07-17, `RC_SANDBOX_GRANT=all`) — `dia_100`·`dia_500` 라이선스 테스터 실결제 지급 성공(원장 +1000·+4800, `ref :sandbox` 마커·매출 KRW 0 집계 격리 확인). **레이스 발견→수정**: RC 웹훅↔confirm 폴백이 ~100ms 내 동시 도착해 진 쪽 트랜잭션이 유니크 충돌로 `grant.error`(ok=false)·confirm 500 — 매건 발생. `applyWallet` catch를 error 대신 **재조회 dedup 수렴**으로 교정(§13.18·§4, 가드 `walletConcurrency H2b/H2c`). 돈은 처음부터 정확(이중지급 0)했고 UX/재시도만 문제였음
> - ⏳ 남은 것: **vc14 AAB 내부 테스트 업로드(사용자)** → §5-B 잔여 6팩 실결제 매트릭스 · §0 라이선스 테스터 등록 확인 · RC credentials 초록 전환 확인
> - ⚠ 발견(2026-07-17): **vc13·14 OTA 채널 헤더 누락** — 로컬 그래들 AAB의 AndroidManifest에 expo-updates 채널 메타데이터가 없어(app.json `updates.requestHeaders` 미설정 → prebuild 산출물 누락) 기기가 `eas update --channel production` 게시분을 못 받음("게시 성공≠전달", 실기기 문구 불변으로 발각). 수정: app.json `requestHeaders["expo-channel-name"]="production"` + 매니페스트 `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY` 메타데이터 → **vc15 재빌드(채널 헤더 포함) 재업로드 필요**. 정합은 `_dv_appconfig` ⓕⓖ가 상시 대조(TEST_METHODOLOGY §4 publish-verified-not-delivery)
> - ⚠ 발견: GitHub push가 Vercel **자동 배포**됨(커밋=배포 인지) · `vercel link`가 .env.local 덮어씀(백업으로 복원 — 함정 재확인)
> - ✅ §5-B~C 실측 완주(2026-07-17 저녁) — 6팩 지급·가격 6종 정합(dia_500 콘솔 오등록 4,800 정정)·멱등 dedup(레이스 수정 후 error 0)·**C2 환불 클로백 실증**(RTDN 연결 후 분 단위: Play 환불(권한삭제)→RC CANCELLATION→원장 −2,500(:sandbox)→디스코드 알림→앱 잔액 반영). RTDN 셋업 = Pub/Sub API enable + SA에 게시/구독 관리자 + RC Connect + Play 수익창출설정 주제 등록(알림 콘텐츠="모든 일회성 제품")
> - ✅ 2026-07-17 밤 추가 — OTA 전달 실증(vc15 채널 헤더·2h 쿨다운 작동)·remove_ads 환불→소유회수→재구매 생애주기·엔타이틀먼트 attach 실사고·캐시 무효화·vc16 AAB(오늘 전체 내장) 준비·**#107 정책 페이지 /privacy·/terms prod 게시**·행정 3종 종결(#109)
> - 잔여(내일): vc16 업로드 → 스토어 등록정보(개인정보 URL=배포 도메인/privacy)+IARC(#108) → C4 구매복원·관리자 매출 ₩0 확인 → #43 completed → 심사 제출(직전 RC_SANDBOX_GRANT 결정) · (관찰) RTDN 이전 dia_5000 환불 지연 도착
> - ✅ 2026-07-18 — **관찰 완료**: RTDN 이전 `dia_5000` 환불 지연 회수 도착(밤 03:00 KST경, 원장 −5000·`ref :sandbox` 정상 클로백). **버그 발견·수정(샌드박스 집계 제외 다중 라이터 사각)**: prod `stats_daily` 7/17 행이 `KRW=0·count=6·dia=19100`으로 관측 — D1 샌드박스 제외가 지급 경로(웹훅·confirm)에만 걸려 있고 **매일 크론 롤업**(`/api/cron/purge`→`lib/retention.ts rollupRecent`)이 `:sandbox` 무관하게 재집계해 덮어썼음(형제로 관리자 BM·전환율 2경로도 미제외). 수정 = **집계 3경로 대칭 제외**(retention.ts pRows + admin/bm + admin/stats, `ref NOT LIKE '%:sandbox'` NULL-안전). 원장 열람 뷰(`admin/payments`)는 전 행 노출 유지(제외 안 함). 가드 `_dv_purchase` **S1-e** 신설(크론 롤업 실 건만 집계 + 구/신 쿼리 A/B count 2↔1) — 정본 BACKEND §13.18 D1(2026-07-18 정정)·사각 분류 TEST_METHODOLOGY §4(다중 라이터 사각).
>   - ✅ **7/17 stats_daily 행 일회성 수동 UPDATE 완료(2026-07-18, 메인 세션 prod 직접 수행)**: 크론은 지난 데이터를 못 고칠 수 있음(그날 실구매 0이면 `pRows` 2일 윈도우에 그 날짜가 안 잡혀 upsert 스킵) → 오염된 7/17 행을 `update stats_daily set purchase_count=0, diamonds_purchased=0 where day='2026-07-17'`로 정정(7/17 실결제 전부 샌드박스 — purchase_event environment 실측). 결과 실측 `KRW=0·count=0·dia=0`.
> - ✅ **2026-07-18 — 리젝 리서치 + 컴플라이언스 감사(제출 전) 수행**. 발견:
>   - 개인 개발자 계정은 **폐쇄형 테스트 12명×14일 연속** 참여 요건 대상일 수 있음(제출 전 테스터 모집·기간 확인 필요 — 별도 확인).
>   - `server/app/delete-account/page.tsx` 문의 이메일이 placeholder(`[문의 이메일 기재]`)로 남아 있어 **구글 데이터 보안 양식 계정삭제 URL 제출 차단** — 수정.
>   - 앱 내 정본 `data/legalText.ts` PRIVACY 11조 보호책임자·연락처가 placeholder — 수정.
>   - **로그인 전 정책(약관·개인정보처리방침) 고지·링크 부재**(스토어 심사 요건) — LoginScreen에 고지문+웹 게시본 링크 추가.
>   - **앱 내 상호(사업자 정보) 미명기** — 약관(legalText TERMS)에 판매자 정보 조항(제22조) 추가, 웹 terms §5와 6항목 동일.
>   - → 위 컴플라이언스 수정 7건 반영(delete-account 이메일 · legalText 보호책임자/상호/운영자명/시행일통일/표시광고보존 · LoginScreen 정책링크 · buy-diamonds 청약철회 안내). 낡은 로그인 route dev 백도어 TODO 주석 정리.
>   - 📝 **데이터 보안 양식**: AdMob 자동수집 항목(**대략적 위치·앱 상호작용·진단 정보**) 신고 필요 — 제출 시 반영.
>   - 📝 **전면광고 "시즌 시작" 타이밍 = Google Better Ads 경계 사례**(콘텐츠 시작 시점 인터스티셜) — 유지/이동 여부 **사용자 결정 대기**.

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
- [x] **게임제작업 등록(게임산업법 §25)** 완료 (2026-07-17 사용자 확인 — #109 종결. 행정 3종 전부 완료, 출시 게이트에서 행정은 더 신경 쓸 것 없음)
- [ ] **Play Console 개발자 계정** 활성(등록비 결제·계정 승인 완료) — 콘솔에서 확인
- [ ] **결제 프로필 / 판매자 계정(Google Payments merchant)** 생성·승인 — 인앱 상품 판매의 전제. 콘솔 "결제 프로필"에서 확인
- [ ] **세금 정보 / 수수료 프로필** 기입 — 콘솔에서 확인
- [x] **판매자 정보에 통신판매업 신고번호 기입** (전자상거래법 표시의무) — ✅ 2026-07-18 콘솔 계정 세부정보 "한국 개발자 추가 정보"에 사업자등록번호·통신판매업 라이선스(제2026-울산중구-0170호)·대행사(울산광역시 중구청) 기입·저장. 개발자명도 Vivace Games로 변경. 앱 내 사업자 정보 = 약관 제22조(legalText)·웹 /terms §5
- [x] **개인정보 처리방침 URL** 게시(결제 5년·분쟁 3년 보존·진단 스냅샷 첨부 고지) — ✅ 2026-07-17~18 `/privacy`·`/terms`·`/delete-account` prod 라이브(상호·판매자 정보·이메일 기입 완료). PRE_LAUNCH §3
- [ ] **Android Developer Verification 등록 확인** — Play Console "Android Developer Verification" 페이지에서 앱 등록 상태 확인(2026-07 정책 메일: 99%는 자동 등록, 미등록이면 글로벌 제거 대상). 콘솔에서 1분 확인
- [ ] **등급분류(IARC) 미완이면 상품 테스트 불가 인지** — 같은 메일에서 "unrated 앱 불허" 재확인(#108). 콘솔 설문을 P2W·리워드광고 사실대로
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
- [x] **엔타이틀먼트 매핑** — RC 엔타이틀먼트 `remove_ads`에 상품 `remove_ads` 연결. (월드컵은 출시 보류 — RC 엔타이틀먼트 `worldcup`은 기능 노출 시)
  - ⚠ **연결(attach)까지 실측 확인(2026-07-17 실사고)**: 엔타이틀먼트·상품이 각각 존재해도 **Associated products 연결이 비어 있으면** 결제는 기록되고 엔타이틀먼트만 조용히 빈다(광고 제거 구매했는데 광고 나옴). 확인법 = 구매 후 RC REST `GET /v1/subscribers/<userId>`의 `entitlements`가 비어 있지 않아야 한다. 연결은 기존 구매에 **소급 적용**됨(재구매 불요). `dlc_worldcup` 출시 때 엔타이틀먼트 `worldcup` ↔ 상품 `dlc_worldcup` 연결을 같은 방법으로 검증할 것
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
| `_dv_purchase` | `(cd server && node_modules/.bin/tsx tools/_dv_purchase.ts)` | 웹훅 인증 fail-closed·샌드박스/엔타이틀먼트/미등록 무시·grant/refund·멱등 dedup·afterSafe 오염차단 + **D1** confirm×SANDBOX 필터·**B1** 익명환불 `refund.anonymous.dropped` 관측·**A1** confirm선착→웹훅후착 KRW 보충·**S1** `RC_SANDBOX_GRANT` 스위치(on=SANDBOX 지급+ref `:sandbox`·매출 무증가·환불 클로백·off 재필터) (DATABASE_URL 필요) |
| `_e2e_purchase_live` | `(cd server && node_modules/.bin/tsx tools/_e2e_purchase_live.ts)` | 실행 중 서버(:3000) 실 HTTP 왕복: 웹훅+1000·재전송 dedup·confirm 401/503·SANDBOX 무시·CANCELLATION −1000·이중환불 dedup·**⑧ 익명환불 dropped 감사행** |

- 라이브 2종 사전조건: **dev 서버 기동** + `.env.development.local`에 로컬 전용 `RC_WEBHOOK_SECRET`(≥16자) 넣고 **서버 재시작**.
- ⚠ 임시 Docker PG(55432) 체제면 라이브 가드에 `DATABASE_URL=...55432...` 오버라이드 필수(안 붙이면 스플릿브레인 허위 FAIL — README 서버 가드 배터리 주석).

### B. 샌드박스 실결제 (실기기 필수)
| # | 시나리오 | 수단 | 기대 | 확인 |
|---|---|---|---|---|
| B1 | 6팩 각 1회 구매 | 라이선스 테스터·실기기 | RC 웹훅 → 원장 +N → 앱 잔액 +N | 앱 잔액 / 서버DB `wallet_ledger`(reason=purchase, +N) / 관리자 ⑤ 상품별 지급 |
| B2 | 지급 경로 | — | 웹훅이 먼저면 confirm은 `deduped`, confirm이 먼저면 웹훅 `deduped` — **어느 쪽이든 최종 +N 1회** | `payment-events?txn=<txn>`에 `*.grant.applied` 정확히 1행 |
| B3 | remove_ads 구매 | 실기기 | 엔타이틀먼트 활성 → 전면광고 제거(보상형 버튼은 유지) | 앱 광고 사라짐 / RC customerInfo |

> ⚠ **에뮬레이터 Play 결제 제약**: 에뮬레이터는 Play 결제 흐름이 제한적 → **실기기**로.
>
> ⚠ **샌드박스 지급 스위치 `RC_SANDBOX_GRANT`(정정 2026-07-17 — 실측, §13.18 D1)**: ~~내부 테스트 트랙(프로덕션 빌드 서명)로 라이선스 테스터 결제해야 environment가 지급 대상(PRODUCTION)이 된다~~ 는 가정은 **틀림**. **실측**: 라이선스 테스터가 **내부 테스트 트랙에서 실제 결제해도 RevenueCat이 `environment=SANDBOX`로 웹훅을 보냄** → 기존 SANDBOX 필터가 지급을 막아 **GPA 거래 2건이 `webhook.sandbox.filtered`로 지급 0** 됐음. 테스터 전원이 결제 테스트를 하려면 **샌드박스 지급 모드**를 켠다:
> - **켜기**: Vercel(server) 환경변수 **`RC_SANDBOX_GRANT=all`** 주입 → **재배포**(env는 요청 시점 read라 재배포 즉시 반영). 이후 SANDBOX 웹훅/confirm이 정상 지급(환불 클로백도 검증됨).
> - **격리**: 이 모드 지급은 `stats_daily` 매출(KRW)·건수·다이아 집계에 **잡히지 않고**(실매출 아님), 원장(`wallet_ledger`)엔 `ref=<productId>:sandbox` 마커로 남아 감사 구분됨(잔액·멱등은 정상). 보안 근거: 샌드박스 결제는 **Play 콘솔 라이선스 테스터 목록(오너 통제)** 계정만 발생.
> - **끄기(출시 전)**: Vercel에서 `RC_SANDBOX_GRANT`를 제거(또는 `all` 이외 값) → 재배포하면 SANDBOX 필터 복귀(fail-closed). **출시 DoD에서 off 여부를 결정**(§6).
> - "실결제인데 원장 0"이면 environment가 SANDBOX로 필터됐는지 `payment-events`에서 `webhook.sandbox.filtered`(off 상태) 또는 `webhook.grant.applied`(on 상태) 확인.

### C. 멱등 / 환불 / 복원 / 소모 라이프사이클
| # | 시나리오 | 기대 | 확인 |
|---|---|---|---|
| C1 | **멱등**: RC 웹훅 재전송(같은 storeTxnId) | 이중지급 0 — 둘째 `applied:false` | `payment-events`에 `grant.deduped` 1행, 원장 +N 1회뿐 |
| C2 | **환불**: Play 콘솔 환불 → RC CANCELLATION/REFUND 웹훅 | 원장 −N 클로백. 잔액 **음수 허용은 refund만**(환불된 고래가 계속 못 씀) | 서버DB 원장(reason=refund, −N) / 관리자 ⑤ 환불 건수·회수 다이아 |
| C2⚠ | **운영 규칙(2026-07-17 실측)**: 콘솔 환불은 반드시 **"권한 삭제" 체크와 함께** — 환불 버튼→팝업 안 체크박스. 체크 없이 환불하면 구글이 구매를 무효화(void)하지 않아 RC 웹훅이 **영영 안 오고** 유저는 돈 돌려받고 다이아도 유지(dia_1000 실사고 — 신호 부재 확인). 전파는 체크해도 수분~수시간 | RC subscriber에서 해당 구매 소멸 → CANCELLATION 웹훅 → 원장 −N |
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
- [ ] **결제 단계 감사 로그** — ⑤ **BM·수익화** 탭 "결제 이벤트" 표(최근 N건, `source`[client/webhook/confirm/admin]·`fail` 필터) 또는 `GET /api/admin/payment-events?txn=<storeTxnId>` 로 한 결제의 `received→type.decided→grant.applied` 단계 추적("돈 내고 0개" = 성공행 있는데 `grant.applied` 없음). **2026-07-16(P2-d)**: 이 퍼널이 이제 콘솔 표로도 보임(API 전용이었음)
- [ ] **매출 롤업** — ⑤ **BM·수익화** 탭: 총 매출(₩)·결제 건수·결제 전환율·환불 건수(`stats_daily.revenueKrw`·`purchaseCount`·`diamondsPurchased`, applied 웹훅만 집계)
- [ ] **상품별 다이아 지급** — ⑤ 탭 하단 표(productId별 지급 건수·다이아 합·결제자, 원장 파생)
- [ ] **유저 원장 조회(전 reason·기간)** — ⑤ 탭 "유저 원장 조회"(userId + reason 필터[구매/환불/전지훈련(camp)/조정(adjust)/광고/업적/쿠폰/환영]·`since` 기간·**합계 표시**). **2026-07-16(P2-c)**: 이전 "결제·환불 내역"은 purchase/refund만이라 §13.26 백업 보상(camp 차감 합)을 콘솔로 못 냈음 → 전 reason 필터로 완결
- [ ] **환불 반영(티켓)** — ✉ **문의·환불** 탭: 환불 티켓 처리(관리자 다이아 회수, 멱등키 **티켓당 고정** → 금액 바꿔 재클릭해도 추가 차감 0)
- [ ] **수동 지갑 조정(티켓 없는 케이스)** — ⑤ 탭 "수동 지갑 조정" 폼: userId·금액(**음수=회수/양수=지급**)·사유 메모 → 회수는 `admin/refund`, 지급은 `admin/grant`(멱등키 폼당 1회 생성). **2026-07-16(P2-b)**: 디스코드 `refund.anonymous.dropped` 등 **티켓 없는** dropped 알림을 콘솔로 처리(curl 의존 제거). 실행 후 잔액 표시 + 멱등 재클릭 경고

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
- [ ] **관리자에서 매출 1건 조회**(⑤ 탭 총 매출 ≥ 1건, `stats_daily.revenueKrw` 반영) = 머니패스 end-to-end 증명. **A1(2026-07-16) 이후**: confirm이 먼저 지급해도 뒤늦은 웹훅이 KRW를 `recordRevenueKrwOnce`로 보충하므로 매출 KRW가 영구 ₩0으로 남지 않음(경로 순서 무관 매출 집계). KRW는 웹훅이 `currency:KRW`로 실어와야 잡힘(비-KRW·미제공은 여전히 null → RC 대시보드가 재무 진실). **주의(2026-07-17)**: 샌드박스 지급 모드(`RC_SANDBOX_GRANT=all`)로 넣은 테스트 결제는 매출에 **안 잡힘**(집계 제외·`ref :sandbox`) → 이 DoD의 "매출 1건"은 **프로덕션 트랙 실결제(또는 스위치 off)** 로 증명해야 함
- [ ] **출시 전 `RC_SANDBOX_GRANT` 처리 결정(2026-07-17)** — 샌드박스 실결제 테스트를 위해 켰던 `RC_SANDBOX_GRANT=all`을 **출시 전 off 처리(권장 — Vercel env 제거 후 재배포, 필터 복귀)** 하거나, 유지할 경우 **유지 사유를 기록**(§13.18 D1 — 라이선스 테스터 목록 오너 통제라 유지해도 임의 유저 발행 불가, 단 샌드박스 지급은 매출 미집계). 스위치 상태를 `payment-events`로 확인(SANDBOX 결제가 `grant.applied`면 on·`sandbox.filtered`면 off)
- [ ] §5 F 컴플라이언스 스팟 통과

### 롤백 / 문제 대응
- [ ] **상품 비활성화** — 지급/가격 사고 시 Play Console에서 해당 상품 **비활성화**(초안 전환) + RC 오퍼링에서 제외 → 신규 구매 차단. 이미 지급된 원장은 불변(감사 보존)
- [ ] **웹훅 실패 관측** — 디스코드 결제 채널(`DISCORD_WEBHOOK_URL`) 알림 + `payment-events?fail=1` + Sentry(`SENTRY_DSN`)로 실패 사유 확인. "돈 내고 0개"는 `payment-events`에서 성공행+`grant.applied` 부재로 특정
- [ ] **익명 환불 유실 대응(B1, 2026-07-16)** — 디스코드 "⚠️ 익명 환불 유실" 알림 또는 ⑤ 탭 결제 이벤트 표(`fail` 필터)/`payment-events?fail=1`에 `refund.anonymous.dropped`(stage)가 뜨면: 그 `storeTxnId`로 `payment-events?txn=<storeTxnId>`(또는 콘솔 표 검색)를 조회해 원구매(confirm 지급)의 유저를 찾고, **⑤ 탭 "수동 지갑 조정" 폼에 그 userId·음수 금액·사유로 회수**(P2-b — 티켓 없는 dropped라 문의·환불 탭 대신 이 폼이 정규 경로). 익명(비-UUID app_user_id) 환불 웹훅은 유저 귀속 불가라 자동 클로백이 안 되므로 이 이벤트가 곧 수동 처리 신호(RC 미구성/`logIn` 누락 시 발생 — 정상 배선이면 창이 좁음)
- [ ] **RC 웹훅 재전송** — RC 대시보드에서 실패 이벤트 수동 재전송(멱등이라 안전)
- [ ] **긴급 시크릿 회전** — `RC_WEBHOOK_SECRET` 유출 의심 시 RC·Vercel 양쪽 동시 교체 후 Redeploy

---

## 부록 — 실측·검증 기록
- 카탈로그 정합(6팩 `dia_100`~`dia_10000` · 엔타이틀먼트 `remove_ads`/`dlc_worldcup` · RC 엔타이틀먼트 id `worldcup`): `_dv_walletauth` PASS (2026-07-16).
- 환불 음수 게이트(refund만 허용): `_dv_refund` PASS (2026-07-16).
- 서버 머니패스(웹훅·confirm·멱등·환불): `_dv_purchase`·`_e2e_purchase_live`(dev 서버 라이브, §13.18 #43) — 상설 서버 가드 배터리.
- 실결제 단계 로깅은 RC 콘솔·EAS 실기기 결제 시 라이브 확인(구조상 서버 밖, §13.22 "미검증").
