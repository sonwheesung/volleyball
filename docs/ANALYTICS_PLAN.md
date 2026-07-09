# 운영/분석 스택 (ANALYTICS_PLAN)

> 1인 개발·최소 비용·빠른 장애 대응·광고 효율·장기 운영을 위한 계측 계획.
> **결정 확정 2026-07-03**(Claude+GPT 합의, v2). 구현은 대부분 **EAS 단계**(네이티브 SDK — Expo Go 불가).
> 실제 구조 정합: Frontend=React Native · Backend=Next.js(Vercel Serverless) · DB=Supabase Postgres · BM=RevenueCat · 광고=AdMob/Google Ads.
> 정본 연계: 결제=[BACKEND_SYSTEM](./BACKEND_SYSTEM.md) §13.18 · 출시 체크리스트=[PRE_LAUNCH_CHECKLIST](./PRE_LAUNCH_CHECKLIST.md).

---

## 1. 스택 (Tier별)

### ⭐ Tier S — 무조건 (출시 전)
| 도구 | 역할 | 비용 | 구현 시점 |
|---|---|---|---|
| **Firebase Analytics(GA4)** | 사용자 행동(DAU/WAU/MAU·리텐션·플레이시간·광고유입·이벤트) + Google Ads 연동 + BigQuery Export | 무료(이벤트 무제한) | EAS |
| **Firebase Crashlytics** | **앱(클라) 크래시** — Stack Trace·OS·기기·앱버전. ※API 오류는 못 봄(서버는 아래) | 무료 | EAS |
| **RevenueCat** | 인앱결제·BM(구매·환불·LTV·ARPU·ARPPU·전환율) | MTR $2.5k/월 무료 | EAS (§13.18 이미 채택) |
| **GameAnalytics** | 게임 KPI(시즌·경기·우승·드래프트·특별훈련·광고·리소스 흐름) — 시즌 중심 게임에 최적 | 무료 | EAS |

### ⭐ Tier A
| 도구 | 역할 | 비용 | 구현 시점 |
|---|---|---|---|
| **BigQuery** | 모든 데이터 심층 분석(평균 시즌·유입별 LTV·연대기 KPI). Firebase Export 자동 연동. SQL 필요 | 무료 티어(쿼리 월 1TB) | EAS 후 |
| **Google Play Install Referrer** | 유입 분석(유튜브광고→설치→첫시즌→결제→LTV). **안드로이드 전용**(iOS는 SKAdNetwork로 별개·추후) | 무료 | EAS |
| **Discord Webhook** | 운영 알림(서버 오류·첫 결제·문의 접수·Supabase 장애·API 오류·첫 우승). 1인 운영 최고 도구 | 무료 | **지금 가능**(서버 라우트에서 catch→POST) |
| **Vercel Observability** | 서버리스 API 모니터링(Function Error·Response Time·Invocation·Cold Start). **우리 구조에 가장 적합**(Grafana/Loki 대체) | Vercel 플랜 내 | **지금 가능** |
| **UptimeRobot** | 헬스체크 — `/api/health` 핑(+Supabase 연결 확인). 머니패스 생존 감시 | 무료 | **지금 가능** |

### ⭐ Tier B — 서비스 성장 시
| 도구 | 역할 | 도입 시기 |
|---|---|---|
| **Sentry** | 서버리스 **API 오류·Performance·Session** — Crashlytics가 못 보는 서버 오류 보완. Vercel 궁합 좋음 | 서버 규모 커질 때 |
| **PostHog** | Session Replay·Heatmap·Funnel·Feature Flag(심층 UX) | DAU 3,000~5,000+ |

### 제외
- **Mixpanel** — Firebase+BigQuery와 기능 대부분 중복.
- **Grafana + Loki** — 자체 운영 VM/Kubernetes 로그용. 우리는 Vercel 서버리스라 안 맞음(→ Vercel Observability + Discord로 대체).

---

## 2. 계측 원칙

1. **`track(event, params)` 래퍼 하나로** Firebase·GameAnalytics에 **동시 전송**(SDK 직접 호출 금지 — 이벤트를 두 번 심는 공수 방지). 한 번 호출로 두 곳에 도달.
2. **리텐션(D1/D7/D30)은 커스텀 이벤트 아님** — `app_open`만 정확히 기록하면 Firebase/GameAnalytics가 **자동 산출**.
3. **연대기 KPI(첫 우승 시즌·가장 오래 함께한 선수 등)는 raw 이벤트 축적 X** — 이 게임은 **결정론 시뮬**이라 세이브에서 재계산됨. **클라가 계산한 결과를 필요한 시점에 1건만** 전송(비용·정확도 유리).
4. **재화 진실은 서버 원장**([[server-authoritative-currency]]) — `diamond_earned/spent`·`purchase`는 애널리틱스로 "관측"만. 실제 잔액/지급 진실은 `wallet_ledger`(§13.12). 애널리틱스 수치와 원장이 어긋나면 **원장이 진실**.
5. **SDK는 네이티브 → EAS 빌드 필요**(Expo Go 불가). 서버측(Vercel Observability·Discord·UptimeRobot)은 **지금도 구축 가능**.
6. **프라이버시 고지 동반**(SDK 도입 = 개인정보처리방침·Google Play Data Safety·Apple Privacy Nutrition Label 업데이트 — PRE_LAUNCH §5).

---

## 3. 수집 이벤트 (taxonomy)

> `track(event, params)`로 발화. 발화 위치(대략)는 구현(instrumentation) 시 확정.

| 분류 | 이벤트 | 발화 위치(대략) |
|---|---|---|
| 사용자 | `app_open` · `login` · `logout` | `_layout`·`useAuthStore` |
| 시즌 | `season_start` · `season_end` · `playoffs` · `champion` | `season-start`·store `endSeason`·`playoffs`·`enshrine` |
| 경기 | `match_start` · `match_end` · `full_set` · `triple_crown` | `match/[id]`·`simMatch` 결과 (※triple_crown은 **교정된 KOVO 정의**로 — [[verify-domain-definitions]]) |
| 선수 | `draft_open` · `draft_pick` · `rookie_debut` · `retirement` · `injury` | `draft`·`draft-live`·시즌 계층(rollover/retire/injury) |
| FA | `fa_open` · `fa_sign` | `fa` |
| 육성 | `training` · `special_training` | `training-camp`(전지훈련) |
| BM | `watch_ad` · `diamond_earned` · `diamond_spent` · `purchase` | `mypage`·store diamonds·RC 웹훅(purchase) |
| 뉴스 | `news_open` · `news_read` | `news`·`news/[id]` |
| UI | `standings_open` · `player_detail` · `mvp_ceremony` | `standings`·`player/[id]`·`awards-ceremony` |

---

## 4. 핵심 KPI (출시 후 대시보드)

- **유저**: DAU·WAU·MAU · D1/D7/D30 · 평균 플레이시간 · 평균 접속 횟수 · 신규/복귀
- **게임**: 평균 시즌 진행 수 · 첫 시즌 완료율 · 3/10/30/100시즌 도달률
- **BM**: 광고 시청률·완료율·평균 광고 횟수 · 다이아 획득/소비 · 특별훈련 사용률 · 구매 전환율 · LTV
- **콘텐츠**: 뉴스 열람률 · MVP 시상식 열람률 · 은퇴 기사 열람률 · 초특급 유망주 기사 열람률
- **선수**: 평균 선수 보유 기간 · FA 이적률 · 방출률 · 초특급 유망주 보유율
- **운영**: Crash Free User(Crashlytics) · API 오류율·평균 응답속도(Vercel Observability/Sentry) · 문의 유형·평균 답변 시간(문의 §13.17)
- **연대기(감정 KPI)**: 첫 우승까지 시즌 · 첫 초특급 유망주 시즌 · 가장 오래 함께한 선수 · 가장 많은 우승 안긴 선수 · 가장 많이 읽힌 뉴스 유형 · 가장 많이 저장(스크린샷)된 화면 → **콘텐츠 업데이트 우선순위 결정 근거**

---

## 5. 데이터 흐름 (최종)

```
Google Ads → Install Referrer(Android) → 설치
React Native ──track()──► Firebase Analytics ──► BigQuery
                       └► GameAnalytics        └► Crashlytics(크래시)
             결제 ─────► RevenueCat(BM 진실·매출)
Next.js(Vercel) ──► Vercel Observability(API) · Discord Webhook(알림) · UptimeRobot(/api/health)
DB ──► Supabase (재화·계정·결제·로그·문의·통계 롤업 = 서버 진실)
```

> 역할 분리: **재무·매출 진실=RevenueCat** · **재화 지급 진실=우리 원장(Supabase)** · **행동 분석=Firebase/GameAnalytics/BigQuery** · **장애/알림=Vercel Observability+Discord+UptimeRobot+Crashlytics**.

---

## 6. 관리자 대시보드 11섹션 지표 명세 (📋 명세 확정·미구현 — 2026-07-09, 구현은 EAS 계측 후)

> **상태**: 사용자 확정(2026-07-09). **명세만** — 코드 미구현. 구현은 대부분 **EAS 계측(track()) 이후**(§2·5 — Expo Go서 네이티브 SDK 무동작).
> 서버 구현(롤업 테이블·집계 라우트·ops-9f3a2c 화면·CSV·이상징후 알림)의 정본은 **[BACKEND_SYSTEM §13.25](./BACKEND_SYSTEM.md#1325)** — 이 절은 **"무엇을 보여줄지(지표·출처·분류)"**, 그 절은 **"어떻게 서버가 모아 그리는지(스키마·라우트·화면)"**.

### 6.0 아키텍처 결정 — **pull-and-cache**(모든 걸 우리 화면 한 곳에서)

사용자 확정(2026-07-09): **"우리 관리자 대시보드 화면(ops-9f3a2c)에서 모든 걸 본다."** 외부 콘솔(Firebase·RevenueCat·AdMob·Sentry)을 따로 열지 않는다.

```
[외부 원천]  Firebase/GA4·BigQuery · RevenueCat · AdMob · Sentry/Crashlytics
     │  (서버가 주기적 pull/sync — 일 1회 배치 등)
     ▼
[우리 서버 캐시/롤업]  statsDaily(확장) + 외부-sync 캐시 테이블(externalDaily 등)
     │  (+ 게임 도메인 지표는 우리가 track() 이벤트 수신·집계로 직접 롤업)
     ▼
[ops-9f3a2c 대시보드 한 화면]  11섹션 탭/카드 · 일/주/월 토글 · 그래프+숫자 · CSV
```

- **진실의 원천 분리는 유지**(이중 수집·재계산 안 함): DAU/리텐션/플레이시간=Firebase·GA4/BigQuery · ARPU/ARPPU/결제/LTV=RevenueCat · 광고 수익/eCPM=AdMob · 크래시/API오류=Crashlytics/Sentry가 **여전히 원천**.
- **표시만 우리 화면**: 서버가 그 값을 **외부 API/Export로 당겨와**(RevenueCat REST · GA4 Data API · BigQuery 쿼리 · AdMob API · Sentry API) 우리 롤업/캐시에 적재하고 ops-9f3a2c가 렌더.
- **게임 도메인 지표는 그대로 우리가 집계**(범용 분석이 못 함): 시즌 진행 분포·오프시즌 funnel·경기/선수/밸런스·운영 알림.
- **결정론 격리 유지**(BACKEND §8): 통계·sync 캐시는 **재화/시드/리플레이와 무관한 순수 메타**. 시드/리플레이엔 절대 안 들어간다.

### 6.1 지표 출처 분류 원칙 (태그 정의)

| 태그 | 뜻 | 원천 | 서버 처리 |
|---|---|---|---|
| **[외부-sync]** | 표준 지표 — 외부 도구가 이미 산출 | Firebase/GA4·BigQuery·RevenueCat·AdMob·Sentry | 서버가 외부 API에서 **pull → 캐시 테이블 적재**(재계산·이중수집 금지) |
| **[자체-롤업]** | 게임 도메인 지표 — 범용 분석 불가 | 우리 `track()` 이벤트 / 원장 / statsDaily | 서버가 **직접 집계·롤업**(§13.25 테이블) |
| **[합성]** | 두 출처를 한 카드에 합침 | 위 둘 | ops 화면이 조합(§11 메인 KPI) |

- **[외부-sync] 공통 계약**: sync 주기(기본 **일 1회 배치**, 실시간성 필요분은 앱 열 때 on-demand) · **실패 시 폴백 = 마지막 캐시 표시**(+"n시간 전 동기화" 배지, 절대 화면을 막지 않음 — throw-none 결) · **외부 API 키는 서버 env 보관**(클라 노출 0, BACKEND §13.25).
- **[자체-롤업] 공통 계약**: EAS 계측(track()) 이벤트를 서버가 수신·집계하거나 BigQuery에서 쿼리해 롤업. 원장 파생분(광고·결제·업적)은 이미 서버 보유(sync 불요).

### 6.2 섹션별 지표 명세 (11섹션)

> 각 지표: 이름 · **[태그]** · 원천(track 이벤트/외부 API/원장) · 조회 축(일/주/월). **전 섹션 공통**: 그래프+숫자 병행 · **일/주/월 토글**(해당 시 연도) · **CSV/엑셀 다운로드** · 확장 쉬운 구조.

**① 사용자 현황** — 가입·설치·활성·이탈
| 지표 | 태그 | 원천 |
|---|---|---|
| 가입 수(누적·신규/일주월) | [자체-롤업] | `users` 테이블(서버 진실) · statsDaily.newUsers |
| 설치 수 | [외부-sync] | Google Play Install Referrer(Android)/GA4 · BigQuery |
| DAU / WAU / MAU | [외부-sync] | Firebase(`app_open` 자동 산출) · GA4 Data API. ※서버 근사값(lastSeenAt)은 폴백용 [자체-롤업] |
| 신규 / 탈퇴(soft-delete) | [자체-롤업] | `users.createdAt`·`deletedAt` |
| 일·주·월 그래프 | [합성] | 위 조합 |

**② 리텐션 코호트** — 설치일 기준 D1/D3/D7/D14/D30
| 지표 | 태그 | 원천 |
|---|---|---|
| D1/D3/D7/D14/D30 리텐션 (cohort 표) | [외부-sync] | Firebase/GameAnalytics 자동 산출(`app_open`) · GA4/BigQuery cohort 쿼리 |
| 설치일 코호트 매트릭스 | [외부-sync] | BigQuery(코호트 SQL) → 서버 캐시 |

> 리텐션은 커스텀 이벤트 아님(§2-2) — `app_open`만 정확하면 외부가 자동. 우리는 **결과 표만 sync**해 그린다.

**③ 플레이** — ★배구명가 핵심 = 시즌 진행률
| 지표 | 태그 | 원천 |
|---|---|---|
| 세션 길이 / 세션 횟수 | [외부-sync] | Firebase engagement · GA4 |
| 평균 시즌 진행 수 | [자체-롤업] | `season_start`·`season_end` track |
| **1·3·5·10시즌 완료율** ★ | [자체-롤업] | `season_end` 시즌번호 분포 롤업(funnel) |
| 첫 시즌 완료율(=1시즌) | [자체-롤업] | `season_start`→`season_end` 전환 |

**④ 오프시즌 funnel** — 어디서 이탈하나
| 지표 | 태그 | 원천 |
|---|---|---|
| 외국인 트라이아웃 도달/완료 | [자체-롤업] | `fa_open`/외국인 트라이아웃 track(신규 이벤트 필요 — §6.3) |
| FA 센터 도달/완료 | [자체-롤업] | `fa_open`·`fa_sign` |
| 드래프트 완료 | [자체-롤업] | `draft_open`·`draft_pick` |
| 전지훈련 도달률 | [자체-롤업] | `special_training`(전지훈련) |
| 단계별 이탈 funnel | [자체-롤업] | 오프시즌 단계 이벤트 순서 집계 |

**⑤ BM(수익화)**
| 지표 | 태그 | 원천 |
|---|---|---|
| 총/일/월 매출 | [외부-sync] | **RevenueCat**(재무 진실) → REST pull. 서버 statsDaily.revenueKrw는 웹훅 롤업(보조) |
| 상품별 판매량(전지훈련팩·운영비·스킨·기타) | [외부-sync] | RevenueCat 상품별 · productId. ※다이아 지급 건수는 [자체-롤업](원장 reason='purchase', ref=productId) |
| 결제율(전환율) | [합성] | RevenueCat(payers) + `users`(총가입). 서버 근사=원장 고유 payer/총가입 |
| ARPU / ARPPU | [외부-sync] | RevenueCat |
| 상품별 구매율 | [외부-sync] | RevenueCat |

**⑥ 광고**
| 지표 | 태그 | 원천 |
|---|---|---|
| 노출 / 시청완료율 / eCPM / 수익 | [외부-sync] | **AdMob API** → pull |
| 보상광고 횟수(종류별) | [자체-롤업] | 원장 reason='ad'(서버 진실, §13.15 광고 탭 이미 존재) + `watch_ad` track |

**⑦ 경기 데이터** — [자체-롤업] 전부
| 지표 | 태그 | 원천 |
|---|---|---|
| 경기 수 · 평균 경기시간 | [자체-롤업] | `match_start`·`match_end` track(경기시간=start→end) |
| 최다 우승팀 · 평균 득점 · 평균 세트 | [자체-롤업] | `match_end`·`champion` params(점수·세트 수) |

**⑧ 선수 데이터** — [자체-롤업] 전부
| 지표 | 태그 | 원천 |
|---|---|---|
| 최다 영입 외국인 · 최다 지명 포지션 | [자체-롤업] | `fa_sign`·`draft_pick` params(포지션·선수) |
| 평균 은퇴 나이 · 평균 OVR 성장 | [자체-롤업] | `retirement`(나이) · 성장 델타 track |
| 전지훈련 이용 비율 | [자체-롤업] | `special_training` 유저/총 |

**⑨ 오류 모니터링** — 건수 + 최근 로그
| 지표 | 태그 | 원천 |
|---|---|---|
| 크래시(앱) | [외부-sync] | Crashlytics(EAS 후) · 현재는 전역 핸들러→진단 스냅샷(§13.20 ④-0) |
| API 실패 · 서버 오류 | [외부-sync] | **Sentry API**(§13.21) → pull. 최근 로그 목록 |
| 로딩 실패 · 네트워크 · 로그인 실패 | [자체-롤업] | `lib/deviceLog`·서버 `Log` 테이블 · `login` 실패 이벤트 |

**⑩ 운영 알림** — 이상징후 상단 카드
| 지표 | 태그 | 원천 |
|---|---|---|
| D1 급감 · 결제율 급감 · 광고수익 급감 · 서버오류 증가 · 크래시 증가 | [합성] | 위 섹션들의 롤업/sync 값 **전일 대비 임계 초과 감지**(서버 배치가 판정 → Discord 알림 + 상단 카드). §13.25 |

**⑪ 메인 KPI** — [합성] 한 화면 최상단(가장 크게)
DAU · MAU · D1 · D7 · D30 · 첫시즌 완료율 · 평균 플레이시간 · 결제율 · ARPU · ARPPU · 일매출 · 월매출.
→ **[외부-sync](DAU·MAU·리텐션·플레이시간·ARPU·ARPPU) + [자체-롤업](첫시즌 완료율·결제율·매출) 을 한 카드 행에 합성.** 이게 "한 화면 즉시 파악"의 답.

### 6.3 신규 track 이벤트 (기존 §3 taxonomy 보강 필요)

11섹션이 요구하는데 §3에 **없는** 이벤트(EAS 계측 시 추가):
- **외국인 트라이아웃** 단계(④ funnel) — `foreign_tryout_open`·`foreign_tryout_sign`(현 §3는 `fa_open`/`fa_sign`만, 외국인 트라이아웃 분리 없음).
- **경기 소요시간**(⑦) — `match_end`에 `durationMs`·`totalPoints`·`sets` params 추가(현 `match_end`엔 승패만 가정).
- **OVR 성장 델타**(⑧) — 시즌말 `season_end`에 팀 평균 OVR 성장 param, 또는 `player_growth`.
- **오프시즌 funnel 진입/이탈** — 각 단계 `*_open`이 이미 대부분 있음(`draft_open`·`fa_open`), 전지훈련은 `special_training`로 도달만 측정.

> 이벤트 추가는 §3 taxonomy 개정 + `_dv_analytics.ts` 가드에 등록(중복0·throw-none 유지). **명세 확정 시점엔 목록만** — 실제 발화 위치는 계측 구현 때.

### 6.4 의존성 요약 (언제 가능한가)

| 지표군 | 가능 시점 | 이유 |
|---|---|---|
| ⑤ BM(원장 파생분)·⑥ 광고(원장 reason='ad')·① 서버 근사 DAU·⑨ Sentry API·⑩ 서버오류 알림 | **지금~서버 단계** | 이미 서버/원장 보유(§13.15 일부 구현) |
| [외부-sync] 전부(DAU/리텐션/플레이시간/ARPU/eCPM/크래시) | **EAS 빌드 후** | 네이티브 SDK 계측 + 외부 API 키 연결 |
| [자체-롤업] 게임 도메인(③④⑦⑧) | **EAS 계측(track()) + 서버 이벤트 수신 파이프라인 후** | track() 이벤트가 서버에 도달해야 집계. 원장 파생분만 예외 |
