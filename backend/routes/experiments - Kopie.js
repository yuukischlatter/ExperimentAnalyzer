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

module.exports = router;