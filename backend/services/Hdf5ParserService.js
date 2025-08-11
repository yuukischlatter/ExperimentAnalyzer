/**
 * HDF5 Parser Service
 * Orchestrates HDF5 file parsing and integrates with the experiment system
 * Handles .tpc5 file processing for high-performance time-series data visualization
 */

const path = require('path');
const fs = require('fs').promises;
const Hdf5Reader = require('../utils/Hdf5Reader');
const Hdf5DataProcessor = require('../utils/Hdf5DataProcessor');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class Hdf5ParserService {
    constructor() {
        this.serviceName = 'HDF5 Parser Service';
        // In-memory cache for parsed HDF5 data (with TTL)
        this.dataCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL (match binary system)
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Parse experiment HDF5 file and return processed data
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseExperimentHdf5File(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing HDF5 file for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached HDF5 data for ${experimentId}`);
                    return createServiceResult(true, 'HDF5 data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Resolve file path
            const hdf5FilePath = this.getExperimentHdf5FilePath(experimentId);
            
            // Validate file exists
            const fileExists = await this._fileExists(hdf5FilePath);
            if (!fileExists) {
                const errorMsg = `HDF5 file not found: ${hdf5FilePath}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Get file size for logging
            const fileStats = await fs.stat(hdf5FilePath);
            const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
            console.log(`Processing HDF5 file: ${fileSizeMB} MB`);

            // Create and initialize HDF5 reader
            const hdf5Reader = new Hdf5Reader(hdf5FilePath);
            await hdf5Reader.readFile();

            // Create data processor with progressive reader
            const processor = new Hdf5DataProcessor(
                hdf5Reader.getProgressiveReader(),
                hdf5Reader.getMetadata()
            );

            // Cache the processed data
            const processedData = {
                reader: hdf5Reader,
                processor: processor,
                metadata: hdf5Reader.getMetadata(),
                filePath: hdf5FilePath,
                fileSize: fileStats.size,
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `HDF5 file parsed successfully (${fileSizeMB} MB)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse HDF5 file for ${experimentId}: ${error.message}`;
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
     * Get HDF5 file metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including channels, duration, etc.
     */
    async getHdf5Metadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentHdf5File(experimentId);
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
                    total: metadataSummary.totalChannels
                },
                
                // Time information
                timeRange: timeRange,
                duration: metadataSummary.duration,
                samplingRate: metadataSummary.samplingRate,
                
                // HDF5-specific information
                hdf5Specific: {
                    fileType: 'TPC5/HDF5',
                    availableDatasets: metadataSummary.hdf5Specific?.availableDatasets || [],
                    progressiveZoomLevels: metadataSummary.hdf5Specific?.progressiveZoomLevels || 0,
                    coordinatedLoadingSupported: metadataSummary.hdf5Specific?.coordinatedLoadingSupported || false,
                    nativeAddonUsed: true
                },
                
                // File information
                rawMetadata: {
                    originalMetadata: metadata.hdf5Specific || {},
                    channelMapping: metadata.channelMapping || {},
                    processingStats: metadata.processingStats || {}
                }
            };

        } catch (error) {
            console.error(`Error getting HDF5 metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get metadata: ${error.message}` 
            };
        }
    }

    /**
     * Get channel data with resampling support
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID (e.g., "hdf5_Ch1")
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

            // Validate channel ID format for HDF5
            if (!this._isValidHdf5ChannelId(channelId)) {
                return { 
                    success: false, 
                    error: `Invalid HDF5 channel ID format: ${channelId}. Expected format: hdf5_* or valid HDF5 channel ID` 
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentHdf5File(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            
            // Check if channel exists
            const channelInfo = processor.getChannelById(channelId);
            if (!channelInfo) {
                return { 
                    success: false, 
                    error: `Channel ${channelId} not found` 
                };
            }

            // Determine end time if not provided
            const timeRange = processor.getTimeRange();
            const actualEndTime = endTime || timeRange.max;

            // Get channel data using processor
            const result = processor.getChannelDataForAPI(channelId, startTime, actualEndTime, maxPoints);
            
            if (!result.success) {
                return result;
            }

            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                data: result.data,
                metadata: {
                    ...result.metadata,
                    requestedRange: { startTime, endTime: actualEndTime },
                    maxPointsRequested: maxPoints,
                    processingMethod: 'progressive_hdf5_reader'
                }
            };

        } catch (error) {
            console.error(`Error getting HDF5 channel data for ${experimentId}/${channelId}:`, error);
            return { 
                success: false, 
                error: `Failed to get channel data: ${error.message}` 
            };
        }
    }

    /**
     * Get multiple channels data efficiently using bulk operations
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

            // Filter valid HDF5 channel IDs
            const validChannelIds = channelIds.filter(id => this._isValidHdf5ChannelId(id));
            if (validChannelIds.length === 0) {
                return {
                    success: false,
                    error: 'No valid HDF5 channel IDs provided'
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentHdf5File(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            const timeRange = processor.getTimeRange();
            const actualEndTime = endTime || timeRange.max;
            
            console.log(`Bulk loading ${validChannelIds.length} HDF5 channels for ${experimentId}`);
            
            // Use processor's bulk loading capabilities
            const bulkResult = processor.getBulkChannelDataForAPI(
                validChannelIds, 
                startTime, 
                actualEndTime, 
                maxPoints
            );

            if (!bulkResult.success) {
                return bulkResult;
            }

            return {
                success: true,
                experimentId: experimentId,
                requestedChannels: channelIds.length,
                validChannels: validChannelIds.length,
                successfulChannels: bulkResult.successfulChannels,
                failedChannels: bulkResult.failedChannels,
                requestOptions: {
                    startTime,
                    endTime: actualEndTime,
                    maxPoints
                },
                channels: bulkResult.channels,
                errors: bulkResult.errors,
                
                // HDF5-specific bulk metadata
                hdf5BulkInfo: {
                    coordinatedLoading: bulkResult.coordinatedLoading,
                    selectedDataset: bulkResult.selectedDataset,
                    processingMethod: 'progressive_hdf5_bulk'
                }
            };

        } catch (error) {
            console.error(`Error getting bulk HDF5 channel data for ${experimentId}:`, error);
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
            if (!this._isValidHdf5ChannelId(channelId)) {
                return { 
                    success: false, 
                    error: `Invalid HDF5 channel ID format: ${channelId}` 
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentHdf5File(experimentId);
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
                    error: `Channel ${channelId} not found or statistics unavailable` 
                };
            }

            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                statistics: {
                    ...stats,
                    calculationMethod: 'hdf5_overview_sampling',
                    dataQuality: stats.samplesAnalyzed >= 1000 ? 'high' : 'medium'
                }
            };

        } catch (error) {
            console.error(`Error getting HDF5 channel statistics for ${experimentId}/${channelId}:`, error);
            return { 
                success: false, 
                error: `Failed to get statistics: ${error.message}` 
            };
        }
    }

    /**
     * Get available channels for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Available channels information
     */
    async getAvailableChannels(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentHdf5File(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const processor = cachedData.processor;
            const availableChannels = processor.getAllAvailableChannels();
            const channelsByUnit = processor.getChannelsByUnit();
            const defaultChannels = processor.getDefaultDisplayChannels();

            return {
                success: true,
                experimentId: experimentId,
                channels: availableChannels,
                channelsByUnit: channelsByUnit,
                defaultChannels: defaultChannels,
                totalChannels: availableChannels.hdf5?.length || 0,
                channelFormat: 'hdf5',
                recommendedMaxConcurrent: Math.min(defaultChannels.length, 8) // Reasonable limit
            };

        } catch (error) {
            console.error(`Error getting available channels for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get available channels: ${error.message}` 
            };
        }
    }

    /**
     * Get experiment HDF5 file path
     * @param {string} experimentId - Experiment ID
     * @returns {string} Full path to HDF5 file
     */
    getExperimentHdf5FilePath(experimentId) {
        // Path pattern: R:/Schweissungen/J25-07-30(3)/J25-07-30(3).tpc5
        const experimentFolder = path.join(config.experiments.rootPath, experimentId);
        const hdf5FileName = `${experimentId}_original(manuell).tpc5`;
        const fullPath = path.join(experimentFolder, hdf5FileName);
        
        return fullPath;
    }

    /**
     * Get alternative HDF5 file paths to check
     * @param {string} experimentId - Experiment ID
     * @returns {string[]} Array of possible file paths
     */
    getAlternativeHdf5FilePaths(experimentId) {
        const experimentFolder = path.join(config.experiments.rootPath, experimentId);
        const baseName = experimentId;
        
        // Check multiple possible extensions
        const extensions = config.hdf5?.fileExtensions || ['.tpc5', '.hdf5', '.h5'];
        
        return extensions.map(ext => path.join(experimentFolder, `${baseName}${ext}`));
    }

    /**
     * Check if HDF5 file exists for experiment (try multiple extensions)
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} File existence info
     */
    async hasHdf5File(experimentId) {
        try {
            // Try primary path first
            const primaryPath = this.getExperimentHdf5FilePath(experimentId);
            if (await this._fileExists(primaryPath)) {
                return {
                    exists: true,
                    filePath: primaryPath,
                    fileExtension: path.extname(primaryPath)
                };
            }

            // Try alternative paths
            const alternativePaths = this.getAlternativeHdf5FilePaths(experimentId);
            for (const filePath of alternativePaths) {
                if (await this._fileExists(filePath)) {
                    return {
                        exists: true,
                        filePath: filePath,
                        fileExtension: path.extname(filePath)
                    };
                }
            }

            return {
                exists: false,
                searchedPaths: [primaryPath, ...alternativePaths]
            };

        } catch (error) {
            console.error(`Error checking HDF5 file for ${experimentId}:`, error);
            return {
                exists: false,
                error: error.message
            };
        }
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        const cachedData = this.dataCache.get(experimentId);
        if (cachedData) {
            // Properly close HDF5 reader
            if (cachedData.reader) {
                cachedData.reader.close();
            }
            
            // Clear processor cache
            if (cachedData.processor) {
                cachedData.processor.clearCache();
            }
            
            this.dataCache.delete(experimentId);
            console.log(`Cleared HDF5 cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        let count = 0;
        for (const [experimentId, cachedData] of this.dataCache.entries()) {
            // Properly close HDF5 readers
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
        console.log(`Cleared all HDF5 cached data (${count} experiments)`);
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
                filePath: path.basename(data.filePath),
                processorCache: processorCacheStatus
            });
        }

        return {
            serviceName: this.serviceName,
            totalCachedExperiments: this.dataCache.size,
            cacheTimeoutMs: this.cacheTimeout,
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
                maxRecommendedCacheSize: 10 // Reasonable limit for HDF5 files
            },
            performance: {
                memoryUsageMB: memoryUsage.heapUsed / 1024 / 1024,
                totalMemoryMB: memoryUsage.rss / 1024 / 1024
            },
            capabilities: {
                nativeAddonSupport: true,
                progressiveZoom: true,
                bulkLoading: true,
                coordinatedLoading: true,
                supportedFormats: config.hdf5?.fileExtensions || ['.tpc5', '.hdf5', '.h5']
            }
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
        // Limit cache size to prevent memory issues
        if (this.dataCache.size >= 10) {
            // Remove oldest entry
            const oldestKey = this.dataCache.keys().next().value;
            console.log(`Cache full, removing oldest entry: ${oldestKey}`);
            this.clearCache(oldestKey);
        }

        this.dataCache.set(experimentId, data);
        console.log(`Cached HDF5 data for experiment ${experimentId}`);
    }

    /**
     * Validate HDF5 channel ID format
     * @private
     */
    _isValidHdf5ChannelId(channelId) {
        // Accept HDF5 format: hdf5_* 
        if (channelId.startsWith('hdf5_')) {
            return true;
        }
        
        // Accept direct HDF5 channel IDs (for backward compatibility)
        // Allow alphanumeric, underscore, and common HDF5 naming patterns
        if (/^[a-zA-Z0-9_]+$/.test(channelId)) {
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

module.exports = Hdf5ParserService;