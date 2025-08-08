/**
 * Database Connection Management
 * SQLite connection and initialization (equivalent to C# IDbConnection setup)
 * MODIFIED: Added ExperimentSummaries.sql schema loading
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');

let db = null;

/**
 * Get database connection (singleton pattern)
 */
function getDatabase() {
    if (!db) {
        db = new sqlite3.Database(config.database.fullPath, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                throw err;
            }
            console.log(`✓ Connected to SQLite database: ${config.database.fullPath}`);
        });

        // Configure database settings
        db.configure('busyTimeout', config.database.timeout);
        
        // Enable foreign keys (important for data integrity)
        db.run('PRAGMA foreign_keys = ON');
    }
    return db;
}

/**
 * Initialize database schema (equivalent to C# InitializeDatabaseAsync)
 * MODIFIED: Added experiment summaries schema loading
 */
async function initializeDatabase() {
    try {
        const database = getDatabase();
        
        // Define schema file paths
        const schemaPath = path.join(__dirname, 'schema', 'DatabaseSchema.sql');
        const notesSchemaPath = path.join(__dirname, 'schema', 'ExperimentNotes.sql');
        const summariesSchemaPath = path.join(__dirname, 'schema', 'ExperimentSummaries.sql');
        const indexPath = path.join(__dirname, 'schema', 'Indexes.sql');

        // Execute main schema (experiments + metadata tables)
        if (await fileExists(schemaPath)) {
            const schema = await fs.readFile(schemaPath, 'utf8');
            await executeSQL(database, schema);
            console.log('✓ Database schema created/updated');
        } else {
            console.warn('⚠ DatabaseSchema.sql not found, skipping schema creation');
        }

        // Execute experiment notes schema
        if (await fileExists(notesSchemaPath)) {
            const notesSchema = await fs.readFile(notesSchemaPath, 'utf8');
            await executeSQL(database, notesSchema);
            console.log('✓ Experiment notes schema created/updated');
        } else {
            console.warn('⚠ ExperimentNotes.sql not found, skipping notes schema creation');
        }

        // Execute experiment summaries schema (NEW)
        if (await fileExists(summariesSchemaPath)) {
            const summariesSchema = await fs.readFile(summariesSchemaPath, 'utf8');
            await executeSQL(database, summariesSchema);
            console.log('✓ Experiment summaries schema created/updated');
        } else {
            console.warn('⚠ ExperimentSummaries.sql not found, skipping summaries schema creation');
        }

        // Execute indexes
        if (await fileExists(indexPath)) {
            const indexes = await fs.readFile(indexPath, 'utf8');
            await executeSQL(database, indexes);
            console.log('✓ Database indexes created/updated');
        } else {
            console.warn('⚠ Indexes.sql not found, skipping index creation');
        }

        // Verify critical tables exist
        await verifyDatabaseTables(database);

        return true;
    } catch (error) {
        console.error('Database initialization failed:', error);
        throw error;
    }
}

/**
 * Verify that all critical database tables exist (NEW)
 */
async function verifyDatabaseTables(database) {
    const criticalTables = [
        'experiments',
        'experiment_metadata', 
        'experiment_notes',
        'experiment_summaries'
    ];

    console.log('🔍 Verifying database tables...');
    
    for (const tableName of criticalTables) {
        try {
            const result = await querySingleAsync(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='${tableName}'
            `);
            
            if (result) {
                console.log(`  ✓ Table '${tableName}' exists`);
                
                // Get row count for non-empty tables
                const countResult = await querySingleAsync(`SELECT COUNT(*) as count FROM ${tableName}`);
                if (countResult && countResult.count > 0) {
                    console.log(`    📊 ${countResult.count} rows`);
                }
            } else {
                console.warn(`  ⚠ Table '${tableName}' missing!`);
            }
        } catch (error) {
            console.error(`  ❌ Error checking table '${tableName}':`, error.message);
        }
    }
}

/**
 * Execute SQL statement (promisified)
 */
function executeSQL(database, sql) {
    return new Promise((resolve, reject) => {
        database.exec(sql, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Run SQL query (promisified) - equivalent to Dapper QueryAsync
 */
function queryAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        const database = getDatabase();
        database.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

/**
 * Run SQL query and get single result (promisified) - equivalent to Dapper QuerySingleAsync
 */
function querySingleAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        const database = getDatabase();
        database.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

/**
 * Execute SQL command (promisified) - equivalent to Dapper ExecuteAsync
 */
function executeAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        const database = getDatabase();
        database.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({
                    changes: this.changes,
                    lastID: this.lastID
                });
            }
        });
    });
}

/**
 * Get experiment count (helper function)
 */
async function getExperimentCount() {
    try {
        const result = await querySingleAsync('SELECT COUNT(*) as count FROM experiments');
        return result ? result.count : 0;
    } catch (error) {
        console.error('Error getting experiment count:', error);
        return 0;
    }
}

/**
 * Get summary count (NEW helper function)
 */
async function getSummaryCount() {
    try {
        const result = await querySingleAsync('SELECT COUNT(*) as count FROM experiment_summaries');
        return result ? result.count : 0;
    } catch (error) {
        console.error('Error getting summary count:', error);
        return 0;
    }
}

/**
 * Get database statistics (NEW)
 */
async function getDatabaseStats() {
    try {
        const stats = {
            experiments: await getExperimentCount(),
            summaries: await getSummaryCount()
        };
        
        // Get notes count
        try {
            const notesResult = await querySingleAsync('SELECT COUNT(*) as count FROM experiment_notes');
            stats.notes = notesResult ? notesResult.count : 0;
        } catch (error) {
            stats.notes = 0;
        }
        
        // Get summary completion stats
        try {
            const summaryStats = await querySingleAsync(`
                SELECT 
                    COUNT(CASE WHEN computation_status = 'complete' THEN 1 END) as complete,
                    COUNT(CASE WHEN computation_status = 'partial' THEN 1 END) as partial,
                    COUNT(CASE WHEN computation_status = 'failed' THEN 1 END) as failed
                FROM experiment_summaries
            `);
            stats.summariesComplete = summaryStats?.complete || 0;
            stats.summariesPartial = summaryStats?.partial || 0;
            stats.summariesFailed = summaryStats?.failed || 0;
        } catch (error) {
            stats.summariesComplete = 0;
            stats.summariesPartial = 0;
            stats.summariesFailed = 0;
        }
        
        return stats;
    } catch (error) {
        console.error('Error getting database statistics:', error);
        return {
            experiments: 0,
            summaries: 0,
            notes: 0,
            summariesComplete: 0,
            summariesPartial: 0,
            summariesFailed: 0
        };
    }
}

/**
 * Close database connection
 */
function closeDatabase() {
    if (db) {
        return new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    db = null;
                    console.log('✓ Database connection closed');
                    resolve();
                }
            });
        });
    }
    return Promise.resolve();
}

/**
 * Check if file exists
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Export all database functions
module.exports = {
    getDatabase,
    initializeDatabase,
    queryAsync,
    querySingleAsync,
    executeAsync,
    getExperimentCount,
    getSummaryCount,        
    getDatabaseStats,       
    closeDatabase
};