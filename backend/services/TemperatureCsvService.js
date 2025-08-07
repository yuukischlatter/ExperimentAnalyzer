/**
 * Temperature CSV Service
 * Orchestrates temperature CSV file parsing and integrates with the experiment system
 * Handles .csv file processing for temperature data visualization
 */

const path = require('path');
const fs = require('fs').promises;
const TemperatureCsvReader = require('../utils/TemperatureCsvReader');
const TemperatureDataProcessor = require('../utils/TemperatureDataProcessor');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class TemperatureCsvService {
    constructor() {
        this.serviceName = 'Temperature CSV Service';
        // Simple in-memory cache for parsed temperature data
        this.dataCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL (same as binary service)
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Parse experiment temperature CSV file and return processed data
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseExperimentTemperatureFile(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing temperature CSV for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached temperature data for ${experimentId}`);
                    return createServiceResult(true, 'Temperature data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Resolve actual file path by scanning directory
            const temperatureFilePath = await this.getActualTemperatureFilePath(experimentId);
            
            // Validate file exists
            if (!temperatureFilePath) {
                const errorMsg = `Temperature CSV file not found for experiment: ${experimentId}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Get file size for logging
            const fileStats = await fs.stat(temperatureFilePath);
            const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
            console.log(`Processing temperature CSV file: ${fileSizeMB} MB`);

            // Parse CSV file
            const csvReader = new TemperatureCsvReader(temperatureFilePath);
            await csvReader.readFile();

            // Create data processor
            const processor = new TemperatureDataProcessor(
                csvReader.getTemperatureData(),
                csvReader.getMetadata()
            );

            // Cache the processed data
            const processedData = {
                reader: csvReader,
                processor: processor,
                metadata: csvReader.getMetadata(),
                filePath: temperatureFilePath,
                fileSize: fileStats.size,
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `Temperature CSV file parsed successfully (${fileSizeMB} MB)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse temperature CSV for ${experimentId}: ${error.message}`;
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
     * Get temperature CSV metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including channels, duration, etc.
     */
    async getTemperatureMetadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentTemperatureFile(experimentId);
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
                
                // Time information
                timeRange: timeRange,
                duration: metadataSummary.duration,
                
                // File information
                rawMetadata: {
                    channelMapping: metadata.channelMapping,
                    formatInfo: metadata.formatInfo,
                    headers: metadata.headers,
                    rowCount: metadata.rowCount
                }
            };

        } catch (error) {
            console.error(`Error getting temperature metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get metadata: ${error.message}` 
            };
        }
    }

    /**
     * Get channel data with resampling support
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID (e.g., "temp_welding", "temp_channel_5")
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
            const parseResult = await this.parseExperimentTemperatureFile(experimentId);
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

            // Determine end time if not provided
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
                    type: 'temperature',
                    actualPoints: data.time.length,
                    requestedRange: { startTime, endTime: actualEndTime },
                    maxPointsRequested: maxPoints
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
     * Get multiple channels data efficiently
     * @param {string} experimentId - Experiment ID
     * @param {string[]} channelIds - Array of channel IDs
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

            // Ensure data is parsed
            const parseResult = await this.parseExperimentTemperatureFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            const actualEndTime = endTime || processor.getTimeRange().max;
            
            // Process each channel
            const results = {};
            const errors = [];
            
            for (const channelId of channelIds) {
                try {
                    // Validate channel ID
                    if (!this._isValidChannelId(channelId)) {
                        results[channelId] = { 
                            success: false, 
                            error: 'Invalid channel ID format' 
                        };
                        continue;
                    }

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
                            type: 'temperature',
                            actualPoints: data.time.length
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
            const parseResult = await this.parseExperimentTemperatureFile(experimentId);
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
     * Check if temperature CSV file exists for experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if file exists
     */
    async hasTemperatureFile(experimentId) {
        try {
            const filePath = await this.getActualTemperatureFilePath(experimentId);
            return filePath !== null;
        } catch (error) {
            console.error(`Error checking temperature file for ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Get actual temperature file path by scanning directory
     * @param {string} experimentId - Experiment ID  
     * @returns {Promise<string|null>} Actual file path or null
     */
    async getActualTemperatureFilePath(experimentId) {
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
            
            // Look for temperature CSV files using the same pattern as DirectoryScanner
            const temperatureFile = files.find(file => {
                const fileName = path.basename(file).toLowerCase();
                return fileName.includes('temperature') && fileName.endsWith('.csv');
            });
            
            if (temperatureFile) {
                console.log(`Found temperature file: ${path.basename(temperatureFile)}`);
                return temperatureFile;
            }
            
            console.warn(`No temperature CSV file found for experiment: ${experimentId}`);
            return null;
            
        } catch (error) {
            console.error(`Error finding temperature file for ${experimentId}:`, error);
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
                
                if (entry.isDirectory()) {
                    const subFiles = await this._getAllFilesRecursive(fullPath);
                    files.push(...subFiles);
                } else if (entry.isFile()) {
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
     * Get experiment temperature file path (legacy method - now uses actual scanning)
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<string|null>} Full path to temperature CSV file
     */
    async getExperimentTemperatureFilePath(experimentId) {
        // Use the actual file scanning method instead of assuming filename
        return await this.getActualTemperatureFilePath(experimentId);
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        if (this.dataCache.has(experimentId)) {
            this.dataCache.delete(experimentId);
            console.log(`Cleared temperature cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        const count = this.dataCache.size;
        this.dataCache.clear();
        console.log(`Cleared all temperature cached data (${count} experiments)`);
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
                filePath: path.basename(data.filePath)
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
        console.log(`Cached temperature data for experiment ${experimentId}`);
    }

    /**
     * Validate channel ID format
     * @private
     */
    _isValidChannelId(channelId) {
        // Support temperature channels: temp_welding, temp_channel_1 through temp_channel_8
        if (channelId === 'temp_welding') {
            return true;
        }
        
        if (/^temp_channel_[1-8]$/.test(channelId)) {
            return true;
        }
        
        return false;
    }
}

module.exports = TemperatureCsvService;