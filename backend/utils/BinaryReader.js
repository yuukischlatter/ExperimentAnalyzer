/**
 * Binary Reader - Adapted for Modular System
 * Parses C# binary files with full format compatibility
 * Adapted from standalone version to work with experiment system
 */

const fs = require('fs').promises;
const path = require('path');
const { convertAdcToPhysical } = require('./utils');

class BinaryReader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.rawData = {};
        this.calculatedData = {};
        this.processingStats = {};
        
        // Constants for calculations (from C# code)
        this.TRAFO_STROM_MULTIPLIER = 35;
        this.FORCE_COEFF_1 = 6.2832;
        this.FORCE_COEFF_2 = 5.0108;
        
        // Validation flags
        this.isValidated = false;
        this.validationErrors = [];
    }

    /**
     * Validate binary file before processing
     * @returns {Promise<Object>} Validation result
     */
    async validateFile() {
        const startTime = process.hrtime.bigint();
        const errors = [];
        
        try {
            // Check file exists
            try {
                await fs.access(this.filename);
            } catch (error) {
                errors.push(`File not found: ${this.filename}`);
                return { isValid: false, errors };
            }

            // Check file size
            const stats = await fs.stat(this.filename);
            const fileSizeGB = stats.size / (1024 * 1024 * 1024);
            
            if (stats.size === 0) {
                errors.push('File is empty');
            } else if (fileSizeGB > 2) {
                errors.push(`File too large: ${fileSizeGB.toFixed(1)}GB (max 2GB)`);
            }

            // Try to read header to validate format
            try {
                const buffer = await fs.readFile(this.filename, { start: 0, end: 1024 });
                const headerResult = this.readCSharpString(buffer, 0);
                
                if (!headerResult.value || headerResult.value.length === 0) {
                    errors.push('Invalid or missing header');
                } else {
                    console.log(`Binary file header: ${headerResult.value}`);
                }
            } catch (error) {
                errors.push(`Cannot read file header: ${error.message}`);
            }

            const duration = Number(process.hrtime.bigint() - startTime) / 1e6; // ms
            this.processingStats.validationTime = duration;
            this.isValidated = errors.length === 0;
            this.validationErrors = errors;

            return {
                isValid: this.isValidated,
                errors: errors,
                fileSize: stats.size,
                validationTime: duration
            };

        } catch (error) {
            errors.push(`Validation error: ${error.message}`);
            return { isValid: false, errors };
        }
    }

    /**
     * Read C# string format (7-bit encoded length + UTF-8 data)
     * @param {Buffer} buffer - Data buffer
     * @param {number} offset - Current offset
     * @returns {Object} {value: string, newOffset: number}
     */
    readCSharpString(buffer, offset) {
        // Read 7-bit encoded length (C# BinaryReader.ReadString format)
        let length = 0;
        let shift = 0;
        let currentOffset = offset;
        
        while (true) {
            if (currentOffset >= buffer.length) {
                throw new Error('Unexpected end of buffer while reading string length');
            }
            
            const byteVal = buffer.readUInt8(currentOffset++);
            length |= (byteVal & 0x7F) << shift;
            if ((byteVal & 0x80) === 0) break;
            shift += 7;
            
            if (shift > 35) {
                throw new Error('String length encoding too long (corrupt data?)');
            }
        }
        
        if (length === 0) {
            return { value: '', newOffset: currentOffset };
        }
        
        if (currentOffset + length > buffer.length) {
            throw new Error(`String length ${length} exceeds buffer bounds`);
        }
        
        const str = buffer.subarray(currentOffset, currentOffset + length).toString('utf8');
        return { value: str, newOffset: currentOffset + length };
    }

    /**
     * Convert .NET DateTime.ToBinary() format to Unix milliseconds
     * @param {BigInt} startTimeBinary - Binary timestamp from C#
     * @returns {number} Unix timestamp in milliseconds
     */
    convertBinaryTimestampToUnixMs(startTimeBinary) {
        try {
            // .NET DateTime.ToBinary() format analysis
            let ticks;
            
            if (startTimeBinary >= 0) {
                // UTC time - ticks are in the lower 62 bits
                ticks = startTimeBinary & 0x3FFFFFFFFFFFFFFFn;
            } else {
                // Local time - need to extract ticks differently
                const ticksMask = 0x3FFFFFFFFFFFFFFFn; // 62-bit mask
                ticks = startTimeBinary & ticksMask;
                
                if (ticks < 0) {
                    const absValue = startTimeBinary < 0 ? -startTimeBinary : startTimeBinary;
                    ticks = absValue & ticksMask;
                }
            }
            
            // Convert .NET ticks to Unix milliseconds
            const dotNetEpochTicks = 621355968000000000n;
            
            if (ticks > dotNetEpochTicks) {
                const unixTicks = ticks - dotNetEpochTicks;
                const unixMs = Number(unixTicks / 10000n); // Convert to milliseconds
                
                // Validate the result (reasonable timestamp range)
                const now = Date.now();
                const oneYearFromNow = now + (365 * 24 * 3600 * 1000);
                const oneYearAgo = now - (365 * 24 * 3600 * 1000);
                
                if (unixMs > oneYearAgo && unixMs < oneYearFromNow) {
                    return unixMs;
                }
            }
            
        } catch (e) {
            console.warn(`Error in timestamp conversion: ${e.message}`);
        }
        
        // Fallback: return 0 to disable alignment
        console.warn(`WARNING: Could not convert DateTime.ToBinary() format, returning 0 (timestamp alignment disabled)`);
        return 0;
    }

    /**
     * Main file reading method
     * @returns {Promise<void>}
     */
    async readFile() {
        console.log(`Reading binary file: ${path.basename(this.filename)}`);
        const overallStartTime = process.hrtime.bigint();
        
        try {
            // Validate file first
            if (!this.isValidated) {
                const validation = await this.validateFile();
                if (!validation.isValid) {
                    throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
                }
            }

            // Read entire file into buffer
            const fileReadStart = process.hrtime.bigint();
            const buffer = await fs.readFile(this.filename);
            const fileReadTime = Number(process.hrtime.bigint() - fileReadStart) / 1e9;
            
            console.log(`File loaded: ${(buffer.length / 1024 / 1024).toFixed(1)} MB in ${fileReadTime.toFixed(2)}s`);
            
            let offset = 0;
            
            // Read header
            const headerResult = this.readCSharpString(buffer, offset);
            const header = headerResult.value;
            offset = headerResult.newOffset;
            console.log(`Header: ${header}`);
            
            // Read metadata section
            offset = await this._readMetadataSection(buffer, offset);
            
            // Read the actual measurement data
            console.log('Reading measurement data...');
            const dataStartTime = process.hrtime.bigint();
            await this.readChannelData(buffer, offset, this.metadata.bufferSize, this.metadata.downsampling);
            const dataReadTime = Number(process.hrtime.bigint() - dataStartTime) / 1e9;
            
            // Compute calculated channels
            console.log('Computing calculated channels...');
            const calcStartTime = process.hrtime.bigint();
            this.computeCalculatedChannels();
            const calcTime = Number(process.hrtime.bigint() - calcStartTime) / 1e9;
            
            // Store processing statistics
            const totalTime = Number(process.hrtime.bigint() - overallStartTime) / 1e9;
            this.processingStats = {
                ...this.processingStats,
                fileReadTime,
                dataReadTime,
                calculationTime: calcTime,
                totalProcessingTime: totalTime,
                memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024
            };
            
            console.log(`Data reading completed in: ${dataReadTime.toFixed(2)}s`);
            console.log(`Calculated channels computed in: ${calcTime.toFixed(2)}s`);
            console.log(`Total processing time: ${totalTime.toFixed(2)}s`);
            console.log(`Memory usage: ${this.processingStats.memoryUsageMB.toFixed(1)} MB`);
            
        } catch (error) {
            console.error('Error reading binary file:', error);
            throw new Error(`Binary file reading failed: ${error.message}`);
        }
    }

    /**
     * Read metadata section from binary file
     * @private
     */
    async _readMetadataSection(buffer, offset) {
        // Read buffer size
        const bufferSize = buffer.readUInt32LE(offset); offset += 4;
        
        // Read start time (C# DateTime.ToBinary format)
        const startTimeBinary = buffer.readBigInt64LE(offset); offset += 8;
        const binaryUnixMs = this.convertBinaryTimestampToUnixMs(startTimeBinary);
        
        // Read max ADC value
        const maxAdcValue = buffer.readInt16LE(offset); offset += 2;
        
        // Read channel ranges (8x Int32)
        const channelRanges = [];
        for (let i = 0; i < 8; i++) {
            channelRanges.push(buffer.readInt32LE(offset));
            offset += 4;
        }
        
        // Read channel scaling (8x Int16)
        const channelScaling = [];
        for (let i = 0; i < 8; i++) {
            channelScaling.push(buffer.readInt16LE(offset));
            offset += 2;
        }
        
        // Read sampling interval
        const samplingInterval = buffer.readUInt32LE(offset); offset += 4;
        
        // Read downsampling factors (8x int)
        const downsampling = [];
        for (let i = 0; i < 8; i++) {
            downsampling.push(buffer.readInt32LE(offset));
            offset += 4;
        }
        
        // Read units (8x string)
        const units = [];
        for (let i = 0; i < 8; i++) {
            const result = this.readCSharpString(buffer, offset);
            units.push(result.value);
            offset = result.newOffset;
        }
        
        // Read labels (8x string)
        const labels = [];
        for (let i = 0; i < 8; i++) {
            const result = this.readCSharpString(buffer, offset);
            labels.push(result.value);
            offset = result.newOffset;
        }
        
        // Create readable date for logging
        const readDateTime = binaryUnixMs > 0 ? new Date(binaryUnixMs) : null;
        
        // Store comprehensive metadata
        this.metadata = {
            header: this.metadata.header || '', // Keep existing header
            bufferSize,
            startTimeBinary,
            binaryUnixMs,
            readDateTime,
            maxAdcValue,
            channelRanges,
            channelScaling,
            samplingInterval,
            downsampling,
            units,
            labels,
            
            // Additional metadata for the service layer
            filePath: this.filename,
            fileName: path.basename(this.filename),
            processedAt: new Date()
        };
        
        console.log(`Buffer size: ${bufferSize.toLocaleString()} points`);
        console.log(`Sampling interval: ${samplingInterval} ns (${(1e9/samplingInterval).toFixed(0)} Hz)`);
        console.log(`Recording start time: ${readDateTime ? readDateTime.toISOString() : 'Unknown'}`);
        
        return offset;
    }

    /**
     * Read channel data from binary file
     * @param {Buffer} buffer - File buffer
     * @param {number} startOffset - Data start offset
     * @param {number} bufferSize - Number of data points
     * @param {Array<number>} downsampling - Downsampling factors per channel
     */
    async readChannelData(buffer, startOffset, bufferSize, downsampling) {
        // Pre-calculate total data points and allocate arrays
        const channelDataArrays = [];
        const expectedPoints = [];
        
        for (let channel = 0; channel < 8; channel++) {
            const points = Math.floor(bufferSize / downsampling[channel]);
            expectedPoints.push(points);
            channelDataArrays.push(new Float32Array(points));
        }
        
        // Read all data with direct buffer access for performance
        let dataOffset = startOffset;
        const channelIndices = new Array(8).fill(0);
        
        // Progress tracking for large files
        let progressCounter = 0;
        const progressInterval = Math.floor(bufferSize / 20); // 5% intervals
        
        // Process data exactly like C# - but optimized for JavaScript
        for (let j = 0; j < bufferSize; j++) {
            // Progress logging for large files
            if (progressInterval > 0 && j % progressInterval === 0) {
                const progress = ((j / bufferSize) * 100).toFixed(0);
                if (progress % 10 === 0 && progressCounter !== parseInt(progress)) {
                    console.log(`Data reading progress: ${progress}%`);
                    progressCounter = parseInt(progress);
                }
            }
            
            for (let channel = 0; channel < 8; channel++) {
                if (j % downsampling[channel] === 0) {
                    // Validate buffer bounds
                    if (dataOffset + 1 >= buffer.length) {
                        console.warn(`Buffer underrun at position ${dataOffset}, stopping data read`);
                        break;
                    }
                    
                    // Direct buffer read
                    const rawAdc = buffer.readInt16LE(dataOffset);
                    dataOffset += 2;
                    
                    // Convert ADC to physical value
                    const physicalValue = convertAdcToPhysical(
                        rawAdc, 
                        this.metadata.maxAdcValue,
                        this.metadata.channelRanges[channel],
                        this.metadata.channelScaling[channel]
                    );
                    
                    // Direct array assignment
                    const index = channelIndices[channel];
                    if (index < channelDataArrays[channel].length) {
                        channelDataArrays[channel][index] = physicalValue;
                        channelIndices[channel]++;
                    }
                }
            }
        }
        
        // Create time axes and store data
        for (let channel = 0; channel < 8; channel++) {
            const actualPoints = channelIndices[channel];
            const dataArray = channelDataArrays[channel].slice(0, actualPoints);
            
            // Create time axis
            const dtSeconds = (this.metadata.samplingInterval * downsampling[channel]) / 1e9;
            const timeArray = new Float32Array(actualPoints);
            for (let i = 0; i < actualPoints; i++) {
                timeArray[i] = i * dtSeconds;
            }
            
            this.rawData[`channel_${channel}`] = {
                time: timeArray,
                values: dataArray,
                label: this.metadata.labels[channel] || `Channel ${channel}`,
                unit: this.metadata.units[channel] || 'V',
                downsampling: downsampling[channel],
                points: actualPoints,
                channelIndex: channel,
                samplingRate: 1e9 / (this.metadata.samplingInterval * downsampling[channel])
            };
            
            console.log(`Channel ${channel}: ${actualPoints.toLocaleString()} points, ` +
                       `${(actualPoints * dtSeconds).toFixed(1)}s duration`);
        }
    }

    /**
     * Compute calculated engineering channels from raw data
     */
    computeCalculatedChannels() {
        // Define calculated channel metadata
        const calcChannelDefs = {
            0: { label: 'UL3L1*', unit: 'V', sourceChannels: [0, 1] },
            1: { label: 'IL2GR1*', unit: 'V', sourceChannels: [2, 3] },
            2: { label: 'IL2GR2*', unit: 'V', sourceChannels: [4, 5] },
            3: { label: 'I_DC_GR1*', unit: 'A', sourceChannels: [2, 3] },
            4: { label: 'I_DC_GR2*', unit: 'A', sourceChannels: [4, 5] },
            5: { label: 'U_DC*', unit: 'V', sourceChannels: [0, 1] },
            6: { label: 'F_Schlitten*', unit: 'kN', sourceChannels: [6, 7] }
        };

        // Compute each calculated channel
        for (const [calcIndex, def] of Object.entries(calcChannelDefs)) {
            try {
                const result = this.computeSingleCalculatedChannel(parseInt(calcIndex), def);
                if (result) {
                    this.calculatedData[`calc_${calcIndex}`] = result;
                    console.log(`Computed ${def.label}: ${result.points.toLocaleString()} points`);
                }
            } catch (error) {
                console.error(`Error computing calculated channel ${calcIndex} (${def.label}):`, error);
            }
        }
        
        console.log(`Successfully computed ${Object.keys(this.calculatedData).length}/7 calculated channels`);
    }

    /**
     * Compute a single calculated channel
     * @param {number} calcIndex - Calculated channel index (0-6)
     * @param {Object} def - Channel definition
     * @returns {Object|null} Calculated channel data
     */
    computeSingleCalculatedChannel(calcIndex, def) {
        const sourceChannels = def.sourceChannels;
        
        // Validate source channels exist
        for (const srcCh of sourceChannels) {
            if (!this.rawData[`channel_${srcCh}`]) {
                console.warn(`Source channel ${srcCh} not found for calculated channel ${calcIndex}`);
                return null;
            }
        }

        // Get the primary source channel (first one) for time reference
        const primaryChannel = sourceChannels[0];
        const primaryData = this.rawData[`channel_${primaryChannel}`];
        const numPoints = primaryData.points;
        
        // Create arrays for calculated channel
        const timeArray = new Float32Array(primaryData.time);
        const valuesArray = new Float32Array(numPoints);
        
        // Perform calculations based on channel index
        switch (calcIndex) {
            case 0: // UL3L1* = -channel[0] - channel[1]
                this.calculateDifferential(valuesArray, 0, 1, numPoints, -1, -1);
                break;
                
            case 1: // IL2GR1* = -channel[2] - channel[3]
                this.calculateDifferential(valuesArray, 2, 3, numPoints, -1, -1);
                break;
                
            case 2: // IL2GR2* = -channel[4] - channel[5]
                this.calculateDifferential(valuesArray, 4, 5, numPoints, -1, -1);
                break;
                
            case 3: // I_DC_GR1* = TRAFO_MULTIPLIER * (|ch[2]| + |ch[3]| + |IL2GR1*|)
                this.calculateDCCurrent(valuesArray, 2, 3, 1, numPoints);
                break;
                
            case 4: // I_DC_GR2* = TRAFO_MULTIPLIER * (|ch[4]| + |ch[5]| + |IL2GR2*|)
                this.calculateDCCurrent(valuesArray, 4, 5, 2, numPoints);
                break;
                
            case 5: // U_DC* = (|ch[0]| + |ch[1]| + |UL3L1*|) / TRAFO_MULTIPLIER
                this.calculateDCVoltage(valuesArray, 0, 1, 0, numPoints);
                break;
                
            case 6: // F_Schlitten* = ch[6] * 6.2832 - ch[7] * 5.0108
                this.calculateForce(valuesArray, 6, 7, numPoints);
                break;
                
            default:
                console.warn(`Unknown calculated channel index: ${calcIndex}`);
                return null;
        }
        
        return {
            time: timeArray,
            values: valuesArray,
            label: def.label,
            unit: def.unit,
            sourceChannels: sourceChannels,
            points: numPoints,
            downsampling: primaryData.downsampling,
            channelIndex: calcIndex,
            samplingRate: primaryData.samplingRate
        };
    }

    // === CALCULATION METHODS ===

    calculateDifferential(output, ch1, ch2, numPoints, coeff1, coeff2) {
        const data1 = this.rawData[`channel_${ch1}`].values;
        const data2 = this.rawData[`channel_${ch2}`].values;
        
        for (let i = 0; i < numPoints; i++) {
            output[i] = coeff1 * data1[i] + coeff2 * data2[i];
        }
    }

    calculateDCCurrent(output, ch1, ch2, diffChannelIndex, numPoints) {
        const data1 = this.rawData[`channel_${ch1}`].values;
        const data2 = this.rawData[`channel_${ch2}`].values;
        const diffData = this.calculatedData[`calc_${diffChannelIndex}`]?.values;
        
        if (!diffData) {
            console.warn(`Differential channel calc_${diffChannelIndex} not computed yet`);
            return;
        }
        
        for (let i = 0; i < numPoints; i++) {
            const sum = Math.abs(data1[i]) + Math.abs(data2[i]) + Math.abs(diffData[i]);
            output[i] = this.TRAFO_STROM_MULTIPLIER * sum;
        }
    }

    calculateDCVoltage(output, ch1, ch2, diffChannelIndex, numPoints) {
        const data1 = this.rawData[`channel_${ch1}`].values;
        const data2 = this.rawData[`channel_${ch2}`].values;
        const diffData = this.calculatedData[`calc_${diffChannelIndex}`]?.values;
        
        if (!diffData) {
            console.warn(`Differential channel calc_${diffChannelIndex} not computed yet`);
            return;
        }
        
        for (let i = 0; i < numPoints; i++) {
            const sum = Math.abs(data1[i]) + Math.abs(data2[i]) + Math.abs(diffData[i]);
            output[i] = sum / this.TRAFO_STROM_MULTIPLIER;
        }
    }

    calculateForce(output, ch1, ch2, numPoints) {
        const data1 = this.rawData[`channel_${ch1}`].values;
        const data2 = this.rawData[`channel_${ch2}`].values;
        
        for (let i = 0; i < numPoints; i++) {
            output[i] = data1[i] * this.FORCE_COEFF_1 - data2[i] * this.FORCE_COEFF_2;
        }
    }

    // === PUBLIC DATA ACCESS METHODS ===

    getMetadata() {
        return {
            ...this.metadata,
            processingStats: this.processingStats,
            isValidated: this.isValidated,
            validationErrors: this.validationErrors
        };
    }

    getRawData() {
        return this.rawData;
    }

    getCalculatedData() {
        return this.calculatedData;
    }

    getChannelData(channel) {
        return this.rawData[`channel_${channel}`];
    }

    getCalculatedChannelData(channel) {
        return this.calculatedData[`calc_${channel}`];
    }

    getAllChannels() {
        const allChannels = {
            raw: {},
            calculated: {}
        };

        // Add raw channels
        for (let i = 0; i < 8; i++) {
            if (this.rawData[`channel_${i}`]) {
                allChannels.raw[i] = this.rawData[`channel_${i}`];
            }
        }

        // Add calculated channels
        for (let i = 0; i < 7; i++) {
            if (this.calculatedData[`calc_${i}`]) {
                allChannels.calculated[i] = this.calculatedData[`calc_${i}`];
            }
        }

        return allChannels;
    }

    getProcessingStats() {
        return {
            ...this.processingStats,
            rawChannelCount: Object.keys(this.rawData).length,
            calculatedChannelCount: Object.keys(this.calculatedData).length,
            totalDataPoints: Object.values(this.rawData).reduce((sum, ch) => sum + ch.points, 0)
        };
    }
}

module.exports = BinaryReader;