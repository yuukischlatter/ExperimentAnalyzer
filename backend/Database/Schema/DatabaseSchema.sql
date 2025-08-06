-- Main experiments registry (populated by DirectoryScanner)
CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,                    -- e.g., "J25-07-30(3)"
    folder_path TEXT NOT NULL,              -- Full filesystem path
    experiment_date DATE,                   -- Extracted from folder name
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- File availability flags
    has_bin_file BOOLEAN DEFAULT FALSE,
    has_acceleration_csv BOOLEAN DEFAULT FALSE,
    has_position_csv BOOLEAN DEFAULT FALSE,
    has_tensile_csv BOOLEAN DEFAULT FALSE,
    has_photos BOOLEAN DEFAULT FALSE,
    has_thermal_ravi BOOLEAN DEFAULT FALSE,
    has_tcp5_file BOOLEAN DEFAULT FALSE,
    has_weld_journal BOOLEAN DEFAULT FALSE,
    has_crown_measurements BOOLEAN DEFAULT FALSE,
    has_ambient_temperature BOOLEAN DEFAULT FALSE
);

-- Parsed journal metadata (populated by JournalParser)
CREATE TABLE IF NOT EXISTS experiment_metadata (
    experiment_id TEXT PRIMARY KEY,
    program_number TEXT,
    program_name TEXT,
    material TEXT,
    shape TEXT,
    operator TEXT,
    oil_temperature REAL,
    crown_measurement_interval INTEGER,
    crown_einlauf_warm REAL,
    crown_auslauf_warm REAL,
    crown_einlauf_kalt REAL,
    crown_auslauf_kalt REAL,
    grinding_type TEXT,
    grinder TEXT,
    comments TEXT,
    einlaufseite TEXT,                      
    auslaufseite TEXT,                      
    parsed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);