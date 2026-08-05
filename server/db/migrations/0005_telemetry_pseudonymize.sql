-- 2026-08-05: season_telemetry 가명화 — userId FK 제거 → analytics_id(HMAC 파생) 저장.
-- 목적: 텔레메트리를 계정(users)과 직접 연결하지 않아 개인정보에서 제외(PIPA 가명정보 §28-2 통계 목적).
--       탈퇴 파기와의 결합도 소멸(여기 userId 없음). 코호트 추이는 안정 가명 id로 유지.
-- 주의: 비공개 테스트 단계라 기존 텔레메트리 행은 폐기(userId→analytics_id 백필 불필요 — 분석 데이터 disposable).
--       DROP COLUMN user_id 시 FK 제약(season_telemetry_user_id_users_id_fk)도 함께 제거됨.
TRUNCATE TABLE "season_telemetry";
DROP INDEX IF EXISTS "season_telemetry_proj_user_season_uniq";
DROP INDEX IF EXISTS "season_telemetry_proj_user_idx";
ALTER TABLE "season_telemetry" DROP COLUMN IF EXISTS "user_id";
ALTER TABLE "season_telemetry" ADD COLUMN "analytics_id" text NOT NULL;
CREATE UNIQUE INDEX "season_telemetry_proj_aid_season_uniq" ON "season_telemetry" ("proj_code","analytics_id","season");
CREATE INDEX "season_telemetry_proj_aid_idx" ON "season_telemetry" ("proj_code","analytics_id");
