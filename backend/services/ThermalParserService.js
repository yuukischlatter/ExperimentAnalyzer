/**
 * Thermal Parser Service
 * High-level service for thermal video analysis integration
 * Handles thermal AVI file processing and integrates with the experiment system
 */

const path = require('path');
const fs = require('fs').promises;
const ThermalReader = require('../utils/ThermalReader');
const ThermalDataProcessor = require('../utils/ThermalDataProcessor');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class ThermalParserService {
    constructor() {
        this.serviceName = 'Thermal Parser Service';
        // In-memory cache for loaded thermal data (with TTL)
        this.dataCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL
        
        // Global temperature mapping (loaded once, reused for all experiments)
        this.globalTempMappingPath = null;
        this.globalTempMappingLoaded = false;
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Parse experiment thermal file and return processed data
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseExperimentThermalFile(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing thermal file for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached thermal data for ${experimentId}`);
                    return createServiceResult(true, 'Thermal data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Resolve thermal file paths
            const filePaths = await this.getThermalFilePaths(experimentId);
            if (!filePaths.aviExists) {
                const errorMsg = `Thermal AVI file not found for experiment ${experimentId}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Ensure global temperature mapping is loaded
            await this._ensureGlobalTempMappingLoaded();

            // Get file size for logging
            const fileStats = await fs.stat(filePaths.aviPath);
            const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
            console.log(`Processing thermal AVI file: ${fileSizeMB} MB`);

            // Create and initialize thermal reader
            const thermalReader = new ThermalReader(filePaths.aviPath, this.globalTempMappingPath);
            await thermalReader.readFile();

            // Create data processor
            const processor = new ThermalDataProcessor(thermalReader);

            // Cache the processed data
            const processedData = {
                reader: thermalReader,
                processor: processor,
                metadata: thermalReader.getMetadata(),
                filePaths: filePaths,
                fileSize: fileStats.size,
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `Thermal file parsed successfully (${fileSizeMB} MB)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse thermal file for ${experimentId}: ${error.message}`;
            console.error(`${this.serviceName}:`, errorMsg);
            
            return createServiceResult(
                false, 
                errorMsg, 
                0, 
                0, 
                duration, 
                [error.toString()]
            );
        }
    }

    /**
     * Get thermal video metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including video info, duration, etc.
     */
    async getThermalMetadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentThermalFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found after parsing' };
            }

            const processor = cachedData.processor;
            const metadata = cachedData.metadata;
            const filePaths = cachedData.filePaths;

            // Generate comprehensive metadata
            const videoInfo = processor.getVideoInfo();

            return {
                success: true,
                experimentId: experimentId,
                filePaths: filePaths,
                fileSize: cachedData.fileSize,
                processedAt: cachedData.processedAt,
                
                // Core video metadata
                videoInfo: videoInfo,
                
                // File information
                thermalSpecific: {
                    fileType: 'AVI/Thermal',
                    analysisCapabilities: videoInfo.capabilities,
                    frameNavigation: 'frame_based',
                    coordinateSystem: 'pixel_based',
                    temperatureMappingLoaded: this.globalTempMappingLoaded,
                    nativeEngineUsed: true
                },
                
                // Raw metadata for reference
                rawMetadata: {
                    originalMetadata: metadata.thermalSpecific || {},
                    processingStats: metadata.processingStats || {}
                }
            };

        } catch (error) {
            console.error(`Error getting thermal metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get metadata: ${error.message}` 
            };
        }
    }

    /**
     * Analyze temperature along multiple lines for a specific frame
     * @param {string} experimentId - Experiment ID
     * @param {number} frameNum - Frame number
     * @param {Array} lines - Array of line objects {x1, y1, x2, y2}
     * @returns {Promise<Object>} Line analysis results
     */
    async analyzeLines(experimentId, frameNum, lines) {
        try {
            // Validate inputs
            if (typeof frameNum !== 'number' || isNaN(frameNum)) {
                return { 
                    success: false, 
                    error: 'Frame number must be a valid number' 
                };
            }

            if (!Array.isArray(lines) || lines.length === 0) {
                return {
                    success: false,
                    error: 'Lines must be a non-empty array'
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentThermalFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            
            console.log(`Analyzing ${lines.length} lines for ${experimentId} frame ${frameNum}`);
            
            // Perform line analysis
            const analysisResult = processor.analyzeLines(frameNum, lines);
            
            if (!analysisResult.success) {
                return {
                    success: false,
                    error: analysisResult.error,
                    frameNumber: frameNum,
                    experimentId: experimentId
                };
            }

            return {
                success: true,
                experimentId: experimentId,
                frameNumber: frameNum,
                data: analysisResult,
                metadata: {
                    processingMethod: 'thermal_native_engine',
                    timestamp: new Date().toISOString(),
                    cacheUsed: analysisResult.results.some(r => r.metadata?.fromCache)
                }
            };

        } catch (error) {
            console.error(`Error analyzing lines for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to analyze lines: ${error.message}`,
                experimentId: experimentId,
                frameNumber: frameNum
            };
        }
    }

    /**
     * Get temperature for specific RGB pixel values
     * @param {string} experimentId - Experiment ID
     * @param {number} r - Red value (0-255)
     * @param {number} g - Green value (0-255)
     * @param {number} b - Blue value (0-255)
     * @returns {Promise<Object>} Pixel temperature result
     */
    async getPixelTemperature(experimentId, r, g, b) {
        try {
            // Ensure data is parsed (to load temperature mapping)
            const parseResult = await this.parseExperimentThermalFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            
            // Get pixel temperature
            const result = processor.getPixelTemperature(r, g, b);
            
            if (!result.success) {
                return result;
            }

            return {
                success: true,
                experimentId: experimentId,
                rgb: result.rgb,
                temperature: result.temperature,
                hasTemperature: result.hasTemperature,
                metadata: {
                    ...result.metadata,
                    processingMethod: 'thermal_native_engine'
                }
            };

        } catch (error) {
            console.error(`Error getting pixel temperature for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get pixel temperature: ${error.message}`,
                experimentId: experimentId,
                rgb: { r, g, b }
            };
        }
    }

    /**
     * Check if experiment has thermal AVI file
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} File existence info
     */
    async hasThermalFile(experimentId) {
        try {
            const filePaths = await this.getThermalFilePaths(experimentId);
            
            return {
                exists: filePaths.aviExists,
                filePath: filePaths.aviPath,
                fileExtension: filePaths.aviExists ? '.avi' : null,
                expectedPath: filePaths.aviPath
            };

        } catch (error) {
            console.error(`Error checking thermal file for ${experimentId}:`, error);
            return {
                exists: false,
                error: error.message
            };
        }
    }

    /**
     * Get thermal file paths for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} File paths and existence info
     */
    async getThermalFilePaths(experimentId) {
        try {
            // Get experiment folder path
            const experimentFolder = path.join(config.experiments.rootPath, experimentId);
            
            // Look for Thermal*.avi files
            const files = await fs.readdir(experimentFolder);
            const thermalFiles = files.filter(file => 
                /^Thermal.*\.avi$/i.test(file)
            );

            if (thermalFiles.length === 0) {
                return {
                    aviPath: path.join(experimentFolder, `Thermal_${experimentId}.avi`), // Expected path
                    aviExists: false,
                    foundFiles: files.filter(f => f.toLowerCase().includes('thermal'))
                };
            }

            // Use first found thermal file
            const thermalFile = thermalFiles[0];
            const aviPath = path.join(experimentFolder, thermalFile);
            
            // Check if file actually exists and is readable
            const aviExists = await this._fileExists(aviPath);

            return {
                aviPath: aviPath,
                aviExists: aviExists,
                foundFiles: thermalFiles,
                selectedFile: thermalFile
            };

        } catch (error) {
            console.error(`Error resolving thermal file paths for ${experimentId}:`, error);
            return {
                aviPath: null,
                aviExists: false,
                error: error.message
            };
        }
    }

    /**
     * Get experiment thermal file path (primary AVI file)
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<string>} Full path to thermal AVI file
     */
    async getExperimentThermalFilePath(experimentId) {
        const filePaths = await this.getThermalFilePaths(experimentId);
        return filePaths.aviPath;
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        const cachedData = this.dataCache.get(experimentId);
        if (cachedData) {
            // Properly close thermal reader
            if (cachedData.reader) {
                cachedData.reader.close();
            }
            
            // Clear processor cache
            if (cachedData.processor) {
                cachedData.processor.clearCache();
            }
            
            this.dataCache.delete(experimentId);
            console.log(`Cleared thermal cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        let count = 0;
        for (const [experimentId, cachedData] of this.dataCache.entries()) {
            // Properly close thermal readers
            if (cachedData.reader) {
                cachedData.reader.close();
            }
            
            // Clear processor caches
            if (cachedData.processor) {
                cachedData.processor.clearCache();
            }
            
            count++;
        }
        
        this.dataCache.clear();
        console.log(`Cleared all thermal cached data (${count} experiments)`);
    }

    /**
     * Get cache status
     * @returns {Object} Cache information
     */
    getCacheStatus() {
        const cacheEntries = [];
        
        for (const [experimentId, data] of this.dataCache.entries()) {
            const processorCacheStatus = data.processor ? data.processor.getCacheStatus() : null;
            
            cacheEntries.push({
                experimentId: experimentId,
                processedAt: data.processedAt,
                fileSize: data.fileSize,
                filePaths: {
                    aviFile: path.basename(data.filePaths.aviPath),
                    selectedFile: data.filePaths.selectedFile
                },
                processorCache: processorCacheStatus
            });
        }

        return {
            serviceName: this.serviceName,
            totalCachedExperiments: this.dataCache.size,
            cacheTimeoutMs: this.cacheTimeout,
            globalTempMappingLoaded: this.globalTempMappingLoaded,
            globalTempMappingPath: this.globalTempMappingPath,
            entries: cacheEntries,
            memoryUsage: process.memoryUsage()
        };
    }

    /**
     * Get service status and performance metrics
     * @returns {Object} Service status information
     */
    getServiceStatus() {
        const memoryUsage = process.memoryUsage();
        
        return {
            serviceName: this.serviceName,
            status: 'active',
            cacheInfo: {
                activeExperiments: this.dataCache.size,
                cacheTimeoutMinutes: this.cacheTimeout / (60 * 1000),
                maxRecommendedCacheSize: 5 // Reasonable limit for video files
            },
            performance: {
                memoryUsageMB: memoryUsage.heapUsed / 1024 / 1024,
                totalMemoryMB: memoryUsage.rss / 1024 / 1024
            },
            capabilities: {
                nativeEngineSupport: true,
                lineAnalysis: true,
                pixelTemperature: true,
                frameNavigation: true,
                realTimeAnalysis: true,
                supportedFormats: ['.avi']
            },
            globalMapping: {
                loaded: this.globalTempMappingLoaded,
                path: this.globalTempMappingPath
            }
        };
    }

    // === PRIVATE HELPER METHODS ===

    /**
     * Ensure global temperature mapping is loaded
     * @private
     */
    async _ensureGlobalTempMappingLoaded() {
        if (this.globalTempMappingLoaded) {
            return; // Already loaded
        }

        try {
            // Resolve global temperature mapping path
            this.globalTempMappingPath = config.thermal?.globalTempMapping || 
                path.join(__dirname, '..', 'native', 'thermal', 'data', 'temp_mapping.csv');

            // Check if file exists
            const exists = await this._fileExists(this.globalTempMappingPath);
            if (!exists) {
                throw new Error(`Global temperature mapping file not found: ${this.globalTempMappingPath}`);
            }

            this.globalTempMappingLoaded = true;
            console.log(`✅ Global temperature mapping loaded: ${this.globalTempMappingPath}`);

        } catch (error) {
            console.error(`❌ Failed to load global temperature mapping:`, error);
            throw new Error(`Global temperature mapping loading failed: ${error.message}`);
        }
    }

    /**
     * Get cached data for experiment
     * @private
     */
    _getCachedData(experimentId) {
        const cached = this.dataCache.get(experimentId);
        if (!cached) return null;

        // Check if cache has expired
        const now = Date.now();
        const cacheAge = now - cached.processedAt.getTime();
        
        if (cacheAge > this.cacheTimeout) {
            console.log(`Cache expired for experiment ${experimentId}`);
            this.clearCache(experimentId);
            return null;
        }

        return cached;
    }

    /**
     * Set cached data for experiment
     * @private
     */
    _setCachedData(experimentId, data) {
        // Limit cache size to prevent memory issues with video files
        const maxCacheSize = config.thermal?.maxConcurrentVideos || 3;
        
        if (this.dataCache.size >= maxCacheSize) {
            // Remove oldest entry
            const oldestKey = this.dataCache.keys().next().value;
            console.log(`Thermal cache full, removing oldest entry: ${oldestKey}`);
            this.clearCache(oldestKey);
        }

        this.dataCache.set(experimentId, data);
        console.log(`Cached thermal data for experiment ${experimentId}`);
    }

    /**
     * Check if file exists
     * @private
     */
    async _fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = ThermalParserService;