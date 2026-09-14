CREATE TABLE "edit_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"origin" text DEFAULT 'agent' NOT NULL,
	"agent_id" text NOT NULL,
	"agent_label" text NOT NULL,
	"skill" jsonb NOT NULL,
	"source_version" uuid NOT NULL,
	"source_is_public" boolean NOT NULL,
	"base" jsonb NOT NULL,
	"candidate" jsonb NOT NULL,
	"diff" jsonb NOT NULL,
	"notes" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"accepted_change_ids" jsonb,
	"rejected_change_ids" jsonb,
	"applied_version" uuid,
	CONSTRAINT "edit_proposals_status_check" CHECK ("edit_proposals"."status" in ('open', 'applied', 'rejected', 'superseded')),
	CONSTRAINT "edit_proposals_origin_check" CHECK ("edit_proposals"."origin" = 'agent'),
	CONSTRAINT "edit_proposals_decision_check" CHECK (("edit_proposals"."status" = 'open' AND "edit_proposals"."decided_at" is null) OR ("edit_proposals"."status" <> 'open' AND "edit_proposals"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edit_proposals_post_created_idx" ON "edit_proposals" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "edit_proposals_one_open_agent_idx" ON "edit_proposals" USING btree ("post_id") WHERE "edit_proposals"."status" = 'open' AND "edit_proposals"."origin" = 'agent';