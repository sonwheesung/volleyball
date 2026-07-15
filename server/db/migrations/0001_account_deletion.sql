-- AUTH_SYSTEM §7·§8 (#119·#110) — 계정 삭제(가명처리)·연령 게이트 컬럼 추가(additive only, 멱등).
-- 이 저장소는 `drizzle-kit push`로 provisioning했고, 0000은 그 baseline 위 devnotes만 추가했다(같은 패턴을 따른다).
-- users에 age_confirmed_at 추가 + deleted_at 보강(스키마엔 이미 있으나 옛 push 환경에 없을 수 있어 IF NOT EXISTS로 안전).
-- 운영 DB 안전(prod-schema 주의: 추가만 — NOT NULL·rename·삭제 없음, 롤백 불필요). 재적용해도 실패하지 않는다.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "age_confirmed_at" timestamp with time zone;
