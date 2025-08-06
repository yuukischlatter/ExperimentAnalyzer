/**
 * Binary Data Processing Utilities
 * Mathematical functions for converting raw ADC values to physical measurements
 * Based on the oscilloscope hardware calibration and scaling factors
 */

// Voltage range lookup table
const VOLTAGE_RANGES = {
    0: 0.01, 1: 0.02, 2: 0.05, 3: 0.1, 4: 0.2, 5: 0.5,
    6: 1.0, 7: 2.0, 8: 5.0, 9: 10.0, 10: 20.0, 11: 50.0,
    12: 100.0, 13: 200.0
};

// Default colors for plotting
const PLOT_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', 
    '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'
];

/**
 * Convert ADC value to physical value
 */
function convertAdcToPhysical(rawAdc, maxAdcValue, channelRange, channelScaling) {
    const voltageRange = VOLTAGE_RANGES[channelRange] || 5.0;
    const millivolts = (rawAdc / maxAdcValue) * voltageRange * 1000;
    const physicalValue = (channelScaling / 1000.0) * millivolts;
    return physicalValue;
}

/**
 * Format file size in human readable format
 */
function formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Determine Y-axis assignment based on unit
 */
function getYAxisForUnit(unit) {
    switch (unit) {
        case 'V':
            return 'y';
        case 'A':
            return 'y2';
        case 'Bar':
            return 'y3';
        default:
            return 'y';
    }
}

/**
 * Get color for channel
 */
function getChannelColor(channelIndex) {
    return PLOT_COLORS[channelIndex % PLOT_COLORS.length];
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
    const result = {
        filename: null,
        port: 3000,
        help: false
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--help' || arg === '-h') {
            result.help = true;
        } else if (arg === '--port' || arg === '-p') {
            if (i + 1 < args.length) {
                result.port = parseInt(args[i + 1]);
                i++; // Skip next argument
            }
        } else if (!result.filename && !arg.startsWith('--')) {
            result.filename = arg;
        }
    }
    
    return result;
}

/**
 * Create timestamp string
 */
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Simple logger
 */
const Logger = {
    info: (message) => console.log(`[${getTimestamp()}] INFO: ${message}`),
    error: (message) => console.error(`[${getTimestamp()}] ERROR: ${message}`),
    warn: (message) => console.warn(`[${getTimestamp()}] WARN: ${message}`),
    debug: (message) => console.log(`[${getTimestamp()}] DEBUG: ${message}`)
};

module.exports = {
    VOLTAGE_RANGES,
    PLOT_COLORS,
    convertAdcToPhysical,
    formatFileSize,
    getYAxisForUnit,
    getChannelColor,
    parseArgs,
    Logger
};