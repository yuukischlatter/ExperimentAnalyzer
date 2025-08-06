/**
 * Utility Helper Functions
 * Common utilities used across the application
 */

const path = require('path');
const fs = require('fs').promises;

/**
 * Date formatting helpers
 */
const DateHelpers = {
    /**
     * Format date for database storage (YYYY-MM-DD)
     * @param {Date|string} date 
     * @returns {string|null}
     */
    formatDateForDB(date) {
        if (!date) return null;
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;
        
        return d.getFullYear() + '-' + 
               String(d.getMonth() + 1).padStart(2, '0') + '-' + 
               String(d.getDate()).padStart(2, '0');
    },

    /**
     * Format datetime for database storage (YYYY-MM-DD HH:mm:ss)
     * @param {Date|string} date 
     * @returns {string|null}
     */
    formatDateTimeForDB(date) {
        if (!date) return null;
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;
        
        return d.getFullYear() + '-' + 
               String(d.getMonth() + 1).padStart(2, '0') + '-' + 
               String(d.getDate()).padStart(2, '0') + ' ' +
               String(d.getHours()).padStart(2, '0') + ':' + 
               String(d.getMinutes()).padStart(2, '0') + ':' + 
               String(d.getSeconds()).padStart(2, '0');
    },

    /**
     * Parse German date format (DD.MM.YYYY)
     * @param {string} dateString 
     * @returns {Date|null}
     */
    parseGermanDate(dateString) {
        if (!dateString) return null;
        const parts = dateString.split('.');
        if (parts.length !== 3) return null;
        
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        
        const date = new Date(year, month - 1, day);
        return isNaN(date.getTime()) ? null : date;
    }
};

/**
 * File system helpers
 */
const FileHelpers = {
    /**
     * Check if file exists
     * @param {string} filePath 
     * @returns {Promise<boolean>}
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Ensure directory exists (create if needed)
     * @param {string} dirPath 
     * @returns {Promise<void>}
     */
    async ensureDirectory(dirPath) {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    },

    /**
     * Get file extension (lowercase)
     * @param {string} filePath 
     * @returns {string}
     */
    getFileExtension(filePath) {
        return path.extname(filePath).toLowerCase();
    },

    /**
     * Check if file is image by extension
     * @param {string} filePath 
     * @returns {boolean}
     */
    isImageFile(filePath) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif'];
        return imageExtensions.includes(this.getFileExtension(filePath));
    }
};

/**
 * String helpers
 */
const StringHelpers = {
    /**
     * Truncate string to max length with ellipsis
     * @param {string} str 
     * @param {number} maxLength 
     * @returns {string}
     */
    truncate(str, maxLength) {
        if (!str || str.length <= maxLength) return str || '';
        return str.substring(0, maxLength) + '...';
    },

    /**
     * Clean and normalize string (remove extra whitespace, etc.)
     * @param {string} str 
     * @returns {string}
     */
    clean(str) {
        if (!str) return '';
        return str.trim().replace(/\s+/g, ' ');
    },

    /**
     * Parse numeric value from string (German decimal format)
     * @param {string} str 
     * @returns {number|null}
     */
    parseGermanNumber(str) {
        if (!str) return null;
        // Replace comma with dot for decimal parsing
        const normalized = str.replace(',', '.');
        const num = parseFloat(normalized);
        return isNaN(num) ? null : num;
    }
};

/**
 * Validation helpers
 */
const ValidationHelpers = {
    /**
     * Validate experiment ID format (J25-07-30(1))
     * @param {string} experimentId 
     * @returns {boolean}
     */
    isValidExperimentId(experimentId) {
        if (!experimentId) return false;
        return /^J\d{2}-\d{2}-\d{2}\(\d+\)$/.test(experimentId);
    },

    /**
     * Validate email format
     * @param {string} email 
     * @returns {boolean}
     */
    isValidEmail(email) {
        if (!email) return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    /**
     * Check if value is numeric
     * @param {any} value 
     * @returns {boolean}
     */
    isNumeric(value) {
        return !isNaN(parseFloat(value)) && isFinite(value);
    }
};

/**
 * Error helpers
 */
const ErrorHelpers = {
    /**
     * Create standardized error object
     * @param {string} message 
     * @param {string} code 
     * @param {Object} details 
     * @returns {Error}
     */
    createError(message, code = 'GENERIC_ERROR', details = {}) {
        const error = new Error(message);
        error.code = code;
        error.details = details;
        return error;
    },

    /**
     * Check if error is operational (expected) vs programming error
     * @param {Error} error 
     * @returns {boolean}
     */
    isOperationalError(error) {
        const operationalCodes = [
            'ENOENT', 'EACCES', 'VALIDATION_ERROR', 
            'NOT_FOUND', 'DUPLICATE_ENTRY'
        ];
        return operationalCodes.includes(error.code);
    }
};

/**
 * Performance helpers
 */
const PerformanceHelpers = {
    /**
     * Create a performance timer
     * @param {string} label 
     * @returns {Object} Timer with stop() method
     */
    createTimer(label) {
        const startTime = Date.now();
        return {
            stop() {
                const duration = Date.now() - startTime;
                console.log(`${label}: ${duration}ms`);
                return duration;
            },
            getDuration() {
                return Date.now() - startTime;
            }
        };
    },

    /**
     * Delay execution (for testing/throttling)
     * @param {number} ms 
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

// Export all helpers
module.exports = {
    DateHelpers,
    FileHelpers,
    StringHelpers,
    ValidationHelpers,
    ErrorHelpers,
    PerformanceHelpers
};