# SERVER_OPS — 개발/운영 서버 운용 가이드 (테스트·배포·장애 대응)

> **정본 관계**: 서버 아키텍처·설계 결정은 [BACKEND_SYSTEM](./BACKEND_SYSTEM.md)(특히 §13.7 연결·§13.7.1 dev 로컬 DB·§13.8 env)이 정본.
> 이 문서는 그 위의 **운용 절차서** — "어떻게 켜고, 어떻게 테스트하고, 어떻게 배포·운영하는가"를 한 곳에 모은다.
> 신설 2026-07-15(사용자 요청 — 개발자 노트 로컬 테스트 중 "연결 필요" 원인 진단에서 출발).

---

## 0. 한 장 요약 — 두 세계

```
[개발]  폰/에뮬(Expo Go) ── Expo 8082 ──▶ 앱 ──▶ 로컬 서버 :3000 (next dev) ──▶ 로컬 DB
[운영]  실제 설치 앱                        앱 ──▶ Vercel (https://volleyball-jet-nine.vercel.app) ──▶ Supabase 호스팅 Postgres
```

- 앱이 어느 서버를 보는지는 **`EXPO_PUBLIC_SERVER_URL`**(루트 `.env`, 번들 시점에 박힘)이 결정. 기본값 = **운영 Vercel**.
- **게임플레이(관전·시즌 시뮬)는 서버 무관 로컬 결정론** — 서버는 재화·계정·결제·콘텐츠(공지/노트)·로그만(CLAUDE §8 격리).
- 서버 코드는 하나(`server/`), 환경만 갈린다: dev = `next dev` + 로컬 DB / prod = Vercel + Supabase 호스팅.

### 환경 매트릭스

| | 개발(dev) | 운영(prod) |
|---|---|---|
| 서버 | 로컬 `next dev` :3000 | Vercel(자동 빌드/서버리스) |
| DB | **로컬**: Supabase CLI(`supabase start`, :54322) — §13.7.1 정본. 포트 막히면 임시 Docker PG(아래 2.1b) | Supabase 호스팅(풀러 :6543 `prepare:false` / 마이그레이션 :5432 — §13.7) |
| env | `server/.env.development.local`(로컬 DB URL 등 — dev 우선 로드) | Vercel 환경변수(DATABASE_URL·SESSION_JWT_SECRET·ADMIN_TOKEN·CRON_SECRET) + `server/.env.local`(로컬에서 운영 DB 겨냥용) |
| 앱 지향 | `EXPO_PUBLIC_SERVER_URL=http://<내 LAN IP>:3000`으로 Expo 재시작 | 기본값(루트 `.env`의 Vercel URL) |
| dev 로그인 | 서버가 dev provider 허용(비프로덕션) → 실 Bearer 발급 | **401 차단**(계정 백도어 방지, SECURITY #2b) → 앱은 `__DEV__` 로컬 폴백 세션(Bearer 없음 = 온라인 기능은 typed 실패) |
| 스키마 반영 | `drizzle-kit push`(자유) | **마이그레이션 파일**(`generate`+`migrate`) — 운영 후엔 Expand/Contract 3단계([[prod-schema-migration-caution]]) |

---

## 1. 흔한 증상 → 원인 (먼저 보기)

| 증상 | 원인 | 처방 |
|---|---|---|
| 앱에서 "연결 필요"(공지/노트/지갑) | ① 앱이 **운영**을 보는데 그 API가 아직 미배포 ② 로컬 서버 미기동 ③ 앱 재포인트 안 됨 | §2 dev 체인 기동 or §3 배포 |
| dev 로그인이 401 | 앱이 **운영 서버**를 보고 있음(설계 — 운영은 dev provider 차단) | 로컬 재포인트(§2.4) 후엔 실 Bearer 발급됨 |
| `supabase start`가 `bind: access permissions` (54322) | Windows WinNAT 동적 예약 대역에 포트가 걸림(재부팅 후 흔함). `netsh interface ipv4 show excludedportrange protocol=tcp`로 확인 | 관리자 `net stop winnat && net start winnat` 또는 재부팅. 급하면 §2.1b 임시 PG |
| 서버는 뜨는데 지갑/관리자 500 | DATABASE_URL이 죽은 DB를 가리킴(54322 다운인데 override 안 함) | §2.1~2.2 확인 |
| 폰에서 :3000 접속 불가 | `next dev`를 `-H 0.0.0.0` 없이 띄움 / 방화벽 / 폰이 다른 네트워크 | §2.3 옵션 확인·같은 Wi-Fi·방화벽 허용 |
| 라이브 가드가 ECONNREFUSED 127.0.0.1:54322 | 로컬 DB 다운 | DB 기동 or `DATABASE_URL=... npx tsx tools/_dv_*.ts` 오버라이드(§2.5) |

---

## 2. 개발 테스트 체인 (로컬 풀스택)

### 2.1 DB 기동 — 정석: 로컬 Supabase
```bash
npx supabase start        # :54322 (server/.env.development.local의 DATABASE_URL과 일치)
```

### 2.1b DB 기동 — 우회: 임시 Docker Postgres (54322가 WinNAT에 막혔을 때)
```bash
docker run -d --name dev_pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:15-alpine
cd server && DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres" npx drizzle-kit push --force
```
- 역할은 동일(전 테이블 push). **데이터는 컨테이너 수명 동안만**(rm 하면 소멸 — dev 테스트엔 충분).
- 이 경우 이후 모든 서버/가드 명령에 같은 `DATABASE_URL` 오버라이드를 붙인다.

### 2.2 스키마 반영 (dev)
```bash
cd server && npx drizzle-kit push --force        # dev는 push 자유(정본 §13.7)
```

### 2.3 서버 기동
```bash
cd server && npx next dev -p 3000                # 로컬만 (에뮬 테스트)
cd server && npx next dev -H 0.0.0.0 -p 3000     # 폰(LAN)에서 접속하려면 -H 필수
# 임시 PG면: DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres" npx next dev -H 0.0.0.0 -p 3000
```
- 헬스체크: `curl http://localhost:3000/api/devnotes` → `{"ok":true,...}`.
- 첫 LAN 리슨 때 Windows 방화벽 허용 창이 뜰 수 있음(허용).
- **⚠ 로컬 dev는 `.env.local`(운영 크리덴셜)도 읽는다** — Next는 dev에서도 `.env.local`을 로드하므로 **DB만 로컬이고 관측·외부 연동은 운영으로 샐 수 있다**.
  Sentry는 코드 게이트로 막았다(`lib/sentryGate.ts` — 배포 `VERCEL_ENV=production|preview`에서만 전송, 가드 `tools/_dv_sentry_gate.ts`. 사건·상세 BACKEND_SYSTEM §13.21-a).
  로컬에서 일부러 Sentry로 보내려면 `SENTRY_FORCE_LOCAL=1`. **다른 운영 키(RC·GA4 등)를 새로 붙일 땐 같은 함정을 먼저 의심**하고, dev에선 `.env.development.local`에 빈 값으로 덮어라(먼저 로드된 키가 우선).

### 2.4 앱 재포인트 + Expo
```bash
# LAN IP 확인(무선): PowerShell → Get-NetIPAddress ... (192.168.x.x)
EXPO_PUBLIC_SERVER_URL="http://<LAN IP>:3000" npx expo start --port 8082 -c
```
- `EXPO_PUBLIC_*`는 **번들에 박히므로** 서버 URL을 바꾸면 Expo를 `-c`(캐시 클리어)로 재시작해야 반영.
- ⚠ 루트 `.env`의 운영 URL을 **직접 고쳐서 커밋하지 말 것** — 셸 env 오버라이드가 안전(위 방식).
- 폰과 PC가 **같은 Wi-Fi**여야 함. 끝나면 오버라이드 없이 재시작 = 운영 지향 복귀.

### 2.5 관리자·콘텐츠 테스트 (개발자 노트·공지·쿠폰)
- 관리자 페이지: `http://localhost:3000/ops-9f3a2c` — 토큰은 `ADMIN_TOKEN`(서버 env).
- 노트 작성 → 초안 저장 → **게시 토글** → 앱(마이페이지→개발자 노트)에서 즉시 확인. 임시 PG면 데이터가 컨테이너와 운명 공동체임을 기억.
- 서버 가드 배터리(README "서버 가드 배터리" — 순수 4 + 라이브 8): 라이브는 dev DB 필요, `tools/_env.ts`가 `.env.development.local` 우선 로드. 임시 PG면 `DATABASE_URL=... npx tsx tools/_dv_*.ts`.

### 2.6 정리
```bash
docker rm -f dev_pg            # 임시 PG 정리(썼다면)
# Expo/next dev는 세션 종료 시 함께 정리
```

---

## 3. 운영(배포) 체인

> 원칙: **스키마 먼저, 코드 다음**(additive 마이그레이션이면 순서 무해하나 습관화). 배포는 되돌리기 쉬워도 DB는 아니다.

### 3.1 prod 마이그레이션
```bash
cd server && npx drizzle-kit generate      # 스키마 diff → migrations/*.sql (베이스라인은 0000, 2026-07-15부터)
# 검토: additive(테이블/컬럼 추가·IF NOT EXISTS 멱등)인지 눈으로 확인 — 운영 후 파괴 변경은 Expand/Contract 3단계
MIGRATE_DATABASE_URL(:5432 직결)로 npx drizzle-kit migrate   # 풀러(:6543) 아닌 직결 포트(§13.7)
```

### 3.2 서버 배포
```bash
cd server && npx vercel --prod             # 또는 git push 연동 빌드
```
- 배포 전 체크: `npx tsc --noEmit`(server) 0 · 서버 가드 배터리 그린 · 새 env 키가 생겼으면 **Vercel 환경변수에 먼저 등록**(Production+Preview).
- ⚠ `vercel link`/`env pull`은 `.env.local`을 무경고 덮어씀([[vercel-link-clobbers-env]]) — 실행 전 `cp .env.local .env.local.bak`.

### 3.3 배포 후 확인 (스모크)
```bash
curl https://volleyball-jet-nine.vercel.app/api/devnotes     # 새 라우트 200 확인
```
- 실기기(운영 지향 그대로)에서 해당 화면 진입 확인. 관리자 페이지 로그인 → 원격 설정(minVersion·공지·노트)은 **배포 없이** 관리자에서 즉시 운영.
- 문제 시: Vercel 대시보드 롤백(이전 배포로 즉시) — 단 마이그레이션은 롤백 안 되므로 additive 원칙이 보험.

### 3.4 운영 중 일상
- **콘텐츠 운영(배포 불필요)**: 공지(차단성)·개발자 노트/패치노트(읽을거리)·쿠폰·min/latestVersion — 전부 관리자 페이지에서.
- **관측**: 서버 오류는 `reportError` 경유(+Discord webhook — ANALYTICS_PLAN, 셋업 예정 항목은 그 문서), 문의는 관리자 티켓 큐.
- **정기**: 파기 크론(purgeExpired — 보존기간 §13.9), 지갑 대사(라이브 가드 배터리를 운영 DB 겨냥으로 돌릴 땐 `DATABASE_URL=<prod>` 명시 — 테스트 데이터는 프리픽스 자동 정리지만 신중히).

---

## 4. 오늘 기준 상태 메모 (2026-07-15)

- ~~**운영 미배포 잔량**: devnotes·계정 삭제(account)·연령 게이트 — 코드는 main에 커밋됐으나 **Vercel 배포 + prod 마이그레이션(0000 devnotes·0001 account, 둘 다 additive 멱등) 미적용**.~~
  → **정정(2026-07-24, 이 메모가 스테일 — `PAYMENT_LAUNCH_RUNBOOK`과 상충하던 건):** 위 잔량은 **2026-07-17에 해소**됐다.
  근거(둘 다 이 메모보다 **나중 날짜의 실행 기록**이라 런북이 이긴다): ①`PAYMENT_LAUNCH_RUNBOOK` §3 진행기록(2026-07-17) —
  "**prod 스키마 push(devnotes·save_backups 신설, DROP 0 확인)** … redeploy, **스모크 3종(devnotes ok** / 무인증 401 / 정시크릿 TEST 200)",
  ②같은 문서 2026-07-18 컴플라이언스 감사에서 **prod 게시된 `delete-account` 페이지**(구글 데이터보안 계정삭제 URL 제출용)를 실물로 점검.
  **현재의 prod 미적용 잔량은 0002(`attendance_passes`)·0003(`mails`/`mail_broadcasts`)** — 런북 §"prod env·크론·마이그레이션 트리거"(사람이 트리거)로 이관됨.
  ※ 이 §4는 **날짜 박제 메모**라 시간이 지나면 반드시 스테일해진다 — 상태의 정본은 런북 진행기록 쪽으로 본다.
- **로컬 Supabase 54322**: WinNAT 예약 대역(54250-54349)에 걸려 기동 불가 — 재부팅 or 관리자 winnat 재시작으로 해제. 그때까지 §2.1b 임시 PG로 대체 중.
