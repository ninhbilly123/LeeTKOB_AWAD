-- Migration: 0001_init_pa3_schema (DOWN)
-- Drops all 16 PA#3 tables in strict reverse foreign-key order.

SET lock_timeout = '2s';

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS grade_appeals;
DROP TABLE IF EXISTS model_call_logs;
DROP TABLE IF EXISTS constraint_findings;
DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS submission_jobs;
DROP TABLE IF EXISTS submission_test_results;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS lab_constraint_revisions;
DROP TABLE IF EXISTS lab_constraints;
DROP TABLE IF EXISTS lab_test_cases;
DROP TABLE IF EXISTS labs;
DROP TABLE IF EXISTS class_enrollments;
DROP TABLE IF EXISTS class_staff;
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS users;
