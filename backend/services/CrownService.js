/**
 * Crown Service
 * Orchestrates crown measurement data parsing from Excel and journal files
 * Handles geradheit+versatz.xlsx (cold measurements) + schweissjournal.txt (warm measurements)
 * Provides comprehensive crown analysis for rail manufacturing quality control
 */

const path = require('path');
const fs = require('fs').promises;
const CrownExcelReader = require('../utils/CrownExcelReader');
const CrownJournalReader = require('../utils/CrownJournalReader');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class CrownService {
    constructor() {
        this.serviceName = 'Crown Service';
        // In-memory cache for parsed crown data
        this.dataCache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes TTL
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Parse experiment crown data and return processed results
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-parsing even if cached
     * @returns {Promise<Object>} Service result with parsed data
     */
    async parseExperimentCrownData(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Parsing crown data for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached crown data for ${experimentId}`);
                    return createServiceResult(true, 'Crown data loaded from cache', 1, 0, Date.now() - startTime);
                }
            }

            // Discover and validate files
            const filePaths = await this.discoverCrownFiles(experimentId);
            if (!filePaths.excelPath || !filePaths.journalPath) {
                const errorMsg = `Crown files not found for experiment: ${experimentId}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            console.log(`Processing crown files: Excel=${path.basename(filePaths.excelPath)}, Journal=${path.basename(filePaths.journalPath)}`);

            // Parse Excel file (cold measurements + calculated values)
            const excelReader = new CrownExcelReader(filePaths.excelPath);
            const excelData = await excelReader.readFile();

            // Parse journal file (warm measurements - mini parser)
            const journalReader = new CrownJournalReader(filePaths.journalPath);
            const journalData = await journalReader.readCrownData();

            // Get file statistics for metadata
            const excelStats = await fs.stat(filePaths.excelPath);
            const journalStats = await fs.stat(filePaths.journalPath);

            // Combine and cache the processed data
            const processedData = {
                excelData: excelData,
                journalData: journalData,
                filePaths: filePaths,
                fileStats: {
                    excel: { size: excelStats.size, modified: excelStats.mtime },
                    journal: { size: journalStats.size, modified: journalStats.mtime }
                },
                processedAt: new Date(),
                experimentId: experimentId
            };

            this._setCachedData(experimentId, processedData);

            const duration = Date.now() - startTime;
            const excelSizeMB = (excelStats.size / 1024 / 1024).toFixed(1);
            console.log(`${this.serviceName}: Successfully parsed ${experimentId} in ${duration}ms (Excel: ${excelSizeMB}MB)`);

            return createServiceResult(
                true, 
                `Crown data parsed successfully (Excel: ${excelSizeMB}MB, Journal: ${journalData.metadata.linesProcessed} lines)`, 
                1, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to parse crown data for ${experimentId}: ${error.message}`;
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
     * Get crown measurement metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Metadata including channels, measurements, file info, etc.
     */
    async getCrownMetadata(experimentId) {
        try {
            // Ensure data is parsed
            const parseResult = await this.parseExperimentCrownData(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found after parsing' };
            }

            const excelData = cachedData.excelData;
            const journalData = cachedData.journalData;

            // Generate comprehensive metadata
            const availableChannels = this._getAllAvailableChannels(excelData, journalData);
            const channelsByType = this._getChannelsByType(excelData, journalData);
            const defaultChannels = this._getDefaultDisplayChannels();
            const measurementRanges = this._calculateMeasurementRanges(excelData, journalData);

            return {
                success: true,
                experimentId: experimentId,
                filePaths: {
                    excel: cachedData.filePaths.excelPath,
                    journal: cachedData.filePaths.journalPath
                },
                fileStats: cachedData.fileStats,
                processedAt: cachedData.processedAt,
                
                // Core metadata
                metadata: {
                    excelFileName: path.basename(cachedData.filePaths.excelPath),
                    journalFileName: path.basename(cachedData.filePaths.journalPath),
                    processedAt: cachedData.processedAt,
                    totalColdMeasurements: Object.keys(excelData.coldSideMeasurements).length + Object.keys(excelData.topViewMeasurements).length,
                    totalWarmMeasurements: Object.keys(journalData.warmMeasurements).length,
                    totalCalculatedValues: Object.keys(excelData.calculatedValues).length
                },
                
                // Crown-specific metadata
                crownInfo: {
                    measurementType: 'Rail Crown Geometry Analysis',
                    dataFormat: 'Excel + Journal hybrid',
                    warmVsColdComparison: true,
                    temperatureStates: ['Cold (Excel)', 'Warm (Journal)'],
                    measurementUnits: 'millimeters (mm)',
                    scalingFactor: 30, // For visualization
                    zeitabstandCrownMessung: journalData.warmMeasurements.zeitabstandCrownMessung
                },
                
                // Warm vs Cold comparison data
                comparison: {
                    inlet: {
                        cold: excelData.coldSideMeasurements.N18, // N18 cold
                        warm: journalData.warmMeasurements.crownEinlaufSeiteWarm, // N18 warm equivalent
                        difference: journalData.warmMeasurements.crownEinlaufSeiteWarm - excelData.coldSideMeasurements.N18
                    },
                    outlet: {
                        cold: excelData.coldSideMeasurements.J18, // J18 cold
                        warm: journalData.warmMeasurements.crownAuslaufSeiteWarm, // J18 warm equivalent  
                        difference: journalData.warmMeasurements.crownAuslaufSeiteWarm - excelData.coldSideMeasurements.J18
                    }
                },
                
                // Channel information
                channels: {
                    available: availableChannels,
                    byType: channelsByType,
                    defaults: defaultChannels,
                    ranges: measurementRanges
                }
            };

        } catch (error) {
            console.error(`Error getting crown metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get metadata: ${error.message}` 
            };
        }
    }

    /**
     * Get channel data for visualization
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID (crown_warm_side, crown_cold_side, crown_top_view, crown_calculated)
     * @param {Object} options - Options for data retrieval
     * @returns {Promise<Object>} Channel data formatted for visualization
     */
    async getChannelData(experimentId, channelId, options = {}) {
        try {
            const {
                maxPoints = 1000 // Crown data is typically small, no resampling needed
            } = options;

            // Validate channel ID format
            if (!this._isValidChannelId(channelId)) {
                return { 
                    success: false, 
                    error: `Invalid channel ID format: ${channelId}` 
                };
            }

            // Ensure data is parsed
            const parseResult = await this.parseExperimentCrownData(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            // Generate channel data based on channel type
            const channelData = this._generateChannelData(channelId, cachedData.excelData, cachedData.journalData);
            
            if (!channelData) {
                return { 
                    success: false, 
                    error: `Channel ${channelId} not found or no data available` 
                };
            }

            return {
                success: true,
                experimentId: experimentId,
                channelId: channelId,
                data: channelData.data,
                metadata: {
                    label: channelData.label,
                    type: channelData.type,
                    unit: channelData.unit,
                    description: channelData.description,
                    dataPoints: channelData.dataPoints,
                    scalingFactor: channelData.scalingFactor || 1,
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
                maxPoints = 1000
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
            const parseResult = await this.parseExperimentCrownData(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No cached data found' };
            }

            // Process each channel
            const results = {};
            const errors = [];
            
            for (const channelId of validChannelIds) {
                try {
                    // Get individual channel data
                    const channelResult = await this.getChannelData(experimentId, channelId, {
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

            // Get channel data first
            const channelResult = await this.getChannelData(experimentId, channelId);
            if (!channelResult.success) {
                return { success: false, error: channelResult.error };
            }

            // Calculate statistics based on channel type
            const stats = this._calculateChannelStatistics(channelResult.data, channelResult.metadata, channelId);
            
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
     * Check if crown measurement files exist for experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if both files exist
     */
    async hasCrownFiles(experimentId) {
        try {
            const filePaths = await this.discoverCrownFiles(experimentId);
            return filePaths.excelPath !== null && filePaths.journalPath !== null;
        } catch (error) {
            console.error(`Error checking crown files for ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Discover crown measurement files in experiment directory
     * @param {string} experimentId - Experiment ID  
     * @returns {Promise<Object>} File paths: {excelPath, journalPath}
     */
    async discoverCrownFiles(experimentId) {
        try {
            const experimentFolder = path.join(config.experiments.rootPath, experimentId);
            
            // Check if experiment folder exists
            try {
                await fs.access(experimentFolder);
            } catch (error) {
                console.warn(`Experiment folder not found: ${experimentFolder}`);
                return { excelPath: null, journalPath: null };
            }
            
            // Get all files recursively
            const files = await this._getAllFilesRecursive(experimentFolder);
            const fileNames = files.map(f => path.basename(f).toLowerCase());
            
            // Look for Excel file: geradheit+versatz.xlsx
            let excelFile = files.find(file => {
                const fileName = path.basename(file).toLowerCase();
                return fileName === 'geradheit+versatz.xlsx';
            });
            
            // Look for journal file: schweissjournal.txt
            let journalFile = files.find(file => {
                const fileName = path.basename(file).toLowerCase();
                return fileName === 'schweissjournal.txt';
            });
            
            if (excelFile && journalFile) {
                console.log(`Found crown files for ${experimentId}: Excel=${path.basename(excelFile)}, Journal=${path.basename(journalFile)}`);
                return { 
                    excelPath: excelFile, 
                    journalPath: journalFile 
                };
            }
            
            const missing = [];
            if (!excelFile) missing.push('geradheit+versatz.xlsx');
            if (!journalFile) missing.push('schweissjournal.txt');
            
            console.warn(`Missing crown files for experiment ${experimentId}: ${missing.join(', ')}`);
            return { 
                excelPath: excelFile || null, 
                journalPath: journalFile || null 
            };
            
        } catch (error) {
            console.error(`Error discovering crown files for ${experimentId}:`, error);
            return { excelPath: null, journalPath: null };
        }
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        if (this.dataCache.has(experimentId)) {
            this.dataCache.delete(experimentId);
            console.log(`Cleared crown cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        const count = this.dataCache.size;
        this.dataCache.clear();
        console.log(`Cleared all crown cached data (${count} experiments)`);
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
                excelFileSize: data.fileStats.excel.size,
                journalFileSize: data.fileStats.journal.size,
                excelFileName: path.basename(data.filePaths.excelPath),
                journalFileName: path.basename(data.filePaths.journalPath),
                coldMeasurements: Object.keys(data.excelData.coldSideMeasurements).length,
                warmMeasurements: Object.keys(data.journalData.warmMeasurements).length,
                calculatedValues: Object.keys(data.excelData.calculatedValues).length
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
        console.log(`Cached crown data for experiment ${experimentId}`);
    }

    /**
     * Validate channel ID format
     * @private
     */
    _isValidChannelId(channelId) {
        const validChannels = ['crown_warm_side', 'crown_cold_side', 'crown_top_view', 'crown_calculated'];
        return validChannels.includes(channelId);
    }

    /**
     * Get all files recursively from directory
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
                    const subFiles = await this._getAllFilesRecursive(fullPath);
                    files.push(...subFiles);
                }
            }
        } catch (error) {
            console.warn(`Could not read directory ${dirPath}: ${error.message}`);
        }
        
        return files;
    }

    /**
     * Get all available channels from parsed data
     * @private
     */
    _getAllAvailableChannels(excelData, journalData) {
        const available = { 
            warmSide: [], 
            coldSide: [], 
            topView: [],
            calculated: []
        };
        
        // Warm side measurements (from journal)
        if (journalData.warmMeasurements.crownEinlaufSeiteWarm !== null) {
            available.warmSide.push({
                id: 'crown_warm_side',
                label: 'Warm Crown Measurements',
                description: 'Crown measurements taken after welding (warm state)',
                measurements: 2, // inlet + outlet
                unit: 'mm',
                type: 'side_view'
            });
        }
        
        // Cold side measurements (from Excel)
        if (excelData.coldSideMeasurements.J18 !== null && excelData.coldSideMeasurements.N18 !== null) {
            available.coldSide.push({
                id: 'crown_cold_side',
                label: 'Cold Crown Measurements',
                description: 'Crown measurements in cold state from Excel',
                measurements: 2, // J18 + N18
                unit: 'mm',
                type: 'side_view'
            });
        }
        
        // Top view measurements (from Excel)
        const topViewCount = Object.keys(excelData.topViewMeasurements).length;
        if (topViewCount > 0) {
            available.topView.push({
                id: 'crown_top_view',
                label: 'Top View Lateral Deviations',
                description: 'Lateral deviation measurements from top view',
                measurements: topViewCount,
                unit: 'mm',
                type: 'top_view'
            });
        }
        
        // Calculated values (from Excel AD cells)
        const calculatedCount = Object.keys(excelData.calculatedValues).length;
        if (calculatedCount > 0) {
            available.calculated.push({
                id: 'crown_calculated',
                label: 'Calculated Crown Values',
                description: 'Calculated geometric values from Excel AD cells',
                measurements: calculatedCount,
                unit: 'mm',
                type: 'calculated'
            });
        }
        
        return available;
    }

    /**
     * Get channels grouped by type
     * @private
     */
    _getChannelsByType(excelData, journalData) {
        const byType = { 
            'side_view': [], 
            'top_view': [], 
            'calculated': []
        };
        
        // Side view channels (warm + cold)
        if (journalData.warmMeasurements.crownEinlaufSeiteWarm !== null) {
            byType.side_view.push({
                id: 'crown_warm_side',
                label: 'Warm Crown',
                temperatureState: 'warm'
            });
        }
        
        if (excelData.coldSideMeasurements.J18 !== null) {
            byType.side_view.push({
                id: 'crown_cold_side',
                label: 'Cold Crown',
                temperatureState: 'cold'
            });
        }
        
        // Top view channel
        if (Object.keys(excelData.topViewMeasurements).length > 0) {
            byType.top_view.push({
                id: 'crown_top_view',
                label: 'Lateral Deviations',
                temperatureState: 'cold'
            });
        }
        
        // Calculated values channel
        if (Object.keys(excelData.calculatedValues).length > 0) {
            byType.calculated.push({
                id: 'crown_calculated',
                label: 'Calculated Values',
                temperatureState: 'cold'
            });
        }
        
        return byType;
    }

    /**
     * Get default display channels
     * @private
     */
    _getDefaultDisplayChannels() {
        return ['crown_warm_side', 'crown_cold_side', 'crown_top_view', 'crown_calculated'];
    }

    /**
     * Calculate measurement ranges for visualization
     * @private
     */
    _calculateMeasurementRanges(excelData, journalData) {
        const ranges = {};
        
        // All measurements combined for overall range
        const allMeasurements = [];
        
        // Collect warm measurements
        if (journalData.warmMeasurements.crownEinlaufSeiteWarm !== null) {
            allMeasurements.push(journalData.warmMeasurements.crownEinlaufSeiteWarm);
        }
        if (journalData.warmMeasurements.crownAuslaufSeiteWarm !== null) {
            allMeasurements.push(journalData.warmMeasurements.crownAuslaufSeiteWarm);
        }
        
        // Collect cold measurements
        Object.values(excelData.coldSideMeasurements).forEach(val => {
            if (val !== null) allMeasurements.push(val);
        });
        
        // Collect top view measurements
        Object.values(excelData.topViewMeasurements).forEach(val => {
            if (val !== null) allMeasurements.push(val);
        });
        
        if (allMeasurements.length > 0) {
            const min = Math.min(...allMeasurements);
            const max = Math.max(...allMeasurements);
            
            ranges.overall = {
                min: min,
                max: max,
                range: max - min,
                unit: 'mm'
            };
            
            // Scaled range for visualization (30x)
            ranges.visualizationScaled = {
                min: min * 30,
                max: max * 30,
                range: (max - min) * 30,
                scalingFactor: 30,
                unit: 'mm (30x scaled)'
            };
        }
        
        return ranges;
    }

    /**
     * Generate channel data based on channel ID
     * @private
     */
    _generateChannelData(channelId, excelData, journalData) {
        switch (channelId) {
            case 'crown_warm_side':
                return this._generateWarmSideData(journalData);
            case 'crown_cold_side':
                return this._generateColdSideData(excelData);
            case 'crown_top_view':
                return this._generateTopViewData(excelData);
            case 'crown_calculated':
                return this._generateCalculatedData(excelData);
            default:
                return null;
        }
    }

    /**
     * Generate warm side view data (from journal)
     * @private
     */
    _generateWarmSideData(journalData) {
        const measurements = journalData.warmMeasurements;
        
        return {
            data: {
                inlet: measurements.crownEinlaufSeiteWarm,  // N18 warm equivalent
                outlet: measurements.crownAuslaufSeiteWarm, // J18 warm equivalent
                measurementTime: measurements.zeitabstandCrownMessung,
                positions: {
                    inlet: { x: 50, name: 'Inlet (Einlauf)' },    // N18 position
                    outlet: { x: -50, name: 'Outlet (Auslauf)' }  // J18 position
                }
            },
            label: 'Warm Crown Profile',
            type: 'side_view',
            unit: 'mm',
            description: 'Crown measurements taken after welding in warm state',
            dataPoints: 2,
            scalingFactor: 30 // For 30x visualization scaling
        };
    }

    /**
     * Generate cold side view data (from Excel)
     * @private
     */
    _generateColdSideData(excelData) {
        const measurements = excelData.coldSideMeasurements;
        
        return {
            data: {
                inlet: measurements.N18,  // N18 cold
                outlet: measurements.J18, // J18 cold
                positions: {
                    inlet: { x: 50, name: 'Inlet (N18)' },
                    outlet: { x: -50, name: 'Outlet (J18)' }
                }
            },
            label: 'Cold Crown Profile',
            type: 'side_view',
            unit: 'mm',
            description: 'Crown measurements in cold state from Excel file',
            dataPoints: 2,
            scalingFactor: 30 // For 30x visualization scaling
        };
    }

    /**
     * Generate top view data (from Excel)
     * @private
     */
    _generateTopViewData(excelData) {
        const measurements = excelData.topViewMeasurements;
        
        // Map measurements to positions for top view visualization
        const positionData = [];
        
        // Positive Y-side measurements
        if (measurements.J23 !== null) positionData.push({ x: -50, y: 32.5, value: measurements.J23, label: 'J23' });
        if (measurements.N23 !== null) positionData.push({ x: 50, y: 32.5, value: measurements.N23, label: 'N23' });
        if (measurements.J24 !== null) positionData.push({ x: -50, y: 62.5, value: measurements.J24, label: 'J24' });
        if (measurements.N24 !== null) positionData.push({ x: 50, y: 62.5, value: measurements.N24, label: 'N24' });
        
        // Negative Y-side measurements  
        if (measurements.J32 !== null) positionData.push({ x: -50, y: -32.5, value: measurements.J32, label: 'J32' });
        if (measurements.N32 !== null) positionData.push({ x: 50, y: -32.5, value: measurements.N32, label: 'N32' });
        if (measurements.J31 !== null) positionData.push({ x: -50, y: -62.5, value: measurements.J31, label: 'J31' });
        if (measurements.N31 !== null) positionData.push({ x: 50, y: -62.5, value: measurements.N31, label: 'N31' });
        
        return {
            data: {
                measurements: measurements,
                positions: positionData,
                referencePositions: {
                    supports: [
                        { x: -500, y: 32.5 }, { x: 500, y: 32.5 },
                        { x: -500, y: 62.5 }, { x: 500, y: 62.5 },
                        { x: -500, y: -32.5 }, { x: 500, y: -32.5 },
                        { x: -500, y: -62.5 }, { x: 500, y: -62.5 }
                    ]
                }
            },
            label: 'Top View Lateral Deviations',
            type: 'top_view',
            unit: 'mm',
            description: 'Lateral deviation measurements from top view perspective',
            dataPoints: positionData.length,
            scalingFactor: 30 // For 30x visualization scaling
        };
    }

    /**
     * Generate calculated values data (from Excel AD cells)
     * @private
     */
    _generateCalculatedData(excelData) {
        const values = excelData.calculatedValues;
        
        return {
            data: {
                values: values,
                categories: {
                    primary: {
                        höhenversatz: values.höhenversatz,
                        crown: values.crown
                    },
                    seitenversatz: {
                        kopfA: values.seitenversatzKopfA,
                        fussA: values.seitenversatzFussA,
                        kopfB: values.seitenversatzKopfB,
                        fussB: values.seitenversatzFussB
                    },
                    pfeilung: {
                        a: values.pfeilungA,
                        b: values.pfeilungB
                    }
                }
            },
            label: 'Calculated Crown Values',
            type: 'calculated',
            unit: 'mm',
            description: 'Calculated geometric values from Excel AD cells',
            dataPoints: Object.keys(values).length
        };
    }

    /**
     * Calculate channel statistics
     * @private
     */
    _calculateChannelStatistics(data, metadata, channelId) {
        const stats = {
            channelId: channelId,
            type: metadata.type,
            unit: metadata.unit,
            dataPoints: metadata.dataPoints
        };
        
        switch (metadata.type) {
            case 'side_view':
                if (data.inlet !== null && data.outlet !== null) {
                    stats.measurements = {
                        inlet: data.inlet,
                        outlet: data.outlet,
                        difference: data.inlet - data.outlet,
                        average: (data.inlet + data.outlet) / 2
                    };
                }
                break;
                
            case 'top_view':
                const values = data.positions.map(p => p.value).filter(v => v !== null);
                if (values.length > 0) {
                    stats.measurements = {
                        min: Math.min(...values),
                        max: Math.max(...values),
                        average: values.reduce((a, b) => a + b, 0) / values.length,
                        range: Math.max(...values) - Math.min(...values),
                        count: values.length
                    };
                }
                break;
                
            case 'calculated':
                const calcValues = Object.values(data.values).filter(v => v !== null);
                if (calcValues.length > 0) {
                    stats.measurements = {
                        min: Math.min(...calcValues),
                        max: Math.max(...calcValues),
                        average: calcValues.reduce((a, b) => a + b, 0) / calcValues.length,
                        range: Math.max(...calcValues) - Math.min(...calcValues),
                        count: calcValues.length
                    };
                }
                break;
        }
        
        return stats;
    }
}

module.exports = CrownService;