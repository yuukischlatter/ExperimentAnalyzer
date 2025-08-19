-- ===================================================================
-- EXPERIMENT ALIGNMENTS SCHEMA
-- Database schema for storing timeline alignment data between different file types
-- File: backend/Database/Schema/ExperimentAlignments.sql
-- ===================================================================

-- Main experiment alignments table - stores timeline synchronization data
CREATE TABLE IF NOT EXISTS experiment_alignments (
    experiment_id TEXT PRIMARY KEY,
    
    -- === MASTER TIMELINE (from binary file) ===
    master_timeline_start_unix REAL NOT NULL,     -- Experiment start time (Unix timestamp with decimals)
    master_timeline_duration_s REAL NOT NULL,     -- Duration from binary file in seconds
    
    -- === AUTO-CALCULATED ALIGNMENT OFFSETS ===
    temperature_alignment_offset_s REAL,          -- Offset to align temperature CSV to master timeline
    
    -- === MANUAL ALIGNMENT OFFSETS (for future file types) ===
    acceleration_alignment_offset_s REAL,         -- Manual offset for acceleration data
    position_alignment_offset_s REAL,             -- Manual offset for position data
    
    -- === OVERRIDE FLAGS ===
    temperature_manual_override BOOLEAN DEFAULT FALSE,   -- TRUE if user manually adjusted temperature offset
    acceleration_manual_override BOOLEAN DEFAULT FALSE,  -- TRUE if user manually set acceleration offset
    position_manual_override BOOLEAN DEFAULT FALSE,      -- TRUE if user manually set position offset
    
    -- === METADATA ===
    calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,    -- When alignment was calculated
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,       -- Last update timestamp
    
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

-- Performance indexes for alignment queries
CREATE INDEX IF NOT EXISTS idx_experiment_alignments_calculated ON experiment_alignments(calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiment_alignments_updated ON experiment_alignments(updated_at DESC);

-- Index for finding experiments with manual overrides
CREATE INDEX IF NOT EXISTS idx_experiment_alignments_manual ON experiment_alignments(
    temperature_manual_override,
    acceleration_manual_override,
    position_manual_override
);

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_experiment_alignments_timestamp 
    AFTER UPDATE ON experiment_alignments
    FOR EACH ROW 
    WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE experiment_alignments 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE experiment_id = NEW.experiment_id;
END;