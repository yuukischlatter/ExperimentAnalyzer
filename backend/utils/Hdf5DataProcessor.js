/**
 * HDF5 Data Processor
 * Handles data resampling, analysis, and API formatting for HDF5 oscilloscope data
 * Uses progressive reader's smart dataset selection and leverages HDF5's built-in decimation
 */

class Hdf5DataProcessor {
    constructor(progressiveReader, metadata) {
        this.progressiveReader = progressiveReader;
        this.metadata = metadata;
        
        // Cache for commonly requested data ranges
        this.resamplingCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        
        // Pre-calculate commonly used values
        this.timeRange = this._calculateTimeRange();
        this.dataRanges = new Map(); // Calculated on-demand for HDF5
        
        console.log('Hdf5DataProcessor initialized with progressive reader integration');
    }

    /**
     * Get resampled data for a channel using HDF5's smart dataset selection
     * @param {string} channelId - Channel ID (backend format: "hdf5_Ch1")
     * @param {number} startTime - Start time in seconds
     * @param {number} endTime - End time in seconds  
     * @param {number} maxPoints - Maximum points to return (default: 2000)
     * @returns {Object} {time: Array, values: Array}
     */
    getResampledData(channelId, startTime, endTime, maxPoints = 2000) {
        try {
            // Create cache key for this request
            const cacheKey = `${channelId}_${startTime}_${endTime}_${maxPoints}`;
            
            // Check cache first
            const cached = this._getCachedResampling(cacheKey);
            if (cached) {
                return cached;
            }

            // Convert backend channel ID to HDF5 format
            const hdf5ChannelId = this._getHdf5ChannelId(channelId);
            if (!hdf5ChannelId) {
                console.warn(`Channel ${channelId} not found`);
                return { time: [], values: [] };
            }

            // Validate and clamp time range
            const validatedRange = this.validateTimeRange(startTime, endTime);
            startTime = validatedRange.startTime;
            endTime = validatedRange.endTime;

            console.log(`Loading HDF5 data: ${hdf5ChannelId}, ${startTime}s-${endTime}s, max ${maxPoints} points`);

            // Use progressive reader's smart dataset selection and loading
            const loadResult = this.progressiveReader.loadTimeRange(
                hdf5ChannelId, 
                startTime, 
                endTime, 
                maxPoints, // Use as display width approximation
                maxPoints
            );

            // Convert to consistent format
            const result = {
                time: Array.from(loadResult.timeAxis),
                values: Array.from(loadResult.physicalValues)
            };

            // Cache the result
            this._setCachedResampling(cacheKey, result);
            
            console.log(`✅ Loaded ${result.time.length} points using ${loadResult.dataset} dataset`);
            
            return result;

        } catch (error) {
            console.error(`Error resampling HDF5 channel ${channelId}:`, error);
            return { time: [], values: [] };
        }
    }

    /**
     * Get channel data by ID (supports both HDF5 and backend format)
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel data
     */
    getChannelById(channelId) {
        try {
            const hdf5ChannelId = this._getHdf5ChannelId(channelId);
            if (!hdf5ChannelId) return null;

            // Get channel info from progressive reader
            const channelInfo = this.progressiveReader.getChannelInfo();
            const channel = channelInfo.find(ch => ch.id === hdf5ChannelId);
            
            if (!channel) return null;

            // Return in consistent format matching binary system
            return {
                time: null, // Data loaded on-demand
                values: null, // Data loaded on-demand
                label: channel.name,
                unit: channel.physicalUnit,
                channelIndex: hdf5ChannelId,
                points: 0, // Will be set when data is loaded
                samplingRate: channel.sampleRate,
                downsampling: 1, // HDF5 handles this internally
                type: 'hdf5',
                
                // HDF5-specific properties
                hdf5ChannelId: hdf5ChannelId,
                backendChannelId: channelId,
                availableDatasets: Object.keys(channel.datasets || {}),
                totalDuration: channel.totalDuration,
                conversion: channel.conversion
            };

        } catch (error) {
            console.error(`Error getting channel ${channelId}:`, error);
            return null;
        }
    }

    /**
     * Get all available channels organized by type
     * @returns {Object} Available channels
     */
    getAllAvailableChannels() {
        try {
            const channelInfo = this.progressiveReader.getChannelInfo();
            
            const available = {
                raw: [], // Empty for HDF5
                calculated: [], // HDF5 channels are physical/calculated
                hdf5: [] // HDF5-specific grouping
            };
            
            for (const channel of channelInfo) {
                const channelData = {
                    id: `hdf5_${channel.id}`,
                    hdf5Id: channel.id,
                    label: channel.name,
                    unit: channel.physicalUnit,
                    points: 0, // Calculated on-demand
                    samplingRate: channel.sampleRate,
                    totalDuration: channel.totalDuration,
                    availableDatasets: Object.keys(channel.datasets || {}),
                    type: 'hdf5'
                };
                
                // Add to calculated and hdf5 arrays
                available.calculated.push(channelData);
                available.hdf5.push(channelData);
            }
            
            return available;

        } catch (error) {
            console.error('Error getting available channels:', error);
            return { raw: [], calculated: [], hdf5: [] };
        }
    }

    /**
     * Get channels grouped by unit type for Y-axis assignment
     * @returns {Object} Channels grouped by unit
     */
    getChannelsByUnit() {
        try {
            const byUnit = {};
            const channelInfo = this.progressiveReader.getChannelInfo();
            
            for (const channel of channelInfo) {
                const unit = channel.physicalUnit || 'Unknown';
                
                if (!byUnit[unit]) byUnit[unit] = [];
                byUnit[unit].push({
                    id: `hdf5_${channel.id}`,
                    hdf5Id: channel.id,
                    label: channel.name,
                    type: 'hdf5',
                    availableDatasets: Object.keys(channel.datasets || {})
                });
            }
            
            return byUnit;

        } catch (error) {
            console.error('Error grouping channels by unit:', error);
            return {};
        }
    }

    /**
     * Get channels that should be displayed by default
     * @returns {Array<string>} Default channel IDs
     */
    getDefaultDisplayChannels() {
        try {
            const channelInfo = this.progressiveReader.getChannelInfo();
            
            // For HDF5, return first 4 channels or all if fewer
            const defaultChannels = channelInfo
                .slice(0, 4)
                .map(ch => `hdf5_${ch.id}`);
            
            console.log(`Default HDF5 channels: ${defaultChannels.join(', ')}`);
            return defaultChannels;

        } catch (error) {
            console.error('Error getting default display channels:', error);
            return [];
        }
    }

    /**
     * Get time range for all channels
     * @returns {Object} {min: number, max: number}
     */
    getTimeRange() {
        return this.timeRange;
    }

    /**
     * Calculate time range for all channels
     * @private
     */
    _calculateTimeRange() {
        try {
            const channelInfo = this.progressiveReader.getChannelInfo();
            
            if (channelInfo.length === 0) {
                return { min: 0, max: 1 };
            }
            
            // Use first channel as reference (all channels should have same duration)
            const firstChannel = channelInfo[0];
            const maxTime = firstChannel.totalDuration || 1;
            
            return { 
                min: 0, 
                max: maxTime 
            };

        } catch (error) {
            console.error('Error calculating time range:', error);
            return { min: 0, max: 1 };
        }
    }

    /**
     * Get data ranges for auto-scaling (calculated on-demand)
     * @returns {Object} Ranges for all channels
     */
    getDataRanges() {
        // For HDF5, we calculate ranges on-demand since data isn't pre-loaded
        return Object.fromEntries(this.dataRanges);
    }

    /**
     * Calculate data range for a specific channel
     * @param {string} channelId - Channel ID (backend format)
     * @returns {Object|null} Data range information
     */
    getChannelDataRange(channelId) {
        try {
            // Check cache first
            if (this.dataRanges.has(channelId)) {
                return this.dataRanges.get(channelId);
            }

            const hdf5ChannelId = this._getHdf5ChannelId(channelId);
            if (!hdf5ChannelId) return null;

            // Load a small overview to calculate range
            const overview = this.progressiveReader.getChannelOverview(hdf5ChannelId, 1000);
            const values = overview.physicalValues;
            
            if (values.length === 0) return null;

            // Calculate min/max
            let min = values[0];
            let max = values[0];
            
            for (let i = 1; i < values.length; i++) {
                const val = values[i];
                if (val < min) min = val;
                if (val > max) max = val;
            }
            
            // Add padding (5%) for better visualization
            const range = max - min;
            const padding = Math.max(range * 0.05, Math.abs(max) * 0.01);
            
            const rangeInfo = {
                min: min - padding,
                max: max + padding,
                range: range,
                unit: overview.physicalUnit,
                label: overview.channelName,
                center: (min + max) / 2,
                type: 'hdf5'
            };

            // Cache the result
            this.dataRanges.set(channelId, rangeInfo);
            
            return rangeInfo;

        } catch (error) {
            console.error(`Error calculating data range for ${channelId}:`, error);
            return null;
        }
    }

    /**
     * Get enhanced channel statistics
     * @param {string} channelId - Channel ID (backend format)
     * @returns {Object|null} Channel statistics
     */
    getChannelStatistics(channelId) {
        try {
            const hdf5ChannelId = this._getHdf5ChannelId(channelId);
            if (!hdf5ChannelId) return null;

            // Load overview data for statistics calculation
            const overview = this.progressiveReader.getChannelOverview(hdf5ChannelId, 5000);
            const values = overview.physicalValues;
            const n = values.length;
            
            if (n === 0) return null;
            
            // Calculate basic statistics
            let min = values[0];
            let max = values[0];
            let sum = 0;
            let sumSquares = 0;
            
            for (let i = 0; i < n; i++) {
                const val = values[i];
                min = Math.min(min, val);
                max = Math.max(max, val);
                sum += val;
                sumSquares += val * val;
            }
            
            const mean = sum / n;
            const variance = (sumSquares / n) - (mean * mean);
            const stdDev = Math.sqrt(Math.max(0, variance));
            const rms = Math.sqrt(sumSquares / n);
            
            // Calculate percentiles (approximate)
            const sortedValues = Array.from(values).sort((a, b) => a - b);
            const p10 = sortedValues[Math.floor(n * 0.1)];
            const p25 = sortedValues[Math.floor(n * 0.25)];
            const p50 = sortedValues[Math.floor(n * 0.5)]; // median
            const p75 = sortedValues[Math.floor(n * 0.75)];
            const p90 = sortedValues[Math.floor(n * 0.9)];
            
            return {
                min,
                max,
                mean,
                median: p50,
                stdDev,
                variance,
                rms,
                range: max - min,
                count: n,
                unit: overview.physicalUnit,
                label: overview.channelName,
                
                // Percentiles
                percentiles: {
                    p10, p25, p50, p75, p90
                },
                
                // Additional metrics
                skewness: this._calculateSkewness(values, mean, stdDev),
                peakToPeak: max - min,
                crestFactor: stdDev > 0 ? (max - mean) / stdDev : 0,
                
                // HDF5-specific info
                datasetUsed: overview.metadata?.dataset,
                samplesAnalyzed: n,
                hdf5ChannelId: hdf5ChannelId
            };

        } catch (error) {
            console.error(`Error calculating statistics for ${channelId}:`, error);
            return null;
        }
    }

    /**
     * Get channel data formatted for API responses
     * @param {string} channelId - Channel ID (backend format)
     * @param {number} startTime - Start time
     * @param {number} endTime - End time  
     * @param {number} maxPoints - Max points
     * @returns {Object} API-formatted channel data
     */
    getChannelDataForAPI(channelId, startTime, endTime, maxPoints) {
        try {
            const channelData = this.getChannelById(channelId);
            if (!channelData) {
                return {
                    success: false,
                    error: `Channel ${channelId} not found`
                };
            }

            const data = this.getResampledData(channelId, startTime, endTime, maxPoints);
            
            return {
                success: true,
                channelId: channelId,
                data: {
                    time: data.time,
                    values: data.values
                },
                metadata: {
                    label: channelData.label,
                    unit: channelData.unit,
                    type: 'hdf5',
                    actualPoints: data.time.length,
                    requestedRange: { startTime, endTime },
                    maxPointsRequested: maxPoints,
                    hdf5ChannelId: channelData.hdf5ChannelId,
                    samplingRate: channelData.samplingRate,
                    availableDatasets: channelData.availableDatasets
                }
            };

        } catch (error) {
            return {
                success: false,
                error: `Failed to get channel data: ${error.message}`
            };
        }
    }

    /**
     * Get multiple channels data efficiently using progressive reader's bulk operations
     * @param {Array<string>} channelIds - Channel IDs (backend format)
     * @param {number} startTime - Start time
     * @param {number} endTime - End time
     * @param {number} maxPoints - Max points per channel
     * @returns {Object} API-formatted bulk channel data
     */
    getBulkChannelDataForAPI(channelIds, startTime, endTime, maxPoints) {
        try {
            // Convert backend channel IDs to HDF5 format
            const hdf5ChannelIds = channelIds
                .map(id => this._getHdf5ChannelId(id))
                .filter(id => id !== null);

            if (hdf5ChannelIds.length === 0) {
                return {
                    success: false,
                    error: 'No valid HDF5 channels found'
                };
            }

            console.log(`Bulk loading ${hdf5ChannelIds.length} HDF5 channels: ${startTime}s-${endTime}s`);

            // Use progressive reader's coordinated bulk loading
            const bulkResult = this.progressiveReader.loadMultipleChannels(
                hdf5ChannelIds,
                'range', // mode
                startTime,
                endTime,
                maxPoints
            );

            // Process results and convert to API format
            const results = {};
            const errors = [];
            
            // Process successful results
            for (const result of bulkResult.results) {
                if (result.success) {
                    const backendChannelId = `hdf5_${result.channelId}`;
                    const data = result.data;
                    
                    results[backendChannelId] = {
                        success: true,
                        data: {
                            time: Array.from(data.timeAxis),
                            values: Array.from(data.physicalValues)
                        },
                        metadata: {
                            label: data.channelName,
                            unit: data.physicalUnit,
                            type: 'hdf5',
                            actualPoints: data.actualSamples,
                            hdf5ChannelId: result.channelId,
                            sourceDataset: data.dataset,
                            samplingRate: data.metadata?.samplingRate,
                            coordinated: bulkResult.coordinated
                        }
                    };
                }
            }

            // Process errors
            for (const error of bulkResult.errors) {
                const backendChannelId = `hdf5_${error.channelId}`;
                results[backendChannelId] = {
                    success: false,
                    error: error.error
                };
                errors.push(`${backendChannelId}: ${error.error}`);
            }

            return {
                success: true,
                requestedChannels: channelIds.length,
                successfulChannels: bulkResult.results.length,
                failedChannels: bulkResult.errors.length,
                requestOptions: { startTime, endTime, maxPoints },
                channels: results,
                errors: errors.length > 0 ? errors : undefined,
                
                // HDF5-specific bulk metadata
                coordinatedLoading: bulkResult.coordinated,
                selectedDataset: bulkResult.selectedDataset
            };

        } catch (error) {
            console.error('Error in bulk channel data loading:', error);
            return {
                success: false,
                error: `Failed to get bulk channel data: ${error.message}`
            };
        }
    }

    /**
     * Validate and normalize time range
     * @param {number} startTime - Start time
     * @param {number} endTime - End time
     * @returns {Object} Validated time range
     */
    validateTimeRange(startTime, endTime) {
        const timeRange = this.getTimeRange();
        
        // Clamp to available data bounds
        const validStartTime = Math.max(startTime, timeRange.min);
        const validEndTime = Math.min(endTime, timeRange.max);
        
        // Ensure start < end
        if (validStartTime >= validEndTime) {
            return {
                startTime: timeRange.min,
                endTime: timeRange.max,
                wasModified: true
            };
        }
        
        return {
            startTime: validStartTime,
            endTime: validEndTime,
            wasModified: validStartTime !== startTime || validEndTime !== endTime
        };
    }

    /**
     * Generate comprehensive metadata summary for API responses
     * @returns {Object} Metadata summary
     */
    getMetadataSummary() {
        try {
            const channelInfo = this.progressiveReader.getChannelInfo();
            
            const summary = {
                channels: [], // HDF5 channels
                totalChannels: channelInfo.length,
                totalPoints: 0, // Calculated on-demand
                duration: this.timeRange.max,
                samplingRate: channelInfo[0]?.sampleRate || 0,
                fileType: 'hdf5',
                
                // HDF5-specific information
                hdf5Specific: {
                    availableDatasets: channelInfo[0] ? Object.keys(channelInfo[0].datasets || {}) : [],
                    progressiveZoomLevels: this.progressiveReader.zoomLevels?.length || 0,
                    coordinatedLoadingSupported: true
                }
            };
            
            // Process channel information
            for (const channel of channelInfo) {
                const channelSummary = {
                    id: `hdf5_${channel.id}`,
                    hdf5Id: channel.id,
                    label: channel.name,
                    unit: channel.physicalUnit,
                    samplingRate: channel.sampleRate,
                    totalDuration: channel.totalDuration,
                    availableDatasets: Object.keys(channel.datasets || {}),
                    type: 'hdf5'
                };
                
                summary.channels.push(channelSummary);
            }
            
            return summary;

        } catch (error) {
            console.error('Error generating metadata summary:', error);
            return {
                channels: [],
                totalChannels: 0,
                totalPoints: 0,
                duration: 0,
                samplingRate: 0,
                fileType: 'hdf5',
                error: error.message
            };
        }
    }

    // === PRIVATE HELPER METHODS ===

    /**
     * Convert backend channel ID to HDF5 format
     * @private
     */
    _getHdf5ChannelId(backendChannelId) {
        if (backendChannelId.startsWith('hdf5_')) {
            return backendChannelId.substring(5); // Remove 'hdf5_' prefix
        }
        return null;
    }

    /**
     * Calculate skewness (measure of asymmetry)
     * @private
     */
    _calculateSkewness(values, mean, stdDev) {
        if (stdDev === 0) return 0;
        
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            const normalized = (values[i] - mean) / stdDev;
            sum += normalized * normalized * normalized;
        }
        
        return sum / values.length;
    }

    // === CACHING METHODS ===

    /**
     * Get cached resampling result
     * @private
     */
    _getCachedResampling(cacheKey) {
        const cached = this.resamplingCache.get(cacheKey);
        if (!cached) return null;

        // Check if cache has expired
        const now = Date.now();
        if (now - cached.timestamp > this.cacheTimeout) {
            this.resamplingCache.delete(cacheKey);
            return null;
        }

        return cached.data;
    }

    /**
     * Set cached resampling result
     * @private
     */
    _setCachedResampling(cacheKey, data) {
        // Prevent cache from growing too large
        if (this.resamplingCache.size > 50) {
            // Remove oldest entries
            const entries = Array.from(this.resamplingCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            for (let i = 0; i < 10; i++) {
                this.resamplingCache.delete(entries[i][0]);
            }
        }

        this.resamplingCache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
    }

    /**
     * Clear resampling cache
     */
    clearCache() {
        const count = this.resamplingCache.size;
        this.resamplingCache.clear();
        console.log(`Cleared HDF5 resampling cache (${count} entries)`);
    }

    /**
     * Get cache status
     * @returns {Object} Cache information
     */
    getCacheStatus() {
        return {
            resamplingCacheEntries: this.resamplingCache.size,
            cacheTimeout: this.cacheTimeout,
            maxCacheSize: 50,
            progressiveReaderCache: this.progressiveReader ? 
                this.progressiveReader.getCacheStatus() : null
        };
    }
}

module.exports = Hdf5DataProcessor;