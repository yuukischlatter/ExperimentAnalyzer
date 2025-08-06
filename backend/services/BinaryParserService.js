/**
 * Binary Parser Service
 * Orchestrates binary file parsing and integrates with the experiment system
 * Handles .bin file processing for oscilloscope data visualization
 */

const path = require('path');
const fs = require('fs').promises;
const BinaryReader = require('../utils/BinaryReader');
const BinaryDataProcessor = require('../utils/BinaryDataProcessor');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class BinaryParserService {
    constructor() {
        this.serviceName = 'Binary Parser Service';
        // In-memory cache for parsed binary data (with TTL)
        this.dataCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Parse experiment binary file and return processed data
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseExperimentBinaryFile(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing binary file for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached binary data for ${experimentId}`);
                    return createServiceResult(true, 'Binary data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Resolve file path
            const binaryFilePath = this.getExperimentBinaryFilePath(experimentId);
            
            // Validate file exists
            const fileExists = await this._fileExists(binaryFilePath);
            if (!fileExists) {
                const errorMsg = `Binary file not found: ${binaryFilePath}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Get file size for logging
            const fileStats = await fs.stat(binaryFilePath);
            const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
            console.log(`Processing binary file: ${fileSizeMB} MB`);

            // Parse binary file
            const binaryReader = new BinaryReader(binaryFilePath);
            await binaryReader.readFile();

            // Create data processor
            const processor = new BinaryDataProcessor(
                binaryReader.getRawData(),
                binaryReader.getCalculatedData(),
                binaryReader.getMetadata()
            );

            // Cache the processed data
            const processedData = {
                reader: binaryReader,
                processor: processor,
                metadata: binaryReader.getMetadata(),
                filePath: binaryFilePath,
                fileSize: fileStats.size,
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `Binary file parsed successfully (${fileSizeMB} MB)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse binary file for ${experimentId}: ${error.message}`;
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
     * Get binary file metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including channels, duration, etc.
     */
    async getBinaryMetadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentBinaryFile(experimentId);
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
                samplingRate: metadataSummary.samplingRate,
                
                // File information
                rawMetadata: {
                    header: metadata.header,
                    samplingInterval: metadata.samplingInterval,
                    maxAdcValue: metadata.maxAdcValue,
                    startTime: metadata.readDateTime,
                    channelLabels: metadata.labels,
                    channelUnits: metadata.units
                }
            };

        } catch (error) {
            console.error(`Error getting binary metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get metadata: ${error.message}` 
            };
        }
    }

    /**
     * Get channel data with resampling support
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID (e.g., "channel_0", "calc_3")
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
            const parseResult = await this.parseExperimentBinaryFile(experimentId);
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
                    type: channelId.startsWith('calc_') ? 'calculated' : 'raw',
                    actualPoints: data.time.length,
                    requestedRange: { startTime, endTime: actualEndTime },
                    maxPointsRequested: maxPoints,
                    sourceChannels: channelData.sourceChannels || null
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
            const parseResult = await this.parseExperimentBinaryFile(experimentId);
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
                            type: channelId.startsWith('calc_') ? 'calculated' : 'raw',
                            actualPoints: data.time.length,
                            sourceChannels: channelData.sourceChannels || null
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
            const parseResult = await this.parseExperimentBinaryFile(experimentId);
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
     * Get experiment binary file path
     * @param {string} experimentId - Experiment ID
     * @returns {string} Full path to binary file
     */
    getExperimentBinaryFilePath(experimentId) {
        // Path pattern: R:/Schweissungen/J25-07-30(3)/J25-07-30(3).bin
        const experimentFolder = path.join(config.experiments.rootPath, experimentId);
        const binaryFileName = `${experimentId}.bin`;
        const fullPath = path.join(experimentFolder, binaryFileName);
        
        return fullPath;
    }

    /**
     * Check if binary file exists for experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if file exists
     */
    async hasBinaryFile(experimentId) {
        try {
            const filePath = this.getExperimentBinaryFilePath(experimentId);
            return await this._fileExists(filePath);
        } catch (error) {
            console.error(`Error checking binary file for ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        if (this.dataCache.has(experimentId)) {
            this.dataCache.delete(experimentId);
            console.log(`Cleared cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        const count = this.dataCache.size;
        this.dataCache.clear();
        console.log(`Cleared all cached data (${count} experiments)`);
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
        console.log(`Cached data for experiment ${experimentId}`);
    }

    /**
     * Validate channel ID format
     * @private
     */
    _isValidChannelId(channelId) {
        // Support raw channels: channel_0 through channel_7
        if (/^channel_[0-7]$/.test(channelId)) {
            return true;
        }
        
        // Support calculated channels: calc_0 through calc_6
        if (/^calc_[0-6]$/.test(channelId)) {
            return true;
        }
        
        // Support legacy numeric format: 0 through 7 (for raw channels)
        if (/^[0-7]$/.test(channelId)) {
            return true;
        }
        
        return false;
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

module.exports = BinaryParserService;