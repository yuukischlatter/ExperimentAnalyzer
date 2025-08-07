/**
 * Position Data Processor - Advanced Version with Interpolation
 * Handles position data processing, interpolation to fixed intervals, and API formatting
 * Implements the complex interpolation logic from the C# codebase
 */

class PositionDataProcessor {
    constructor(positionData, metadata) {
        this.positionData = positionData;
        this.metadata = metadata;
        
        // Store original raw data before interpolation
        this.rawPositionData = { ...positionData };
        
        // Pre-calculate commonly used values
        this.timeRange = this._calculateTimeRange();
        this.dataRanges = this._calculateDataRanges();
        
        // Interpolation settings (from C# code)
        this.interpolationInterval = 1000; // 1ms = 1000 microseconds
        
        console.log('PositionDataProcessor initialized');
    }

    /**
     * Interpolate position data to fixed 1ms intervals
     * This is the core feature that matches the C# implementation
     * @param {Float32Array} timeUs - Time array in microseconds
     * @param {Float32Array} positionMm - Position array in mm
     * @param {number} intervalUs - Interval in microseconds (default: 1000 = 1ms)
     * @returns {Object} {time: Float32Array, values: Float32Array}
     */
    interpolateToFixedIntervals(timeUs, positionMm, intervalUs = 1000) {
        if (!timeUs || !positionMm || timeUs.length === 0 || positionMm.length === 0) {
            return { time: new Float32Array(0), values: new Float32Array(0) };
        }

        if (timeUs.length !== positionMm.length) {
            throw new Error('Time and position arrays must have the same length');
        }

        console.log(`Interpolating position data: ${timeUs.length} points to ${intervalUs}µs intervals`);

        // Calculate interpolation range
        const startTime = Math.floor(timeUs[0]);
        const endTime = Math.floor(timeUs[timeUs.length - 1]);
        const totalDuration = endTime - startTime;
        const interpolatedCount = Math.floor(totalDuration / intervalUs) + 1;

        if (interpolatedCount <= 0) {
            console.warn('Invalid interpolation range, returning empty data');
            return { time: new Float32Array(0), values: new Float32Array(0) };
        }

        console.log(`Interpolation range: ${startTime}µs to ${endTime}µs (${totalDuration}µs duration)`);
        console.log(`Creating ${interpolatedCount} interpolated points`);

        // Create interpolated arrays
        const interpolatedTime = new Float32Array(interpolatedCount);
        const interpolatedPosition = new Float32Array(interpolatedCount);

        // Generate time points
        for (let j = 0; j < interpolatedCount; j++) {
            interpolatedTime[j] = startTime + j * intervalUs;
        }

        // Interpolate position values using nearest neighbor with half-interval bias
        // This matches the C# algorithm exactly
        let sourceIndex = 0;
        
        for (let j = 0; j < interpolatedCount; j++) {
            const targetTime = interpolatedTime[j];
            
            // Find the best source index for this target time
            // Move forward while the next source point is closer to target
            while (sourceIndex < timeUs.length - 1 && 
                   (timeUs[sourceIndex] + intervalUs / 2) < targetTime) {
                sourceIndex++;
            }
            
            // Bounds check
            if (sourceIndex >= positionMm.length) {
                sourceIndex = positionMm.length - 1;
            }
            
            interpolatedPosition[j] = positionMm[sourceIndex];
        }

        console.log(`Interpolation completed: ${interpolatedCount} points generated`);
        
        return {
            time: interpolatedTime,
            values: interpolatedPosition
        };
    }

    /**
     * Apply interpolation to position data and update the stored data
     * This modifies the position data in-place to match C# behavior
     */
    applyInterpolation() {
        const channelData = this.positionData['pos_x'];
        if (!channelData) {
            console.warn('No pos_x channel found for interpolation');
            return;
        }

        console.log(`Applying interpolation to pos_x channel (${channelData.points} original points)`);

        // Perform interpolation
        const interpolated = this.interpolateToFixedIntervals(
            channelData.time, 
            channelData.values, 
            this.interpolationInterval
        );

        // Update the channel data with interpolated values
        channelData.time = interpolated.time;
        channelData.values = interpolated.values;
        channelData.points = interpolated.time.length;
        channelData.isInterpolated = true;
        channelData.interpolationInterval = this.interpolationInterval;

        // Recalculate derived values
        this.timeRange = this._calculateTimeRange();
        this.dataRanges = this._calculateDataRanges();

        console.log(`Interpolation applied: ${channelData.points} interpolated points at ${this.interpolationInterval}µs intervals`);
    }

    /**
     * Get resampled data for position channel
     * @param {string} channelId - Channel ID (should be "pos_x")
     * @param {number} startTime - Start time in microseconds
     * @param {number} endTime - End time in microseconds  
     * @param {number} maxPoints - Maximum points to return (default: 2000)
     * @returns {Object} {time: Array, values: Array}
     */
    getResampledData(channelId, startTime, endTime, maxPoints = 2000) {
        try {
            // Get channel data
            let channelData = this.getChannelById(channelId);
            if (!channelData) {
                console.warn(`Position channel ${channelId} not found`);
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
            
            if (totalPoints <= 0) {
                return { time: [], values: [] };
            }
            
            if (totalPoints <= maxPoints) {
                // Return raw data if within limits
                return {
                    time: Array.from(channelData.time.slice(startIdx, endIdx + 1)),
                    values: Array.from(channelData.values.slice(startIdx, endIdx + 1))
                };
            } else {
                // Apply intelligent resampling for large datasets
                return this._intelligentResample(channelData, startIdx, endIdx, maxPoints);
            }

        } catch (error) {
            console.error(`Error resampling position channel ${channelId}:`, error);
            return { time: [], values: [] };
        }
    }

    /**
     * Intelligent resampling that preserves important features
     * For position data, we want to preserve both trends and spikes
     * @private
     */
    _intelligentResample(channelData, startIdx, endIdx, maxPoints) {
        const totalPoints = endIdx - startIdx + 1;
        
        if (totalPoints <= maxPoints * 2) {
            // Use simple decimation for moderate oversampling
            const step = Math.ceil(totalPoints / maxPoints);
            const resampledTime = [];
            const resampledValues = [];
            
            for (let i = startIdx; i <= endIdx; i += step) {
                resampledTime.push(channelData.time[i]);
                resampledValues.push(channelData.values[i]);
            }
            
            return { time: resampledTime, values: resampledValues };
        } else {
            // Use min-max resampling for heavy oversampling to preserve spikes
            return this._minMaxResample(channelData, startIdx, endIdx, maxPoints);
        }
    }

    /**
     * Min-max resampling to preserve spikes and important features
     * @private
     */
    _minMaxResample(channelData, startIdx, endIdx, maxPoints) {
        const totalPoints = endIdx - startIdx + 1;
        const bucketSize = Math.ceil(totalPoints / (maxPoints / 2)); // Use half points for min-max pairs
        
        const resampledTime = [];
        const resampledValues = [];
        
        for (let bucketStart = startIdx; bucketStart < endIdx; bucketStart += bucketSize) {
            const bucketEnd = Math.min(bucketStart + bucketSize - 1, endIdx);
            
            // Find min and max in this bucket
            let minVal = channelData.values[bucketStart];
            let maxVal = channelData.values[bucketStart];
            let minIdx = bucketStart;
            let maxIdx = bucketStart;
            
            for (let i = bucketStart + 1; i <= bucketEnd; i++) {
                const val = channelData.values[i];
                if (val < minVal) {
                    minVal = val;
                    minIdx = i;
                }
                if (val > maxVal) {
                    maxVal = val;
                    maxIdx = i;
                }
            }
            
            // Add min and max points (in time order)
            if (minIdx <= maxIdx) {
                if (minIdx !== maxIdx) {
                    resampledTime.push(channelData.time[minIdx]);
                    resampledValues.push(minVal);
                }
                resampledTime.push(channelData.time[maxIdx]);
                resampledValues.push(maxVal);
            } else {
                resampledTime.push(channelData.time[maxIdx]);
                resampledValues.push(maxVal);
                resampledTime.push(channelData.time[minIdx]);
                resampledValues.push(minVal);
            }
        }
        
        return { time: resampledTime, values: resampledValues };
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
     * Calculate data ranges for auto-scaling
     * @returns {Object} Ranges for position channel
     */
    getDataRanges() {
        return this.dataRanges;
    }

    /**
     * Calculate data ranges for position channel
     * @private
     */
    _calculateDataRanges() {
        const ranges = {};
        
        for (const [channelId, channelData] of Object.entries(this.positionData)) {
            if (!channelData || !channelData.values) continue;
            
            const values = channelData.values;
            let min = values[0];
            let max = values[0];
            
            for (let j = 1; j < values.length; j++) {
                const val = values[j];
                if (val < min) min = val;
                if (val > max) max = val;
            }
            
            ranges[channelId] = {
                min: min,
                max: max,
                range: max - min,
                unit: channelData.unit || 'mm',
                label: channelData.label
            };
        }
        
        return ranges;
    }

    /**
     * Generate metadata summary for API responses
     * @returns {Object} Metadata summary
     */
    getMetadataSummary() {
        const summary = {
            channels: [],
            totalPoints: 0,
            duration: 0,
            fileName: this.metadata.fileName,
            filePath: this.metadata.filePath,
            processedAt: this.metadata.processedAt
        };
        
        for (const [channelId, channelData] of Object.entries(this.positionData)) {
            if (!channelData) continue;
            
            const channelInfo = {
                channelId: channelId,
                label: channelData.label,
                unit: channelData.unit,
                points: channelData.points,
                samplingRate: channelData.samplingRate || 1000.0,
                type: 'position',
                isInterpolated: channelData.isInterpolated || false,
                interpolationInterval: channelData.interpolationInterval
            };
            
            summary.channels.push(channelInfo);
            summary.totalPoints += channelData.points;
            summary.duration = Math.max(summary.duration, 
                channelData.time[channelData.time.length - 1] / 1000); // Convert µs to ms
        }
        
        return summary;
    }

    /**
     * Get time range for all channels
     * @returns {Object} {min: number, max: number} in microseconds
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
        
        for (const channelData of Object.values(this.positionData)) {
            if (!channelData || channelData.time.length === 0) continue;
            
            minTime = Math.min(minTime, channelData.time[0]);
            maxTime = Math.max(maxTime, channelData.time[channelData.time.length - 1]);
        }
        
        if (minTime === Infinity) minTime = 0;
        if (maxTime === -Infinity) maxTime = 1000; // 1ms default
        
        return { min: minTime, max: maxTime };
    }

    /**
     * Get channel data by ID
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel data
     */
    getChannelById(channelId) {
        return this.positionData[channelId] || null;
    }

    /**
     * Get all available channels
     * @returns {Object} Available channels
     */
    getAllAvailableChannels() {
        const available = { position: [] };
        
        const defaultOrder = this.getDefaultDisplayChannels();
        
        for (const channelId of defaultOrder) {
            const channelData = this.positionData[channelId];
            if (channelData) {
                available.position.push({
                    id: channelId,
                    label: channelData.label,
                    unit: channelData.unit,
                    points: channelData.points,
                    samplingRate: channelData.samplingRate,
                    isInterpolated: channelData.isInterpolated || false
                });
            }
        }
        
        return available;
    }

    /**
     * Get channels grouped by unit
     * @returns {Object} Channels grouped by unit
     */
    getChannelsByUnit() {
        const byUnit = { 'mm': [] };
        
        for (const [channelId, channelData] of Object.entries(this.positionData)) {
            if (!channelData) continue;
            
            const unit = channelData.unit || 'mm';
            if (!byUnit[unit]) {
                byUnit[unit] = [];
            }
            
            byUnit[unit].push({
                id: channelId,
                label: channelData.label,
                type: 'position'
            });
        }
        
        return byUnit;
    }

    /**
     * Get default display channels (should just be pos_x)
     * @returns {Array<string>} Default channel IDs
     */
    getDefaultDisplayChannels() {
        return ['pos_x'];
    }

    /**
     * Validate and normalize time range
     * @param {number} startTime - Start time in microseconds
     * @param {number} endTime - End time in microseconds
     * @returns {Object} Validated time range
     */
    validateTimeRange(startTime, endTime) {
        const timeRange = this.getTimeRange();
        
        const validStartTime = Math.max(startTime, timeRange.min);
        const validEndTime = Math.min(endTime, timeRange.max);
        
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
     * Get comprehensive channel statistics
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel statistics
     */
    getChannelStatistics(channelId) {
        const channelData = this.getChannelById(channelId);
        if (!channelData) return null;
        
        const values = channelData.values;
        const timeData = channelData.time;
        const n = values.length;
        
        if (n === 0) return null;
        
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
        
        // Calculate movement statistics (useful for position data)
        let totalMovement = 0;
        let maxMovementRate = 0;
        
        for (let i = 1; i < n; i++) {
            const displacement = Math.abs(values[i] - values[i - 1]);
            totalMovement += displacement;
            
            if (timeData.length > i) {
                const timeDelta = timeData[i] - timeData[i - 1];
                if (timeDelta > 0) {
                    const movementRate = displacement / (timeDelta / 1000000); // mm/s
                    maxMovementRate = Math.max(maxMovementRate, movementRate);
                }
            }
        }
        
        return {
            min,
            max,
            mean,
            stdDev,
            count: n,
            unit: channelData.unit || 'mm',
            label: channelData.label,
            
            // Position-specific statistics
            range: max - min,
            totalMovement: totalMovement,
            maxMovementRate: maxMovementRate, // mm/s
            
            // Data quality metrics
            isInterpolated: channelData.isInterpolated || false,
            interpolationInterval: channelData.interpolationInterval,
            samplingRate: channelData.samplingRate
        };
    }

    /**
     * Get raw (pre-interpolation) data for debugging
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Raw channel data
     */
    getRawChannelData(channelId) {
        return this.rawPositionData[channelId] || null;
    }
}

module.exports = PositionDataProcessor;