/**
 * Alignment Service
 * Orchestrates timeline alignment between different data sources (binary, temperature, etc.)
 * Handles automatic offset calculation and provides unified timeline data access
 */

const BinaryParserService = require('./BinaryParserService');
const TemperatureCsvService = require('./TemperatureCsvService');
const ExperimentAlignmentRepository = require('../repositories/ExperimentAlignmentRepository');
const { createServiceResult } = require('../models/ApiResponse');

class AlignmentService {
    constructor() {
        this.serviceName = 'Alignment Service';
        this.binaryService = new BinaryParserService();
        this.temperatureService = new TemperatureCsvService();
        this.alignmentRepository = new ExperimentAlignmentRepository();
        
        // Timezone offset: .NET (UTC+0) to Unix (UTC+2) = 2 hours
        this.TIMEZONE_OFFSET_SECONDS = 2 * 60 * 60; // 2 hours in seconds
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Calculate and store alignment offsets for an experiment
     * @param {string} experimentId - Experiment ID
     * @param {boolean} forceRecalculate - Force recalculation even if alignment exists
     * @returns {Promise<Object>} Service result with alignment data
     */
    async calculateAlignment(experimentId, forceRecalculate = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Calculating alignment for experiment ${experimentId}`);
            
            // Check if alignment already exists (unless forcing recalculation)
            if (!forceRecalculate) {
                const existingAlignment = await this.alignmentRepository.getAlignmentAsync(experimentId);
                if (existingAlignment) {
                    console.log(`Using existing alignment for ${experimentId}`);
                    return createServiceResult(true, 'Alignment loaded from database', 1, 0, Date.now() - startTime, null, existingAlignment);
                }
            }

            // Step 1: Get master timeline from binary file
            const masterTimeline = await this._getMasterTimeline(experimentId);
            if (!masterTimeline.success) {
                return createServiceResult(false, `Failed to get master timeline: ${masterTimeline.error}`, 0, 0, Date.now() - startTime, [masterTimeline.error]);
            }

            // Step 2: Calculate temperature alignment offset (if temperature file exists)
            let temperatureOffset = null;
            const hasTemperature = await this.temperatureService.hasTemperatureFile(experimentId);
            
            if (hasTemperature) {
                const tempOffset = await this._calculateTemperatureAlignment(experimentId, masterTimeline.data);
                if (tempOffset.success) {
                    temperatureOffset = tempOffset.offset;
                    console.log(`Temperature alignment offset calculated: ${temperatureOffset}s`);
                } else {
                    console.warn(`Temperature alignment failed: ${tempOffset.error}`);
                }
            }

            // Step 3: Store alignment data
            const alignmentData = {
                masterTimelineStartUnix: masterTimeline.data.startUnix,
                masterTimelineDurationS: masterTimeline.data.durationS,
                temperatureAlignmentOffsetS: temperatureOffset
            };

            const saveSuccess = await this.alignmentRepository.saveAlignmentAsync(experimentId, alignmentData);
            if (!saveSuccess) {
                return createServiceResult(false, 'Failed to save alignment data', 0, 0, Date.now() - startTime, ['Database save failed']);
            }

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Alignment calculated for ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true,
                `Alignment calculated successfully${temperatureOffset !== null ? ' (with temperature)' : ''}`,
                1,
                0,
                duration,
                null,
                {
                    experimentId,
                    masterTimeline: masterTimeline.data,
                    temperatureOffset,
                    hasTemperatureAlignment: temperatureOffset !== null
                }
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to calculate alignment for ${experimentId}: ${error.message}`;
            console.error(`${this.serviceName}:`, errorMsg);
            
            return createServiceResult(false, errorMsg, 0, 0, duration, [error.toString()]);
        }
    }

    /**
     * Get aligned channel data from any source (binary or temperature)
     * @param {string} experimentId - Experiment ID
     * @param {string} channelId - Channel ID (e.g., "calc_5", "temp_welding")
     * @param {Object} options - Data retrieval options
     * @returns {Promise<Object>} Aligned channel data
     */
    async getAlignedChannelData(experimentId, channelId, options = {}) {
        try {
            const { startTime = 0, endTime = null, maxPoints = 2000 } = options;

            // Ensure alignment exists
            await this._ensureAlignment(experimentId);

            // Determine data source and get data
            const sourceType = this._getChannelSourceType(channelId);
            let channelResult;

            if (sourceType === 'binary') {
                channelResult = await this.binaryService.getChannelData(experimentId, channelId, options);
            } else if (sourceType === 'temperature') {
                channelResult = await this.temperatureService.getChannelData(experimentId, channelId, options);
            } else {
                return {
                    success: false,
                    error: `Unknown channel type: ${channelId}`
                };
            }

            if (!channelResult.success) {
                return channelResult;
            }

            // Apply alignment offset to time data
            const alignedData = await this._applyTimeAlignment(experimentId, channelResult.data, sourceType);

            return {
                success: true,
                experimentId,
                channelId,
                sourceType,
                data: alignedData,
                metadata: {
                    ...channelResult.metadata,
                    aligned: true,
                    sourceType
                }
            };

        } catch (error) {
            console.error(`Error getting aligned channel data for ${experimentId}/${channelId}:`, error);
            return {
                success: false,
                error: `Failed to get aligned channel data: ${error.message}`
            };
        }
    }

    /**
     * Get multiple aligned channels from different sources
     * @param {string} experimentId - Experiment ID
     * @param {string[]} channelIds - Array of channel IDs from any source
     * @param {Object} options - Data retrieval options
     * @returns {Promise<Object>} Bulk aligned channel data
     */
    async getBulkAlignedData(experimentId, channelIds, options = {}) {
        try {
            const { startTime = 0, endTime = null, maxPoints = 2000 } = options;

            // Validate inputs
            if (!Array.isArray(channelIds) || channelIds.length === 0) {
                return {
                    success: false,
                    error: 'channelIds must be a non-empty array'
                };
            }

            // Ensure alignment exists
            await this._ensureAlignment(experimentId);

            // Group channels by source type
            const channelsBySource = this._groupChannelsBySource(channelIds);

            // Fetch data from each source in parallel
            const promises = [];
            const results = {};

            // Binary channels
            if (channelsBySource.binary.length > 0) {
                promises.push(
                    this.binaryService.getBulkChannelData(experimentId, channelsBySource.binary, options)
                        .then(result => ({ sourceType: 'binary', result }))
                );
            }

            // Temperature channels
            if (channelsBySource.temperature.length > 0) {
                promises.push(
                    this.temperatureService.getBulkChannelData(experimentId, channelsBySource.temperature, options)
                        .then(result => ({ sourceType: 'temperature', result }))
                );
            }

            // Wait for all data fetching to complete
            const sourceResults = await Promise.all(promises);

            // Process results and apply alignment
            for (const { sourceType, result } of sourceResults) {
                if (result.success && result.channels) {
                    for (const [channelId, channelData] of Object.entries(result.channels)) {
                        if (channelData.success) {
                            // Apply alignment offset
                            const alignedData = await this._applyTimeAlignment(experimentId, channelData.data, sourceType);
                            
                            results[channelId] = {
                                success: true,
                                data: alignedData,
                                metadata: {
                                    ...channelData.metadata,
                                    aligned: true,
                                    sourceType
                                }
                            };
                        } else {
                            results[channelId] = channelData; // Pass through error
                        }
                    }
                }
            }

            return {
                success: true,
                experimentId,
                requestedChannels: channelIds.length,
                successfulChannels: Object.values(results).filter(r => r.success).length,
                requestOptions: { startTime, endTime, maxPoints },
                channels: results,
                aligned: true
            };

        } catch (error) {
            console.error(`Error getting bulk aligned data for ${experimentId}:`, error);
            return {
                success: false,
                error: `Failed to get bulk aligned data: ${error.message}`
            };
        }
    }

    /**
     * Get alignment metadata for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Alignment metadata
     */
    async getAlignmentMetadata(experimentId) {
        try {
            // Ensure alignment exists
            await this._ensureAlignment(experimentId);

            // Get stored alignment data
            const alignmentData = await this.alignmentRepository.getAlignmentAsync(experimentId);
            if (!alignmentData) {
                return {
                    success: false,
                    error: 'No alignment data found'
                };
            }

            // Get available channels from each source
            const availableChannels = await this._getAvailableAlignedChannels(experimentId);

            return {
                success: true,
                experimentId,
                masterTimeline: {
                    startUnix: alignmentData.master_timeline_start_unix,
                    durationS: alignmentData.master_timeline_duration_s,
                    endUnix: alignmentData.master_timeline_start_unix + alignmentData.master_timeline_duration_s
                },
                alignmentOffsets: {
                    temperature: alignmentData.temperature_alignment_offset_s,
                    acceleration: alignmentData.acceleration_alignment_offset_s,
                    position: alignmentData.position_alignment_offset_s
                },
                manualOverrides: {
                    temperature: alignmentData.temperature_manual_override,
                    acceleration: alignmentData.acceleration_manual_override,
                    position: alignmentData.position_manual_override
                },
                availableChannels,
                calculatedAt: alignmentData.calculated_at,
                updatedAt: alignmentData.updated_at
            };

        } catch (error) {
            console.error(`Error getting alignment metadata for ${experimentId}:`, error);
            return {
                success: false,
                error: `Failed to get alignment metadata: ${error.message}`
            };
        }
    }

    // === PRIVATE HELPER METHODS ===

    /**
     * Get master timeline from binary file
     * @private
     */
    async _getMasterTimeline(experimentId) {
        try {
            // Parse binary file to get metadata
            const parseResult = await this.binaryService.parseExperimentBinaryFile(experimentId);
            if (!parseResult.success) {
                return { success: false, error: parseResult.message };
            }

            // Get metadata including timeline info
            const metadataResult = await this.binaryService.getBinaryMetadata(experimentId);
            if (!metadataResult.success) {
                return { success: false, error: metadataResult.message };
            }

            // Extract .NET timestamp and convert to Unix
            const rawMetadata = metadataResult.rawMetadata;
            if (!rawMetadata.startTime) {
                return { success: false, error: 'No start time found in binary file' };
            }

            // Convert .NET DateTime to Unix timestamp (with timezone offset)
            let startUnix;
            if (rawMetadata.startTime instanceof Date) {
                startUnix = rawMetadata.startTime.getTime() / 1000; // Convert to Unix seconds
            } else {
                return { success: false, error: 'Invalid start time format in binary file' };
            }

            // Apply timezone offset (.NET UTC+0 to local UTC+2)
            startUnix += this.TIMEZONE_OFFSET_SECONDS;

            return {
                success: true,
                data: {
                    startUnix,
                    durationS: metadataResult.duration,
                    endUnix: startUnix + metadataResult.duration
                }
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Calculate temperature alignment offset
     * @private
     */
    async _calculateTemperatureAlignment(experimentId, masterTimeline) {
        try {
            // Get temperature metadata
            const tempMetadata = await this.temperatureService.getTemperatureMetadata(experimentId);
            if (!tempMetadata.success) {
                return { success: false, error: tempMetadata.error };
            }

            const tempTimeRange = tempMetadata.timeRange;
            
            // Temperature CSV uses relative time (starts at 0)
            // We need to align it to the master timeline start
            // Offset = master_start - temperature_relative_start (which is 0)
            const offset = 0; // Temperature data already starts at 0, binary also starts at 0
            
            console.log(`Temperature time range: ${tempTimeRange.min}s to ${tempTimeRange.max}s`);
            console.log(`Master timeline: ${masterTimeline.startUnix} (Unix) for ${masterTimeline.durationS}s`);
            
            return {
                success: true,
                offset: offset
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Ensure alignment exists for experiment (calculate if needed)
     * @private
     */
    async _ensureAlignment(experimentId) {
        const hasAlignment = await this.alignmentRepository.hasAlignmentAsync(experimentId);
        if (!hasAlignment) {
            console.log(`No alignment found for ${experimentId}, calculating...`);
            const result = await this.calculateAlignment(experimentId);
            if (!result.success) {
                throw new Error(`Failed to calculate alignment: ${result.message}`);
            }
        }
    }

    /**
     * Determine source type for a channel ID
     * @private
     */
    _getChannelSourceType(channelId) {
        if (channelId.startsWith('calc_') || channelId.startsWith('channel_') || /^[0-7]$/.test(channelId)) {
            return 'binary';
        } else if (channelId.startsWith('temp_')) {
            return 'temperature';
        } else {
            return 'unknown';
        }
    }

    /**
     * Group channel IDs by their source type
     * @private
     */
    _groupChannelsBySource(channelIds) {
        const groups = {
            binary: [],
            temperature: [],
            unknown: []
        };

        for (const channelId of channelIds) {
            const sourceType = this._getChannelSourceType(channelId);
            groups[sourceType].push(channelId);
        }

        return groups;
    }

    /**
     * Apply time alignment offset to data
     * @private
     */
    async _applyTimeAlignment(experimentId, data, sourceType) {
        // Get alignment data
        const alignmentData = await this.alignmentRepository.getAlignmentAsync(experimentId);
        if (!alignmentData) {
            return data; // No alignment available, return as-is
        }

        // Determine offset based on source type
        let offset = 0;
        if (sourceType === 'temperature' && alignmentData.temperature_alignment_offset_s !== null) {
            offset = alignmentData.temperature_alignment_offset_s;
        }
        // Add more source types here as needed

        // Apply offset to time array (if offset is not zero)
        if (offset !== 0 && data.time && Array.isArray(data.time)) {
            const alignedTime = data.time.map(t => t + offset);
            return {
                time: alignedTime,
                values: data.values
            };
        }

        return data; // Return original data if no offset needed
    }

    /**
     * Get available channels from all aligned sources
     * @private
     */
    async _getAvailableAlignedChannels(experimentId) {
        const channels = {
            binary: [],
            temperature: []
        };

        // Get binary channels if available
        const hasBinary = await this.binaryService.hasBinaryFile(experimentId);
        if (hasBinary) {
            try {
                const binaryMetadata = await this.binaryService.getBinaryMetadata(experimentId);
                if (binaryMetadata.success) {
                    channels.binary = [
                        ...binaryMetadata.channels.available.raw,
                        ...binaryMetadata.channels.available.calculated
                    ];
                }
            } catch (error) {
                console.warn(`Could not get binary channels for ${experimentId}:`, error.message);
            }
        }

        // Get temperature channels if available
        const hasTemperature = await this.temperatureService.hasTemperatureFile(experimentId);
        if (hasTemperature) {
            try {
                const tempMetadata = await this.temperatureService.getTemperatureMetadata(experimentId);
                if (tempMetadata.success) {
                    channels.temperature = tempMetadata.channels.available.temperature;
                }
            } catch (error) {
                console.warn(`Could not get temperature channels for ${experimentId}:`, error.message);
            }
        }

        return channels;
    }

    /**
     * Get service status and statistics
     */
    getServiceStatus() {
        return {
            serviceName: this.serviceName,
            status: 'active',
            timezoneOffset: this.TIMEZONE_OFFSET_SECONDS,
            capabilities: {
                supportedSources: ['binary', 'temperature'],
                automaticAlignment: ['binary', 'temperature'],
                manualAlignment: ['acceleration', 'position'],
                alignmentPersistence: true
            }
        };
    }
}

module.exports = AlignmentService;