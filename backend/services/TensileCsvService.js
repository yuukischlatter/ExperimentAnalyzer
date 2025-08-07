/**
 * Tensile CSV Service
 * Orchestrates tensile CSV file parsing and integrates with the experiment system
 * Handles .csv file processing for tensile testing data visualization
 * Patterns: *redalsa.csv (old format) and {experimentId}*.csv (new format)
 */

const path = require('path');
const fs = require('fs').promises;
const TensileCsvReader = require('../utils/TensileCsvReader');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class TensileCsvService {
    constructor() {
        this.serviceName = 'Tensile CSV Service';
        // In-memory cache for parsed tensile data
        this.dataCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL (same as other services)
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Parse experiment tensile CSV file and return processed data
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseExperimentTensileFile(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing tensile CSV for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached tensile data for ${experimentId}`);
                    return createServiceResult(true, 'Tensile data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Resolve actual file path by scanning directory
            const tensileFilePath = await this.getActualTensileFilePath(experimentId);
            
            // Validate file exists
            if (!tensileFilePath) {
                const errorMsg = `Tensile CSV file not found for experiment: ${experimentId}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Get file size for logging
            const fileStats = await fs.stat(tensileFilePath);
            const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
            console.log(`Processing tensile CSV file: ${fileSizeMB} MB`);

            // Parse CSV file
            const csvReader = new TensileCsvReader(tensileFilePath);
            await csvReader.readFile();

            // Cache the processed data
            const processedData = {
                reader: csvReader,
                metadata: csvReader.getMetadata(),
                headerMetadata: csvReader.getHeaderMetadata(),
                filePath: tensileFilePath,
                fileSize: fileStats.size,
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `Tensile CSV file parsed successfully (${fileSizeMB} MB)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse tensile CSV for ${experimentId}: ${error.message}`;
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
     * Get tensile CSV metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including channels, duration, test parameters, etc.
     */
    async getTensileMetadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentTensileFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found after parsing' };
            }

            const reader = cachedData.reader;
            const metadata = cachedData.metadata;
            const headerMetadata = cachedData.headerMetadata;

            // Generate comprehensive metadata
            const availableChannels = this._getAllAvailableChannels(reader);
            const channelsByUnit = this._getChannelsByUnit(reader);
            const defaultChannels = reader.getDefaultDisplayChannels();
            const timeRange = reader.getTimeRange();
            const dataRanges = this._calculateDataRanges(reader);

            return {
                success: true,
                experimentId: experimentId,
                filePath: cachedData.filePath,
                fileSize: cachedData.fileSize,
                processedAt: cachedData.processedAt,
                
                // Core metadata
                metadata: {
                    fileName: metadata.fileName,
                    processedAt: metadata.processedAt,
                    totalLines: metadata.totalLines,
                    validDataLines: metadata.validDataLines,
                    formatInfo: metadata.formatInfo
                },
                
                // Test-specific metadata from header
                testMetadata: {
                    testNumber: headerMetadata.testNumber,
                    railType: headerMetadata.railType,
                    materialGrade: headerMetadata.materialGrade,
                    nominalForce: headerMetadata.nominalForce,
                    minForceLimit: headerMetadata.minForceLimit,
                    deformationDistance: headerMetadata.deformationDistance,
                    minDeformation: headerMetadata.minDeformation,
                    testDate: headerMetadata.testDate,
                    testDateString: headerMetadata.testDateString,
                    testComment: headerMetadata.testComment,
                    testedBy: headerMetadata.testedBy,
                    welderName: headerMetadata.welderName,
                    weldingMachineNumber: headerMetadata.weldingMachineNumber,
                    railMark: headerMetadata.railMark
                },
                
                // Channel information
                channels: {
                    available: availableChannels,
                    byUnit: channelsByUnit,
                    defaults: defaultChannels,
                    ranges: dataRanges
                },
                
                // Time information (for time-series channels)
                timeRange: timeRange,
                duration: timeRange.max - timeRange.min,
                
                // Tensile-specific information
                tensileInfo: {
                    testType: 'Rail Tensile Test',
                    dataFormat: 'Multi-section coordinate pairs',
                    coordinatePairFormat: '{X=value, Y=value}',
                    hasForceDisplacementCurve: true,
                    hasTimeSeriesData: true,
                    samplingInfo: {
                        estimatedRate: this._estimateSamplingRate(reader),
                        dataPoints: reader.getCoordinateData().length
                    }
                }
            };

        } catch (error) {
            console.error(`Error getting tensile metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get metadata: ${error.message}` 
            };
        }
    }

    /**
     * Get channel data with resampling support
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID (force_kN, displacement_mm, force_vs_displacement)
     * @param {Object} options - Options for data retrieval
     * @returns {Promise<Object>} Channel data with time/values or x/y values
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
            const parseResult = await this.parseExperimentTensileFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const reader = cachedData.reader;
            
            // Check if channel exists
            const channelData = reader.getChannelData(channelId);
            if (!channelData) {
                return { 
                    success: false, 
                    error: `Channel ${channelId} not found` 
                };
            }

            // Handle different channel types
            if (channelData.type === 'time_series') {
                return this._getTimeSeriesChannelData(channelId, channelData, startTime, endTime, maxPoints, experimentId);
            } else if (channelData.type === 'xy_relationship') {
                return this._getXYRelationshipChannelData(channelId, channelData, maxPoints, experimentId);
            } else {
                return { 
                    success: false, 
                    error: `Unknown channel type: ${channelData.type}` 
                };
            }

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

            if (channelIds.length === 0) {
                return { 
                    success: false, 
                    error: 'channelIds cannot be empty' 
                };
            }

            // Filter valid channel IDs
            const validChannelIds = channelIds.filter(id => this._isValidChannelId(id));
            if (validChannelIds.length === 0) {
                return { 
                    success: false, 
                    error: 'No valid channel IDs provided' 
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentTensileFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const reader = cachedData.reader;
            
            // Process each channel
            const results = {};
            const errors = [];
            
            for (const channelId of validChannelIds) {
                try {
                    // Get individual channel data
                    const channelResult = await this.getChannelData(experimentId, channelId, {
                        startTime,
                        endTime,
                        maxPoints
                    });

                    if (channelResult.success) {
                        results[channelId] = {
                            success: true,
                            data: channelResult.data,
                            metadata: channelResult.metadata
                        };
                    } else {
                        results[channelId] = { 
                            success: false, 
                            error: channelResult.error 
                        };
                        errors.push(`${channelId}: ${channelResult.error}`);
                    }

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
                    endTime,
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
            const parseResult = await this.parseExperimentTensileFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            const reader = cachedData.reader;
            const channelData = reader.getChannelData(channelId);
            
            if (!channelData) {
                return { 
                    success: false, 
                    error: `Channel ${channelId} not found` 
                };
            }

            // Calculate statistics based on channel type
            const stats = this._calculateChannelStatistics(channelData, channelId);
            
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
     * Check if tensile CSV file exists for experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if file exists
     */
    async hasTensileFile(experimentId) {
        try {
            const filePath = await this.getActualTensileFilePath(experimentId);
            return filePath !== null;
        } catch (error) {
            console.error(`Error checking tensile file for ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Get actual tensile file path by scanning directory
     * Looks for both old format (*redalsa.csv) and new format ({experimentId}*.csv)
     * @param {string} experimentId - Experiment ID  
     * @returns {Promise<string|null>} Actual file path or null
     */
    async getActualTensileFilePath(experimentId) {
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
            
            // Look for tensile CSV files using both patterns
            const expIdLower = experimentId.toLowerCase();
            
            let tensileFile = null;
            
            // First, try to find old format: *redalsa.csv
            tensileFile = files.find(file => {
                const fileName = path.basename(file).toLowerCase();
                return fileName.endsWith('redalsa.csv');
            });
            
            // If not found, try new format: {experimentId}*.csv (excluding other types)
            if (!tensileFile) {
                tensileFile = files.find(file => {
                    const fileName = path.basename(file).toLowerCase();
                    return fileName.endsWith('.csv') &&
                           fileName.startsWith(expIdLower) &&
                           !fileName.includes('beschleuinigung') &&
                           !fileName.includes('temperature') &&
                           !fileName.includes('snapshot');
                });
            }
            
            if (tensileFile) {
                console.log(`Found tensile file: ${path.basename(tensileFile)}`);
                return tensileFile;
            }
            
            console.warn(`No tensile CSV file found for experiment: ${experimentId}`);
            return null;
            
        } catch (error) {
            console.error(`Error finding tensile file for ${experimentId}:`, error);
            return null;
        }
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        if (this.dataCache.has(experimentId)) {
            this.dataCache.delete(experimentId);
            console.log(`Cleared tensile cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        const count = this.dataCache.size;
        this.dataCache.clear();
        console.log(`Cleared all tensile cached data (${count} experiments)`);
    }

    /**
     * Get cache status
     * @returns {Object} Cache information
     */
    getCacheStatus() {
        const cacheEntries = [];
        
        for (const [experimentId, data] of this.dataCache.entries()) {
            const headerMetadata = data.headerMetadata || {};
            cacheEntries.push({
                experimentId: experimentId,
                processedAt: data.processedAt,
                fileSize: data.fileSize,
                filePath: path.basename(data.filePath),
                testNumber: headerMetadata.testNumber,
                materialGrade: headerMetadata.materialGrade,
                nominalForce: headerMetadata.nominalForce,
                dataPoints: data.reader ? data.reader.getCoordinateData().length : 0
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
        console.log(`Cached tensile data for experiment ${experimentId}`);
    }

    /**
     * Validate channel ID format
     * @private
     */
    _isValidChannelId(channelId) {
        const validChannels = ['force_kN', 'displacement_mm', 'force_vs_displacement'];
        return validChannels.includes(channelId);
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
                } else if (entry.isDirectory()) {
                    // Recursively scan subdirectories
                    const subFiles = await this._getAllFilesRecursive(fullPath);
                    files.push(...subFiles);
                }
            }
        } catch (error) {
            // Silently handle directory read errors
            console.warn(`Could not read directory ${dirPath}: ${error.message}`);
        }
        
        return files;
    }

    /**
     * Get all available channels from reader
     * @private
     */
    _getAllAvailableChannels(reader) {
        const available = { 
            timeSeries: [], 
            xyRelationship: [] 
        };
        
        const allChannels = reader.getAllChannels();
        
        // Time series channels
        for (const [channelId, channelData] of Object.entries(allChannels.timeSeries)) {
            available.timeSeries.push({
                id: channelId,
                label: channelData.label,
                unit: channelData.unit,
                points: channelData.points,
                samplingRate: channelData.samplingRate || 0,
                type: 'time_series'
            });
        }
        
        // XY relationship channels
        for (const [channelId, channelData] of Object.entries(allChannels.xyRelationship)) {
            available.xyRelationship.push({
                id: channelId,
                xLabel: channelData.xLabel,
                yLabel: channelData.yLabel,
                xUnit: channelData.xUnit,
                yUnit: channelData.yUnit,
                points: channelData.points,
                type: 'xy_relationship'
            });
        }
        
        return available;
    }

    /**
     * Get channels grouped by unit
     * @private
     */
    _getChannelsByUnit(reader) {
        const byUnit = { 'kN': [], 'mm': [], 'mixed': [] };
        
        const tensileData = reader.getTensileData();
        
        for (const [channelId, channelData] of Object.entries(tensileData)) {
            if (channelData.type === 'time_series') {
                const unit = channelData.unit;
                if (!byUnit[unit]) {
                    byUnit[unit] = [];
                }
                
                byUnit[unit].push({
                    id: channelId,
                    label: channelData.label,
                    type: 'time_series'
                });
            } else if (channelData.type === 'xy_relationship') {
                byUnit.mixed.push({
                    id: channelId,
                    xLabel: channelData.xLabel,
                    yLabel: channelData.yLabel,
                    xUnit: channelData.xUnit,
                    yUnit: channelData.yUnit,
                    type: 'xy_relationship'
                });
            }
        }
        
        return byUnit;
    }

    /**
     * Calculate data ranges for auto-scaling
     * @private
     */
    _calculateDataRanges(reader) {
        const ranges = {};
        const tensileData = reader.getTensileData();
        
        for (const [channelId, channelData] of Object.entries(tensileData)) {
            if (channelData.type === 'time_series' && channelData.values) {
                const values = channelData.values;
                let min = values[0];
                let max = values[0];
                
                for (let i = 1; i < values.length; i++) {
                    const val = values[i];
                    if (val < min) min = val;
                    if (val > max) max = val;
                }
                
                ranges[channelId] = {
                    min: min,
                    max: max,
                    range: max - min,
                    unit: channelData.unit,
                    label: channelData.label
                };
            } else if (channelData.type === 'xy_relationship' && channelData.x && channelData.y) {
                // Handle XY data ranges
                const xValues = channelData.x;
                const yValues = channelData.y;
                
                let xMin = xValues[0], xMax = xValues[0];
                let yMin = yValues[0], yMax = yValues[0];
                
                for (let i = 1; i < xValues.length; i++) {
                    if (xValues[i] < xMin) xMin = xValues[i];
                    if (xValues[i] > xMax) xMax = xValues[i];
                    if (yValues[i] < yMin) yMin = yValues[i];
                    if (yValues[i] > yMax) yMax = yValues[i];
                }
                
                ranges[channelId] = {
                    x: { min: xMin, max: xMax, unit: channelData.xUnit },
                    y: { min: yMin, max: yMax, unit: channelData.yUnit },
                    type: 'xy_relationship'
                };
            }
        }
        
        return ranges;
    }

    /**
     * Estimate sampling rate from coordinate data
     * @private
     */
    _estimateSamplingRate(reader) {
        const coordinateData = reader.getCoordinateData();
        if (coordinateData.length < 2) return 0;
        
        const totalTime = coordinateData[coordinateData.length - 1].time - coordinateData[0].time;
        const avgInterval = totalTime / (coordinateData.length - 1);
        
        return avgInterval > 0 ? 1.0 / avgInterval : 0;
    }

    /**
     * Get time series channel data with resampling
     * @private
     */
    _getTimeSeriesChannelData(channelId, channelData, startTime, endTime, maxPoints, experimentId) {
        // For now, simple time range filtering and decimation
        // This could be enhanced with the processor later
        
        const timeData = channelData.time;
        const valueData = channelData.values;
        
        // Find time range indices
        let startIdx = 0;
        let endIdx = timeData.length - 1;
        
        if (endTime !== null) {
            // Find actual end time or use provided
            const actualEndTime = Math.min(endTime, timeData[timeData.length - 1]);
            
            // Simple linear search for time indices
            for (let i = 0; i < timeData.length; i++) {
                if (timeData[i] >= startTime && startIdx === 0) startIdx = i;
                if (timeData[i] <= actualEndTime) endIdx = i;
            }
        }
        
        const totalPoints = endIdx - startIdx + 1;
        
        if (totalPoints <= maxPoints) {
            // Return raw data if within limits
            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                data: {
                    time: Array.from(timeData.slice(startIdx, endIdx + 1)),
                    values: Array.from(valueData.slice(startIdx, endIdx + 1))
                },
                metadata: {
                    label: channelData.label,
                    unit: channelData.unit,
                    type: 'time_series',
                    actualPoints: totalPoints,
                    requestedRange: { startTime, endTime },
                    maxPointsRequested: maxPoints
                }
            };
        } else {
            // Simple decimation for now
            const step = Math.ceil(totalPoints / maxPoints);
            const resampledTime = [];
            const resampledValues = [];
            
            for (let i = startIdx; i <= endIdx; i += step) {
                resampledTime.push(timeData[i]);
                resampledValues.push(valueData[i]);
            }
            
            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                data: {
                    time: resampledTime,
                    values: resampledValues
                },
                metadata: {
                    label: channelData.label,
                    unit: channelData.unit,
                    type: 'time_series',
                    actualPoints: resampledTime.length,
                    originalPoints: totalPoints,
                    requestedRange: { startTime, endTime },
                    maxPointsRequested: maxPoints,
                    resampled: true,
                    resampleRatio: step
                }
            };
        }
    }

    /**
     * Get XY relationship channel data with optional resampling
     * @private
     */
    _getXYRelationshipChannelData(channelId, channelData, maxPoints, experimentId) {
        const xData = channelData.x;
        const yData = channelData.y;
        const totalPoints = xData.length;
        
        if (totalPoints <= maxPoints) {
            // Return raw data if within limits
            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                data: {
                    x: Array.from(xData),
                    y: Array.from(yData)
                },
                metadata: {
                    xLabel: channelData.xLabel,
                    yLabel: channelData.yLabel,
                    xUnit: channelData.xUnit,
                    yUnit: channelData.yUnit,
                    type: 'xy_relationship',
                    actualPoints: totalPoints,
                    maxPointsRequested: maxPoints
                }
            };
        } else {
            // Simple decimation
            const step = Math.ceil(totalPoints / maxPoints);
            const resampledX = [];
            const resampledY = [];
            
            for (let i = 0; i < totalPoints; i += step) {
                resampledX.push(xData[i]);
                resampledY.push(yData[i]);
            }
            
            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                data: {
                    x: resampledX,
                    y: resampledY
                },
                metadata: {
                    xLabel: channelData.xLabel,
                    yLabel: channelData.yLabel,
                    xUnit: channelData.xUnit,
                    yUnit: channelData.yUnit,
                    type: 'xy_relationship',
                    actualPoints: resampledX.length,
                    originalPoints: totalPoints,
                    maxPointsRequested: maxPoints,
                    resampled: true,
                    resampleRatio: step
                }
            };
        }
    }

    /**
     * Calculate comprehensive channel statistics
     * @private
     */
    _calculateChannelStatistics(channelData, channelId) {
        if (channelData.type === 'time_series') {
            return this._calculateTimeSeriesStatistics(channelData, channelId);
        } else if (channelData.type === 'xy_relationship') {
            return this._calculateXYRelationshipStatistics(channelData, channelId);
        }
        
        return null;
    }

    /**
     * Calculate time series statistics
     * @private
     */
    _calculateTimeSeriesStatistics(channelData, channelId) {
        const values = channelData.values;
        const n = values.length;
        
        if (n === 0) return null;
        
        let min = values[0];
        let max = values[0];
        let sum = 0;
        let sumSquares = 0;
        
        for (let i = 0; i < n; i++) {
            const val = values[i];
            min = Math.min(min, val);
            max = Math.max(max, val);
            sum += val;
            sumSquares += val * val;
        }
        
        const mean = sum / n;
        const variance = (sumSquares / n) - (mean * mean);
        const stdDev = Math.sqrt(Math.max(0, variance));
        
        return {
            min, max, mean, stdDev,
            count: n,
            unit: channelData.unit,
            label: channelData.label,
            type: 'time_series',
            
            // Tensile-specific for force/displacement
            range: max - min,
            peakValue: max,
            samplingRate: channelData.samplingRate || 0
        };
    }

    /**
     * Calculate XY relationship statistics  
     * @private
     */
    _calculateXYRelationshipStatistics(channelData, channelId) {
        const xValues = channelData.x;
        const yValues = channelData.y;
        const n = xValues.length;
        
        if (n === 0) return null;
        
        // X statistics
        let xMin = xValues[0], xMax = xValues[0], xSum = 0;
        let yMin = yValues[0], yMax = yValues[0], ySum = 0;
        
        for (let i = 0; i < n; i++) {
            xMin = Math.min(xMin, xValues[i]);
            xMax = Math.max(xMax, xValues[i]);
            xSum += xValues[i];
            
            yMin = Math.min(yMin, yValues[i]);
            yMax = Math.max(yMax, yValues[i]);
            ySum += yValues[i];
        }
        
        const xMean = xSum / n;
        const yMean = ySum / n;
        
        return {
            count: n,
            type: 'xy_relationship',
            
            x: {
                min: xMin, max: xMax, mean: xMean,
                range: xMax - xMin,
                unit: channelData.xUnit,
                label: channelData.xLabel
            },
            y: {
                min: yMin, max: yMax, mean: yMean,
                range: yMax - yMin,
                unit: channelData.yUnit,
                label: channelData.yLabel
            },
            
            // Materials testing specific
            ultimateStrength: yMax, // Peak force
            maxDisplacement: xMax,   // Maximum displacement
            
            // Could add more: yield strength estimation, elastic modulus, etc.
        };
    }
}

module.exports = TensileCsvService;