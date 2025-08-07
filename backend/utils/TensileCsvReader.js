/**
 * Tensile CSV Reader - Multi-Section Format Parser
 * Parses tensile testing CSV files with metadata header and coordinate pair data
 * Format: Semicolon-delimited with {X=value, Y=value} coordinate pairs
 * 
 * File Structure:
 * 1. Metadata header (2 rows) - Test parameters and specimen info
 * 2. Empty row separator  
 * 3. Data section headers (FORCE/WAY DATA;FORCE/TIME DATA;WAY/TIME DATA)
 * 4. Coordinate pair data rows
 */

const fs = require('fs').promises;
const path = require('path');
const Papa = require('papaparse');

class TensileCsvReader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.tensileData = {};
        this.processingStats = {};
        
        // Parsed sections
        this.headerMetadata = {};
        this.coordinateData = [];
        
        // Channel data for API
        this.channelMapping = {};
        
        // Validation flags
        this.isValidated = false;
        this.validationErrors = [];
        
        // Expected metadata fields (German headers)
        this.expectedHeaders = [
            'Test-Nr.',
            'Schienentyp',
            'Bemerkung Schienentyp', 
            'Bemerkung Test',
            'Deformations Weg [mm]',
            'Min. Deformation [mm]',
            'Nominale Testkraft [kN]',
            'Min. Kraft-Limite [kN]',
            'gew. Schienenmark.',
            'Konvaven Schienenmark.',
            'Nr. Schweissmaschine',
            'Name/Nr. Schweisser',
            'Materialgüte',
            'Datum',
            'Geprueft von'
        ];
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
            } else if (fileSizeMB > 10) { // Tensile files should be smaller
                errors.push(`File too large: ${fileSizeMB.toFixed(1)}MB (max 10MB for tensile data)`);
            }

            // Try to read first few lines to validate format
            try {
                const fileHandle = await fs.open(this.filename, 'r');
                const buffer = Buffer.alloc(1024);
                await fileHandle.read(buffer, 0, 1024, 0);
                await fileHandle.close();
                
                const sample = buffer.toString('utf8');
                
                // Check for semicolon separation
                if (!sample.includes(';')) {
                    errors.push('File does not appear to be semicolon-separated');
                }
                
                // Check for expected headers
                if (!sample.includes('Test-Nr.')) {
                    errors.push('File does not contain expected tensile CSV headers');
                }
                
                // Check for coordinate pair format
                if (!sample.includes('{X=') || !sample.includes('Y=')) {
                    errors.push('File does not contain expected coordinate pair format {X=value, Y=value}');
                }
                
                console.log(`Tensile CSV validation - found sample: ${sample.substring(0, 200)}...`);
                
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
     * Parse German date format with time
     * Format: "31.07.2025 14:53:00"
     * @param {string} dateTimeStr - German datetime string
     * @returns {Date|null} Parsed date object
     */
    parseGermanDateTime(dateTimeStr) {
        if (!dateTimeStr || typeof dateTimeStr !== 'string') {
            return null;
        }
        
        try {
            const cleaned = dateTimeStr.trim();
            
            // Parse format: "DD.MM.YYYY HH:mm:ss"
            const match = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
            if (!match) {
                console.warn(`Could not parse German datetime: "${dateTimeStr}"`);
                return null;
            }
            
            const [, day, month, year, hour, minute, second] = match;
            
            // Create date object (month is 0-based in JavaScript)
            const date = new Date(
                parseInt(year), 
                parseInt(month) - 1, 
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
            );
            
            // Validate the created date
            if (isNaN(date.getTime())) {
                console.warn(`Invalid date created from: "${dateTimeStr}"`);
                return null;
            }
            
            return date;
            
        } catch (error) {
            console.warn(`Error parsing German datetime "${dateTimeStr}":`, error.message);
            return null;
        }
    }

    /**
     * Parse coordinate pair string: "{X=0.013733, Y=2.268685}"
     * @param {string} coordStr - Coordinate string
     * @returns {Object|null} {x: number, y: number}
     */
    parseCoordinatePair(coordStr) {
        if (!coordStr || typeof coordStr !== 'string') {
            return null;
        }
        
        try {
            const cleaned = coordStr.trim();
            
            // Parse format: {X=number, Y=number}
            const match = cleaned.match(/\{X=([0-9.-]+),\s*Y=([0-9.-]+)\}/);
            if (!match) {
                return null;
            }
            
            const x = parseFloat(match[1]);
            const y = parseFloat(match[2]);
            
            if (isNaN(x) || isNaN(y)) {
                return null;
            }
            
            return { x, y };
            
        } catch (error) {
            console.warn(`Error parsing coordinate pair "${coordStr}":`, error.message);
            return null;
        }
    }

    /**
     * Parse numeric value with validation
     * @param {string} value - Numeric string
     * @returns {number|null} Parsed number or null
     */
    parseNumber(value) {
        if (!value || typeof value !== 'string') {
            return null;
        }
        
        const cleaned = value.trim();
        if (cleaned === '') {
            return null;
        }
        
        const number = parseFloat(cleaned);
        return isNaN(number) ? null : number;
    }

    /**
     * Main file reading method
     * @returns {Promise<void>}
     */
    async readFile() {
        console.log(`Reading tensile CSV file: ${path.basename(this.filename)}`);
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
            
            // Parse CSV with Papa Parse (semicolon-delimited)
            const parseStart = process.hrtime.bigint();
            const parseResult = Papa.parse(fileContent, {
                header: false,
                skipEmptyLines: false, // We need to detect the empty separator row
                delimiter: ';',
                dynamicTyping: false, // We'll handle parsing manually
                comments: false // No comment support in tensile files
            });
            
            if (parseResult.errors.length > 0) {
                console.warn('CSV parsing warnings:', parseResult.errors.slice(0, 3));
            }
            
            const parseTime = Number(process.hrtime.bigint() - parseStart) / 1e9;
            const rawData = parseResult.data;
            
            console.log(`CSV parsed: ${rawData.length} rows in ${parseTime.toFixed(2)}s`);
            
            // Process the multi-section format
            console.log('Processing tensile data sections...');
            const dataProcessStart = process.hrtime.bigint();
            await this.processTensileFile(rawData);
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
                validDataLines: this.coordinateData.length,
                formatInfo: {
                    type: 'tensile_semicolon_delimited',
                    delimiter: ';',
                    sections: ['metadata_header', 'empty_separator', 'data_headers', 'coordinate_data'],
                    coordinateFormat: '{X=value, Y=value}',
                    hasHeader: true
                },
                
                // Parsed header metadata
                headerMetadata: this.headerMetadata,
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
            
            console.log(`Tensile data processing completed:`);
            console.log(`- File read: ${fileReadTime.toFixed(2)}s`);
            console.log(`- Parse: ${parseTime.toFixed(2)}s`);
            console.log(`- Data process: ${dataProcessTime.toFixed(2)}s`);
            console.log(`- Total: ${this.metadata.processingStats.totalProcessingTime.toFixed(2)}s`);
            console.log(`- Valid coordinate pairs: ${this.coordinateData.length}`);
            console.log(`- Channels created: ${Object.keys(this.tensileData).length}`);
            
        } catch (error) {
            console.error('Error reading tensile CSV file:', error);
            throw new Error(`Tensile CSV reading failed: ${error.message}`);
        }
    }

    /**
     * Process the multi-section tensile file format
     * @param {Array} rawData - Papa Parse data rows (array of arrays)
     */
    async processTensileFile(rawData) {
        if (rawData.length < 5) {
            throw new Error('Tensile CSV file too short - expected at least 5 rows (header + data)');
        }
        
        console.log(`Processing ${rawData.length} CSV rows in multi-section format...`);
        
        // Section 1: Parse metadata header (rows 0-1)
        this.parseMetadataHeader(rawData[0], rawData[1]);
        
        // Section 2: Empty separator row (row 2) - just validate
        if (rawData[2] && rawData[2].length > 0 && rawData[2][0].trim() !== '') {
            console.warn('Expected empty separator row at index 2, but found content:', rawData[2]);
        }
        
        // Section 3: Data headers (row 3)
        this.validateDataHeaders(rawData[3]);
        
        // Section 4: Coordinate data (rows 4+)
        this.parseCoordinateData(rawData.slice(4));
        
        // Create channels from coordinate data
        this.createChannelsFromCoordinates();
        
        console.log(`Tensile file processing complete:`);
        console.log(`- Metadata fields parsed: ${Object.keys(this.headerMetadata).length}`);
        console.log(`- Coordinate pairs processed: ${this.coordinateData.length}`);
        console.log(`- Channels created: ${Object.keys(this.tensileData).length}`);
    }

    /**
     * Parse metadata header from first two rows
     * @param {Array} headerRow - Column headers (row 0)
     * @param {Array} dataRow - Data values (row 1)
     */
    parseMetadataHeader(headerRow, dataRow) {
        if (!headerRow || !dataRow) {
            throw new Error('Missing metadata header rows');
        }
        
        console.log(`Parsing metadata header: ${headerRow.length} fields`);
        
        // Parse each field
        for (let i = 0; i < Math.min(headerRow.length, dataRow.length); i++) {
            const fieldName = headerRow[i] ? headerRow[i].trim() : '';
            const fieldValue = dataRow[i] ? dataRow[i].trim() : '';
            
            if (fieldName === '') continue;
            
            // Parse specific fields with type conversion
            switch (fieldName) {
                case 'Test-Nr.':
                    this.headerMetadata.testNumber = fieldValue;
                    break;
                case 'Schienentyp':
                    this.headerMetadata.railType = fieldValue;
                    break;
                case 'Bemerkung Schienentyp':
                    this.headerMetadata.railTypeComment = fieldValue;
                    break;
                case 'Bemerkung Test':
                    this.headerMetadata.testComment = fieldValue;
                    break;
                case 'Deformations Weg [mm]':
                    this.headerMetadata.deformationDistance = this.parseNumber(fieldValue);
                    break;
                case 'Min. Deformation [mm]':
                    this.headerMetadata.minDeformation = this.parseNumber(fieldValue);
                    break;
                case 'Nominale Testkraft [kN]':
                    this.headerMetadata.nominalForce = this.parseNumber(fieldValue);
                    break;
                case 'Min. Kraft-Limite [kN]':
                    this.headerMetadata.minForceLimit = this.parseNumber(fieldValue);
                    break;
                case 'gew. Schienenmark.':
                    this.headerMetadata.railMark = fieldValue;
                    break;
                case 'Konvaven Schienenmark.':
                    this.headerMetadata.convexRailMark = fieldValue;
                    break;
                case 'Nr. Schweissmaschine':
                    this.headerMetadata.weldingMachineNumber = fieldValue;
                    break;
                case 'Name/Nr. Schweisser':
                    this.headerMetadata.welderName = fieldValue;
                    break;
                case 'Materialgüte':
                    this.headerMetadata.materialGrade = fieldValue;
                    break;
                case 'Datum':
                    this.headerMetadata.testDate = this.parseGermanDateTime(fieldValue);
                    this.headerMetadata.testDateString = fieldValue; // Keep original
                    break;
                case 'Geprueft von':
                    this.headerMetadata.testedBy = fieldValue;
                    break;
                default:
                    // Store unknown fields as-is
                    this.headerMetadata[fieldName] = fieldValue;
                    break;
            }
        }
        
        console.log(`Metadata parsed - Test: ${this.headerMetadata.testNumber}, Material: ${this.headerMetadata.materialGrade}, Force: ${this.headerMetadata.nominalForce}kN`);
    }

    /**
     * Validate data section headers
     * @param {Array} headerRow - Expected: ['FORCE/WAY DATA', 'FORCE/TIME DATA', 'WAY/TIME DATA']
     */
    validateDataHeaders(headerRow) {
        if (!headerRow || headerRow.length < 3) {
            throw new Error('Missing or incomplete data section headers');
        }
        
        const expectedHeaders = ['FORCE/WAY DATA', 'FORCE/TIME DATA', 'WAY/TIME DATA'];
        const actualHeaders = headerRow.slice(0, 3).map(h => h ? h.trim() : '');
        
        for (let i = 0; i < 3; i++) {
            if (actualHeaders[i] !== expectedHeaders[i]) {
                console.warn(`Data header mismatch at column ${i}: expected "${expectedHeaders[i]}", got "${actualHeaders[i]}"`);
            }
        }
        
        console.log(`Data headers validated: ${actualHeaders.join(', ')}`);
    }

    /**
     * Parse coordinate data from remaining rows
     * @param {Array} dataRows - Rows containing coordinate pairs
     */
    parseCoordinateData(dataRows) {
        console.log(`Parsing coordinate data from ${dataRows.length} rows...`);
        
        let validRows = 0;
        let skippedRows = 0;
        
        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            
            // Skip empty rows
            if (!row || row.length < 3) {
                skippedRows++;
                continue;
            }
            
            try {
                // Parse three coordinate pairs
                const forceWayPair = this.parseCoordinatePair(row[0]);      // {X=displacement, Y=force}
                const forceTimePair = this.parseCoordinatePair(row[1]);     // {X=time, Y=force}
                const wayTimePair = this.parseCoordinatePair(row[2]);       // {X=time, Y=displacement}
                
                // Validate that we got valid pairs
                if (!forceWayPair || !forceTimePair || !wayTimePair) {
                    skippedRows++;
                    if (validRows < 3) {
                        console.warn(`Row ${i + 5}: Invalid coordinate pairs - ${row.slice(0, 3)}`);
                    }
                    continue;
                }
                
                // Validate data consistency (forces should match, times should match)
                const forceMatch = Math.abs(forceWayPair.y - forceTimePair.y) < 0.001;
                const timeMatch = Math.abs(forceTimePair.x - wayTimePair.x) < 0.001;
                const displacementMatch = Math.abs(forceWayPair.x - wayTimePair.y) < 0.001;
                
                if (!forceMatch || !timeMatch || !displacementMatch) {
                    console.warn(`Row ${i + 5}: Data consistency warning - Force/Time/Displacement mismatch`);
                }
                
                // Store validated coordinate data
                this.coordinateData.push({
                    index: validRows,
                    force: forceWayPair.y,        // kN
                    displacement: forceWayPair.x,  // mm
                    time: forceTimePair.x,        // s
                    
                    // Store original pairs for debugging
                    forceWayPair,
                    forceTimePair,
                    wayTimePair
                });
                
                validRows++;
                
                if (validRows <= 3) {
                    console.log(`Row ${i + 5}: t=${forceTimePair.x}s, F=${forceWayPair.y}kN, d=${forceWayPair.x}mm`);
                }
                
            } catch (error) {
                skippedRows++;
                if (validRows < 3) {
                    console.warn(`Row ${i + 5}: Parse error: ${error.message}`);
                }
                continue;
            }
        }
        
        if (validRows === 0) {
            throw new Error('No valid coordinate data found in CSV file');
        }
        
        console.log(`Coordinate parsing complete: ${validRows} valid rows, ${skippedRows} skipped`);
    }

    /**
     * Create channel data from parsed coordinates
     * Creates 3 channels: force_kN, displacement_mm, force_vs_displacement
     */
    createChannelsFromCoordinates() {
        if (this.coordinateData.length === 0) {
            throw new Error('No coordinate data available for channel creation');
        }
        
        console.log(`Creating channels from ${this.coordinateData.length} coordinate points...`);
        
        const dataCount = this.coordinateData.length;
        
        // Pre-allocate typed arrays for performance
        const timeArray = new Float32Array(dataCount);
        const forceArray = new Float32Array(dataCount);
        const displacementArray = new Float32Array(dataCount);
        
        // Fill arrays
        for (let i = 0; i < dataCount; i++) {
            const point = this.coordinateData[i];
            timeArray[i] = point.time;
            forceArray[i] = point.force;
            displacementArray[i] = point.displacement;
        }
        
        // Calculate sampling rate
        let samplingRate = 1.0; // Default 1 Hz
        if (dataCount > 1) {
            const totalTime = timeArray[dataCount - 1] - timeArray[0];
            const avgInterval = totalTime / (dataCount - 1);
            samplingRate = avgInterval > 0 ? 1.0 / avgInterval : 1.0;
        }
        
        // Channel 1: Force over time (time-series)
        this.tensileData['force_kN'] = {
            time: timeArray,
            values: forceArray,
            label: 'Force',
            unit: 'kN',
            originalHeader: 'FORCE/TIME DATA',
            points: dataCount,
            samplingRate: samplingRate,
            channelId: 'force_kN',
            type: 'time_series'
        };
        
        // Channel 2: Displacement over time (time-series)
        this.tensileData['displacement_mm'] = {
            time: timeArray,
            values: displacementArray,
            label: 'Displacement',
            unit: 'mm',
            originalHeader: 'WAY/TIME DATA',
            points: dataCount,
            samplingRate: samplingRate,
            channelId: 'displacement_mm',
            type: 'time_series'
        };
        
        // Channel 3: Force vs Displacement (XY relationship)
        this.tensileData['force_vs_displacement'] = {
            x: displacementArray,
            y: forceArray,
            xLabel: 'Displacement',
            yLabel: 'Force',
            xUnit: 'mm',
            yUnit: 'kN',
            originalHeader: 'FORCE/WAY DATA',
            points: dataCount,
            channelId: 'force_vs_displacement',
            type: 'xy_relationship'
        };
        
        // Set up channel mapping
        this.channelMapping = {
            'force_kN': {
                originalHeader: 'FORCE/TIME DATA',
                columnIndex: 1,
                label: 'Force',
                unit: 'kN',
                type: 'time_series'
            },
            'displacement_mm': {
                originalHeader: 'WAY/TIME DATA',
                columnIndex: 2,
                label: 'Displacement',
                unit: 'mm',
                type: 'time_series'
            },
            'force_vs_displacement': {
                originalHeader: 'FORCE/WAY DATA',
                columnIndex: 0,
                label: 'Force vs Displacement',
                xUnit: 'mm',
                yUnit: 'kN',
                type: 'xy_relationship'
            }
        };
        
        console.log(`Channels created successfully:`);
        console.log(`- force_kN: ${this.tensileData['force_kN'].points} points, ${samplingRate.toFixed(2)} Hz`);
        console.log(`- displacement_mm: ${this.tensileData['displacement_mm'].points} points`);
        console.log(`- force_vs_displacement: ${this.tensileData['force_vs_displacement'].points} XY pairs`);
        
        // Log data ranges for validation
        const forceRange = [Math.min(...forceArray), Math.max(...forceArray)];
        const dispRange = [Math.min(...displacementArray), Math.max(...displacementArray)];
        const timeRange = [timeArray[0], timeArray[timeArray.length - 1]];
        
        console.log(`Data ranges: Force ${forceRange[0].toFixed(2)}-${forceRange[1].toFixed(2)} kN, Displacement ${dispRange[0].toFixed(3)}-${dispRange[1].toFixed(3)} mm, Time ${timeRange[0].toFixed(2)}-${timeRange[1].toFixed(2)} s`);
    }

    // === PUBLIC DATA ACCESS METHODS ===

    getMetadata() {
        return {
            ...this.metadata,
            headerMetadata: this.headerMetadata,
            processingStats: this.processingStats,
            isValidated: this.isValidated,
            validationErrors: this.validationErrors
        };
    }

    getTensileData() {
        return this.tensileData;
    }

    getChannelData(channelId) {
        return this.tensileData[channelId];
    }

    getAllChannels() {
        const allChannels = {
            timeSeries: {},
            xyRelationship: {}
        };

        // Group channels by type
        for (const [channelId, channelData] of Object.entries(this.tensileData)) {
            if (channelData.type === 'time_series') {
                allChannels.timeSeries[channelId] = channelData;
            } else if (channelData.type === 'xy_relationship') {
                allChannels.xyRelationship[channelId] = channelData;
            }
        }

        return allChannels;
    }

    getAvailableChannelIds() {
        return Object.keys(this.tensileData);
    }

    getChannelMapping() {
        return this.channelMapping;
    }

    hasChannel(channelId) {
        return this.tensileData.hasOwnProperty(channelId);
    }

    getProcessingStats() {
        const totalPoints = Object.values(this.tensileData).reduce((sum, ch) => sum + ch.points, 0);
        
        return {
            ...this.processingStats,
            channelCount: Object.keys(this.tensileData).length,
            totalDataPoints: totalPoints,
            coordinateDataPoints: this.coordinateData.length,
            fileSize: this.metadata?.fileSize || 0,
            fileName: path.basename(this.filename),
            
            // Tensile-specific stats
            testMetadata: {
                testNumber: this.headerMetadata.testNumber,
                materialGrade: this.headerMetadata.materialGrade,
                nominalForce: this.headerMetadata.nominalForce,
                testDate: this.headerMetadata.testDateString
            }
        };
    }

    /**
     * Get time range across time-series channels
     * @returns {Object} {min: number, max: number}
     */
    getTimeRange() {
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        for (const channelData of Object.values(this.tensileData)) {
            if (channelData.type === 'time_series' && channelData.time && channelData.time.length > 0) {
                minTime = Math.min(minTime, channelData.time[0]);
                maxTime = Math.max(maxTime, channelData.time[channelData.time.length - 1]);
            }
        }
        
        // Fallback to reasonable defaults
        if (minTime === Infinity) minTime = 0;
        if (maxTime === -Infinity) maxTime = 10; // 10 seconds default
        
        return { min: minTime, max: maxTime };
    }

    /**
     * Get default display channels
     * @returns {Array<string>} Default channel order
     */
    getDefaultDisplayChannels() {
        return ['force_kN', 'displacement_mm', 'force_vs_displacement'];
    }

    /**
     * Get header metadata (parsed from first two rows)
     * @returns {Object} Parsed header metadata
     */
    getHeaderMetadata() {
        return this.headerMetadata;
    }

    /**
     * Get raw coordinate data for debugging
     * @returns {Array} Array of coordinate data objects
     */
    getCoordinateData() {
        return this.coordinateData;
    }
}

module.exports = TensileCsvReader;