# 결제(IAP) 셋업 런북 — #43 실행용 (배구명가 실값)

> 목적: 실제 인앱결제 켜기. **서버 코드는 완성**(가드 `_dv_purchase` money-path green) — 남은 건 **콘솔 셋업 + prod env + 샌드박스 테스트**(대부분 사용자 콘솔 액션).
> 정본 절차·트랩: `.claude/skills/store-iap-setup`. 이 문서는 그 위에 배구명가 실값을 얹은 것. 작성 2026-07-31.

## ⚠ 순서 주의 — 조직 전환 먼저
결제 merchant/payments 프로필은 **조직 전환(`docs/PLAY_ORG_CONVERSION.md`)과 맞물린다.** 개인계정에 merchant 세팅했다가 조직 전환하면 재작업 위험 → **조직 전환(D-U-N-S 반영 24~48h 뒤) 완료 후 이 런북 실행** 권장. GCP 서비스계정·RevenueCat 프로젝트·env 준비는 계정유형 무관하게 미리 가능.

## 0. 사전(한국) — 전부 완료됨 ✅
- 사업자등록 749-25-02260 · 통신판매업 제2026-울산중구-0170호 · IARC 등급분류 · 개인정보처리방침 URL (#106~110).

## 배구명가 실값 (콘솔 등록 시 이 값 그대로)
| 항목 | 값 |
|---|---|
| **패키지명** | `com.son0925.volleyball` |
| **웹훅 URL** | `https://volleyball-jet-nine.vercel.app/api/purchase/webhook/revenuecat` |
| **소모성 다이아팩 SKU · 가격**(스토어 등록값=정본, 설계 `data/diamondTiers.ts`와 일치) | `dia_100`=₩1,000 · `dia_500`=₩4,800 · `dia_1000`=₩9,300 · `dia_2500`=₩22,500 · `dia_5000`=₩43,500 · `dia_10000`=₩84,000 |
| **비소모 엔타이틀먼트 SKU** | `remove_ads`(광고제거) · `dlc_worldcup` |
| **패스 SKU**(소모성) | `diamond_pass` |
| **구매 옵션 ID**(신콘솔 일회성제품) | 전 상품 통일 `buy` |
| **prod env**(Vercel) | `RC_WEBHOOK_SECRET`(≥16, dev≠prod) · `RC_REST_API_KEY`(sk_…, 서버전용) · `RC_SANDBOX_GRANT`(테스트=`all`, 출시 전 off) |
| **app build env** | `EXPO_PUBLIC_REVENUECAT_API_KEY`(goog_… public SDK, 빌드 인라인) |

> productId는 `server/lib/products.ts DIAMOND_PRODUCTS`와 **글자 단위 일치**(오타=지급0 fail-closed). 가격은 `data/diamondTiers.ts` 표와 눈대조(설계 ₩4,800을 ₩5,000으로 등록하는 류 사고 방지).

## 1. Play Console (사용자 · 조직 전환 후)
1. [ ] **결제(merchant) 프로필 + 세무정보 승인** 확인(생성만 아님).
2. [ ] **billing 라이브러리 든 AAB를 내부테스트 트랙 업로드** → 그래야 "일회성 제품" 메뉴 열림.
3. [ ] 소모성 6종 + 엔타이틀먼트 2종 + 패스 1종 등록. **소모성/비소모 플래그 정확히**(다이아팩·패스=소모성, remove_ads·dlc=비소모). 가격 = 위 표.
4. [ ] **라이선스 테스터**(디바이스 Play 로그인과 같은 Gmail) 추가.
5. [ ] **환불 시 "권한 삭제(revoke)" 체크 필수** — 안 하면 환불 웹훅 영영 안 옴.
6. [ ] **RTDN Pub/Sub 토픽 등록**(없으면 환불 감지 시간단위 지연).

## 2. Google Cloud (사용자)
- [ ] 서비스계정 생성 → **Play Android Developer API 활성화** → Play Console Users&permissions에 초대(앱정보·재무·주문관리 3권한). 재무권한 전파 느림(노랑=대기).
- [ ] **JSON 키는 RevenueCat에만**(우리 서버엔 저장 금지 — 권한분리).

## 3. RevenueCat (사용자)
- [ ] 프로젝트+앱(`com.son0925.volleyball`) 연결, 자격증명 green.
- [ ] 상품 import(SKU 동일) + 소모/비소모 태그.
- [ ] **엔타이틀먼트에 상품 ATTACH**(생성만으론 빈 채로 — "광고제거 샀는데 광고 나옴"). REST `GET /v1/subscribers/<userId>`로 확인.
- [ ] 전 상품을 **현재 offering의 package로** 등록(안 하면 "product not found").
- [ ] **웹훅**: URL(위) + Authorization 시크릿(≥16, dev≠prod) → TEST 이벤트 200 확인.
- [ ] Google RTDN 섹션에 §1⑥ Pub/Sub 토픽 연결.
- [ ] **RC Virtual Currency 사용 안 함**(다이아 진실=우리 원장).

## 4. Vercel env (사용자 · 재배포 필요)
- [ ] `.env.local` 백업 후 `RC_WEBHOOK_SECRET`·`RC_REST_API_KEY` 주입 → **git push=자동배포**([[vercel-push-to-deploy]]) 또는 env는 Vercel 대시보드에 넣고 재배포.
- [ ] 스모크: **미인증 웹훅 POST → 401**(fail-closed). prod 원장에 실결제 테스트 금지.

## 5. App build (사용자)
- [ ] `react-native-purchases` 네이티브 SDK 이미 설치됨 → **runtimeVersion 범프 + 재빌드**(OTA로 네이티브 못 나감). `EXPO_PUBLIC_REVENUECAT_API_KEY`(goog_…) 빌드 인라인.
- [ ] OTA 채널 헤더 매니페스트 박기(로컬 그래들 ≠ eas 채널) — **실기기 마커로 전달 확인**(publish exit0 ≠ 전달).
- [ ] 업로드 키스토어 백업(분실=업데이트 영구 불가).

## 6. 샌드박스 테스트 (실기기 · 코드는 이미 대응)
- [ ] `RC_SANDBOX_GRANT=all` on → 각 팩 구매 → 원장 +N → 앱 잔액 +N(**매출 집계 제외**, `ref=<SKU>:sandbox`).
- [ ] 멱등: 웹훅 재전송 → 단일 지급(dedup, 500 아님).
- [ ] 환불 → clawback −N(잔액 음수 허용, refund 사유만) · 엔타이틀먼트 복원.
- [ ] 위조/미인증 웹훅 → 401 · 미등록 SKU → 무시.
- [ ] **출시 전 `RC_SANDBOX_GRANT` off**(또는 유지 사유 기록).
- [ ] 프로덕션 트랙 실결제 1건 end-to-end로 실매출 원장행 확인.

## 현재 상태 (2026-07-31)
- ✅ **서버 코드 완성**: 상품 카탈로그·웹훅+confirm폴백·샌드박스스위치(기본off)·멱등dedup·환불clawback(음수허용)·익명환불추적. 가드 `_dv_purchase` money-path green(순수 A/B). DB통합 테스트는 로컬 Postgres 필요(환경).
- ⏳ **남은 것**: 위 1~6 콘솔/env/빌드/테스트 (전부 사용자 콘솔 액션 + 실기기).
- 선행: 조직 전환.
