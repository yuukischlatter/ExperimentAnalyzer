/**
 * Position CSV Service
 * Orchestrates position CSV file parsing and integrates with the experiment system
 * Handles .csv file processing for position sensor data visualization
 * Pattern: snapshot_optoNCDT-*.csv files with tab-delimited format
 */

const path = require('path');
const fs = require('fs').promises;
const PositionCsvReader = require('../utils/PositionCsvReader');
const PositionDataProcessor = require('../utils/PositionDataProcessor');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class PositionCsvService {
    constructor() {
        this.serviceName = 'Position CSV Service';
        // In-memory cache for parsed position data
        this.dataCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL (same as other services)
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Parse experiment position CSV file and return processed data
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseExperimentPositionFile(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing position CSV for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached position data for ${experimentId}`);
                    return createServiceResult(true, 'Position data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Resolve actual file path by scanning directory
            const positionFilePath = await this.getActualPositionFilePath(experimentId);
            
            // Validate file exists
            if (!positionFilePath) {
                const errorMsg = `Position CSV file not found for experiment: ${experimentId}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Get file size for logging
            const fileStats = await fs.stat(positionFilePath);
            const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
            console.log(`Processing position CSV file: ${fileSizeMB} MB`);

            // Parse CSV file
            const csvReader = new PositionCsvReader(positionFilePath);
            await csvReader.readFile();

            // Create data processor
            const processor = new PositionDataProcessor(
                csvReader.getPositionData(),
                csvReader.getMetadata()
            );

            // Apply interpolation to match C# behavior (converts to 1ms intervals)
            processor.applyInterpolation();

            // Cache the processed data
            const processedData = {
                reader: csvReader,
                processor: processor,
                metadata: csvReader.getMetadata(),
                filePath: positionFilePath,
                fileSize: fileStats.size,
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `Position CSV file parsed successfully (${fileSizeMB} MB)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse position CSV for ${experimentId}: ${error.message}`;
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
     * Get position CSV metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including channels, duration, etc.
     */
    async getPositionMetadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentPositionFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found after parsing' };
            }

            const processor = cachedData.processor;
            const metadata = cachedData.metadata;

            // Generate comprehensive metadata
            const metadataSummary = processor.getMetadataSummary();
            const dataRanges = processor.getDataRanges();
            const availableChannels = processor.getAllAvailableChannels();
            const channelsByUnit = processor.getChannelsByUnit();
            const defaultChannels = processor.getDefaultDisplayChannels();
            const timeRange = processor.getTimeRange();

            return {
                success: true,
                experimentId: experimentId,
                filePath: cachedData.filePath,
                fileSize: cachedData.fileSize,
                processedAt: cachedData.processedAt,
                
                // Core metadata
                metadata: metadataSummary,
                
                // Channel information
                channels: {
                    available: availableChannels,
                    byUnit: channelsByUnit,
                    defaults: defaultChannels,
                    ranges: dataRanges
                },
                
                // Time information (in microseconds)
                timeRange: timeRange,
                duration: metadataSummary.duration,
                
                // Position-specific information
                positionInfo: {
                    sensorType: 'optoNCDT-ILD1220',
                    unit: 'mm',
                    transformationApplied: 'final = -1 * raw + 49.73',
                    interpolationInterval: '1ms (1000µs)',
                    isInterpolated: true
                },
                
                // File information
                rawMetadata: {
                    formatInfo: metadata.formatInfo,
                    channelMapping: metadata.channelMapping,
                    totalLines: metadata.totalLines,
                    validDataLines: metadata.validDataLines
                }
            };

        } catch (error) {
            console.error(`Error getting position metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get metadata: ${error.message}` 
            };
        }
    }

    /**
     * Get channel data with resampling support
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID (should be "pos_x")
     * @param {Object} options - Options for data retrieval
     * @returns {Promise<Object>} Channel data with time and values
     */
    async getChannelData(experimentId, channelId, options = {}) {
        try {
            const {
                startTime = 0,
                endTime = null,
                maxPoints = 2000
            } = options;

            // Validate channel ID format
            if (!this._isValidChannelId(channelId)) {
                return { 
                    success: false, 
                    error: `Invalid channel ID format: ${channelId}` 
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentPositionFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            
            // Check if channel exists
            const channelData = processor.getChannelById(channelId);
            if (!channelData) {
                return { 
                    success: false, 
                    error: `Channel ${channelId} not found` 
                };
            }

            // Determine end time if not provided (time is in microseconds)
            const actualEndTime = endTime || processor.getTimeRange().max;

            // Get resampled data
            const data = processor.getResampledData(channelId, startTime, actualEndTime, maxPoints);
            
            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                data: {
                    time: data.time,
                    values: data.values
                },
                metadata: {
                    label: channelData.label,
                    unit: channelData.unit,
                    type: 'position',
                    actualPoints: data.time.length,
                    requestedRange: { 
                        startTime, 
                        endTime: actualEndTime 
                    },
                    maxPointsRequested: maxPoints,
                    timeUnit: 'microseconds',
                    isInterpolated: channelData.isInterpolated || false,
                    interpolationInterval: channelData.interpolationInterval
                }
            };

        } catch (error) {
            console.error(`Error getting channel data for ${experimentId}/${channelId}:`, error);
            return { 
                success: false, 
                error: `Failed to get channel data: ${error.message}` 
            };
        }
    }

    /**
     * Get multiple channels data efficiently (simplified for single channel)
     * @param {string} experimentId - Experiment ID
     * @param {string[]} channelIds - Array of channel IDs (should just be ["pos_x"])
     * @param {Object} options - Options for data retrieval
     * @returns {Promise<Object>} Bulk channel data
     */
    async getBulkChannelData(experimentId, channelIds, options = {}) {
        try {
            const {
                startTime = 0,
                endTime = null,
                maxPoints = 2000
            } = options;

            // Validate inputs
            if (!Array.isArray(channelIds)) {
                return { 
                    success: false, 
                    error: 'channelIds must be an array' 
                };
            }

            if (channelIds.length === 0) {
                return { 
                    success: false, 
                    error: 'channelIds cannot be empty' 
                };
            }

            // For position data, we only have one channel, but maintain consistency
            const validChannelIds = channelIds.filter(id => this._isValidChannelId(id));
            if (validChannelIds.length === 0) {
                return { 
                    success: false, 
                    error: 'No valid channel IDs provided' 
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentPositionFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            const actualEndTime = endTime || processor.getTimeRange().max;
            
            // Process each channel (should just be pos_x)
            const results = {};
            const errors = [];
            
            for (const channelId of validChannelIds) {
                try {
                    // Check if channel exists
                    const channelData = processor.getChannelById(channelId);
                    if (!channelData) {
                        results[channelId] = { 
                            success: false, 
                            error: 'Channel not found' 
                        };
                        continue;
                    }

                    // Get resampled data
                    const data = processor.getResampledData(channelId, startTime, actualEndTime, maxPoints);
                    
                    results[channelId] = {
                        success: true,
                        data: {
                            time: data.time,
                            values: data.values
                        },
                        metadata: {
                            label: channelData.label,
                            unit: channelData.unit,
                            type: 'position',
                            actualPoints: data.time.length,
                            isInterpolated: channelData.isInterpolated || false
                        }
                    };

                } catch (error) {
                    const errorMsg = `Error processing channel ${channelId}: ${error.message}`;
                    errors.push(errorMsg);
                    results[channelId] = { 
                        success: false, 
                        error: errorMsg 
                    };
                }
            }

            return {
                success: true,
                experimentId: experimentId,
                requestedChannels: channelIds.length,
                successfulChannels: Object.values(results).filter(r => r.success).length,
                failedChannels: errors.length,
                requestOptions: {
                    startTime,
                    endTime: actualEndTime,
                    maxPoints
                },
                channels: results,
                errors: errors.length > 0 ? errors : undefined
            };

        } catch (error) {
            console.error(`Error getting bulk channel data for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get bulk channel data: ${error.message}` 
            };
        }
    }

    /**
     * Get channel statistics
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID
     * @returns {Promise<Object>} Channel statistics
     */
    async getChannelStatistics(experimentId, channelId) {
        try {
            // Validate channel ID
            if (!this._isValidChannelId(channelId)) {
                return { 
                    success: false, 
                    error: `Invalid channel ID format: ${channelId}` 
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentPositionFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            const stats = processor.getChannelStatistics(channelId);
            
            if (!stats) {
                return { 
                    success: false, 
                    error: `Channel ${channelId} not found` 
                };
            }

            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                statistics: stats
            };

        } catch (error) {
            console.error(`Error getting channel statistics for ${experimentId}/${channelId}:`, error);
            return { 
                success: false, 
                error: `Failed to get statistics: ${error.message}` 
            };
        }
    }

    /**
     * Check if position CSV file exists for experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if file exists
     */
    async hasPositionFile(experimentId) {
        try {
            const filePath = await this.getActualPositionFilePath(experimentId);
            return filePath !== null;
        } catch (error) {
            console.error(`Error checking position file for ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Get actual position file path by scanning directory
     * Looks for files matching pattern: snapshot_optoNCDT-*.csv
     * @param {string} experimentId - Experiment ID  
     * @returns {Promise<string|null>} Actual file path or null
     */
    async getActualPositionFilePath(experimentId) {
        try {
            const experimentFolder = path.join(config.experiments.rootPath, experimentId);
            
            // Check if experiment folder exists
            try {
                await fs.access(experimentFolder);
            } catch (error) {
                console.warn(`Experiment folder not found: ${experimentFolder}`);
                return null;
            }
            
            // Get all files in directory and subdirectories
            const files = await this._getAllFilesRecursive(experimentFolder);
            
            // Look for position CSV files using the pattern: snapshot_optoNCDT-*.csv
            const positionFile = files.find(file => {
                const fileName = path.basename(file).toLowerCase();
                return fileName.startsWith('snapshot_optoncdt-') && fileName.endsWith('.csv');
            });
            
            if (positionFile) {
                console.log(`Found position file: ${path.basename(positionFile)}`);
                return positionFile;
            }
            
            console.warn(`No position CSV file found for experiment: ${experimentId}`);
            return null;
            
        } catch (error) {
            console.error(`Error finding position file for ${experimentId}:`, error);
            return null;
        }
    }

    /**
     * Get all files recursively from directory (helper method)
     * @private
     */
    async _getAllFilesRecursive(dirPath) {
        const files = [];
        
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isFile()) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            // Silently handle directory read errors
            console.warn(`Could not read directory ${dirPath}: ${error.message}`);
        }
        
        return files;
    }

    /**
     * Get experiment position file path (legacy method - now uses actual scanning)
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<string|null>} Full path to position CSV file
     */
    async getExperimentPositionFilePath(experimentId) {
        // Use the actual file scanning method
        return await this.getActualPositionFilePath(experimentId);
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        if (this.dataCache.has(experimentId)) {
            this.dataCache.delete(experimentId);
            console.log(`Cleared position cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        const count = this.dataCache.size;
        this.dataCache.clear();
        console.log(`Cleared all position cached data (${count} experiments)`);
    }

    /**
     * Get cache status
     * @returns {Object} Cache information
     */
    getCacheStatus() {
        const cacheEntries = [];
        
        for (const [experimentId, data] of this.dataCache.entries()) {
            cacheEntries.push({
                experimentId: experimentId,
                processedAt: data.processedAt,
                fileSize: data.fileSize,
                filePath: path.basename(data.filePath),
                dataPoints: data.processor.getPositionData().pos_x?.points || 0
            });
        }

        return {
            totalCachedExperiments: this.dataCache.size,
            cacheTimeoutMs: this.cacheTimeout,
            entries: cacheEntries
        };
    }

    // === PRIVATE HELPER METHODS ===

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
            this.dataCache.delete(experimentId);
            console.log(`Cache expired for experiment ${experimentId}`);
            return null;
        }

        return cached;
    }

    /**
     * Set cached data for experiment
     * @private
     */
    _setCachedData(experimentId, data) {
        this.dataCache.set(experimentId, data);
        console.log(`Cached position data for experiment ${experimentId}`);
    }

    /**
     * Validate channel ID format
     * @private
     */
    _isValidChannelId(channelId) {
        // For position data, we only support pos_x
        return channelId === 'pos_x';
    }
}

module.exports = PositionCsvService;