/**
 * Startup Service
 * Converts C# Services/Startup/StartupDataService.cs to JavaScript
 * Orchestrates all startup data services (scanning and parsing)
 */

const DirectoryScanner = require('./DirectoryScanner');
const JournalParser = require('./JournalParser');

class StartupService {
    constructor() {
        this.serviceName = 'Startup Service';
    }

    /**
     * Initialize all data services (equivalent to C# InitializeAllDataAsync)
     * @param {boolean} forceRefresh - Force refresh all data
     * @returns {Promise<boolean>} Success status
     */
    async initializeAllData(forceRefresh = false) {
        const totalStartTime = Date.now();
        let allSuccess = true;

        console.log(`Starting data initialization (forceRefresh: ${forceRefresh})...`);

        // Get services in execution order (same as C# version)
        const services = [
            new DirectoryScanner(),
            new JournalParser()
        ];

        // Execute services sequentially
        for (const service of services) {
            try {
                console.log(`\n=== ${service.serviceName} ===`);
                const result = await service.executeServiceLogicAsync(forceRefresh);
                
                if (!result.success) {
                    allSuccess = false;
                    console.error(`Service ${service.serviceName} failed: ${result.message}`);
                    
                    // Log individual errors
                    for (const error of result.errors) {
                        console.error(`  - ${error}`);
                    }
                    
                    // Don't continue - fail fast (same as C# version)
                    break;
                }

            } catch (error) {
                allSuccess = false;
                console.error(`Service ${service.serviceName} failed with exception: ${error.message}`);
                // Don't continue - fail fast
                break;
            }
        }

        const totalDuration = Date.now() - totalStartTime;
        const durationSeconds = (totalDuration / 1000).toFixed(2);

        console.log(`\nData initialization completed in ${durationSeconds}s. Success: ${allSuccess}`);
        
        return allSuccess;
    }

    /**
     * Run directory scan only (utility method for npm script)
     * @param {boolean} forceRefresh 
     * @returns {Promise<boolean>}
     */
    async runDirectoryScanner(forceRefresh = false) {
        console.log('Running directory scanner...');
        
        try {
            const scanner = new DirectoryScanner();
            const result = await scanner.executeServiceLogicAsync(forceRefresh);
            return result.success;
        } catch (error) {
            console.error('Directory scanner failed:', error);
            return false;
        }
    }

    /**
     * Run journal parser only (utility method for npm script)
     * @param {boolean} forceRefresh 
     * @returns {Promise<boolean>}
     */
    async runJournalParser(forceRefresh = false) {
        console.log('Running journal parser...');
        
        try {
            const parser = new JournalParser();
            const result = await parser.executeServiceLogicAsync(forceRefresh);
            return result.success;
        } catch (error) {
            console.error('Journal parser failed:', error);
            return false;
        }
    }

    /**
     * Get service status summary
     * @returns {Promise<Object>} Status information
     */
    async getServiceStatus() {
        const ExperimentRepository = require('../repositories/ExperimentRepository');
        const repository = new ExperimentRepository();
        
        try {
            const experimentCount = await repository.getExperimentCountAsync();
            const experimentsWithJournals = await repository.getExperimentsWithJournalsAsync();
            const journalCount = experimentsWithJournals.length;
            
            // Count experiments with metadata
            const experimentsWithMetadata = await repository.getAllExperimentsWithMetadataAsync();
            const metadataCount = experimentsWithMetadata.filter(item => item.metadata !== null).length;

            return {
                success: true,
                status: {
                    totalExperiments: experimentCount,
                    experimentsWithJournals: journalCount,
                    experimentsWithMetadata: metadataCount,
                    journalParseRate: journalCount > 0 ? Math.round((metadataCount / journalCount) * 100) : 0,
                    lastChecked: new Date().toISOString()
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                status: null
            };
        }
    }

    /**
     * Quick health check
     * @returns {Promise<Object>} Health status
     */
    async healthCheck() {
        try {
            const ExperimentRepository = require('../repositories/ExperimentRepository');
            const repository = new ExperimentRepository();
            
            // Quick database check
            const count = await repository.getExperimentCountAsync();
            
            return {
                healthy: true,
                experimentsLoaded: count,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

// Utility function for npm scripts
async function runScan() {
    const startupService = new StartupService();
    const success = await startupService.initializeAllData(false);
    process.exit(success ? 0 : 1);
}

// Export class and utility function
module.exports = StartupService;
module.exports.runScan = runScan;