ALTER TABLE "pr_intent" RENAME COLUMN "intent" TO "summary";--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "insufficient_context" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_in" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_out" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "classified_head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "classified_body_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "classified_at" timestamp with time zone DEFAULT now() NOT NULL;