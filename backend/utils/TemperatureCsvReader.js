/**
 * Temperature CSV Reader - Adapted for Modular System
 * Parses temperature CSV files with German number format and Unix timestamps
 * Adapted from BinaryReader pattern to work with experiment system
 */

const fs = require('fs').promises;
const path = require('path');
const Papa = require('papaparse');

class TemperatureCsvReader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.temperatureData = {};
        this.processingStats = {};
        
        // Channel mapping for different CSV formats
        this.channelMapping = {};
        
        // Validation flags
        this.isValidated = false;
        this.validationErrors = [];
    }

    /**
     * Validate CSV file before processing
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
            const fileSizeMB = stats.size / (1024 * 1024);
            
            if (stats.size === 0) {
                errors.push('File is empty');
            } else if (fileSizeMB > 100) {
                errors.push(`File too large: ${fileSizeMB.toFixed(1)}MB (max 100MB)`);
            }

            // Try to read first few lines to validate CSV format
            try {
                const fileHandle = await fs.open(this.filename, 'r');
                const buffer = Buffer.alloc(1024);
                await fileHandle.read(buffer, 0, 1024, 0);
                await fileHandle.close();
                
                const sample = buffer.toString('utf8');
                
                // Check for CSV structure
                if (!sample.includes(',') && !sample.includes(';')) {
                    errors.push('File does not appear to be CSV format');
                }
                
                // Check for temperature-related headers
                if (!sample.toLowerCase().includes('schweissen') && 
                    !sample.toLowerCase().includes('kanal') &&
                    !sample.toLowerCase().includes('temperature')) {
                    errors.push('File does not contain expected temperature column headers');
                }
                
                console.log(`Temperature CSV validation - found headers in: ${sample.substring(0, 200)}...`);
                
            } catch (error) {
                errors.push(`Cannot read file content: ${error.message}`);
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
     * Parse German decimal number format
     * @param {string} value - German formatted number (e.g., "22,639746")
     * @returns {number} Parsed number
     */
    parseGermanNumber(value) {
        if (!value || typeof value !== 'string') {
            return NaN;
        }
        
        // Remove quotes and trim whitespace
        const cleaned = value.replace(/"/g, '').trim();
        
        // Handle empty strings
        if (cleaned === '') {
            return NaN;
        }
        
        // Replace German comma with decimal point
        const normalized = cleaned.replace(',', '.');
        const number = parseFloat(normalized);
        
        return isNaN(number) ? NaN : number;
    }

    /**
     * Convert Unix timestamps to relative seconds
     * @param {number[]} timestamps - Array of Unix timestamps with decimals
     * @returns {Float32Array} Relative time in seconds from start
     */
    convertTimestampsToRelative(timestamps) {
        if (!timestamps || timestamps.length === 0) {
            return new Float32Array(0);
        }
        
        const startTime = timestamps[0];
        const relativeTime = new Float32Array(timestamps.length);
        
        for (let i = 0; i < timestamps.length; i++) {
            relativeTime[i] = timestamps[i] - startTime;
        }
        
        return relativeTime;
    }

    /**
     * Detect and map CSV channel format from headers
     * @param {string[]} headers - CSV column headers
     * @returns {Object} Channel mapping object
     */
    detectCsvFormat(headers) {
        const channelMapping = {};
        const detectedFormat = {
            type: 'unknown',
            channelCount: 0,
            hasWeldingChannel: false,
            channels: []
        };
        
        console.log('Detecting CSV format from headers:', headers);
        
        // Process each header
        headers.forEach((header, index) => {
            const cleanHeader = header ? header.trim().replace(/"/g, '') : '';
            
            // Skip first column if it's empty (likely timestamp column)
            if (index === 0 && cleanHeader === '') {
                console.log(`Skipping first column (likely timestamp): "${header}" at index ${index}`);
                return;
            }
            
            // Detect Schweissen (welding) channel
            if (cleanHeader.toLowerCase().includes('schweissen') && cleanHeader.toLowerCase().includes('durchschn')) {
                channelMapping['temp_welding'] = {
                    originalHeader: cleanHeader,
                    columnIndex: index,
                    label: 'Schweissen Durchschn.',
                    unit: '°C'
                };
                detectedFormat.hasWeldingChannel = true;
                detectedFormat.channels.push('temp_welding');
                console.log(`Found welding channel: "${cleanHeader}" at index ${index}`);
            }
            // Detect Kanal (numbered channels)
            else if (cleanHeader.toLowerCase().includes('kanal') && cleanHeader.toLowerCase().includes('durchschn')) {
                const match = cleanHeader.match(/kanal\s*(\d+)/i);
                if (match) {
                    const channelNumber = parseInt(match[1]);
                    const channelId = `temp_channel_${channelNumber}`;
                    
                    channelMapping[channelId] = {
                        originalHeader: cleanHeader,
                        columnIndex: index,
                        label: `Kanal ${channelNumber} Durchschn.`,
                        unit: '°C',
                        channelNumber: channelNumber
                    };
                    detectedFormat.channels.push(channelId);
                    console.log(`Found channel ${channelNumber}: "${cleanHeader}" at index ${index}`);
                }
            }
        });
        
        // Determine format type
        detectedFormat.channelCount = Object.keys(channelMapping).length;
        
        if (detectedFormat.hasWeldingChannel && detectedFormat.channelCount === 1) {
            detectedFormat.type = 'welding_only';
        } else if (detectedFormat.hasWeldingChannel && detectedFormat.channelCount === 2) {
            detectedFormat.type = 'welding_plus_one';
        } else if (detectedFormat.hasWeldingChannel && detectedFormat.channelCount > 2) {
            detectedFormat.type = 'welding_plus_multiple';
        } else {
            detectedFormat.type = 'unknown';
        }
        
        console.log(`Detected format: ${detectedFormat.type} with ${detectedFormat.channelCount} channels`);
        
        this.channelMapping = channelMapping;
        return detectedFormat;
    }

    /**
     * Main file reading method
     * @returns {Promise<void>}
     */
    async readFile() {
        console.log(`Reading temperature CSV file: ${path.basename(this.filename)}`);
        const overallStartTime = process.hrtime.bigint();
        
        try {
            // Validate file first
            if (!this.isValidated) {
                const validation = await this.validateFile();
                if (!validation.isValid) {
                    throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
                }
            }

            // Read entire file
            const fileReadStart = process.hrtime.bigint();
            const csvContent = await fs.readFile(this.filename, 'utf8');
            const fileReadTime = Number(process.hrtime.bigint() - fileReadStart) / 1e9;
            
            console.log(`File loaded: ${(csvContent.length / 1024).toFixed(1)} KB in ${fileReadTime.toFixed(2)}s`);
            
            // Parse CSV with Papa Parse
            const parseStart = process.hrtime.bigint();
            const parseResult = Papa.parse(csvContent, {
                header: true,
                skipEmptyLines: true,
                delimiter: ',', // Try comma first
                dynamicTyping: false, // We'll handle number parsing manually
                transformHeader: (header) => header.trim() // Clean headers
            });
            
            if (parseResult.errors.length > 0) {
                console.warn('CSV parsing warnings:', parseResult.errors);
            }
            
            const parseTime = Number(process.hrtime.bigint() - parseStart) / 1e9;
            
            const rawData = parseResult.data;
            const headers = parseResult.meta.fields;
            
            console.log(`CSV parsed: ${rawData.length} rows, ${headers.length} columns in ${parseTime.toFixed(2)}s`);
            console.log('Headers found:', headers);
            
            // Detect format and map channels
            const formatInfo = this.detectCsvFormat(headers);
            
            if (Object.keys(this.channelMapping).length === 0) {
                throw new Error('No temperature channels detected in CSV file');
            }
            
            // Process data
            console.log('Processing temperature data...');
            const dataProcessStart = process.hrtime.bigint();
            await this.processTemperatureData(rawData, headers);
            const dataProcessTime = Number(process.hrtime.bigint() - dataProcessStart) / 1e9;
            
            // Store comprehensive metadata
            const fileStats = await fs.stat(this.filename);
            this.metadata = {
                filePath: this.filename,
                fileName: path.basename(this.filename),
                fileSize: fileStats.size,
                processedAt: new Date(),
                
                // CSV-specific metadata
                rowCount: rawData.length,
                columnCount: headers.length,
                headers: headers,
                formatInfo: formatInfo,
                channelMapping: this.channelMapping,
                
                // Processing statistics
                processingStats: {
                    ...this.processingStats,
                    fileReadTime,
                    parseTime,
                    dataProcessTime,
                    totalProcessingTime: Number(process.hrtime.bigint() - overallStartTime) / 1e9
                }
            };
            
            console.log(`Temperature data processing completed:`);
            console.log(`- File read: ${fileReadTime.toFixed(2)}s`);
            console.log(`- CSV parse: ${parseTime.toFixed(2)}s`);
            console.log(`- Data process: ${dataProcessTime.toFixed(2)}s`);
            console.log(`- Total: ${this.metadata.processingStats.totalProcessingTime.toFixed(2)}s`);
            console.log(`- Channels: ${Object.keys(this.channelMapping).join(', ')}`);
            
        } catch (error) {
            console.error('Error reading temperature CSV file:', error);
            throw new Error(`Temperature CSV reading failed: ${error.message}`);
        }
    }

    /**
     * Process temperature data from parsed CSV
     * @param {Array} rawData - Parsed CSV data rows
     * @param {Array} headers - CSV column headers
     */
    async processTemperatureData(rawData, headers) {
        if (rawData.length === 0) {
            throw new Error('No data rows found in CSV file');
        }
        
        // Find timestamp column (first column typically)
        const timestampColumnIndex = 0;
        const timestampHeader = headers[timestampColumnIndex];
        
        console.log(`Using timestamp column: "${timestampHeader}" (index ${timestampColumnIndex})`);
        
        // Extract timestamps and convert to numbers
        const timestamps = [];
        const validRowIndices = [];
        
        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            const timestampValue = Object.values(row)[timestampColumnIndex];
            
            if (timestampValue && timestampValue.trim() !== '') {
                const timestamp = this.parseGermanNumber(timestampValue);
                if (!isNaN(timestamp)) {
                    timestamps.push(timestamp);
                    validRowIndices.push(i);
                }
            }
        }
        
        if (timestamps.length === 0) {
            throw new Error('No valid timestamps found in CSV data');
        }
        
        console.log(`Found ${timestamps.length} valid data points out of ${rawData.length} total rows`);
        
        // Convert timestamps to relative time
        const relativeTime = this.convertTimestampsToRelative(timestamps);
        
        // Calculate sampling rate
        let samplingRate = 10.0; // Default 10 Hz
        if (timestamps.length > 1) {
            const avgInterval = (timestamps[timestamps.length - 1] - timestamps[0]) / (timestamps.length - 1);
            samplingRate = 1.0 / avgInterval;
        }
        
        // Process each detected channel
        for (const [channelId, channelInfo] of Object.entries(this.channelMapping)) {
            const columnIndex = channelInfo.columnIndex;
            const values = new Float32Array(validRowIndices.length);
            let validCount = 0;
            
            // Extract temperature values for this channel
            for (let i = 0; i < validRowIndices.length; i++) {
                const rowIndex = validRowIndices[i];
                const row = rawData[rowIndex];
                const cellValue = Object.values(row)[columnIndex];
                
                if (cellValue && cellValue.trim() !== '') {
                    const temperature = this.parseGermanNumber(cellValue);
                    if (!isNaN(temperature)) {
                        values[validCount] = temperature;
                        validCount++;
                    }
                }
            }
            
            // Trim array to actual valid data
            const trimmedValues = new Float32Array(validCount);
            const trimmedTime = new Float32Array(validCount);
            
            for (let i = 0; i < validCount; i++) {
                trimmedValues[i] = values[i];
                trimmedTime[i] = relativeTime[i];
            }
            
            // Store channel data
            this.temperatureData[channelId] = {
                time: trimmedTime,
                values: trimmedValues,
                label: channelInfo.label,
                unit: channelInfo.unit,
                originalHeader: channelInfo.originalHeader,
                columnIndex: channelInfo.columnIndex,
                points: validCount,
                samplingRate: samplingRate,
                channelId: channelId
            };
            
            console.log(`Processed ${channelId}: ${validCount} points, sampling rate: ${samplingRate.toFixed(1)} Hz`);
        }
        
        // Validate we have at least one channel with data
        if (Object.keys(this.temperatureData).length === 0) {
            throw new Error('No temperature channels could be processed');
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

    getTemperatureData() {
        return this.temperatureData;
    }

    getChannelData(channelId) {
        return this.temperatureData[channelId];
    }

    getAllChannels() {
        const allChannels = {
            temperature: {}
        };

        // Add temperature channels
        for (const [channelId, channelData] of Object.entries(this.temperatureData)) {
            allChannels.temperature[channelId] = channelData;
        }

        return allChannels;
    }

    getAvailableChannelIds() {
        return Object.keys(this.temperatureData);
    }

    getChannelMapping() {
        return this.channelMapping;
    }

    hasChannel(channelId) {
        return this.temperatureData.hasOwnProperty(channelId);
    }

    getProcessingStats() {
        const totalPoints = Object.values(this.temperatureData).reduce((sum, ch) => sum + ch.points, 0);
        
        return {
            ...this.processingStats,
            channelCount: Object.keys(this.temperatureData).length,
            totalDataPoints: totalPoints,
            fileSize: this.metadata?.fileSize || 0,
            fileName: path.basename(this.filename)
        };
    }

    /**
     * Get time range across all channels
     * @returns {Object} {min: number, max: number}
     */
    getTimeRange() {
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        for (const channelData of Object.values(this.temperatureData)) {
            if (channelData.time.length > 0) {
                minTime = Math.min(minTime, channelData.time[0]);
                maxTime = Math.max(maxTime, channelData.time[channelData.time.length - 1]);
            }
        }
        
        // Fallback to reasonable defaults
        if (minTime === Infinity) minTime = 0;
        if (maxTime === -Infinity) maxTime = 1;
        
        return { min: minTime, max: maxTime };
    }

    /**
     * Get default display channels (welding channel first)
     * @returns {Array<string>} Ordered channel IDs
     */
    getDefaultDisplayChannels() {
        const channelIds = Object.keys(this.temperatureData);
        const defaultOrder = [];
        
        // Always put welding channel first if available
        if (this.temperatureData['temp_welding']) {
            defaultOrder.push('temp_welding');
        }
        
        // Add other channels in numeric order
        const otherChannels = channelIds
            .filter(id => id !== 'temp_welding')
            .sort((a, b) => {
                // Extract channel numbers for sorting
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
}

module.exports = TemperatureCsvReader;