/**
 * Crown Journal Reader - Mini Journal Parser
 * Lightweight parser to extract only the 3 crown-related lines from schweissjournal.txt
 * Handles semicolon-delimited format: value;description;unit
 * Future-proof design for easy API integration when full journal parser exists
 */

const fs = require('fs').promises;
const path = require('path');

class CrownJournalReader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.processingStats = {};
        
        // Crown-specific line patterns to search for
        this.crownLinePatterns = {
            crownEinlaufSeiteWarm: /CrownEinlaufSeiteWarm/i,     // Warm inlet measurement (N18 equivalent)
            crownAuslaufSeiteWarm: /CrownAuslaufSeiteWarm/i,     // Warm outlet measurement (J18 equivalent)
            zeitabstandCrownMessung: /ZeitabstandCrownMessung/i  // Time after welding (not interval)
        };
        
        // Validation flags
        this.isValidated = false;
        this.validationErrors = [];
        
        console.log(`Crown Journal Reader initialized for: ${path.basename(filename)}`);
    }

    /**
     * Validate journal file before processing
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
                errors.push(`Journal file not found: ${this.filename}`);
                return { isValid: false, errors };
            }

            // Check file size
            const stats = await fs.stat(this.filename);
            const fileSizeKB = stats.size / 1024;
            
            if (stats.size === 0) {
                errors.push('Journal file is empty');
            } else if (fileSizeKB > 1024) { // Journal files should be small text files
                errors.push(`Journal file unusually large: ${fileSizeKB.toFixed(1)}KB (expected < 1MB)`);
            }

            // Check file extension and name
            const fileName = path.basename(this.filename).toLowerCase();
            if (fileName !== 'schweissjournal.txt') {
                errors.push(`Unexpected journal file name: ${fileName} (expected schweissjournal.txt)`);
            }

            // Try to read first few lines to validate format
            try {
                const fileHandle = await fs.open(this.filename, 'r');
                const buffer = Buffer.alloc(500); // Read first 500 bytes
                await fileHandle.read(buffer, 0, 500, 0);
                await fileHandle.close();
                
                const sample = buffer.toString('utf8');
                
                // Check for semicolon separation (journal format)
                if (!sample.includes(';')) {
                    errors.push('Journal file does not appear to be semicolon-separated');
                }
                
                // Check for at least one crown-related line
                const hasCrownData = Object.values(this.crownLinePatterns).some(pattern => 
                    pattern.test(sample)
                );
                
                if (!hasCrownData) {
                    errors.push('Journal file does not contain crown measurement data');
                }
                
                console.log(`Journal validation - found sample: ${sample.substring(0, 150)}...`);
                
            } catch (error) {
                errors.push(`Cannot read journal file content: ${error.message}`);
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
            errors.push(`Journal validation error: ${error.message}`);
            return { isValid: false, errors };
        }
    }

    /**
     * Parse German decimal format (comma to dot)
     * @param {string} value - String value from journal
     * @returns {number|null} Parsed number or null
     */
    parseGermanNumber(value) {
        if (!value || typeof value !== 'string') {
            return null;
        }
        
        const cleaned = value.trim();
        if (cleaned === '' || cleaned === 'x' || cleaned === 'X') {
            return null;
        }
        
        // Replace German decimal comma with dot
        const normalized = cleaned.replace(',', '.');
        const number = parseFloat(normalized);
        
        return isNaN(number) ? null : number;
    }

    /**
     * Parse semicolon-delimited journal line
     * Format: value;description;unit
     * @param {string} line - Journal line
     * @returns {Object|null} Parsed line data
     */
    parseJournalLine(line) {
        if (!line || typeof line !== 'string') {
            return null;
        }
        
        const trimmedLine = line.trim();
        if (trimmedLine === '') {
            return null;
        }
        
        try {
            // Split by semicolon
            const parts = trimmedLine.split(';');
            
            if (parts.length < 2) {
                return null; // Need at least value and description
            }
            
            const value = parts[0] ? parts[0].trim() : '';
            const description = parts[1] ? parts[1].trim() : '';
            const unit = parts[2] ? parts[2].trim() : '';
            
            return {
                value: value,
                description: description,
                unit: unit,
                numericValue: this.parseGermanNumber(value),
                originalLine: trimmedLine
            };
            
        } catch (error) {
            console.warn(`Error parsing journal line "${line}":`, error.message);
            return null;
        }
    }

    /**
     * Check if line matches crown pattern
     * @param {Object} parsedLine - Parsed line data
     * @returns {string|null} Crown field name if match found
     */
    matchCrownPattern(parsedLine) {
        if (!parsedLine || !parsedLine.description) {
            return null;
        }
        
        const description = parsedLine.description;
        
        // Check each crown pattern
        for (const [fieldName, pattern] of Object.entries(this.crownLinePatterns)) {
            if (pattern.test(description)) {
                return fieldName;
            }
        }
        
        return null;
    }

    /**
     * Read crown data from journal file (mini parser)
     * Only processes the 3 crown-related lines, ignores everything else
     * @returns {Promise<Object>} Crown data from journal
     */
    async readCrownData() {
        console.log(`Reading crown data from journal: ${path.basename(this.filename)}`);
        const overallStartTime = process.hrtime.bigint();
        
        try {
            // Validate file first
            if (!this.isValidated) {
                const validation = await this.validateFile();
                if (!validation.isValid) {
                    throw new Error(`Journal validation failed: ${validation.errors.join(', ')}`);
                }
            }

            // Read entire file
            const fileReadStart = process.hrtime.bigint();
            const fileContent = await fs.readFile(this.filename, 'utf8');
            const fileReadTime = Number(process.hrtime.bigint() - fileReadStart) / 1e9;
            
            console.log(`Journal file loaded: ${(fileContent.length / 1024).toFixed(1)} KB in ${fileReadTime.toFixed(3)}s`);
            
            // Process lines to find crown data
            console.log('Processing journal lines for crown measurements...');
            const dataProcessStart = process.hrtime.bigint();
            const crownData = await this.processCrownLines(fileContent);
            const dataProcessTime = Number(process.hrtime.bigint() - dataProcessStart) / 1e9;
            
            // Store comprehensive metadata
            const fileStats = await fs.stat(this.filename);
            this.metadata = {
                filePath: this.filename,
                fileName: path.basename(this.filename),
                fileSize: fileStats.size,
                processedAt: new Date(),
                
                // Journal-specific metadata
                linesProcessed: crownData.linesProcessed,
                crownLinesFound: crownData.crownLinesFound,
                totalFileLines: fileContent.split('\n').length,
                
                // Processing statistics
                processingStats: {
                    ...this.processingStats,
                    fileReadTime,
                    dataProcessTime,
                    totalProcessingTime: Number(process.hrtime.bigint() - overallStartTime) / 1e9
                }
            };
            
            console.log(`Crown journal processing completed:`);
            console.log(`- File read: ${fileReadTime.toFixed(3)}s`);
            console.log(`- Data process: ${dataProcessTime.toFixed(3)}s`);
            console.log(`- Total: ${this.metadata.processingStats.totalProcessingTime.toFixed(3)}s`);
            console.log(`- Lines processed: ${crownData.linesProcessed}`);
            console.log(`- Crown lines found: ${crownData.crownLinesFound}`);
            
            return {
                warmMeasurements: crownData.warmMeasurements,
                metadata: this.metadata
            };
            
        } catch (error) {
            console.error('Error reading crown journal data:', error);
            throw new Error(`Crown journal reading failed: ${error.message}`);
        }
    }

    /**
     * Process journal lines to extract crown measurements
     * @param {string} fileContent - Journal file content
     * @returns {Promise<Object>} Processed crown data
     */
    async processCrownLines(fileContent) {
        const lines = fileContent.split('\n');
        
        console.log(`Processing ${lines.length} journal lines for crown data...`);
        
        const result = {
            warmMeasurements: {
                crownEinlaufSeiteWarm: null,     // N18 warm equivalent
                crownAuslaufSeiteWarm: null,     // J18 warm equivalent
                zeitabstandCrownMessung: null    // Time after welding
            },
            linesProcessed: 0,
            crownLinesFound: 0,
            foundLines: []
        };
        
        let lineNumber = 0;
        
        for (const line of lines) {
            lineNumber++;
            result.linesProcessed++;
            
            // Skip empty lines
            if (!line || line.trim() === '') {
                continue;
            }
            
            // Parse journal line
            const parsedLine = this.parseJournalLine(line);
            if (!parsedLine) {
                continue;
            }
            
            // Check if this line matches a crown pattern
            const crownField = this.matchCrownPattern(parsedLine);
            if (crownField) {
                result.crownLinesFound++;
                
                // Store the measurement
                result.warmMeasurements[crownField] = parsedLine.numericValue;
                
                // Keep track of found lines for debugging
                result.foundLines.push({
                    lineNumber: lineNumber,
                    field: crownField,
                    value: parsedLine.numericValue,
                    unit: parsedLine.unit,
                    originalLine: parsedLine.originalLine
                });
                
                console.log(`Found crown measurement: ${crownField} = ${parsedLine.numericValue} ${parsedLine.unit} (line ${lineNumber})`);
                
                // Early exit if we found all 3 crown measurements
                if (result.crownLinesFound >= 3) {
                    console.log('All crown measurements found, stopping line processing');
                    break;
                }
            }
        }
        
        // Validate we found the expected crown measurements
        this.validateCrownData(result);
        
        console.log(`Crown line processing complete:`);
        console.log(`- Total lines processed: ${result.linesProcessed}`);
        console.log(`- Crown lines found: ${result.crownLinesFound}`);
        console.log(`- CrownEinlaufSeiteWarm: ${result.warmMeasurements.crownEinlaufSeiteWarm} mm`);
        console.log(`- CrownAuslaufSeiteWarm: ${result.warmMeasurements.crownAuslaufSeiteWarm} mm`);
        console.log(`- ZeitabstandCrownMessung: ${result.warmMeasurements.zeitabstandCrownMessung} min`);
        
        return result;
    }

    /**
     * Validate crown data for completeness and reasonableness
     * @param {Object} crownData - Processed crown data
     */
    validateCrownData(crownData) {
        const warnings = [];
        const errors = [];
        
        const measurements = crownData.warmMeasurements;
        
        // Check if we found the critical warm measurements
        if (measurements.crownEinlaufSeiteWarm === null) {
            warnings.push('CrownEinlaufSeiteWarm (warm inlet) measurement not found');
        }
        if (measurements.crownAuslaufSeiteWarm === null) {
            warnings.push('CrownAuslaufSeiteWarm (warm outlet) measurement not found');
        }
        if (measurements.zeitabstandCrownMessung === null) {
            warnings.push('ZeitabstandCrownMessung (measurement time) not found');
        }
        
        // Check for reasonable measurement values
        const crownValues = [
            measurements.crownEinlaufSeiteWarm,
            measurements.crownAuslaufSeiteWarm
        ].filter(v => v !== null);
        
        if (crownValues.length > 0) {
            const minValue = Math.min(...crownValues);
            const maxValue = Math.max(...crownValues);
            
            // Crown measurements should typically be small positive values
            if (minValue < 0 || maxValue > 50) {
                warnings.push(`Crown measurements outside expected range: ${minValue.toFixed(3)} to ${maxValue.toFixed(3)} mm`);
            }
        }
        
        // Check measurement time reasonableness
        if (measurements.zeitabstandCrownMessung !== null) {
            const timeValue = measurements.zeitabstandCrownMessung;
            if (timeValue < 0 || timeValue > 60) {
                warnings.push(`ZeitabstandCrownMessung outside expected range: ${timeValue} minutes (expected 0-60)`);
            }
        }
        
        // Check if we found any crown data at all
        if (crownData.crownLinesFound === 0) {
            errors.push('No crown measurement lines found in journal file');
        }
        
        // Log validation results
        if (warnings.length > 0) {
            console.warn('Crown journal validation warnings:');
            warnings.forEach(warning => console.warn(`  - ${warning}`));
        }
        
        if (errors.length > 0) {
            console.error('Crown journal validation errors:');
            errors.forEach(error => console.error(`  - ${error}`));
            throw new Error(`Crown journal validation failed: ${errors.join(', ')}`);
        }
        
        if (warnings.length === 0 && errors.length === 0) {
            console.log('Crown journal validation passed');
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

    getWarmMeasurements() {
        return this.crownData?.warmMeasurements || {};
    }

    getProcessingStats() {
        return {
            ...this.processingStats,
            linesProcessed: this.metadata?.linesProcessed || 0,
            crownLinesFound: this.metadata?.crownLinesFound || 0,
            fileName: path.basename(this.filename),
            fileSize: this.metadata?.fileSize || 0,
            
            // Journal-specific stats
            totalFileLines: this.metadata?.totalFileLines || 0,
            processingEfficiency: this.metadata?.linesProcessed && this.metadata?.totalFileLines ? 
                (this.metadata.linesProcessed / this.metadata.totalFileLines * 100).toFixed(1) + '%' : '0%'
        };
    }

    /**
     * Get crown measurement summary for logging/debugging
     * @returns {Object} Summary of warm measurements
     */
    getMeasurementSummary() {
        if (!this.crownData) return null;
        
        const measurements = this.crownData.warmMeasurements;
        
        return {
            warmMeasurements: {
                inlet: measurements.crownEinlaufSeiteWarm,    // N18 warm equivalent
                outlet: measurements.crownAuslaufSeiteWarm,   // J18 warm equivalent
                measurementTime: measurements.zeitabstandCrownMessung,
                available: Object.values(measurements).filter(v => v !== null).length,
                complete: Object.values(measurements).every(v => v !== null)
            },
            correspondingColdCells: {
                inlet: 'N18', // CrownEinlaufSeiteWarm corresponds to N18
                outlet: 'J18' // CrownAuslaufSeiteWarm corresponds to J18
            }
        };
    }

    /**
     * Future API integration method (placeholder)
     * TODO: Replace direct file reading with API calls when full journal parser exists
     * @returns {Promise<Object>} Crown data from API
     */
    async readCrownDataFromAPI() {
        // Future implementation when full journal parser API is available
        console.log('API integration not yet implemented - using direct file reading');
        
        // When implemented, this would replace the file reading with:
        // const response = await fetch(`/api/experiments/${experimentId}/journal-data/crown`);
        // return response.json();
        
        throw new Error('API integration not yet implemented');
    }

    /**
     * Check if should use API vs file reading (future enhancement)
     * @returns {boolean} True if API should be used
     */
    shouldUseAPI() {
        // Future logic to determine if full journal parser API is available
        // For now, always use direct file reading
        return false;
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.crownData = null;
        console.log(`Crown journal reader cleanup completed`);
    }
}

module.exports = CrownJournalReader;