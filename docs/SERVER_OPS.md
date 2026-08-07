# SERVER_OPS — 개발/운영 서버 운용 가이드 (테스트·배포·장애 대응)

> **정본 관계**: 서버 아키텍처·설계 결정은 [BACKEND_SYSTEM](./BACKEND_SYSTEM.md)(특히 §13.7 연결·§13.7.1 dev 로컬 DB·§13.8 env)이 정본.
> 이 문서는 그 위의 **운용 절차서** — "어떻게 켜고, 어떻게 테스트하고, 어떻게 배포·운영하는가"를 한 곳에 모은다.
> 신설 2026-07-15(사용자 요청 — 개발자 노트 로컬 테스트 중 "연결 필요" 원인 진단에서 출발).

---

## 0. 한 장 요약 — ~~두 세계~~ **세 환경**(2026-08-07 stg 신설)

```
[개발 dev] 폰/에뮬(Expo Go) ─ Expo 8082 ─▶ 앱 ─▶ 로컬 서버 :3000 (next dev) ─▶ 로컬 DB(:54322)
[스테이징 stg] 내부 테스트 앱/직접 호출     ─▶ Vercel Preview(`staging` 브랜치)  ─▶ Supabase stg (별도 Free 조직)
[운영 prod] 실제 설치 앱                    ─▶ Vercel (https://volleyball-jet-nine.vercel.app) ─▶ Supabase 호스팅 Postgres(Pro)
```

> ~~"두 세계"(dev/prod)~~ → **정정(2026-08-07): 세 환경.** 2026-08-07 프로덕션 출시 제출로 운영이 "실사용자 환경"이
> 되면서, 파괴적 검증(세이브 마이그레이션·DB 초기화·결제 웹훅·환불·대량 시뮬)을 안전하게 돌릴 **stg**를 신설했다.
> 구축 경위·함정·격리 실측은 [STAGING_PROD_RESET_RUNBOOK §3.5](./STAGING_PROD_RESET_RUNBOOK.md).

- 앱이 어느 서버를 보는지는 **`EXPO_PUBLIC_SERVER_URL`**(루트 `.env`, 번들 시점에 박힘)이 결정. 기본값 = **운영 Vercel**.
- **게임플레이(관전·시즌 시뮬)는 서버 무관 로컬 결정론** — 서버는 재화·계정·결제·콘텐츠(공지/노트)·로그만(CLAUDE §8 격리).
- 서버 코드는 하나(`server/`), 환경만 갈린다: dev = `next dev` + 로컬 DB / stg = Vercel Preview + Supabase stg / prod = Vercel + Supabase 호스팅.

### 환경 매트릭스

| | 개발(dev) | **스테이징(stg)** | 운영(prod) |
|---|---|---|---|
| 서버 | 로컬 `next dev` :3000 | **Vercel Preview**(`staging` 브랜치 자동배포) — `volleyball-git-staging-sonws.vercel.app` | Vercel(자동 빌드/서버리스, `main`) |
| DB | **로컬**: Supabase CLI(`supabase start`, :54322) — §13.7.1 정본. 포트 막히면 임시 Docker PG(아래 2.1b) | Supabase **별도 Free 조직 `Vivace Staging`** · ref `pdxdpzujeaxjweskecbv` · **`ap-southeast-1`(싱가포르)** · 지문 `06eb5f60fd04` | Supabase 호스팅(**Pro**, ref `vmedwppbpugjnxdfwzoq`, `ap-northeast-2`, 지문 `2b73921d4030`) — 풀러 :6543 `prepare:false` / 마이그레이션 :5432(§13.7) |
| env | `server/.env.development.local`(로컬 DB URL 등 — dev 우선 로드) | Vercel **`Preview` + `staging` 브랜치 지정** 스코프(12개) + 로컬 `server/.env.staging`. **결제(RC)·알림(Discord)·Sentry는 빈 값/부재 = 의도적 미연결** | Vercel **`Production` 전용** 스코프 + `server/.env.local`(로컬에서 운영 DB 겨냥용) |
| 접근 | — | **Vercel Authentication 켜짐**(비공개). 앱을 붙일 땐 해제 필요 | 공개 |
| 앱 지향 | `EXPO_PUBLIC_SERVER_URL=http://<내 LAN IP>:3000`으로 Expo 재시작 | 내부 테스트 빌드에 `EXPO_PUBLIC_SERVER_URL`=stg Preview URL(RUNBOOK §3.5.3 안 A/B) | 기본값(루트 `.env`의 Vercel URL) |
| 결제 | 스텁 | **미연결**(RC 키 부재 — 운영 원장 오염 차단) | RC 실연동 |
| 레이트리밋 | off(fail-open) | **off**(Upstash 키 부재 = fail-open) | Upstash 설정 시 on |
| dev 로그인 | 서버가 dev provider 허용(비프로덕션) → 실 Bearer 발급 | Preview는 `VERCEL_ENV=preview`(비프로덕션) → dev provider 허용 | **401 차단**(계정 백도어 방지, SECURITY #2b) → 앱은 `__DEV__` 로컬 폴백 세션(Bearer 없음 = 온라인 기능은 typed 실패) |
| 스키마 반영 | `drizzle-kit push`(자유) | `drizzle-kit push`(빈 DB 프로비저닝도 push — RUNBOOK 함정 ①) | **마이그레이션 파일**(`generate`+`migrate`) — 운영 후엔 Expand/Contract 3단계([[prod-schema-migration-caution]]) |

> 🔴 **env 스코프 원칙(2026-08-07 사고에서 확립)**: 운영 값은 **`Production` 전용**으로 등록한다.
> **"Production and Preview"로 등록하면 stg Preview가 그 값을 상속해 운영 DB·운영 알림 채널에 붙는다**
> (실제 발생 — 화면·응답이 정상이라 눈으로 못 잡았고 `/api/health`의 `dbRef` 지문으로 잡았다).
> stg 값은 **`Preview` + `staging` 브랜치 지정**으로 따로 등록(브랜치 지정 값이 일반 Preview 값보다 우선).
> 절차·함정은 [RUNBOOK §3.5.6 및 함정 ③](./STAGING_PROD_RESET_RUNBOOK.md).

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
- 서버 가드 배터리(README "서버 가드 배터리" — ~~순수 4 + 라이브 8~~ → **정정(2026-08-07 실측): 순수 5 + 루프 18**. 루프 중 `_dv_pass`·`_dv_1p1`·`_dv_mail` 3종은 DB 불필요라 "라이브"가 아니다. `_e2e_purchase_live`·`_dv_stgisolation`·`_dv_prodconn`은 체인 밖 온디맨드): 라이브는 dev DB 필요, `tools/_env.ts`가 `.env.development.local` 우선 로드. 임시 PG면 `DATABASE_URL=... npx tsx tools/_dv_*.ts`.

### 2.6 정리
```bash
docker rm -f dev_pg            # 임시 PG 정리(썼다면)
# Expo/next dev는 세션 종료 시 함께 정리
```

---

## 3. 운영(배포) 체인

> 원칙: **스키마 먼저, 코드 다음**(additive 마이그레이션이면 순서 무해하나 습관화). 배포는 되돌리기 쉬워도 DB는 아니다.
> 🔴 **선행**: 유저 데이터·머니패스에 닿는 서버 변경은 `main`에 바로 올리지 않는다 — **§3.6 stg 경유 절차가 먼저**다
> (`main` push = 즉시 운영 배포).

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
- 배포 전 체크: `npx tsc --noEmit`(server) 0 · 서버 가드 배터리 그린 · 새 env 키가 생겼으면 **Vercel 환경변수에 먼저 등록**
  — ~~(Production+Preview)~~ → 🔴 **정정(2026-08-07): 운영 값은 `Production` 전용.**
  "Production and Preview"로 넣으면 **stg Preview가 운영 값을 상속**해 stg 서버가 운영 DB·운영 알림에 붙는다(실제 사고).
  stg에 필요한 값은 **`Preview` + `staging` 브랜치 지정**으로 따로 등록하고, 알림·관측 키는 **빈 값으로 덮어** 끈다.
  → 절차 [RUNBOOK §3.5.6](./STAGING_PROD_RESET_RUNBOOK.md), 사고 경위 = 같은 문서 함정 ③.
- ⚠ `vercel link`/`env pull`은 `.env.local`을 무경고 덮어씀([[vercel-link-clobbers-env]]) — 실행 전 `cp .env.local .env.local.bak`.

### 3.3 배포 후 확인 (스모크)
```bash
curl https://volleyball-jet-nine.vercel.app/api/devnotes     # 새 라우트 200 확인
```
- 실기기(운영 지향 그대로)에서 해당 화면 진입 확인. 관리자 페이지 로그인 → 원격 설정(minVersion·공지·노트)은 **배포 없이** 관리자에서 즉시 운영.
- 문제 시: Vercel 대시보드 롤백(이전 배포로 즉시) — 단 마이그레이션은 롤백 안 되므로 additive 원칙이 보험.

### 3.4 운영 중 일상
- **콘텐츠 운영(배포 불필요)**: 공지(차단성)·개발자 노트/패치노트(읽을거리)·쿠폰·min/latestVersion — 전부 관리자 페이지에서.
- **관측**: 서버 오류는 `reportError` 경유(환경 게이트 — 운영 DSN은 `VERCEL_ENV=production|preview`만, BACKEND §13.21-a). **Discord 알림 전환 절차는 [ANALYTICS_PLAN §7](./ANALYTICS_PLAN.md#7-운영-알림-셋업--discord-연동-사용자-직접-셋업-예정)**(방법 A=Sentry 통합 / B=서버 웹훅 직접 / 크래시는 Crashlytics 별도 / `req.json` 500 백로그). 문의는 관리자 티켓 큐.
- **정기**: 파기 크론(purgeExpired — 보존기간 §13.9), 지갑 대사(라이브 가드 배터리를 운영 DB 겨냥으로 돌릴 땐 `DATABASE_URL=<prod>` 명시 — 테스트 데이터는 프리픽스 자동 정리지만 신중히).

### 3.5 DB 비밀번호 회전 (2026-08-07 확립)

**정책(사용자 결정 2026-08-07): 월 1회 정기 회전 + 유출·사고 시 즉시.** 상시 방어는 회전이 아니라
"값이 새지 않게 다루는 것"이 담당한다(§3.5.3).

#### 3.5.1 순서 — 틀리면 운영이 끊긴다

비밀번호를 리셋하는 순간 **기존 연결이 전부 죽고**, Vercel은 **재배포해야 새 env를 읽는다**(런타임이 아니라
배포 시점 주입). 따라서 `리셋 → env 갱신 → 재배포` 사이가 실다운타임이다. 미리 창을 다 열어놓고 연속으로 친다.

1. Supabase `Database → Settings → Reset password` (운영 ref `vmedwppbpugjnxdfwzoq`)
2. 상단 **Connect** 패널에서 **두 문자열** 복사 — Transaction pooler(**:6543**)와 Session pooler(**:5432**)
3. `server/.env.local` **두 줄 다** 교체: `DATABASE_URL`(6543) · `MIGRATE_DATABASE_URL`(5432)
4. Vercel `DATABASE_URL`(Production 스코프) 갱신 — **연결 문자열 전체**(함정 ①)
5. **Production 재배포** (env만 바꾸면 옛 값이 계속 쓰인다)
6. **검증** — ~~`server/tools/_dv_stgisolation.ts`(stg 쪽)~~
   → **정정(2026-08-07): 그 가드는 운영 DB에 접속하지 않는다**(stg 전용 — A가 깨지면 프로브를 아예 생략한다).
   운영 비밀번호 회전을 검증하려면 **운영을 실제로 때리는 것**만 유효하다. 아래 3개를 순서대로:
   1. **새 배포가 라이브인지** — 운영 `/api/health`의 `commit`이 방금 재배포한 커밋과 일치하고 `dbRef`가
      **운영 지문 `2b73921d4030`** 인지(구 배포가 옛 비밀번호로 떠 있으면 여기서 갈린다 — 함정 ①).
   2. **런타임 경로(6543)** — 운영 `/api/bootstrap` **200**(DB 왕복이 실제로 성공).
   3. **마이그레이션 경로(5432)** — `MIGRATE_DATABASE_URL`로도 접속되는지(런타임이 멀쩡해도 여기만 썩는다 — 함정 ②).
      → **`(cd server && npx tsx tools/_dv_prodconn.ts)`** 로 두 URL 접속을 한 번에 확인
      (온디맨드 — 배터리 체인 밖, 운영 DB 왕복. 읽기 전용이고 값이 아니라 **지문**만 출력한다).
   4. (권장) 운영 주요 테이블 row 수 불변 — 회전이 데이터에 영향을 주지 않았음 확인.

stg도 동일(ref `pdxdpzujeaxjweskecbv`, Vercel은 **Preview/`staging` 브랜치 스코프**, staging 재배포).
stg 쪽 검증은 `_dv_stgisolation.ts` + stg `/api/health` `dbRef 06eb5f60fd04`가 맞다.

#### 3.5.2 실측 함정

**① 🚨 Vercel `DATABASE_URL`에 비밀번호만 넣으면 빌드가 죽는다**
`TypeError: Invalid URL … input: '<비밀번호>'` — Supabase 화면이 비밀번호를 단독으로 보여줘서 그것만 복사하기 쉽다.
**반드시 `postgresql://` 로 시작하는 전체 문자열**을 넣는다. (2026-08-07 운영 빌드 1회 실패. 실패한 빌드는
라이브를 교체하지 않으므로 서비스는 안 죽지만, **옛 비밀번호를 쓰는 구 배포가 계속 떠 있어** DB가 끊긴다.)

**② `MIGRATE_DATABASE_URL`을 같이 안 바꿔서 조용히 썩는다**
런타임은 6543만 쓰므로 **서비스는 멀쩡한데** 다음 스키마 변경 때 `28P01(invalid_password)`로 막힌다.
회전 시 두 줄을 한 세트로 본다. 진단: ~~`_envsafe`로 두 URL 모두 접속 확인~~
→ **정정(2026-08-07): `_envsafe`는 env를 안전하게 *읽는* 로더일 뿐 접속 검사 스크립트가 아니다.**
두 URL 접속 확인은 **`server/tools/_dv_prodconn.ts`** 가 담당한다(`_envsafe`로 값을 읽고
6543·5432 양쪽에 각각 붙어본 뒤 **지문만** 출력 — 값은 절대 에코하지 않는다).

**③ 새 비밀번호를 옛 것의 변형으로 만들면 회전이 아니다**
2026-08-07 실사례 — 유출된 값에서 문자 하나만 뺀 값으로 바꿨고, 그 값이 **stg 비밀번호와도 동일**해져
"stg 크리덴셜 하나로 운영 DB가 열리는" 상태가 됐다. 사용자 판단으로 **현 값 유지 + 월 1회 회전**으로 수용
(유저 2명 시점의 위험 대비 비용 판단). 다음 회전 때 **prod·stg를 서로 다른 무작위 값**으로 끊는다.
> 생성 팁: URL 특수문자(`@ : / ? # % &`)를 뺀 문자셋으로 만들면 연결 문자열 인코딩 사고가 원천 차단된다.

#### 3.5.3 값을 다루는 규칙 (이게 본체다)

비밀번호는 **회전보다 "안 새게 하는 것"** 이 먼저다. 2026-08-07 하루에 3번 샜고 전부 취급 방식 때문이었다.
- **`server/tools/_envsafe.mjs` 를 쓴다.** 임시 스크립트로 env를 정규식 파싱하지 않는다
  (주석 흡수·따옴표 미제거·쉘 source 실패가 각각 원문을 stdout/stderr로 뱉었다 — RUNBOOK §3.5 함정 ④).
- **URL 파서에 시크릿을 그냥 넣지 않는다.** 실패 시 에러 메시지가 input 전체를 출력한다.
- 값을 옮길 땐 **파일 ↔ 클립보드**만. 채팅·로그·커밋 메시지 경유 금지.
- **IDE에서 `.env` 줄을 선택한 채 두지 않는다** — 에디터 선택 영역은 어시스턴트에게 전달된다. 복사 후 선택 해제.
- 비교가 필요하면 값이 아니라 **지문**(`fp()`·`dbRefOf()`)으로 한다.

### 3.6 stg(스테이징) 배포 절차 (2026-08-07 신설 — RUNBOOK S11)

> **왜**: `main` push = **즉시 운영 배포**(Vercel 자동). 실사용자가 있는 지금, 서버 변경을 운영에서 처음 실행하면
> 그게 곧 실험이다. stg는 **같은 코드·같은 플랫폼·다른 DB**에서 먼저 돌려보는 자리다([[stg-is-prod-mirror-gate]]).

**🔴 `staging` 브랜치 경유 필수 — 유저 데이터·머니패스에 닿는 경로**
- `server/app/api/**` (라우트) · `server/lib/**` (지갑·인증·결제·알림) · `server/db/**` (스키마·마이그레이션)

**🟢 `main` 직접 가능**
- 관리자 화면(`server/app/ops-9f3a2c/**`) · 문서(`docs/**`) · 앱 코드(`app/`·`engine/`·`data/` — 서버 무관)

**절차**
```bash
git checkout staging && git merge main          # (또는 staging에서 직접 작업)
# ...변경...
git push origin staging                          # → Vercel Preview 자동배포
curl https://volleyball-git-staging-sonws.vercel.app/api/health   # dbRef 06eb5f60fd04(stg) 확인
# 검증 통과 후
git checkout main && git merge staging && git push origin main    # 머지 = 운영 배포 승인
```

**함정**
- ⚠️ **`server/` 무변경 커밋은 Preview 자체가 안 생긴다.** Vercel 프로젝트가 **Root Directory=`server`** +
  "Skip deployments when there are no changes to the root directory" **Enabled**이라 빌드가 스킵된다
  (브랜치 설정 문제로 오해하기 쉬움 — RUNBOOK 함정 ②). 평시엔 이득(문서·앱만 바꾼 커밋은 서버 재배포 안 함).
- ⚠️ **stg가 운영 DB에 붙어 있지 않은지** 배포 후 `dbRef`로 확인(§0 env 스코프 원칙 · RUNBOOK 함정 ③).
  새 env를 "Production and Preview"로 추가하는 순간 조용히 재발한다.
- ⚠️ stg Preview는 **Vercel Authentication 켜짐**(비공개). 브라우저·앱에서 붙이려면 해제해야 한다.
- 격리 상시 점검: `(cd server && npx tsx tools/_dv_stgisolation.ts)` — **온디맨드**(배터리 밖). 로컬 env만 보므로
  Vercel 스코프는 위 `dbRef` 확인이 담당.

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
