/**
 * Database Connection Management
 * SQLite connection and initialization (equivalent to C# IDbConnection setup)
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
 */
async function initializeDatabase() {
    try {
        const database = getDatabase();
        
        // Read and execute schema files
        const schemaPath = path.join(__dirname, 'schema', 'DatabaseSchema.sql');
        const notesSchemaPath = path.join(__dirname, 'schema', 'ExperimentNotes.sql');
        const indexPath = path.join(__dirname, 'schema', 'Indexes.sql');

        // Execute main schema
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

        // Execute indexes
        if (await fileExists(indexPath)) {
            const indexes = await fs.readFile(indexPath, 'utf8');
            await executeSQL(database, indexes);
            console.log('✓ Database indexes created/updated');
        } else {
            console.warn('⚠ Indexes.sql not found, skipping index creation');
        }

        return true;
    } catch (error) {
        console.error('Database initialization failed:', error);
        throw error;
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
    closeDatabase
};