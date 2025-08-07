/**
 * Acceleration Data Processor - Multi-Channel High-Frequency Data
 * Handles acceleration data processing, resampling, and API formatting
 * Supports 3-axis acceleration data with advanced resampling for high-frequency data
 * Optimized for 10kHz+ sampling rates with intelligent downsampling
 */

class AccelerationDataProcessor {
    constructor(accelerationData, metadata) {
        this.accelerationData = accelerationData;
        this.metadata = metadata;
        
        // Pre-calculate commonly used values
        this.timeRange = this._calculateTimeRange();
        this.dataRanges = this._calculateDataRanges();
        
        // High-frequency data optimization settings
        this.highFrequencyThreshold = 5000; // Hz - above this, use advanced resampling
        this.maxPointsBeforeResampling = 10000; // Points - above this, always resample
        
        console.log('AccelerationDataProcessor initialized');
        console.log(`Data ranges: ${Object.keys(this.dataRanges).length} channels`);
        console.log(`Time range: ${this.timeRange.min.toFixed(1)} - ${this.timeRange.max.toFixed(1)} µs`);
    }

    /**
     * Get resampled data for an acceleration channel
     * @param {string} channelId - Channel ID (acc_x, acc_y, acc_z)
     * @param {number} startTime - Start time in microseconds
     * @param {number} endTime - End time in microseconds  
     * @param {number} maxPoints - Maximum points to return (default: 2000)
     * @returns {Object} {time: Array, values: Array}
     */
    getResampledData(channelId, startTime, endTime, maxPoints = 2000) {
        try {
            // Get channel data
            const channelData = this.getChannelById(channelId);
            if (!channelData) {
                console.warn(`Acceleration channel ${channelId} not found`);
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
            console.error(`Error resampling acceleration channel ${channelId}:`, error);
            return { time: [], values: [] };
        }
    }

    /**
     * Intelligent resampling optimized for high-frequency acceleration data
     * Uses different strategies based on data characteristics and oversampling ratio
     * @private
     */
    _intelligentResample(channelData, startIdx, endIdx, maxPoints) {
        const totalPoints = endIdx - startIdx + 1;
        const oversamplingRatio = totalPoints / maxPoints;
        
        console.log(`Resampling acceleration data: ${totalPoints} -> ${maxPoints} points (${oversamplingRatio.toFixed(1)}x oversampling)`);
        
        // Choose resampling strategy based on oversampling ratio
        if (oversamplingRatio < 3) {
            // Light oversampling - use simple decimation
            return this._simpleDecimation(channelData, startIdx, endIdx, maxPoints);
        } else if (oversamplingRatio < 10) {
            // Moderate oversampling - use min-max resampling to preserve peaks
            return this._minMaxResample(channelData, startIdx, endIdx, maxPoints);
        } else {
            // Heavy oversampling - use RMS-based resampling for acceleration data
            return this._rmsResample(channelData, startIdx, endIdx, maxPoints);
        }
    }

    /**
     * Simple decimation - take every nth point
     * @private
     */
    _simpleDecimation(channelData, startIdx, endIdx, maxPoints) {
        const totalPoints = endIdx - startIdx + 1;
        const step = Math.ceil(totalPoints / maxPoints);
        const resampledTime = [];
        const resampledValues = [];
        
        for (let i = startIdx; i <= endIdx; i += step) {
            resampledTime.push(channelData.time[i]);
            resampledValues.push(channelData.values[i]);
        }
        
        return { time: resampledTime, values: resampledValues };
    }

    /**
     * Min-max resampling to preserve acceleration peaks and valleys
     * Critical for acceleration data where spikes indicate important events
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
            
            // Add min and max points (in chronological order)
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
     * RMS-based resampling for heavy downsampling of acceleration data
     * Preserves energy characteristics which are important for vibration analysis
     * @private
     */
    _rmsResample(channelData, startIdx, endIdx, maxPoints) {
        const totalPoints = endIdx - startIdx + 1;
        const bucketSize = Math.ceil(totalPoints / maxPoints);
        
        const resampledTime = [];
        const resampledValues = [];
        
        for (let bucketStart = startIdx; bucketStart < endIdx; bucketStart += bucketSize) {
            const bucketEnd = Math.min(bucketStart + bucketSize - 1, endIdx);
            
            // Calculate RMS value for this bucket
            let sumSquares = 0;
            let count = 0;
            let timeSum = 0;
            
            for (let i = bucketStart; i <= bucketEnd; i++) {
                const val = channelData.values[i];
                sumSquares += val * val;
                timeSum += channelData.time[i];
                count++;
            }
            
            if (count > 0) {
                const rmsValue = Math.sqrt(sumSquares / count);
                const avgTime = timeSum / count;
                
                resampledTime.push(avgTime);
                resampledValues.push(rmsValue);
            }
        }
        
        return { time: resampledTime, values: resampledValues };
    }

    /**
     * Binary search for time index (optimized for high-frequency data)
     * @param {Float32Array} timeArray - Time array
     * @param {number} targetTime - Target time in microseconds
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
     * Calculate data ranges for auto-scaling (all 3 axes)
     * @returns {Object} Ranges for all acceleration channels
     */
    getDataRanges() {
        return this.dataRanges;
    }

    /**
     * Calculate data ranges for all acceleration channels
     * @private
     */
    _calculateDataRanges() {
        const ranges = {};
        
        for (const [channelId, channelData] of Object.entries(this.accelerationData)) {
            if (!channelData || !channelData.values) continue;
            
            const values = channelData.values;
            let min = values[0];
            let max = values[0];
            let sumSquares = 0;
            
            // Calculate min, max, and RMS in single pass
            for (let j = 0; j < values.length; j++) {
                const val = values[j];
                if (val < min) min = val;
                if (val > max) max = val;
                sumSquares += val * val;
            }
            
            const rms = Math.sqrt(sumSquares / values.length);
            
            ranges[channelId] = {
                min: min,
                max: max,
                range: max - min,
                rms: rms, // Important for acceleration data
                unit: channelData.unit || 'm/s²',
                label: channelData.label,
                axis: channelData.axis
            };
        }
        
        // Calculate combined magnitude statistics
        ranges['acc_magnitude'] = this._calculateMagnitudeRange();
        
        return ranges;
    }

    /**
     * Calculate magnitude range (|√(x² + y² + z²)|) for 3D acceleration
     * @private
     */
    _calculateMagnitudeRange() {
        const xData = this.accelerationData['acc_x'];
        const yData = this.accelerationData['acc_y'];
        const zData = this.accelerationData['acc_z'];
        
        if (!xData || !yData || !zData) {
            return {
                min: 0,
                max: 0,
                range: 0,
                rms: 0,
                unit: 'm/s²',
                label: 'Acceleration Magnitude',
                axis: 'Magnitude'
            };
        }
        
        const minLength = Math.min(xData.values.length, yData.values.length, zData.values.length);
        
        let minMag = Infinity;
        let maxMag = -Infinity;
        let sumSquares = 0;
        
        for (let i = 0; i < minLength; i++) {
            const x = xData.values[i];
            const y = yData.values[i];
            const z = zData.values[i];
            const magnitude = Math.sqrt(x*x + y*y + z*z);
            
            if (magnitude < minMag) minMag = magnitude;
            if (magnitude > maxMag) maxMag = magnitude;
            sumSquares += magnitude * magnitude;
        }
        
        return {
            min: minMag === Infinity ? 0 : minMag,
            max: maxMag === -Infinity ? 0 : maxMag,
            range: maxMag - minMag,
            rms: minLength > 0 ? Math.sqrt(sumSquares / minLength) : 0,
            unit: 'm/s²',
            label: 'Acceleration Magnitude',
            axis: 'Magnitude'
        };
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
            processedAt: this.metadata.processedAt,
            samplingInfo: {
                detectedFormat: this.metadata.detectedFormat,
                isHighFrequency: false
            }
        };
        
        for (const [channelId, channelData] of Object.entries(this.accelerationData)) {
            if (!channelData) continue;
            
            const channelInfo = {
                channelId: channelId,
                label: channelData.label,
                unit: channelData.unit,
                axis: channelData.axis,
                points: channelData.points,
                samplingRate: channelData.samplingRate || 10000,
                type: 'acceleration'
            };
            
            summary.channels.push(channelInfo);
            summary.totalPoints += channelData.points;
            summary.duration = Math.max(summary.duration, 
                channelData.time[channelData.time.length - 1] / 1000); // Convert µs to ms
            
            // Mark as high frequency if any channel exceeds threshold
            if (channelData.samplingRate > this.highFrequencyThreshold) {
                summary.samplingInfo.isHighFrequency = true;
            }
        }
        
        return summary;
    }

    /**
     * Get time range for all channels (should be same for all)
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
        
        for (const channelData of Object.values(this.accelerationData)) {
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
     * @param {string} channelId - Channel ID (acc_x, acc_y, acc_z)
     * @returns {Object|null} Channel data
     */
    getChannelById(channelId) {
        return this.accelerationData[channelId] || null;
    }

    /**
     * Get all available channels
     * @returns {Object} Available channels grouped by type
     */
    getAllAvailableChannels() {
        const available = { acceleration: [] };
        
        const defaultOrder = this.getDefaultDisplayChannels();
        
        for (const channelId of defaultOrder) {
            const channelData = this.accelerationData[channelId];
            if (channelData) {
                available.acceleration.push({
                    id: channelId,
                    label: channelData.label,
                    unit: channelData.unit,
                    axis: channelData.axis,
                    points: channelData.points,
                    samplingRate: channelData.samplingRate,
                    isHighFrequency: (channelData.samplingRate || 0) > this.highFrequencyThreshold
                });
            }
        }
        
        return available;
    }

    /**
     * Get channels grouped by unit (all should be m/s²)
     * @returns {Object} Channels grouped by unit
     */
    getChannelsByUnit() {
        const byUnit = { 'm/s²': [] };
        
        for (const [channelId, channelData] of Object.entries(this.accelerationData)) {
            if (!channelData) continue;
            
            const unit = channelData.unit || 'm/s²';
            if (!byUnit[unit]) {
                byUnit[unit] = [];
            }
            
            byUnit[unit].push({
                id: channelId,
                label: channelData.label,
                axis: channelData.axis,
                type: 'acceleration'
            });
        }
        
        return byUnit;
    }

    /**
     * Get default display channels (X, Y, Z order)
     * @returns {Array<string>} Default channel IDs
     */
    getDefaultDisplayChannels() {
        return ['acc_x', 'acc_y', 'acc_z'];
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
     * Get comprehensive channel statistics including acceleration-specific metrics
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
        
        // Basic statistics
        let min = values[0];
        let max = values[0];
        let sum = 0;
        let sumSquares = 0;
        let sumAbs = 0;
        
        for (let i = 0; i < n; i++) {
            const val = values[i];
            min = Math.min(min, val);
            max = Math.max(max, val);
            sum += val;
            sumSquares += val * val;
            sumAbs += Math.abs(val);
        }
        
        const mean = sum / n;
        const variance = (sumSquares / n) - (mean * mean);
        const stdDev = Math.sqrt(Math.max(0, variance));
        const rms = Math.sqrt(sumSquares / n);
        const meanAbsolute = sumAbs / n;
        
        // Acceleration-specific statistics
        let peakToPeak = max - min;
        let crestFactor = rms !== 0 ? Math.abs(max) / rms : 0; // Peak to RMS ratio
        
        // Calculate zero-crossing rate (useful for vibration analysis)
        let zeroCrossings = 0;
        for (let i = 1; i < n; i++) {
            if ((values[i-1] >= 0 && values[i] < 0) || (values[i-1] < 0 && values[i] >= 0)) {
                zeroCrossings++;
            }
        }
        const zeroCrossingRate = timeData.length > 1 ? 
            zeroCrossings / ((timeData[timeData.length - 1] - timeData[0]) / 1_000_000) : 0; // Hz
        
        // Calculate dominant frequency (simplified - peak frequency in spectrum)
        let dominantFrequency = 0;
        if (channelData.samplingRate) {
            // Estimate from zero crossings (rough approximation)
            dominantFrequency = zeroCrossingRate / 2; // Approximate fundamental frequency
        }
        
        return {
            // Basic statistics
            min,
            max,
            mean,
            stdDev,
            count: n,
            unit: channelData.unit || 'm/s²',
            label: channelData.label,
            axis: channelData.axis,
            
            // Acceleration-specific statistics
            rms,
            meanAbsolute,
            peakToPeak,
            crestFactor,
            zeroCrossingRate, // Hz
            dominantFrequency, // Hz (approximate)
            
            // Data characteristics
            samplingRate: channelData.samplingRate,
            duration: timeData.length > 1 ? (timeData[timeData.length - 1] - timeData[0]) / 1_000_000 : 0, // seconds
            isHighFrequency: (channelData.samplingRate || 0) > this.highFrequencyThreshold
        };
    }

    /**
     * Calculate 3D magnitude data on-the-fly
     * @param {number} startTime - Start time in microseconds
     * @param {number} endTime - End time in microseconds
     * @param {number} maxPoints - Maximum points to return
     * @returns {Object} {time: Array, values: Array} of magnitude data
     */
    getMagnitudeData(startTime, endTime, maxPoints = 2000) {
        try {
            const xData = this.getChannelById('acc_x');
            const yData = this.getChannelById('acc_y');
            const zData = this.getChannelById('acc_z');
            
            if (!xData || !yData || !zData) {
                return { time: [], values: [] };
            }
            
            // Get resampled data for each axis
            const xResampled = this.getResampledData('acc_x', startTime, endTime, maxPoints);
            const yResampled = this.getResampledData('acc_y', startTime, endTime, maxPoints);
            const zResampled = this.getResampledData('acc_z', startTime, endTime, maxPoints);
            
            // Calculate magnitude for each point
            const minLength = Math.min(xResampled.time.length, yResampled.time.length, zResampled.time.length);
            const magnitudeValues = new Array(minLength);
            
            for (let i = 0; i < minLength; i++) {
                const x = xResampled.values[i] || 0;
                const y = yResampled.values[i] || 0;
                const z = zResampled.values[i] || 0;
                magnitudeValues[i] = Math.sqrt(x*x + y*y + z*z);
            }
            
            return {
                time: xResampled.time.slice(0, minLength),
                values: magnitudeValues
            };
            
        } catch (error) {
            console.error('Error calculating magnitude data:', error);
            return { time: [], values: [] };
        }
    }
}

module.exports = AccelerationDataProcessor;