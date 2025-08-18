/**
 * Application Configuration
 * Converts C# appsettings.json to Node.js environment-based config
 * MODIFIED: Fixed thermal cache to use same path for both dev and Electron
 */

require('dotenv').config();
const path = require('path');

// Detect if running in Electron environment
const isElectron = process.env.ELECTRON === 'true' || process.versions.electron;

// UNC path configuration for network drive
const UNC_BASE = '\\\\NAS\\projekt_1405';
const UNC_SCHWEISSUNGEN = `${UNC_BASE}\\Schweissungen`;

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || (isElectron ? 5001 : 5000), // Different port for Electron
        host: process.env.HOST || 'localhost',
        nodeEnv: process.env.NODE_ENV || 'development'
    },

    // Database Configuration (equivalent to ConnectionStrings in C#)
    database: {
        // MODIFIED: UNC path for Electron portable, R: drive for development
        path: isElectron 
            ? `${UNC_SCHWEISSUNGEN}\\experiments.db`
            : (process.env.DB_PATH || 'experiments.db'),
        timeout: parseInt(process.env.DB_TIMEOUT || '5000'),
        // Full path to database file
        fullPath: isElectron 
            ? `${UNC_SCHWEISSUNGEN}\\experiments.db`
            : path.join(process.cwd(), process.env.DB_PATH || 'experiments.db')
    },

    // Experiment Settings (from C# ExperimentSettings)
    experiments: {
        // MODIFIED: UNC path for Electron portable, R: drive for development
        rootPath: isElectron 
            ? UNC_SCHWEISSUNGEN
            : (process.env.EXPERIMENT_ROOT_PATH || 'R:/Schweissungen'),
        validDateFrom: process.env.EXPERIMENT_VALID_DATE_FROM || '2025-07-01'
    },

    // Application Settings
    app: {
        enableCors: process.env.ENABLE_CORS === 'true' || isElectron, // Always enable CORS for Electron
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

    // Thermal Analysis Configuration
    thermal: {
        // FIXED: Always use backend cache directory for both dev and Electron
        cacheDir: path.join(__dirname, '..', 'cache', 'thermal'),
        // Maximum concurrent video conversions
        maxConcurrentConversions: parseInt(process.env.THERMAL_MAX_CONVERSIONS || '2'),
        // Cache timeout (24 hours by default)
        cacheTimeoutHours: parseInt(process.env.THERMAL_CACHE_TIMEOUT_HOURS || '24')
    },

    // NEW: Electron-specific configuration with UNC support
    electron: {
        enabled: isElectron,
        // Network paths configuration
        network: {
            uncBase: UNC_BASE,
            uncSchweissungen: UNC_SCHWEISSUNGEN,
            databasePath: `${UNC_SCHWEISSUNGEN}\\experiments.db`,
            experimentsRoot: UNC_SCHWEISSUNGEN,
            // Fallback to R: drive if available
            tryDriveLetter: true,
            driveLetter: 'R:',
            driveRoot: 'R:\\Schweissungen'
        },
        // Development vs production behavior
        development: {
            openDevTools: process.env.NODE_ENV === 'development',
            enableLogging: true,
            allowUnsafeContent: true
        }
    }
};

// Enhanced validation function for Electron
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

    // NEW: Electron-specific validation
    if (isElectron) {
        // In Electron, network paths are mandatory
        if (!config.electron.network.uncSchweissungen.startsWith('\\\\')) {
            errors.push('Electron UNC path must be a valid network path');
        }
        
        // Validate port is different from default to avoid conflicts
        if (config.server.port === 5000) {
            errors.push('Electron should use port 5001 to avoid conflicts with development server');
        }
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}

// NEW: Network path accessibility check (Electron only)
function checkNetworkAccess() {
    if (!isElectron) {
        return true; // Skip check for non-Electron environments
    }

    const fs = require('fs');
    
    try {
        // First try UNC path
        const uncPath = config.experiments.rootPath;
        console.log(`📁 Checking UNC path: ${uncPath}`);
        
        if (fs.existsSync(uncPath)) {
            console.log(`✅ UNC path accessible: ${uncPath}`);
            
            // Test write access
            const testFile = path.join(uncPath, '.write_test_' + Date.now());
            try {
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
                console.log(`✅ Write access confirmed for UNC path`);
            } catch (writeError) {
                console.warn(`⚠️ Read-only access to UNC path: ${writeError.message}`);
            }
            
            return true;
        }
        
        // If UNC fails and tryDriveLetter is true, try R: drive
        if (config.electron.network.tryDriveLetter) {
            const drivePath = config.electron.network.driveRoot;
            console.log(`📁 UNC not accessible, trying drive letter: ${drivePath}`);
            
            if (fs.existsSync(drivePath)) {
                console.log(`✅ Drive letter accessible: ${drivePath}`);
                
                // Update config to use drive letter instead
                config.experiments.rootPath = drivePath;
                config.database.path = `${drivePath}\\experiments.db`;
                config.database.fullPath = `${drivePath}\\experiments.db`;
                
                console.log(`📝 Switched to drive letter paths`);
                return true;
            }
        }
        
        throw new Error(`Network path not accessible: ${uncPath}`);
        
    } catch (error) {
        console.error(`❌ Network access failed: ${error.message}`);
        
        if (isElectron) {
            // In Electron, network access is critical
            throw new Error(
                `Network path not accessible: ${error.message}\n\n` +
                'Please ensure:\n' +
                `• Network path ${config.electron.network.uncBase} is accessible\n` +
                '• You have read/write permissions\n' +
                '• VPN is connected (if required)\n' +
                '• Or map the network drive to R:\\'
            );
        }
        
        return false;
    }
}

// Legacy R: drive check for backward compatibility
function checkRDriveAccess() {
    // This function is now replaced by checkNetworkAccess
    // Keeping it for backward compatibility
    return checkNetworkAccess();
}

// NEW: Environment info logging
function logEnvironmentInfo() {
    console.log('🔧 Environment Configuration:');
    console.log(`   Mode: ${config.server.nodeEnv}`);
    console.log(`   Electron: ${isElectron ? 'Yes' : 'No'}`);
    console.log(`   Server: ${config.server.host}:${config.server.port}`);
    console.log(`   Database: ${config.database.fullPath}`);
    console.log(`   Experiments: ${config.experiments.rootPath}`);
    console.log(`   Thermal cache: ${config.thermal.cacheDir}`);
    
    if (isElectron) {
        console.log('📱 Electron Configuration:');
        console.log(`   UNC Base: ${config.electron.network.uncBase}`);
        console.log(`   UNC Experiments: ${config.electron.network.uncSchweissungen}`);
        console.log(`   Database: ${config.electron.network.databasePath}`);
        console.log(`   Try Drive Letter: ${config.electron.network.tryDriveLetter}`);
        console.log(`   Dev tools: ${config.electron.development.openDevTools}`);
    }
}

// Export configuration with validation and utilities
module.exports = {
    ...config,
    validate: validateConfig,
    checkRDriveAccess: checkRDriveAccess, // Legacy compatibility
    checkNetworkAccess: checkNetworkAccess,
    logEnvironmentInfo: logEnvironmentInfo,
    isElectron: isElectron
};