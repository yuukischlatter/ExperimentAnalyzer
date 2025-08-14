/**
 * Application Configuration
 * Converts C# appsettings.json to Node.js environment-based config
 * MODIFIED: Added Electron detection and R: drive database path
 */

require('dotenv').config();
const path = require('path');

// Detect if running in Electron environment
const isElectron = process.env.ELECTRON === 'true' || process.versions.electron;

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || (isElectron ? 5001 : 5000), // Different port for Electron
        host: process.env.HOST || 'localhost',
        nodeEnv: process.env.NODE_ENV || 'development'
    },

    // Database Configuration (equivalent to ConnectionStrings in C#)
    database: {
        // MODIFIED: R: drive path for Electron, local path for development
        path: isElectron 
            ? 'R:\\Schweissungen\\experiments.db'
            : (process.env.DB_PATH || 'experiments.db'),
        timeout: parseInt(process.env.DB_TIMEOUT || '5000'),
        // Full path to database file
        fullPath: isElectron 
            ? 'R:\\Schweissungen\\experiments.db'
            : path.join(process.cwd(), process.env.DB_PATH || 'experiments.db')
    },

    // Experiment Settings (from C# ExperimentSettings)
    experiments: {
        // MODIFIED: R: drive root for Electron, configurable for development
        rootPath: isElectron 
            ? 'R:\\Schweissungen'
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
        // Cache directory for converted thermal videos
        // MODIFIED: Keep thermal cache local even in Electron for performance
        cacheDir: isElectron 
            ? path.join(require('os').tmpdir(), 'experiment-analyzer-thermal')
            : (process.env.THERMAL_CACHE_DIR || path.join(process.cwd(), 'cache', 'thermal')),
        // Maximum concurrent video conversions
        maxConcurrentConversions: parseInt(process.env.THERMAL_MAX_CONVERSIONS || '2'),
        // Cache timeout (24 hours by default)
        cacheTimeoutHours: parseInt(process.env.THERMAL_CACHE_TIMEOUT_HOURS || '24')
    },

    // NEW: Electron-specific configuration
    electron: {
        enabled: isElectron,
        // R: drive configuration
        rDrive: {
            databasePath: 'R:\\Schweissungen\\experiments.db',
            experimentsRoot: 'R:\\Schweissungen',
            required: true, // No fallback - R: drive must be accessible
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
        // In Electron, R: drive paths are mandatory
        if (!config.electron.rDrive.databasePath.startsWith('R:\\')) {
            errors.push('Electron database path must be on R: drive');
        }
        
        if (!config.electron.rDrive.experimentsRoot.startsWith('R:\\')) {
            errors.push('Electron experiments root must be on R: drive');
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

// NEW: R: drive accessibility check (Electron only)
function checkRDriveAccess() {
    if (!isElectron) {
        return true; // Skip check for non-Electron environments
    }

    const fs = require('fs');
    
    try {
        // Check if R: drive exists
        const rDriveRoot = 'R:\\';
        if (!fs.existsSync(rDriveRoot)) {
            throw new Error('R: drive not found');
        }

        // Check if Schweissungen directory exists
        const schweissungenPath = config.experiments.rootPath;
        if (!fs.existsSync(schweissungenPath)) {
            console.log(`📁 Creating directory: ${schweissungenPath}`);
            fs.mkdirSync(schweissungenPath, { recursive: true });
        }

        // Test write access
        const testFile = path.join(schweissungenPath, '.write_test_' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);

        console.log(`✅ R: drive accessible: ${schweissungenPath}`);
        return true;

    } catch (error) {
        console.error(`❌ R: drive access failed: ${error.message}`);
        
        if (isElectron) {
            // In Electron, R: drive access is critical
            throw new Error(
                `R: drive not accessible: ${error.message}\n\n` +
                'Please ensure:\n' +
                '• R: drive is mapped and available\n' +
                '• You have read/write permissions to R:\\Schweissungen\n' +
                '• Network connection is stable'
            );
        }
        
        return false;
    }
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
        console.log(`   R: Database: ${config.electron.rDrive.databasePath}`);
        console.log(`   R: Experiments: ${config.electron.rDrive.experimentsRoot}`);
        console.log(`   Dev tools: ${config.electron.development.openDevTools}`);
    }
}

// Export configuration with validation and utilities
module.exports = {
    ...config,
    validate: validateConfig,
    checkRDriveAccess: checkRDriveAccess,
    logEnvironmentInfo: logEnvironmentInfo,
    isElectron: isElectron
};