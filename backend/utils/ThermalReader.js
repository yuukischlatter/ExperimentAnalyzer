/**
 * Thermal Reader - Adapter Layer
 * Adapts thermal_engine native module to match HDF5Reader.js interface
 * Provides consistent API for thermal AVI files in the experiment system
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');

class ThermalReader {
    constructor(aviFilePath, csvMappingPath) {
        this.filename = aviFilePath;
        this.csvMappingPath = csvMappingPath;
        this.metadata = {};
        this.rawData = {}; // Not used in thermal - mapped to empty for compatibility
        this.calculatedData = {}; // Maps to thermal analysis capabilities
        this.processingStats = {};
        
        // Thermal-specific properties
        this.nativeEngine = null;
        this.videoInfo = {};
        this.temperatureMapping = null;
        this.isValidated = false;
        this.validationErrors = [];
        
        console.log(`ThermalReader initialized for: ${path.basename(this.filename)}`);
    }

    /**
     * Validate thermal files before processing
     * @returns {Promise<Object>} Validation result
     */
    async validateFile() {
        const startTime = process.hrtime.bigint();
        const errors = [];
        
        try {
            // Check AVI file exists
            try {
                await fs.access(this.filename);
            } catch (error) {
                errors.push(`AVI file not found: ${this.filename}`);
            }

            // Check CSV mapping file exists
            try {
                await fs.access(this.csvMappingPath);
            } catch (error) {
                errors.push(`Temperature mapping file not found: ${this.csvMappingPath}`);
            }

            if (errors.length > 0) {
                return { isValid: false, errors };
            }

            // Check AVI file size
            const aviStats = await fs.stat(this.filename);
            const fileSizeGB = aviStats.size / (1024 * 1024 * 1024);
            
            if (aviStats.size === 0) {
                errors.push('AVI file is empty');
            } else if (fileSizeGB > 5) {
                errors.push(`AVI file very large: ${fileSizeGB.toFixed(1)}GB (performance may be affected)`);
            }

            // Check file extension
            const ext = path.extname(this.filename).toLowerCase();
            const validExtensions = config.thermal?.supportedVideoFormats || ['.avi'];
            if (!validExtensions.includes(ext)) {
                errors.push(`Invalid file extension: ${ext}. Expected: ${validExtensions.join(', ')}`);
            }

            // Check CSV file format
            const csvStats = await fs.stat(this.csvMappingPath);
            if (csvStats.size === 0) {
                errors.push('Temperature mapping CSV is empty');
            }

            // Try to load native engine for basic validation
            try {
                this._loadNativeEngine();
                console.log(`Validating thermal files: ${path.basename(this.filename)}`);
            } catch (error) {
                errors.push(`Native engine validation failed: ${error.message}`);
            }

            const duration = Number(process.hrtime.bigint() - startTime) / 1e6; // ms
            this.processingStats.validationTime = duration;
            this.isValidated = errors.length === 0;
            this.validationErrors = errors;

            return {
                isValid: this.isValidated,
                errors: errors,
                aviFileSize: aviStats.size,
                csvFileSize: csvStats.size,
                validationTime: duration
            };

        } catch (error) {
            errors.push(`Validation error: ${error.message}`);
            return { isValid: false, errors };
        }
    }

    /**
     * Main file reading method - Initialize native engine and load files
     * @returns {Promise<void>}
     */
    async readFile() {
        console.log(`Reading thermal files: ${path.basename(this.filename)}`);
        const overallStartTime = process.hrtime.bigint();
        
        try {
            // Validate files first
            if (!this.isValidated) {
                const validation = await this.validateFile();
                if (!validation.isValid) {
                    throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
                }
            }

            // Load native engine
            const initStartTime = process.hrtime.bigint();
            this._loadNativeEngine();
            
            // Load temperature mapping (global CSV)
            console.log('Loading temperature mapping...');
            const mappingLoaded = this.nativeEngine.loadTempMapping(this.csvMappingPath);
            if (!mappingLoaded) {
                throw new Error('Failed to load temperature mapping');
            }
            
            // Load video file
            console.log('Loading thermal video...');
            const videoLoaded = this.nativeEngine.loadVideo(this.filename);
            if (!videoLoaded) {
                throw new Error('Failed to load thermal video');
            }
            
            const initTime = Number(process.hrtime.bigint() - initStartTime) / 1e9;
            
            // Get video information
            console.log('Processing thermal metadata...');
            const metadataStartTime = process.hrtime.bigint();
            
            this.videoInfo = this.nativeEngine.getVideoInfo();
            await this._processMetadata();
            await this._buildThermalCapabilities();
            
            const metadataTime = Number(process.hrtime.bigint() - metadataStartTime) / 1e9;
            
            // Store processing statistics
            const totalTime = Number(process.hrtime.bigint() - overallStartTime) / 1e9;
            this.processingStats = {
                ...this.processingStats,
                initializationTime: initTime,
                metadataProcessingTime: metadataTime,
                totalProcessingTime: totalTime,
                memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024
            };
            
            console.log(`Thermal files loaded successfully in: ${totalTime.toFixed(2)}s`);
            console.log(`Video info: ${this.videoInfo.frames} frames, ${this.videoInfo.fps} FPS, ${this.videoInfo.width}x${this.videoInfo.height}`);
            console.log(`Memory usage: ${this.processingStats.memoryUsageMB.toFixed(1)} MB`);
            
        } catch (error) {
            console.error('Error reading thermal files:', error);
            throw new Error(`Thermal file reading failed: ${error.message}`);
        }
    }

    /**
     * Load and validate native thermal engine
     * @private
     */
    _loadNativeEngine() {
        if (this.nativeEngine) return; // Already loaded
        
        try {
            // Try multiple possible paths for the native module
            const possiblePaths = [
                '../native/thermal/build/Release/thermal_engine.node',
                './native/thermal/build/Release/thermal_engine.node',
                path.join(__dirname, '../native/thermal/build/Release/thermal_engine.node')
            ];
            
            let moduleLoaded = false;
            for (const modulePath of possiblePaths) {
                try {
                    this.nativeEngine = require(modulePath);
                    console.log(`Loaded native thermal engine from: ${modulePath}`);
                    moduleLoaded = true;
                    break;
                } catch (e) {
                    // Continue to next path
                }
            }
            
            if (!moduleLoaded) {
                throw new Error('Could not find thermal native module in any expected location');
            }
            
        } catch (error) {
            console.error('Failed to load native thermal engine:', error.message);
            console.log('Run "npm run build-thermal" to compile the C++ addon');
            console.log('Check if build/Release/thermal_engine.node exists');
            throw new Error(`Native engine loading failed: ${error.message}`);
        }
    }

    /**
     * Process thermal metadata
     * @private
     */
    async _processMetadata() {
        // Build comprehensive metadata
        this.metadata = {
            header: 'Thermal Video Analysis Data',
            filePath: this.filename,
            fileName: path.basename(this.filename),
            csvMappingPath: this.csvMappingPath,
            processedAt: new Date(),
            fileType: 'thermal_avi',
            
            // Video information
            totalFrames: this.videoInfo.frames || 0,
            fps: this.videoInfo.fps || 0,
            width: this.videoInfo.width || 0,
            height: this.videoInfo.height || 0,
            duration: this.videoInfo.frames && this.videoInfo.fps ? 
                     (this.videoInfo.frames / this.videoInfo.fps) : 0,
            
            // Thermal-specific metadata
            thermalSpecific: {
                temperatureMappingLoaded: true,
                supportedAnalysis: ['line_analysis', 'pixel_temperature'],
                coordinateSystem: 'pixel_based',
                frameNavigation: 'frame_based',
                fileFormat: 'AVI/OpenCV'
            }
        };
        
        console.log(`Processed thermal metadata:`);
        console.log(`  Frames: ${this.metadata.totalFrames}`);
        console.log(`  FPS: ${this.metadata.fps}`);
        console.log(`  Resolution: ${this.metadata.width}x${this.metadata.height}`);
        console.log(`  Duration: ${this.metadata.duration.toFixed(2)}s`);
    }

    /**
     * Build thermal analysis capabilities mapping
     * @private
     */
    async _buildThermalCapabilities() {
        // Map thermal capabilities to calculatedData (for interface compatibility)
        this.calculatedData = {
            thermal_analysis: {
                type: 'thermal_video_analysis',
                capabilities: {
                    lineAnalysis: true,
                    pixelTemperature: true,
                    frameNavigation: true,
                    realTimeAnalysis: true
                },
                
                // Video properties
                totalFrames: this.videoInfo.frames,
                fps: this.videoInfo.fps,
                resolution: {
                    width: this.videoInfo.width,
                    height: this.videoInfo.height
                },
                duration: this.metadata.duration,
                
                // Analysis parameters
                frameRange: { min: 0, max: this.videoInfo.frames - 1 },
                coordinateBounds: {
                    x: { min: 0, max: this.videoInfo.width - 1 },
                    y: { min: 0, max: this.videoInfo.height - 1 }
                },
                
                // Native engine reference (for actual analysis)
                _nativeEngine: this.nativeEngine,
                _ready: this.nativeEngine ? this.nativeEngine.isReady() : false
            }
        };
        
        console.log(`Built thermal analysis capabilities: ${Object.keys(this.calculatedData).length} capability sets`);
    }

    /**
     * Get metadata (compatible with HDF5Reader interface)
     * @returns {Object} Comprehensive metadata
     */
    getMetadata() {
        return {
            ...this.metadata,
            processingStats: this.processingStats,
            isValidated: this.isValidated,
            validationErrors: this.validationErrors,
            
            // Thermal-specific metadata
            videoInfo: this.videoInfo,
            nativeEngineStatus: this.nativeEngine ? 'loaded' : 'not_loaded',
            engineReady: this.nativeEngine ? this.nativeEngine.isReady() : false
        };
    }

    /**
     * Get raw data (empty for thermal - not applicable)
     * @returns {Object} Empty object for compatibility
     */
    getRawData() {
        // Thermal doesn't have "raw" data in the same sense as binary files
        // Return empty object for interface compatibility
        return {};
    }

    /**
     * Get calculated data (maps to thermal analysis capabilities)
     * @returns {Object} Thermal analysis capabilities
     */
    getCalculatedData() {
        return this.calculatedData;
    }

    /**
     * Get channel data by ID (not applicable for thermal)
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Always null for thermal (no channels)
     */
    getChannelData(channelId) {
        // Thermal videos don't have channels like HDF5/binary data
        return null;
    }

    /**
     * Get all channels (not applicable for thermal)
     * @returns {Object} Empty structure for compatibility
     */
    getAllChannels() {
        return {
            raw: {}, // Empty for thermal compatibility
            calculated: { ...this.calculatedData }, // Thermal capabilities
            thermal: { ...this.calculatedData } // Also provide under thermal key
        };
    }

    /**
     * Get processing statistics
     * @returns {Object} Performance and processing information
     */
    getProcessingStats() {
        return {
            ...this.processingStats,
            videoFrames: this.videoInfo.frames || 0,
            thermalCapabilities: Object.keys(this.calculatedData).length,
            nativeEngineLoaded: this.nativeEngine !== null,
            
            // Thermal-specific stats
            engineReady: this.nativeEngine ? this.nativeEngine.isReady() : false,
            temperatureMappingLoaded: true
        };
    }

    /**
     * Get native engine instance for direct access
     * @returns {Object|null} Native thermal engine instance
     */
    getNativeEngine() {
        return this.nativeEngine;
    }

    /**
     * Get video information
     * @returns {Object} Video properties
     */
    getVideoInfo() {
        return this.videoInfo;
    }

    /**
     * Check if thermal reader is ready for analysis
     * @returns {boolean} True if ready for thermal operations
     */
    isReady() {
        return this.isValidated && 
               this.nativeEngine !== null && 
               this.nativeEngine.isReady() &&
               Object.keys(this.calculatedData).length > 0;
    }

    /**
     * Close thermal reader and cleanup resources
     */
    close() {
        if (this.nativeEngine) {
            // Native engine cleanup is handled by C++ destructor
            this.nativeEngine = null;
        }
        
        this.calculatedData = {};
        this.metadata = {};
        this.videoInfo = {};
        
        console.log(`Closed thermal reader: ${path.basename(this.filename)}`);
    }

    /**
     * Get thermal file paths for reference
     * @returns {Object} File paths
     */
    getFilePaths() {
        return {
            aviFile: this.filename,
            csvMapping: this.csvMappingPath,
            aviExists: this.isValidated,
            csvExists: this.isValidated
        };
    }
}

module.exports = ThermalReader;