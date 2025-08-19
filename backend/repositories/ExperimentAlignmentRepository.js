/**
 * Experiment Alignment Repository
 * Database operations for experiment timeline alignment data
 * Handles CRUD operations for experiment_alignments table
 */

const { queryAsync, querySingleAsync, executeAsync } = require('../Database/connection');

class ExperimentAlignmentRepository {
    constructor() {
        this.tableName = 'experiment_alignments';
    }

    /**
     * Get alignment data for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object|null>} Alignment data or null if not found
     */
    async getAlignmentAsync(experimentId) {
        try {
            const sql = `
                SELECT 
                    experiment_id,
                    master_timeline_start_unix,
                    master_timeline_duration_s,
                    temperature_alignment_offset_s,
                    acceleration_alignment_offset_s,
                    position_alignment_offset_s,
                    temperature_manual_override,
                    acceleration_manual_override,
                    position_manual_override,
                    calculated_at,
                    updated_at
                FROM ${this.tableName}
                WHERE experiment_id = ?
            `;

            const result = await querySingleAsync(sql, [experimentId]);
            return result || null;

        } catch (error) {
            console.error(`Error getting alignment for experiment ${experimentId}:`, error);
            throw new Error(`Failed to get alignment data: ${error.message}`);
        }
    }

    /**
     * Save or update alignment data for an experiment
     * @param {string} experimentId - Experiment ID
     * @param {Object} alignmentData - Alignment data to save
     * @returns {Promise<boolean>} Success status
     */
    async saveAlignmentAsync(experimentId, alignmentData) {
        try {
            const {
                masterTimelineStartUnix,
                masterTimelineDurationS,
                temperatureAlignmentOffsetS = null,
                accelerationAlignmentOffsetS = null,
                positionAlignmentOffsetS = null,
                temperatureManualOverride = false,
                accelerationManualOverride = false,
                positionManualOverride = false
            } = alignmentData;

            // Validate required fields
            if (masterTimelineStartUnix == null || masterTimelineDurationS == null) {
                throw new Error('Master timeline start and duration are required');
            }

            // Use UPSERT (INSERT OR REPLACE) for SQLite
            const sql = `
                INSERT OR REPLACE INTO ${this.tableName} (
                    experiment_id,
                    master_timeline_start_unix,
                    master_timeline_duration_s,
                    temperature_alignment_offset_s,
                    acceleration_alignment_offset_s,
                    position_alignment_offset_s,
                    temperature_manual_override,
                    acceleration_manual_override,
                    position_manual_override,
                    calculated_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;

            const params = [
                experimentId,
                masterTimelineStartUnix,
                masterTimelineDurationS,
                temperatureAlignmentOffsetS,
                accelerationAlignmentOffsetS,
                positionAlignmentOffsetS,
                temperatureManualOverride ? 1 : 0,
                accelerationManualOverride ? 1 : 0,
                positionManualOverride ? 1 : 0
            ];

            const result = await executeAsync(sql, params);
            
            console.log(`Alignment data saved for experiment ${experimentId}`);
            return result.changes > 0;

        } catch (error) {
            console.error(`Error saving alignment for experiment ${experimentId}:`, error);
            throw new Error(`Failed to save alignment data: ${error.message}`);
        }
    }

    /**
     * Update specific alignment offset (for manual adjustments)
     * @param {string} experimentId - Experiment ID
     * @param {string} offsetType - Type of offset ('temperature', 'acceleration', 'position')
     * @param {number} offsetValue - New offset value in seconds
     * @param {boolean} isManualOverride - Whether this is a manual override
     * @returns {Promise<boolean>} Success status
     */
    async updateAlignmentOffsetAsync(experimentId, offsetType, offsetValue, isManualOverride = false) {
        try {
            // Validate offset type
            const validTypes = ['temperature', 'acceleration', 'position'];
            if (!validTypes.includes(offsetType)) {
                throw new Error(`Invalid offset type: ${offsetType}. Must be one of: ${validTypes.join(', ')}`);
            }

            const offsetColumn = `${offsetType}_alignment_offset_s`;
            const overrideColumn = `${offsetType}_manual_override`;

            const sql = `
                UPDATE ${this.tableName}
                SET 
                    ${offsetColumn} = ?,
                    ${overrideColumn} = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE experiment_id = ?
            `;

            const params = [offsetValue, isManualOverride ? 1 : 0, experimentId];
            const result = await executeAsync(sql, params);

            if (result.changes === 0) {
                throw new Error(`No alignment record found for experiment ${experimentId}`);
            }

            console.log(`Updated ${offsetType} alignment offset for experiment ${experimentId}: ${offsetValue}s (manual: ${isManualOverride})`);
            return true;

        } catch (error) {
            console.error(`Error updating ${offsetType} alignment for experiment ${experimentId}:`, error);
            throw new Error(`Failed to update alignment offset: ${error.message}`);
        }
    }

    /**
     * Delete alignment data for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteAlignmentAsync(experimentId) {
        try {
            const sql = `DELETE FROM ${this.tableName} WHERE experiment_id = ?`;
            const result = await executeAsync(sql, [experimentId]);

            console.log(`Deleted alignment data for experiment ${experimentId}`);
            return result.changes > 0;

        } catch (error) {
            console.error(`Error deleting alignment for experiment ${experimentId}:`, error);
            throw new Error(`Failed to delete alignment data: ${error.message}`);
        }
    }

    /**
     * Check if alignment exists for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if alignment exists
     */
    async hasAlignmentAsync(experimentId) {
        try {
            const sql = `SELECT 1 FROM ${this.tableName} WHERE experiment_id = ? LIMIT 1`;
            const result = await querySingleAsync(sql, [experimentId]);
            return result !== null;

        } catch (error) {
            console.error(`Error checking alignment existence for experiment ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Get alignment statistics
     * @returns {Promise<Object>} Alignment statistics
     */
    async getAlignmentStatsAsync() {
        try {
            const totalSql = `SELECT COUNT(*) as total FROM ${this.tableName}`;
            const totalResult = await querySingleAsync(totalSql);

            const manualOverridesSql = `
                SELECT 
                    COUNT(CASE WHEN temperature_manual_override = 1 THEN 1 END) as temperature_manual,
                    COUNT(CASE WHEN acceleration_manual_override = 1 THEN 1 END) as acceleration_manual,
                    COUNT(CASE WHEN position_manual_override = 1 THEN 1 END) as position_manual
                FROM ${this.tableName}
            `;
            const overrideResult = await querySingleAsync(manualOverridesSql);

            const recentSql = `
                SELECT COUNT(*) as recent
                FROM ${this.tableName}
                WHERE calculated_at > datetime('now', '-24 hours')
            `;
            const recentResult = await querySingleAsync(recentSql);

            return {
                totalAlignments: totalResult?.total || 0,
                manualOverrides: {
                    temperature: overrideResult?.temperature_manual || 0,
                    acceleration: overrideResult?.acceleration_manual || 0,
                    position: overrideResult?.position_manual || 0
                },
                recentlyCalculated: recentResult?.recent || 0
            };

        } catch (error) {
            console.error('Error getting alignment statistics:', error);
            return {
                totalAlignments: 0,
                manualOverrides: { temperature: 0, acceleration: 0, position: 0 },
                recentlyCalculated: 0
            };
        }
    }

    /**
     * Get experiments with alignment data (for debugging/admin)
     * @param {number} limit - Maximum number of results
     * @returns {Promise<Array>} Array of alignment records
     */
    async getAllAlignmentsAsync(limit = 100) {
        try {
            const sql = `
                SELECT 
                    experiment_id,
                    master_timeline_start_unix,
                    master_timeline_duration_s,
                    temperature_alignment_offset_s,
                    acceleration_alignment_offset_s,
                    position_alignment_offset_s,
                    temperature_manual_override,
                    acceleration_manual_override,
                    position_manual_override,
                    calculated_at,
                    updated_at
                FROM ${this.tableName}
                ORDER BY updated_at DESC
                LIMIT ?
            `;

            const results = await queryAsync(sql, [limit]);
            return results || [];

        } catch (error) {
            console.error('Error getting all alignments:', error);
            return [];
        }
    }

    /**
     * Get experiments that need alignment recalculation
     * @returns {Promise<Array>} Array of experiment IDs
     */
    async getExperimentsNeedingAlignmentAsync() {
        try {
            // Find experiments that exist but don't have alignment data
            const sql = `
                SELECT e.id
                FROM experiments e
                LEFT JOIN ${this.tableName} a ON e.id = a.experiment_id
                WHERE a.experiment_id IS NULL
                  AND (e.has_bin_file = 1 OR e.has_ambient_temperature = 1)
                ORDER BY e.experiment_date DESC
            `;

            const results = await queryAsync(sql);
            return results ? results.map(r => r.id) : [];

        } catch (error) {
            console.error('Error finding experiments needing alignment:', error);
            return [];
        }
    }
}

module.exports = ExperimentAlignmentRepository;