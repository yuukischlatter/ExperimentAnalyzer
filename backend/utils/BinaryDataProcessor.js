/**
 * Binary Data Processor - Adapted for Modular System
 * Handles data resampling, analysis, and API formatting for binary oscilloscope data
 * Supports both raw channels (0-7) and calculated engineering channels (calc_0-6)
 */

class BinaryDataProcessor {
    constructor(rawData, calculatedData, metadata) {
        this.rawData = rawData;
        this.calculatedData = calculatedData;
        this.metadata = metadata;
        
        // Cache for commonly requested data ranges
        this.resamplingCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        
        // Pre-calculate commonly used values
        this.timeRange = this._calculateTimeRange();
        this.dataRanges = this._calculateDataRanges();
        
        console.log('BinaryDataProcessor initialized with caching enabled');
    }

    /**
     * Get resampled data for a channel with smart caching
     * @param {string} channelId - Channel ID (e.g., "channel_0", "calc_3")
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

            // Get channel data
            let channelData = this.getChannelById(channelId);
            if (!channelData) {
                console.warn(`Channel ${channelId} not found`);
                return { time: [], values: [] };
            }

            // Validate and clamp time range
            const validatedRange = this.validateTimeRange(startTime, endTime);
            startTime = validatedRange.startTime;
            endTime = validatedRange.endTime;

            // Find indices for time range
            const startIdx = this.findTimeIndex(channelData.time, startTime);
            const endIdx = this.findTimeIndex(channelData.time, endTime);
            
            const totalPoints = endIdx - startIdx + 1;
            
            let result;
            
            if (totalPoints <= maxPoints) {
                // Return raw data if within limits
                result = {
                    time: Array.from(channelData.time.slice(startIdx, endIdx + 1)),
                    values: Array.from(channelData.values.slice(startIdx, endIdx + 1))
                };
            } else {
                // Apply smart resampling
                result = this._performSmartResampling(
                    channelData, startIdx, endIdx, maxPoints
                );
            }

            // Cache the result
            this._setCachedResampling(cacheKey, result);
            
            return result;

        } catch (error) {
            console.error(`Error resampling channel ${channelId}:`, error);
            return { time: [], values: [] };
        }
    }

    /**
     * Smart resampling with spike preservation
     * @private
     */
    _performSmartResampling(channelData, startIdx, endIdx, maxPoints) {
        const totalPoints = endIdx - startIdx + 1;
        const step = Math.floor(totalPoints / maxPoints);
        
        const resampledTime = [];
        const resampledValues = [];
        
        // Use MinMax-LTTB algorithm for better spike preservation
        for (let i = startIdx; i <= endIdx; i += step) {
            const bucketEnd = Math.min(i + step, endIdx + 1);
            
            // Find min, max, and calculate average in bucket
            let min = channelData.values[i];
            let max = channelData.values[i];
            let sum = 0;
            let count = 0;
            let minIndex = i;
            let maxIndex = i;
            
            for (let j = i; j < bucketEnd; j++) {
                const val = channelData.values[j];
                if (val < min) {
                    min = val;
                    minIndex = j;
                }
                if (val > max) {
                    max = val;
                    maxIndex = j;
                }
                sum += val;
                count++;
            }
            
            if (count === 0) continue;
            
            const avg = sum / count;
            const range = max - min;
            const avgAbs = Math.abs(avg);
            
            // Determine if we need to preserve spikes
            if (range > avgAbs * 0.1 && count > 2) {
                // Significant variation - include min, max, and representative points
                if (minIndex !== maxIndex) {
                    // Add min point
                    resampledTime.push(channelData.time[minIndex]);
                    resampledValues.push(min);
                    
                    // Add max point
                    resampledTime.push(channelData.time[maxIndex]);
                    resampledValues.push(max);
                    
                    // Add average point at bucket center
                    const centerIdx = Math.floor((i + bucketEnd - 1) / 2);
                    resampledTime.push(channelData.time[centerIdx]);
                    resampledValues.push(avg);
                } else {
                    // Min and max at same point
                    resampledTime.push(channelData.time[i]);
                    resampledValues.push(avg);
                }
            } else {
                // Small variation - just use average
                resampledTime.push(channelData.time[i]);
                resampledValues.push(avg);
            }
        }
        
        return { time: resampledTime, values: resampledValues };
    }

    /**
     * Get the time step for a specific channel
     * @param {string} channelId - Channel ID
     * @returns {number} Time step in seconds
     */
    getChannelTimeStep(channelId) {
        let channelData = this.getChannelById(channelId);
        
        if (!channelData || !channelData.downsampling) {
            return (this.metadata.samplingInterval / 1e9); // Default sampling interval
        }
        
        return (this.metadata.samplingInterval * channelData.downsampling) / 1e9;
    }
    
    /**
     * Binary search for time index
     * @param {Float32Array} timeArray - Time array
     * @param {number} targetTime - Target time
     * @returns {number} Index
     */
    findTimeIndex(timeArray, targetTime) {
        let left = 0;
        let right = timeArray.length - 1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (timeArray[mid] < targetTime) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        return Math.max(0, Math.min(timeArray.length - 1, left));
    }

    /**
     * Calculate data ranges for auto-scaling (cached)
     * @returns {Object} Ranges for all channels
     */
    getDataRanges() {
        return this.dataRanges;
    }

    /**
     * Calculate data ranges for all channels
     * @private
     */
    _calculateDataRanges() {
        const ranges = {};
        
        // Process raw channels
        for (let i = 0; i < 8; i++) {
            const channelData = this.rawData[`channel_${i}`];
            if (!channelData) continue;
            
            const channelRange = this._calculateChannelRange(channelData);
            ranges[`channel_${i}`] = {
                ...channelRange,
                type: 'raw',
                channelIndex: i
            };
        }
        
        // Process calculated channels
        for (let i = 0; i < 7; i++) {
            const channelData = this.calculatedData[`calc_${i}`];
            if (!channelData) continue;
            
            const channelRange = this._calculateChannelRange(channelData);
            ranges[`calc_${i}`] = {
                ...channelRange,
                type: 'calculated',
                channelIndex: i
            };
        }
        
        return ranges;
    }

    /**
     * Calculate min/max range for a single channel
     * @private
     */
    _calculateChannelRange(channelData) {
        const values = channelData.values;
        
        // Use efficient min/max calculation
        let min = values[0];
        let max = values[0];
        
        for (let j = 1; j < values.length; j++) {
            const val = values[j];
            if (val < min) min = val;
            if (val > max) max = val;
        }
        
        // Add padding (5%) for better visualization
        const range = max - min;
        const padding = Math.max(range * 0.05, Math.abs(max) * 0.01);
        
        return {
            min: min - padding,
            max: max + padding,
            range: range,
            unit: channelData.unit,
            label: channelData.label,
            center: (min + max) / 2
        };
    }

    /**
     * Generate comprehensive metadata summary for API responses
     * @returns {Object} Metadata summary
     */
    getMetadataSummary() {
        const summary = {
            channels: [], // Raw channels
            calculatedChannels: [], // Calculated channels
            totalPoints: 0,
            duration: 0,
            samplingRate: this.metadata.samplingInterval ? 1e9 / this.metadata.samplingInterval : 0,
            
            // File information
            fileName: this.metadata.fileName,
            filePath: this.metadata.filePath,
            processedAt: this.metadata.processedAt,
            
            // Processing statistics
            processingStats: this.metadata.processingStats || {}
        };
        
        // Process raw channels
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (!ch) continue;
            
            const channelInfo = {
                index: i,
                id: `channel_${i}`,
                label: ch.label,
                unit: ch.unit,
                points: ch.points,
                duration: ch.time[ch.time.length - 1],
                samplingRate: ch.samplingRate || (1e9 / (this.metadata.samplingInterval * ch.downsampling)),
                downsampling: ch.downsampling,
                type: 'raw'
            };
            
            summary.channels.push(channelInfo);
            summary.totalPoints += ch.points;
            summary.duration = Math.max(summary.duration, channelInfo.duration);
        }
        
        // Process calculated channels
        for (let i = 0; i < 7; i++) {
            const ch = this.calculatedData[`calc_${i}`];
            if (!ch) continue;
            
            const channelInfo = {
                index: i,
                id: `calc_${i}`,
                label: ch.label,
                unit: ch.unit,
                points: ch.points,
                duration: ch.time[ch.time.length - 1],
                samplingRate: ch.samplingRate,
                downsampling: ch.downsampling,
                sourceChannels: ch.sourceChannels,
                type: 'calculated'
            };
            
            summary.calculatedChannels.push(channelInfo);
            summary.totalPoints += ch.points;
            summary.duration = Math.max(summary.duration, channelInfo.duration);
        }
        
        return summary;
    }

    /**
     * Get time range for all channels (cached)
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
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        // Check raw channels
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (!ch || ch.time.length === 0) continue;
            
            minTime = Math.min(minTime, ch.time[0]);
            maxTime = Math.max(maxTime, ch.time[ch.time.length - 1]);
        }
        
        // Check calculated channels
        for (let i = 0; i < 7; i++) {
            const ch = this.calculatedData[`calc_${i}`];
            if (!ch || ch.time.length === 0) continue;
            
            minTime = Math.min(minTime, ch.time[0]);
            maxTime = Math.max(maxTime, ch.time[ch.time.length - 1]);
        }
        
        // Fallback to reasonable defaults
        if (minTime === Infinity) minTime = 0;
        if (maxTime === -Infinity) maxTime = 1;
        
        return { min: minTime, max: maxTime };
    }

    /**
     * Get channel data by ID (supports both raw and calculated)
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel data
     */
    getChannelById(channelId) {
        if (channelId.startsWith('calc_')) {
            return this.calculatedData[channelId];
        } else if (channelId.startsWith('channel_')) {
            return this.rawData[channelId];
        } else if (/^[0-7]$/.test(channelId)) {
            // Support legacy numeric access for raw channels
            return this.rawData[`channel_${channelId}`];
        }
        
        return null;
    }

    /**
     * Get all available channels organized by type
     * @returns {Object} Available channels
     */
    getAllAvailableChannels() {
        const available = {
            raw: [],
            calculated: []
        };
        
        // Add raw channels
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (ch) {
                available.raw.push({
                    id: `channel_${i}`,
                    index: i,
                    label: ch.label,
                    unit: ch.unit,
                    points: ch.points,
                    samplingRate: ch.samplingRate,
                    downsampling: ch.downsampling
                });
            }
        }
        
        // Add calculated channels
        for (let i = 0; i < 7; i++) {
            const ch = this.calculatedData[`calc_${i}`];
            if (ch) {
                available.calculated.push({
                    id: `calc_${i}`,
                    index: i,
                    label: ch.label,
                    unit: ch.unit,
                    points: ch.points,
                    samplingRate: ch.samplingRate,
                    sourceChannels: ch.sourceChannels
                });
            }
        }
        
        return available;
    }

    /**
     * Get channels grouped by unit type for Y-axis assignment
     * @returns {Object} Channels grouped by unit
     */
    getChannelsByUnit() {
        const byUnit = {};
        
        // Process raw channels
        for (let i = 0; i < 8; i++) {
            const ch = this.rawData[`channel_${i}`];
            if (!ch) continue;
            
            if (!byUnit[ch.unit]) byUnit[ch.unit] = [];
            byUnit[ch.unit].push({
                id: `channel_${i}`,
                label: ch.label,
                type: 'raw',
                index: i
            });
        }
        
        // Process calculated channels
        for (let i = 0; i < 7; i++) {
            const ch = this.calculatedData[`calc_${i}`];
            if (!ch) continue;
            
            if (!byUnit[ch.unit]) byUnit[ch.unit] = [];
            byUnit[ch.unit].push({
                id: `calc_${i}`,
                label: ch.label,
                type: 'calculated',
                index: i,
                sourceChannels: ch.sourceChannels
            });
        }
        
        return byUnit;
    }

    /**
     * Get calculated channels that should be displayed by default
     * Engineering-significant channels for initial display
     * @returns {Array<string>} Default channel IDs
     */
    getDefaultDisplayChannels() {
        const defaultChannels = [
            'calc_5', // U_DC* - DC Voltage
            'calc_3', // I_DC_GR1* - DC Current Group 1  
            'calc_4', // I_DC_GR2* - DC Current Group 2
            'calc_6'  // F_Schlitten* - Sledge Force
        ];
        
        // Only return channels that actually exist
        return defaultChannels.filter(channelId => this.calculatedData[channelId]);
    }

    /**
     * Get raw channel IDs for optional display
     * @returns {Array<string>} Raw channel IDs
     */
    getRawChannelIds() {
        const rawChannels = [];
        for (let i = 0; i < 8; i++) {
            if (this.rawData[`channel_${i}`]) {
                rawChannels.push(`channel_${i}`);
            }
        }
        return rawChannels;
    }

    /**
     * Get channel data formatted for API responses
     * @param {string} channelId - Channel ID
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
                    type: channelId.startsWith('calc_') ? 'calculated' : 'raw',
                    actualPoints: data.time.length,
                    requestedRange: { startTime, endTime },
                    maxPointsRequested: maxPoints,
                    sourceChannels: channelData.sourceChannels || null,
                    samplingRate: channelData.samplingRate
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
     * Get multiple channels data efficiently for API
     * @param {Array<string>} channelIds - Channel IDs
     * @param {number} startTime - Start time
     * @param {number} endTime - End time
     * @param {number} maxPoints - Max points per channel
     * @returns {Object} API-formatted bulk channel data
     */
    getBulkChannelDataForAPI(channelIds, startTime, endTime, maxPoints) {
        const results = {};
        const errors = [];
        
        for (const channelId of channelIds) {
            try {
                const result = this.getChannelDataForAPI(channelId, startTime, endTime, maxPoints);
                results[channelId] = result;
                
                if (!result.success) {
                    errors.push(`${channelId}: ${result.error}`);
                }
            } catch (error) {
                const errorMsg = `Error processing channel ${channelId}: ${error.message}`;
                errors.push(errorMsg);
                results[channelId] = {
                    success: false,
                    error: errorMsg
                };
            }
        }

        return {
            success: true,
            requestedChannels: channelIds.length,
            successfulChannels: Object.values(results).filter(r => r.success).length,
            requestOptions: { startTime, endTime, maxPoints },
            channels: results,
            errors: errors.length > 0 ? errors : undefined
        };
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
     * Get enhanced channel statistics
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel statistics
     */
    getChannelStatistics(channelId) {
        const channelData = this.getChannelById(channelId);
        if (!channelData) return null;
        
        const values = channelData.values;
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
            unit: channelData.unit,
            label: channelData.label,
            
            // Percentiles
            percentiles: {
                p10, p25, p50, p75, p90
            },
            
            // Additional metrics
            skewness: this._calculateSkewness(values, mean, stdDev),
            peakToPeak: max - min,
            crestFactor: stdDev > 0 ? (max - mean) / stdDev : 0
        };
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
        if (this.resamplingCache.size > 100) {
            // Remove oldest entries
            const entries = Array.from(this.resamplingCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            for (let i = 0; i < 20; i++) {
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
        console.log(`Cleared resampling cache (${count} entries)`);
    }

    /**
     * Get cache status
     * @returns {Object} Cache information
     */
    getCacheStatus() {
        return {
            resamplingCacheEntries: this.resamplingCache.size,
            cacheTimeout: this.cacheTimeout,
            maxCacheSize: 100
        };
    }
}

module.exports = BinaryDataProcessor;