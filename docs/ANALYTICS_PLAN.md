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
