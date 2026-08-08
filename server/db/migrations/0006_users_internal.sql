-- 2026-08-08: users.internal — 내부(운영자·QA·테스터) 계정 표시 컬럼 (BACKEND_SYSTEM §13.30).
-- 목적: 관리자 통계에서 내부 계정을 **기본 제외**해 출시 초기 비율 지표(전환율·리텐션·광고)가
--       개발자 본인 한 계정에 지배당하지 않게 한다(§13.15 "지표 해석 주의"의 코드 장치화).
-- 안전성: Expand-only — NOT NULL + DEFAULT false 라서 기존 행이 즉시 채워지고, 쓰는 쪽이 없으면
--         컬럼이 있어도 동작이 바뀌지 않는다(롤백 = 무시). 게임플레이·재화·결제엔 무관한 집계 필터 축.
-- 멱등: IF NOT EXISTS — 재실행해도 안전.
-- 적용: prod는 MIGRATE_DATABASE_URL(5432) 직결로 이 SQL을 트랜잭션 적용(prod-migration-apply-method).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "internal" boolean NOT NULL DEFAULT false;

-- 통계 라우트가 매 요청 (proj_code, deleted_at IS NULL, internal=false)로 스캔하므로 부분 인덱스로 받쳐둔다.
CREATE INDEX IF NOT EXISTS "users_proj_internal_idx" ON "users" ("proj_code","internal");
