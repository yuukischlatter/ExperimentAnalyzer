/**
 * Summary Service - DATABASE-BACKED with ORIGINAL METHOD NAMES
 * Computes experiment summary data with database storage for instant API responses
 * File: backend/services/SummaryService.js
 * COMPATIBLE: Uses original method names for backward compatibility with existing routes
 */

const ExperimentSummary = require('../models/ExperimentSummary');
const ExperimentRepository = require('../repositories/ExperimentRepository');
const ExperimentSummaryRepository = require('../repositories/ExperimentSummaryRepository');
const BinaryParserService = require('./BinaryParserService');
const TemperatureCsvService = require('./TemperatureCsvService');
const PositionCsvService = require('./PositionCsvService');
const AccelerationCsvService = require('./AccelerationCsvService');
const TensileCsvService = require('./TensileCsvService');
const CrownService = require('./CrownService');

class SummaryService {
    constructor() {
        this.serviceName = 'Summary Service (Database-Backed)';
        
        // Initialize repositories
        this.experimentRepository = new ExperimentRepository();
        this.summaryRepository = new ExperimentSummaryRepository();
        
        // Initialize data services (used for computation only)
        this.binaryService = new BinaryParserService();
        this.temperatureService = new TemperatureCsvService();
        this.positionService = new PositionCsvService();
        this.accelerationService = new AccelerationCsvService();
        this.tensileService = new TensileCsvService();
        this.crownService = new CrownService();
        
        // Background computation queue (in-memory for now, could be Redis/Bull later)
        this.computationQueue = new Set();
        this.isProcessingQueue = false;
    }

    // === MAIN API METHODS (Database-First with Original Names) ===

    /**
     * Compute experiment summary with database-first lookup
     * ORIGINAL METHOD NAME - API COMPATIBLE
     * API FLOW: Check DB → Return immediately if complete → Trigger background if needed
     * @param {string} experimentId 
     * @returns {Promise<ExperimentSummary>} ExperimentSummary object (for API compatibility)
     */
    async computeExperimentSummary(experimentId) {
        console.log(`Computing summary for ${experimentId} (database-first)`);
        
        try {
            // STEP 1: Check database first for complete summary
            const cachedSummary = await this.summaryRepository.getSummaryAsync(experimentId);
            if (cachedSummary) {
                console.log(`✓ Returning cached complete summary for ${experimentId} (~50ms)`);
                return this._reconstructExperimentSummary(cachedSummary);
            }
            
            // STEP 2: Check if partial/failed summary exists
            const status = await this.summaryRepository.getSummaryStatusAsync(experimentId);
            if (status.exists && status.status !== 'complete') {
                console.log(`⚠ Found ${status.status} summary for ${experimentId}, triggering background refresh`);
                this._triggerBackgroundComputation(experimentId);
                
                // Return partial summary if available
                const partialSummary = await this.summaryRepository.getSummaryAsync(experimentId);
                if (partialSummary) {
                    return this._reconstructExperimentSummary(partialSummary);
                }
            }
            
            // STEP 3: No complete summary found - compute synchronously (original behavior)
            console.log(`🔄 No complete summary found, computing synchronously for ${experimentId}`);
            return await this._computeAndStoreSummary(experimentId, false);
            
        } catch (error) {
            console.error(`Error computing summary for ${experimentId}:`, error);
            
            // Try to return any existing summary as fallback
            try {
                const fallbackSummary = await this.summaryRepository.getSummaryAsync(experimentId);
                if (fallbackSummary) {
                    return this._reconstructExperimentSummary(fallbackSummary);
                }
            } catch (fallbackError) {
                console.error(`Fallback summary retrieval failed:`, fallbackError);
            }
            
            // Return error summary as last resort
            const errorSummary = new ExperimentSummary({ 
                experimentId: experimentId,
                computationStatus: 'failed'
            });
            errorSummary.addError(`Summary computation failed: ${error.message}`);
            return errorSummary;
        }
    }

    /**
     * Compute multiple summaries efficiently (database-first)
     * ORIGINAL METHOD NAME - API COMPATIBLE
     * @param {string[]} experimentIds 
     * @returns {Promise<ExperimentSummary[]>} Array of ExperimentSummary objects
     */
    async computeMultipleSummaries(experimentIds) {
        console.log(`Computing multiple summaries for ${experimentIds.length} experiments (database-first)`);
        
        try {
            // Get all cached summaries from database
            const cachedSummaries = await this.summaryRepository.getMultipleSummariesAsync(experimentIds);
            const cachedIds = new Set(cachedSummaries.map(s => s.experiment_id));
            
            // Find experiments that need computation
            const missingIds = experimentIds.filter(id => !cachedIds.has(id));
            
            // Trigger background computation for missing summaries
            missingIds.forEach(id => this._triggerBackgroundComputation(id));
            
            // Reconstruct cached summaries
            const results = [];
            
            for (const experimentId of experimentIds) {
                const cachedSummary = cachedSummaries.find(s => s.experiment_id === experimentId);
                
                if (cachedSummary) {
                    results.push(this._reconstructExperimentSummary(cachedSummary));
                } else {
                    // Return placeholder summary for missing ones
                    const placeholder = new ExperimentSummary({ 
                        experimentId: experimentId,
                        computationStatus: 'computing'
                    });
                    placeholder.addError('Summary is being computed in the background');
                    results.push(placeholder);
                }
            }
            
            console.log(`✓ Returned ${results.length} summaries (${cachedSummaries.length} cached, ${missingIds.length} computing)`);
            return results;
            
        } catch (error) {
            console.error('Error computing multiple summaries:', error);
            // Return error summaries for all on error
            return experimentIds.map(id => {
                const errorSummary = new ExperimentSummary({ 
                    experimentId: id,
                    computationStatus: 'failed'
                });
                errorSummary.addError(error.message);
                return errorSummary;
            });
        }
    }

    /**
     * Clear summary cache for specific experiment
     * ORIGINAL METHOD NAME - API COMPATIBLE
     * @param {string} experimentId 
     */
    clearSummaryCache(experimentId) {
        console.log(`Clearing summary cache for ${experimentId}`);
        // Clear from database (async, but don't wait)
        this.summaryRepository.deleteSummaryAsync(experimentId).catch(error => {
            console.error(`Error clearing summary cache for ${experimentId}:`, error);
        });
    }

    /**
     * Clear all summary cache
     * ORIGINAL METHOD NAME - API COMPATIBLE
     */
    clearAllCache() {
        console.log('Clearing all summary cache...');
        // Clear from database (async, but don't wait)
        this.summaryRepository.clearAllSummariesAsync().catch(error => {
            console.error('Error clearing all summary cache:', error);
        });
    }

    /**
     * Get cache status
     * ORIGINAL METHOD NAME - API COMPATIBLE
     */
    getCacheStatus() {
        return {
            totalCachedSummaries: 0, // Will be populated by database stats
            validEntries: 0,
            expiredEntries: 0,
            cacheTimeoutMs: 0, // Database entries don't expire
            hitRate: 1.0
        };
    }

    /**
     * Refresh all summaries (queue all for background computation)
     * ENHANCED: Now uses database to find experiments needing computation
     */
    async refreshAllSummaries() {
        console.log('Triggering refresh for all experiment summaries...');
        
        try {
            // Get all experiments that need summaries
            const experimentIds = await this.summaryRepository.getExperimentsNeedingComputationAsync();
            
            // Add all to computation queue
            experimentIds.forEach(id => this._triggerBackgroundComputation(id));
            
            console.log(`Queued ${experimentIds.length} experiments for summary computation`);
            return experimentIds.length;
        } catch (error) {
            console.error('Error refreshing all summaries:', error);
            return 0;
        }
    }

    // === BACKGROUND COMPUTATION SYSTEM ===

    /**
     * Trigger background computation for experiment
     * @param {string} experimentId 
     */
    _triggerBackgroundComputation(experimentId) {
        this.computationQueue.add(experimentId);
        
        // Process queue if not already processing
        if (!this.isProcessingQueue) {
            setImmediate(() => this._processComputationQueue());
        }
    }

    /**
     * Process background computation queue
     */
    async _processComputationQueue() {
        if (this.isProcessingQueue || this.computationQueue.size === 0) {
            return;
        }
        
        this.isProcessingQueue = true;
        console.log(`📋 Processing computation queue: ${this.computationQueue.size} experiments`);
        
        try {
            // Process experiments one by one (could be parallelized later)
            for (const experimentId of this.computationQueue) {
                try {
                    console.log(`🔄 Background computing summary for ${experimentId}`);
                    await this._computeAndStoreSummary(experimentId, true); // true = background mode
                    this.computationQueue.delete(experimentId);
                } catch (error) {
                    console.error(`Background computation failed for ${experimentId}:`, error);
                    
                    // Store failed status
                    try {
                        await this.summaryRepository.updateStatusAsync(experimentId, 'failed', [error.message]);
                        this.computationQueue.delete(experimentId);
                    } catch (statusError) {
                        console.error(`Failed to update status for ${experimentId}:`, statusError);
                        // Keep in queue for retry
                    }
                }
                
                // Small delay to prevent overwhelming the system
                await this._delay(100);
            }
            
        } finally {
            this.isProcessingQueue = false;
            
            // Schedule next processing if queue has items
            if (this.computationQueue.size > 0) {
                setTimeout(() => this._processComputationQueue(), 1000);
            }
        }
    }

    // === CORE COMPUTATION LOGIC ===

    /**
     * Compute summary and store in database
     * @param {string} experimentId 
     * @param {boolean} backgroundMode - If true, suppress detailed logging
     * @returns {Promise<ExperimentSummary>} ExperimentSummary object
     */
    async _computeAndStoreSummary(experimentId, backgroundMode = false) {
        const logPrefix = backgroundMode ? '🔄 BG:' : '🔄';
        
        if (!backgroundMode) {
            console.log(`${logPrefix} Computing summary for experiment: ${experimentId}`);
        }
        
        try {
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

            // Compute all sections in parallel (same as original)
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

            // STORE IN DATABASE (NEW: This is the key difference)
            await this.summaryRepository.storeSummaryAsync(experimentId, summary);
            
            if (!backgroundMode) {
                console.log(`✓ Summary computed and stored for ${experimentId}: ${summary.computationStatus} (${summary.dataSourcesUsed.length} sources)`);
            }
            
            // Return ExperimentSummary object (API compatible)
            return summary;

        } catch (error) {
            console.error(`${logPrefix} Failed to compute summary for ${experimentId}:`, error);
            
            // Store failed status in database
            try {
                await this.summaryRepository.updateStatusAsync(experimentId, 'failed', [error.message]);
            } catch (statusError) {
                console.error(`Failed to update status for ${experimentId}:`, statusError);
            }
            
            throw error;
        }
    }

    // === DATA RECONSTRUCTION METHODS ===

    /**
     * Reconstruct ExperimentSummary object from database row
     * Converts flat database columns back to ExperimentSummary format
     * @param {Object} dbRow - Raw database row from experiment_summaries
     * @returns {ExperimentSummary} Reconstructed ExperimentSummary object
     */
    _reconstructExperimentSummary(dbRow) {
        const summary = new ExperimentSummary({
            experimentId: dbRow.experiment_id,
            computedAt: dbRow.computed_at,
            dataSourcesUsed: this._parseJsonSafe(dbRow.data_sources_used, []),
            computationStatus: dbRow.computation_status,
            errors: this._parseJsonSafe(dbRow.errors_json, [])
        });

        // Reconstruct welding performance
        summary.weldingPerformance = {
            program: dbRow.program,
            programNumber: dbRow.program_number,
            programName: dbRow.program_name,
            material: dbRow.material,
            shape: dbRow.shape,
            operator: dbRow.operator,
            peakForce: this._formatMetric(dbRow.peak_force_kn, 'kN', 1),
            peakCurrentGR1: this._formatMetric(dbRow.peak_current_gr1_a, 'A', 0),
            peakCurrentGR2: this._formatMetric(dbRow.peak_current_gr2_a, 'A', 0),
            maxVoltage: this._formatMetric(dbRow.max_voltage_v, 'V', 1),
            maxPressure: this._formatMetric(dbRow.max_pressure_bar, 'Bar', 1),
            duration: this._formatDuration(dbRow.welding_duration_s),
            oilTemperature: this._formatMetric(dbRow.oil_temperature_c, '°C', 1)
        };

        // Reconstruct tensile results
        summary.tensileResults = {
            peakForce: this._formatMetric(dbRow.tensile_peak_force_kn, 'kN', 0),
            targetForce: this._formatMetric(dbRow.tensile_target_force_kn, 'kN', 0),
            minForceLimit: this._formatMetric(dbRow.tensile_min_force_limit_kn, 'kN', 0),
            result: dbRow.tensile_result,
            maxDisplacement: this._formatMetric(dbRow.tensile_max_displacement_mm, 'mm', 1),
            materialGrade: dbRow.tensile_material_grade,
            testDate: dbRow.tensile_test_date,
            marginPercent: dbRow.tensile_margin_percent
        };

        // Reconstruct temperature monitoring
        summary.temperatureMonitoring = {
            weldingTempRange: {
                min: this._formatMetric(dbRow.welding_temp_min_c, '°C', 1),
                max: this._formatMetric(dbRow.welding_temp_max_c, '°C', 1),
                range: this._formatMetric(dbRow.welding_temp_range_c, '°C', 1)
            },
            ambientTempRange: {
                min: this._formatMetric(dbRow.ambient_temp_min_c, '°C', 1),
                max: this._formatMetric(dbRow.ambient_temp_max_c, '°C', 1),
                range: this._formatMetric(dbRow.ambient_temp_range_c, '°C', 1)
            },
            duration: this._formatDuration(dbRow.temperature_duration_s),
            channels: this._parseJsonSafe(dbRow.temperature_channels_json, [])
        };

        // Reconstruct geometry and position
        summary.geometryAndPosition = {
            crownMeasurements: {
                warm: {
                    inlet: this._formatMetric(dbRow.crown_inlet_warm_mm, 'mm', 1),
                    outlet: this._formatMetric(dbRow.crown_outlet_warm_mm, 'mm', 1)
                },
                cold: {
                    inlet: this._formatMetric(dbRow.crown_inlet_cold_mm, 'mm', 1),
                    outlet: this._formatMetric(dbRow.crown_outlet_cold_mm, 'mm', 1)
                },
                differences: {
                    inlet: this._formatMetric(dbRow.crown_difference_inlet_mm, 'mm', 2),
                    outlet: this._formatMetric(dbRow.crown_difference_outlet_mm, 'mm', 2)
                },
                measurementInterval: this._formatMetric(dbRow.crown_measurement_interval_min, 'min', 0)
            },
            railMovement: {
                totalDisplacement: this._formatMetric(dbRow.total_displacement_mm, 'mm', 1),
                positionRange: {
                    min: this._formatMetric(dbRow.position_min_mm, 'mm', 2),
                    max: this._formatMetric(dbRow.position_max_mm, 'mm', 2)
                }
            },
            railInfo: {
                einlaufseite: dbRow.rail_einlaufseite,
                auslaufseite: dbRow.rail_auslaufseite
            }
        };

        // Reconstruct vibration analysis
        summary.vibrationAnalysis = {
            peakAcceleration: this._formatMetric(dbRow.peak_acceleration_ms2, 'm/s²', 1),
            axisBreakdown: {
                x: this._formatMetric(dbRow.max_acc_x_ms2, 'm/s²', 1),
                y: this._formatMetric(dbRow.max_acc_y_ms2, 'm/s²', 1),
                z: this._formatMetric(dbRow.max_acc_z_ms2, 'm/s²', 1)
            },
            rmsValues: {
                x: this._formatMetric(dbRow.rms_x_ms2, 'm/s²', 2),
                y: this._formatMetric(dbRow.rms_y_ms2, 'm/s²', 2),
                z: this._formatMetric(dbRow.rms_z_ms2, 'm/s²', 2),
                magnitude: this._formatMetric(dbRow.rms_magnitude_ms2, 'm/s²', 2)
            },
            duration: this._formatDuration(dbRow.vibration_duration_s),
            samplingRate: this._formatMetric(dbRow.vibration_sampling_rate_hz, 'Hz', 0)
        };

        // Reconstruct file availability
        summary.fileAvailability = {
            available: this._parseJsonSafe(dbRow.available_files_json, []),
            missing: this._parseJsonSafe(dbRow.missing_files_json, []),
            totalFiles: dbRow.total_files,
            availableCount: dbRow.available_count,
            missingCount: dbRow.missing_count,
            completeness: dbRow.file_completeness_percent,
            criticalFilesComplete: Boolean(dbRow.critical_files_complete),
            criticalFilesCount: dbRow.critical_files_count
        };

        return summary;
    }

    // === COMPUTATION METHODS (Unchanged from original SummaryService.js) ===
    
    /**
     * Compute welding performance metrics
     * [EXACT SAME as original - no changes needed]
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
     * [EXACT SAME as original - no changes needed]
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
     * [EXACT SAME as original - no changes needed]
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
     * Compute geometry and position data with Crown Service integration
     * [EXACT SAME as original - no changes needed]
     */
    async computeGeometryAndPosition(experimentId, experiment, metadata, summary) {
        try {
            const geometryData = {
                // Crown measurements from journal metadata (warm values only)
                crownEinlaufWarm: metadata?.crownEinlaufWarm,
                crownAuslaufWarm: metadata?.crownAuslaufWarm,
                crownEinlaufKalt: metadata?.crownEinlaufKalt,
                crownAuslaufKalt: metadata?.crownAuslaufKalt,
                crownMeasurementInterval: metadata?.crownMeasurementInterval,
                
                // Rail information
                einlaufseite: metadata?.einlaufseite,
                auslaufseite: metadata?.auslaufseite
            };

            // Try to get Crown Service data for complete warm/cold comparison
            if (experiment.hasCrownMeasurements) {
                try {
                    const crownMetadata = await this.crownService.getCrownMetadata(experimentId);
                    
                    if (crownMetadata.success && crownMetadata.comparison) {
                        const comparison = crownMetadata.comparison;
                        
                        // Use Crown Service data which has both warm and cold values
                        geometryData.crownEinlaufWarm = comparison.inlet.warm;
                        geometryData.crownAuslaufWarm = comparison.outlet.warm;
                        geometryData.crownEinlaufKalt = comparison.inlet.cold;
                        geometryData.crownAuslaufKalt = comparison.outlet.cold;
                        
                        // Calculate differences using Crown Service data
                        geometryData.crownDifferenceInlet = comparison.inlet.difference;
                        geometryData.crownDifferenceOutlet = comparison.outlet.difference;
                        
                        summary.addDataSource('crown');
                    }
                } catch (error) {
                    summary.addError(`Crown measurement integration error: ${error.message}`);
                }
            }

            // Calculate crown differences if both warm and cold are available (fallback logic)
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
     * [EXACT SAME as original - no changes needed]
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
     * [EXACT SAME as original - no changes needed]
     */
    async computeFileAvailability(experiment, summary) {
        try {
            summary.setFileAvailability(experiment);
            summary.addDataSource('files');
        } catch (error) {
            summary.addError(`File availability computation failed: ${error.message}`);
        }
    }

    // === UTILITY METHODS ===

    /**
     * Format metric value with unit and precision (same as ExperimentSummary)
     */
    _formatMetric(value, unit, precision = 1) {
        if (value == null || isNaN(value)) {
            return { value: null, display: 'N/A', unit: unit };
        }

        const numValue = parseFloat(value);
        const displayValue = precision === 0 ? 
            Math.round(numValue).toLocaleString() : 
            numValue.toFixed(precision);

        return {
            value: numValue,
            display: displayValue,
            unit: unit,
            formatted: `${displayValue} ${unit}`
        };
    }

    /**
     * Format duration (seconds to readable format)
     */
    _formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) {
            return { value: null, display: 'N/A' };
        }

        const sec = Math.round(seconds);
        const min = Math.floor(sec / 60);
        const remainingSec = sec % 60;

        let display;
        if (min === 0) {
            display = `${remainingSec}s`;
        } else {
            display = `${min}:${String(remainingSec).padStart(2, '0')}`;
        }

        return {
            value: seconds,
            display: display,
            totalSeconds: sec,
            minutes: min,
            seconds: remainingSec
        };
    }

    /**
     * Safely parse JSON string
     */
    _parseJsonSafe(jsonString, defaultValue = null) {
        if (!jsonString) return defaultValue;
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            return defaultValue;
        }
    }

    /**
     * Simple delay utility
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // === HEALTH AND STATUS METHODS ===

    /**
     * Get service health status with database statistics
     */
    async getHealthStatus() {
        try {
            const stats = await this.summaryRepository.getSummaryStatsAsync();
            const queueSize = this.computationQueue.size;
            
            return {
                serviceName: this.serviceName,
                status: 'healthy',
                database: {
                    totalSummaries: stats?.total_summaries || 0,
                    completeSummaries: stats?.complete_summaries || 0,
                    partialSummaries: stats?.partial_summaries || 0,
                    failedSummaries: stats?.failed_summaries || 0,
                    summariesWithErrors: stats?.summaries_with_errors || 0,
                    latestComputation: stats?.latest_computation,
                    avgFileCompleteness: Math.round(stats?.avg_file_completeness || 0)
                },
                backgroundQueue: {
                    queueSize: queueSize,
                    isProcessing: this.isProcessingQueue
                },
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