-- MAILBOX_SYSTEM §3 — 우편함(mails + mail_broadcasts + mail_broadcast_receipts). Expand-only.
-- 0002 패턴(clean 수기 파일): 이 마이그레이션은 우편 3테이블만 담는다(generate 베이스라인 드리프트 회피).
-- 재화·전달 레이어 — 시드/리플레이/세이브 무접촉(§2). 모든 테이블 proj_code FK(§13.2 멀티게임 격리).
CREATE TABLE "mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proj_code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"idem_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"attach_type" text DEFAULT 'diamonds' NOT NULL,
	"attach_amount" integer,
	"sender" text DEFAULT 'admin' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"recalled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proj_code" text NOT NULL,
	"idem_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"attach_type" text DEFAULT 'diamonds' NOT NULL,
	"attach_amount" integer,
	"sender" text DEFAULT 'admin' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_broadcast_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proj_code" text NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mails" ADD CONSTRAINT "mails_proj_code_proj_info_proj_code_fk" FOREIGN KEY ("proj_code") REFERENCES "public"."proj_info"("proj_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mails" ADD CONSTRAINT "mails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_broadcasts" ADD CONSTRAINT "mail_broadcasts_proj_code_proj_info_proj_code_fk" FOREIGN KEY ("proj_code") REFERENCES "public"."proj_info"("proj_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_broadcast_receipts" ADD CONSTRAINT "mail_broadcast_receipts_proj_code_proj_info_proj_code_fk" FOREIGN KEY ("proj_code") REFERENCES "public"."proj_info"("proj_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_broadcast_receipts" ADD CONSTRAINT "mail_broadcast_receipts_broadcast_id_mail_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."mail_broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_broadcast_receipts" ADD CONSTRAINT "mail_broadcast_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mails_proj_idem_uniq" ON "mails" USING btree ("proj_code","idem_key");--> statement-breakpoint
CREATE INDEX "mails_proj_user_idx" ON "mails" USING btree ("proj_code","user_id");--> statement-breakpoint
CREATE INDEX "mails_proj_user_claimed_idx" ON "mails" USING btree ("proj_code","user_id","claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_bc_proj_idem_uniq" ON "mail_broadcasts" USING btree ("proj_code","idem_key");--> statement-breakpoint
CREATE INDEX "mail_bc_proj_idx" ON "mail_broadcasts" USING btree ("proj_code");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_bc_receipt_uniq" ON "mail_broadcast_receipts" USING btree ("proj_code","broadcast_id","user_id");--> statement-breakpoint
CREATE INDEX "mail_bc_receipt_user_idx" ON "mail_broadcast_receipts" USING btree ("proj_code","user_id");
