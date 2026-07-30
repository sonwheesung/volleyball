CREATE TABLE "season_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proj_code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_telemetry" ADD CONSTRAINT "season_telemetry_proj_code_proj_info_proj_code_fk" FOREIGN KEY ("proj_code") REFERENCES "public"."proj_info"("proj_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_telemetry" ADD CONSTRAINT "season_telemetry_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "season_telemetry_proj_user_season_uniq" ON "season_telemetry" USING btree ("proj_code","user_id","season");--> statement-breakpoint
CREATE INDEX "season_telemetry_proj_user_idx" ON "season_telemetry" USING btree ("proj_code","user_id");
