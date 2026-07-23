-- ATTENDANCE_PASS_SYSTEM §2.4 — 출석 패스 엔타이틀먼트 테이블(Expand-only).
-- 주: 이 마이그레이션은 attendance_passes만 담는다. generate가 베이스라인 드리프트로 save_backups·users.age_confirmed_at도
--     함께 진단했으나, 그 둘은 이미 dev/prod에 push로 적용된 선존 객체라 여기서 제외(prod에 이 파일 적용 시 기존 객체와
--     충돌 방지). meta/0002 스냅샷은 전체 현행 상태를 정확히 담아 이후 generate diff는 정상.
CREATE TABLE "attendance_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proj_code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"store_txn_id" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"queued_after" uuid,
	"purchased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_passes" ADD CONSTRAINT "attendance_passes_proj_code_proj_info_proj_code_fk" FOREIGN KEY ("proj_code") REFERENCES "public"."proj_info"("proj_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_passes" ADD CONSTRAINT "attendance_passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passes_proj_txn_uniq" ON "attendance_passes" USING btree ("proj_code","store_txn_id");--> statement-breakpoint
CREATE INDEX "passes_proj_user_idx" ON "attendance_passes" USING btree ("proj_code","user_id");
