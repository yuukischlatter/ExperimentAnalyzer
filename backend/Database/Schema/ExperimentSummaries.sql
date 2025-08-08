-- ===================================================================
-- EXPERIMENT SUMMARIES SCHEMA
-- Database-backed summary storage for instant API responses
-- File: backend/Database/Schema/ExperimentSummaries.sql
-- ===================================================================

-- Main experiment summaries table - stores all computed summary data
CREATE TABLE IF NOT EXISTS experiment_summaries (
    experiment_id TEXT PRIMARY KEY,
    
    -- === SUMMARY METADATA ===
    computed_at DATETIME NOT NULL,
    computation_status TEXT NOT NULL CHECK (computation_status IN ('complete', 'partial', 'failed', 'unknown')),
    data_sources_used TEXT, -- JSON array: ["binary", "tensile", "temperature", "crown", etc.]
    has_errors BOOLEAN DEFAULT FALSE,
    errors_json TEXT, -- JSON array of error messages
    
    -- === WELDING PERFORMANCE SECTION ===
    program TEXT,
    program_number TEXT,
    program_name TEXT,
    material TEXT,
    shape TEXT,
    operator TEXT,
    
    -- Raw metric values (frontend will reconstruct formatted objects)
    peak_force_kn REAL,
    peak_current_gr1_a REAL,
    peak_current_gr2_a REAL,
    max_voltage_v REAL,
    max_pressure_bar REAL,
    welding_duration_s REAL,
    oil_temperature_c REAL,
    
    -- === TENSILE RESULTS SECTION ===
    tensile_peak_force_kn REAL,
    tensile_target_force_kn REAL,
    tensile_min_force_limit_kn REAL,
    tensile_result TEXT CHECK (tensile_result IN ('PASS', 'FAIL', 'UNKNOWN')),
    tensile_max_displacement_mm REAL,
    tensile_material_grade TEXT,
    tensile_test_date DATETIME,
    tensile_margin_percent INTEGER,
    
    -- === TEMPERATURE MONITORING SECTION ===
    welding_temp_min_c REAL,
    welding_temp_max_c REAL,
    welding_temp_range_c REAL,
    ambient_temp_min_c REAL,
    ambient_temp_max_c REAL,
    ambient_temp_range_c REAL,
    temperature_duration_s REAL,
    temperature_channels_json TEXT, -- JSON array of channel names
    
    -- === GEOMETRY AND POSITION SECTION ===
    crown_inlet_warm_mm REAL,
    crown_inlet_cold_mm REAL,
    crown_outlet_warm_mm REAL,
    crown_outlet_cold_mm REAL,
    crown_difference_inlet_mm REAL,
    crown_difference_outlet_mm REAL,
    crown_measurement_interval_min INTEGER,
    
    total_displacement_mm REAL,
    position_min_mm REAL,
    position_max_mm REAL,
    
    rail_einlaufseite TEXT,
    rail_auslaufseite TEXT,
    
    -- === VIBRATION ANALYSIS SECTION ===
    peak_acceleration_ms2 REAL,
    max_acc_x_ms2 REAL,
    max_acc_y_ms2 REAL,
    max_acc_z_ms2 REAL,
    rms_x_ms2 REAL,
    rms_y_ms2 REAL,
    rms_z_ms2 REAL,
    rms_magnitude_ms2 REAL,
    vibration_duration_s REAL,
    vibration_sampling_rate_hz REAL,
    
    -- === FILE AVAILABILITY SECTION ===
    file_completeness_percent INTEGER,
    critical_files_complete BOOLEAN,
    critical_files_count TEXT, -- "3/3" format
    total_files INTEGER,
    available_count INTEGER,
    missing_count INTEGER,
    available_files_json TEXT, -- JSON array: ["Binary Data", "Tensile Test", etc.]
    missing_files_json TEXT, -- JSON array of missing files
    
    -- Timestamps for cache management
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

-- Performance indexes for summary queries
CREATE INDEX IF NOT EXISTS idx_experiment_summaries_status ON experiment_summaries(computation_status, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiment_summaries_computed_at ON experiment_summaries(computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiment_summaries_material ON experiment_summaries(material);
CREATE INDEX IF NOT EXISTS idx_experiment_summaries_operator ON experiment_summaries(operator);
CREATE INDEX IF NOT EXISTS idx_experiment_summaries_program ON experiment_summaries(program_number);

-- Composite index for filtering complete summaries by date
CREATE INDEX IF NOT EXISTS idx_experiment_summaries_complete_date ON experiment_summaries(
    computation_status, 
    computed_at DESC
) WHERE computation_status = 'complete';

-- Index for file completeness queries
CREATE INDEX IF NOT EXISTS idx_experiment_summaries_completeness ON experiment_summaries(
    file_completeness_percent DESC,
    critical_files_complete
);

-- SQLite doesn't support COMMENT ON statements, so documentation is in comments above

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_experiment_summaries_timestamp 
    AFTER UPDATE ON experiment_summaries
    FOR EACH ROW 
    WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE experiment_summaries 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE experiment_id = NEW.experiment_id;
END;