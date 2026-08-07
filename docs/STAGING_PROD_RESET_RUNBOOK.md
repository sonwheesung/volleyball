# STAGING 구축 + 운영 DB 출시 초기화 — 런북 (2026-08-03)

> **목적**: 출시 전에 (1) 현재 운영 DB의 데이터를 **스테이징(stg)에 그대로 복제**해 보존하고,
> (2) **운영 DB의 테스트 데이터를 초기화**해 실사용자가 깨끗한 상태로 시작하게 한다.
> **성격**: 운영 DB 초기화는 **되돌릴 수 없는 1회성 출시 작업**. 반드시 아래 순서·게이트를 지킨다.
>
> **정본 관계**: 연결 규칙은 [BACKEND_SYSTEM §13.7], 운용 절차는 [SERVER_OPS.md]. 이 문서는 그 위의 **1회성 출시 런북**.
>
> ⚠️ **실행 시점**: 이 문서 작성 시점(2026-08-03)엔 **stg 프로젝트가 아직 없다.** 복제本이 곧 백업이므로,
> ~~**stg 생성·복제·검증이 끝나기 전에는 운영을 절대 건드리지 않는다.**~~
> → **정정(2026-08-07): 실제 실행은 이 순서를 따르지 않았다.** 실화폐 결제 0건·실유저 0명을 먼저 확인하고
> **stg 복제를 건너뛴 채 운영 초기화를 먼저 수행**했다(백업은 pg_dump가 아니라 **JSON 655행**으로 갈음 — §4).
> stg는 그 뒤 **빈 DB에서 새로 시작**했다. **아래 §1~§2·G1~G5는 "복제 경유" 원본 계획으로 보존**하고,
> **실제로 일어난 일과 현재 절차는 §3.5(그리고 롤백은 §4)를 정본으로 본다.**

---

## 0. 역할 경계 (반드시)

- 💳 **카드 결제·프로젝트 생성·DB 비밀번호 입력 = 사용자.** (금융·비밀번호 입력은 Claude 금지)
- 🤖 **CLI(덤프·복원·검증·초기화 SQL)·문서·스모크 = Claude.** 단 **운영 초기화 COMMIT 직전 최종 확인은 사용자 명시 승인**.
- 🔒 연결문자열(비밀번호 포함)은 **사용자가 `server/.env.staging`에 직접 붙여넣음** → Claude는 값을 보지도 에코하지도 않는다(셸에서 `grep`으로 변수에 담아 쓰되 출력 금지).

---

## 1. 사전 준비 (🧑 사용자)

1. **Supabase 운영 A → Pro** 전환 (오늘). 연결문자열 불변 = 재배포 불필요.
2. **신규 Supabase 프로젝트 B 생성** = `volleyball-stg`
   - ~~Organization: 운영과 같은 조직(Pro가 조직 단위면 stg도 커버)~~
     → **정정(2026-08-07 실행): 별도 Free 조직 `Vivace Staging`.** Pro는 **조직 단위 과금 + 프로젝트당 컴퓨트 $10**이라
     같은 조직에 만들면 월 $10이 조용히 붙는다(§3.5.4 실측). Free 조직은 무료 — 채택.
   - ~~Region: **운영과 동일**(지연·정합)~~
     → **정정(2026-08-07 실행): `ap-southeast-1`(싱가포르).** 운영은 `ap-northeast-2`(서울)라 **리전이 다르다.**
     stg는 실사용자가 없어 지연이 무관하고, 검증 대상은 스키마·로직이라 정합에도 무해하다고 판단.
   - DB Password: **새 강한 값**(운영과 다르게, 메모)
     → ⚠ **2026-08-07 현재 prod와 stg 비밀번호가 동일**하다(인지·수용된 잔여 위험). 상세·해소 계획은 [SERVER_OPS §3.5.2 함정 ③](./SERVER_OPS.md).
3. **연결문자열 2개**를 `server/.env.staging`의 TODO 두 줄에 직접 붙여넣기
   - `DATABASE_URL=` ← Transaction pooler(**:6543**)
   - `MIGRATE_DATABASE_URL=` ← Session/Direct(**:5432**)
4. **Vercel → Pro**: 앱이 스토어 **승인/오픈되는 시점**에 전환(그전까진 Hobby 무방 — 아직 비상업). 심사가 밤새 승인될 수 있으니 **승인 알림 즉시** 전환.

### 도구 사전 확인 (🤖 Claude, 한 번)
- `pg_dump --version` / `psql --version` 가 **PostgreSQL 15+** 인지 확인(Supabase = PG15/16, 클라이언트가 서버보다 같거나 높아야 함).
  - 없으면 Windows: `winget install PostgreSQL.PostgreSQL` 또는 `npx supabase db dump` 경로 사용.

---

## 2. 실행 순서 (게이트 5개)

```
G1  stg 스키마+데이터 = 운영 복제      →  G2 복제 검증(row 대조)
  →  G3 운영 데이터 스냅샷 백업(카운트+덤프 아카이브)
  →  G4 【사용자 최종 승인】 운영 초기화(TRUNCATE, 트랜잭션)
  →  G5 초기화 검증 + 서버 스모크
```

각 게이트 통과 못 하면 **다음으로 넘어가지 않는다.** G1~G2 실패는 무해(운영 안 건드림). G3~G4가 되돌릴 수 없는 구간.

---

### G1 — 운영 → stg 복제 (백업 겸)

> stg는 **비어 있어야** 한다(별도 `drizzle-kit push` 하지 말 것 — 아래 덤프가 스키마까지 통째로 만든다).
> ⚠ **단서(2026-08-07 추가): 이 "push 금지"는 아래 운영 덤프 복원 경로 한정**이다. 덤프 없이 stg를 새로 세우는
> 경로(= 실제로 채택된 §3.5 경로)에서는 **정반대로 `drizzle-kit push`가 유일한 방법**이다 — 저장소에 0000 이전
> 11개 테이블을 만드는 SQL이 없어 마이그레이션 파일만으로는 빈 DB가 안 선다(함정 ①·§3.5.5-3).

```bash
cd server
# 값은 파일에서 변수로만 — 에코 금지
export PROD_DIRECT="$(grep -m1 '^MIGRATE_DATABASE_URL=' .env.local     | cut -d= -f2- | tr -d '\"')"
export STG_DIRECT="$( grep -m1 '^MIGRATE_DATABASE_URL=' .env.staging   | cut -d= -f2- | tr -d '\"')"

# 1) 운영 public 스키마(스키마+데이터+시퀀스) 덤프 = 이 파일이 곧 백업
pg_dump "$PROD_DIRECT" --schema=public --no-owner --no-privileges \
  -f prod_public_backup_20260803.sql

# 2) stg에 복원
psql "$STG_DIRECT" -v ON_ERROR_STOP=1 -f prod_public_backup_20260803.sql
```

- `prod_public_backup_20260803.sql` = **유일한 복구 수단**. G4 이후에도 **안전한 곳에 보관**(운영 초기화를 되돌릴 유일한 길).
- FK 순서·시퀀스는 pg_dump가 처리. `ON_ERROR_STOP=1`로 하나라도 실패하면 즉시 중단.

### G2 — 복제 검증 (row 수 대조)

```bash
# 양쪽 테이블별 정확 row 수 대조 (approx 아님)
for U in "$PROD_DIRECT" "$STG_DIRECT"; do
  psql "$U" -At -c "
    SELECT string_agg(t.tablename||'='||(xpath('/row/c/text()',
      query_to_xml('SELECT count(*) c FROM public.'||quote_ident(t.tablename), false, true, '')))[1]::text, ' ' ORDER BY t.tablename)
    FROM pg_tables t WHERE t.schemaname='public';"
done
```

- 두 출력이 **테이블별로 동일**해야 통과. 특히 **`wallet_ledger`·`purchase_event`(원장·결제)** 는 눈으로 한 번 더 대조.
- 불일치 → G1 다시. **여기서 막히면 운영은 아직 100% 안전.**

---

### G3 — 운영 데이터 스냅샷 (초기화 직전 마지막 백업)

```bash
# (a) 초기화 대상 테이블의 현재 카운트를 파일로 박제
psql "$PROD_DIRECT" -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;" \
  > prod_counts_before_reset_20260803.txt

# (b) G1의 덤프 파일(prod_public_backup_*.sql)이 아직 있는지 재확인 — 이게 롤백 원본
ls -la prod_public_backup_20260803.sql
```

- **운영 점검모드 ON 권장**: 초기화 중 유저 쓰기 유입 차단. 관리자 페이지(`/ops-9f3a2c`)에서 점검 토글 → `server_setting`. (출시 전이라 유입은 거의 없지만 습관화)
- **대상 실물 확인(“지우기 전에 본다”)**: `SELECT id, created_at FROM users LIMIT 20;` / `SELECT count(*) FROM purchase_event;` — **정말 테스트 데이터뿐인지** 눈으로 확인. 실계정·실결제 흔적이 보이면 **중단하고 사용자에게 보고**.

---

### G4 — 운영 데이터 초기화 【🧑 사용자 최종 승인 필수】

> ⚠️ **되돌릴 수 없음.** 아래 SQL을 실행하기 직전, 사용자가 채팅에서 **명시적으로 "초기화 진행"** 이라고 승인해야 실행한다.
> ⚠️ **컴플라이언스**: `wallet_ledger`·`purchase_event`는 append-only 원장. **실결제가 하나라도 생긴 뒤엔 절대 불가.** 이 작업은 **출시 전 테스트 데이터 한정 1회성**.

**옵션 B — 유저/테스트 데이터만 초기화 (★ 권장, 기본)**
설정(`proj_info`·`server_setting`)과 출시 콘텐츠(공지·개발자노트/패치노트·쿠폰·전체우편)는 **유지**.

```sql
BEGIN;
TRUNCATE TABLE
  public.users,
  public.wallet_ledger,
  public.coupon_redemptions,
  public.tickets,
  public.diagnostic_snapshots,
  public.stats_daily,
  public.purchase_event,
  public.save_backups,
  public.attendance_passes,
  public.mails,
  public.mail_broadcast_receipts,
  public.season_telemetry
RESTART IDENTITY CASCADE;
-- 확인 후:
COMMIT;   -- (문제 있으면 ROLLBACK;)
```

**옵션 A — 설정만 남기고 전부 초기화 (콘텐츠도 삭제)**
공지·개발자노트·패치노트·쿠폰·전체우편까지 지운다(출시용으로 써둔 콘텐츠가 있으면 사라짐 — 신중).
옵션 B 목록에 아래를 추가:

```sql
  , public.announcements
  , public.devnotes
  , public.coupons
  , public.mail_broadcasts
```

> **어떤 경우에도 `proj_info`·`server_setting`은 초기화 금지** — 서버 런타임 설정(점검·버전게이트·프로젝트 등록)이라 지우면 서버가 깨진다.

실행:
```bash
psql "$PROD_DIRECT" -v ON_ERROR_STOP=1 -f reset_prod.sql   # 위 SQL을 파일로
```

### G5 — 초기화 검증 + 서버 스모크

```bash
# 대상 테이블이 0 row인지, 유지 대상은 그대로인지
psql "$PROD_DIRECT" -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"
# 서버 헬스 (설정·콘텐츠 API가 정상 응답하는지)
curl https://volleyball-jet-nine.vercel.app/api/devnotes
```

- 초기화 대상 = 0, 유지 대상(옵션 B면 공지·노트·쿠폰·설정) = 보존 확인.
- 점검모드 켰으면 **OFF**로 복귀.

---

## 3. Phase 2 (별도) — 스테이징 서버 URL 배선

> DB 격리가 끝난 뒤. stg를 실제로 "테스트"하려면 stg DB를 보는 서버 엔드포인트가 필요.

1. `staging` git 브랜치 생성 → Vercel Preview 자동배포.
2. Vercel 대시보드 → 환경변수 **Preview 스코프**에 stg `DATABASE_URL`(:6543) 및 stg 전용 `SESSION_JWT_SECRET`·`ADMIN_TOKEN`·`CRON_SECRET` 등록(🧑 값 입력).
   - **결제/알림/관측 키(RC·Discord·Sentry)는 Preview에 넣지 않음** — stg 테스트가 운영 원장·알림·Sentry로 새지 않게.
3. 내부 테스트용 EAS 빌드에 `EXPO_PUBLIC_SERVER_URL=<stg preview URL>`.
4. ⚠️ `vercel link`/`env pull` 은 `.env.local`을 무경고 덮어씀([[vercel-link-clobbers-env]]) — Preview env는 **대시보드에서 직접**.

---

## 3.5 stg 3종(앱·서버·DB) 구축 실행 계획 (2026-08-07 수립 — 프로덕션 출시 제출 직후)

> **왜 지금인가**: 2026-08-07 프로덕션 출시를 제출하면서 운영이 "실사용자 환경"이 됐다. 이제부터
> 운영에서 직접 실험하면 실유저 데이터·원장·매출 통계가 오염된다. **파괴적 검증(세이브 마이그레이션·
> DB 초기화·결제 웹훅·환불·대량 시뮬)을 안전하게 돌릴 별도 우주**가 필요하다.
> **전제**: Phase 1(G1~G5 운영 초기화)은 2026-08-07 완료 — 단 **stg 복제는 건너뛰고** 바로 초기화했다
> (실화폐 결제 0건·실유저 0명 확인 후 JSON 백업 655행으로 갈음). 따라서 stg는 **빈 DB에서 새로 시작**한다.

### 3.5.1 목표 상태 (완료 정의)

| 층 | prod | stg |
|---|---|---|
| DB | Supabase `volleyball`(ap-northeast-2, **Pro**) | Supabase `volleyball-stg`(동일 리전, **Free 가능**) |
| 서버 | `volleyball-jet-nine.vercel.app` (main 자동배포) | Vercel Preview (`staging` 브랜치 자동배포) |
| 앱 | Play 프로덕션 vc29 (`EXPO_PUBLIC_SERVER_URL`=prod) | 내부 테스트 APK (`…SERVER_URL`=stg Preview URL) |
| 결제 | RC 실연동 | **RC 키 미주입**(결제 비활성 — 원장 오염 차단) |
| 알림 | Discord·Sentry 연결 | **미연결**(운영 알림 채널 오염 차단) |

**통과 조건**: stg 앱에서 로그인→다이아 적립→전지훈련 차감이 **stg DB에만** 기록되고,
prod DB의 `users`·`wallet_ledger` row 수가 **불변**임을 실측(A/B 대조).

#### 🚫 stg는 백업 용도가 아니다 (2026-08-07 사용자 결정)

검토했다가 **채택하지 않은 안**: "매일 00시 운영 데이터를 stg로 복사해 백업으로 쓴다".
기각 근거 3가지 —

1. **재해복구는 이미 커버됨.** 2026-08-07 전환한 **Supabase Pro에 일일 백업 + 7일 로그 보존이 포함**된다
   (결제 화면 실측). 별도 복사본은 DR 관점에서 **중복**이다.
2. **개인정보 복제 위험.** 운영 데이터를 통째로 복사하면 실유저 개인정보가 **별도 조직/환경으로 확산**된다.
   이 프로젝트는 이메일·이름을 애초에 수집하지 않고(§13.9) 텔레메트리도 HMAC 가명화까지 했는데
   ([[telemetry-pseudonymized]]), 백업 복사 하나로 그 최소수집 원칙이 뚫린다(PIPA).
   → 훗날 "실데이터로 마이그레이션 테스트"가 정말 필요해지면 **가명화 복사**로 설계할 것(전체 복사 금지).
3. **도구 부적합 + 용량.** DB 통째 복사는 서버리스(Vercel 크론) 시간제한에 걸린다 —
   필요해지면 **GitHub Actions 스케줄 + pg_dump**가 맞는 도구다. 또 stg는 Free(0.5GB)라 데이터가
   커지면 복사가 실패한다.

> **결론**: stg의 역할은 **파괴적 검증용 빈 환경**이다(세이브 마이그레이션·DB 초기화·결제 웹훅·환불·대량 시뮬).
> 운영 데이터 사본을 두지 않는다.

### 3.5.2 단계별 공수 (실측 기반 추정)

> 총 **약 3.5~5시간**(사용자 대기시간 제외). 대부분 콘솔 클릭이고 코드 변경은 거의 없다.

| # | 단계 | 담당 | 공수 | 비고 |
|---|---|---|---|---|
| S1 | Supabase **prod → Pro 전환** | 🧑 카드 결제 | 10분 | ✅ **완료 2026-08-07** — 실청구 $35(§3.5.4) |
| S2 | Supabase **stg 프로젝트 생성**(`volleyball-stg`) | 🧑 | 15분 | ✅ **완료** — 별도 Free 조직 `Vivace Staging`, ref `pdxdpzujeaxjweskecbv`, **ap-southeast-1(싱가포르)**, PG 17.6 |
| S3 | stg 연결문자열 2개를 `server/.env.staging`에 **직접 붙여넣기** | 🧑 | 5분 | ✅ **완료** — 값은 사용자만 취급(채팅 미경유). 검증은 포트·프로젝트ref만 출력하는 방식으로 |
| S4 | stg DB **스키마 생성** + 시드 | 🤖 | 20분 | ✅ **완료** — 18테이블(prod와 이름 완전 일치) + `proj_info`(volleyball·myword)·`server_setting` 시드. **⚠ 아래 함정 참조** |
| S5 | `staging` 브랜치 생성 + push → Vercel Preview 자동배포 확인 | 🤖 | 15분 | ✅ **완료** — `server/` 건드리는 커밋 필요(함정 ②). stg 주소 `volleyball-git-staging-sonws.vercel.app` |
| S6 | Vercel **Preview 스코프 env** 등록(stg DB·JWT·ADMIN·CRON) | 🧑 값 입력 | 20분 | ✅ **완료** — 12개를 **Preview + `staging` 브랜치 지정**으로. **아래 §3.5.6 방식·함정 ③④ 참조** |
| S7 | stg 서버 **스모크**(`/api/devnotes`·`/api/bootstrap` 200) | 🤖 | 10분 | ✅ **완료** — `/api/health` 200(dbRef=stg)·`/api/bootstrap` 200(공지 `[]` = 운영과 다른 DB) |
| S8 | **격리 검증**(stg 쓰기 → prod row 수 불변 A/B) | 🤖 | 30분 | ✅ **완료 2026-08-07** — §3.5.7 실측표 + 상비 가드 `_dv_stgisolation` 등재(A/B 자가검증 통과) |
| S9 | stg 앱 빌드(`EXPO_PUBLIC_SERVER_URL`=stg, RC/AdMob 키 공란) | 🤖 빌드 | 40분 | ⚠️ **아래 3.5.3 결정 필요** |
| S10 | 실기기 설치 + E2E(로그인→쿠폰→전지훈련) | 🧑🤖 | 30분 | stg DB에만 기록되는지 눈확인 |
| S11 | 문서화(SERVER_OPS에 stg 배포 절차 추가 + 가드 등재) | 🤖 | 20분 | ✅ **완료 2026-08-07** — [SERVER_OPS](./SERVER_OPS.md) §0 세 환경 매트릭스 + §3.6 stg 배포 절차 신설, 가드 `_dv_stgisolation` 등재(README 검증 루틴, 배터리 밖·온디맨드) |

#### ⚠️ S4·S5 실행 중 발견한 함정 2건 (2026-08-07 실측)

**① 빈 DB에는 마이그레이션 파일이 아니라 `drizzle-kit push`를 써야 한다**
S4 계획은 "마이그레이션 0000~0005 순차 적용"이었으나 **그대로 하면 실패한다.**
`db/migrations/0000_add_devnotes.sql` 주석이 근거 — *"이 저장소는 그간 `drizzle-kit push`로 스키마를
provisioning했고 마이그레이션 이력이 없다(첫 이력) … 이미 push로 존재하는 11개 테이블은 건드리지 않고
devnotes만 추가한다"*. 즉 **0000 이전 11개 테이블(users·wallet_ledger 등)을 만드는 SQL이 어디에도 없다.**
빈 DB에 파일만 돌리면 FK 참조 대상이 없어 깨진다.
→ **빈 DB 프로비저닝 = `drizzle-kit push`**(스키마 정의에서 직접 생성), **기존 DB 변경 = 마이그레이션 파일.**
   두 경로가 다르다는 것을 혼동하지 말 것([[prod-migration-apply-method]]의 prod push-스타일과 같은 뿌리).
   실행: `cd server && DATABASE_URL="$(node -e '…_envsafe로 읽기…')" npx drizzle-kit push --force`
   (`drizzle.config.ts`가 `DATABASE_URL`을 읽으므로 stg env 주입으로 대상이 정해진다 — 주입 전 ref 대조 필수)
   > 🚫 ~~`set -a && . ./.env.staging && set +a`~~ **금지(2026-08-07 사고)**: 값에 `#`·괄호 등이 있으면
   > **쉘 파서가 실패하며 그 줄 전체를 stderr로 출력한다 — 비밀번호가 그대로 로그에 남는다.**
   > env는 반드시 `server/tools/_envsafe.mjs`로 읽는다(함정 ④).
**시드 필수**: 모든 테이블이 `proj_code` FK로 `proj_info`에 묶여 있어 **시드 없으면 전 라우트 500.**
   `proj_info`에 `volleyball`·`myword` 2행 + `server_setting`에 `volleyball` 1행(prod와 동일 구성).

**② `staging` 브랜치를 push해도 Preview가 안 생긴다 — 브랜치 설정 문제가 아니다**
Vercel 프로젝트가 **Root Directory=`server`** 이고 **"Skip deployments when there are no changes to the
root directory or its dependencies" = Enabled**. `staging`을 `main`에서 그대로 따서 push하면 `server/` 변경이
0이라 **빌드 자체가 스킵된다.** Environments 설정은 정상이었다(Production=`main` / Preview=`All unassigned
git branches`, Ignored Build Step=Automatic).
→ **Preview를 띄우려면 `server/`를 건드리는 커밋이 필요하다.**
→ 이 규칙은 평시엔 이득이다(문서·앱만 바꾼 커밋은 서버를 재배포하지 않는다). 배포 브랜치 정책은
   [[branch-deploy-flow]] 참조 — **`main` push = 즉시 운영 배포**이므로 유저 데이터·머니패스에 닿는
   `server/app/api`·`server/lib`·`server/db` 변경은 반드시 `staging`을 경유한다(관리자 화면·문서는 예외).

**③ 🚨 Preview는 기본적으로 운영 env를 상속한다 — stg 서버가 운영 DB에 붙는다**
프로젝트 env 18개 중 대부분이 **"Production and Preview"** 스코프였다(`DATABASE_URL` 포함).
즉 **staging Preview가 뜨는 순간 운영 DB에 연결된 채로 동작한다.** 화면·응답은 정상이라 눈으로는 못 잡는다.
실측: 첫 Preview의 `/api/health` → `dbRef 2b73921d4030`(= 운영). 앱 미연결 상태여서 오염은 0이었다.
→ **해결: 같은 키를 `Preview` + `staging` 브랜치 지정으로 덮어쓴다**(브랜치 지정 값이 일반 Preview 값보다 우선).
   운영 변수는 **건드리지 않는다** — Sensitive 변수는 편집 화면에서 값이 비어 보여서, 스코프만 바꾸려다
   **빈 값으로 저장해 운영을 끊을 위험**이 있다. 덮어쓰기 방식이면 운영 변수를 열 필요조차 없다.
→ **stg를 만들면 반드시 이 검사를 먼저 한다.** 오라클은 §3.5.7.

**④ 🚨 env 값을 임시 스크립트로 파싱하면 시크릿이 샌다 (하루에 3번 재발)**
① 쉘 `. ./.env.staging` → 파싱 실패 시 줄 전체 stderr 출력 ② 인라인 주석(` # …`)을 값으로 흡수 → URL
인코딩 후 파싱 실패 → 노출 ③ 값이 `"…"`로 감싸진 걸 안 벗김 → `new URL()` 실패 → **에러가 input 전체를 출력**.
근인은 전부 "임시 스크립트를 매번 새로 짜다가 방어를 빠뜨림".
→ **`server/tools/_envsafe.mjs`를 만들어 방어를 한 곳에 모았다.** env 값을 다루는 코드는 예외 없이 이걸 쓴다:
   `readEnv(path)`(주석 분리+따옴표 제거) · `withSecret(v, fn)`(예외에서 **코드/이름만** 남기고 원문 차단) ·
   `fp(v)`/`dbRefOf(url)`(값 대신 지문). 직접 정규식 파싱 금지.

### 3.5.6 Vercel Preview env를 거는 실제 방법 (2026-08-07 확립)

1. `Settings → Environment Variables → Add Environment Variable`
2. **Environments = `Preview` 만**(Production 체크 해제) → **Select a Custom Preview Branch → `staging`**
3. **Key 입력창에 `.env` 블록을 통째로 붙여넣으면** Vercel이 자동으로 여러 항목으로 쪼갠다(12개를 한 번에).
4. **빈 값은 유효하며, "그 기능을 stg에서 끈다"는 뜻으로 쓴다** — 코드가 빈 값을 안전한 no-op로 처리하는 걸 확인함:
   `notify.ts postDiscord` = `if (!url) return` · `sentryGate` = 빈 DSN이면 `false` · `ratelimit.ts` = 미설정 시
   `{ok:true}`(fail-open).
   ~~따라서 `DISCORD_WEBHOOK_URL`·`SENTRY_DSN`·`KV_*`·`REDIS_URL`을 빈 값으로 덮어쓴다.~~
   → **정정(2026-08-07 코드 실측): 키 목록이 틀렸다.** 실제로 코드가 읽는 키는 아래가 전부다.

   | 계열 | stg에서 빈 값으로 덮을 키 | 근거(코드) |
   |---|---|---|
   | 디스코드 **3종** | `DISCORD_WEBHOOK_URL`(결제·폴백) · `DISCORD_TICKET_WEBHOOK_URL`(문의) · `DISCORD_SIGNUP_WEBHOOK_URL`(가입) | `server/lib/notify.ts` — 문의·가입은 전용 키 없으면 **`DISCORD_WEBHOOK_URL`로 폴백**하므로 폴백 키만 비워도 새지 않지만, 셋 다 비워 의도를 명시한다 |
   | 디스코드 **동적** | `DISCORD_TICKET_WEBHOOK_URL_<PROJ>`(예: `…_MYWORD`) | `server/app/api/ticket/anon/route.ts` — proj별 채널. **프로젝트가 늘 때마다 키가 늘어난다** |
   | Sentry | `SENTRY_DSN` | `server/lib/sentryGate.ts`(빈 DSN → `false`) |
   | 레이트리밋 | `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` **또는** `KV_REST_API_URL`/`KV_REST_API_TOKEN` | `server/lib/ratelimit.ts` — 두 이름 체계를 **모두 인식**(Vercel KV 통합 프리픽스에 따라 갈림) |
   | ~~`REDIS_URL`~~ | **해당 없음 — 코드가 읽지 않는다** | grep 결과 참조 0건. Vercel KV 통합이 만들어 놓은 키일 뿐이라 덮어도 무의미 |

   > 🔑 **규칙(앞으로)**: **운영에 새 알림·관측·레이트리밋 키를 추가하면, 같은 키를 stg(Preview/`staging`)에도
   > 빈 값으로 함께 등록한다.** 안 하면 그 키만 운영 값을 상속해 **stg 테스트가 운영 채널로 샌다**(함정 ③의 재발 형태).
   >
   > **현재 상태(2026-08-07 실측)**: Vercel에 `DISCORD_TICKET_WEBHOOK_URL`·`DISCORD_SIGNUP_WEBHOOK_URL`·
   > `UPSTASH_*`가 **아직 없어서** 지금은 새지 않는다. 즉 이건 **현재 사고가 아니라 미래 함정**이다 —
   > 그 키들을 운영에 붙이는 순간(문의/가입 채널 분리·레이트리밋 활성화) 이 규칙을 반드시 같이 집행할 것.
5. `RC_*`(결제)는 원래부터 `Production` 전용이라 stg엔 부재 — 별도 조치 불필요(결제 테스트 시 stg용 RC 앱 필요).
6. **시크릿은 운영과 절대 공유하지 않는다.** JWT를 공유하면 stg에서 발급한 토큰이 운영에서도 유효해진다.
   등록 전 `fp()` 지문으로 prod↔stg가 서로 다른지 대조할 것.

> ⚠️ **자리표시자 함정**: `.env.staging`에 `stg-admin-token-REPLACE-min-16-random` 같은 **사람이 읽히는 더미**가
> 남아 있었고, "TODO로 시작하는지"만 보던 검사를 통과해 Vercel까지 갈 뻔했다(저장 직전 발견). 보호를 푼 stg에
> 그대로 올라갔다면 **누구나 그 문자열로 관리자 콘솔에 들어온다.** 판정은 접두어가 아니라
> **`TODO|REPLACE|CHANGE|EXAMPLE|YOUR` 포함 여부 + 길이 24자 미만 + `-secret-`류 패턴**으로 한다.

### 3.5.7 격리 검증 실측 (S8 통과 — 2026-08-07)

**오라클**: `/api/health`가 `DATABASE_URL`의 **호스트만** sha256 앞 12자로 반환(`dbRef`). 공개 라우트라
원문은 못 싣지만 **"stg와 prod가 같은 DB인가"는 비교만으로 판정**된다. 기준값 `prod 2b73921d4030` / `stg 06eb5f60fd04`.

| 단계 | 결과 |
|---|---|
| env 등록 전 stg `/api/health` | `dbRef 2b73921d4030` → **운영 DB** 🚨 |
| env 등록 + 재배포 후 | `dbRef 06eb5f60fd04` → **stg DB** ✅ |
| stg `/api/bootstrap` | `announcements: []` (운영엔 출시 공지 1건) — 독립 2차 증거 |
| **쓰기 A/B** — stg에 익명 문의 1건 POST | 운영 `tickets` **1 → 1(불변)**, 내용도 그대로 / stg `tickets` **0 → 1** ✅ |
| 운영 타 테이블 | `users=2`·`wallet_ledger=12`·`purchase_event=15` **전부 불변** ✅ |
| 사후 | stg 시험 데이터 삭제 → `tickets=0 users=0` 복원 |

> 읽기만으로는 "쓰기도 격리됐다"를 증명하지 못하므로 **실제 INSERT를 일으켜** 확인했다(추정 금지 원칙).
> 익명 문의 라우트의 필드명은 `proj`·`content`(❌`projCode`·`message`)이고, `volleyball`은 allowlist에 없어
> 404가 정상이다 — `myword`로 보내야 통과한다.

**상비 가드 `server/tools/_dv_stgisolation.ts`** (✅ 등재 2026-08-07) — `npx tsx tools/_dv_stgisolation.ts`
격리는 한 번 확인하고 끝나는 게 아니라 **조용히 깨진다**(새 env를 "Production and Preview"로 추가하는 순간 재발).
검사: **A** DB 호스트 분리 · **B** 시크릿 분리(JWT 공유 시 stg 토큰이 운영에서 유효) · **C** 자리표시자 잔존 ·
**D** 연결 포트가 운영과 동형(6543) · **E** stg DB 실접속(18테이블·`proj_info` 시드).
- **A/B 자가검증 완료**: DATABASE_URL을 운영 값으로·ADMIN_TOKEN을 자리표시자로 변이 주입 → 각각 FAIL·exit 1, 원복 후 PASS.
- 변이 실행 중 발견해 고친 것: **A가 깨진 상태에서 E가 그대로 운영 DB에 접속**했다(읽기 전용이라 무해했으나
  격리 가드가 운영을 건드리는 건 원칙 위반). 이제 A 실패면 프로브를 생략하고 종료한다.
- **한계**: 이 가드는 **로컬 env 파일만** 본다. Vercel 대시보드 스코프는 못 본다 —
  배포된 stg의 `/api/health` `dbRef`로 확인해야 하며, 가드가 그 기대값을 출력해 준다.

### 3.5.3 ⚠️ 설계 갈림길 — stg 앱을 어떻게 만들 것인가 (착수 전 결정 필수)

`EXPO_PUBLIC_*`는 **빌드타임 인라인**이라 런타임 전환이 불가능하다. 세 가지 안:

| 안 | 방법 | 장점 | 단점 |
|---|---|---|---|
| **A. 별도 APK**(권장) | `preview` 프로파일 + `EXPO_PUBLIC_SERVER_URL`=stg로 APK 빌드, 사이드로드 | prod 앱과 **완전 분리**(동시 설치 가능하려면 applicationId suffix 필요) | 빌드 1회 ~30분, 매번 재빌드 |
| B. dev 서버 재포인트 | Expo Go + `EXPO_PUBLIC_SERVER_URL` 오버라이드 | 즉시·무빌드 | **네이티브(결제·광고·구글로그인) 테스트 불가** — Expo Go 한계 |
| C. 런타임 토글 | 앱 내 개발 화면에서 서버 URL 전환 | 빌드 1개로 양쪽 | **운영 빌드에 서버 전환 코드가 들어감**(보안·오조작 위험). `DEV_TOOLS` 게이트 필수 |

> **권장 = A + B 병행**: 일상 개발은 B(빠름), 네이티브 검증은 A(정확). C는 운영 빌드 오염 위험이라 채택하지 않는다.
> A 채택 시 **applicationId suffix**(`com.son0925.volleyball.stg`) 결정 필요 — 안 붙이면 prod 앱을 덮어써서
> 실기기에서 둘 중 하나만 설치된다. suffix를 붙이면 **구글 로그인 OAuth 클라이언트·AdMob 앱 ID를 stg용으로
> 따로 만들어야** 하므로 공수 +1~2시간. **일단 suffix 없이(덮어쓰기 감수) 시작하고, 필요해지면 분리**를 권장.

### 3.5.4 비용 (2026-08-07 결제 화면 실측으로 정정)

> ~~Supabase prod Pro $25 + stg Free $0 = 증가분 +$25~~ → **틀렸다.** 결제 화면 실측:
> **Pro 요금제는 조직 단위**이고 **"First project included. Additional projects cost $10+/month
> regardless of activity"** — 즉 **Pro 조직 안의 프로젝트마다 컴퓨트가 과금**된다(활동량 무관).

**실측 청구 내역(2026-08-07, Pro 전환 시점 — 기존 프로젝트 2개 보유)**

| 항목 | 월 비용 |
|---|---|
| Pro Plan | $25 |
| Compute — `volleyball` (Micro) | $10 |
| Compute — `common-server` (Micro) | $10 |
| Compute Credits (Pro 포함분) | **−$10** |
| **소계** | **$35** |

**stg를 어디에 만드느냐로 총액이 갈린다**

| 방식 | 월 총액 | 비고 |
|---|---|---|
| Pro 조직에 `volleyball-stg` 추가 | **$45** | 프로젝트 1개당 +$10(유휴여도 과금) |
| **별도 Free 조직에 `volleyball-stg`** ← 채택 | **$35** | 증가분 0. 연 $120 절감 |

> **별도 Free 조직 근거**: Supabase는 계정당 조직을 복수로 만들 수 있고 **Free 조직은 무료**다.
> stg는 실사용자가 없어 Free 한도(0.5GB·동시접속) 안에서 충분하다.
> **대가**: Free는 **1주 미사용 시 자동 일시정지**(재개는 대시보드 클릭 1회) · Free 조직당 프로젝트 2개 한도.
> → S2 절차 정정: stg 생성 전에 **"New organization"(Free 플랜)부터 만들고** 그 안에 프로젝트를 생성한다.
> 기존 Pro 조직에 바로 만들면 월 $10이 조용히 붙는다.

> **결제 주체**: 2026-08-07 시점 수익 0이라 **개인 명의로 결제**(business 미연결). 사업자 연결은 나중에
> 결제 정보에서 추가 가능 — 매출 발생 후 경비 처리 필요해지면 전환([[developer-brand-vivace]]).
> 이 성가심이 크면 stg도 Pro(+$25)로 올릴 수 있으나 **초기엔 Free 권장**.

### 3.5.5 리스크 · 함정

1. **env 덮어쓰기 사고 재발**([[vercel-link-clobbers-env]]) — `vercel link`/`env pull`을 **절대 실행하지 않는다**. Preview env는 대시보드에서만.
2. **stg가 운영 원장·알림으로 새는 것** — RC·Discord·Sentry 키를 Preview 스코프에 **넣지 않음**(§2 원칙 6). S8 격리 검증으로 실측 확인.
3. **마이그레이션 순서** — ~~stg는 빈 DB라 0000부터 순차 적용.~~
   → **정정(2026-08-07 실측, 함정 ①): 빈 DB에 마이그레이션 파일을 순차 적용하면 실패한다.**
   갈림길은 "빈 DB냐 기존 DB냐"다:
   - **빈 DB 프로비저닝 = `drizzle-kit push`** (스키마 정의에서 직접 생성). 0000 이전 11개 테이블 생성 SQL이
     저장소에 없어 파일 경로로는 FK가 깨진다(근거: `server/db/migrations/0000_add_devnotes.sql` 헤더 주석).
   - **기존 DB 변경 = 마이그레이션 파일**(`generate`+`migrate`). 운영은 추적 테이블이 없는 push 스타일이라
     누락 SQL 직접 적용 방식([[prod-migration-apply-method]]) — **혼동 금지**.
4. **stg DB 비번 노출 금지** — `.env.staging`에 사용자가 직접 붙여넣고, 셸에서는 변수로만 참조·에코 금지(§0).
5. **`proj_info` 시드 누락** — 모든 테이블이 `proj_code` FK라 시드가 없으면 서버가 전부 500. S4에 명시 포함.

---

## 4. 롤백 / 복구

- **G4 이전**: 운영 무손상 — 그냥 중단하면 됨.
- ~~**G4 이후 되돌리려면**: `prod_public_backup_20260803.sql`(G1 덤프)을 운영에 복원.~~
  → **정정(2026-08-07): 그 덤프 파일은 존재하지 않는다.** 실행 환경에 `psql`/`pg_dump`가 없어 G1 경로를 타지
  않았고(§3.5 전제), 백업은 **서버 드라이버(postgres.js)로 테이블별 JSON을 떠서** 갈음했다.
- **실제 복구 산출물 (2026-08-07 초기화의 유일한 원본)**
  - **형식**: 테이블당 JSON 1개, **18파일 · 총 655행**(실측 재확인 2026-08-07: `users` 42 · `wallet_ledger` 215 ·
    `purchase_event` 341 · `tickets` 12 · `save_backups` 6 · `coupons` 8 · `coupon_redemptions` 5 ·
    `stats_daily` 14 · `diagnostic_snapshots` 7 · `announcements` 1 · `devnotes` 1 · `proj_info` 2 ·
    `server_setting` 1 · 나머지 5테이블 0행).
  - **경로(정본)**: **`C:\project\_backups\prod_backup_260807\`** — ✅ 영구 보관으로 이전 완료(2026-08-07).
    **리포지토리 밖**이라 실유저 데이터가 커밋될 위험이 구조적으로 없다. 이전 후 18파일·655행 재검증 통과.
  - ~~원본 위치: 세션 스크래치패드(`…\Temp\claude\…\scratchpad\prod_backup_260807\`)~~ →
    🚨 **그 경로는 OS 임시 디렉터리라 휘발성이다**(세션 정리·재부팅·디스크 정리로 소멸). 위 영구 경로를 쓴다.
    둘 다 사라졌다면 복구 수단은 **Supabase Pro 일일 백업**(2026-08-07 전환, §3.5.1-1)뿐이다.
  - **무결성 확인법**(복구 전 필수): 18파일 전부 `JSON.parse` 성공 + 합계 655행.
    `attendance_passes`·`mails`·`mail_broadcasts`·`mail_broadcast_receipts`·`season_telemetry` 5개는 **0행이 정상**(2B 빈 배열).
  - **복원 방법**: SQL 덤프가 아니므로 `psql -f`로는 못 넣는다. FK 순서대로(`proj_info` → `users` → 나머지)
    드라이버로 재삽입해야 한다(`coupons.target_user_id → users` FK 주의 — 실행 중 발견된 CASCADE 함정과 같은 뿌리).
  - 단 초기화 후 유입된 실데이터가 있으면 충돌 — **출시 전, 유입 없을 때만 의미 있음**.
- ~~덤프 파일과 `prod_counts_before_reset_*.txt`~~ → **정정: 위 JSON 18파일**이 그 역할을 겸한다(카운트도 파일에서 산출 가능).
  **작업 후에도 최소 며칠 보관** — 위 휘발성 경고 참조.

---

## 5. 안전 원칙 요약

1. 순서 절대 준수: **복제 → 검증 → 백업 → (승인) → 초기화 → 검증**. G2 통과 전엔 운영 안 건드림.
2. 운영 초기화 COMMIT은 **사용자 명시 승인** 후에만.
3. `proj_info`·`server_setting`은 어떤 옵션에서도 **초기화 금지**.
4. `wallet_ledger`·`purchase_event` 초기화는 **출시 전·테스트 데이터 한정 1회성**(실결제 후 불가 — 컴플라이언스).
5. 연결문자열·비밀번호 값은 파일→셸변수로만, **에코·커밋 금지**.
6. stg env엔 결제/알림/관측 키 공란(운영 격리).
