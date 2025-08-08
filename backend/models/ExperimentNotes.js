/**
 * Experiment Notes Model
 * Data model for user notes on experiments
 * File: backend/models/ExperimentNotes.js
 */

class ExperimentNotes {
    constructor(data = {}) {
        this.experimentId = data.experimentId || data.experiment_id || '';
        this.notes = data.notes || '';
        this.createdAt = data.createdAt || data.created_at || new Date();
        this.updatedAt = data.updatedAt || data.updated_at || new Date();
    }

    /**
     * Convert to database format (for INSERT/UPDATE)
     * Converts JavaScript naming to database column names
     */
    toDatabaseFormat() {
        return {
            experiment_id: this.experimentId,
            notes: this.notes || '',
            created_at: formatDateTimeForDB(this.createdAt),
            updated_at: formatDateTimeForDB(this.updatedAt)
        };
    }

    /**
     * Create from database row
     * Converts database column names to JavaScript naming
     */
    static fromDatabaseRow(row) {
        if (!row) return null;
        
        return new ExperimentNotes({
            experimentId: row.experiment_id,
            notes: row.notes || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }

    /**
     * Validate notes data
     */
    validate() {
        const errors = [];

        if (!this.experimentId) {
            errors.push('Experiment ID is required');
        }

        if (this.notes && typeof this.notes !== 'string') {
            errors.push('Notes must be a string');
        }

        // Check notes length (reasonable limit)
        if (this.notes && this.notes.length > 50000) {
            errors.push('Notes cannot exceed 50,000 characters');
        }

        // Check for potentially dangerous content
        if (this.notes && this.containsScriptTags(this.notes)) {
            errors.push('Notes cannot contain script tags');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Check for script tags (basic XSS protection)
     */
    containsScriptTags(text) {
        const scriptRegex = /<script[^>]*>.*?<\/script>/gi;
        return scriptRegex.test(text);
    }

    /**
     * Get notes summary (first 100 characters)
     */
    getSummary(maxLength = 100) {
        if (!this.notes) return '';
        
        const cleaned = this.notes.trim();
        if (cleaned.length <= maxLength) return cleaned;
        
        return cleaned.substring(0, maxLength) + '...';
    }

    /**
     * Check if notes are empty
     */
    isEmpty() {
        return !this.notes || this.notes.trim() === '';
    }

    /**
     * Get word count
     */
    getWordCount() {
        if (!this.notes) return 0;
        return this.notes.trim().split(/\s+/).length;
    }

    /**
     * Get character count
     */
    getCharacterCount() {
        if (!this.notes) return 0;
        return this.notes.length;
    }

    /**
     * Update notes and timestamp
     */
    updateNotes(newNotes) {
        this.notes = newNotes || '';
        this.updatedAt = new Date();
    }

    /**
     * Create new notes entry
     */
    static createNew(experimentId, notes = '') {
        return new ExperimentNotes({
            experimentId: experimentId,
            notes: notes,
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    /**
     * Format for API response
     */
    toApiFormat() {
        return {
            experimentId: this.experimentId,
            notes: this.notes,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            summary: this.getSummary(),
            isEmpty: this.isEmpty(),
            wordCount: this.getWordCount(),
            characterCount: this.getCharacterCount()
        };
    }
}

/**
 * Format datetime for database (YYYY-MM-DD HH:mm:ss)
 */
function formatDateTimeForDB(date) {
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

module.exports = ExperimentNotes;