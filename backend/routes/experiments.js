/**
 * Experiments Routes - Complete with Binary Data + Temperature CSV + Position CSV Integration
 * Converts C# WebApi/Controllers/Core/ExperimentsController.cs to Express routes
 * Enhanced with binary oscilloscope data endpoints, temperature CSV endpoints, and position CSV endpoints
 */

const express = require('express');
const router = express.Router();
const ExperimentRepository = require('../repositories/ExperimentRepository');
const StartupService = require('../services/StartupService');
const BinaryParserService = require('../services/BinaryParserService');
const TemperatureCsvService = require('../services/TemperatureCsvService');
const PositionCsvService = require('../services/PositionCsvService');
const AccelerationCsvService = require('../services/AccelerationCsvService');
const TensileCsvService = require('../services/TensileCsvService');
const PhotoService = require('../services/PhotoService');
const CrownService = require('../services/CrownService');
const SummaryService = require('../services/SummaryService');
const ExperimentNotesRepository = require('../repositories/ExperimentNotesRepository');
const ExperimentNotes = require('../models/ExperimentNotes');
const Hdf5ParserService = require('../services/Hdf5ParserService');
const ThermalParserService = require('../services/ThermalParserService');
const { responseMiddleware } = require('../models/ApiResponse');

// Apply response middleware to all routes in this router
router.use(responseMiddleware);

// Initialize services
const binaryService = new BinaryParserService();
const temperatureService = new TemperatureCsvService();
const positionService = new PositionCsvService();
const accelerationService = new AccelerationCsvService();
const tensileService = new TensileCsvService();
const photoService = new PhotoService();
const crownService = new CrownService();
const summaryService = new SummaryService();
const notesRepository = new ExperimentNotesRepository();
const hdf5Service = new Hdf5ParserService();
const thermalService = new ThermalParserService();

// #region EXISTING EXPERIMENT ROUTES

/**
 * GET /api/experiments/count
 * Get total experiment count
 */
router.get('/count', async (req, res) => {
    try {
        const repository = new ExperimentRepository();
        const count = await repository.getExperimentCountAsync();
        res.success(count);
    } catch (error) {
        console.error('Error in GET /api/experiments/count:', error);
        res.error(error.message, 500);
    }
});

/**
 * GET /api/experiments/status
 * Get service status and statistics
 */
router.get('/status', async (req, res) => {
    try {
        const startupService = new StartupService();
        const statusResult = await startupService.getServiceStatus();

        if (statusResult.success) {
            // Add binary service status
            const binaryCacheStatus = binaryService.getCacheStatus();
            statusResult.status.binaryParserService = {
                cachedExperiments: binaryCacheStatus.totalCachedExperiments,
                cacheTimeout: binaryCacheStatus.cacheTimeoutMs
            };
            
            // Add temperature service status
            const temperatureCacheStatus = temperatureService.getCacheStatus();
            statusResult.status.temperatureCsvService = {
                cachedExperiments: temperatureCacheStatus.totalCachedExperiments,
                cacheTimeout: temperatureCacheStatus.cacheTimeoutMs
            };
            
            // Add position service status
            const positionCacheStatus = positionService.getCacheStatus();
            statusResult.status.positionCsvService = {
                cachedExperiments: positionCacheStatus.totalCachedExperiments,
                cacheTimeout: positionCacheStatus.cacheTimeoutMs
            };

            // Add acceleration service status
            const accelerationCacheStatus = accelerationService.getCacheStatus();
            statusResult.status.accelerationCsvService = {
                cachedExperiments: accelerationCacheStatus.totalCachedExperiments,
                cacheTimeout: accelerationCacheStatus.cacheTimeoutMs
            };

            // Add tensile service status
            const tensileCacheStatus = tensileService.getCacheStatus(); // ADD THESE LINES
            statusResult.status.tensileCsvService = {                   // ADD THESE LINES
                cachedExperiments: tensileCacheStatus.totalCachedExperiments,
                cacheTimeout: tensileCacheStatus.cacheTimeoutMs
            }; 
            
            // Add photo service status
            const photoCacheStatus = photoService.getCacheStatus(); // ADD THESE LINES
            statusResult.status.photoService = {                    // ADD THESE LINES
                cachedExperiments: photoCacheStatus.totalCachedExperiments,
                cacheTimeout: photoCacheStatus.cacheTimeoutMs
            }; 
            
            // Add crown service status
            const crownCacheStatus = crownService.getCacheStatus();
            statusResult.status.crownService = {
                cachedExperiments: crownCacheStatus.totalCachedExperiments,
                cacheTimeout: crownCacheStatus.cacheTimeoutMs
            };
            
            // Add summary service status
            const summaryCacheStatus = summaryService.getCacheStatus();
            statusResult.status.summaryService = {
                cachedExperiments: summaryCacheStatus.totalCachedSummaries,
                validEntries: summaryCacheStatus.validEntries,
                expiredEntries: summaryCacheStatus.expiredEntries,
                cacheTimeout: summaryCacheStatus.cacheTimeoutMs,
                hitRate: summaryCacheStatus.hitRate
            };

            // Add HDF5 service status
            const hdf5CacheStatus = hdf5Service.getCacheStatus();
            statusResult.status.hdf5ParserService = {
                cachedExperiments: hdf5CacheStatus.totalCachedExperiments,
                cacheTimeout: hdf5CacheStatus.cacheTimeoutMs,
                nativeAddonAvailable: hdf5CacheStatus.capabilities?.nativeAddonSupport
            };

            // Add thermal service status
            const thermalCacheStatus = thermalService.getCacheStatus();
            statusResult.status.thermalParserService = {
                cachedExperiments: thermalCacheStatus.totalCachedExperiments,
                cacheTimeout: thermalCacheStatus.cacheTimeoutMs,
                globalTempMappingLoaded: thermalCacheStatus.globalTempMappingLoaded
            };

            res.success(statusResult.status);
        } else {
            res.error(statusResult.error, 500);
        }
    } catch (error) {
        console.error('Error in GET /api/experiments/status:', error);
        res.error(error.message, 500);
    }
});

/**
 * GET /api/experiments/health
 * Quick health check
 */
router.get('/health', async (req, res) => {
    try {
        const startupService = new StartupService();
        const health = await startupService.healthCheck();

        if (health.healthy) {
            res.success(health);
        } else {
            res.error(health.error, 503);
        }
    } catch (error) {
        console.error('Error in GET /api/experiments/health:', error);
        res.error('Health check failed', 503);
    }
});

/**
 * POST /api/experiments/rescan
 * Rescan experiments (directory scanner + journal parser)
 */
router.post('/rescan', async (req, res) => {
    try {
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Starting experiment rescan (forceRefresh: ${forceRefreshBool})...`);

        const startupService = new StartupService();
        const success = await startupService.initializeAllData(forceRefreshBool);
        
        const message = success 
            ? 'Rescan completed successfully' 
            : 'Rescan completed with errors';

        if (success) {
            const repository = new ExperimentRepository();
            const count = await repository.getExperimentCountAsync();
            
            // Clear all caches after rescan
            if (forceRefreshBool) {
                binaryService.clearAllCache();
                temperatureService.clearAllCache();
                positionService.clearAllCache();
                accelerationService.clearAllCache();
                tensileService.clearAllCache();
                photoService.clearAllCache();
                crownService.clearAllCache();
                hdf5Service.clearAllCache();
                summaryService.clearAllCache();
                thermalService.clearAllCache();
            }
            
            res.success({
                message,
                experimentsFound: count,
                forceRefresh: forceRefreshBool,
                timestamp: new Date().toISOString()
            });
        } else {
            res.error(message, 500);
        }
    } catch (error) {
        console.error('Error in POST /api/experiments/rescan:', error);
        res.error(error.message, 500);
    }
});

/**
 * POST /api/experiments/scan-only
 * Run directory scanner only
 */
router.post('/scan-only', async (req, res) => {
    try {
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        const startupService = new StartupService();
        const success = await startupService.runDirectoryScanner(forceRefreshBool);
        
        const message = success 
            ? 'Directory scan completed successfully' 
            : 'Directory scan completed with errors';

        if (success) {
            const repository = new ExperimentRepository();
            const count = await repository.getExperimentCountAsync();
            
            res.success({
                message,
                experimentsFound: count,
                forceRefresh: forceRefreshBool,
                timestamp: new Date().toISOString()
            });
        } else {
            res.error(message, 500);
        }
    } catch (error) {
        console.error('Error in POST /api/experiments/scan-only:', error);
        res.error(error.message, 500);
    }
});

/**
 * POST /api/experiments/parse-only
 * Run journal parser only
 */
router.post('/parse-only', async (req, res) => {
    try {
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        const startupService = new StartupService();
        const success = await startupService.runJournalParser(forceRefreshBool);
        
        const message = success 
            ? 'Journal parsing completed successfully' 
            : 'Journal parsing completed with errors';

        if (success) {
            res.success({
                message,
                forceRefresh: forceRefreshBool,
                timestamp: new Date().toISOString()
            });
        } else {
            res.error(message, 500);
        }
    } catch (error) {
        console.error('Error in POST /api/experiments/parse-only:', error);
        res.error(error.message, 500);
    }
});

/**
 * GET /api/experiments
 * Get experiments with optional filtering and sorting
 */
router.get('/', async (req, res) => {
    try {
        const {
            sortBy = 'date',
            sortDirection = 'desc', 
            filterBy = null,
            filterValue = null
        } = req.query;

        const repository = new ExperimentRepository();
        const experiments = await repository.getFilteredExperimentsAsync(
            filterBy, filterValue, sortBy, sortDirection
        );

        res.success(experiments);
    } catch (error) {
        console.error('Error in GET /api/experiments:', error);
        res.error(error.message, 500);
    }
});

/**
 * GET /api/experiments/:experimentId
 * Get single experiment with metadata
 */
router.get('/:experimentId', async (req, res) => {
    try {
        const { experimentId } = req.params;

        const experimentRepository  = new ExperimentRepository();
        const experiment = await experimentRepository.getExperimentWithMetadataAsync(experimentId);

        if (!experiment) {
            return res.error('Experiment not found', 404);
        }

        res.success(experiment);
    } catch (error) {
        console.error(`Error in GET /api/experiments/${req.params.experimentId}:`, error);
        res.error(error.message, 500);
    }
});

// #endregion

// #region BINARY DATA ROUTES

/**
 * GET /api/experiments/:experimentId/bin-metadata
 * Get binary file metadata and channel information
 */
router.get('/:experimentId/bin-metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting binary metadata for experiment: ${experimentId}`);

        // Check if experiment has binary file
        const hasBinary = await binaryService.hasBinaryFile(experimentId);
        if (!hasBinary) {
            return res.error(`No binary file found for experiment ${experimentId}`, 404);
        }

        // Get comprehensive metadata
        const metadataResult = await binaryService.getBinaryMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        res.success({
            experimentId: experimentId,
            hasValidBinaryFile: true,
            ...metadataResult
        });

    } catch (error) {
        console.error(`Error getting binary metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get binary metadata: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/bin-data/:channelId
 * Get single channel data with resampling
 */
router.get('/:experimentId/bin-data/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;
        const { 
            start = 0, 
            end = null, 
            maxPoints = 2000 
        } = req.query;

        const startTime = parseFloat(start);
        const endTime = end ? parseFloat(end) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTime) || startTime < 0) {
            return res.error('Invalid start time parameter', 400);
        }
        
        if (endTime !== null && (isNaN(endTime) || endTime <= startTime)) {
            return res.error('Invalid end time parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        // Get channel data
        const channelResult = await binaryService.getChannelData(experimentId, channelId, {
            startTime: startTime,
            endTime: endTime,
            maxPoints: maxPointsInt
        });

        if (!channelResult.success) {
            return res.error(channelResult.error, channelResult.error.includes('not found') ? 404 : 500);
        }

        res.success(channelResult);

    } catch (error) {
        console.error(`Error getting channel data for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get channel data: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/bin-data/bulk
 * Get multiple channels data efficiently
 */
router.post('/:experimentId/bin-data/bulk', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { 
            channelIds, 
            startTime = 0, 
            endTime = null, 
            maxPoints = 2000 
        } = req.body;

        // Validate request body
        if (!Array.isArray(channelIds)) {
            return res.error('channelIds must be an array', 400);
        }

        if (channelIds.length === 0) {
            return res.error('channelIds cannot be empty', 400);
        }

        if (channelIds.length > 20) {
            return res.error('Maximum 20 channels per request', 400);
        }

        const startTimeFloat = parseFloat(startTime);
        const endTimeFloat = endTime ? parseFloat(endTime) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTimeFloat) || startTimeFloat < 0) {
            return res.error('Invalid startTime parameter', 400);
        }
        
        if (endTimeFloat !== null && (isNaN(endTimeFloat) || endTimeFloat <= startTimeFloat)) {
            return res.error('Invalid endTime parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        console.log(`Bulk channel request for ${experimentId}: ${channelIds.length} channels`);

        // Get bulk channel data
        const bulkResult = await binaryService.getBulkChannelData(experimentId, channelIds, {
            startTime: startTimeFloat,
            endTime: endTimeFloat,
            maxPoints: maxPointsInt
        });

        if (!bulkResult.success) {
            return res.error(bulkResult.error, 500);
        }

        res.success(bulkResult);

    } catch (error) {
        console.error(`Error getting bulk channel data for ${req.params.experimentId}:`, error);
        res.error(`Failed to get bulk channel data: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/bin-stats/:channelId
 * Get channel statistics
 */
router.get('/:experimentId/bin-stats/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;

        console.log(`Getting channel statistics for ${experimentId}/${channelId}`);

        // Get channel statistics
        const statsResult = await binaryService.getChannelStatistics(experimentId, channelId);

        if (!statsResult.success) {
            return res.error(statsResult.error, statsResult.error.includes('not found') ? 404 : 500);
        }

        res.success(statsResult);

    } catch (error) {
        console.error(`Error getting channel statistics for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get channel statistics: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/bin-channels
 * Get available channels information
 */
router.get('/:experimentId/bin-channels', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting available channels for experiment: ${experimentId}`);

        // Get metadata which includes channel information
        const metadataResult = await binaryService.getBinaryMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        // Extract channel information
        const channelsInfo = {
            experimentId: experimentId,
            available: metadataResult.channels.available,
            byUnit: metadataResult.channels.byUnit,
            defaults: metadataResult.channels.defaults,
            ranges: metadataResult.channels.ranges,
            timeRange: metadataResult.timeRange,
            summary: {
                rawChannelCount: metadataResult.channels.available.raw.length,
                calculatedChannelCount: metadataResult.channels.available.calculated.length,
                totalChannels: metadataResult.channels.available.raw.length + 
                              metadataResult.channels.available.calculated.length,
                duration: metadataResult.duration,
                samplingRate: metadataResult.samplingRate
            }
        };

        res.success(channelsInfo);

    } catch (error) {
        console.error(`Error getting channels info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get channels information: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/bin-cache
 * Clear cached binary data for experiment
 */
router.delete('/:experimentId/bin-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing binary cache for experiment: ${experimentId}`);

        binaryService.clearCache(experimentId);

        res.success({
            message: `Cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/bin-service/status
 * Get binary parser service status and cache information
 */
router.get('/bin-service/status', async (req, res) => {
    try {
        const cacheStatus = binaryService.getCacheStatus();
        
        res.success({
            serviceName: 'Binary Parser Service',
            status: 'active',
            cache: cacheStatus,
            capabilities: {
                supportedChannels: {
                    raw: 'channel_0 to channel_7 (8 channels)',
                    calculated: 'calc_0 to calc_6 (7 channels)'
                },
                supportedFormats: ['C# BinaryWriter format'],
                maxFileSize: '2GB',
                resamplingAlgorithm: 'MinMax-LTTB with spike preservation',
                caching: 'In-memory with TTL'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting binary service status:', error);
        res.error(`Failed to get service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/bin-service/clear-all-cache
 * Clear all cached binary data
 */
router.post('/bin-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all binary parser cache...');

        binaryService.clearAllCache();

        res.success({
            message: 'All binary parser cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all binary cache:', error);
        res.error(`Failed to clear all cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/bin-file-info
 * Get binary file information without parsing (quick check)
 */
router.get('/:experimentId/bin-file-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Get file path
        const filePath = binaryService.getExperimentBinaryFilePath(experimentId);
        const hasFile = await binaryService.hasBinaryFile(experimentId);

        if (!hasFile) {
            return res.success({
                experimentId: experimentId,
                hasFile: false,
                expectedPath: filePath,
                message: 'Binary file not found'
            });
        }

        // Get basic file information
        const fs = require('fs').promises;
        const path = require('path');
        const stats = await fs.stat(filePath);

        res.success({
            experimentId: experimentId,
            hasFile: true,
            filePath: filePath,
            fileName: path.basename(filePath),
            fileSize: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(1),
            lastModified: stats.mtime,
            created: stats.birthtime
        });

    } catch (error) {
        console.error(`Error getting file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get file information: ${error.message}`, 500);
    }
});

// #endregion

// #region TEMPERATURE CSV DATA ROUTES

/**
 * GET /api/experiments/:experimentId/temp-metadata
 * Get temperature CSV file metadata and channel information
 */
router.get('/:experimentId/temp-metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting temperature metadata for experiment: ${experimentId}`);

        // Check if experiment has temperature file
        const hasTemperature = await temperatureService.hasTemperatureFile(experimentId);
        if (!hasTemperature) {
            return res.error(`No temperature CSV file found for experiment ${experimentId}`, 404);
        }

        // Get comprehensive metadata
        const metadataResult = await temperatureService.getTemperatureMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        res.success({
            experimentId: experimentId,
            hasValidTemperatureFile: true,
            ...metadataResult
        });

    } catch (error) {
        console.error(`Error getting temperature metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get temperature metadata: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/temp-data/:channelId
 * Get single temperature channel data with resampling
 */
router.get('/:experimentId/temp-data/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;
        const { 
            start = 0, 
            end = null, 
            maxPoints = 2000 
        } = req.query;

        const startTime = parseFloat(start);
        const endTime = end ? parseFloat(end) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTime) || startTime < 0) {
            return res.error('Invalid start time parameter', 400);
        }
        
        if (endTime !== null && (isNaN(endTime) || endTime <= startTime)) {
            return res.error('Invalid end time parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        // Get channel data
        const channelResult = await temperatureService.getChannelData(experimentId, channelId, {
            startTime: startTime,
            endTime: endTime,
            maxPoints: maxPointsInt
        });

        if (!channelResult.success) {
            return res.error(channelResult.error, channelResult.error.includes('not found') ? 404 : 500);
        }

        res.success(channelResult);

    } catch (error) {
        console.error(`Error getting temperature channel data for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get temperature channel data: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/temp-data/bulk
 * Get multiple temperature channels data efficiently
 */
router.post('/:experimentId/temp-data/bulk', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { 
            channelIds, 
            startTime = 0, 
            endTime = null, 
            maxPoints = 2000 
        } = req.body;

        // Validate request body
        if (!Array.isArray(channelIds)) {
            return res.error('channelIds must be an array', 400);
        }

        if (channelIds.length === 0) {
            return res.error('channelIds cannot be empty', 400);
        }

        if (channelIds.length > 20) {
            return res.error('Maximum 20 channels per request', 400);
        }

        const startTimeFloat = parseFloat(startTime);
        const endTimeFloat = endTime ? parseFloat(endTime) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTimeFloat) || startTimeFloat < 0) {
            return res.error('Invalid startTime parameter', 400);
        }
        
        if (endTimeFloat !== null && (isNaN(endTimeFloat) || endTimeFloat <= startTimeFloat)) {
            return res.error('Invalid endTime parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        console.log(`Bulk temperature channel request for ${experimentId}: ${channelIds.length} channels`);

        // Get bulk channel data
        const bulkResult = await temperatureService.getBulkChannelData(experimentId, channelIds, {
            startTime: startTimeFloat,
            endTime: endTimeFloat,
            maxPoints: maxPointsInt
        });

        if (!bulkResult.success) {
            return res.error(bulkResult.error, 500);
        }

        res.success(bulkResult);

    } catch (error) {
        console.error(`Error getting bulk temperature channel data for ${req.params.experimentId}:`, error);
        res.error(`Failed to get bulk temperature channel data: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/temp-stats/:channelId
 * Get temperature channel statistics
 */
router.get('/:experimentId/temp-stats/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;

        console.log(`Getting temperature channel statistics for ${experimentId}/${channelId}`);

        // Get channel statistics
        const statsResult = await temperatureService.getChannelStatistics(experimentId, channelId);

        if (!statsResult.success) {
            return res.error(statsResult.error, statsResult.error.includes('not found') ? 404 : 500);
        }

        res.success(statsResult);

    } catch (error) {
        console.error(`Error getting temperature channel statistics for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get temperature channel statistics: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/temp-channels
 * Get available temperature channels information
 */
router.get('/:experimentId/temp-channels', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting available temperature channels for experiment: ${experimentId}`);

        // Get metadata which includes channel information
        const metadataResult = await temperatureService.getTemperatureMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        // Extract channel information
        const channelsInfo = {
            experimentId: experimentId,
            available: metadataResult.channels.available,
            byUnit: metadataResult.channels.byUnit,
            defaults: metadataResult.channels.defaults,
            ranges: metadataResult.channels.ranges,
            timeRange: metadataResult.timeRange,
            summary: {
                temperatureChannelCount: metadataResult.channels.available.temperature.length,
                totalChannels: metadataResult.channels.available.temperature.length,
                duration: metadataResult.duration
            }
        };

        res.success(channelsInfo);

    } catch (error) {
        console.error(`Error getting temperature channels info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get temperature channels information: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/temp-cache
 * Clear cached temperature data for experiment
 */
router.delete('/:experimentId/temp-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing temperature cache for experiment: ${experimentId}`);

        temperatureService.clearCache(experimentId);

        res.success({
            message: `Temperature cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing temperature cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear temperature cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/temp-service/status
 * Get temperature CSV service status and cache information
 */
router.get('/temp-service/status', async (req, res) => {
    try {
        const cacheStatus = temperatureService.getCacheStatus();
        
        res.success({
            serviceName: 'Temperature CSV Service',
            status: 'active',
            cache: cacheStatus,
            capabilities: {
                supportedChannels: {
                    welding: 'temp_welding (Schweissen Durchschn.)',
                    sensors: 'temp_channel_1 to temp_channel_8 (Kanal 1-8 Durchschn.)'
                },
                supportedFormats: ['CSV with German decimal format'],
                maxFileSize: '100MB',
                resamplingAlgorithm: 'Simple downsampling',
                caching: 'In-memory with TTL'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting temperature service status:', error);
        res.error(`Failed to get temperature service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/temp-service/clear-all-cache
 * Clear all cached temperature data
 */
router.post('/temp-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all temperature CSV cache...');

        temperatureService.clearAllCache();

        res.success({
            message: 'All temperature CSV cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all temperature cache:', error);
        res.error(`Failed to clear all temperature cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/temp-file-info
 * Get temperature file information without parsing (quick check)
 */
router.get('/:experimentId/temp-file-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Get actual file path by scanning directory
        const filePath = await temperatureService.getActualTemperatureFilePath(experimentId);
        const hasFile = await temperatureService.hasTemperatureFile(experimentId);

        if (!hasFile || !filePath) {
            return res.success({
                experimentId: experimentId,
                hasFile: false,
                message: 'Temperature CSV file not found'
            });
        }

        // Get basic file information
        const fs = require('fs').promises;
        const path = require('path');
        const stats = await fs.stat(filePath);

        res.success({
            experimentId: experimentId,
            hasFile: true,
            filePath: filePath,
            fileName: path.basename(filePath),
            fileSize: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(1),
            lastModified: stats.mtime,
            created: stats.birthtime
        });

    } catch (error) {
        console.error(`Error getting temperature file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get temperature file information: ${error.message}`, 500);
    }
});

// #endregion

// #region POSITION CSV DATA ROUTES

/**
 * GET /api/experiments/:experimentId/pos-metadata
 * Get position CSV file metadata and channel information
 */
router.get('/:experimentId/pos-metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting position metadata for experiment: ${experimentId}`);

        // Check if experiment has position file
        const hasPosition = await positionService.hasPositionFile(experimentId);
        if (!hasPosition) {
            return res.error(`No position CSV file found for experiment ${experimentId}`, 404);
        }

        // Get comprehensive metadata
        const metadataResult = await positionService.getPositionMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        res.success({
            experimentId: experimentId,
            hasValidPositionFile: true,
            ...metadataResult
        });

    } catch (error) {
        console.error(`Error getting position metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get position metadata: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/pos-data/:channelId
 * Get single position channel data with resampling
 */
router.get('/:experimentId/pos-data/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;
        const { 
            start = 0, 
            end = null, 
            maxPoints = 2000 
        } = req.query;

        const startTime = parseFloat(start);
        const endTime = end ? parseFloat(end) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTime) || startTime < 0) {
            return res.error('Invalid start time parameter', 400);
        }
        
        if (endTime !== null && (isNaN(endTime) || endTime <= startTime)) {
            return res.error('Invalid end time parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        // Validate channel ID (should be pos_x)
        if (channelId !== 'pos_x') {
            return res.error(`Invalid channel ID: ${channelId}. Position data only supports 'pos_x'`, 400);
        }

        // Get channel data
        const channelResult = await positionService.getChannelData(experimentId, channelId, {
            startTime: startTime,
            endTime: endTime,
            maxPoints: maxPointsInt
        });

        if (!channelResult.success) {
            return res.error(channelResult.error, channelResult.error.includes('not found') ? 404 : 500);
        }

        res.success(channelResult);

    } catch (error) {
        console.error(`Error getting position channel data for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get position channel data: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/pos-data/bulk
 * Get multiple position channels data efficiently (simplified for single channel)
 */
router.post('/:experimentId/pos-data/bulk', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { 
            channelIds, 
            startTime = 0, 
            endTime = null, 
            maxPoints = 2000 
        } = req.body;

        // Validate request body
        if (!Array.isArray(channelIds)) {
            return res.error('channelIds must be an array', 400);
        }

        if (channelIds.length === 0) {
            return res.error('channelIds cannot be empty', 400);
        }

        if (channelIds.length > 5) {
            return res.error('Maximum 5 channels per request (position data has only pos_x)', 400);
        }

        // Validate that only pos_x is requested
        const invalidChannels = channelIds.filter(id => id !== 'pos_x');
        if (invalidChannels.length > 0) {
            return res.error(`Invalid channel IDs: ${invalidChannels.join(', ')}. Position data only supports 'pos_x'`, 400);
        }

        const startTimeFloat = parseFloat(startTime);
        const endTimeFloat = endTime ? parseFloat(endTime) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTimeFloat) || startTimeFloat < 0) {
            return res.error('Invalid startTime parameter', 400);
        }
        
        if (endTimeFloat !== null && (isNaN(endTimeFloat) || endTimeFloat <= startTimeFloat)) {
            return res.error('Invalid endTime parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        console.log(`Bulk position channel request for ${experimentId}: ${channelIds.length} channels`);

        // Get bulk channel data
        const bulkResult = await positionService.getBulkChannelData(experimentId, channelIds, {
            startTime: startTimeFloat,
            endTime: endTimeFloat,
            maxPoints: maxPointsInt
        });

        if (!bulkResult.success) {
            return res.error(bulkResult.error, 500);
        }

        res.success(bulkResult);

    } catch (error) {
        console.error(`Error getting bulk position channel data for ${req.params.experimentId}:`, error);
        res.error(`Failed to get bulk position channel data: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/pos-stats/:channelId
 * Get position channel statistics
 */
router.get('/:experimentId/pos-stats/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;

        console.log(`Getting position channel statistics for ${experimentId}/${channelId}`);

        // Validate channel ID
        if (channelId !== 'pos_x') {
            return res.error(`Invalid channel ID: ${channelId}. Position data only supports 'pos_x'`, 400);
        }

        // Get channel statistics
        const statsResult = await positionService.getChannelStatistics(experimentId, channelId);

        if (!statsResult.success) {
            return res.error(statsResult.error, statsResult.error.includes('not found') ? 404 : 500);
        }

        res.success(statsResult);

    } catch (error) {
        console.error(`Error getting position channel statistics for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get position channel statistics: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/pos-channels
 * Get available position channels information
 */
router.get('/:experimentId/pos-channels', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting available position channels for experiment: ${experimentId}`);

        // Get metadata which includes channel information
        const metadataResult = await positionService.getPositionMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        // Extract channel information
        const channelsInfo = {
            experimentId: experimentId,
            available: metadataResult.channels.available,
            byUnit: metadataResult.channels.byUnit,
            defaults: metadataResult.channels.defaults,
            ranges: metadataResult.channels.ranges,
            timeRange: metadataResult.timeRange,
            summary: {
                positionChannelCount: metadataResult.channels.available.position.length,
                totalChannels: metadataResult.channels.available.position.length,
                duration: metadataResult.duration,
                sensorInfo: metadataResult.positionInfo
            }
        };

        res.success(channelsInfo);

    } catch (error) {
        console.error(`Error getting position channels info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get position channels information: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/pos-cache
 * Clear cached position data for experiment
 */
router.delete('/:experimentId/pos-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing position cache for experiment: ${experimentId}`);

        positionService.clearCache(experimentId);

        res.success({
            message: `Position cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing position cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear position cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/pos-service/status
 * Get position CSV service status and cache information
 */
router.get('/pos-service/status', async (req, res) => {
    try {
        const cacheStatus = positionService.getCacheStatus();
        
        res.success({
            serviceName: 'Position CSV Service',
            status: 'active',
            cache: cacheStatus,
            capabilities: {
                supportedChannels: {
                    position: 'pos_x (Position X-axis in mm)'
                },
                supportedFormats: ['Tab-delimited CSV with microsecond timestamps'],
                sensorType: 'optoNCDT-ILD1220 laser displacement sensor',
                dataProcessing: {
                    transformation: 'final = -1 * raw + 49.73',
                    interpolation: '1ms intervals (1000µs)',
                    units: 'millimeters (mm)',
                    timeBase: 'microseconds (µs)'
                },
                maxFileSize: '50MB',
                resamplingAlgorithm: 'Min-Max with spike preservation',
                caching: 'In-memory with TTL'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting position service status:', error);
        res.error(`Failed to get position service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/pos-service/clear-all-cache
 * Clear all cached position data
 */
router.post('/pos-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all position CSV cache...');

        positionService.clearAllCache();

        res.success({
            message: 'All position CSV cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all position cache:', error);
        res.error(`Failed to clear all position cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/pos-file-info
 * Get position file information without parsing (quick check)
 */
router.get('/:experimentId/pos-file-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Get actual file path by scanning directory
        const filePath = await positionService.getActualPositionFilePath(experimentId);
        const hasFile = await positionService.hasPositionFile(experimentId);

        if (!hasFile || !filePath) {
            return res.success({
                experimentId: experimentId,
                hasFile: false,
                message: 'Position CSV file not found',
                expectedPattern: 'snapshot_optoNCDT-*.csv'
            });
        }

        // Get basic file information
        const fs = require('fs').promises;
        const path = require('path');
        const stats = await fs.stat(filePath);

        res.success({
            experimentId: experimentId,
            hasFile: true,
            filePath: filePath,
            fileName: path.basename(filePath),
            fileSize: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(1),
            lastModified: stats.mtime,
            created: stats.birthtime,
            sensorInfo: {
                type: 'optoNCDT-ILD1220',
                manufacturer: 'Micro-Epsilon',
                measurementType: 'Laser displacement',
                expectedFormat: 'Tab-delimited CSV with datetime, unix_time, position'
            }
        });

    } catch (error) {
        console.error(`Error getting position file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get position file information: ${error.message}`, 500);
    }
});

// #endregion

// #region ACCELERATION CSV DATA ROUTES

/**
 * GET /api/experiments/:experimentId/acc-metadata
 * Get acceleration CSV file metadata and channel information
 */
router.get('/:experimentId/acc-metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting acceleration metadata for experiment: ${experimentId}`);

        // Check if experiment has acceleration file
        const hasAcceleration = await accelerationService.hasAccelerationFile(experimentId);
        if (!hasAcceleration) {
            return res.error(`No acceleration CSV file found for experiment ${experimentId}`, 404);
        }

        // Get comprehensive metadata
        const metadataResult = await accelerationService.getAccelerationMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        res.success({
            experimentId: experimentId,
            hasValidAccelerationFile: true,
            ...metadataResult
        });

    } catch (error) {
        console.error(`Error getting acceleration metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get acceleration metadata: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/acc-data/:channelId
 * Get single acceleration channel data with resampling
 * Supports: acc_x, acc_y, acc_z, acc_magnitude
 */
router.get('/:experimentId/acc-data/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;
        const { 
            start = 0, 
            end = null, 
            maxPoints = 2000 
        } = req.query;

        const startTime = parseFloat(start);
        const endTime = end ? parseFloat(end) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTime) || startTime < 0) {
            return res.error('Invalid start time parameter', 400);
        }
        
        if (endTime !== null && (isNaN(endTime) || endTime <= startTime)) {
            return res.error('Invalid end time parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        // Validate channel ID
        const validChannels = ['acc_x', 'acc_y', 'acc_z', 'acc_magnitude'];
        if (!validChannels.includes(channelId)) {
            return res.error(`Invalid channel ID: ${channelId}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        // Get channel data
        const channelResult = await accelerationService.getChannelData(experimentId, channelId, {
            startTime: startTime,
            endTime: endTime,
            maxPoints: maxPointsInt
        });

        if (!channelResult.success) {
            return res.error(channelResult.error, channelResult.error.includes('not found') ? 404 : 500);
        }

        res.success(channelResult);

    } catch (error) {
        console.error(`Error getting acceleration channel data for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get acceleration channel data: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/acc-data/bulk
 * Get multiple acceleration channels data efficiently
 */
router.post('/:experimentId/acc-data/bulk', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { 
            channelIds, 
            startTime = 0, 
            endTime = null, 
            maxPoints = 2000 
        } = req.body;

        // Validate request body
        if (!Array.isArray(channelIds)) {
            return res.error('channelIds must be an array', 400);
        }

        if (channelIds.length === 0) {
            return res.error('channelIds cannot be empty', 400);
        }

        if (channelIds.length > 10) {
            return res.error('Maximum 10 channels per request', 400);
        }

        // Validate channel IDs
        const validChannels = ['acc_x', 'acc_y', 'acc_z', 'acc_magnitude'];
        const invalidChannels = channelIds.filter(id => !validChannels.includes(id));
        if (invalidChannels.length > 0) {
            return res.error(`Invalid channel IDs: ${invalidChannels.join(', ')}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        const startTimeFloat = parseFloat(startTime);
        const endTimeFloat = endTime ? parseFloat(endTime) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTimeFloat) || startTimeFloat < 0) {
            return res.error('Invalid startTime parameter', 400);
        }
        
        if (endTimeFloat !== null && (isNaN(endTimeFloat) || endTimeFloat <= startTimeFloat)) {
            return res.error('Invalid endTime parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        console.log(`Bulk acceleration channel request for ${experimentId}: ${channelIds.length} channels`);

        // Get bulk channel data
        const bulkResult = await accelerationService.getBulkChannelData(experimentId, channelIds, {
            startTime: startTimeFloat,
            endTime: endTimeFloat,
            maxPoints: maxPointsInt
        });

        if (!bulkResult.success) {
            return res.error(bulkResult.error, 500);
        }

        res.success(bulkResult);

    } catch (error) {
        console.error(`Error getting bulk acceleration channel data for ${req.params.experimentId}:`, error);
        res.error(`Failed to get bulk acceleration channel data: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/acc-stats/:channelId
 * Get acceleration channel statistics
 */
router.get('/:experimentId/acc-stats/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;

        console.log(`Getting acceleration channel statistics for ${experimentId}/${channelId}`);

        // Validate channel ID
        const validChannels = ['acc_x', 'acc_y', 'acc_z', 'acc_magnitude'];
        if (!validChannels.includes(channelId)) {
            return res.error(`Invalid channel ID: ${channelId}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        // Get channel statistics
        const statsResult = await accelerationService.getChannelStatistics(experimentId, channelId);

        if (!statsResult.success) {
            return res.error(statsResult.error, statsResult.error.includes('not found') ? 404 : 500);
        }

        res.success(statsResult);

    } catch (error) {
        console.error(`Error getting acceleration channel statistics for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get acceleration channel statistics: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/acc-channels
 * Get available acceleration channels information
 */
router.get('/:experimentId/acc-channels', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting available acceleration channels for experiment: ${experimentId}`);

        // Get metadata which includes channel information
        const metadataResult = await accelerationService.getAccelerationMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        // Extract channel information
        const channelsInfo = {
            experimentId: experimentId,
            available: metadataResult.channels.available,
            byUnit: metadataResult.channels.byUnit,
            defaults: metadataResult.channels.defaults,
            ranges: metadataResult.channels.ranges,
            timeRange: metadataResult.timeRange,
            summary: {
                accelerationChannelCount: metadataResult.channels.available.acceleration.length,
                totalChannels: metadataResult.channels.available.acceleration.length,
                duration: metadataResult.duration,
                samplingInfo: metadataResult.accelerationInfo.samplingInfo,
                supportsMagnitudeCalculation: metadataResult.accelerationInfo.supportsMagnitudeCalculation
            }
        };

        res.success(channelsInfo);

    } catch (error) {
        console.error(`Error getting acceleration channels info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get acceleration channels information: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/acc-cache
 * Clear cached acceleration data for experiment
 */
router.delete('/:experimentId/acc-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing acceleration cache for experiment: ${experimentId}`);

        accelerationService.clearCache(experimentId);

        res.success({
            message: `Acceleration cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing acceleration cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear acceleration cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/acc-service/status
 * Get acceleration CSV service status and cache information
 */
router.get('/acc-service/status', async (req, res) => {
    try {
        const cacheStatus = accelerationService.getCacheStatus();
        
        res.success({
            serviceName: 'Acceleration CSV Service',
            status: 'active',
            cache: cacheStatus,
            capabilities: {
                supportedChannels: {
                    axes: 'acc_x, acc_y, acc_z (3-axis acceleration)',
                    calculated: 'acc_magnitude (sqrt(x² + y² + z²))'
                },
                supportedFormats: [
                    'CSV with time column (4 columns): Time[s], X[m/s²], Y[m/s²], Z[m/s²]',
                    'CSV without time (3 columns): X[m/s²], Y[m/s²], Z[m/s²] - generates 10kHz timeline'
                ],
                filePatterns: [
                    '{experimentId}_beschleuinigung.csv (primary)',
                    'daq_download.csv (fallback)'
                ],
                dataProcessing: {
                    samplingRates: 'Auto-detected from time data or 10kHz default',
                    units: 'm/s² (meters per second squared)',
                    timeBase: 'microseconds (µs)',
                    specialFeatures: 'Magnitude calculation, RMS statistics, vibration analysis'
                },
                maxFileSize: '50MB',
                resamplingAlgorithm: 'Multi-tier: Decimation, Min-Max, RMS based on oversampling ratio',
                caching: 'In-memory with TTL'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting acceleration service status:', error);
        res.error(`Failed to get acceleration service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/acc-service/clear-all-cache
 * Clear all cached acceleration data
 */
router.post('/acc-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all acceleration CSV cache...');

        accelerationService.clearAllCache();

        res.success({
            message: 'All acceleration CSV cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all acceleration cache:', error);
        res.error(`Failed to clear all acceleration cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/acc-file-info
 * Get acceleration file information without parsing (quick check)
 */
router.get('/:experimentId/acc-file-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Get actual file path by scanning directory
        const filePath = await accelerationService.getActualAccelerationFilePath(experimentId);
        const hasFile = await accelerationService.hasAccelerationFile(experimentId);

        if (!hasFile || !filePath) {
            return res.success({
                experimentId: experimentId,
                hasFile: false,
                message: 'Acceleration CSV file not found',
                expectedPatterns: [
                    `${experimentId.toLowerCase()}_beschleuinigung.csv`,
                    'daq_download.csv'
                ]
            });
        }

        // Get basic file information
        const fs = require('fs').promises;
        const path = require('path');
        const stats = await fs.stat(filePath);

        res.success({
            experimentId: experimentId,
            hasFile: true,
            filePath: filePath,
            fileName: path.basename(filePath),
            fileSize: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(1),
            lastModified: stats.mtime,
            created: stats.birthtime,
            accelerationInfo: {
                expectedChannels: ['X-axis', 'Y-axis', 'Z-axis'],
                supportedFormats: [
                    '4-column: Time, X, Y, Z',
                    '3-column: X, Y, Z (synthetic time)'
                ],
                unit: 'm/s²',
                typicalSamplingRates: ['1kHz - 25kHz'],
                filePatterns: {
                    primary: `${experimentId}_beschleuinigung.csv`,
                    fallback: 'daq_download.csv'
                }
            }
        });

    } catch (error) {
        console.error(`Error getting acceleration file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get acceleration file information: ${error.message}`, 500);
    }
});

// #endregion

// #region TENSILE CSV DATA ROUTES

/**
 * GET /api/experiments/:experimentId/tensile-metadata
 * Get tensile CSV file metadata and channel information
 */
router.get('/:experimentId/tensile-metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting tensile metadata for experiment: ${experimentId}`);

        // Check if experiment has tensile file
        const hasTensile = await tensileService.hasTensileFile(experimentId);
        if (!hasTensile) {
            return res.error(`No tensile CSV file found for experiment ${experimentId}`, 404);
        }

        // Get comprehensive metadata
        const metadataResult = await tensileService.getTensileMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        res.success({
            experimentId: experimentId,
            hasValidTensileFile: true,
            ...metadataResult
        });

    } catch (error) {
        console.error(`Error getting tensile metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get tensile metadata: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/tensile-data/:channelId
 * Get single tensile channel data with resampling
 * Supports: force_kN, displacement_mm, force_vs_displacement
 */
router.get('/:experimentId/tensile-data/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;
        const { 
            start = 0, 
            end = null, 
            maxPoints = 2000 
        } = req.query;

        const startTime = parseFloat(start);
        const endTime = end ? parseFloat(end) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters for time-series channels
        if (channelId !== 'force_vs_displacement') {
            if (isNaN(startTime) || startTime < 0) {
                return res.error('Invalid start time parameter', 400);
            }
            
            if (endTime !== null && (isNaN(endTime) || endTime <= startTime)) {
                return res.error('Invalid end time parameter', 400);
            }
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        // Validate channel ID
        const validChannels = ['force_kN', 'displacement_mm', 'force_vs_displacement'];
        if (!validChannels.includes(channelId)) {
            return res.error(`Invalid channel ID: ${channelId}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        // Get channel data
        const channelResult = await tensileService.getChannelData(experimentId, channelId, {
            startTime: startTime,
            endTime: endTime,
            maxPoints: maxPointsInt
        });

        if (!channelResult.success) {
            return res.error(channelResult.error, channelResult.error.includes('not found') ? 404 : 500);
        }

        res.success(channelResult);

    } catch (error) {
        console.error(`Error getting tensile channel data for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get tensile channel data: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/tensile-data/bulk
 * Get multiple tensile channels data efficiently
 */
router.post('/:experimentId/tensile-data/bulk', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { 
            channelIds, 
            startTime = 0, 
            endTime = null, 
            maxPoints = 2000 
        } = req.body;

        // Validate request body
        if (!Array.isArray(channelIds)) {
            return res.error('channelIds must be an array', 400);
        }

        if (channelIds.length === 0) {
            return res.error('channelIds cannot be empty', 400);
        }

        if (channelIds.length > 10) {
            return res.error('Maximum 10 channels per request', 400);
        }

        // Validate channel IDs
        const validChannels = ['force_kN', 'displacement_mm', 'force_vs_displacement'];
        const invalidChannels = channelIds.filter(id => !validChannels.includes(id));
        if (invalidChannels.length > 0) {
            return res.error(`Invalid channel IDs: ${invalidChannels.join(', ')}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        const startTimeFloat = parseFloat(startTime);
        const endTimeFloat = endTime ? parseFloat(endTime) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters for time-series channels
        const hasTimeSeriesChannels = channelIds.some(id => id !== 'force_vs_displacement');
        if (hasTimeSeriesChannels) {
            if (isNaN(startTimeFloat) || startTimeFloat < 0) {
                return res.error('Invalid startTime parameter', 400);
            }
            
            if (endTimeFloat !== null && (isNaN(endTimeFloat) || endTimeFloat <= startTimeFloat)) {
                return res.error('Invalid endTime parameter', 400);
            }
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        console.log(`Bulk tensile channel request for ${experimentId}: ${channelIds.length} channels`);

        // Get bulk channel data
        const bulkResult = await tensileService.getBulkChannelData(experimentId, channelIds, {
            startTime: startTimeFloat,
            endTime: endTimeFloat,
            maxPoints: maxPointsInt
        });

        if (!bulkResult.success) {
            return res.error(bulkResult.error, 500);
        }

        res.success(bulkResult);

    } catch (error) {
        console.error(`Error getting bulk tensile channel data for ${req.params.experimentId}:`, error);
        res.error(`Failed to get bulk tensile channel data: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/tensile-stats/:channelId
 * Get tensile channel statistics
 */
router.get('/:experimentId/tensile-stats/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;

        console.log(`Getting tensile channel statistics for ${experimentId}/${channelId}`);

        // Validate channel ID
        const validChannels = ['force_kN', 'displacement_mm', 'force_vs_displacement'];
        if (!validChannels.includes(channelId)) {
            return res.error(`Invalid channel ID: ${channelId}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        // Get channel statistics
        const statsResult = await tensileService.getChannelStatistics(experimentId, channelId);

        if (!statsResult.success) {
            return res.error(statsResult.error, statsResult.error.includes('not found') ? 404 : 500);
        }

        res.success(statsResult);

    } catch (error) {
        console.error(`Error getting tensile channel statistics for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get tensile channel statistics: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/tensile-channels
 * Get available tensile channels information
 */
router.get('/:experimentId/tensile-channels', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting available tensile channels for experiment: ${experimentId}`);

        // Get metadata which includes channel information
        const metadataResult = await tensileService.getTensileMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        // Extract channel information
        const channelsInfo = {
            experimentId: experimentId,
            available: metadataResult.channels.available,
            byUnit: metadataResult.channels.byUnit,
            defaults: metadataResult.channels.defaults,
            ranges: metadataResult.channels.ranges,
            timeRange: metadataResult.timeRange,
            summary: {
                timeSeriesChannelCount: metadataResult.channels.available.timeSeries.length,
                xyRelationshipChannelCount: metadataResult.channels.available.xyRelationship.length,
                totalChannels: metadataResult.channels.available.timeSeries.length + 
                              metadataResult.channels.available.xyRelationship.length,
                duration: metadataResult.duration,
                testMetadata: metadataResult.testMetadata
            }
        };

        res.success(channelsInfo);

    } catch (error) {
        console.error(`Error getting tensile channels info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get tensile channels information: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/tensile-cache
 * Clear cached tensile data for experiment
 */
router.delete('/:experimentId/tensile-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing tensile cache for experiment: ${experimentId}`);

        tensileService.clearCache(experimentId);

        res.success({
            message: `Tensile cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing tensile cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear tensile cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/tensile-service/status
 * Get tensile CSV service status and cache information
 */
router.get('/tensile-service/status', async (req, res) => {
    try {
        const cacheStatus = tensileService.getCacheStatus();
        
        res.success({
            serviceName: 'Tensile CSV Service',
            status: 'active',
            cache: cacheStatus,
            capabilities: {
                supportedChannels: {
                    timeSeries: 'force_kN, displacement_mm (Force and Displacement over time)',
                    xyRelationship: 'force_vs_displacement (Force vs Displacement curve)'
                },
                supportedFormats: ['Multi-section semicolon-delimited CSV with coordinate pairs'],
                filePatterns: [
                    '*redalsa.csv (legacy format)',
                    '{experimentId}*.csv (new format, excluding other types)'
                ],
                dataProcessing: {
                    coordinateFormat: '{X=value, Y=value}',
                    sections: ['metadata_header', 'empty_separator', 'data_headers', 'coordinate_data'],
                    units: 'Force: kN, Displacement: mm, Time: s',
                    specialFeatures: 'Materials testing metadata, German datetime parsing'
                },
                maxFileSize: '10MB',
                resamplingAlgorithm: 'Simple decimation with feature preservation',
                caching: 'In-memory with TTL'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting tensile service status:', error);
        res.error(`Failed to get tensile service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/tensile-service/clear-all-cache
 * Clear all cached tensile data
 */
router.post('/tensile-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all tensile CSV cache...');

        tensileService.clearAllCache();

        res.success({
            message: 'All tensile CSV cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all tensile cache:', error);
        res.error(`Failed to clear all tensile cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/tensile-file-info
 * Get tensile file information without parsing (quick check)
 */
router.get('/:experimentId/tensile-file-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Get actual file path by scanning directory
        const filePath = await tensileService.getActualTensileFilePath(experimentId);
        const hasFile = await tensileService.hasTensileFile(experimentId);

        if (!hasFile || !filePath) {
            return res.success({
                experimentId: experimentId,
                hasFile: false,
                message: 'Tensile CSV file not found',
                expectedPatterns: [
                    '*redalsa.csv (legacy format)',
                    `${experimentId.toLowerCase()}*.csv (new format)`
                ]
            });
        }

        // Get basic file information
        const fs = require('fs').promises;
        const path = require('path');
        const stats = await fs.stat(filePath);

        res.success({
            experimentId: experimentId,
            hasFile: true,
            filePath: filePath,
            fileName: path.basename(filePath),
            fileSize: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(1),
            lastModified: stats.mtime,
            created: stats.birthtime,
            tensileInfo: {
                testType: 'Rail Tensile Testing',
                expectedChannels: ['Force (kN)', 'Displacement (mm)', 'Force vs Displacement'],
                supportedFormats: [
                    'Multi-section CSV: metadata + coordinate pairs',
                    'Format: {X=value, Y=value}'
                ],
                dataColumns: ['FORCE/WAY DATA', 'FORCE/TIME DATA', 'WAY/TIME DATA'],
                filePatterns: {
                    legacy: '*redalsa.csv',
                    new: `${experimentId}*.csv`
                }
            }
        });

    } catch (error) {
        console.error(`Error getting tensile file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get tensile file information: ${error.message}`, 500);
    }
});

// #endregion

// #region PHOTO/IMAGE DATA ROUTES

/**
 * GET /api/experiments/:experimentId/photos
 * Get all photos metadata for an experiment
 */
router.get('/:experimentId/photos', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting photos for experiment: ${experimentId}`);

        // Get photos metadata
        const photosResult = await photoService.getPhotosMetadata(experimentId);
        
        if (!photosResult.success) {
            return res.error(photosResult.error, photosResult.error.includes('not found') ? 404 : 500);
        }

        res.success({
            experimentId: experimentId,
            hasPhotos: true,
            ...photosResult
        });

    } catch (error) {
        console.error(`Error getting photos for ${req.params.experimentId}:`, error);
        res.error(`Failed to get photos: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/photos/metadata
 * Get photos metadata only (lightweight)
 */
router.get('/:experimentId/photos/metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting photos metadata for experiment: ${experimentId}`);

        // Get lightweight metadata
        const metadataResult = await photoService.getPhotosMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, metadataResult.error.includes('not found') ? 404 : 500);
        }

        res.success(metadataResult);

    } catch (error) {
        console.error(`Error getting photos metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get photos metadata: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/photos/:filename
 * Serve raw image file
 */
router.get('/:experimentId/photos/:filename', async (req, res) => {
    try {
        const { experimentId, filename } = req.params;

        console.log(`Serving photo: ${experimentId}/${filename}`);

        // Validate filename (security check)
        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.error('Invalid filename', 400);
        }

        // Get photo file path
        const photoPath = await photoService.getPhotoFilePath(experimentId, filename);
        
        if (!photoPath) {
            return res.error(`Photo not found: ${filename}`, 404);
        }

        // Verify file exists and get stats
        let stats;
        try {
            stats = await require('fs').promises.stat(photoPath);
        } catch (error) {
            console.error(`Photo file not accessible: ${photoPath}`, error);
            return res.error(`Photo file not accessible: ${filename}`, 404);
        }

        // Determine content type from extension
        const ext = require('path').extname(photoPath).toLowerCase();
        const contentTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.bmp': 'image/bmp',
            '.tiff': 'image/tiff',
            '.tif': 'image/tiff',
            '.gif': 'image/gif'
        };
        
        const contentType = contentTypes[ext] || 'application/octet-stream';

        // Set appropriate headers
        res.set({
            'Content-Type': contentType,
            'Content-Length': stats.size,
            'Last-Modified': stats.mtime.toUTCString(),
            'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
            'Content-Disposition': `inline; filename="${filename}"`
        });

        // Stream the file
        const fs = require('fs');
        const stream = fs.createReadStream(photoPath);
        
        stream.on('error', (error) => {
            console.error(`Error streaming photo ${photoPath}:`, error);
            if (!res.headersSent) {
                res.error('Failed to stream photo', 500);
            }
        });

        stream.pipe(res);

    } catch (error) {
        console.error(`Error serving photo ${req.params.experimentId}/${req.params.filename}:`, error);
        if (!res.headersSent) {
            res.error(`Failed to serve photo: ${error.message}`, 500);
        }
    }
});

/**
 * GET /api/experiments/:experimentId/photos-info
 * Get photo information without processing (quick check)
 */
router.get('/:experimentId/photos-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting photos info for experiment: ${experimentId}`);

        // Check if experiment has photos
        const hasPhotos = await photoService.hasPhotos(experimentId);

        if (!hasPhotos) {
            return res.success({
                experimentId: experimentId,
                hasPhotos: false,
                message: 'No photo files found for this experiment',
                supportedFormats: ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif']
            });
        }

        // Get basic info without full scanning
        const experimentFolder = require('path').join(require('../config/config').experiments.rootPath, experimentId);
        let folderStats = null;
        
        try {
            folderStats = await require('fs').promises.stat(experimentFolder);
        } catch (error) {
            return res.error('Experiment folder not found', 404);
        }

        res.success({
            experimentId: experimentId,
            hasPhotos: true,
            experimentFolder: experimentFolder,
            folderLastModified: folderStats.mtime,
            supportedFormats: ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif'],
            message: 'Photos available - use /photos endpoint for details'
        });

    } catch (error) {
        console.error(`Error getting photos info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get photos information: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/photos-cache
 * Clear cached photo data for experiment
 */
router.delete('/:experimentId/photos-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing photo cache for experiment: ${experimentId}`);

        photoService.clearCache(experimentId);

        res.success({
            message: `Photo cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing photo cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear photo cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/photos-service/status
 * Get photo service status and cache information
 */
router.get('/photos-service/status', async (req, res) => {
    try {
        const cacheStatus = photoService.getCacheStatus();
        
        res.success({
            serviceName: 'Photo Service',
            status: 'active',
            cache: cacheStatus,
            capabilities: {
                supportedFormats: {
                    jpeg: 'JPEG images (.jpg, .jpeg)',
                    png: 'PNG images (.png)',
                    bitmap: 'Bitmap images (.bmp)', 
                    tiff: 'TIFF images (.tiff, .tif)',
                    gif: 'GIF images (.gif)'
                },
                features: [
                    'Recursive folder scanning',
                    'File metadata extraction',
                    'Direct image serving',
                    'Caching with TTL',
                    'Security validation'
                ],
                maxFileSize: 'No limit (direct streaming)',
                caching: 'Metadata only - in-memory with TTL'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting photo service status:', error);
        res.error(`Failed to get photo service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/photos-service/clear-all-cache
 * Clear all cached photo data
 */
router.post('/photos-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all photo cache...');

        photoService.clearAllCache();

        res.success({
            message: 'All photo cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all photo cache:', error);
        res.error(`Failed to clear all photo cache: ${error.message}`, 500);
    }
});

// #endregion

// #region CROWN MEASUREMENT DATA ROUTES

/**
 * GET /api/experiments/:experimentId/crown-metadata
 * Get crown measurement metadata and comprehensive information
 */
router.get('/:experimentId/crown-metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting crown metadata for experiment: ${experimentId}`);

        // Check if experiment has crown files
        const hasCrown = await crownService.hasCrownFiles(experimentId);
        if (!hasCrown) {
            return res.error(`No crown measurement files found for experiment ${experimentId}`, 404);
        }

        // Get comprehensive metadata
        const metadataResult = await crownService.getCrownMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        res.success({
            experimentId: experimentId,
            hasValidCrownFiles: true,
            ...metadataResult
        });

    } catch (error) {
        console.error(`Error getting crown metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get crown metadata: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/crown-data/:channelId
 * Get single crown channel data
 * Supports: crown_warm_side, crown_cold_side, crown_top_view, crown_calculated
 */
router.get('/:experimentId/crown-data/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;
        const { 
            maxPoints = 1000 
        } = req.query;

        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 10000) {
            return res.error('Invalid maxPoints parameter (must be 1-10000)', 400);
        }

        // Validate channel ID
        const validChannels = ['crown_warm_side', 'crown_cold_side', 'crown_top_view', 'crown_calculated'];
        if (!validChannels.includes(channelId)) {
            return res.error(`Invalid channel ID: ${channelId}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        // Get channel data
        const channelResult = await crownService.getChannelData(experimentId, channelId, {
            maxPoints: maxPointsInt
        });

        if (!channelResult.success) {
            return res.error(channelResult.error, channelResult.error.includes('not found') ? 404 : 500);
        }

        res.success(channelResult);

    } catch (error) {
        console.error(`Error getting crown channel data for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get crown channel data: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/crown-data/bulk
 * Get multiple crown channels data efficiently
 */
router.post('/:experimentId/crown-data/bulk', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { 
            channelIds, 
            maxPoints = 1000 
        } = req.body;

        // Validate request body
        if (!Array.isArray(channelIds)) {
            return res.error('channelIds must be an array', 400);
        }

        if (channelIds.length === 0) {
            return res.error('channelIds cannot be empty', 400);
        }

        if (channelIds.length > 10) {
            return res.error('Maximum 10 channels per request', 400);
        }

        // Validate channel IDs
        const validChannels = ['crown_warm_side', 'crown_cold_side', 'crown_top_view', 'crown_calculated'];
        const invalidChannels = channelIds.filter(id => !validChannels.includes(id));
        if (invalidChannels.length > 0) {
            return res.error(`Invalid channel IDs: ${invalidChannels.join(', ')}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 10000) {
            return res.error('Invalid maxPoints parameter (must be 1-10000)', 400);
        }

        console.log(`Bulk crown channel request for ${experimentId}: ${channelIds.length} channels`);

        // Get bulk channel data
        const bulkResult = await crownService.getBulkChannelData(experimentId, channelIds, {
            maxPoints: maxPointsInt
        });

        if (!bulkResult.success) {
            return res.error(bulkResult.error, 500);
        }

        res.success(bulkResult);

    } catch (error) {
        console.error(`Error getting bulk crown channel data for ${req.params.experimentId}:`, error);
        res.error(`Failed to get bulk crown channel data: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/crown-stats/:channelId
 * Get crown channel statistics
 */
router.get('/:experimentId/crown-stats/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;

        console.log(`Getting crown channel statistics for ${experimentId}/${channelId}`);

        // Validate channel ID
        const validChannels = ['crown_warm_side', 'crown_cold_side', 'crown_top_view', 'crown_calculated'];
        if (!validChannels.includes(channelId)) {
            return res.error(`Invalid channel ID: ${channelId}. Supported channels: ${validChannels.join(', ')}`, 400);
        }

        // Get channel statistics
        const statsResult = await crownService.getChannelStatistics(experimentId, channelId);

        if (!statsResult.success) {
            return res.error(statsResult.error, statsResult.error.includes('not found') ? 404 : 500);
        }

        res.success(statsResult);

    } catch (error) {
        console.error(`Error getting crown channel statistics for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get crown channel statistics: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/crown-channels
 * Get available crown channels information
 */
router.get('/:experimentId/crown-channels', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting available crown channels for experiment: ${experimentId}`);

        // Get metadata which includes channel information
        const metadataResult = await crownService.getCrownMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        // Extract channel information
        const channelsInfo = {
            experimentId: experimentId,
            available: metadataResult.channels.available,
            byType: metadataResult.channels.byType,
            defaults: metadataResult.channels.defaults,
            ranges: metadataResult.channels.ranges,
            summary: {
                warmSideChannels: metadataResult.channels.available.warmSide.length,
                coldSideChannels: metadataResult.channels.available.coldSide.length,
                topViewChannels: metadataResult.channels.available.topView.length,
                calculatedChannels: metadataResult.channels.available.calculated.length,
                totalChannels: metadataResult.channels.available.warmSide.length + 
                              metadataResult.channels.available.coldSide.length +
                              metadataResult.channels.available.topView.length +
                              metadataResult.channels.available.calculated.length,
                crownInfo: metadataResult.crownInfo,
                comparison: metadataResult.comparison
            }
        };

        res.success(channelsInfo);

    } catch (error) {
        console.error(`Error getting crown channels info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get crown channels information: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/crown-cache
 * Clear cached crown data for experiment
 */
router.delete('/:experimentId/crown-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing crown cache for experiment: ${experimentId}`);

        crownService.clearCache(experimentId);

        res.success({
            message: `Crown cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing crown cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear crown cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/crown-service/status
 * Get crown service status and cache information
 */
router.get('/crown-service/status', async (req, res) => {
    try {
        const cacheStatus = crownService.getCacheStatus();
        
        res.success({
            serviceName: 'Crown Service',
            status: 'active',
            cache: cacheStatus,
            capabilities: {
                supportedChannels: {
                    warmSide: 'crown_warm_side (journal warm measurements)',
                    coldSide: 'crown_cold_side (Excel cold measurements)',
                    topView: 'crown_top_view (Excel lateral deviations)',
                    calculated: 'crown_calculated (Excel AD cell values)'
                },
                supportedFormats: [
                    'Excel: geradheit+versatz.xlsx with specific cell mappings',
                    'Journal: schweissjournal.txt semicolon-delimited format'
                ],
                measurementTypes: [
                    'Crown geometry analysis (side view)',
                    'Lateral deviation analysis (top view)', 
                    'Warm vs cold comparison',
                    'Calculated geometric values'
                ],
                dataProcessing: {
                    warmColdMapping: 'CrownEinlaufSeiteWarm→N18, CrownAuslaufSeiteWarm→J18',
                    units: 'millimeters (mm)',
                    scalingFactor: '30x for visualization',
                    temperatureStates: ['Cold (Excel)', 'Warm (Journal)']
                },
                maxFileSize: 'Excel: 50MB, Journal: 1MB',
                caching: 'In-memory with 30-minute TTL'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting crown service status:', error);
        res.error(`Failed to get crown service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/crown-service/clear-all-cache
 * Clear all cached crown data
 */
router.post('/crown-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all crown cache...');

        crownService.clearAllCache();

        res.success({
            message: 'All crown cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all crown cache:', error);
        res.error(`Failed to clear all crown cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/crown-file-info
 * Get crown file information without parsing (quick check)
 */
router.get('/:experimentId/crown-file-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting crown file info for experiment: ${experimentId}`);

        // Get file paths
        const filePaths = await crownService.discoverCrownFiles(experimentId);

        if (!filePaths.excelPath && !filePaths.journalPath) {
            return res.success({
                experimentId: experimentId,
                hasFiles: false,
                message: 'No crown measurement files found',
                expectedFiles: ['geradheit+versatz.xlsx', 'schweissjournal.txt']
            });
        }

        const fileInfo = {
            experimentId: experimentId,
            hasFiles: true,
            files: {}
        };

        // Get Excel file info
        if (filePaths.excelPath) {
            try {
                const fs = require('fs').promises;
                const path = require('path');
                const excelStats = await fs.stat(filePaths.excelPath);

                fileInfo.files.excel = {
                    filePath: filePaths.excelPath,
                    fileName: path.basename(filePaths.excelPath),
                    fileSize: excelStats.size,
                    fileSizeMB: (excelStats.size / 1024 / 1024).toFixed(1),
                    lastModified: excelStats.mtime,
                    created: excelStats.birthtime,
                    contains: ['Cold measurements (J18, N18)', 'Top view deviations (J23-N32)', 'Calculated values (AD cells)']
                };
            } catch (error) {
                fileInfo.files.excel = { error: `Cannot access Excel file: ${error.message}` };
            }
        }

        // Get journal file info
        if (filePaths.journalPath) {
            try {
                const fs = require('fs').promises;
                const path = require('path');
                const journalStats = await fs.stat(filePaths.journalPath);

                fileInfo.files.journal = {
                    filePath: filePaths.journalPath,
                    fileName: path.basename(filePaths.journalPath),
                    fileSize: journalStats.size,
                    fileSizeKB: (journalStats.size / 1024).toFixed(1),
                    lastModified: journalStats.mtime,
                    created: journalStats.birthtime,
                    contains: ['Warm measurements (CrownEinlaufSeiteWarm, CrownAuslaufSeiteWarm)', 'Measurement timing (ZeitabstandCrownMessung)']
                };
            } catch (error) {
                fileInfo.files.journal = { error: `Cannot access journal file: ${error.message}` };
            }
        }

        res.success(fileInfo);

    } catch (error) {
        console.error(`Error getting crown file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get crown file information: ${error.message}`, 500);
    }
});

// #endregion

// #region EXPERIMENT SUMMARY AND NOTES ROUTES

/**
 * GET /api/experiments/:experimentId/summary
 * Get computed experiment summary with key metrics
 */
router.get('/:experimentId/summary', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { refresh = false } = req.query;
        const forceRefresh = refresh === 'true' || refresh === true;

        console.log(`Getting summary for experiment: ${experimentId} (refresh: ${forceRefresh})`);

        // Clear cache if refresh requested
        if (forceRefresh) {
            summaryService.clearSummaryCache(experimentId);
        }

        // Compute summary
        const summary = await summaryService.computeExperimentSummary(experimentId);
        
        if (!summary) {
            return res.error(`Failed to compute summary for experiment ${experimentId}`, 500);
        }

        res.success(summary.toDisplayFormat());

    } catch (error) {
        console.error(`Error getting summary for ${req.params.experimentId}:`, error);
        res.error(`Failed to get experiment summary: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/summary/refresh
 * Force refresh experiment summary (clear cache and recompute)
 */
router.get('/:experimentId/summary/refresh', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Force refreshing summary for experiment: ${experimentId}`);

        // Clear cache and recompute
        summaryService.clearSummaryCache(experimentId);
        const summary = await summaryService.computeExperimentSummary(experimentId);

        res.success({
            message: `Summary refreshed for experiment ${experimentId}`,
            summary: summary.toDisplayFormat(),
            refreshedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error refreshing summary for ${req.params.experimentId}:`, error);
        res.error(`Failed to refresh experiment summary: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/notes
 * Get user notes for experiment
 */
router.get('/:experimentId/notes', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting notes for experiment: ${experimentId}`);

        const notes = await notesRepository.getNotesAsync(experimentId);
        
        if (!notes) {
            // Return empty notes if none exist
            const emptyNotes = {
                experimentId: experimentId,
                notes: '',
                createdAt: null,
                updatedAt: null,
                isEmpty: true,
                wordCount: 0,
                characterCount: 0
            };
            return res.success(emptyNotes);
        }

        res.success(notes.toApiFormat());

    } catch (error) {
        console.error(`Error getting notes for ${req.params.experimentId}:`, error);
        res.error(`Failed to get experiment notes: ${error.message}`, 500);
    }
});

/**
 * PUT /api/experiments/:experimentId/notes
 * Save or update user notes for experiment
 */
router.put('/:experimentId/notes', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { notes } = req.body;

        console.log(`Saving notes for experiment: ${experimentId}`);

        // Validate that experiment exists
        const experimentRepository = new ExperimentRepository();  // ✅ ADD THIS LINE
        const experiment = await experimentRepository.getExperimentAsync(experimentId);  // ✅ CHANGE 'repository' TO 'experimentRepository'
        if (!experiment) {
            return res.error(`Experiment not found: ${experimentId}`, 404);
        }

        // Create or update notes
        const experimentNotes = ExperimentNotes.createNew(experimentId, notes || '');
        
        // Validate notes
        const validation = experimentNotes.validate();
        if (!validation.isValid) {
            return res.error(`Notes validation failed: ${validation.errors.join(', ')}`, 400);
        }

        // Save to database
        await notesRepository.upsertNotesAsync(experimentNotes);

        res.success({
            message: `Notes saved for experiment ${experimentId}`,
            notes: experimentNotes.toApiFormat(),
            savedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error saving notes for ${req.params.experimentId}:`, error);
        res.error(`Failed to save experiment notes: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/notes
 * Delete user notes for experiment
 */
router.delete('/:experimentId/notes', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Deleting notes for experiment: ${experimentId}`);

        const deleted = await notesRepository.deleteNotesAsync(experimentId);
        
        if (deleted) {
            res.success({
                message: `Notes deleted for experiment ${experimentId}`,
                experimentId: experimentId,
                deletedAt: new Date().toISOString()
            });
        } else {
            res.success({
                message: `No notes found to delete for experiment ${experimentId}`,
                experimentId: experimentId
            });
        }

    } catch (error) {
        console.error(`Error deleting notes for ${req.params.experimentId}:`, error);
        res.error(`Failed to delete experiment notes: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/full
 * Get complete experiment data: experiment + metadata + notes + summary
 */
router.get('/:experimentId/full', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { refreshSummary = false } = req.query;
        const forceRefreshSummary = refreshSummary === 'true' || refreshSummary === true;

        console.log(`Getting full experiment data for: ${experimentId}`);

        // Get base experiment data
        const repository = new ExperimentRepository();
        const experimentData = await repository.getExperimentWithMetadataAsync(experimentId);
        
        if (!experimentData) {
            return res.error(`Experiment not found: ${experimentId}`, 404);
        }

        // Get notes
        const notes = await notesRepository.getNotesAsync(experimentId);
        
        // Get summary
        if (forceRefreshSummary) {
            summaryService.clearSummaryCache(experimentId);
        }
        const summary = await summaryService.computeExperimentSummary(experimentId);

        // Combine all data
        const fullData = {
            experiment: experimentData.experiment,
            metadata: experimentData.metadata,
            notes: notes ? notes.toApiFormat() : {
                experimentId: experimentId,
                notes: '',
                isEmpty: true,
                wordCount: 0,
                characterCount: 0
            },
            summary: summary.toDisplayFormat(),
            retrievedAt: new Date().toISOString()
        };

        res.success(fullData);

    } catch (error) {
        console.error(`Error getting full experiment data for ${req.params.experimentId}:`, error);
        res.error(`Failed to get full experiment data: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/summaries/bulk
 * Get summaries for multiple experiments
 */
router.post('/summaries/bulk', async (req, res) => {
    try {
        const { experimentIds, refresh = false } = req.body;

        // Validate request body
        if (!Array.isArray(experimentIds)) {
            return res.error('experimentIds must be an array', 400);
        }

        if (experimentIds.length === 0) {
            return res.error('experimentIds cannot be empty', 400);
        }

        if (experimentIds.length > 50) {
            return res.error('Maximum 50 experiments per request', 400);
        }

        console.log(`Getting bulk summaries for ${experimentIds.length} experiments`);

        // Clear cache if refresh requested
        if (refresh) {
            experimentIds.forEach(id => summaryService.clearSummaryCache(id));
        }

        // Compute summaries
        const summaries = await summaryService.computeMultipleSummaries(experimentIds);
        
        // Format for response
        const formattedSummaries = summaries.map(summary => ({
            experimentId: summary.experimentId,
            summary: summary.toDisplayFormat(),
            bulletPoints: summary.getBulletPoints()
        }));

        res.success({
            summaries: formattedSummaries,
            totalRequested: experimentIds.length,
            totalProcessed: summaries.length,
            processedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting bulk summaries:', error);
        res.error(`Failed to get bulk summaries: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/summaries/refresh-all
 * Refresh all experiment summaries (clear all cache)
 */
router.post('/summaries/refresh-all', async (req, res) => {
    try {
        console.log('Refreshing all experiment summaries...');

        const refreshedCount = await summaryService.refreshAllSummaries();

        res.success({
            message: 'All experiment summaries refreshed successfully',
            refreshedCount: refreshedCount,
            refreshedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error refreshing all summaries:', error);
        res.error(`Failed to refresh all summaries: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/summaries/status
 * Get summary service status and cache information
 */
router.get('/summaries/status', async (req, res) => {
    try {
        const healthStatus = await summaryService.getHealthStatus();
        const notesStats = await notesRepository.getNotesStatsAsync();
        
        res.success({
            summaryService: healthStatus,
            notesStatistics: notesStats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting summary service status:', error);
        res.error(`Failed to get summary service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/summaries/clear-cache
 * Clear all summary cache
 */
router.post('/summaries/clear-cache', async (req, res) => {
    try {
        console.log('Clearing all summary cache...');

        summaryService.clearAllCache();

        res.success({
            message: 'All summary cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing summary cache:', error);
        res.error(`Failed to clear summary cache: ${error.message}`, 500);
    }
});

// #endregion

// #region HDF5 DATA ROUTES

/**
 * GET /api/experiments/:experimentId/hdf5-metadata
 * Get HDF5 file metadata and channel information
 */
router.get('/:experimentId/hdf5-metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting HDF5 metadata for experiment: ${experimentId}`);

        // Check if experiment has HDF5 file
        const hasHdf5 = await hdf5Service.hasHdf5File(experimentId);
        if (!hasHdf5.exists) {
            return res.error(`No HDF5 file found for experiment ${experimentId}`, 404);
        }

        // Get comprehensive metadata
        const metadataResult = await hdf5Service.getHdf5Metadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        res.success({
            experimentId: experimentId,
            hasValidHdf5File: true,
            ...metadataResult
        });

    } catch (error) {
        console.error(`Error getting HDF5 metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get HDF5 metadata: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/hdf5-data/:channelId
 * Get single HDF5 channel data with resampling
 */
router.get('/:experimentId/hdf5-data/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;
        const { 
            start = 0, 
            end = null, 
            maxPoints = 2000 
        } = req.query;

        const startTime = parseFloat(start);
        const endTime = end ? parseFloat(end) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTime) || startTime < 0) {
            return res.error('Invalid start time parameter', 400);
        }
        
        if (endTime !== null && (isNaN(endTime) || endTime <= startTime)) {
            return res.error('Invalid end time parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        // Get channel data
        const channelResult = await hdf5Service.getChannelData(experimentId, channelId, {
            startTime: startTime,
            endTime: endTime,
            maxPoints: maxPointsInt
        });

        if (!channelResult.success) {
            return res.error(channelResult.error, channelResult.error.includes('not found') ? 404 : 500);
        }

        res.success(channelResult);

    } catch (error) {
        console.error(`Error getting HDF5 channel data for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get HDF5 channel data: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/hdf5-data/bulk
 * Get multiple HDF5 channels data efficiently
 */
router.post('/:experimentId/hdf5-data/bulk', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { 
            channelIds, 
            startTime = 0, 
            endTime = null, 
            maxPoints = 2000 
        } = req.body;

        // Validate request body
        if (!Array.isArray(channelIds)) {
            return res.error('channelIds must be an array', 400);
        }

        if (channelIds.length === 0) {
            return res.error('channelIds cannot be empty', 400);
        }

        if (channelIds.length > 20) {
            return res.error('Maximum 20 channels per request', 400);
        }

        const startTimeFloat = parseFloat(startTime);
        const endTimeFloat = endTime ? parseFloat(endTime) : null;
        const maxPointsInt = parseInt(maxPoints);

        // Validate parameters
        if (isNaN(startTimeFloat) || startTimeFloat < 0) {
            return res.error('Invalid startTime parameter', 400);
        }
        
        if (endTimeFloat !== null && (isNaN(endTimeFloat) || endTimeFloat <= startTimeFloat)) {
            return res.error('Invalid endTime parameter', 400);
        }
        
        if (isNaN(maxPointsInt) || maxPointsInt < 1 || maxPointsInt > 50000) {
            return res.error('Invalid maxPoints parameter (must be 1-50000)', 400);
        }

        console.log(`Bulk HDF5 channel request for ${experimentId}: ${channelIds.length} channels`);

        // Get bulk channel data
        const bulkResult = await hdf5Service.getBulkChannelData(experimentId, channelIds, {
            startTime: startTimeFloat,
            endTime: endTimeFloat,
            maxPoints: maxPointsInt
        });

        if (!bulkResult.success) {
            return res.error(bulkResult.error, 500);
        }

        res.success(bulkResult);

    } catch (error) {
        console.error(`Error getting bulk HDF5 channel data for ${req.params.experimentId}:`, error);
        res.error(`Failed to get bulk HDF5 channel data: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/hdf5-stats/:channelId
 * Get HDF5 channel statistics
 */
router.get('/:experimentId/hdf5-stats/:channelId', async (req, res) => {
    try {
        const { experimentId, channelId } = req.params;

        console.log(`Getting HDF5 channel statistics for ${experimentId}/${channelId}`);

        // Get channel statistics
        const statsResult = await hdf5Service.getChannelStatistics(experimentId, channelId);

        if (!statsResult.success) {
            return res.error(statsResult.error, statsResult.error.includes('not found') ? 404 : 500);
        }

        res.success(statsResult);

    } catch (error) {
        console.error(`Error getting HDF5 channel statistics for ${req.params.experimentId}/${req.params.channelId}:`, error);
        res.error(`Failed to get HDF5 channel statistics: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/hdf5-channels
 * Get available HDF5 channels information
 */
router.get('/:experimentId/hdf5-channels', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Getting available HDF5 channels for experiment: ${experimentId}`);

        // Get available channels
        const channelsResult = await hdf5Service.getAvailableChannels(experimentId);
        
        if (!channelsResult.success) {
            return res.error(channelsResult.error, 500);
        }

        res.success(channelsResult);

    } catch (error) {
        console.error(`Error getting HDF5 channels info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get HDF5 channels information: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/hdf5-cache
 * Clear cached HDF5 data for experiment
 */
router.delete('/:experimentId/hdf5-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing HDF5 cache for experiment: ${experimentId}`);

        hdf5Service.clearCache(experimentId);

        res.success({
            message: `HDF5 cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing HDF5 cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear HDF5 cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/hdf5-service/status
 * Get HDF5 parser service status and cache information
 */
router.get('/hdf5-service/status', async (req, res) => {
    try {
        const serviceStatus = hdf5Service.getServiceStatus();
        
        res.success({
            ...serviceStatus,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting HDF5 service status:', error);
        res.error(`Failed to get HDF5 service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/hdf5-service/clear-all-cache
 * Clear all cached HDF5 data
 */
router.post('/hdf5-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all HDF5 parser cache...');

        hdf5Service.clearAllCache();

        res.success({
            message: 'All HDF5 parser cache cleared successfully',
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all HDF5 cache:', error);
        res.error(`Failed to clear all HDF5 cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/hdf5-file-info
 * Get HDF5 file information without parsing (quick check)
 */
router.get('/:experimentId/hdf5-file-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Check if HDF5 file exists
        const hasHdf5Result = await hdf5Service.hasHdf5File(experimentId);

        if (!hasHdf5Result.exists) {
            return res.success({
                experimentId: experimentId,
                hasFile: false,
                searchedPaths: hasHdf5Result.searchedPaths,
                message: 'HDF5 file not found'
            });
        }

        // Get basic file information
        const fs = require('fs').promises;
        const path = require('path');
        const stats = await fs.stat(hasHdf5Result.filePath);

        res.success({
            experimentId: experimentId,
            hasFile: true,
            filePath: hasHdf5Result.filePath,
            fileName: path.basename(hasHdf5Result.filePath),
            fileExtension: hasHdf5Result.fileExtension,
            fileSize: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(1),
            lastModified: stats.mtime,
            created: stats.birthtime
        });

    } catch (error) {
        console.error(`Error getting HDF5 file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get HDF5 file information: ${error.message}`, 500);
    }
});

// #endregion

// #region THERMAL DATA ROUTES

/**
 * GET /api/experiments/:experimentId/thermal-metadata
 * Get thermal video metadata and information
 */
router.get('/:experimentId/thermal-metadata', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { forceRefresh = false } = req.query;
        const forceRefreshBool = forceRefresh === 'true' || forceRefresh === true;

        console.log(`Getting thermal metadata for experiment: ${experimentId}`);

        // Check if experiment has thermal file
        const hasThermal = await thermalService.hasThermalFile(experimentId);
        if (!hasThermal.exists) {
            return res.error(`No thermal AVI file found for experiment ${experimentId}`, 404);
        }

        // Get comprehensive metadata
        const metadataResult = await thermalService.getThermalMetadata(experimentId);
        
        if (!metadataResult.success) {
            return res.error(metadataResult.error, 500);
        }

        res.success({
            experimentId: experimentId,
            hasValidThermalFile: true,
            ...metadataResult
        });

    } catch (error) {
        console.error(`Error getting thermal metadata for ${req.params.experimentId}:`, error);
        res.error(`Failed to get thermal metadata: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/thermal/analyze
 * Analyze temperature along multiple lines for a specific frame
 */
router.post('/:experimentId/thermal/analyze', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { 
            frameNum, 
            lines 
        } = req.body;

        // Validate request body
        if (typeof frameNum !== 'number' || isNaN(frameNum)) {
            return res.error('frameNum must be a valid number', 400);
        }

        if (!Array.isArray(lines) || lines.length === 0) {
            return res.error('lines must be a non-empty array', 400);
        }

        if (lines.length > 10) {
            return res.error('Maximum 10 lines per analysis request', 400);
        }

        // Validate line coordinates
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || typeof line.x1 !== 'number' || typeof line.y1 !== 'number' ||
                typeof line.x2 !== 'number' || typeof line.y2 !== 'number') {
                return res.error(`Line ${i} must have valid x1, y1, x2, y2 coordinates`, 400);
            }
        }

        console.log(`Analyzing ${lines.length} lines for ${experimentId} frame ${frameNum}`);

        // Perform analysis
        const analysisResult = await thermalService.analyzeLines(experimentId, frameNum, lines);

        if (!analysisResult.success) {
            return res.error(analysisResult.error, 500);
        }

        res.success(analysisResult);

    } catch (error) {
        console.error(`Error analyzing thermal lines for ${req.params.experimentId}:`, error);
        res.error(`Failed to analyze thermal lines: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/:experimentId/thermal/pixel-temperature
 * Get temperature for specific RGB pixel values
 */
router.post('/:experimentId/thermal/pixel-temperature', async (req, res) => {
    try {
        const { experimentId } = req.params;
        const { r, g, b } = req.body;

        // Validate RGB values
        if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number' ||
            r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255 ||
            isNaN(r) || isNaN(g) || isNaN(b)) {
            return res.error('RGB values must be valid numbers between 0 and 255', 400);
        }

        console.log(`Getting pixel temperature for ${experimentId} RGB(${r},${g},${b})`);

        // Get pixel temperature
        const tempResult = await thermalService.getPixelTemperature(experimentId, r, g, b);

        if (!tempResult.success) {
            return res.error(tempResult.error, 500);
        }

        res.success(tempResult);

    } catch (error) {
        console.error(`Error getting pixel temperature for ${req.params.experimentId}:`, error);
        res.error(`Failed to get pixel temperature: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/thermal/video
 * Serve MP4 video file via Express static serving (redirect)
 * UPDATED: Simplified to use Express static middleware instead of custom streaming
 */
router.get('/:experimentId/thermal/video', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Serving thermal video for experiment: ${experimentId}`);

        // Check if thermal file exists
        const hasThermal = await thermalService.hasThermalFile(experimentId);
        if (!hasThermal.exists) {
            return res.error(`No thermal file found for experiment ${experimentId}`, 404);
        }

        // Initialize video conversion service
        const VideoConversionService = require('../services/VideoConversionService');
        const conversionService = new VideoConversionService();

        // Convert AVI to MP4 and get static serving URL
        const conversionResult = await conversionService.convertAndServe(experimentId, hasThermal.filePath);

        console.log('DEBUG - Full conversion result:', JSON.stringify(conversionResult, null, 2));

        if (!conversionResult.success) {
            console.error(`Video conversion failed for ${experimentId}:`, conversionResult.message);
            return res.error(`Video conversion failed: ${conversionResult.message}`, 500);
        }

        // Get static URL from conversion result
        if (!conversionResult.data || !conversionResult.data.staticUrl) {
            console.error('Static URL missing from conversion result:', conversionResult);
            return res.error('Static URL not found in conversion result', 500);
        }

        const { staticUrl } = conversionResult.data;

        console.log(`✅ Redirecting to static thermal video: ${staticUrl}`);

        // Redirect to Express static serving URL
        res.redirect(staticUrl);

    } catch (error) {
        console.error(`Error serving thermal video for ${req.params.experimentId}:`, error);
        res.error(`Failed to serve thermal video: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/thermal/conversion-status
 * Get video conversion status
 */
router.get('/:experimentId/thermal/conversion-status', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Initialize video conversion service
        const VideoConversionService = require('../services/VideoConversionService');
        const conversionService = new VideoConversionService();

        // Get conversion status
        const status = conversionService.getConversionStatus(experimentId);

        res.success({
            experimentId: experimentId,
            ...status,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error getting conversion status for ${req.params.experimentId}:`, error);
        res.error(`Failed to get conversion status: ${error.message}`, 500);
    }
});

/**
 * DELETE /api/experiments/:experimentId/thermal-cache
 * Clear cached thermal data for experiment
 */
router.delete('/:experimentId/thermal-cache', async (req, res) => {
    try {
        const { experimentId } = req.params;

        console.log(`Clearing thermal cache for experiment: ${experimentId}`);

        // Clear thermal service cache
        thermalService.clearCache(experimentId);

        // Clear video conversion cache
        const VideoConversionService = require('../services/VideoConversionService');
        const conversionService = new VideoConversionService();
        await conversionService.clearConversionCache(experimentId);

        res.success({
            message: `Thermal cache cleared for experiment ${experimentId}`,
            experimentId: experimentId,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`Error clearing thermal cache for ${req.params.experimentId}:`, error);
        res.error(`Failed to clear thermal cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/thermal-service/status
 * Get thermal parser service status and cache information
 */
router.get('/thermal-service/status', async (req, res) => {
    try {
        const serviceStatus = thermalService.getServiceStatus();
        
        // Also get video conversion service status
        const VideoConversionService = require('../services/VideoConversionService');
        const conversionService = new VideoConversionService();
        const conversionStatus = conversionService.getServiceStatus();
        
        res.success({
            thermalParser: serviceStatus,
            videoConversion: conversionStatus,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting thermal service status:', error);
        res.error(`Failed to get thermal service status: ${error.message}`, 500);
    }
});

/**
 * POST /api/experiments/thermal-service/clear-all-cache
 * Clear all cached thermal data
 */
router.post('/thermal-service/clear-all-cache', async (req, res) => {
    try {
        console.log('Clearing all thermal parser cache...');

        // Clear thermal service cache
        thermalService.clearAllCache();

        // Clear video conversion cache
        const VideoConversionService = require('../services/VideoConversionService');
        const conversionService = new VideoConversionService();
        const clearedConversions = await conversionService.clearAllCache();

        res.success({
            message: 'All thermal parser cache cleared successfully',
            thermalCacheCleared: true,
            conversionsCleared: clearedConversions,
            clearedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error clearing all thermal cache:', error);
        res.error(`Failed to clear all thermal cache: ${error.message}`, 500);
    }
});

/**
 * GET /api/experiments/:experimentId/thermal-file-info
 * Get thermal file information without parsing (quick check)
 */
router.get('/:experimentId/thermal-file-info', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Check if thermal file exists
        const hasThermalResult = await thermalService.hasThermalFile(experimentId);

        if (!hasThermalResult.exists) {
            return res.success({
                experimentId: experimentId,
                hasFile: false,
                expectedPath: hasThermalResult.expectedPath,
                foundFiles: hasThermalResult.foundFiles || [],
                message: 'Thermal AVI file not found'
            });
        }

        // Get basic file information
        const fs = require('fs').promises;
        const path = require('path');
        const stats = await fs.stat(hasThermalResult.filePath);

        // Get conversion status
        const VideoConversionService = require('../services/VideoConversionService');
        const conversionService = new VideoConversionService();
        const conversionStatus = conversionService.getConversionStatus(experimentId);

        res.success({
            experimentId: experimentId,
            hasFile: true,
            filePath: hasThermalResult.filePath,
            fileName: path.basename(hasThermalResult.filePath),
            fileExtension: hasThermalResult.fileExtension || '.avi',
            fileSize: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(1),
            lastModified: stats.mtime,
            created: stats.birthtime,
            foundFiles: hasThermalResult.foundFiles || [path.basename(hasThermalResult.filePath)],
            conversionStatus: conversionStatus
        });

    } catch (error) {
        console.error(`Error getting thermal file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get thermal file information: ${error.message}`, 500);
    }
});

// #endregion

module.exports = router;