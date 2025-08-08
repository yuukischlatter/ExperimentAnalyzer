/**
 * TPC5 Parser Service
 * Orchestrates TPC5 file parsing and integrates with the experiment system
 * Handles .tpc5 file processing for oscilloscope data visualization
 * Based on BinaryParserService.js patterns
 */

const path = require('path');
const fs = require('fs').promises;
const BinaryDataProcessor = require('../utils/BinaryDataProcessor');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

// Dynamic import for TPC5Reader (ES6 module)
let TPC5Reader = null;

class TPC5ParserService {
    constructor() {
        this.serviceName = 'TPC5 Parser Service';
        // In-memory cache for parsed TPC5 data (with TTL)
        this.dataCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Load TPC5Reader dynamically (ES6 module import)
     * @private
     */
    async _loadTPC5Reader() {
        if (!TPC5Reader) {
            try {
                const module = await import('../utils/TPC5Reader.mjs');
                TPC5Reader = module.default;
                console.log('TPC5Reader loaded successfully');
            } catch (error) {
                throw new Error(`Failed to load TPC5Reader: ${error.message}`);
            }
        }
        return TPC5Reader;
    }

    /**
     * Parse experiment TPC5 file and return processed data
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(2)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseTPC5File(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing TPC5 file for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached TPC5 data for ${experimentId}`);
                    return createServiceResult(true, 'TPC5 data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Resolve file path
            const tpc5FilePath = this.getExperimentTPC5FilePath(experimentId);
            
            // Validate file exists
            const fileExists = await this._fileExists(tpc5FilePath);
            if (!fileExists) {
                const errorMsg = `TPC5 file not found: ${tpc5FilePath}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Get file size for logging
            const fileStats = await fs.stat(tpc5FilePath);
            const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
            console.log(`Processing TPC5 file: ${fileSizeMB} MB`);

            // Load TPC5Reader dynamically and parse TPC5 file
            const TPC5ReaderClass = await this._loadTPC5Reader();
            const tpc5Reader = new TPC5ReaderClass(tpc5FilePath);
            await tpc5Reader.readFile();

            // Create data processor
            const processor = new BinaryDataProcessor(
                tpc5Reader.getRawData(),
                tpc5Reader.getCalculatedData(),
                tpc5Reader.getMetadata()
            );

            // Cache the processed data
            const processedData = {
                reader: tpc5Reader,
                processor: processor,
                metadata: tpc5Reader.getMetadata(),
                filePath: tpc5FilePath,
                fileSize: fileStats.size,
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `TPC5 file parsed successfully (${fileSizeMB} MB)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse TPC5 file for ${experimentId}: ${error.message}`;
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
     * Get TPC5 file metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including channels, duration, etc.
     */
    async getTPC5Metadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseTPC5File(experimentId);
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
                fileFormat: 'TPC5/HDF5',
                
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
                
                // TPC5-specific information
                tpc5Info: {
                    deviceName: metadata.deviceName,
                    startTime: metadata.startTime,
                    triggerSample: metadata.triggerSample,
                    triggerTimeSeconds: metadata.triggerTimeSeconds,
                    channelCount: metadata.channelCount,
                    downsamplingUsed: cachedData.reader.getProcessingStats().downsamplingUsed
                },
                
                // File information
                rawMetadata: {
                    samplingRate: metadata.samplingRate,
                    channelLabels: metadata.labels,
                    channelUnits: metadata.units,
                    channelMetadata: metadata.channelMetadata
                }
            };

        } catch (error) {
            console.error(`Error getting TPC5 metadata for ${experimentId}:`, error);
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
            const parseResult = await this.parseTPC5File(experimentId);
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
                    sourceChannels: channelData.sourceChannels || null,
                    fileFormat: 'TPC5/HDF5',
                    tpc5ChannelKey: channelData.tpc5ChannelKey || null
                }
            };

        } catch (error) {
            console.error(`Error getting TPC5 channel data for ${experimentId}/${channelId}:`, error);
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
            const parseResult = await this.parseTPC5File(experimentId);
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
                            sourceChannels: channelData.sourceChannels || null,
                            fileFormat: 'TPC5/HDF5',
                            tpc5ChannelKey: channelData.tpc5ChannelKey || null
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
                errors: errors.length > 0 ? errors : undefined,
                fileFormat: 'TPC5/HDF5'
            };

        } catch (error) {
            console.error(`Error getting bulk TPC5 channel data for ${experimentId}:`, error);
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
            const parseResult = await this.parseTPC5File(experimentId);
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
                statistics: stats,
                fileFormat: 'TPC5/HDF5'
            };

        } catch (error) {
            console.error(`Error getting TPC5 channel statistics for ${experimentId}/${channelId}:`, error);
            return { 
                success: false, 
                error: `Failed to get statistics: ${error.message}` 
            };
        }
    }

    /**
     * Get experiment TPC5 file path
     * @param {string} experimentId - Experiment ID
     * @returns {string} Full path to TPC5 file
     */
    getExperimentTPC5FilePath(experimentId) {
        // Path pattern: R:/Schweissungen/J25-07-30(2)/J25-07-30(2)_original(manuell).tpc5
        const experimentFolder = path.join(config.experiments.rootPath, experimentId);
        const tpc5FileName = `${experimentId}_original(manuell).tpc5`;
        const fullPath = path.join(experimentFolder, tpc5FileName);
        
        return fullPath;
    }

    /**
     * Check if TPC5 file exists for experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if file exists
     */
    async hasTPC5File(experimentId) {
        try {
            const filePath = this.getExperimentTPC5FilePath(experimentId);
            return await this._fileExists(filePath);
        } catch (error) {
            console.error(`Error checking TPC5 file for ${experimentId}:`, error);
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
            console.log(`Cleared TPC5 cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        const count = this.dataCache.size;
        this.dataCache.clear();
        console.log(`Cleared all TPC5 cached data (${count} experiments)`);
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
                fileFormat: 'TPC5/HDF5'
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
            console.log(`TPC5 cache expired for experiment ${experimentId}`);
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
        console.log(`Cached TPC5 data for experiment ${experimentId}`);
    }

    /**
     * Validate channel ID format
     * @private
     */
    _isValidChannelId(channelId) {
        // Support raw channels: channel_0 through channel_5 (TPC5 has 6 channels vs 8 in binary)
        if (/^channel_[0-5]$/.test(channelId)) {
            return true;
        }
        
        // Support calculated channels: calc_0 through calc_6
        if (/^calc_[0-6]$/.test(channelId)) {
            return true;
        }
        
        // Support legacy numeric format: 0 through 5 (for raw channels)
        if (/^[0-5]$/.test(channelId)) {
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

module.exports = TPC5ParserService;