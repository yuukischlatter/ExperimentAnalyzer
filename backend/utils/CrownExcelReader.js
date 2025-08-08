/**
 * Crown Excel Reader - Geradheit+Versatz.xlsx Parser
 * Reads crown measurement data from Excel file using xlsx library
 * Extracts cold measurements (J18, N18), top view measurements (J23-N32), and calculated AD values
 * Handles German decimal format and provides structured data for crown analysis
 */

const XLSX = require('xlsx');
const fs = require('fs').promises;
const path = require('path');

class CrownExcelReader {
    constructor(filename) {
        this.filename = filename;
        this.workbook = null;
        this.worksheet = null;
        this.metadata = {};
        
        // Excel cell mappings based on Python script analysis
        this.cellMappings = {
            // Cold side measurements (side view heights)
            coldSideMeasurements: {
                'J18': 'J18', // Outlet height measurement
                'N18': 'N18'  // Inlet height measurement
            },
            
            // Top view measurements (lateral deviations)
            topViewMeasurements: {
                'J23': 'J23', 'N23': 'N23', // Inner rail measurements
                'J24': 'J24', 'N24': 'N24', // Outer rail measurements  
                'J31': 'J31', 'N31': 'N31', // Outer rail measurements (negative Y)
                'J32': 'J32', 'N32': 'N32'  // Inner rail measurements (negative Y)
            },
            
            // Calculated values from AD cells
            calculatedValues: {
                'höhenversatz': 'AD19',           // Height offset
                'crown': 'AD21',                  // Crown measurement
                'seitenversatzKopfA': 'AD24',     // Lateral offset head A
                'seitenversatzFussA': 'AD25',     // Lateral offset foot A
                'pfeilungA': 'AD26',              // Arrow/deflection A
                'pfeilungB': 'AD29',              // Arrow/deflection B
                'seitenversatzFussB': 'AD30',     // Lateral offset foot B
                'seitenversatzKopfB': 'AD31'      // Lateral offset head B
            }
        };
        
        // Processing statistics
        this.processingStats = {};
        this.isValidated = false;
        this.validationErrors = [];
    }

    /**
     * Validate Excel file before processing
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
                errors.push(`Excel file not found: ${this.filename}`);
                return { isValid: false, errors };
            }

            // Check file size and extension
            const stats = await fs.stat(this.filename);
            const fileSizeMB = stats.size / (1024 * 1024);
            
            if (stats.size === 0) {
                errors.push('Excel file is empty');
            } else if (fileSizeMB > 50) { // Excel files should be reasonable size
                errors.push(`Excel file too large: ${fileSizeMB.toFixed(1)}MB (max 50MB)`);
            }
            
            // Check file extension
            const ext = path.extname(this.filename).toLowerCase();
            if (!['.xlsx', '.xls'].includes(ext)) {
                errors.push(`Invalid file extension: ${ext} (expected .xlsx or .xls)`);
            }

            // Try to load workbook to validate Excel format
            try {
                const workbook = XLSX.readFile(this.filename);
                
                if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                    errors.push('Excel file contains no worksheets');
                } else {
                    // Check if we can access the first worksheet
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    if (!firstSheet) {
                        errors.push('Cannot access Excel worksheet data');
                    } else {
                        // Try to read a sample cell to verify format
                        const sampleCell = firstSheet['A1'];
                        console.log(`Excel validation - sample cell A1: ${sampleCell ? sampleCell.v : 'empty'}`);
                    }
                }
                
            } catch (error) {
                errors.push(`Cannot read Excel file format: ${error.message}`);
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
            errors.push(`Excel validation error: ${error.message}`);
            return { isValid: false, errors };
        }
    }

    /**
     * Parse German decimal format (comma to dot)
     * @param {any} value - Cell value from Excel
     * @returns {number|null} Parsed number or null
     */
    parseGermanNumber(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        
        // If already a number, return as-is
        if (typeof value === 'number') {
            return isNaN(value) ? null : value;
        }
        
        // Convert to string and handle German format
        let strValue = String(value).trim();
        
        if (strValue === '' || strValue === 'x' || strValue === 'X') {
            return null;
        }
        
        // Replace German decimal comma with dot
        strValue = strValue.replace(',', '.');
        
        const number = parseFloat(strValue);
        return isNaN(number) ? null : number;
    }

    /**
     * Read cell value from worksheet
     * @param {string} cellAddress - Excel cell address (e.g., 'J18', 'AD21')
     * @returns {number|null} Parsed numeric value
     */
    readCellValue(cellAddress) {
        if (!this.worksheet) {
            console.warn(`Cannot read cell ${cellAddress}: worksheet not loaded`);
            return null;
        }
        
        try {
            const cell = this.worksheet[cellAddress];
            if (!cell) {
                console.warn(`Cell ${cellAddress} is empty or does not exist`);
                return null;
            }
            
            // Get cell value - xlsx library provides .v for value, .w for formatted text
            const rawValue = cell.v !== undefined ? cell.v : cell.w;
            const parsedValue = this.parseGermanNumber(rawValue);
            
            if (parsedValue !== null) {
                console.log(`Cell ${cellAddress}: ${rawValue} → ${parsedValue}`);
            } else {
                console.warn(`Cell ${cellAddress}: Could not parse value "${rawValue}"`);
            }
            
            return parsedValue;
            
        } catch (error) {
            console.error(`Error reading cell ${cellAddress}:`, error.message);
            return null;
        }
    }

    /**
     * Main file reading method
     * @returns {Promise<Object>} Parsed Excel data
     */
    async readFile() {
        console.log(`Reading crown Excel file: ${path.basename(this.filename)}`);
        const overallStartTime = process.hrtime.bigint();
        
        try {
            // Validate file first
            if (!this.isValidated) {
                const validation = await this.validateFile();
                if (!validation.isValid) {
                    throw new Error(`Excel validation failed: ${validation.errors.join(', ')}`);
                }
            }

            // Load Excel workbook
            const fileReadStart = process.hrtime.bigint();
            this.workbook = XLSX.readFile(this.filename, {
                cellStyles: true,    // Read formatting
                cellFormulas: false, // We don't need formulas
                cellDates: true,     // Handle date parsing
                cellNF: false,       // Don't need number formats
                sheetStubs: false    // Skip empty cells
            });
            const fileReadTime = Number(process.hrtime.bigint() - fileReadStart) / 1e9;
            
            // Get first worksheet (assuming data is in first sheet)
            if (!this.workbook.SheetNames || this.workbook.SheetNames.length === 0) {
                throw new Error('Excel file contains no worksheets');
            }
            
            const sheetName = this.workbook.SheetNames[0];
            this.worksheet = this.workbook.Sheets[sheetName];
            
            if (!this.worksheet) {
                throw new Error(`Cannot access worksheet: ${sheetName}`);
            }
            
            console.log(`Excel loaded: worksheet "${sheetName}" in ${fileReadTime.toFixed(3)}s`);
            
            // Process crown measurements
            console.log('Processing crown measurements from Excel...');
            const dataProcessStart = process.hrtime.bigint();
            const crownData = await this.processCrownMeasurements();
            const dataProcessTime = Number(process.hrtime.bigint() - dataProcessStart) / 1e9;
            
            // Store comprehensive metadata
            const fileStats = await fs.stat(this.filename);
            this.metadata = {
                filePath: this.filename,
                fileName: path.basename(this.filename),
                fileSize: fileStats.size,
                processedAt: new Date(),
                
                // Excel-specific metadata
                worksheetName: sheetName,
                worksheetCount: this.workbook.SheetNames.length,
                cellMappings: this.cellMappings,
                
                // Processing statistics
                processingStats: {
                    ...this.processingStats,
                    fileReadTime,
                    dataProcessTime,
                    totalProcessingTime: Number(process.hrtime.bigint() - overallStartTime) / 1e9
                }
            };
            
            console.log(`Crown Excel processing completed:`);
            console.log(`- File read: ${fileReadTime.toFixed(3)}s`);
            console.log(`- Data process: ${dataProcessTime.toFixed(3)}s`);
            console.log(`- Total: ${this.metadata.processingStats.totalProcessingTime.toFixed(3)}s`);
            console.log(`- Cold measurements: ${Object.keys(crownData.coldSideMeasurements).length}`);
            console.log(`- Top view measurements: ${Object.keys(crownData.topViewMeasurements).length}`);
            console.log(`- Calculated values: ${Object.keys(crownData.calculatedValues).length}`);
            
            return crownData;
            
        } catch (error) {
            console.error('Error reading crown Excel file:', error);
            throw new Error(`Crown Excel reading failed: ${error.message}`);
        }
    }

    /**
     * Process crown measurements from Excel worksheet
     * @returns {Promise<Object>} Structured crown data
     */
    async processCrownMeasurements() {
        if (!this.worksheet) {
            throw new Error('Excel worksheet not loaded');
        }
        
        console.log('Extracting crown measurements from Excel cells...');
        
        const result = {
            coldSideMeasurements: {},
            topViewMeasurements: {},
            calculatedValues: {},
            metadata: {}
        };
        
        let totalCellsRead = 0;
        let successfulReads = 0;
        let nullValues = 0;
        
        // Read cold side measurements (J18, N18)
        console.log('Reading cold side measurements...');
        for (const [key, cellAddress] of Object.entries(this.cellMappings.coldSideMeasurements)) {
            const value = this.readCellValue(cellAddress);
            result.coldSideMeasurements[key] = value;
            totalCellsRead++;
            if (value !== null) {
                successfulReads++;
            } else {
                nullValues++;
            }
        }
        
        // Read top view measurements (J23, N23, J24, N24, J31, N31, J32, N32)
        console.log('Reading top view measurements...');
        for (const [key, cellAddress] of Object.entries(this.cellMappings.topViewMeasurements)) {
            const value = this.readCellValue(cellAddress);
            result.topViewMeasurements[key] = value;
            totalCellsRead++;
            if (value !== null) {
                successfulReads++;
            } else {
                nullValues++;
            }
        }
        
        // Read calculated values (AD cells)
        console.log('Reading calculated values from AD cells...');
        for (const [key, cellAddress] of Object.entries(this.cellMappings.calculatedValues)) {
            const value = this.readCellValue(cellAddress);
            result.calculatedValues[key] = value;
            totalCellsRead++;
            if (value !== null) {
                successfulReads++;
            } else {
                nullValues++;
            }
        }
        
        // Add processing metadata
        result.metadata = {
            totalCellsRead,
            successfulReads,
            nullValues,
            successRate: totalCellsRead > 0 ? (successfulReads / totalCellsRead * 100).toFixed(1) : '0.0',
            processingDate: new Date(),
            cellMappings: this.cellMappings
        };
        
        console.log(`Crown measurements extracted:`);
        console.log(`- Total cells read: ${totalCellsRead}`);
        console.log(`- Successful reads: ${successfulReads}`);
        console.log(`- Null/empty values: ${nullValues}`);
        console.log(`- Success rate: ${result.metadata.successRate}%`);
        
        // Validate critical measurements
        this.validateCrownMeasurements(result);
        
        return result;
    }

    /**
     * Validate crown measurements for data quality
     * @param {Object} crownData - Parsed crown data
     */
    validateCrownMeasurements(crownData) {
        const warnings = [];
        const errors = [];
        
        // Check cold side measurements (critical for warm/cold comparison)
        if (crownData.coldSideMeasurements.J18 === null) {
            warnings.push('J18 (outlet cold measurement) is missing');
        }
        if (crownData.coldSideMeasurements.N18 === null) {
            warnings.push('N18 (inlet cold measurement) is missing');
        }
        
        // Check for reasonable measurement ranges (crown measurements typically small values)
        const allMeasurements = [
            ...Object.values(crownData.coldSideMeasurements),
            ...Object.values(crownData.topViewMeasurements)
        ].filter(v => v !== null);
        
        if (allMeasurements.length > 0) {
            const minValue = Math.min(...allMeasurements);
            const maxValue = Math.max(...allMeasurements);
            
            // Crown measurements should typically be within reasonable range
            if (Math.abs(minValue) > 50 || Math.abs(maxValue) > 50) {
                warnings.push(`Measurements outside expected range: ${minValue.toFixed(3)} to ${maxValue.toFixed(3)} mm`);
            }
        }
        
        // Check calculated values availability
        const calculatedCount = Object.values(crownData.calculatedValues).filter(v => v !== null).length;
        if (calculatedCount === 0) {
            warnings.push('No calculated values (AD cells) found - may affect crown analysis');
        }
        
        // Log validation results
        if (warnings.length > 0) {
            console.warn('Crown measurement validation warnings:');
            warnings.forEach(warning => console.warn(`  - ${warning}`));
        }
        
        if (errors.length > 0) {
            console.error('Crown measurement validation errors:');
            errors.forEach(error => console.error(`  - ${error}`));
            throw new Error(`Crown measurement validation failed: ${errors.join(', ')}`);
        }
        
        if (warnings.length === 0 && errors.length === 0) {
            console.log('Crown measurement validation passed');
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

    getColdSideMeasurements() {
        return this.crownData?.coldSideMeasurements || {};
    }

    getTopViewMeasurements() {
        return this.crownData?.topViewMeasurements || {};
    }

    getCalculatedValues() {
        return this.crownData?.calculatedValues || {};
    }

    getAllMeasurements() {
        if (!this.crownData) return null;
        
        return {
            coldSide: this.crownData.coldSideMeasurements,
            topView: this.crownData.topViewMeasurements,
            calculated: this.crownData.calculatedValues,
            metadata: this.crownData.metadata
        };
    }

    getProcessingStats() {
        const totalMeasurements = this.crownData ? 
            Object.keys(this.crownData.coldSideMeasurements).length +
            Object.keys(this.crownData.topViewMeasurements).length +
            Object.keys(this.crownData.calculatedValues).length : 0;
        
        return {
            ...this.processingStats,
            totalMeasurements,
            totalCellsRead: this.crownData?.metadata?.totalCellsRead || 0,
            successfulReads: this.crownData?.metadata?.successfulReads || 0,
            fileName: path.basename(this.filename),
            fileSize: this.metadata?.fileSize || 0,
            
            // Excel-specific stats
            worksheetName: this.metadata?.worksheetName,
            worksheetCount: this.metadata?.worksheetCount
        };
    }

    /**
     * Get crown measurement summary for logging/debugging
     * @returns {Object} Summary of measurements
     */
    getMeasurementSummary() {
        if (!this.crownData) return null;
        
        const cold = this.crownData.coldSideMeasurements;
        const topView = this.crownData.topViewMeasurements;
        const calculated = this.crownData.calculatedValues;
        
        return {
            coldSide: {
                J18: cold.J18,
                N18: cold.N18,
                available: Object.values(cold).filter(v => v !== null).length
            },
            topView: {
                measurements: Object.keys(topView).length,
                available: Object.values(topView).filter(v => v !== null).length,
                range: this._calculateRange(Object.values(topView).filter(v => v !== null))
            },
            calculated: {
                values: Object.keys(calculated).length,
                available: Object.values(calculated).filter(v => v !== null).length,
                höhenversatz: calculated.höhenversatz,
                crown: calculated.crown
            }
        };
    }

    /**
     * Helper method to calculate value range
     * @private
     */
    _calculateRange(values) {
        if (values.length === 0) return null;
        return {
            min: Math.min(...values),
            max: Math.max(...values),
            range: Math.max(...values) - Math.min(...values)
        };
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.workbook = null;
        this.worksheet = null;
        this.crownData = null;
        console.log(`Crown Excel reader cleanup completed`);
    }
}

module.exports = CrownExcelReader;