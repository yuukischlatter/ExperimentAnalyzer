/**
 * Position CSV Reader - Tab-Delimited Format
 * Parses position CSV files with datetime handling and tab separation
 * Format: snapshot_optoNCDT-ILD1220_*.csv files
 * Columns: DateTime, UnixTime, RawPosition (tab-separated)
 */

const fs = require('fs').promises;
const path = require('path');

class PositionCsvReader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.positionData = {};
        this.processingStats = {};
        
        // Channel data for single position channel
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
            } else if (fileSizeMB > 50) {
                errors.push(`File too large: ${fileSizeMB.toFixed(1)}MB (max 50MB)`);
            }

            // Try to read first few lines to validate format
            try {
                const fileHandle = await fs.open(this.filename, 'r');
                const buffer = Buffer.alloc(2048);
                await fileHandle.read(buffer, 0, 2048, 0);
                await fileHandle.close();
                
                const sample = buffer.toString('utf8');
                
                // Check for tab separation
                if (!sample.includes('\t')) {
                    errors.push('File does not appear to be tab-separated');
                }
                
                // Check for datetime pattern
                const datetimePattern = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}/;
                if (!datetimePattern.test(sample)) {
                    errors.push('File does not contain expected datetime format (yyyy-MM-dd HH:mm:ss.ffffff)');
                }
                
                console.log(`Position CSV validation - found sample: ${sample.substring(0, 200)}...`);
                
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
     * Parse datetime string with microsecond precision
     * Format: "yyyy-MM-dd HH:mm:ss.ffffff"
     * @param {string} datetimeStr - DateTime string
     * @returns {Date|null} Parsed date object
     */
    parseDateTime(datetimeStr) {
        if (!datetimeStr || typeof datetimeStr !== 'string') {
            return null;
        }
        
        try {
            // Clean the string
            const cleaned = datetimeStr.trim();
            
            // Parse with microsecond precision: "2025-07-30 10:15:30.123456"
            const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{6})$/);
            if (!match) {
                return null;
            }
            
            const [, year, month, day, hour, minute, second, microseconds] = match;
            
            // Create date object (month is 0-based in JavaScript)
            const date = new Date(
                parseInt(year), 
                parseInt(month) - 1, 
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second),
                Math.floor(parseInt(microseconds) / 1000) // Convert microseconds to milliseconds
            );
            
            // Validate the created date
            if (isNaN(date.getTime())) {
                return null;
            }
            
            return date;
            
        } catch (error) {
            console.warn(`Error parsing datetime "${datetimeStr}":`, error.message);
            return null;
        }
    }

    /**
     * Parse numeric value (position or time)
     * @param {string} value - Numeric string
     * @returns {number} Parsed number
     */
    parseNumber(value) {
        if (!value || typeof value !== 'string') {
            return NaN;
        }
        
        // Clean and parse
        const cleaned = value.trim().replace(/"/g, '');
        
        if (cleaned === '') {
            return NaN;
        }
        
        const number = parseFloat(cleaned);
        return isNaN(number) ? NaN : number;
    }

    /**
     * Convert Unix timestamps to relative microseconds
     * @param {number[]} timestamps - Array of Unix timestamps
     * @returns {Float32Array} Relative time in microseconds from start
     */
    convertTimestampsToRelative(timestamps) {
        if (!timestamps || timestamps.length === 0) {
            return new Float32Array(0);
        }
        
        const startTime = timestamps[0];
        const relativeTime = new Float32Array(timestamps.length);
        
        // Process in chunks to avoid stack overflow
        const chunkSize = 10000;
        for (let i = 0; i < timestamps.length; i += chunkSize) {
            const end = Math.min(i + chunkSize, timestamps.length);
            for (let j = i; j < end; j++) {
                relativeTime[j] = (timestamps[j] - startTime) * 1000;
            }
        }
        
        return relativeTime;
    }

    /**
     * Apply position transformation
     * Formula from C#: final_position = -1 * raw_position + 49.73
     * @param {number[]} rawPositions - Array of raw position values
     * @returns {Float32Array} Transformed position values
     */
    transformPositions(rawPositions) {
        if (!rawPositions || rawPositions.length === 0) {
            return new Float32Array(0);
        }
        
        const transformedPositions = new Float32Array(rawPositions.length);
        
        // Process in chunks to avoid stack overflow
        const chunkSize = 10000;
        for (let i = 0; i < rawPositions.length; i += chunkSize) {
            const end = Math.min(i + chunkSize, rawPositions.length);
            for (let j = i; j < end; j++) {
                transformedPositions[j] = -1 * rawPositions[j] + 49.73;
            }
        }
        
        return transformedPositions;
    }

    /**
     * Main file reading method
     * @returns {Promise<void>}
     */
    async readFile() {
        console.log(`Reading position CSV file: ${path.basename(this.filename)}`);
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
            const fileContent = await fs.readFile(this.filename, 'utf8');
            const fileReadTime = Number(process.hrtime.bigint() - fileReadStart) / 1e9;
            
            console.log(`File loaded: ${(fileContent.length / 1024).toFixed(1)} KB in ${fileReadTime.toFixed(2)}s`);
            
            // Split into lines
            const parseStart = process.hrtime.bigint();
            const lines = fileContent.split('\n');
            const parseTime = Number(process.hrtime.bigint() - parseStart) / 1e9;
            
            console.log(`File split into ${lines.length} lines in ${parseTime.toFixed(2)}s`);
            
            // Process lines
            console.log('Processing position data...');
            const dataProcessStart = process.hrtime.bigint();
            await this.processPositionData(lines);
            const dataProcessTime = Number(process.hrtime.bigint() - dataProcessStart) / 1e9;
            
            // Store comprehensive metadata
            const fileStats = await fs.stat(this.filename);
            this.metadata = {
                filePath: this.filename,
                fileName: path.basename(this.filename),
                fileSize: fileStats.size,
                processedAt: new Date(),
                
                // CSV-specific metadata
                totalLines: lines.length,
                validDataLines: this.positionData.pos_x ? this.positionData.pos_x.points : 0,
                formatInfo: {
                    type: 'position_tab_delimited',
                    delimiter: '\t',
                    columns: ['datetime', 'unix_time', 'raw_position'],
                    hasHeader: false,
                    commentPrefix: '#'
                },
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
            
            console.log(`Position data processing completed:`);
            console.log(`- File read: ${fileReadTime.toFixed(2)}s`);
            console.log(`- Parse: ${parseTime.toFixed(2)}s`);
            console.log(`- Data process: ${dataProcessTime.toFixed(2)}s`);
            console.log(`- Total: ${this.metadata.processingStats.totalProcessingTime.toFixed(2)}s`);
            console.log(`- Valid data points: ${this.positionData.pos_x ? this.positionData.pos_x.points : 0}`);
            
        } catch (error) {
            console.error('Error reading position CSV file:', error);
            throw new Error(`Position CSV reading failed: ${error.message}`);
        }
    }

    /**
     * Process position data from CSV lines
     * @param {Array} lines - Array of CSV lines
     */
    async processPositionData(lines) {
        if (lines.length === 0) {
            throw new Error('No lines found in CSV file');
        }
        
        const datetimes = [];
        const unixTimes = [];
        const rawPositions = [];
        
        let validLines = 0;
        let skippedLines = 0;
        
        console.log('Parsing CSV lines...');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines
            if (!line) {
                continue;
            }
            
            // Skip comment lines (start with #)
            if (line.startsWith('#')) {
                skippedLines++;
                continue;
            }
            
            // Split by tab
            const fields = line.split('\t');
            
            if (fields.length < 3) {
                skippedLines++;
                if (validLines < 5) {
                    console.warn(`Line ${i + 1}: Expected 3 fields, got ${fields.length}: "${line.substring(0, 100)}"`);
                }
                continue;
            }
            
            try {
                // Parse datetime (field 0)
                const datetime = this.parseDateTime(fields[0]);
                if (!datetime) {
                    skippedLines++;
                    if (validLines < 5) {
                        console.warn(`Line ${i + 1}: Invalid datetime format: "${fields[0]}"`);
                    }
                    continue;
                }
                
                // Parse unix time (field 1)
                const unixTime = this.parseNumber(fields[1]);
                if (isNaN(unixTime)) {
                    skippedLines++;
                    if (validLines < 5) {
                        console.warn(`Line ${i + 1}: Invalid unix time: "${fields[1]}"`);
                    }
                    continue;
                }
                
                // Parse raw position (field 2)
                const rawPosition = this.parseNumber(fields[2]);
                if (isNaN(rawPosition)) {
                    skippedLines++;
                    if (validLines < 5) {
                        console.warn(`Line ${i + 1}: Invalid position value: "${fields[2]}"`);
                    }
                    continue;
                }
                
                // Store valid data
                datetimes.push(datetime);
                unixTimes.push(unixTime);
                rawPositions.push(rawPosition);
                
                validLines++;
                
                if (validLines <= 5) {
                    console.log(`Line ${i + 1}: DateTime=${datetime.toISOString()}, UnixTime=${unixTime}, RawPos=${rawPosition}`);
                }
                
            } catch (error) {
                skippedLines++;
                if (validLines < 5) {
                    console.warn(`Line ${i + 1}: Parse error: ${error.message}`);
                }
                continue;
            }
        }
        
        if (validLines === 0) {
            throw new Error('No valid data lines found in CSV file');
        }
        
        console.log(`Parsing complete: ${validLines} valid lines, ${skippedLines} skipped`);
        
        // Convert to relative time (microseconds from start)
        console.log('Converting timestamps to relative time...');
        const relativeTime = this.convertTimestampsToRelative(unixTimes);
        
        // Transform positions (apply -1 * raw + 49.73)
        console.log('Transforming position values...');
        const transformedPositions = this.transformPositions(rawPositions);
        
        // Calculate sampling rate (approximate)
        let samplingRate = 1000.0; // Default 1 kHz
        if (unixTimes.length > 1) {
            const totalTime = unixTimes[unixTimes.length - 1] - unixTimes[0];
            const avgInterval = totalTime / (unixTimes.length - 1);
            samplingRate = avgInterval > 0 ? 1.0 / avgInterval : 1000.0;
        }
        
        // Store position data
        this.positionData['pos_x'] = {
            time: relativeTime,
            values: transformedPositions,
            label: 'Position X',
            unit: 'mm',
            originalHeader: 'Raw Position',
            points: validLines,
            samplingRate: samplingRate,
            channelId: 'pos_x',
            
            // Additional metadata
            rawTimeRange: {
                start: unixTimes[0],
                end: unixTimes[unixTimes.length - 1],
                duration: unixTimes[unixTimes.length - 1] - unixTimes[0]
            },
            datetimeRange: {
                start: datetimes[0],
                end: datetimes[datetimes.length - 1]
            }
        };
        
        // Set up channel mapping
        this.channelMapping['pos_x'] = {
            originalHeader: 'Raw Position',
            columnIndex: 2, // Third column (0-based)
            label: 'Position X',
            unit: 'mm'
        };
        
        console.log(`Position data processed: ${validLines} points, sampling rate: ${samplingRate.toFixed(1)} Hz`);
        console.log(`Time range: ${relativeTime[0].toFixed(2)} to ${relativeTime[relativeTime.length - 1].toFixed(2)} µs`);
        console.log(`Position range: ${Math.min(...transformedPositions).toFixed(3)} to ${Math.max(...transformedPositions).toFixed(3)} mm`);
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

    getPositionData() {
        return this.positionData;
    }

    getChannelData(channelId) {
        return this.positionData[channelId];
    }

    getAllChannels() {
        const allChannels = {
            position: {}
        };

        // Add position channel
        for (const [channelId, channelData] of Object.entries(this.positionData)) {
            allChannels.position[channelId] = channelData;
        }

        return allChannels;
    }

    getAvailableChannelIds() {
        return Object.keys(this.positionData);
    }

    getChannelMapping() {
        return this.channelMapping;
    }

    hasChannel(channelId) {
        return this.positionData.hasOwnProperty(channelId);
    }

    getProcessingStats() {
        const totalPoints = Object.values(this.positionData).reduce((sum, ch) => sum + ch.points, 0);
        
        return {
            ...this.processingStats,
            channelCount: Object.keys(this.positionData).length,
            totalDataPoints: totalPoints,
            fileSize: this.metadata?.fileSize || 0,
            fileName: path.basename(this.filename)
        };
    }

    /**
     * Get time range across all channels (should be just one: pos_x)
     * @returns {Object} {min: number, max: number}
     */
    getTimeRange() {
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        for (const channelData of Object.values(this.positionData)) {
            if (channelData.time.length > 0) {
                minTime = Math.min(minTime, channelData.time[0]);
                maxTime = Math.max(maxTime, channelData.time[channelData.time.length - 1]);
            }
        }
        
        // Fallback to reasonable defaults
        if (minTime === Infinity) minTime = 0;
        if (maxTime === -Infinity) maxTime = 1000; // 1ms default
        
        return { min: minTime, max: maxTime };
    }

    /**
     * Get default display channels
     * @returns {Array<string>} Default channel order (just pos_x)
     */
    getDefaultDisplayChannels() {
        return ['pos_x'];
    }
}

module.exports = PositionCsvReader;