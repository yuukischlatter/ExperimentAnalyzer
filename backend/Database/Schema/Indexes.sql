-- Performance indexes for experiment browser queries
CREATE INDEX IF NOT EXISTS idx_experiments_date ON experiments(experiment_date DESC);
CREATE INDEX IF NOT EXISTS idx_experiments_created ON experiments(created_at DESC);

-- Metadata filtering indexes
CREATE INDEX IF NOT EXISTS idx_metadata_program ON experiment_metadata(program_number);
CREATE INDEX IF NOT EXISTS idx_metadata_material ON experiment_metadata(material);
CREATE INDEX IF NOT EXISTS idx_metadata_shape ON experiment_metadata(shape);
CREATE INDEX IF NOT EXISTS idx_metadata_operator ON experiment_metadata(operator);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_experiments_date_files ON experiments(
    experiment_date DESC, 
    has_bin_file, 
    has_acceleration_csv,
    has_weld_journal
);

-- Experiment notes indexes
CREATE INDEX IF NOT EXISTS idx_experiment_notes_updated ON experiment_notes(updated_at DESC);