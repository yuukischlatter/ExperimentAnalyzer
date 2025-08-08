-- ===================================================================
-- EXPERIMENT NOTES SCHEMA
-- New table for storing user notes on experiments
-- File: backend/Database/Schema/ExperimentNotes.sql
-- ===================================================================

-- User notes table for experiment-specific annotations
CREATE TABLE IF NOT EXISTS experiment_notes (
    experiment_id TEXT PRIMARY KEY,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

-- Performance index for notes lookup and sorting
CREATE INDEX IF NOT EXISTS idx_experiment_notes_updated ON experiment_notes(updated_at DESC);