# Vercel Pro 전환 + 출시 전 env 확정 런북 (VERCEL_PRO_LAUNCH_RUNBOOK)

> **상태(2026-08-05)**: 📋 실행 대기 — 오늘 Vercel Pro 전환 시 **함께** 처리. 핵심 동반 작업 = `TELEMETRY_SALT` 시크릿 지정(가명화 완전화, [[telemetry-pseudonymized]]).
> **성격**: 결제·계정 설정·시크릿 = **사용자 직접 수행**(안전 규칙 — Claude 대행 불가). 이 문서는 순서·체크리스트·검증을 제공.
> **정본 관계**: 배포 체인은 `docs/SERVER_OPS.md`·`deploy-prod` 스킬, env 사고 이력은 [[vercel-link-clobbers-env]], 결제 셋업은 `store-iap-setup` 스킬.

---

## 0. 왜 지금 (한 줄)

- **Hobby 플랜 = 비상업(non-commercial) 전용 ToS.** 인앱결제(다이아)로 **수익이 발생하는 게임**은 **상업 서비스**라 공개(수익화) 출시 전 **Pro 전환 필수**(약관 위반 시 서비스 중단 리스크). Pro는 함수 실행시간·대역폭 상한도 완화.
- **전환 자체는 요금제(빌링) 변경일 뿐 — 배포·코드·env엔 파급 없음.** 다만 "이왕 콘솔 들어간 김에" env를 확정(특히 `TELEMETRY_SALT`)하는 게 이 런북의 목적.

---

## 1. Vercel Pro 전환 (사용자 직접 — 결제)

1. Vercel 대시보드 → 해당 팀/프로젝트 → **Settings → Billing** → **Upgrade to Pro**.
2. 결제 수단 입력·확정. ⚠ **Claude는 결제 정보 입력 불가**(안전 규칙) — 손님이 직접.
3. 전환 후 프로젝트가 그대로 유지되는지 확인(도메인 `volleyball-jet-nine.vercel.app` 유지, 재배포 불요).

> 전환은 env·배포를 건드리지 않는다. `vercel link`/`vercel env pull`을 **실행하지 말 것** — 로컬 `.env.local`을 무경고 덮어써 시크릿을 날린 사고 이력 있음([[vercel-link-clobbers-env]]). env 변경은 **대시보드 UI에서만**.

---

## 2. `TELEMETRY_SALT` 지정 (오늘의 핵심 동반 작업)

시즌 텔레메트리 가명화(analytics_id = HMAC(userId, SALT))가 **완전한 가명**이 되려면 SALT가 **별도 관리되는 시크릿**이어야 한다. 현재 prod엔 미설정 → 코드가 폴백 상수(소스 노출)를 씀([[telemetry-pseudonymized]]).

1. **강한 랜덤 값 생성**(손님이 로컬에서 — 채팅에 값 남기지 말 것):
   - 예: 터미널 `openssl rand -hex 32` (64 hex) 또는 비밀번호 관리자의 랜덤 문자열 생성.
2. Vercel 대시보드 → **Settings → Environment Variables** → **Add**:
   - Name: `TELEMETRY_SALT`
   - Value: 위에서 생성한 값
   - Environment: **Production** 체크(원하면 Preview도).
3. **저장 후 재배포 필요**(env 변경은 새 배포부터 적용):
   - 대시보드 → **Deployments → 최신 → ⋯ → Redeploy** (코드 변경 없이 env만 재주입), 또는
   - `git commit --allow-empty -m "chore: apply TELEMETRY_SALT env" && git push`.
4. ⚠ **지금(비공개 테스트) 지정이 이상적** — 나중에 SALT를 바꾸면 이후 analytics_id가 달라져 **코호트 연속성이 끊긴다**(분석 데이터라 무해하나, 출시 후 바꾸면 추이 그래프가 끊겨 보임). 그래서 **출시 전 한 번 확정**.

> 참고: SALT 미설정이어도 개인정보 제거 효과(userId FK 부재·실명 조인 불가)는 **이미 동일**. SALT는 "재식별 저항"을 폴백상수(공개) → 시크릿(비공개)으로 올리는 강화 단계.

---

## 3. prod env 전수 점검 (콘솔 들어간 김에 — 누락 방지)

Vercel **Settings → Environment Variables**에서 **Production** 스코프에 아래가 있는지 확인. (값은 확인만, 노출·복사 금지. 코드가 실제로 읽는 키 기준 — `grep process.env` 2026-08-05.)

### 필수 (없으면 해당 기능 장애)
| 키 | 용도 | 비고 |
|---|---|---|
| `DATABASE_URL` | 런타임 DB(풀러 :6543, `prepare:false`) | 마이그레이션용 아님 |
| `SESSION_JWT_SECRET` | 자체 Bearer 세션 서명 | 미설정 시 로그인 fail-closed |
| `ADMIN_TOKEN` | 관리자 콘솔·admin API 인증 | ≥16자 |
| `GOOGLE_OAUTH_CLIENT_IDS` | 구글 소셜 로그인 idToken 검증 | 쉼표구분 허용 |
| `PROJ_CODE` | 멀티게임 격리 코드 | =`volleyball` |
| `CRON_SECRET` | 크론(파기·패스) 인증 | |

### 결제(#43) — 수익화 출시 게이트
| 키 | 용도 |
|---|---|
| `RC_REST_API_KEY` | RevenueCat REST(구매 재검증) |
| `RC_WEBHOOK_SECRET` | RC 웹훅 Authorization 검증 |
| `RC_SANDBOX_GRANT` | 샌드박스 구매 지급 토글(테스트) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` · `APPLE_ASSN_*` · `APPLE_BUNDLE_ID` · `ADMOB_SSV_VERIFY` | 스토어/광고 검증(`store-iap-setup` 스킬 정본) |

### 레이트리밋
| 키 | 용도 |
|---|---|
| `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` (또는 `KV_REST_API_URL`/`KV_REST_API_TOKEN`) | 문의·스냅샷·쿠폰 레이트리밋 |

### 마이그레이션 전용(런타임 아님)
| 키 | 용도 |
|---|---|
| `MIGRATE_DATABASE_URL` | 스키마 변경 직결(:5432 세션모드) — [[prod-migration-apply-method]] |

### 오늘 추가
| 키 | 용도 |
|---|---|
| **`TELEMETRY_SALT`** | 텔레메트리 가명 키(§2) — **오늘 지정** |

### 선택(관측/알림 — 미설정이면 no-op)
| 키 | 용도 |
|---|---|
| `SENTRY_DSN` · `SENTRY_TRACES_SAMPLE_RATE` · `SENTRY_API_TOKEN` | 서버 오류 관측(없으면 완전 no-op) |
| `DISCORD_WEBHOOK_URL` · `DISCORD_TICKET_WEBHOOK_URL` | 결제·문의 디스코드 알림(없으면 전송 안 함) |
| `PROMO_1P1_ENABLED` | 출석 패스 1+1 프로모 토글 |

### 자동(Vercel 제공 — 손댈 필요 없음)
`NODE_ENV` · `NEXT_RUNTIME` · `VERCEL_ENV` · `VERCEL_GIT_COMMIT_SHA`

---

## 4. 전환·설정 후 검증 (스모크)

```bash
D=https://volleyball-jet-nine.vercel.app
curl -s "$D/api/devnotes"    # {"ok":true,...}
curl -s "$D/api/bootstrap"   # {"ok":true,"maintenance":...}
```
- 둘 다 `ok:true`면 배포·DB 정상.
- 텔레메트리는 시즌 종료 시에만 발사(비차단) — 별도 스모크 불요. `TELEMETRY_SALT` 적용 여부는 재배포 이후 새 텔레메트리부터 반영(기존 데이터는 폐기됨, 무해).

---

## 5. 관련 / 순서 메모

- **Supabase Pro**: 별건(무료 free-tier 정지 회피). 오늘 함께 처리한다면 Supabase 대시보드에서 별도 업그레이드(결제=손님). DB 연결 문자열은 **바뀌지 않음**(플랜만 변경) — env 갱신 불요.
- **출시 전 전체 점검**은 `docs/PRE_LAUNCH_CHECKLIST.md`·`play-store-launch-checklist` 스킬 참조. 이 런북은 그중 "Vercel Pro + env 확정" 조각.
- 완료하면 이 문서에 "✅ 완료(날짜)" 표시 + [[telemetry-pseudonymized]] 메모리의 "출시 전 남은 액션"을 해소로 갱신.
