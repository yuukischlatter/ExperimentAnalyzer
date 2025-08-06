/**
 * Database Configuration
 * Database-specific settings and connection options
 */

const path = require('path');
const config = require('./config');

/**
 * SQLite database configuration
 */
const databaseConfig = {
    // Connection settings
    connection: {
        filename: config.database.fullPath,
        timeout: config.database.timeout,
        busyTimeout: config.database.timeout,
        
        // SQLite connection options
        mode: require('sqlite3').OPEN_READWRITE | require('sqlite3').OPEN_CREATE,
        
        // Enable foreign keys by default
        foreignKeys: true,
        
        // Journal mode for better concurrency
        journalMode: 'WAL',
        
        // Synchronous mode (NORMAL is good balance of safety/performance)
        synchronous: 'NORMAL'
    },
    
    // Schema file paths
    schema: {
        directory: path.join(__dirname, '..', 'database', 'schema'),
        files: {
            main: 'DatabaseSchema.sql',
            indexes: 'Indexes.sql'
        }
    },
    
    // Query timeouts and limits
    queries: {
        defaultTimeout: 30000, // 30 seconds
        maxRows: 10000,        // Maximum rows per query
        pageSize: 100          // Default pagination size
    },
    
    // Backup and maintenance
    maintenance: {
        autoVacuum: 'INCREMENTAL',
        vacuumInterval: 24 * 60 * 60 * 1000, // 24 hours in ms
        backupRetention: 7 // Keep 7 days of backups
    }
};

/**
 * Get database connection options for sqlite3
 * @returns {Object} Connection options
 */
function getConnectionOptions() {
    return {
        filename: databaseConfig.connection.filename,
        mode: databaseConfig.connection.mode,
        timeout: databaseConfig.connection.timeout
    };
}

/**
 * Get database pragma statements for initialization
 * @returns {string[]} Array of PRAGMA statements
 */
function getPragmaStatements() {
    return [
        'PRAGMA foreign_keys = ON',
        `PRAGMA journal_mode = ${databaseConfig.connection.journalMode}`,
        `PRAGMA synchronous = ${databaseConfig.connection.synchronous}`,
        `PRAGMA auto_vacuum = ${databaseConfig.maintenance.autoVacuum}`,
        'PRAGMA temp_store = MEMORY',
        'PRAGMA mmap_size = 268435456' // 256MB memory mapping
    ];
}

/**
 * Validate database configuration
 * @throws {Error} If configuration is invalid
 */
function validateConfig() {
    const errors = [];
    
    // Check required paths
    if (!databaseConfig.connection.filename) {
        errors.push('Database filename is required');
    }
    
    // Check timeout values
    if (databaseConfig.connection.timeout < 1000) {
        errors.push('Database timeout should be at least 1000ms');
    }
    
    if (errors.length > 0) {
        throw new Error(`Database configuration validation failed:\n${errors.join('\n')}`);
    }
}

module.exports = {
    databaseConfig,
    getConnectionOptions,
    getPragmaStatements,
    validateConfig
};