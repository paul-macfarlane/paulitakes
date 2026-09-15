CREATE TABLE "agent_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"read_window" timestamp with time zone,
	"read_count" integer DEFAULT 0 NOT NULL,
	"submit_window" timestamp with time zone,
	"submit_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_credentials_hash_check" CHECK ("agent_credentials"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_credentials_expiry_check" CHECK ("agent_credentials"."expires_at" > "agent_credentials"."created_at"),
	CONSTRAINT "agent_credentials_scopes_check" CHECK (jsonb_typeof("agent_credentials"."scopes") = 'array' AND jsonb_array_length("agent_credentials"."scopes") > 0 AND "agent_credentials"."scopes" <@ '["content:read", "proposals:create"]'::jsonb),
	CONSTRAINT "agent_credentials_counts_check" CHECK ("agent_credentials"."read_count" >= 0 AND "agent_credentials"."submit_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agent_receipts" (
	"credential_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"post_id" uuid NOT NULL,
	"proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_receipts_credential_id_key_pk" PRIMARY KEY("credential_id","key")
);
--> statement-breakpoint
ALTER TABLE "agent_receipts" ADD CONSTRAINT "agent_receipts_credential_id_agent_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."agent_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_receipts" ADD CONSTRAINT "agent_receipts_proposal_id_edit_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."edit_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_receipts_proposal_idx" ON "agent_receipts" USING btree ("proposal_id");