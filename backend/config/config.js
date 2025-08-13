/**
 * Application Configuration
 * Converts C# appsettings.json to Node.js environment-based config
 */

require('dotenv').config();
const path = require('path');

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || 5000,
        host: process.env.HOST || 'localhost',
        nodeEnv: process.env.NODE_ENV || 'development'
    },

    // Database Configuration (equivalent to ConnectionStrings in C#)
    database: {
        path: process.env.DB_PATH || 'experiments.db',
        timeout: parseInt(process.env.DB_TIMEOUT || '5000'),
        // Full path to database file
        fullPath: path.join(process.cwd(), process.env.DB_PATH || 'experiments.db')
    },

    // Experiment Settings (from C# ExperimentSettings)
    experiments: {
        rootPath: process.env.EXPERIMENT_ROOT_PATH || 'R:/Schweissungen',
        validDateFrom: process.env.EXPERIMENT_VALID_DATE_FROM || '2025-07-01'
    },

    // Application Settings
    app: {
        enableCors: process.env.ENABLE_CORS === 'true',
        enableLogging: process.env.ENABLE_LOGGING === 'true',
        autoScanOnStartup: process.env.AUTO_SCAN_ON_STARTUP === 'true'
    },

    // Frontend Configuration
    frontend: {
        // Path to frontend files (relative to backend)
        path: path.join(process.cwd(), '..', 'frontend'),
        // Static file serving options
        staticOptions: {
            maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
            etag: true
        }
    },

    // Thermal Analysis Configuration - ADDED
    thermal: {
        // Cache directory for converted thermal videos
        cacheDir: process.env.THERMAL_CACHE_DIR || path.join(process.cwd(), 'cache', 'thermal'),
        // Maximum concurrent video conversions
        maxConcurrentConversions: parseInt(process.env.THERMAL_MAX_CONVERSIONS || '2'),
        // Cache timeout (24 hours by default)
        cacheTimeoutHours: parseInt(process.env.THERMAL_CACHE_TIMEOUT_HOURS || '24')
    }
};

// Validation function
function validateConfig() {
    const errors = [];

    // Validate required paths
    if (!config.experiments.rootPath) {
        errors.push('EXPERIMENT_ROOT_PATH is required');
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(config.experiments.validDateFrom)) {
        errors.push('EXPERIMENT_VALID_DATE_FROM must be in YYYY-MM-DD format');
    }

    // Validate thermal configuration
    if (config.thermal.maxConcurrentConversions < 1) {
        errors.push('THERMAL_MAX_CONVERSIONS must be at least 1');
    }

    if (config.thermal.cacheTimeoutHours < 1) {
        errors.push('THERMAL_CACHE_TIMEOUT_HOURS must be at least 1');
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}

// Export configuration with validation
module.exports = {
    ...config,
    validate: validateConfig
};