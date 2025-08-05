-- Sample experiment data for development testing
INSERT OR REPLACE INTO experiments (
    id, folder_path, experiment_date, created_at, updated_at,
    has_bin_file, has_acceleration_csv, has_position_csv, has_tensile_csv,
    has_thermal_ravi, has_tcp5_file, has_weld_journal, has_crown_measurements,
    has_ambient_temperature
) VALUES 
('J25-07-30(1)', 'R:\Schweissungen\J25-07-30(1)', '2025-07-30', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
 1, 1, 1, 1, 1, 1, 1, 1, 1),
('J25-07-30(2)', 'R:\Schweissungen\J25-07-30(2)', '2025-07-30', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
 1, 1, 0, 1, 0, 1, 1, 0, 1),
('J25-07-29(1)', 'R:\Schweissungen\J25-07-29(1)', '2025-07-29', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
 1, 0, 1, 1, 1, 0, 1, 1, 0);

-- Sample metadata for testing
INSERT OR REPLACE INTO experiment_metadata (
    experiment_id, program_number, program_name, material, shape, operator,
    oil_temperature, crown_einlauf_warm, crown_auslauf_warm, grinding_type, grinder, comments
) VALUES 
('J25-07-30(1)', '80', '080-R65-2-DT350', 'DT350', 'P65-2', 'Bnr',
 49.5, 0.6, 1.3, 'Polierung mit Flex', 'Sfl', 'Test experiment 1'),
('J25-07-30(2)', '85', '085-R65-3-DT400', 'DT400', 'P65-3', 'Mko', 
 52.1, 0.8, 1.1, 'Schleifscheibe', 'Hrt', 'Test experiment 2'),
('J25-07-29(1)', '75', '075-R60-1-DT300', 'DT300', 'P60-1', 'Bnr',
 48.0, 0.5, 1.4, 'Polierung', 'Sfl', 'Test experiment 3');