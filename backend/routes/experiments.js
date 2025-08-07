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
const { responseMiddleware } = require('../models/ApiResponse');

// Apply response middleware to all routes in this router
router.use(responseMiddleware);

// Initialize services
const binaryService = new BinaryParserService();
const temperatureService = new TemperatureCsvService();
const positionService = new PositionCsvService();

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

        const repository = new ExperimentRepository();
        const experiment = await repository.getExperimentWithMetadataAsync(experimentId);

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

module.exports = router;