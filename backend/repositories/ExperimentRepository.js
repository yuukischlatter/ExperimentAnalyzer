/**
 * Experiment Repository
 * Converts C# Database/Repositories/ExperimentRepository.cs to JavaScript
 * Uses same SQL queries with promisified SQLite3 instead of Dapper
 * EXTENDED: Added summary and notes integration methods
 */

const { queryAsync, querySingleAsync, executeAsync } = require('../database/connection');
const Experiment = require('../models/Experiment');
const ExperimentMetadata = require('../models/ExperimentMetadata');

class ExperimentRepository {
    
    // === EXISTENCE CHECKS (for incremental updates) ===
    
    /**
     * Check if experiment exists
     * @param {string} experimentId 
     * @returns {Promise<boolean>}
     */
    async experimentExistsAsync(experimentId) {
        const sql = 'SELECT COUNT(*) as count FROM experiments WHERE id = ?';
        const result = await querySingleAsync(sql, [experimentId]);
        return result.count > 0;
    }

    /**
     * Check if metadata exists
     * @param {string} experimentId 
     * @returns {Promise<boolean>}
     */
    async metadataExistsAsync(experimentId) {
        const sql = 'SELECT COUNT(*) as count FROM experiment_metadata WHERE experiment_id = ?';
        const result = await querySingleAsync(sql, [experimentId]);
        return result.count > 0;
    }

    // === SINGLE EXPERIMENT OPERATIONS ===

    /**
     * Get experiment by ID
     * @param {string} experimentId 
     * @returns {Promise<Experiment|null>}
     */
    async getExperimentAsync(experimentId) {
        const sql = `
            SELECT 
                id,
                folder_path,
                experiment_date,
                created_at,
                updated_at,
                has_bin_file,
                has_acceleration_csv,
                has_position_csv,
                has_tensile_csv,
                has_photos,
                has_thermal_ravi,
                has_tcp5_file,
                has_weld_journal,
                has_crown_measurements,
                has_ambient_temperature
            FROM experiments 
            WHERE id = ?`;
        
        const row = await querySingleAsync(sql, [experimentId]);
        return Experiment.fromDatabaseRow(row);
    }

    /**
     * Get experiment with metadata
     * @param {string} experimentId 
     * @returns {Promise<Object|null>} - {experiment: Experiment, metadata: ExperimentMetadata}
     */
    async getExperimentWithMetadataAsync(experimentId) {
        const sql = `
            SELECT 
                e.id,
                e.folder_path,
                e.experiment_date,
                e.created_at,
                e.updated_at,
                e.has_bin_file,
                e.has_acceleration_csv,
                e.has_position_csv,
                e.has_tensile_csv,
                e.has_photos,
                e.has_thermal_ravi,
                e.has_tcp5_file,
                e.has_weld_journal,
                e.has_crown_measurements,
                e.has_ambient_temperature,
                m.experiment_id,
                m.program_number,
                m.program_name,
                m.material,
                m.shape,
                m.operator,
                m.oil_temperature,
                m.crown_measurement_interval,
                m.crown_einlauf_warm,
                m.crown_auslauf_warm,
                m.crown_einlauf_kalt,
                m.crown_auslauf_kalt,
                m.grinding_type,
                m.grinder,
                m.comments,
                m.einlaufseite,
                m.auslaufseite,
                m.parsed_at
            FROM experiments e
            LEFT JOIN experiment_metadata m ON e.id = m.experiment_id
            WHERE e.id = ?`;

        const row = await querySingleAsync(sql, [experimentId]);
        if (!row) return null;

        // Split row data for experiment and metadata
        const experimentData = {
            id: row.id,
            folder_path: row.folder_path,
            experiment_date: row.experiment_date,
            created_at: row.created_at,
            updated_at: row.updated_at,
            has_bin_file: row.has_bin_file,
            has_acceleration_csv: row.has_acceleration_csv,
            has_position_csv: row.has_position_csv,
            has_tensile_csv: row.has_tensile_csv,
            has_photos: row.has_photos,
            has_thermal_ravi: row.has_thermal_ravi,
            has_tcp5_file: row.has_tcp5_file,
            has_weld_journal: row.has_weld_journal,
            has_crown_measurements: row.has_crown_measurements,
            has_ambient_temperature: row.has_ambient_temperature
        };

        const experiment = Experiment.fromDatabaseRow(experimentData);
        
        // Only create metadata if it exists (experiment_id will be null if no metadata)
        let metadata = null;
        if (row.experiment_id) {
            const metadataData = {
                experiment_id: row.experiment_id,
                program_number: row.program_number,
                program_name: row.program_name,
                material: row.material,
                shape: row.shape,
                operator: row.operator,
                oil_temperature: row.oil_temperature,
                crown_measurement_interval: row.crown_measurement_interval,
                crown_einlauf_warm: row.crown_einlauf_warm,
                crown_auslauf_warm: row.crown_auslauf_warm,
                crown_einlauf_kalt: row.crown_einlauf_kalt,
                crown_auslauf_kalt: row.crown_auslauf_kalt,
                grinding_type: row.grinding_type,
                grinder: row.grinder,
                comments: row.comments,
                einlaufseite: row.einlaufseite,
                auslaufseite: row.auslaufseite,
                parsed_at: row.parsed_at
            };
            metadata = ExperimentMetadata.fromDatabaseRow(metadataData);
        }

        return {
            experiment,
            metadata
        };
    }

    // === NEW SUMMARY INTEGRATION METHODS ===

    /**
     * Get experiment with metadata and notes
     * @param {string} experimentId 
     * @returns {Promise<Object|null>} - {experiment, metadata, notes}
     */
    async getExperimentWithNotesAsync(experimentId) {
        const sql = `
            SELECT 
                e.id,
                e.folder_path,
                e.experiment_date,
                e.created_at,
                e.updated_at,
                e.has_bin_file,
                e.has_acceleration_csv,
                e.has_position_csv,
                e.has_tensile_csv,
                e.has_photos,
                e.has_thermal_ravi,
                e.has_tcp5_file,
                e.has_weld_journal,
                e.has_crown_measurements,
                e.has_ambient_temperature,
                m.experiment_id as metadata_experiment_id,
                m.program_number,
                m.program_name,
                m.material,
                m.shape,
                m.operator,
                m.oil_temperature,
                m.crown_measurement_interval,
                m.crown_einlauf_warm,
                m.crown_auslauf_warm,
                m.crown_einlauf_kalt,
                m.crown_auslauf_kalt,
                m.grinding_type,
                m.grinder,
                m.comments,
                m.einlaufseite,
                m.auslaufseite,
                m.parsed_at,
                n.experiment_id as notes_experiment_id,
                n.notes,
                n.created_at as notes_created_at,
                n.updated_at as notes_updated_at
            FROM experiments e
            LEFT JOIN experiment_metadata m ON e.id = m.experiment_id
            LEFT JOIN experiment_notes n ON e.id = n.experiment_id
            WHERE e.id = ?`;

        const row = await querySingleAsync(sql, [experimentId]);
        if (!row) return null;

        // Split experiment data
        const experimentData = {
            id: row.id,
            folder_path: row.folder_path,
            experiment_date: row.experiment_date,
            created_at: row.created_at,
            updated_at: row.updated_at,
            has_bin_file: row.has_bin_file,
            has_acceleration_csv: row.has_acceleration_csv,
            has_position_csv: row.has_position_csv,
            has_tensile_csv: row.has_tensile_csv,
            has_photos: row.has_photos,
            has_thermal_ravi: row.has_thermal_ravi,
            has_tcp5_file: row.has_tcp5_file,
            has_weld_journal: row.has_weld_journal,
            has_crown_measurements: row.has_crown_measurements,
            has_ambient_temperature: row.has_ambient_temperature
        };

        const experiment = Experiment.fromDatabaseRow(experimentData);

        // Create metadata if it exists
        let metadata = null;
        if (row.metadata_experiment_id) {
            const metadataData = {
                experiment_id: row.metadata_experiment_id,
                program_number: row.program_number,
                program_name: row.program_name,
                material: row.material,
                shape: row.shape,
                operator: row.operator,
                oil_temperature: row.oil_temperature,
                crown_measurement_interval: row.crown_measurement_interval,
                crown_einlauf_warm: row.crown_einlauf_warm,
                crown_auslauf_warm: row.crown_auslauf_warm,
                crown_einlauf_kalt: row.crown_einlauf_kalt,
                crown_auslauf_kalt: row.crown_auslauf_kalt,
                grinding_type: row.grinding_type,
                grinder: row.grinder,
                comments: row.comments,
                einlaufseite: row.einlaufseite,
                auslaufseite: row.auslaufseite,
                parsed_at: row.parsed_at
            };
            metadata = ExperimentMetadata.fromDatabaseRow(metadataData);
        }

        // Create notes if they exist
        let notes = null;
        if (row.notes_experiment_id) {
            const ExperimentNotes = require('../models/ExperimentNotes');
            const notesData = {
                experiment_id: row.notes_experiment_id,
                notes: row.notes,
                created_at: row.notes_created_at,
                updated_at: row.notes_updated_at
            };
            notes = ExperimentNotes.fromDatabaseRow(notesData);
        }

        return {
            experiment,
            metadata,
            notes
        };
    }

    /**
     * Get complete experiment data for summary computation
     * @param {string} experimentId 
     * @returns {Promise<Object|null>} - {experiment, metadata, notes, hasAllData: boolean}
     */
    async getExperimentFullSummaryAsync(experimentId) {
        try {
            const result = await this.getExperimentWithNotesAsync(experimentId);
            if (!result) return null;

            const { experiment, metadata, notes } = result;

            // Check data completeness for summary computation
            const hasAllData = {
                hasExperiment: !!experiment,
                hasMetadata: !!metadata,
                hasNotes: !!notes && !notes.isEmpty(),
                hasBinaryData: experiment?.hasBinFile || false,
                hasTensileData: experiment?.hasTensileCsv || false,
                hasTemperatureData: experiment?.hasAmbientTemperature || false,
                hasAccelerationData: experiment?.hasAccelerationCsv || false,
                hasPositionData: experiment?.hasPositionCsv || false,
                hasCrownData: experiment?.hasCrownMeasurements || false
            };

            return {
                experiment,
                metadata,
                notes,
                hasAllData,
                completeness: {
                    total: Object.keys(hasAllData).length,
                    available: Object.values(hasAllData).filter(Boolean).length,
                    percentage: Math.round(
                        (Object.values(hasAllData).filter(Boolean).length / Object.keys(hasAllData).length) * 100
                    )
                }
            };

        } catch (error) {
            console.error(`Error getting full summary data for ${experimentId}:`, error);
            return null;
        }
    }

    /**
     * Get experiments that are suitable for summary computation (have journal + metadata)
     * @returns {Promise<Experiment[]>}
     */
    async getExperimentsForSummaryAsync() {
        const sql = `
            SELECT 
                e.id, e.folder_path, e.experiment_date, e.created_at, e.updated_at,
                e.has_bin_file, e.has_acceleration_csv, e.has_position_csv, e.has_tensile_csv,
                e.has_photos, e.has_thermal_ravi, e.has_tcp5_file, e.has_weld_journal,
                e.has_crown_measurements, e.has_ambient_temperature
            FROM experiments e
            INNER JOIN experiment_metadata m ON e.id = m.experiment_id
            WHERE e.has_weld_journal = 1
            ORDER BY e.experiment_date DESC, e.id`;
        
        const rows = await queryAsync(sql);
        return rows.map(row => Experiment.fromDatabaseRow(row));
    }

    /**
     * Insert or update experiment
     * @param {Experiment} experiment 
     * @returns {Promise<void>}
     */
    async upsertExperimentAsync(experiment) {
        const sql = `
            INSERT OR REPLACE INTO experiments (
                id, folder_path, experiment_date, created_at, updated_at,
                has_bin_file, has_acceleration_csv, has_position_csv, has_tensile_csv,
                has_photos, has_thermal_ravi, has_tcp5_file, has_weld_journal, 
                has_crown_measurements, has_ambient_temperature
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const dbData = experiment.toDatabaseFormat();
        const params = [
            dbData.id,
            dbData.folder_path,
            dbData.experiment_date,
            dbData.created_at,
            dbData.updated_at,
            dbData.has_bin_file,
            dbData.has_acceleration_csv,
            dbData.has_position_csv,
            dbData.has_tensile_csv,
            dbData.has_photos,
            dbData.has_thermal_ravi,
            dbData.has_tcp5_file,
            dbData.has_weld_journal,
            dbData.has_crown_measurements,
            dbData.has_ambient_temperature
        ];

        await executeAsync(sql, params);
    }

    /**
     * Insert or update metadata
     * @param {ExperimentMetadata} metadata 
     * @returns {Promise<void>}
     */
    async upsertMetadataAsync(metadata) {
        // Apply defaults (equivalent to C# version)
        metadata.applyDefaults();

        const sql = `
            INSERT OR REPLACE INTO experiment_metadata (
                experiment_id, program_number, program_name, material, shape, operator,
                oil_temperature, crown_measurement_interval, crown_einlauf_warm, 
                crown_auslauf_warm, crown_einlauf_kalt, crown_auslauf_kalt,
                grinding_type, grinder, comments, einlaufseite, auslaufseite, parsed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const dbData = metadata.toDatabaseFormat();
        const params = [
            dbData.experiment_id,
            dbData.program_number,
            dbData.program_name,
            dbData.material,
            dbData.shape,
            dbData.operator,
            dbData.oil_temperature,
            dbData.crown_measurement_interval,
            dbData.crown_einlauf_warm,
            dbData.crown_auslauf_warm,
            dbData.crown_einlauf_kalt,
            dbData.crown_auslauf_kalt,
            dbData.grinding_type,
            dbData.grinder,
            dbData.comments,
            dbData.einlaufseite,
            dbData.auslaufseite,
            dbData.parsed_at
        ];

        await executeAsync(sql, params);
    }

    // === BULK OPERATIONS FOR BROWSER/API ===

    /**
     * Get experiments with weld journals
     * @returns {Promise<Experiment[]>}
     */
    async getExperimentsWithJournalsAsync() {
        const sql = `
            SELECT 
                id, folder_path, experiment_date, created_at, updated_at,
                has_bin_file, has_acceleration_csv, has_position_csv, has_tensile_csv,
                has_photos, has_thermal_ravi, has_tcp5_file, has_weld_journal,
                has_crown_measurements, has_ambient_temperature
            FROM experiments 
            WHERE has_weld_journal = 1`;
        
        const rows = await queryAsync(sql);
        return rows.map(row => Experiment.fromDatabaseRow(row));
    }

    /**
     * Get all experiments with metadata
     * @returns {Promise<Array>} Array of {experiment, metadata}
     */
    async getAllExperimentsWithMetadataAsync() {
        const sql = `
            SELECT 
                e.id, e.folder_path, e.experiment_date, e.created_at, e.updated_at,
                e.has_bin_file, e.has_acceleration_csv, e.has_position_csv, e.has_tensile_csv,
                e.has_photos, e.has_thermal_ravi, e.has_tcp5_file, e.has_weld_journal,
                e.has_crown_measurements, e.has_ambient_temperature,
                m.experiment_id, m.program_number, m.program_name, m.material, m.shape, m.operator,
                m.oil_temperature, m.crown_measurement_interval, m.crown_einlauf_warm, 
                m.crown_auslauf_warm, m.crown_einlauf_kalt, m.crown_auslauf_kalt,
                m.grinding_type, m.grinder, m.comments, m.einlaufseite, m.auslaufseite, m.parsed_at
            FROM experiments e
            LEFT JOIN experiment_metadata m ON e.id = m.experiment_id
            ORDER BY e.experiment_date DESC, e.id`;

        const rows = await queryAsync(sql);
        return this._processExperimentWithMetadataRows(rows);
    }

    /**
     * Get filtered experiments
     * @param {string} filterBy 
     * @param {string} filterValue 
     * @param {string} sortBy 
     * @param {string} sortDirection 
     * @returns {Promise<Array>}
     */
    async getFilteredExperimentsAsync(filterBy = null, filterValue = null, sortBy = 'date', sortDirection = 'desc') {
        let sql = `
            SELECT 
                e.id, e.folder_path, e.experiment_date, e.created_at, e.updated_at,
                e.has_bin_file, e.has_acceleration_csv, e.has_position_csv, e.has_tensile_csv,
                e.has_photos, e.has_thermal_ravi, e.has_tcp5_file, e.has_weld_journal,
                e.has_crown_measurements, e.has_ambient_temperature,
                m.experiment_id, m.program_number, m.program_name, m.material, m.shape, m.operator,
                m.oil_temperature, m.crown_measurement_interval, m.crown_einlauf_warm, 
                m.crown_auslauf_warm, m.crown_einlauf_kalt, m.crown_auslauf_kalt,
                m.grinding_type, m.grinder, m.comments, m.einlaufseite, m.auslaufseite, m.parsed_at
            FROM experiments e
            LEFT JOIN experiment_metadata m ON e.id = m.experiment_id`;

        let whereClause = '';
        let params = [];

        // Add filter conditions
        if (filterBy && filterValue) {
            const filterLower = filterBy.toLowerCase();
            const filterValueParam = `%${filterValue}%`;
            
            switch (filterLower) {
                case 'operator':
                    whereClause = ' WHERE m.operator LIKE ?';
                    params.push(filterValueParam);
                    break;
                case 'program':
                    whereClause = ' WHERE (m.program_number LIKE ? OR m.program_name LIKE ?)';
                    params.push(filterValueParam, filterValueParam);
                    break;
                case 'material':
                    whereClause = ' WHERE m.material LIKE ?';
                    params.push(filterValueParam);
                    break;
                case 'shape':
                    whereClause = ' WHERE m.shape LIKE ?';
                    params.push(filterValueParam);
                    break;
            }
        }

        // Add sorting
        const orderClause = this._getOrderClause(sortBy, sortDirection);
        sql += whereClause + orderClause;

        const rows = await queryAsync(sql, params);
        return this._processExperimentWithMetadataRows(rows);
    }

    /**
     * Get experiment count
     * @returns {Promise<number>}
     */
    async getExperimentCountAsync() {
        const sql = 'SELECT COUNT(*) as count FROM experiments';
        const result = await querySingleAsync(sql);
        return result.count;
    }

    // === PRIVATE HELPER METHODS ===

    /**
     * Process rows from experiment+metadata queries
     * @param {Array} rows 
     * @returns {Array}
     */
    _processExperimentWithMetadataRows(rows) {
        return rows.map(row => {
            // Split experiment data
            const experimentData = {
                id: row.id,
                folder_path: row.folder_path,
                experiment_date: row.experiment_date,
                created_at: row.created_at,
                updated_at: row.updated_at,
                has_bin_file: row.has_bin_file,
                has_acceleration_csv: row.has_acceleration_csv,
                has_position_csv: row.has_position_csv,
                has_tensile_csv: row.has_tensile_csv,
                has_photos: row.has_photos,
                has_thermal_ravi: row.has_thermal_ravi,
                has_tcp5_file: row.has_tcp5_file,
                has_weld_journal: row.has_weld_journal,
                has_crown_measurements: row.has_crown_measurements,
                has_ambient_temperature: row.has_ambient_temperature
            };

            const experiment = Experiment.fromDatabaseRow(experimentData);

            // Create metadata if it exists
            let metadata = null;
            if (row.experiment_id) {
                const metadataData = {
                    experiment_id: row.experiment_id,
                    program_number: row.program_number,
                    program_name: row.program_name,
                    material: row.material,
                    shape: row.shape,
                    operator: row.operator,
                    oil_temperature: row.oil_temperature,
                    crown_measurement_interval: row.crown_measurement_interval,
                    crown_einlauf_warm: row.crown_einlauf_warm,
                    crown_auslauf_warm: row.crown_auslauf_warm,
                    crown_einlauf_kalt: row.crown_einlauf_kalt,
                    crown_auslauf_kalt: row.crown_auslauf_kalt,
                    grinding_type: row.grinding_type,
                    grinder: row.grinder,
                    comments: row.comments,
                    einlaufseite: row.einlaufseite,
                    auslaufseite: row.auslaufseite,
                    parsed_at: row.parsed_at
                };
                metadata = ExperimentMetadata.fromDatabaseRow(metadataData);
            }

            return { experiment, metadata };
        });
    }

    /**
     * Get ORDER BY clause (equivalent to C# GetOrderClause)
     * @param {string} sortBy 
     * @param {string} sortDirection 
     * @returns {string}
     */
    _getOrderClause(sortBy, sortDirection) {
        const isDesc = sortDirection.toLowerCase() === 'desc';
        const direction = isDesc ? 'DESC' : 'ASC';

        switch (sortBy.toLowerCase()) {
            case 'date':
                return ` ORDER BY e.experiment_date ${direction}, e.id ${direction}`;
            case 'id':
                return ` ORDER BY e.id ${direction}`;
            case 'operator':
                return ` ORDER BY m.operator ${direction}`;
            case 'program':
                return ` ORDER BY m.program_number ${direction}`;
            case 'material':
                return ` ORDER BY m.material ${direction}`;
            case 'shape':
                return ` ORDER BY m.shape ${direction}`;
            default:
                return ' ORDER BY e.experiment_date DESC, e.id DESC';
        }
    }
}

module.exports = ExperimentRepository;