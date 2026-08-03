# STAGING 구축 + 운영 DB 출시 초기화 — 런북 (2026-08-03)

> **목적**: 출시 전에 (1) 현재 운영 DB의 데이터를 **스테이징(stg)에 그대로 복제**해 보존하고,
> (2) **운영 DB의 테스트 데이터를 초기화**해 실사용자가 깨끗한 상태로 시작하게 한다.
> **성격**: 운영 DB 초기화는 **되돌릴 수 없는 1회성 출시 작업**. 반드시 아래 순서·게이트를 지킨다.
>
> **정본 관계**: 연결 규칙은 [BACKEND_SYSTEM §13.7], 운용 절차는 [SERVER_OPS.md]. 이 문서는 그 위의 **1회성 출시 런북**.
>
> ⚠️ **실행 시점**: 이 문서 작성 시점(2026-08-03)엔 **stg 프로젝트가 아직 없다.** 복제本이 곧 백업이므로,
> **stg 생성·복제·검증이 끝나기 전에는 운영을 절대 건드리지 않는다.**

---

## 0. 역할 경계 (반드시)

- 💳 **카드 결제·프로젝트 생성·DB 비밀번호 입력 = 사용자.** (금융·비밀번호 입력은 Claude 금지)
- 🤖 **CLI(덤프·복원·검증·초기화 SQL)·문서·스모크 = Claude.** 단 **운영 초기화 COMMIT 직전 최종 확인은 사용자 명시 승인**.
- 🔒 연결문자열(비밀번호 포함)은 **사용자가 `server/.env.staging`에 직접 붙여넣음** → Claude는 값을 보지도 에코하지도 않는다(셸에서 `grep`으로 변수에 담아 쓰되 출력 금지).

---

## 1. 사전 준비 (🧑 사용자)

1. **Supabase 운영 A → Pro** 전환 (오늘). 연결문자열 불변 = 재배포 불필요.
2. **신규 Supabase 프로젝트 B 생성** = `volleyball-stg`
   - Organization: 운영과 같은 조직(Pro가 조직 단위면 stg도 커버)
   - Region: **운영과 동일**(지연·정합)
   - DB Password: **새 강한 값**(운영과 다르게, 메모)
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

## 4. 롤백 / 복구

- **G4 이전**: 운영 무손상 — 그냥 중단하면 됨.
- **G4 이후 되돌리려면**: `prod_public_backup_20260803.sql`(G1 덤프)을 운영에 복원. 단 초기화 후 유입된 실데이터가 있으면 충돌 — **출시 전, 유입 없을 때만 의미 있음**. 그래서 초기화는 **실오픈 직전**에.
- 덤프 파일과 `prod_counts_before_reset_*.txt`는 **작업 후에도 최소 며칠 보관**.

---

## 5. 안전 원칙 요약

1. 순서 절대 준수: **복제 → 검증 → 백업 → (승인) → 초기화 → 검증**. G2 통과 전엔 운영 안 건드림.
2. 운영 초기화 COMMIT은 **사용자 명시 승인** 후에만.
3. `proj_info`·`server_setting`은 어떤 옵션에서도 **초기화 금지**.
4. `wallet_ledger`·`purchase_event` 초기화는 **출시 전·테스트 데이터 한정 1회성**(실결제 후 불가 — 컴플라이언스).
5. 연결문자열·비밀번호 값은 파일→셸변수로만, **에코·커밋 금지**.
6. stg env엔 결제/알림/관측 키 공란(운영 격리).
