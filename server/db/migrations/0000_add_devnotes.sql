-- DEVNOTES_SYSTEM — 개발자 노트/패치노트 테이블 추가(additive only).
-- 이 저장소는 그간 `drizzle-kit push`로 스키마를 provisioning했고 마이그레이션 이력이 없다(첫 이력).
-- 스냅샷(meta/0000_snapshot.json)은 현 스키마 전체(12테이블)를 baseline으로 담아 향후 generate 비교의 기준이 되지만,
-- 이 SQL은 **이미 push로 존재하는 11개 테이블은 건드리지 않고 devnotes만 추가**한다(운영 DB 안전 — prod-schema 주의: 추가만).
-- IF NOT EXISTS / DO 가드로 멱등 — 이미 devnotes가 있어도(재적용) 실패하지 않는다.
CREATE TABLE IF NOT EXISTS "devnotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proj_code" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"app_version" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "devnotes" ADD CONSTRAINT "devnotes_proj_code_proj_info_proj_code_fk" FOREIGN KEY ("proj_code") REFERENCES "public"."proj_info"("proj_code") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devnotes_proj_idx" ON "devnotes" USING btree ("proj_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devnotes_proj_status_idx" ON "devnotes" USING btree ("proj_code","status");
