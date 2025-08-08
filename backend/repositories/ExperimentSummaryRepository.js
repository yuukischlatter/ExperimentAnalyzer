/**
 * Experiment Summary Repository
 * Database operations for pre-computed experiment summaries
 * File: backend/repositories/ExperimentSummaryRepository.js
 */

const { queryAsync, querySingleAsync, executeAsync } = require('../database/connection');

class ExperimentSummaryRepository {
    
    // === CORE RETRIEVAL OPERATIONS ===

    /**
     * Get summary by experiment ID
     * @param {string} experimentId 
     * @returns {Promise<Object|null>} Raw database row or null
     */
    async getSummaryAsync(experimentId) {
        const sql = `
            SELECT 
                experiment_id, computed_at, computation_status, data_sources_used, 
                has_errors, errors_json,
                
                -- Welding Performance
                program, program_number, program_name, material, shape, operator,
                peak_force_kn, peak_current_gr1_a, peak_current_gr2_a, 
                max_voltage_v, max_pressure_bar, welding_duration_s, oil_temperature_c,
                
                -- Tensile Results
                tensile_peak_force_kn, tensile_target_force_kn, tensile_min_force_limit_kn,
                tensile_result, tensile_max_displacement_mm, tensile_material_grade, 
                tensile_test_date, tensile_margin_percent,
                
                -- Temperature Monitoring
                welding_temp_min_c, welding_temp_max_c, welding_temp_range_c,
                ambient_temp_min_c, ambient_temp_max_c, ambient_temp_range_c,
                temperature_duration_s, temperature_channels_json,
                
                -- Geometry and Position
                crown_inlet_warm_mm, crown_inlet_cold_mm, crown_outlet_warm_mm, crown_outlet_cold_mm,
                crown_difference_inlet_mm, crown_difference_outlet_mm, crown_measurement_interval_min,
                total_displacement_mm, position_min_mm, position_max_mm,
                rail_einlaufseite, rail_auslaufseite,
                
                -- Vibration Analysis
                peak_acceleration_ms2, max_acc_x_ms2, max_acc_y_ms2, max_acc_z_ms2,
                rms_x_ms2, rms_y_ms2, rms_z_ms2, rms_magnitude_ms2,
                vibration_duration_s, vibration_sampling_rate_hz,
                
                -- File Availability
                file_completeness_percent, critical_files_complete, critical_files_count,
                total_files, available_count, missing_count, 
                available_files_json, missing_files_json,
                
                created_at, updated_at
                
            FROM experiment_summaries 
            WHERE experiment_id = ?`;
        
        return await querySingleAsync(sql, [experimentId]);
    }

    /**
     * Get complete summary (only if computation_status = 'complete')
     * @param {string} experimentId 
     * @returns {Promise<Object|null>} Complete summary or null
     */
    async getCompleteSummaryAsync(experimentId) {
        const sql = `
            SELECT * FROM experiment_summaries 
            WHERE experiment_id = ? AND computation_status = 'complete'`;
        
        return await querySingleAsync(sql, [experimentId]);
    }

    /**
     * Check if summary exists and its status
     * @param {string} experimentId 
     * @returns {Promise<Object>} {exists: boolean, status: string, computedAt: string}
     */
    async getSummaryStatusAsync(experimentId) {
        const sql = `
            SELECT computation_status, computed_at, has_errors 
            FROM experiment_summaries 
            WHERE experiment_id = ?`;
        
        const result = await querySingleAsync(sql, [experimentId]);
        
        if (!result) {
            return { exists: false, status: 'unknown', computedAt: null, hasErrors: false };
        }
        
        return {
            exists: true,
            status: result.computation_status,
            computedAt: result.computed_at,
            hasErrors: Boolean(result.has_errors)
        };
    }

    // === STORAGE OPERATIONS ===

    /**
     * Store complete computed summary
     * @param {string} experimentId 
     * @param {ExperimentSummary} summary - From SummaryService.computeExperimentSummary()
     * @returns {Promise<void>}
     */
    async storeSummaryAsync(experimentId, summary) {
        const summaryData = this._extractSummaryData(summary);
        
        const sql = `
            INSERT OR REPLACE INTO experiment_summaries (
                experiment_id, computed_at, computation_status, data_sources_used, 
                has_errors, errors_json,
                
                -- Welding Performance
                program, program_number, program_name, material, shape, operator,
                peak_force_kn, peak_current_gr1_a, peak_current_gr2_a, 
                max_voltage_v, max_pressure_bar, welding_duration_s, oil_temperature_c,
                
                -- Tensile Results
                tensile_peak_force_kn, tensile_target_force_kn, tensile_min_force_limit_kn,
                tensile_result, tensile_max_displacement_mm, tensile_material_grade, 
                tensile_test_date, tensile_margin_percent,
                
                -- Temperature Monitoring
                welding_temp_min_c, welding_temp_max_c, welding_temp_range_c,
                ambient_temp_min_c, ambient_temp_max_c, ambient_temp_range_c,
                temperature_duration_s, temperature_channels_json,
                
                -- Geometry and Position
                crown_inlet_warm_mm, crown_inlet_cold_mm, crown_outlet_warm_mm, crown_outlet_cold_mm,
                crown_difference_inlet_mm, crown_difference_outlet_mm, crown_measurement_interval_min,
                total_displacement_mm, position_min_mm, position_max_mm,
                rail_einlaufseite, rail_auslaufseite,
                
                -- Vibration Analysis
                peak_acceleration_ms2, max_acc_x_ms2, max_acc_y_ms2, max_acc_z_ms2,
                rms_x_ms2, rms_y_ms2, rms_z_ms2, rms_magnitude_ms2,
                vibration_duration_s, vibration_sampling_rate_hz,
                
                -- File Availability
                file_completeness_percent, critical_files_complete, critical_files_count,
                total_files, available_count, missing_count, 
                available_files_json, missing_files_json,
                
                updated_at
                
                created_at, updated_at
                
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const params = [
            summaryData.experiment_id,
            summaryData.computed_at,
            summaryData.computation_status,
            summaryData.data_sources_used,
            summaryData.has_errors,
            summaryData.errors_json,
            
            // Welding Performance
            summaryData.program,
            summaryData.program_number,
            summaryData.program_name,
            summaryData.material,
            summaryData.shape,
            summaryData.operator,
            summaryData.peak_force_kn,
            summaryData.peak_current_gr1_a,
            summaryData.peak_current_gr2_a,
            summaryData.max_voltage_v,
            summaryData.max_pressure_bar,
            summaryData.welding_duration_s,
            summaryData.oil_temperature_c,
            
            // Tensile Results
            summaryData.tensile_peak_force_kn,
            summaryData.tensile_target_force_kn,
            summaryData.tensile_min_force_limit_kn,
            summaryData.tensile_result,
            summaryData.tensile_max_displacement_mm,
            summaryData.tensile_material_grade,
            summaryData.tensile_test_date,
            summaryData.tensile_margin_percent,
            
            // Temperature Monitoring
            summaryData.welding_temp_min_c,
            summaryData.welding_temp_max_c,
            summaryData.welding_temp_range_c,
            summaryData.ambient_temp_min_c,
            summaryData.ambient_temp_max_c,
            summaryData.ambient_temp_range_c,
            summaryData.temperature_duration_s,
            summaryData.temperature_channels_json,
            
            // Geometry and Position
            summaryData.crown_inlet_warm_mm,
            summaryData.crown_inlet_cold_mm,
            summaryData.crown_outlet_warm_mm,
            summaryData.crown_outlet_cold_mm,
            summaryData.crown_difference_inlet_mm,
            summaryData.crown_difference_outlet_mm,
            summaryData.crown_measurement_interval_min,
            summaryData.total_displacement_mm,
            summaryData.position_min_mm,
            summaryData.position_max_mm,
            summaryData.rail_einlaufseite,
            summaryData.rail_auslaufseite,
            
            // Vibration Analysis
            summaryData.peak_acceleration_ms2,
            summaryData.max_acc_x_ms2,
            summaryData.max_acc_y_ms2,
            summaryData.max_acc_z_ms2,
            summaryData.rms_x_ms2,
            summaryData.rms_y_ms2,
            summaryData.rms_z_ms2,
            summaryData.rms_magnitude_ms2,
            summaryData.vibration_duration_s,
            summaryData.vibration_sampling_rate_hz,
            
            // File Availability
            summaryData.file_completeness_percent,
            summaryData.critical_files_complete,
            summaryData.critical_files_count,
            summaryData.total_files,
            summaryData.available_count,
            summaryData.missing_count,
            summaryData.available_files_json,
            summaryData.missing_files_json,
            
            // Timestamps (MISSING FROM ORIGINAL)
            summaryData.created_at,
            summaryData.updated_at
        ];

        await executeAsync(sql, params);
    }

    /**
     * Delete summary for experiment
     * @param {string} experimentId 
     * @returns {Promise<boolean>} True if deleted
     */
    async deleteSummaryAsync(experimentId) {
        const sql = 'DELETE FROM experiment_summaries WHERE experiment_id = ?';
        const result = await executeAsync(sql, [experimentId]);
        return result.changes > 0;
    }

    /**
     * Update computation status only
     * @param {string} experimentId 
     * @param {string} status - 'complete', 'partial', 'failed', 'unknown'
     * @param {Array} errors - Optional error messages
     * @returns {Promise<void>}
     */
    async updateStatusAsync(experimentId, status, errors = []) {
        const sql = `
            UPDATE experiment_summaries 
            SET computation_status = ?, 
                has_errors = ?, 
                errors_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE experiment_id = ?`;
        
        const hasErrors = errors.length > 0;
        const errorsJson = JSON.stringify(errors);
        
        await executeAsync(sql, [status, hasErrors ? 1 : 0, errorsJson, experimentId]);
    }

    // === BULK OPERATIONS ===

    /**
     * Get multiple summaries by experiment IDs
     * @param {string[]} experimentIds 
     * @returns {Promise<Object[]>} Array of summary objects
     */
    async getMultipleSummariesAsync(experimentIds) {
        if (!experimentIds || experimentIds.length === 0) {
            return [];
        }

        const placeholders = experimentIds.map(() => '?').join(',');
        const sql = `
            SELECT * FROM experiment_summaries 
            WHERE experiment_id IN (${placeholders})
            ORDER BY computed_at DESC`;
        
        return await queryAsync(sql, experimentIds);
    }

    /**
     * Get all experiments that need summary computation
     * @returns {Promise<string[]>} Array of experiment IDs
     */
    async getExperimentsNeedingComputationAsync() {
        const sql = `
            SELECT e.id as experiment_id
            FROM experiments e
            LEFT JOIN experiment_summaries s ON e.id = s.experiment_id
            WHERE e.has_weld_journal = 1 
            AND (s.experiment_id IS NULL OR s.computation_status != 'complete')
            ORDER BY e.experiment_date DESC`;
        
        const results = await queryAsync(sql);
        return results.map(row => row.experiment_id);
    }

    /**
     * Get summary statistics
     * @returns {Promise<Object>} Summary statistics
     */
    async getSummaryStatsAsync() {
        const sql = `
            SELECT 
                COUNT(*) as total_summaries,
                COUNT(CASE WHEN computation_status = 'complete' THEN 1 END) as complete_summaries,
                COUNT(CASE WHEN computation_status = 'partial' THEN 1 END) as partial_summaries,
                COUNT(CASE WHEN computation_status = 'failed' THEN 1 END) as failed_summaries,
                COUNT(CASE WHEN has_errors = 1 THEN 1 END) as summaries_with_errors,
                MAX(computed_at) as latest_computation,
                AVG(file_completeness_percent) as avg_file_completeness
            FROM experiment_summaries`;
        
        return await querySingleAsync(sql);
    }

    /**
     * Clear all cached summaries (for maintenance)
     * @returns {Promise<number>} Number of deleted records
     */
    async clearAllSummariesAsync() {
        const sql = 'DELETE FROM experiment_summaries';
        const result = await executeAsync(sql);
        return result.changes;
    }

    /**
     * Clear expired summaries (older than specified days)
     * @param {number} daysOld - Delete summaries older than this many days
     * @returns {Promise<number>} Number of deleted records
     */
    async clearOldSummariesAsync(daysOld = 30) {
        const sql = `
            DELETE FROM experiment_summaries 
            WHERE computed_at < datetime('now', '-${daysOld} days')`;
        
        const result = await executeAsync(sql);
        return result.changes;
    }

    // === PRIVATE HELPER METHODS ===

    /**
     * Extract and flatten summary data for database storage
     * Converts nested ExperimentSummary object to flat database row
     * @param {ExperimentSummary} summary 
     * @returns {Object} Flattened data for database insertion
     */
    _extractSummaryData(summary) {
        return {
            experiment_id: summary.experimentId,
            computed_at: this._formatDateTime(summary.computedAt),
            computation_status: summary.computationStatus,
            data_sources_used: JSON.stringify(summary.dataSourcesUsed),
            has_errors: summary.errors.length > 0,
            errors_json: JSON.stringify(summary.errors),
            
            // Welding Performance - extract .value from formatted objects
            program: summary.weldingPerformance?.program,
            program_number: summary.weldingPerformance?.programNumber,
            program_name: summary.weldingPerformance?.programName,
            material: summary.weldingPerformance?.material,
            shape: summary.weldingPerformance?.shape,
            operator: summary.weldingPerformance?.operator,
            peak_force_kn: summary.weldingPerformance?.peakForce?.value,
            peak_current_gr1_a: summary.weldingPerformance?.peakCurrentGR1?.value,
            peak_current_gr2_a: summary.weldingPerformance?.peakCurrentGR2?.value,
            max_voltage_v: summary.weldingPerformance?.maxVoltage?.value,
            max_pressure_bar: summary.weldingPerformance?.maxPressure?.value,
            welding_duration_s: summary.weldingPerformance?.duration?.value,
            oil_temperature_c: summary.weldingPerformance?.oilTemperature?.value,
            
            // Tensile Results
            tensile_peak_force_kn: summary.tensileResults?.peakForce?.value,
            tensile_target_force_kn: summary.tensileResults?.targetForce?.value,
            tensile_min_force_limit_kn: summary.tensileResults?.minForceLimit?.value,
            tensile_result: summary.tensileResults?.result,
            tensile_max_displacement_mm: summary.tensileResults?.maxDisplacement?.value,
            tensile_material_grade: summary.tensileResults?.materialGrade,
            tensile_test_date: summary.tensileResults?.testDate,
            tensile_margin_percent: summary.tensileResults?.marginPercent,
            
            // Temperature Monitoring
            welding_temp_min_c: summary.temperatureMonitoring?.weldingTempRange?.min?.value,
            welding_temp_max_c: summary.temperatureMonitoring?.weldingTempRange?.max?.value,
            welding_temp_range_c: summary.temperatureMonitoring?.weldingTempRange?.range?.value,
            ambient_temp_min_c: summary.temperatureMonitoring?.ambientTempRange?.min?.value,
            ambient_temp_max_c: summary.temperatureMonitoring?.ambientTempRange?.max?.value,
            ambient_temp_range_c: summary.temperatureMonitoring?.ambientTempRange?.range?.value,
            temperature_duration_s: summary.temperatureMonitoring?.duration?.value,
            temperature_channels_json: JSON.stringify(summary.temperatureMonitoring?.channels || []),
            
            // Geometry and Position
            crown_inlet_warm_mm: summary.geometryAndPosition?.crownMeasurements?.warm?.inlet?.value,
            crown_inlet_cold_mm: summary.geometryAndPosition?.crownMeasurements?.cold?.inlet?.value,
            crown_outlet_warm_mm: summary.geometryAndPosition?.crownMeasurements?.warm?.outlet?.value,
            crown_outlet_cold_mm: summary.geometryAndPosition?.crownMeasurements?.cold?.outlet?.value,
            crown_difference_inlet_mm: summary.geometryAndPosition?.crownMeasurements?.differences?.inlet?.value,
            crown_difference_outlet_mm: summary.geometryAndPosition?.crownMeasurements?.differences?.outlet?.value,
            crown_measurement_interval_min: summary.geometryAndPosition?.crownMeasurements?.measurementInterval?.value,
            total_displacement_mm: summary.geometryAndPosition?.railMovement?.totalDisplacement?.value,
            position_min_mm: summary.geometryAndPosition?.railMovement?.positionRange?.min?.value,
            position_max_mm: summary.geometryAndPosition?.railMovement?.positionRange?.max?.value,
            rail_einlaufseite: summary.geometryAndPosition?.railInfo?.einlaufseite,
            rail_auslaufseite: summary.geometryAndPosition?.railInfo?.auslaufseite,
            
            // Vibration Analysis
            peak_acceleration_ms2: summary.vibrationAnalysis?.peakAcceleration?.value,
            max_acc_x_ms2: summary.vibrationAnalysis?.axisBreakdown?.x?.value,
            max_acc_y_ms2: summary.vibrationAnalysis?.axisBreakdown?.y?.value,
            max_acc_z_ms2: summary.vibrationAnalysis?.axisBreakdown?.z?.value,
            rms_x_ms2: summary.vibrationAnalysis?.rmsValues?.x?.value,
            rms_y_ms2: summary.vibrationAnalysis?.rmsValues?.y?.value,
            rms_z_ms2: summary.vibrationAnalysis?.rmsValues?.z?.value,
            rms_magnitude_ms2: summary.vibrationAnalysis?.rmsValues?.magnitude?.value,
            vibration_duration_s: summary.vibrationAnalysis?.duration?.value,
            vibration_sampling_rate_hz: summary.vibrationAnalysis?.samplingRate?.value,
            
            // File Availability
            file_completeness_percent: summary.fileAvailability?.completeness,
            critical_files_complete: summary.fileAvailability?.criticalFilesComplete,
            critical_files_count: summary.fileAvailability?.criticalFilesCount,
            total_files: summary.fileAvailability?.totalFiles,
            available_count: summary.fileAvailability?.availableCount,
            missing_count: summary.fileAvailability?.missingCount,
            available_files_json: JSON.stringify(summary.fileAvailability?.available || []),
            missing_files_json: JSON.stringify(summary.fileAvailability?.missing || [])
            
            // Note: created_at and updated_at are auto-generated by database DEFAULT CURRENT_TIMESTAMP
        };
    }

    /**
     * Format datetime for database storage
     * @param {Date} date 
     * @returns {string}
     */
    _formatDateTime(date) {
        if (!date) return null;
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;
        
        return d.getFullYear() + '-' + 
               String(d.getMonth() + 1).padStart(2, '0') + '-' + 
               String(d.getDate()).padStart(2, '0') + ' ' +
               String(d.getHours()).padStart(2, '0') + ':' + 
               String(d.getMinutes()).padStart(2, '0') + ':' + 
               String(d.getSeconds()).padStart(2, '0');
    }
}

module.exports = ExperimentSummaryRepository;