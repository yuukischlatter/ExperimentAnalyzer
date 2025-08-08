/**
 * Summary Service
 * Computes experiment summary data by aggregating information from all data sources
 * File: backend/services/SummaryService.js
 */

const ExperimentSummary = require('../models/ExperimentSummary');
const ExperimentRepository = require('../repositories/ExperimentRepository');
const BinaryParserService = require('./BinaryParserService');
const TemperatureCsvService = require('./TemperatureCsvService');
const PositionCsvService = require('./PositionCsvService');
const AccelerationCsvService = require('./AccelerationCsvService');
const TensileCsvService = require('./TensileCsvService');
const CrownService = require('./CrownService');

class SummaryService {
    constructor() {
        this.serviceName = 'Summary Service';
        
        // Initialize data services
        this.experimentRepository = new ExperimentRepository();
        this.binaryService = new BinaryParserService();
        this.temperatureService = new TemperatureCsvService();
        this.positionService = new PositionCsvService();
        this.accelerationService = new AccelerationCsvService();
        this.tensileService = new TensileCsvService();
        this.crownService = new CrownService();
        
        // Cache for computed summaries (5 minute TTL)
        this.summaryCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    // === MAIN COMPUTATION METHOD ===

    /**
     * Compute complete experiment summary
     * @param {string} experimentId 
     * @returns {Promise<ExperimentSummary>}
     */
    async computeExperimentSummary(experimentId) {
        try {
            console.log(`Computing summary for experiment: ${experimentId}`);
            
            // Check cache first
            const cached = this.getCachedSummary(experimentId);
            if (cached) {
                return cached;
            }

            // Get base experiment data
            const experimentData = await this.experimentRepository.getExperimentWithMetadataAsync(experimentId);
            if (!experimentData) {
                throw new Error(`Experiment not found: ${experimentId}`);
            }

            const { experiment, metadata } = experimentData;
            
            // Initialize summary
            const summary = new ExperimentSummary({
                experimentId: experimentId,
                experiment: experiment,
                metadata: metadata
            });

            // Compute all sections in parallel
            const computationPromises = [
                this.computeWeldingPerformance(experimentId, experiment, metadata, summary),
                this.computeTensileResults(experimentId, experiment, summary),
                this.computeTemperatureMonitoring(experimentId, experiment, summary),
                this.computeGeometryAndPosition(experimentId, experiment, metadata, summary),
                this.computeVibrationAnalysis(experimentId, experiment, summary),
                this.computeFileAvailability(experiment, summary)
            ];

            // Execute all computations
            await Promise.allSettled(computationPromises);

            // Set final status
            if (summary.errors.length === 0) {
                summary.setComputationStatus('complete');
            } else if (summary.dataSourcesUsed.length > 0) {
                summary.setComputationStatus('partial');
            } else {
                summary.setComputationStatus('failed');
            }

            // Cache the result
            this.cacheSummary(experimentId, summary);
            
            console.log(`Summary computed for ${experimentId}: ${summary.computationStatus} (${summary.dataSourcesUsed.length} sources)`);
            return summary;

        } catch (error) {
            console.error(`Failed to compute summary for ${experimentId}:`, error);
            
            const errorSummary = new ExperimentSummary({ 
                experimentId: experimentId,
                computationStatus: 'failed'
            });
            errorSummary.addError(`Summary computation failed: ${error.message}`);
            
            return errorSummary;
        }
    }

    // === INDIVIDUAL SECTION COMPUTATIONS ===

    /**
     * Compute welding performance metrics
     */
    async computeWeldingPerformance(experimentId, experiment, metadata, summary) {
        try {
            // Always include journal/metadata info
            const weldingData = {
                programNumber: metadata?.programNumber || '60',
                programName: metadata?.programName || 'Standard',
                program: `${metadata?.programNumber || '60'} - ${metadata?.programName || 'Standard'}`,
                material: metadata?.material || 'Unknown',
                shape: metadata?.shape || '',
                operator: metadata?.operator || 'Unknown',
                oilTemperature: metadata?.oilTemperature
            };

            // Add material + shape combination
            if (weldingData.material !== 'Unknown' && weldingData.shape) {
                weldingData.material = `${weldingData.material} ${weldingData.shape}`;
            }

            summary.addDataSource('journal');

            // Try to get binary oscilloscope data for electrical metrics
            if (experiment.hasBinFile) {
                try {
                    const binMeta = await this.binaryService.getBinaryMetadata(experimentId);
                    
                    if (binMeta.success && binMeta.channels?.ranges) {
                        const ranges = binMeta.channels.ranges;
                        
                        // Extract key electrical measurements
                        weldingData.peakForce = ranges.calc_6?.max; // F_Schlitten*
                        weldingData.peakCurrentGR1 = ranges.calc_3?.max; // I_DC_GR1*
                        weldingData.peakCurrentGR2 = ranges.calc_4?.max; // I_DC_GR2*
                        weldingData.maxVoltage = ranges.calc_5?.max; // U_DC*
                        weldingData.duration = binMeta.duration;
                        
                        // Calculate max pressure from both channels
                        const pressureVor = ranges.channel_6?.max || 0;
                        const pressureRueck = ranges.channel_7?.max || 0;
                        weldingData.maxPressure = Math.max(pressureVor, pressureRueck);
                        
                        summary.addDataSource('binary');
                    }
                } catch (error) {
                    summary.addError(`Binary data error: ${error.message}`);
                }
            }

            summary.setWeldingPerformance(weldingData);

        } catch (error) {
            summary.addError(`Welding performance computation failed: ${error.message}`);
        }
    }

    /**
     * Compute tensile test results
     */
    async computeTensileResults(experimentId, experiment, summary) {
        if (!experiment.hasTensileCsv) {
            return;
        }

        try {
            const tensileMeta = await this.tensileService.getTensileMetadata(experimentId);
            
            if (tensileMeta.success) {
                const ranges = tensileMeta.channels?.ranges;
                const testMeta = tensileMeta.testMetadata;
                
                const tensileData = {
                    peakForce: ranges?.force_kN?.max,
                    targetForce: testMeta?.nominalForce || 1800,
                    minForceLimit: testMeta?.minForceLimit,
                    maxDisplacement: ranges?.displacement_mm?.max,
                    materialGrade: testMeta?.materialGrade,
                    testDate: testMeta?.testDate
                };

                summary.setTensileResults(tensileData);
                summary.addDataSource('tensile');
            }

        } catch (error) {
            summary.addError(`Tensile results computation failed: ${error.message}`);
        }
    }

    /**
     * Compute temperature monitoring data
     */
    async computeTemperatureMonitoring(experimentId, experiment, summary) {
        if (!experiment.hasAmbientTemperature) {
            return;
        }

        try {
            const tempMeta = await this.temperatureService.getTemperatureMetadata(experimentId);
            
            if (tempMeta.success && tempMeta.channels?.ranges) {
                const ranges = tempMeta.channels.ranges;
                
                const temperatureData = {
                    duration: tempMeta.duration,
                    channels: Object.keys(ranges)
                };

                // Extract welding temperature (if available)
                if (ranges.temp_welding) {
                    temperatureData.weldingTempMin = ranges.temp_welding.min;
                    temperatureData.weldingTempMax = ranges.temp_welding.max;
                    temperatureData.weldingTempRange = ranges.temp_welding.range;
                }

                // Extract ambient/other temperature channels
                const otherChannels = Object.keys(ranges).filter(key => key !== 'temp_welding');
                if (otherChannels.length > 0) {
                    const otherRange = ranges[otherChannels[0]];
                    temperatureData.ambientTempMin = otherRange.min;
                    temperatureData.ambientTempMax = otherRange.max;
                    temperatureData.ambientTempRange = otherRange.range;
                }

                summary.setTemperatureMonitoring(temperatureData);
                summary.addDataSource('temperature');
            }

        } catch (error) {
            summary.addError(`Temperature monitoring computation failed: ${error.message}`);
        }
    }

    /**
     * Compute geometry and position data
     */
    async computeGeometryAndPosition(experimentId, experiment, metadata, summary) {
        try {
            const geometryData = {
                // Crown measurements from journal metadata
                crownEinlaufWarm: metadata?.crownEinlaufWarm,
                crownAuslaufWarm: metadata?.crownAuslaufWarm,
                crownEinlaufKalt: metadata?.crownEinlaufKalt,
                crownAuslaufKalt: metadata?.crownAuslaufKalt,
                crownMeasurementInterval: metadata?.crownMeasurementInterval,
                
                // Rail information
                einlaufseite: metadata?.einlaufseite,
                auslaufseite: metadata?.auslaufseite
            };

            // Calculate crown differences if both warm and cold are available
            if (geometryData.crownEinlaufWarm != null && geometryData.crownEinlaufKalt != null) {
                geometryData.crownDifferenceInlet = geometryData.crownEinlaufWarm - geometryData.crownEinlaufKalt;
            }
            if (geometryData.crownAuslaufWarm != null && geometryData.crownAuslaufKalt != null) {
                geometryData.crownDifferenceOutlet = geometryData.crownAuslaufWarm - geometryData.crownAuslaufKalt;
            }

            // Try to get position data for rail movement
            if (experiment.hasPositionCsv) {
                try {
                    const posMeta = await this.positionService.getPositionMetadata(experimentId);
                    
                    if (posMeta.success && posMeta.channels?.ranges?.pos_x) {
                        const posRange = posMeta.channels.ranges.pos_x;
                        geometryData.positionMin = posRange.min;
                        geometryData.positionMax = posRange.max;
                        geometryData.totalDisplacement = posRange.range;
                        
                        summary.addDataSource('position');
                    }
                } catch (error) {
                    summary.addError(`Position data error: ${error.message}`);
                }
            }

            summary.setGeometryAndPosition(geometryData);
            summary.addDataSource('geometry');

        } catch (error) {
            summary.addError(`Geometry and position computation failed: ${error.message}`);
        }
    }

    /**
     * Compute vibration analysis data
     */
    async computeVibrationAnalysis(experimentId, experiment, summary) {
        if (!experiment.hasAccelerationCsv) {
            return;
        }

        try {
            const accMeta = await this.accelerationService.getAccelerationMetadata(experimentId);
            
            if (accMeta.success && accMeta.channels?.ranges) {
                const ranges = accMeta.channels.ranges;
                
                const vibrationData = {
                    duration: accMeta.duration,
                    samplingRate: accMeta.accelerationInfo?.samplingInfo?.detectedFormat?.samplingRate
                };

                // Extract axis-specific data
                if (ranges.acc_x) {
                    vibrationData.maxAccX = Math.max(Math.abs(ranges.acc_x.min), Math.abs(ranges.acc_x.max));
                    vibrationData.rmsX = ranges.acc_x.rms;
                }
                if (ranges.acc_y) {
                    vibrationData.maxAccY = Math.max(Math.abs(ranges.acc_y.min), Math.abs(ranges.acc_y.max));
                    vibrationData.rmsY = ranges.acc_y.rms;
                }
                if (ranges.acc_z) {
                    vibrationData.maxAccZ = Math.max(Math.abs(ranges.acc_z.min), Math.abs(ranges.acc_z.max));
                    vibrationData.rmsZ = ranges.acc_z.rms;
                }

                // Peak acceleration (magnitude)
                if (ranges.acc_magnitude) {
                    vibrationData.peakAcceleration = ranges.acc_magnitude.max;
                    vibrationData.rmsMagnitude = ranges.acc_magnitude.rms;
                } else {
                    // Calculate from individual axes
                    const maxValues = [
                        vibrationData.maxAccX || 0,
                        vibrationData.maxAccY || 0,
                        vibrationData.maxAccZ || 0
                    ];
                    vibrationData.peakAcceleration = Math.sqrt(
                        maxValues.reduce((sum, val) => sum + val * val, 0)
                    );
                }

                summary.setVibrationAnalysis(vibrationData);
                summary.addDataSource('acceleration');
            }

        } catch (error) {
            summary.addError(`Vibration analysis computation failed: ${error.message}`);
        }
    }

    /**
     * Compute file availability summary
     */
    async computeFileAvailability(experiment, summary) {
        try {
            summary.setFileAvailability(experiment);
            summary.addDataSource('files');
        } catch (error) {
            summary.addError(`File availability computation failed: ${error.message}`);
        }
    }

    // === BULK OPERATIONS ===

    /**
     * Compute summaries for multiple experiments
     * @param {string[]} experimentIds 
     * @returns {Promise<ExperimentSummary[]>}
     */
    async computeMultipleSummaries(experimentIds) {
        const summaries = [];
        
        for (const experimentId of experimentIds) {
            try {
                const summary = await this.computeExperimentSummary(experimentId);
                summaries.push(summary);
            } catch (error) {
                console.error(`Failed to compute summary for ${experimentId}:`, error);
                summaries.push(new ExperimentSummary({
                    experimentId: experimentId,
                    computationStatus: 'failed',
                    errors: [error.message]
                }));
            }
        }
        
        return summaries;
    }

    /**
     * Refresh all summaries (clear cache and recompute)
     * @returns {Promise<number>} Number of summaries refreshed
     */
    async refreshAllSummaries() {
        console.log('Refreshing all summary cache...');
        
        this.clearAllCache();
        
        // Get all experiments with journals (only these have meaningful summaries)
        const experiments = await this.experimentRepository.getExperimentsWithJournalsAsync();
        
        let refreshedCount = 0;
        for (const experiment of experiments) {
            try {
                await this.computeExperimentSummary(experiment.id);
                refreshedCount++;
            } catch (error) {
                console.error(`Failed to refresh summary for ${experiment.id}:`, error);
            }
        }
        
        console.log(`Refreshed ${refreshedCount} summaries`);
        return refreshedCount;
    }

    // === CACHE MANAGEMENT ===

    /**
     * Get cached summary if available and not expired
     */
    getCachedSummary(experimentId) {
        const cached = this.summaryCache.get(experimentId);
        if (!cached) return null;
        
        const isExpired = Date.now() - cached.cachedAt > this.cacheTimeout;
        if (isExpired) {
            this.summaryCache.delete(experimentId);
            return null;
        }
        
        return cached.summary;
    }

    /**
     * Cache computed summary
     */
    cacheSummary(experimentId, summary) {
        this.summaryCache.set(experimentId, {
            summary: summary,
            cachedAt: Date.now()
        });
    }

    /**
     * Clear cache for specific experiment
     */
    clearSummaryCache(experimentId) {
        this.summaryCache.delete(experimentId);
    }

    /**
     * Clear all cached summaries
     */
    clearAllCache() {
        this.summaryCache.clear();
        console.log('All summary cache cleared');
    }

    /**
     * Get cache status
     */
    getCacheStatus() {
        const now = Date.now();
        let validEntries = 0;
        let expiredEntries = 0;
        
        for (const [experimentId, cached] of this.summaryCache.entries()) {
            const isExpired = now - cached.cachedAt > this.cacheTimeout;
            if (isExpired) {
                expiredEntries++;
            } else {
                validEntries++;
            }
        }
        
        return {
            totalCachedSummaries: this.summaryCache.size,
            validEntries: validEntries,
            expiredEntries: expiredEntries,
            cacheTimeoutMs: this.cacheTimeout,
            hitRate: validEntries / Math.max(this.summaryCache.size, 1)
        };
    }

    // === UTILITY METHODS ===

    /**
     * Get service health status
     */
    async getHealthStatus() {
        try {
            const cacheStatus = this.getCacheStatus();
            
            return {
                serviceName: this.serviceName,
                status: 'healthy',
                cache: cacheStatus,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                serviceName: this.serviceName,
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = SummaryService;