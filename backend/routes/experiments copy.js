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
const TPC5ParserService = require('../services/TPC5ParserService');
const SummaryService = require('../services/SummaryService');
const ExperimentNotesRepository = require('../repositories/ExperimentNotesRepository');
const ExperimentNotes = require('../models/ExperimentNotes');
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
const tpc5Service = new TPC5ParserService();
const summaryService = new SummaryService();
const notesRepository = new ExperimentNotesRepository();

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
            
            // Add TPC5 service status
            const tpc5CacheStatus = tpc5Service.getCacheStatus();
            statusResult.status.tpc5ParserService = {
                cachedExperiments: tpc5CacheStatus.totalCachedExperiments,
                cacheTimeout: tpc5CacheStatus.cacheTimeoutMs
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
                tpc5Service.clearAllCache();
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
        const experiment = await repository.getExperimentAsync(experimentId);
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

module.exports = router;