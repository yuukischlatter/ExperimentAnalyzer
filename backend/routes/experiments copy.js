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


...


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
 * Serve converted MP4 file for browser playback (placeholder for future implementation)
 */
router.get('/:experimentId/thermal/video', async (req, res) => {
    try {
        const { experimentId } = req.params;

        // Check if thermal file exists
        const hasThermal = await thermalService.hasThermalFile(experimentId);
        if (!hasThermal.exists) {
            return res.error(`No thermal file found for experiment ${experimentId}`, 404);
        }

        // For now, return file info (video serving would require FFmpeg conversion)
        res.success({
            experimentId: experimentId,
            message: 'Video serving not yet implemented',
            availableFile: hasThermal.filePath,
            note: 'Use WebSocket for real-time analysis, video serving requires FFmpeg conversion'
        });

    } catch (error) {
        console.error(`Error serving thermal video for ${req.params.experimentId}:`, error);
        res.error(`Failed to serve thermal video: ${error.message}`, 500);
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

        thermalService.clearCache(experimentId);

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
        
        res.success({
            ...serviceStatus,
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

        thermalService.clearAllCache();

        res.success({
            message: 'All thermal parser cache cleared successfully',
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
            foundFiles: hasThermalResult.foundFiles || [path.basename(hasThermalResult.filePath)]
        });

    } catch (error) {
        console.error(`Error getting thermal file info for ${req.params.experimentId}:`, error);
        res.error(`Failed to get thermal file information: ${error.message}`, 500);
    }
});

// #endregion

module.exports = router;