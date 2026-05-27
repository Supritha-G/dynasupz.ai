-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('approved', 'rolled_back', 'paused', 'blocked_by_policy');

-- CreateEnum
CREATE TYPE "RiskScore" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateTable
CREATE TABLE "deployment_records" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repo" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "base_sha" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "commit_message" TEXT,
    "triggered_by" TEXT,
    "outcome" "Outcome" NOT NULL,
    "deploy_started_at" TIMESTAMP(3),
    "deploy_completed_at" TIMESTAMP(3),
    "risk_score" "RiskScore",
    "blast_radius" JSONB,
    "baseline_metrics" JSONB,
    "peak_metrics" JSONB,
    "anomaly_detected" BOOLEAN NOT NULL DEFAULT false,
    "anomaly_type" TEXT,
    "root_cause_analysis" JSONB,
    "rollback_executed" BOOLEAN NOT NULL DEFAULT false,
    "policy_evaluation" JSONB,
    "reasoning_chain" JSONB NOT NULL DEFAULT '[]',
    "steady_state_confirmed_at" TIMESTAMP(3),

    CONSTRAINT "deployment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_risk_profiles" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "change_category" TEXT NOT NULL,
    "total_deploys" INTEGER NOT NULL DEFAULT 0,
    "incident_deploys" INTEGER NOT NULL DEFAULT 0,
    "incident_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "last_incident_at" TIMESTAMP(3),
    "last_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incidents_summary" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "service_risk_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deployment_records_service_idx" ON "deployment_records"("service");

-- CreateIndex
CREATE INDEX "deployment_records_commit_sha_idx" ON "deployment_records"("commit_sha");

-- CreateIndex
CREATE INDEX "deployment_records_outcome_idx" ON "deployment_records"("outcome");

-- CreateIndex
CREATE INDEX "deployment_records_created_at_idx" ON "deployment_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_risk_profiles_service_change_category_key" ON "service_risk_profiles"("service", "change_category");
