/**
 * Temperature Data Processor - Simple Version
 * Handles basic data processing and API formatting for temperature CSV data
 * Follows BinaryDataProcessor pattern without over-engineering
 */

class TemperatureDataProcessor {
    constructor(temperatureData, metadata) {
        this.temperatureData = temperatureData;
        this.metadata = metadata;
        
        // Pre-calculate commonly used values
        this.timeRange = this._calculateTimeRange();
        this.dataRanges = this._calculateDataRanges();
        
        console.log('TemperatureDataProcessor initialized');
    }

    /**
     * Get resampled data for a temperature channel
     * @param {string} channelId - Channel ID (e.g., "temp_welding", "temp_channel_5")
     * @param {number} startTime - Start time in seconds
     * @param {number} endTime - End time in seconds  
     * @param {number} maxPoints - Maximum points to return (default: 2000)
     * @returns {Object} {time: Array, values: Array}
     */
    getResampledData(channelId, startTime, endTime, maxPoints = 2000) {
        try {
            // Get channel data
            let channelData = this.getChannelById(channelId);
            if (!channelData) {
                console.warn(`Temperature channel ${channelId} not found`);
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
            
            if (totalPoints <= maxPoints) {
                // Return raw data if within limits
                return {
                    time: Array.from(channelData.time.slice(startIdx, endIdx + 1)),
                    values: Array.from(channelData.values.slice(startIdx, endIdx + 1))
                };
            } else {
                // Simple resampling - just take every nth point
                const step = Math.floor(totalPoints / maxPoints);
                const resampledTime = [];
                const resampledValues = [];
                
                for (let i = startIdx; i <= endIdx; i += step) {
                    resampledTime.push(channelData.time[i]);
                    resampledValues.push(channelData.values[i]);
                }
                
                return { time: resampledTime, values: resampledValues };
            }

        } catch (error) {
            console.error(`Error resampling temperature channel ${channelId}:`, error);
            return { time: [], values: [] };
        }
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
     * @returns {Object} Ranges for all temperature channels
     */
    getDataRanges() {
        return this.dataRanges;
    }

    /**
     * Calculate data ranges for all temperature channels
     * @private
     */
    _calculateDataRanges() {
        const ranges = {};
        
        for (const [channelId, channelData] of Object.entries(this.temperatureData)) {
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
                unit: channelData.unit || '°C',
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
        
        for (const [channelId, channelData] of Object.entries(this.temperatureData)) {
            if (!channelData) continue;
            
            const channelInfo = {
                channelId: channelId,
                label: channelData.label,
                unit: channelData.unit,
                points: channelData.points,
                samplingRate: channelData.samplingRate || 10.0,
                type: 'temperature'
            };
            
            summary.channels.push(channelInfo);
            summary.totalPoints += channelData.points;
            summary.duration = Math.max(summary.duration, channelData.time[channelData.time.length - 1]);
        }
        
        return summary;
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
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        for (const channelData of Object.values(this.temperatureData)) {
            if (!channelData || channelData.time.length === 0) continue;
            
            minTime = Math.min(minTime, channelData.time[0]);
            maxTime = Math.max(maxTime, channelData.time[channelData.time.length - 1]);
        }
        
        if (minTime === Infinity) minTime = 0;
        if (maxTime === -Infinity) maxTime = 1;
        
        return { min: minTime, max: maxTime };
    }

    /**
     * Get channel data by ID
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel data
     */
    getChannelById(channelId) {
        return this.temperatureData[channelId] || null;
    }

    /**
     * Get all available channels
     * @returns {Object} Available channels
     */
    getAllAvailableChannels() {
        const available = { temperature: [] };
        
        const defaultOrder = this.getDefaultDisplayChannels();
        
        for (const channelId of defaultOrder) {
            const channelData = this.temperatureData[channelId];
            if (channelData) {
                available.temperature.push({
                    id: channelId,
                    label: channelData.label,
                    unit: channelData.unit,
                    points: channelData.points,
                    samplingRate: channelData.samplingRate
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
        const byUnit = { '°C': [] };
        
        for (const [channelId, channelData] of Object.entries(this.temperatureData)) {
            if (!channelData) continue;
            
            byUnit['°C'].push({
                id: channelId,
                label: channelData.label,
                type: 'temperature'
            });
        }
        
        return byUnit;
    }

    /**
     * Get default display channels (welding first)
     * @returns {Array<string>} Default channel IDs
     */
    getDefaultDisplayChannels() {
        const channelIds = Object.keys(this.temperatureData);
        const defaultOrder = [];
        
        // Welding channel first
        if (this.temperatureData['temp_welding']) {
            defaultOrder.push('temp_welding');
        }
        
        // Other channels in numeric order
        const otherChannels = channelIds
            .filter(id => id !== 'temp_welding')
            .sort((a, b) => {
                const aMatch = a.match(/temp_channel_(\d+)/);
                const bMatch = b.match(/temp_channel_(\d+)/);
                
                if (aMatch && bMatch) {
                    return parseInt(aMatch[1]) - parseInt(bMatch[1]);
                }
                
                return a.localeCompare(b);
            });
        
        defaultOrder.push(...otherChannels);
        return defaultOrder;
    }

    /**
     * Validate and normalize time range
     * @param {number} startTime - Start time
     * @param {number} endTime - End time
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
     * Get basic channel statistics
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel statistics
     */
    getChannelStatistics(channelId) {
        const channelData = this.getChannelById(channelId);
        if (!channelData) return null;
        
        const values = channelData.values;
        const n = values.length;
        
        if (n === 0) return null;
        
        let min = values[0];
        let max = values[0];
        let sum = 0;
        
        for (let i = 0; i < n; i++) {
            const val = values[i];
            min = Math.min(min, val);
            max = Math.max(max, val);
            sum += val;
        }
        
        const mean = sum / n;
        
        return {
            min,
            max,
            mean,
            count: n,
            unit: channelData.unit || '°C',
            label: channelData.label
        };
    }
}

module.exports = TemperatureDataProcessor;