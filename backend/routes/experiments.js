/**
 * Experiments Routes
 * Converts C# WebApi/Controllers/Core/ExperimentsController.cs to Express routes
 */

const express = require('express');
const router = express.Router();
const ExperimentRepository = require('../repositories/ExperimentRepository');
const StartupService = require('../services/StartupService');
const { responseMiddleware } = require('../models/ApiResponse');

// Apply response middleware to all routes in this router
router.use(responseMiddleware);

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

module.exports = router;