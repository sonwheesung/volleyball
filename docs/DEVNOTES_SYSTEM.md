# DEVNOTES_SYSTEM — 개발자 노트 + 패치노트

> **상태: 설계만(미구현, 2026-07-08).** 이 문서는 마이페이지 "개발자 노트/패치노트" 기능의
> 추후 개발용 설계 정본이다. 코드는 아직 없다. 착수 시 이 문서의 단계(§7)를 순서대로 밟는다.
>
> 정본 관계: 서버·관리자 인프라는 `BACKEND_SYSTEM.md`(특히 §13.11 공지·§13.13 in-app·§13.15 관리자
> 대시보드) 패턴을 그대로 상속한다. 이 문서는 **그 위에 얹는 "읽을거리 콘텐츠" 계층**만 정의한다.
> 수익화·"한 사람이 만드는 게임" 감성 근거는 `MONETIZATION_SYSTEM.md`.

---

## 0. 한 줄 요약

관리자(개발자 본인)가 **관리자 대시보드의 에디터로** 패치노트·개발자 노트를 작성·게시하면,
앱 업데이트 없이 서버에서 내려와 마이페이지에 **읽을거리**로 뜬다. 공지사항(부팅 차단성 안내)과
같은 서버 패턴을 쓰되 **역할이 다르다** — 공지는 "지금 알아야 할 것", 노트는 "읽고 싶으면 읽는 것".

---

## 1. 목적 · 플레이어 경험 (기획 언어)

배구명가는 **한 사람이 만드는 게임**이다(supporter.tsx "한 사람이 만든 배구명가",
MONETIZATION 서포터 감성). 그 관계에서 가장 자연스러운 것은 **개발자↔플레이어의 조용한 소통 채널**이다.

- **패치노트**: "이번 버전에서 뭐가 바뀌었나." 선수가 세월을 쌓듯, 게임 자체도 버전을 쌓으며
  변해간다 — 그 변화를 플레이어가 눈으로 확인하는 창(누적 서사 기둥의 메타 레이어).
- **개발자 노트**: "왜 이렇게 만들었나 / 다음엔 뭘 할까 / 이 시즌을 어떻게 봤나." 밸런스 조정의
  의도, 로드맵 귀띔, 감사 인사 — 서포터 팩의 따뜻한 결을 글로 잇는다. 광고·결제로 얻은
  플레이어에게 "돈 값" 대신 **얼굴 있는 개발자**를 돌려주는 채널.

> **관전형 기둥 준수**: 이 기능은 "매 순간 손이 가게" 만들지 않는다. **무푸시** — 새 글이 올라와도
> 알림을 쏘지 않는다. 앱에 들어와 마이페이지를 볼 때 **조용히 배지로만** 알린다(§3). 강제 관람 없음.
> 읽을거리이지 할 일이 아니다.

---

## 2. 콘텐츠 종류 — 통합 피드 권고

두 종류를 담는다.

| 종류 | 성격 | 버전 태그 | 예 |
|---|---|---|---|
| **패치노트**(`patch`) | 버전별 변경 기록 | **필수**(`appVersion`, 앱 버전과 연동) | "v0.4.0 — 드래프트 라이브 픽 추가, 노쇠 곡선 완만화" |
| **개발자 노트**(`note`) | 자유 글 | 없음(선택) | "오프시즌을 이렇게 설계한 이유", "다음 업데이트 예고" |

### 구분 탭 vs 통합 피드 — **권고: 통합 피드 + 종류 배지 + (선택) 필터 칩**

- **채택안**: 하나의 시간순 피드에 두 종류를 섞어 최신순으로 나열하고, 각 항목에 **종류 배지**
  (📋 패치노트 / ✍️ 개발자 노트)를 단다. 상단에 가벼운 **필터 칩**("전체 · 패치노트 · 개발자 노트")을
  두되 기본은 "전체".
- **근거**:
  1. 발행 빈도가 낮은 **1인 개발** 채널이다. 탭으로 갈라 두 개의 반쯤 빈 목록을 만들 이유가 없다.
  2. 관전형 = **읽을거리 소비**. 시간순 하나의 흐름이 "연대기를 읽는" 경험(뉴스 피드·연표와 같은 결)에 맞는다.
  3. 필터 칩은 "패치노트만 훑고 싶다"는 소수 요구를 **화면 전환 없이** 흡수한다(탭보다 가벼움).
- **기각(구분 탭)**: 종류가 늘거나 발행량이 많아지면 재검토(OPEN Q-1). 지금 규모엔 과설계.

---

## 3. 앱 UX

### 3.1 진입점 (마이페이지)

- `app/(tabs)/mypage.tsx`의 **"자주 보는 것" 그룹**에 `LinkCard` 한 줄 추가 — 공지사항 카드 바로 아래가 자연스럽다.
  - 아이콘 `sparkles-outline`(또는 `newspaper-outline`), title "개발자 노트", sub "패치노트 · 개발 이야기".
  - **안읽음 배지**: LinkCard 우측 화살표 자리에 안읽음 개수 칩(예: 🔴 2). 0이면 배지 없음.
- 상세는 스택 화면 `app/devnotes.tsx`(목록) + `app/devnotes/[id].tsx`(상세) 또는 목록에서 인라인 확장.
  기록(records-archive)처럼 **허브는 가볍게, 본문은 스택**으로 분리하는 마이페이지 관례를 따른다.

### 3.2 목록 / 상세

- **목록**: 최신순 카드. 각 카드 = 종류 배지 + 제목 + (패치노트면) 버전 태그 + 게시일 + 본문 미리보기 1~2줄 +
  안읽음이면 점(dot). 상단 필터 칩(§2).
- **상세**: 제목 + 버전 태그 + 게시일 + **마크다운 렌더 본문**. 마크다운은 경량 렌더러로
  (제목·리스트·굵게·링크·인라인코드 정도 — 뉴스/가이드 화면 수준의 서식). 상세 진입 = 그 글 읽음 처리.

### 3.3 안읽음 배지 (로컬 읽음 처리 — 공지 패턴 상속)

- **읽음 추적은 기기 로컬**. 공지의 `useAuthStore.readAnnouncements` 패턴을 그대로 복제 —
  `readDevnotes: string[]`(persist). 서버에 per-user 읽음 테이블을 두지 않는다(관전형에 맞는 트레이드오프,
  BACKEND §13.13과 동일 논리 — 다기기/재설치 재노출은 의도된 단순화).
- **안읽음 = 게시된 글 id 중 `readDevnotes`에 없는 것.** 마이페이지 진입 시(또는 캐시 로드 시) 계산해 배지 표시.
- **읽음 처리**: 상세 진입 시 그 id를 `markDevnotesRead`. (목록에 "모두 읽음" 액션은 선택 — OPEN Q-4.)
- **prune**: 무한 증가 차단 — **서버 응답이 있을 때만** 현재 게시글 id와 교집합으로 정리
  (`pruneReadDevnotes(activeIds)`). **오프라인(fetch 실패)엔 스킵** — 공지 §13.13 정정(F 라운드)에서 배운
  함정 그대로: 응답 없는데 prune하면 아직 유효한 글 읽음까지 지워져 재노출된다.
- **무푸시**: 배지 외의 어떤 능동 알림도 없다. 부팅 모달로 띄우지 **않는다**(공지와 다른 점 — §5).

### 3.4 오프라인 캐시 (관전 · 시즌 시뮬은 오프라인 동작이 기둥)

배구명가의 게임플레이(관전·시즌 시뮬)는 연결이 끊겨도 캐시로 돈다(CLAUDE §8, BACKEND §2).
개발자 노트도 그 원칙을 따른다 — **읽을거리는 오프라인에서도 보여야** 한다.

- **캐시 우선 렌더**: 마지막으로 성공한 목록 응답을 **AsyncStorage에 캐시**(예: `devnotes.cache.v1`).
  화면 진입 시 **캐시를 먼저 그려** 즉시 읽을 수 있게 하고, **온라인이면 백그라운드로 새로 fetch**해 갱신
  (stale-while-revalidate). 이는 공지(`announcements.tsx`)와의 차이다 — 공지는 오프라인 시 "연결 필요"만
  띄우지만(부팅 게이트 데이터라 신선도 우선), 노트는 **읽을거리라 캐시로 계속 보이는 게 맞다**.
- **본문 캐시**: 목록 응답에 본문(마크다운)까지 담아 한 번에 캐시하면 상세도 오프라인으로 열린다.
  (본문이 커지면 목록=요약 / 상세=개별 fetch로 분리 — OPEN Q-3.) 규모상 지금은 **목록에 본문 포함** 권고.
- **오프라인 표시**: 캐시로 렌더 중이고 갱신 실패면 상단에 조용한 "오프라인 — 저장된 내용" 힌트(선택).
  캐시조차 없으면(설치 후 첫 실행이 오프라인) 공지처럼 "연결 필요" 빈 상태.
- **결정론 격리**: 이 캐시는 **재화·콘텐츠 계층**이다. 세이브(base+currentDay+results)·시드·리플레이와
  완전 무관 — 별도 스토리지 키. 노트를 지우거나 못 불러와도 게임 진행에 0 영향(CLAUDE §8 격리).

---

## 4. 서버 설계 (기존 패턴 상속)

> 원칙: **새 개념을 최소화**한다. 공지(`announcements`)·쿠폰(`coupons`) CRUD와 **똑같은 모양**으로
> 만들어 관리자 대시보드·검증·보관정책이 기존 렌즈로 재사용되게 한다.

### 4.1 테이블 스키마 초안 (`server/db/schema.ts` — `devnotes`)

`announcements` 테이블을 본떠 만든다. projCode FK 스코프(§13.2 멀티게임 격리) 필수.

```ts
// ── 개발자 노트/패치노트(DEVNOTES_SYSTEM) — 공개 GET은 status='published'만. 무푸시 관전형 읽을거리.
export const devnotes = pgTable(
  'devnotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projCode: text('proj_code').notNull().references(() => projInfo.projCode),
    kind: text('kind').notNull(),              // 'patch' | 'note' (앱·admin에서 검증, DB는 text)
    title: text('title').notNull(),
    body: text('body').notNull(),              // 마크다운 원문
    appVersion: text('app_version'),           // 패치노트만 채움(예 '0.4.0'), 노트는 null
    status: text('status').notNull().default('draft'), // 'draft' | 'published'
    publishedAt: timestamp('published_at', { withTimezone: true }), // 게시 순간 세팅(정렬·표시용)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('devnotes_proj_idx').on(t.projCode), index('devnotes_proj_status_idx').on(t.projCode, t.status)],
);
export type Devnote = typeof devnotes.$inferSelect;
```

- **`kind`**: `announcements`엔 없던 필드. `patch`/`note` 구분. DB는 text로 두고 유효값은 라우트에서 강제
  (스키마 확장 없이 종류 추가 가능 — OPEN Q-1 대비).
- **`status` draft/published**: 공지엔 없던 **초안 개념**. 에디터에서 쓰다가 게시 전까지 draft로 두고,
  게시 토글로 published. **공개 API는 published만** 반환(초안 유출 차단).
- **`publishedAt`**: draft→published 전환 순간 세팅. 공개 정렬·"게시일" 표시의 기준(공지의 `startsAt` 유사
  역할이나, 노트는 기간제(endsAt)가 **없다** — 한 번 올린 글은 계속 읽을거리로 남는다. 공지와의 차이).
- **보관정책**: 콘텐츠(개인정보·결제 아님) → `purgeExpired` 파기 대상 **아님**(공지·쿠폰redemption처럼 존치).
  wallet_ledger를 건드리지 않으므로 기본 안전(§13.9 정합). 명시만.

### 4.2 공개 GET API (게시글만)

- `GET /api/devnotes` — **published만**, projCode 스코프, `publishedAt`(없으면 `createdAt`) 내림차순,
  `.limit(N)` 방어(공지 bootstrap의 `.limit(50)` 교훈). 반환: `{ ok, devnotes: [{ id, kind, title, body, appVersion, publishedAt }] }`.
  - **인증**: 공개 읽기 — Bearer 불필요(공지 bootstrap과 동급 공개 콘텐츠). 단 rate limit은 기존 미들웨어 적용.
  - **bootstrap 합류 여부는 OPEN Q-2**. 기본 권고: **별도 라우트**(부팅 페이로드를 안 키움 — 노트는 진입 게이트가 아니라
    마이페이지 진입 시 fetch면 충분). 안읽음 배지도 마이페이지에서 이 라우트로 계산.

### 4.3 관리자 CRUD + 에디터

- **엔드포인트**(전부 `requireAdmin`, 공지 라우트 1:1 복제):
  `POST /api/admin/devnote`(작성=draft 기본) · `GET`(초안 포함 전체 목록, `.limit(200)`) ·
  `PATCH`(제목·본문·kind·appVersion·status 수정 — **게시 토글 포함**) · `DELETE ?id=`(projCode 스코프 + 0건 404, 공지 F1 교훈).
  - 라우트 골격은 `server/app/api/admin/announcement/route.ts`를 그대로 따른다(`isAdmin` 게이트 → `ensureProj`
    → projCode 스코프 insert/update/delete → `reportError` 관측성).
  - **게시 토글**: `PATCH { id, status:'published' }` 시 `publishedAt`이 비어 있으면 그 순간으로 세팅(재게시 시 유지/갱신은 OPEN Q-5).
    `status:'draft'`로 되돌리면 공개 목록에서 사라진다(회수).
  - **검증**: `title`·`body` trim 필수, `kind∈{patch,note}`, `patch`면 `appVersion` 권고(강제 여부 OPEN Q-6).
- **에디터 UI**(`server/app/ops-9f3a2c/page.tsx` — 사이드바 **운영 그룹**에 "노트" 탭 추가, 공지 탭 옆):
  - 목록(행 클릭→모달) 패턴은 공지·쿠폰과 동일(§13.15 UI 개편 — "조회에서 등록 분리").
  - 모달 = **마크다운 에디터**: 좌 textarea(마크다운 작성) / 우 **미리보기**(같은 경량 렌더러) 분할 또는 탭.
    kind 선택(패치/노트), 패치면 appVersion 입력칸, **draft ⇄ published 게시 토글**, 저장/삭제.
  - 저장은 낙관적 반영 금지 — 서버 응답 후 `reload()`(공지·쿠폰 모달 관례).

### 4.4 결정론 격리 (명시)

devnote는 **재화·콘텐츠 계층**이다. 서버 DB의 다른 콘텐츠(공지·쿠폰)와 같은 지위 — **시드/리플레이엔
절대 안 들어간다**(CLAUDE §8, BACKEND §13.2 결정론 격리). 게임플레이(시즌 시뮬)는 로컬 결정론으로 그대로 돌고,
서버는 이 콘텐츠를 저장·배달만 한다. 노트 추가·수정·삭제가 경기 결과·순위·생산에 미치는 영향 = 0.

---

## 5. 기존 시스템과의 관계

### 5.1 공지사항과의 역할 구분 (핵심)

| | **공지사항**(announcements, §13.11·13.13) | **개발자 노트**(devnotes, 이 문서) |
|---|---|---|
| 성격 | **차단성 안내** — 지금 알아야 할 것 | **읽을거리** — 읽고 싶으면 읽는 것 |
| 노출 | **부팅 게이트 모달**(진입 시 안 본 것 자동 표시) | **마이페이지 진입점 + 배지**(능동 표시 없음) |
| 기간 | 기간제(startsAt~endsAt, 만료되면 사라짐) | **영속**(한 번 올리면 계속 남는 읽을거리 = 연대기) |
| 종류 | 단일(제목·본문) | patch/note 2종 + 버전 태그 |
| 초안 | 없음(발행=즉시 노출) | **draft/published**(에디터로 쓰다 게시) |
| 오프라인 | "연결 필요"(신선도 우선) | **캐시로 계속 보임**(읽을거리 우선) |

> 둘 다 서버 관리자 CRUD·projCode 스코프·마크다운/텍스트 본문·무푸시라는 **인프라는 공유**하되,
> **공지 = 알림, 노트 = 콘텐츠**로 UX가 갈린다. 긴급 점검·이벤트 고지는 공지, 패치 요약·개발 이야기는 노트.
> (실무 규칙: "이번 v0.4.0 패치노트"는 노트로, "오늘 20시 서버 점검"은 공지로.)

### 5.2 #46 관리자 대시보드 통계와 동거

- 노트 에디터는 **같은 관리자 페이지**(`server/app/ops-9f3a2c/page.tsx`)의 **운영 그룹** 탭으로 들어간다
  (분석 그룹=통계, 운영 그룹=쿠폰·공지·**노트**·문의·설정 — §13.15 메뉴 IA). 별도 페이지 신설 없음.
- #46 통계와 데이터 결합 없음(노트는 KPI가 아니라 콘텐츠). 단, 확장 시 "노트 열람수" 같은 지표는
  안읽음이 로컬 추적이라 서버에 없다 — 필요하면 별도 telemetry(OPEN Q-7).

### 5.3 앱 버전 연동

- 패치노트의 `appVersion`은 앱의 `Constants.expoConfig.version`(마이페이지 하단 "배구명가 vX" 표시와 동일 출처)과
  **문자열로 연동**한다. 강제 매칭·게이팅은 없다(소프트 업데이트 배너 §13.16과 별개 — 노트는 안내 콘텐츠).
  "지금 내 앱 버전에 해당하는 패치노트 하이라이트" 같은 매칭 표시는 확장 후보(OPEN Q-8).

---

## 6. 파일 (착수 시 신규/수정 예정 — 참고)

- **서버**: `server/db/schema.ts`(devnotes 추가) · `server/app/api/devnotes/route.ts`(공개 GET, 신) ·
  `server/app/api/admin/devnote/route.ts`(CRUD, 신 — announcement 라우트 복제) ·
  `server/app/ops-9f3a2c/page.tsx`(노트 탭·에디터 모달 추가) · 마이그레이션(drizzle generate+migrate — 운영 스키마 주의: 추가만이라 안전).
- **앱**: `lib/server.ts`(`getDevnotes()` 추가) · `app/devnotes.tsx`(목록, 신) · (선택)`app/devnotes/[id].tsx`(상세) ·
  `app/(tabs)/mypage.tsx`(진입 LinkCard + 배지) · `store/useAuthStore.ts`(`readDevnotes`·`markDevnotesRead`·`pruneReadDevnotes` — 공지 패턴 복제) ·
  경량 마크다운 렌더러(뉴스/가이드와 공유 가능하면 재사용).

---

## 7. 단계 분해 + 통과 조건 + 검증 (backend-verify 렌즈)

> 빌드 순서 = **서버 → 관리자 에디터 → 앱 화면**(BACKEND §13.5 "작은 러너블 먼저"). 각 단계 통과 전 다음 단계 착수 금지.
> 검증은 **server 5 렌즈**(backend-verify: auth 귀속·proj 스코프·cap 단위·date-only KST·관측성 money-path)로 본다.

### Phase 1 — 서버(테이블 + 공개 GET + 관리자 CRUD)
- **작업**: `devnotes` 스키마·마이그레이션, `GET /api/devnotes`(published만), `/api/admin/devnote` CRUD.
- **통과 조건**:
  1. 마이그레이션 적용, `devnotes` 존재. projCode FK 걸림.
  2. **공개 GET은 published만** 반환(draft는 절대 안 나옴 — 초안 유출 0). 정렬 publishedAt desc, limit 방어.
  3. 관리자 CRUD 전부 **requireAdmin**(토큰 없이 401), 전부 **projCode 스코프**(POST/GET/PATCH/DELETE), DELETE 0건 404(공지 F1 대칭).
  4. 게시 토글: draft→published 시 publishedAt 세팅되고 그 즉시 공개 GET에 등장. published→draft 시 공개 GET에서 사라짐(회수).
- **검증(backend-verify 렌즈)**:
  - **proj 스코프**: 타 게임 projCode 노트가 우리 GET/DELETE에 안 섞이는지(멀티게임 격리).
  - **auth 귀속**: admin 4개 메서드 401 게이트 라이브 E2E. 공개 GET은 무토큰 200(공지 bootstrap 동급) 확인.
  - **date-only KST**: 노트는 endsAt이 없어 date-only 만료 함정(공지 F5·쿠폰 C2) **미해당** — 그래도
    publishedAt은 timestamptz(자정 함정 없음) 확인만.
  - **관측성**: 모든 라우트 `reportError(e, 'admin/devnote')`. money-path 아님(재화 미변동) — 지갑 원장 무관 확인.
  - 상설 가드: `server/tools/_dv_devnote_live.ts`(공지/쿠폰 `_dv_*_live` 패턴 — published-only·requireAdmin·proj스코프·게시토글 A/B).

### Phase 2 — 관리자 에디터(마크다운 작성/미리보기/게시)
- **작업**: `ops-9f3a2c/page.tsx` 운영 그룹에 "노트" 탭 + 목록 + 행 클릭 모달(마크다운 에디터 + 미리보기 + kind/appVersion + 게시 토글).
- **통과 조건**:
  1. 초안 작성→저장→목록에 draft로 뜸(공개 앱엔 안 보임).
  2. 미리보기가 실제 앱 렌더와 **같은 마크다운 규칙**으로 보임(작성자가 결과를 예측 가능).
  3. 게시 토글로 published, 저장은 서버 응답 후 reload(낙관적 반영 금지 — 공지·쿠폰 관례).
  4. kind=patch면 appVersion 입력칸 노출, note면 숨김.
- **검증**: 라이브로 draft 작성→미공개 확인→게시→공개 GET 등장→수정→회수. tsc(server) 0. UI는 공지/쿠폰 모달과 동형이라 회귀 낮음.

### Phase 3 — 앱 화면(목록/상세 + 배지 + 오프라인 캐시)
- **작업**: `lib/server.getDevnotes`, `app/devnotes.tsx`(+상세), 마이페이지 진입 LinkCard+배지, `useAuthStore` 읽음 3종, 캐시(SWR).
- **통과 조건**:
  1. 마이페이지에서 진입, 최신순 목록, 종류 배지, 필터 칩 동작.
  2. **안읽음 배지** = 게시글 중 미읽음 개수. 상세 진입 시 읽음 처리 → 배지 감소. prune는 온라인 응답 시만(오프라인 스킵).
  3. **오프라인 캐시**: 비행기모드로 진입해도 마지막 캐시가 즉시 렌더(읽을거리 우선). 온라인 복귀 시 백그라운드 갱신.
  4. **무푸시**: 새 글이 있어도 알림/부팅 모달 없음. 배지로만.
  5. **결정론 무영향**: 노트 캐시 삭제·fetch 실패가 세이브/시즌 진행에 0 영향(별도 스토리지 키, 리플레이 무관).
- **검증(독립 검증 렌즈)**:
  - 읽음/prune는 공지(`readAnnouncements`)의 검증 루틴 재사용 — 오프라인 prune 스킵(§13.13 F 라운드 함정) 재현 테스트.
  - 오프라인 캐시: 온라인 fetch→캐시→오프라인 재진입 렌더 A/B.
  - typecheck(app) 0, 마이페이지 스포트라이트/네비 회귀 없음.

---

## 8. OPEN Q (미결정)

1. **종류 확장**: `kind`가 지금은 patch/note 2종. 향후 "이벤트 회고"·"로드맵" 등이 늘면 **통합 피드+칩**을
   유지할지 **구분 탭**으로 전환할지(§2). 발행량이 기준 — 지금은 통합 권고, 재검토 트리거는 "월 5건+ 또는 종류 4+".
2. **bootstrap 합류 여부**: 안읽음 배지 계산을 위해 `/api/bootstrap`에 노트 요약(id·kind·title)을 실을지,
   아니면 **별도 `/api/devnotes`**만 둘지(§4.2). 권고=별도(부팅 페이로드 비대화 방지). 단 "부팅 시 배지 미리 알기"를
   원하면 bootstrap에 **개수만** 얹는 절충안 가능.
3. **본문 캐시 전략**: 목록 응답에 본문 포함(상세도 오프라인) vs 목록=요약·상세=개별 fetch(§3.4). 본문 길이·개수가 기준.
   권고=현 규모 목록에 본문 포함. 노트가 길고 많아지면 분리.
4. **"모두 읽음" 액션**: 목록에 일괄 읽음 처리 버튼을 둘지(§3.3). 배지 nag를 싫어하는 유저 편의 vs 단순성.
5. **재게시 시 publishedAt**: published→draft→published 왕복 시 publishedAt을 **최초값 유지**할지 **재게시 시각으로 갱신**할지
   (§4.3). 갱신하면 목록 최상단으로 다시 올라옴("이 글 다시 봐 주세요") — 의도적 bump로 쓸지 결정 필요.
6. **appVersion 강제 여부**: 패치노트에 appVersion을 **필수**로 할지 권고로 둘지(§4.3). 필수면 "버전 없는 패치노트" 방지,
   권고면 유연. 권고=필수(패치노트의 정의가 버전이므로).
7. **열람 지표**: 노트 열람수/도달률을 서버 telemetry로 볼지(§5.2). 안읽음이 로컬 추적이라 현재 서버엔 데이터 없음.
   1인 채널에 필요성 낮음 — 보류 권고.
8. **내 버전 하이라이트**: "지금 내 앱 버전에 해당하는 패치노트"를 앱에서 강조 표시할지(§5.3). 확장 후보, MVP 제외.
9. **작성 편의**: 마크다운 에디터에 이미지 첨부(스크린샷)를 지원할지. 이미지 = Storage/CDN 필요(현재 Supabase는 DB 호스트로만,
   Storage 미사용 — BACKEND §8/13.7). 텍스트+마크다운 링크로 시작, 이미지 호스팅은 별도 결정.

---

## 9. README 색인 제안 (한 줄 — 실제 편집은 착수 시)

> `docs/README.md` 문서 색인 표에 아래 한 줄을 추가 제안(지금은 편집하지 않음):

```
| [DEVNOTES_SYSTEM](./DEVNOTES_SYSTEM.md) | **개발자 노트/패치노트**(관리자 에디터→서버 원격 콘텐츠, 앱 업데이트 없이 게시) — 통합 피드·안읽음 배지(로컬)·오프라인 캐시·무푸시. 공지(차단성)와 역할 구분. 📋 설계만(미구현, 2026-07-08) | `server/db/schema.ts`(devnotes)·`server/app/api/{devnotes,admin/devnote}/route.ts`·`server/app/ops-9f3a2c/page.tsx`·`app/devnotes.tsx`·`lib/server.ts`·`store/useAuthStore.ts`(예정) |
```
