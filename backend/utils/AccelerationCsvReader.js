/**
 * Acceleration CSV Reader - Dual Format Support
 * Parses acceleration CSV files with automatic format detection
 * Supports both time-based and synthetic time generation
 * Patterns: *_beschleuinigung.csv and daq_download.csv files
 * 
 * Format 1 (4 columns): Time [s], X [m*s^-2], Y [m*s^-2], Z [m*s^-2]
 * Format 2 (3 columns): X [m*s^-2], Y [m*s^-2], Z [m*s^-2]
 */

const fs = require('fs').promises;
const path = require('path');
const Papa = require('papaparse');

class AccelerationCsvReader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.accelerationData = {};
        this.processingStats = {};
        
        // Channel mapping for 3-axis acceleration
        this.channelMapping = {};
        
        // Format detection results
        this.detectedFormat = {
            hasTimeColumn: false,
            columnCount: 0,
            samplingRate: 10000, // Default 10 kHz
            hasHeaders: false
        };
        
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
            } else if (fileSizeMB > 200) {
                errors.push(`File too large: ${fileSizeMB.toFixed(1)}MB (max 200MB)`);
            }

            // Try to read first few lines to validate format
            try {
                const fileHandle = await fs.open(this.filename, 'r');
                const buffer = Buffer.alloc(2048);
                await fileHandle.read(buffer, 0, 2048, 0);
                await fileHandle.close();
                
                const sample = buffer.toString('utf8');
                
                // Check for CSV structure
                if (!sample.includes(',')) {
                    errors.push('File does not appear to be comma-separated CSV format');
                }
                
                // Check for acceleration-related content
                if (!sample.toLowerCase().includes('m*s^-2') && 
                    !sample.toLowerCase().includes('acceleration') &&
                    !this._containsNumericData(sample)) {
                    errors.push('File does not contain expected acceleration data patterns');
                }
                
                console.log(`Acceleration CSV validation - found sample: ${sample.substring(0, 200)}...`);
                
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
     * Check if sample contains numeric data patterns
     * @private
     */
    _containsNumericData(sample) {
        // Look for patterns like scientific notation, decimals, negative numbers
        const numericPatterns = [
            /-?\d+\.\d+/,  // Decimal numbers
            /-?\d+[eE][+-]?\d+/, // Scientific notation
            /-?\d+,\d+/,   // European decimal format
            /^-?\d+$/      // Integers
        ];
        
        return numericPatterns.some(pattern => pattern.test(sample));
    }

    /**
     * Detect CSV format from headers and first data rows
     * @param {string[]} headers - CSV column headers (if any)
     * @param {Object[]} firstRows - First few data rows
     * @returns {Object} Format detection results
     */
    detectCsvFormat(headers, firstRows) {
        console.log('Detecting acceleration CSV format...');
        console.log('Headers found:', headers);
        console.log('Sample data rows:', firstRows.slice(0, 3));
        
        let hasTimeColumn = false;
        let hasHeaders = false;
        let columnCount = 0;
        
        // Check for explicit headers with acceleration units
        if (headers && headers.length > 0) {
            const headerText = headers.join(' ').toLowerCase();
            
            if (headerText.includes('time') && headerText.includes('m*s^-2')) {
                hasHeaders = true;
                hasTimeColumn = true;
                columnCount = headers.length;
                console.log('Detected format: Headers with time column');
            } else if (headerText.includes('x [m*s^-2]') || headerText.includes('acceleration')) {
                hasHeaders = true;
                hasTimeColumn = false;
                columnCount = headers.length;
                console.log('Detected format: Headers without time column');
            }
        }
        
        // If no clear headers, analyze first data rows to find actual data section
        if (!hasHeaders && firstRows.length > 0) {
            // Find first row that looks like actual numeric data
            let dataRowIndex = -1;
            let actualDataRow = null;
            
            for (let i = 0; i < Math.min(firstRows.length, 50); i++) {
                const row = firstRows[i];
                const rowValues = Object.values(row);
                
                // Check if this row has numeric data in expected format
                if (this._isDataRow(rowValues)) {
                    dataRowIndex = i;
                    actualDataRow = row;
                    break;
                }
            }
            
            if (actualDataRow) {
                console.log(`Found actual data row at index ${dataRowIndex}`);
                const dataRowValues = Object.values(actualDataRow);
                columnCount = dataRowValues.length;
                
                if (columnCount === 4) {
                    // Test if first column looks like time (small positive values)
                    const firstValue = this.parseNumber(dataRowValues[0]);
                    if (!isNaN(firstValue) && firstValue >= 0 && firstValue < 10) {
                        hasTimeColumn = true;
                        console.log('Detected format: 4 columns with time (no headers)');
                    } else {
                        hasTimeColumn = false;
                        console.log('Detected format: 4 columns without time (no headers)');
                    }
                } else if (columnCount === 3) {
                    hasTimeColumn = false;
                    console.log('Detected format: 3 columns without time (no headers)');
                } else {
                    console.warn(`Unexpected column count: ${columnCount}`);
                }
            } else {
                console.warn('Could not find actual data rows in sample');
                // Fallback to first row analysis
                const firstRow = firstRows[0];
                const firstRowValues = Object.values(firstRow);
                columnCount = firstRowValues.length;
                
                if (columnCount === 3) {
                    hasTimeColumn = false;
                    console.log('Fallback: Assuming 3 columns without time');
                }
            }
        }
        
        this.detectedFormat = {
            hasTimeColumn: hasTimeColumn,
            columnCount: columnCount,
            hasHeaders: hasHeaders,
            samplingRate: hasTimeColumn ? null : 10000 // Will be calculated or use default
        };
        
        // Set up channel mapping
        this._setupChannelMapping();
        
        return this.detectedFormat;
    }

    /**
     * Check if a row looks like actual numeric data
     * Now works with col_0, col_1, col_2 format
     * @private
     */
    _isDataRow(row) {
        return this._hasValidAccelerationData(row);
    }

    /**
     * Set up channel mapping based on detected format
     * @private
     */
    _setupChannelMapping() {
        const timeOffset = this.detectedFormat.hasTimeColumn ? 1 : 0;
        
        this.channelMapping = {
            'acc_x': {
                originalHeader: this.detectedFormat.hasHeaders ? 'X [m*s^-2]' : 'Column ' + (timeOffset + 1),
                columnIndex: timeOffset + 0, // First data column after optional time
                label: 'Acceleration X',
                unit: 'm/s²',
                axis: 'X'
            },
            'acc_y': {
                originalHeader: this.detectedFormat.hasHeaders ? 'Y [m*s^-2]' : 'Column ' + (timeOffset + 2),
                columnIndex: timeOffset + 1, // Second data column
                label: 'Acceleration Y', 
                unit: 'm/s²',
                axis: 'Y'
            },
            'acc_z': {
                originalHeader: this.detectedFormat.hasHeaders ? 'Z [m*s^-2]' : 'Column ' + (timeOffset + 3),
                columnIndex: timeOffset + 2, // Third data column
                label: 'Acceleration Z',
                unit: 'm/s²',
                axis: 'Z'
            }
        };
        
        console.log('Channel mapping established:', this.channelMapping);
    }

    /**
     * Parse numeric value (handles various formats)
     * @param {string} value - Numeric string
     * @returns {number} Parsed number
     */
    parseNumber(value) {
        if (!value || typeof value !== 'string') {
            return NaN;
        }
        
        // Clean and parse - handle both European and US formats
        const cleaned = value.replace(/"/g, '').trim();
        
        if (cleaned === '') {
            return NaN;
        }
        
        // Handle European format (comma as decimal separator)
        let normalized = cleaned;
        if (cleaned.includes(',') && !cleaned.includes('.')) {
            normalized = cleaned.replace(',', '.');
        }
        
        const number = parseFloat(normalized);
        return isNaN(number) ? NaN : number;
    }

    /**
     * Generate synthetic time array for format without time column
     * @param {number} dataLength - Number of data points
     * @param {number} samplingIntervalUs - Sampling interval in microseconds
     * @returns {Float32Array} Time array in microseconds
     */
    generateSyntheticTime(dataLength, samplingIntervalUs = 100) {
        const timeArray = new Float32Array(dataLength);
        
        for (let i = 0; i < dataLength; i++) {
            timeArray[i] = i * samplingIntervalUs; // Microseconds from start
        }
        
        console.log(`Generated synthetic time array: ${dataLength} points at ${samplingIntervalUs}µs intervals`);
        return timeArray;
    }

    /**
     * Convert time array from seconds to microseconds
     * @param {number[]} timeSeconds - Time in seconds
     * @returns {Float32Array} Time in microseconds
     */
    convertTimeToMicroseconds(timeSeconds) {
        const timeUs = new Float32Array(timeSeconds.length);
        
        // Normalize to start from 0 and convert to microseconds
        const startTime = timeSeconds[0] || 0;
        
        for (let i = 0; i < timeSeconds.length; i++) {
            timeUs[i] = (timeSeconds[i] - startTime) * 1_000_000; // Convert to microseconds
        }
        
        return timeUs;
    }

    /**
     * Main file reading method
     * @returns {Promise<void>}
     */
    async readFile() {
        console.log(`Reading acceleration CSV file: ${path.basename(this.filename)}`);
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
            
            // Parse CSV with Papa Parse - AUTO-DETECT DELIMITER
            const parseStart = process.hrtime.bigint();
            
            // First, try to detect the delimiter
            let delimiter = ','; // Default to comma
            const sampleLines = fileContent.split('\n').slice(0, 20);
            
            // Count delimiters in sample lines to detect format
            let commaCount = 0;
            let tabCount = 0;
            let semicolonCount = 0;
            
            for (const line of sampleLines) {
                if (line.includes('\t')) tabCount++;
                if (line.includes(',')) commaCount++;
                if (line.includes(';')) semicolonCount++;
            }
            
            console.log(`Delimiter detection: commas=${commaCount}, tabs=${tabCount}, semicolons=${semicolonCount}`);
            
            // Choose the most common delimiter
            if (tabCount > commaCount && tabCount > semicolonCount) {
                delimiter = '\t';
                console.log('Using tab delimiter');
            } else if (semicolonCount > commaCount && semicolonCount > tabCount) {
                delimiter = ';';
                console.log('Using semicolon delimiter');
            } else {
                console.log('Using comma delimiter');
            }
            
            const parseResult = Papa.parse(fileContent, {
                header: false, // DON'T use first line as header - let us find the real headers
                skipEmptyLines: true,
                delimiter: delimiter, // Use detected delimiter
                dynamicTyping: false, // We'll handle number parsing manually
                comments: '#' // Skip comment lines
            });
            
            if (parseResult.errors.length > 0) {
                console.warn('CSV parsing warnings:', parseResult.errors.slice(0, 5)); // Show first 5 errors only
            }
            
            const parseTime = Number(process.hrtime.bigint() - parseStart) / 1e9;
            const rawData = parseResult.data;
            
            console.log(`CSV parsed: ${rawData.length} rows, ${rawData[0]?.length || 0} columns in ${parseTime.toFixed(2)}s`);
            
            // Convert array format to object format for easier processing
            const processedData = rawData.map((row, index) => {
                const obj = {};
                row.forEach((value, colIndex) => {
                    obj[`col_${colIndex}`] = value;
                });
                return obj;
            });
            
            console.log(`Sample rows after processing:`, processedData.slice(0, 3));
            
            // Detect format using the processed data
            const formatInfo = this.detectCsvFormat(null, processedData.slice(0, 100)); // Check more rows for format detection
            
            // Process data
            console.log('Processing acceleration data...');
            const dataProcessStart = process.hrtime.bigint();
            await this.processAccelerationData(processedData, null); // No headers since we're parsing manually
            const dataProcessTime = Number(process.hrtime.bigint() - dataProcessStart) / 1e9;
            
            // Store comprehensive metadata
            const fileStats = await fs.stat(this.filename);
            this.metadata = {
                filePath: this.filename,
                fileName: path.basename(this.filename),
                fileSize: fileStats.size,
                processedAt: new Date(),
                
                // CSV-specific metadata
                rowCount: processedData.length,
                columnCount: processedData[0]?.length || 0,
                headers: [], // No predefined headers
                formatInfo: formatInfo,
                channelMapping: this.channelMapping,
                detectedFormat: this.detectedFormat,
                
                // Processing statistics
                processingStats: {
                    ...this.processingStats,
                    fileReadTime,
                    parseTime,
                    dataProcessTime,
                    totalProcessingTime: Number(process.hrtime.bigint() - overallStartTime) / 1e9
                }
            };
            
            console.log(`Acceleration data processing completed:`);
            console.log(`- File read: ${fileReadTime.toFixed(2)}s`);
            console.log(`- CSV parse: ${parseTime.toFixed(2)}s`);
            console.log(`- Data process: ${dataProcessTime.toFixed(2)}s`);
            console.log(`- Total: ${this.metadata.processingStats.totalProcessingTime.toFixed(2)}s`);
            console.log(`- Channels: ${Object.keys(this.channelMapping).join(', ')}`);
            console.log(`- Format: ${this.detectedFormat.hasTimeColumn ? 'With time column' : 'Without time column'}`);
            
        } catch (error) {
            console.error('Error reading acceleration CSV file:', error);
            throw new Error(`Acceleration CSV reading failed: ${error.message}`);
        }
    }

    /**
     * Process acceleration data from parsed CSV
     * @param {Array} rawData - Parsed CSV data rows
     * @param {Array} headers - CSV column headers
     */
    async processAccelerationData(rawData, headers) {
        if (rawData.length === 0) {
            throw new Error('No data rows found in CSV file');
        }
        
        // Filter out header/metadata rows if they exist in data
        const filteredData = this._filterMetadataRows(rawData);
        console.log(`Filtered data: ${rawData.length} -> ${filteredData.length} rows`);
        
        // Extract time data (if present)
        let timeData = null;
        let samplingIntervalUs = 100; // Default 100µs (10 kHz)
        
        if (this.detectedFormat.hasTimeColumn) {
            timeData = this._extractTimeData(filteredData);
            if (timeData && timeData.length > 1) {
                // Calculate actual sampling interval from time data
                const avgInterval = (timeData[timeData.length - 1] - timeData[0]) / (timeData.length - 1);
                samplingIntervalUs = avgInterval; // Already in microseconds
                console.log(`Calculated sampling interval from time data: ${samplingIntervalUs.toFixed(1)}µs`);
            }
        } else {
            // Generate synthetic time array
            timeData = this.generateSyntheticTime(filteredData.length, samplingIntervalUs);
            console.log(`Generated synthetic time array for ${filteredData.length} samples at ${samplingIntervalUs}µs intervals`);
        }
        
        // Calculate sampling rate
        const samplingRate = 1_000_000 / samplingIntervalUs; // Hz
        this.detectedFormat.samplingRate = samplingRate;
        
        // Extract acceleration data for each axis
        const axesData = this._extractAccelerationAxes(filteredData);
        
        // Validate data consistency
        const minLength = Math.min(timeData.length, axesData.x.length, axesData.y.length, axesData.z.length);
        console.log(`Data length consistency check: time=${timeData.length}, x=${axesData.x.length}, y=${axesData.y.length}, z=${axesData.z.length} -> using ${minLength}`);
        
        // Create final typed arrays with consistent length
        const finalTime = new Float32Array(minLength);
        const finalX = new Float32Array(minLength);
        const finalY = new Float32Array(minLength);
        const finalZ = new Float32Array(minLength);
        
        for (let i = 0; i < minLength; i++) {
            finalTime[i] = timeData[i];
            finalX[i] = axesData.x[i] || 0;
            finalY[i] = axesData.y[i] || 0;
            finalZ[i] = axesData.z[i] || 0;
        }
        
        // Store acceleration data for each channel
        this.accelerationData['acc_x'] = {
            time: finalTime,
            values: finalX,
            label: 'Acceleration X',
            unit: 'm/s²',
            originalHeader: this.channelMapping['acc_x'].originalHeader,
            columnIndex: this.channelMapping['acc_x'].columnIndex,
            points: minLength,
            samplingRate: samplingRate,
            channelId: 'acc_x',
            axis: 'X'
        };
        
        this.accelerationData['acc_y'] = {
            time: finalTime, // Same time array for all channels
            values: finalY,
            label: 'Acceleration Y',
            unit: 'm/s²',
            originalHeader: this.channelMapping['acc_y'].originalHeader,
            columnIndex: this.channelMapping['acc_y'].columnIndex,
            points: minLength,
            samplingRate: samplingRate,
            channelId: 'acc_y',
            axis: 'Y'
        };
        
        this.accelerationData['acc_z'] = {
            time: finalTime, // Same time array for all channels
            values: finalZ,
            label: 'Acceleration Z',
            unit: 'm/s²',
            originalHeader: this.channelMapping['acc_z'].originalHeader,
            columnIndex: this.channelMapping['acc_z'].columnIndex,
            points: minLength,
            samplingRate: samplingRate,
            channelId: 'acc_z',
            axis: 'Z'
        };
        
        console.log(`Acceleration data processed: ${minLength} points at ${samplingRate.toFixed(1)} Hz`);
        console.log(`Time range: ${finalTime[0].toFixed(2)} to ${finalTime[finalTime.length - 1].toFixed(2)} µs`);
        
        // Log sample values for verification
        if (minLength > 0) {
            console.log(`Sample values at start: X=${finalX[0].toFixed(3)}, Y=${finalY[0].toFixed(3)}, Z=${finalZ[0].toFixed(3)}`);
        } else {
            console.warn('No data points processed - all arrays are empty');
        }
        
        // Validate we have at least one channel with data
        if (Object.keys(this.accelerationData).length === 0) {
            throw new Error('No acceleration channels could be processed');
        }
    }

    /**
     * Filter out metadata/header rows that might be mixed with data
     * Now works with col_0, col_1, col_2 format
     * @private
     */
    _filterMetadataRows(rawData) {
        console.log(`Filtering metadata rows from ${rawData.length} total rows...`);
        
        let actualDataRows = [];
        let foundDataStart = false;
        
        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            const col0 = row.col_0 ? row.col_0.toString().trim() : '';
            const col1 = row.col_1 ? row.col_1.toString().trim() : '';
            const col2 = row.col_2 ? row.col_2.toString().trim() : '';
            
            // Skip device information headers and similar
            if (!foundDataStart) {
                // Look for the actual time/data header or first numeric row
                if (col0.toLowerCase().includes('time') || 
                    (!isNaN(parseFloat(col0)) && parseFloat(col0) >= 0 && col1 && col2)) {
                    foundDataStart = true;
                    
                    // If this row has "Time" header, skip it and start from next row
                    if (col0.toLowerCase().includes('time')) {
                        console.log(`Found column headers at row ${i}: "${col0}, ${col1}, ${col2}", starting data from next row`);
                        continue;
                    }
                    // If this is already a numeric row, include it
                    console.log(`Found data start at row ${i}: "${col0}, ${col1}, ${col2}"`);
                }
            }
            
            if (foundDataStart) {
                // Only include rows that have numeric data in all 3 columns (or 4 with time)
                if (this._hasValidAccelerationData(row)) {
                    actualDataRows.push(row);
                }
            }
        }
        
        console.log(`Filtered: ${rawData.length} -> ${actualDataRows.length} data rows`);
        
        return actualDataRows;
    }

    /**
     * Check if row has valid acceleration data (3 or 4 numeric columns)
     * @private
     */
    _hasValidAccelerationData(row) {
        const col0 = row.col_0 ? row.col_0.toString().trim() : '';
        const col1 = row.col_1 ? row.col_1.toString().trim() : '';
        const col2 = row.col_2 ? row.col_2.toString().trim() : '';
        const col3 = row.col_3 ? row.col_3.toString().trim() : '';
        
        // Check for 4-column format (Time, X, Y, Z)
        const col0Num = parseFloat(col0);
        const col1Num = parseFloat(col1);
        const col2Num = parseFloat(col2);
        const col3Num = parseFloat(col3);
        
        if (!isNaN(col0Num) && !isNaN(col1Num) && !isNaN(col2Num) && !isNaN(col3Num)) {
            return true; // 4-column format
        }
        
        // Check for 3-column format (X, Y, Z)
        if (!isNaN(col0Num) && !isNaN(col1Num) && !isNaN(col2Num)) {
            return true; // 3-column format
        }
        
        return false;
    }

    /**
     * Extract time data from CSV rows
     * Updated for col_0, col_1, col_2 format
     * @private
     */
    _extractTimeData(filteredData) {
        const timeValues = [];
        
        for (const row of filteredData) {
            const timeValue = this.parseNumber(row.col_0); // First column should be time
            
            if (!isNaN(timeValue)) {
                timeValues.push(timeValue);
            }
        }
        
        // Convert from seconds to microseconds
        return this.convertTimeToMicroseconds(timeValues);
    }

    /**
     * Extract acceleration data for all three axes
     * Updated to work with col_0, col_1, col_2 format
     * @private
     */
    _extractAccelerationAxes(filteredData) {
        const xValues = [];
        const yValues = [];
        const zValues = [];
        
        const timeOffset = this.detectedFormat.hasTimeColumn ? 1 : 0;
        
        for (const row of filteredData) {
            let x, y, z;
            
            if (timeOffset === 1) {
                // 4-column format: Time, X, Y, Z
                x = this.parseNumber(row.col_1);
                y = this.parseNumber(row.col_2);
                z = this.parseNumber(row.col_3);
            } else {
                // 3-column format: X, Y, Z
                x = this.parseNumber(row.col_0);
                y = this.parseNumber(row.col_1);
                z = this.parseNumber(row.col_2);
            }
            
            // Only include rows where all three axes have valid data
            if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                xValues.push(x);
                yValues.push(y);
                zValues.push(z);
            }
        }
        
        return {
            x: xValues,
            y: yValues,
            z: zValues
        };
    }

    // === PUBLIC DATA ACCESS METHODS ===

    getMetadata() {
        return {
            ...this.metadata,
            processingStats: this.processingStats,
            isValidated: this.isValidated,
            validationErrors: this.validationErrors,
            detectedFormat: this.detectedFormat
        };
    }

    getAccelerationData() {
        return this.accelerationData;
    }

    getChannelData(channelId) {
        return this.accelerationData[channelId];
    }

    getAllChannels() {
        const allChannels = {
            acceleration: {}
        };

        // Add acceleration channels
        for (const [channelId, channelData] of Object.entries(this.accelerationData)) {
            allChannels.acceleration[channelId] = channelData;
        }

        return allChannels;
    }

    getAvailableChannelIds() {
        return Object.keys(this.accelerationData);
    }

    getChannelMapping() {
        return this.channelMapping;
    }

    hasChannel(channelId) {
        return this.accelerationData.hasOwnProperty(channelId);
    }

    getProcessingStats() {
        const totalPoints = Object.values(this.accelerationData).reduce((sum, ch) => sum + ch.points, 0);
        
        return {
            ...this.processingStats,
            channelCount: Object.keys(this.accelerationData).length,
            totalDataPoints: totalPoints,
            fileSize: this.metadata?.fileSize || 0,
            fileName: path.basename(this.filename),
            detectedFormat: this.detectedFormat
        };
    }

    /**
     * Get time range across all channels
     * @returns {Object} {min: number, max: number} in microseconds
     */
    getTimeRange() {
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        for (const channelData of Object.values(this.accelerationData)) {
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
     * Get default display channels (ordered by importance)
     * @returns {Array<string>} Default channel order
     */
    getDefaultDisplayChannels() {
        return ['acc_x', 'acc_y', 'acc_z'];
    }
}

module.exports = AccelerationCsvReader;