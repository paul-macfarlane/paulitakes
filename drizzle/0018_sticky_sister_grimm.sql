CREATE TABLE "agent_api_state" (
	"id" uuid PRIMARY KEY NOT NULL,
	"read_window" timestamp with time zone,
	"read_count" integer DEFAULT 0 NOT NULL,
	"submit_window" timestamp with time zone,
	"submit_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_api_state_counts_check" CHECK ("agent_api_state"."read_count" >= 0 AND "agent_api_state"."submit_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_receipts" RENAME COLUMN "credential_id" TO "principal_id";--> statement-breakpoint
ALTER TABLE "agent_receipts" DROP CONSTRAINT "agent_receipts_credential_id_agent_credentials_id_fk";
--> statement-breakpoint
DROP TABLE "agent_credentials";
--> statement-breakpoint
ALTER TABLE "agent_receipts" DROP CONSTRAINT "agent_receipts_credential_id_key_pk";--> statement-breakpoint
ALTER TABLE "agent_receipts" ADD CONSTRAINT "agent_receipts_principal_id_key_pk" PRIMARY KEY("principal_id","key");