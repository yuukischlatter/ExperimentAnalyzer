/**
 * Acceleration CSV Service - Multi-Channel High-Frequency Data Orchestrator
 * Orchestrates acceleration CSV file parsing and integrates with the experiment system
 * Handles .csv file processing for 3-axis acceleration data visualization and analysis
 * Patterns: *_beschleuinigung.csv and daq_download.csv files
 */

const path = require('path');
const fs = require('fs').promises;
const AccelerationCsvReader = require('../utils/AccelerationCsvReader');
const AccelerationDataProcessor = require('../utils/AccelerationDataProcessor');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class AccelerationCsvService {
    constructor() {
        this.serviceName = 'Acceleration CSV Service';
        // In-memory cache for parsed acceleration data
        this.dataCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL (same as other services)
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Parse experiment acceleration CSV file and return processed data
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseExperimentAccelerationFile(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing acceleration CSV for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached acceleration data for ${experimentId}`);
                    return createServiceResult(true, 'Acceleration data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Resolve actual file path by scanning directory
            const accelerationFilePath = await this.getActualAccelerationFilePath(experimentId);
            
            // Validate file exists
            if (!accelerationFilePath) {
                const errorMsg = `Acceleration CSV file not found for experiment: ${experimentId}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Get file size for logging
            const fileStats = await fs.stat(accelerationFilePath);
            const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
            console.log(`Processing acceleration CSV file: ${fileSizeMB} MB`);

            // Parse CSV file
            const csvReader = new AccelerationCsvReader(accelerationFilePath);
            await csvReader.readFile();

            // Create data processor
            const processor = new AccelerationDataProcessor(
                csvReader.getAccelerationData(),
                csvReader.getMetadata()
            );

            // Cache the processed data
            const processedData = {
                reader: csvReader,
                processor: processor,
                metadata: csvReader.getMetadata(),
                filePath: accelerationFilePath,
                fileSize: fileStats.size,
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `Acceleration CSV file parsed successfully (${fileSizeMB} MB)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse acceleration CSV for ${experimentId}: ${error.message}`;
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
     * Get acceleration CSV metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including channels, duration, etc.
     */
    async getAccelerationMetadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentAccelerationFile(experimentId);
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
                
                // Acceleration-specific information
                accelerationInfo: {
                    axes: ['X', 'Y', 'Z'],
                    unit: 'm/s²',
                    samplingInfo: metadataSummary.samplingInfo,
                    supportsMagnitudeCalculation: true,
                    isHighFrequency: metadataSummary.samplingInfo.isHighFrequency
                },
                
                // File information
                rawMetadata: {
                    formatInfo: metadata.formatInfo || metadata.detectedFormat,
                    channelMapping: metadata.channelMapping,
                    rowCount: metadata.rowCount,
                    columnCount: metadata.columnCount,
                    detectedFormat: metadata.detectedFormat
                }
            };

        } catch (error) {
            console.error(`Error getting acceleration metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get metadata: ${error.message}` 
            };
        }
    }

    /**
     * Get channel data with resampling support
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID (acc_x, acc_y, acc_z, acc_magnitude)
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
            const parseResult = await this.parseExperimentAccelerationFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            
            // Determine end time if not provided (time is in microseconds)
            const actualEndTime = endTime || processor.getTimeRange().max;

            // Handle special magnitude channel
            if (channelId === 'acc_magnitude') {
                const magnitudeData = processor.getMagnitudeData(startTime, actualEndTime, maxPoints);
                
                return {
                    success: true,
                    experimentId: experimentId,
                    channelId: channelId,
                    data: {
                        time: magnitudeData.time,
                        values: magnitudeData.values
                    },
                    metadata: {
                        label: 'Acceleration Magnitude',
                        unit: 'm/s²',
                        type: 'acceleration',
                        axis: 'Magnitude',
                        actualPoints: magnitudeData.time.length,
                        requestedRange: { 
                            startTime, 
                            endTime: actualEndTime 
                        },
                        maxPointsRequested: maxPoints,
                        timeUnit: 'microseconds',
                        isCalculated: true,
                        calculationMethod: 'sqrt(x² + y² + z²)'
                    }
                };
            }

            // Check if channel exists
            const channelData = processor.getChannelById(channelId);
            if (!channelData) {
                return { 
                    success: false, 
                    error: `Channel ${channelId} not found` 
                };
            }

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
                    type: 'acceleration',
                    axis: channelData.axis,
                    actualPoints: data.time.length,
                    requestedRange: { 
                        startTime, 
                        endTime: actualEndTime 
                    },
                    maxPointsRequested: maxPoints,
                    timeUnit: 'microseconds',
                    samplingRate: channelData.samplingRate,
                    isHighFrequency: (channelData.samplingRate || 0) > 5000
                }
            };

        } catch (error) {
            console.error(`Error getting acceleration channel data for ${experimentId}/${channelId}:`, error);
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

            if (channelIds.length === 0) {
                return { 
                    success: false, 
                    error: 'channelIds cannot be empty' 
                };
            }

            if (channelIds.length > 10) {
                return { 
                    success: false, 
                    error: 'Maximum 10 channels per request' 
                };
            }

            // Validate channel IDs
            const validChannelIds = channelIds.filter(id => this._isValidChannelId(id));
            if (validChannelIds.length === 0) {
                return { 
                    success: false, 
                    error: 'No valid channel IDs provided' 
                };
            }

            const startTimeFloat = parseFloat(startTime);
            const endTimeFloat = endTime ? parseFloat(endTime) : null;
            const maxPointsInt = parseInt(maxPoints);

            // Validate parameters
            if (isNaN(startTimeFloat) || startTimeFloat < 0) {
                return { 
                    success: false, 
                    error: 'Invalid startTime parameter' 
                };
            }
            
            if (endTimeFloat !== null && (isNaN(endTimeFloat) || endTimeFloat <= startTimeFloat)) {
                return { 
                    success: false, 
                    error: 'Invalid endTime parameter' 
                };
            }
            
            if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
                return { 
                    success: false, 
                    error: 'Invalid maxPoints parameter (must be 1-50000)' 
                };
            }

            console.log(`Bulk acceleration channel request for ${experimentId}: ${channelIds.length} channels`);

            // Ensure data is parsed
            const parseResult = await this.parseExperimentAccelerationFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            const actualEndTime = endTimeFloat || processor.getTimeRange().max;
            
            // Process each channel
            const results = {};
            const errors = [];
            
            for (const channelId of validChannelIds) {
                try {
                    // Handle magnitude channel specially
                    if (channelId === 'acc_magnitude') {
                        const magnitudeData = processor.getMagnitudeData(startTimeFloat, actualEndTime, maxPointsInt);
                        
                        results[channelId] = {
                            success: true,
                            data: {
                                time: magnitudeData.time,
                                values: magnitudeData.values
                            },
                            metadata: {
                                label: 'Acceleration Magnitude',
                                unit: 'm/s²',
                                type: 'acceleration',
                                axis: 'Magnitude',
                                actualPoints: magnitudeData.time.length,
                                isCalculated: true
                            }
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
                    const data = processor.getResampledData(channelId, startTimeFloat, actualEndTime, maxPointsInt);
                    
                    results[channelId] = {
                        success: true,
                        data: {
                            time: data.time,
                            values: data.values
                        },
                        metadata: {
                            label: channelData.label,
                            unit: channelData.unit,
                            type: 'acceleration',
                            axis: channelData.axis,
                            actualPoints: data.time.length,
                            samplingRate: channelData.samplingRate
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
                    startTime: startTimeFloat,
                    endTime: actualEndTime,
                    maxPoints: maxPointsInt
                },
                channels: results,
                errors: errors.length > 0 ? errors : undefined
            };

        } catch (error) {
            console.error(`Error getting bulk acceleration channel data for ${experimentId}:`, error);
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
            const parseResult = await this.parseExperimentAccelerationFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;

            // Handle magnitude statistics specially
            if (channelId === 'acc_magnitude') {
                const magnitudeRange = processor.getDataRanges()['acc_magnitude'];
                
                if (!magnitudeRange) {
                    return { 
                        success: false, 
                        error: 'Magnitude statistics not available' 
                    };
                }
                
                return {
                    success: true,
                    experimentId: experimentId,
                    channelId: channelId,
                    statistics: {
                        min: magnitudeRange.min,
                        max: magnitudeRange.max,
                        range: magnitudeRange.range,
                        rms: magnitudeRange.rms,
                        unit: magnitudeRange.unit,
                        label: magnitudeRange.label,
                        axis: magnitudeRange.axis,
                        isCalculated: true,
                        calculationMethod: 'sqrt(x² + y² + z²)'
                    }
                };
            }

            // Get regular channel statistics
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
            console.error(`Error getting acceleration channel statistics for ${experimentId}/${channelId}:`, error);
            return { 
                success: false, 
                error: `Failed to get statistics: ${error.message}` 
            };
        }
    }

    /**
     * Check if acceleration CSV file exists for experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if file exists
     */
    async hasAccelerationFile(experimentId) {
        try {
            const filePath = await this.getActualAccelerationFilePath(experimentId);
            return filePath !== null;
        } catch (error) {
            console.error(`Error checking acceleration file for ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Get actual acceleration file path by scanning directory
     * Looks for files matching patterns: *_beschleuinigung.csv or daq_download.csv
     * @param {string} experimentId - Experiment ID  
     * @returns {Promise<string|null>} Actual file path or null
     */
    async getActualAccelerationFilePath(experimentId) {
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
            
            // Look for acceleration CSV files using the known patterns
            const accelerationFile = files.find(file => {
                const fileName = path.basename(file).toLowerCase();
                const expIdLower = experimentId.toLowerCase();
                
                // Primary pattern: {ExperimentID}_beschleuinigung.csv
                if (fileName === `${expIdLower}_beschleuinigung.csv`) {
                    return true;
                }
                
                // Fallback pattern: daq_download.csv
                if (fileName === 'daq_download.csv') {
                    return true;
                }
                
                return false;
            });
            
            if (accelerationFile) {
                console.log(`Found acceleration file: ${path.basename(accelerationFile)}`);
                return accelerationFile;
            }
            
            console.warn(`No acceleration CSV file found for experiment: ${experimentId}`);
            console.warn(`  Searched for patterns: ${experimentId.toLowerCase()}_beschleuinigung.csv, daq_download.csv`);
            return null;
            
        } catch (error) {
            console.error(`Error finding acceleration file for ${experimentId}:`, error);
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
     * Get experiment acceleration file path (legacy method - now uses actual scanning)
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<string|null>} Full path to acceleration CSV file
     */
    async getExperimentAccelerationFilePath(experimentId) {
        // Use the actual file scanning method
        return await this.getActualAccelerationFilePath(experimentId);
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        if (this.dataCache.has(experimentId)) {
            this.dataCache.delete(experimentId);
            console.log(`Cleared acceleration cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        const count = this.dataCache.size;
        this.dataCache.clear();
        console.log(`Cleared all acceleration cached data (${count} experiments)`);
    }

    /**
     * Get cache status
     * @returns {Object} Cache information
     */
    getCacheStatus() {
        const cacheEntries = [];
        
        for (const [experimentId, data] of this.dataCache.entries()) {
            const channelInfo = {};
            const accelerationData = data.processor.accelerationData;
            
            for (const [channelId, channelData] of Object.entries(accelerationData)) {
                channelInfo[channelId] = {
                    points: channelData.points,
                    samplingRate: channelData.samplingRate,
                    axis: channelData.axis
                };
            }
            
            cacheEntries.push({
                experimentId: experimentId,
                processedAt: data.processedAt,
                fileSize: data.fileSize,
                filePath: path.basename(data.filePath),
                channels: channelInfo,
                detectedFormat: data.metadata.detectedFormat
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
        console.log(`Cached acceleration data for experiment ${experimentId}`);
    }

    /**
     * Validate channel ID format
     * @private
     */
    _isValidChannelId(channelId) {
        // Support standard acceleration channels and magnitude
        const validChannels = ['acc_x', 'acc_y', 'acc_z', 'acc_magnitude'];
        return validChannels.includes(channelId);
    }
}

module.exports = AccelerationCsvService;