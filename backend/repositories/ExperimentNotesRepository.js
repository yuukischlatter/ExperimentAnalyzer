/**
 * Experiment Notes Repository
 * Database operations for experiment notes
 * File: backend/repositories/ExperimentNotesRepository.js
 */

const { queryAsync, querySingleAsync, executeAsync } = require('../database/connection');
const ExperimentNotes = require('../models/ExperimentNotes');

class ExperimentNotesRepository {
    
    // === SINGLE NOTES OPERATIONS ===

    /**
     * Get notes for a specific experiment
     * @param {string} experimentId 
     * @returns {Promise<ExperimentNotes|null>}
     */
    async getNotesAsync(experimentId) {
        const sql = `
            SELECT 
                experiment_id,
                notes,
                created_at,
                updated_at
            FROM experiment_notes 
            WHERE experiment_id = ?`;
        
        const row = await querySingleAsync(sql, [experimentId]);
        return ExperimentNotes.fromDatabaseRow(row);
    }

    /**
     * Insert or update experiment notes
     * @param {ExperimentNotes} experimentNotes 
     * @returns {Promise<void>}
     */
    async upsertNotesAsync(experimentNotes) {
        // Validate before saving
        const validation = experimentNotes.validate();
        if (!validation.isValid) {
            throw new Error(`Notes validation failed: ${validation.errors.join(', ')}`);
        }

        const sql = `
            INSERT OR REPLACE INTO experiment_notes (
                experiment_id, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?)`;

        const dbData = experimentNotes.toDatabaseFormat();
        const params = [
            dbData.experiment_id,
            dbData.notes,
            dbData.created_at,
            dbData.updated_at
        ];

        await executeAsync(sql, params);
    }

    /**
     * Delete notes for an experiment
     * @param {string} experimentId 
     * @returns {Promise<boolean>} True if notes were deleted
     */
    async deleteNotesAsync(experimentId) {
        const sql = 'DELETE FROM experiment_notes WHERE experiment_id = ?';
        const result = await executeAsync(sql, [experimentId]);
        return result.changes > 0;
    }

    /**
     * Check if notes exist for experiment
     * @param {string} experimentId 
     * @returns {Promise<boolean>}
     */
    async notesExistAsync(experimentId) {
        const sql = 'SELECT COUNT(*) as count FROM experiment_notes WHERE experiment_id = ?';
        const result = await querySingleAsync(sql, [experimentId]);
        return result.count > 0;
    }

    // === BULK OPERATIONS ===

    /**
     * Get all experiment notes
     * @param {string} sortBy - 'updated' or 'created'
     * @param {string} sortDirection - 'asc' or 'desc'
     * @returns {Promise<ExperimentNotes[]>}
     */
    async getAllNotesAsync(sortBy = 'updated', sortDirection = 'desc') {
        const orderColumn = sortBy === 'created' ? 'created_at' : 'updated_at';
        const direction = sortDirection.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        
        const sql = `
            SELECT 
                experiment_id,
                notes,
                created_at,
                updated_at
            FROM experiment_notes 
            ORDER BY ${orderColumn} ${direction}`;
        
        const rows = await queryAsync(sql);
        return rows.map(row => ExperimentNotes.fromDatabaseRow(row));
    }

    /**
     * Get notes for multiple experiments
     * @param {string[]} experimentIds 
     * @returns {Promise<ExperimentNotes[]>}
     */
    async getMultipleNotesAsync(experimentIds) {
        if (!experimentIds || experimentIds.length === 0) {
            return [];
        }

        // Create placeholders for IN clause
        const placeholders = experimentIds.map(() => '?').join(',');
        
        const sql = `
            SELECT 
                experiment_id,
                notes,
                created_at,
                updated_at
            FROM experiment_notes 
            WHERE experiment_id IN (${placeholders})
            ORDER BY updated_at DESC`;
        
        const rows = await queryAsync(sql, experimentIds);
        return rows.map(row => ExperimentNotes.fromDatabaseRow(row));
    }

    /**
     * Get notes updated since a specific date
     * @param {Date} since 
     * @returns {Promise<ExperimentNotes[]>}
     */
    async getNotesUpdatedSinceAsync(since) {
        const sql = `
            SELECT 
                experiment_id,
                notes,
                created_at,
                updated_at
            FROM experiment_notes 
            WHERE updated_at > ?
            ORDER BY updated_at DESC`;
        
        const sinceString = since.toISOString().replace('T', ' ').substring(0, 19);
        const rows = await queryAsync(sql, [sinceString]);
        return rows.map(row => ExperimentNotes.fromDatabaseRow(row));
    }

    /**
     * Get notes with non-empty content
     * @returns {Promise<ExperimentNotes[]>}
     */
    async getNotesWithContentAsync() {
        const sql = `
            SELECT 
                experiment_id,
                notes,
                created_at,
                updated_at
            FROM experiment_notes 
            WHERE notes IS NOT NULL AND TRIM(notes) != ''
            ORDER BY updated_at DESC`;
        
        const rows = await queryAsync(sql);
        return rows.map(row => ExperimentNotes.fromDatabaseRow(row));
    }

    // === STATISTICS ===

    /**
     * Get total notes count
     * @returns {Promise<number>}
     */
    async getNotesCountAsync() {
        const sql = 'SELECT COUNT(*) as count FROM experiment_notes';
        const result = await querySingleAsync(sql);
        return result.count;
    }

    /**
     * Get count of notes with content
     * @returns {Promise<number>}
     */
    async getNotesWithContentCountAsync() {
        const sql = `
            SELECT COUNT(*) as count 
            FROM experiment_notes 
            WHERE notes IS NOT NULL AND TRIM(notes) != ''`;
        const result = await querySingleAsync(sql);
        return result.count;
    }

    /**
     * Get notes statistics
     * @returns {Promise<Object>}
     */
    async getNotesStatsAsync() {
        const sql = `
            SELECT 
                COUNT(*) as totalNotes,
                COUNT(CASE WHEN notes IS NOT NULL AND TRIM(notes) != '' THEN 1 END) as notesWithContent,
                MAX(updated_at) as lastUpdated,
                AVG(LENGTH(notes)) as avgLength
            FROM experiment_notes`;
        
        const result = await querySingleAsync(sql);
        
        return {
            totalNotes: result.totalNotes || 0,
            notesWithContent: result.notesWithContent || 0,
            emptyNotes: (result.totalNotes || 0) - (result.notesWithContent || 0),
            lastUpdated: result.lastUpdated,
            averageLength: Math.round(result.avgLength || 0)
        };
    }

    // === SEARCH OPERATIONS ===

    /**
     * Search notes by content
     * @param {string} searchTerm 
     * @returns {Promise<ExperimentNotes[]>}
     */
    async searchNotesAsync(searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') {
            return [];
        }

        const sql = `
            SELECT 
                experiment_id,
                notes,
                created_at,
                updated_at
            FROM experiment_notes 
            WHERE notes LIKE ?
            ORDER BY updated_at DESC`;
        
        const searchPattern = `%${searchTerm.trim()}%`;
        const rows = await queryAsync(sql, [searchPattern]);
        return rows.map(row => ExperimentNotes.fromDatabaseRow(row));
    }

    // === MAINTENANCE OPERATIONS ===

    /**
     * Delete all empty notes
     * @returns {Promise<number>} Number of deleted records
     */
    async deleteEmptyNotesAsync() {
        const sql = `
            DELETE FROM experiment_notes 
            WHERE notes IS NULL OR TRIM(notes) = ''`;
        
        const result = await executeAsync(sql);
        return result.changes;
    }

    /**
     * Clean up orphaned notes (experiments that no longer exist)
     * @returns {Promise<number>} Number of deleted records
     */
    async deleteOrphanedNotesAsync() {
        const sql = `
            DELETE FROM experiment_notes 
            WHERE experiment_id NOT IN (
                SELECT id FROM experiments
            )`;
        
        const result = await executeAsync(sql);
        return result.changes;
    }
}

module.exports = ExperimentNotesRepository;