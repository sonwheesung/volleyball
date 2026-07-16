---
name: deploy-prod
description: 운영(프로덕션) 배포 절차 집행 — 마이그레이션(:5432 직결) 먼저 → Vercel 배포 → 스모크. "운영 배포", "prod 배포", "vercel 배포해줘", "마이그레이션 적용", "서버 배포" 요청 시 호출. 과거 사고 2건(vercel env 덮어쓰기·prod 스키마 파괴 위험)의 사전 체크를 강제한다. 정본 docs/SERVER_OPS.md §3 + BACKEND_SYSTEM §13.7.
---

# deploy-prod — 운영 배포 절차 집행

> **왜**: prod 배포는 실수 비용이 크고 사고 이력이 있다 — ① `vercel link/env pull`이 `.env.local`을
> **무경고 덮어씀**(실사고 2026-07-10, 시크릿 소실) ② 운영 DB 파괴적 스키마 변경(NOT NULL 추가·rename·삭제)은
> 유저 세이브/지갑을 깬다. 이 스킬은 백업→마이그레이션→배포→스모크 순서와 사전 체크를 강제한다.
> 정본: `docs/SERVER_OPS.md` §3(배포 체인) · `BACKEND_SYSTEM.md` §13.7(연결 규칙).

## 사전 체크 (배포 명령 치기 전 — 전부 확인)

1. **env 백업**: `cp server/.env.local server/.env.local.bak-$(date +%y%m%d%H%M)` — vercel CLI가 덮어쓸 수 있는 파일 전부. `vercel env pull`이 필요하면 **별도 경로**로 받는다(`vercel env pull /tmp/env-check`).
2. **스키마 diff 분류**: `drizzle-kit` 마이그레이션 파일을 열어 파괴적 변경 여부 판정 —
   - **additive**(테이블/컬럼 추가·NULL 허용) → 그대로 진행.
   - **파괴적**(NOT NULL 추가·rename·drop·타입 변경) → **Expand/Contract 3단계**로 분할(추가→이중쓰기 배포→회수)하고 사용자에게 계획 확인. 출시 전(유저 0)이면 자유 — 단 "출시 전인가"를 사용자에게 확인.
3. **가드 그린**: 서버 가드 배터리(README "서버 가드 배터리")가 dev에서 전부 exit 0인 상태에서만 배포.
4. **git 클린**: 배포 대상 커밋이 push된 상태(로컬 미커밋 변경이 섞여 배포되지 않게).

## 배포 체인 (순서 고정)

### 1. 마이그레이션 — 배포보다 먼저
```bash
# 운영 Supabase 직결(마이그레이션은 :5432 direct — 풀러 :6543 금지, BACKEND §13.7)
cd /c/project/volleyball/server
DATABASE_URL="<prod direct :5432 URL>" npx drizzle-kit migrate   # push가 아니라 migrate(생성된 파일 적용)
```
- URL은 사용자에게 받거나 Vercel env에서 확인(별도 경로 pull). **URL 파서에 시크릿 값 넣고 에러 출력에 노출 금지.**
- 적용 후 확인: 대상 테이블 `\d` 또는 select 1건.

### 2. Vercel 배포
```bash
cd /c/project/volleyball/server && npx vercel --prod
```
- 첫 링크 상태 확인(`vercel link` 필요 시 — env 백업 선행 재확인).

### 3. 스모크 (배포 직후 필수)
```bash
curl -s https://<prod 도메인>/api/devnotes        # {"ok":true,...}
curl -s https://<prod 도메인>/api/bootstrap?...    # 부팅 게이트 응답(공지·버전 게이트)
# 결제 웹훅 등 머니패스는 dev 가드가 커버 — prod에선 읽기 스모크만(테스트 데이터 오염 금지)
```
- 마이그레이션이 새 라우트/컬럼과 짝이면 그 라우트를 1회 왕복(읽기 전용으로).

### 4. 사후
- 폰(운영 지향 빌드)에서 해당 기능 확인 안내.
- 배포 내용·마이그레이션 파일명을 완료 보고에 명시. `.env.local.bak-*`은 성공 확인 후 정리(즉시 삭제 금지 — 다음 배포까지 보관 권장).

## 금지

- `drizzle-kit push`를 prod에 직접(마이그레이션 파일 없이 스키마 강제 동기화 — dev 전용).
- 스모크 생략 배포. env 백업 없는 vercel link/pull.
