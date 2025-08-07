/**
 * Position CSV Reader - Tab-Delimited Format (Fixed Stack Overflow)
 * Parses position CSV files with datetime handling and tab separation
 * Format: snapshot_optoNCDT-ILD1220_*.csv files
 * Columns: DateTime, UnixTime, RawPosition (tab-separated)
 * 
 * Fixed: Uses Papa Parse and single-pass processing to avoid stack overflow on large files
 */

const fs = require('fs').promises;
const path = require('path');
const Papa = require('papaparse');

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
            
            // Parse CSV with Papa Parse (configured for tab-delimited)
            const parseStart = process.hrtime.bigint();
            const parseResult = Papa.parse(fileContent, {
                header: false, // Position CSV has no headers
                skipEmptyLines: true,
                delimiter: '\t', // Tab-delimited
                dynamicTyping: false, // We'll handle parsing manually
                comments: '#' // Skip comment lines
            });
            
            if (parseResult.errors.length > 0) {
                console.warn('CSV parsing warnings:', parseResult.errors.slice(0, 5)); // Show first 5 errors only
            }
            
            const parseTime = Number(process.hrtime.bigint() - parseStart) / 1e9;
            const rawData = parseResult.data;
            
            console.log(`CSV parsed: ${rawData.length} rows in ${parseTime.toFixed(2)}s`);
            
            // Process data in single pass
            console.log('Processing position data...');
            const dataProcessStart = process.hrtime.bigint();
            await this.processPositionData(rawData);
            const dataProcessTime = Number(process.hrtime.bigint() - dataProcessStart) / 1e9;
            
            // Store comprehensive metadata
            const fileStats = await fs.stat(this.filename);
            this.metadata = {
                filePath: this.filename,
                fileName: path.basename(this.filename),
                fileSize: fileStats.size,
                processedAt: new Date(),
                
                // CSV-specific metadata
                totalLines: rawData.length,
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
     * Process position data from parsed CSV - SINGLE PASS VERSION
     * @param {Array} rawData - Papa Parse data rows (array of arrays)
     */
    async processPositionData(rawData) {
        if (rawData.length === 0) {
            throw new Error('No data rows found in CSV file');
        }
        
        console.log(`Processing ${rawData.length} CSV rows...`);
        
        // Pre-allocate arrays with estimated size (we'll trim later)
        const maxRows = rawData.length;
        const tempRelativeTime = new Array(maxRows);
        const tempTransformedPositions = new Array(maxRows);
        const tempDatetimes = new Array(maxRows);
        const tempUnixTimes = new Array(maxRows);
        
        let validCount = 0;
        let skippedCount = 0;
        let startUnixTime = null;
        
        // Single pass through all data
        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            
            // Skip rows that don't have 3 columns
            if (!row || row.length < 3) {
                skippedCount++;
                continue;
            }
            
            try {
                // Parse datetime (field 0)
                const datetime = this.parseDateTime(row[0]);
                if (!datetime) {
                    skippedCount++;
                    if (validCount < 5) {
                        console.warn(`Row ${i + 1}: Invalid datetime format: "${row[0]}"`);
                    }
                    continue;
                }
                
                // Parse unix time (field 1)
                const unixTime = this.parseNumber(row[1]);
                if (isNaN(unixTime)) {
                    skippedCount++;
                    if (validCount < 5) {
                        console.warn(`Row ${i + 1}: Invalid unix time: "${row[1]}"`);
                    }
                    continue;
                }
                
                // Parse raw position (field 2)
                const rawPosition = this.parseNumber(row[2]);
                if (isNaN(rawPosition)) {
                    skippedCount++;
                    if (validCount < 5) {
                        console.warn(`Row ${i + 1}: Invalid position value: "${row[2]}"`);
                    }
                    continue;
                }
                
                // Set start time on first valid record
                if (startUnixTime === null) {
                    startUnixTime = unixTime;
                }
                
                // Store data - do all transformations in single pass
                tempDatetimes[validCount] = datetime;
                tempUnixTimes[validCount] = unixTime;
                
                // Convert to relative time (microseconds from start)
                tempRelativeTime[validCount] = (unixTime - startUnixTime) * 1000;
                
                // Transform position (apply -1 * raw + 49.73)
                tempTransformedPositions[validCount] = -1 * rawPosition + 49.73;
                
                validCount++;
                
                if (validCount <= 5) {
                    console.log(`Row ${i + 1}: DateTime=${datetime.toISOString()}, UnixTime=${unixTime}, RawPos=${rawPosition}, TransformedPos=${tempTransformedPositions[validCount - 1].toFixed(3)}`);
                }
                
            } catch (error) {
                skippedCount++;
                if (validCount < 5) {
                    console.warn(`Row ${i + 1}: Parse error: ${error.message}`);
                }
                continue;
            }
        }
        
        if (validCount === 0) {
            throw new Error('No valid data rows found in CSV file');
        }
        
        console.log(`Processing complete: ${validCount} valid rows, ${skippedCount} skipped`);
        
        // Create final typed arrays with exact size
        const finalRelativeTime = new Float32Array(validCount);
        const finalTransformedPositions = new Float32Array(validCount);
        
        for (let i = 0; i < validCount; i++) {
            finalRelativeTime[i] = tempRelativeTime[i];
            finalTransformedPositions[i] = tempTransformedPositions[i];
        }
        
        // Calculate sampling rate (approximate)
        let samplingRate = 1000.0; // Default 1 kHz
        if (validCount > 1) {
            const totalTime = tempUnixTimes[validCount - 1] - tempUnixTimes[0];
            const avgInterval = totalTime / (validCount - 1);
            samplingRate = avgInterval > 0 ? 1.0 / avgInterval : 1000.0;
        }
        
        // Store position data
        this.positionData['pos_x'] = {
            time: finalRelativeTime,
            values: finalTransformedPositions,
            label: 'Position X',
            unit: 'mm',
            originalHeader: 'Raw Position',
            points: validCount,
            samplingRate: samplingRate,
            channelId: 'pos_x',
            
            // Additional metadata
            rawTimeRange: {
                start: tempUnixTimes[0],
                end: tempUnixTimes[validCount - 1],
                duration: tempUnixTimes[validCount - 1] - tempUnixTimes[0]
            },
            datetimeRange: {
                start: tempDatetimes[0],
                end: tempDatetimes[validCount - 1]
            }
        };
        
        // Set up channel mapping
        this.channelMapping['pos_x'] = {
            originalHeader: 'Raw Position',
            columnIndex: 2, // Third column (0-based)
            label: 'Position X',
            unit: 'mm'
        };
        
        // Calculate min/max without spread operator to avoid stack overflow
        let minPos = finalTransformedPositions[0];
        let maxPos = finalTransformedPositions[0];
        for (let i = 1; i < finalTransformedPositions.length; i++) {
            if (finalTransformedPositions[i] < minPos) minPos = finalTransformedPositions[i];
            if (finalTransformedPositions[i] > maxPos) maxPos = finalTransformedPositions[i];
        }
        
        console.log(`Position data processed: ${validCount} points, sampling rate: ${samplingRate.toFixed(1)} Hz`);
        console.log(`Time range: ${finalRelativeTime[0].toFixed(2)} to ${finalRelativeTime[finalRelativeTime.length - 1].toFixed(2)} µs`);
        console.log(`Position range: ${minPos.toFixed(3)} to ${maxPos.toFixed(3)} mm`);
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