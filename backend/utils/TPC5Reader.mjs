/**
 * TPC5 Reader - HDF5/TPC5 File Parser (ES6 Version)
 * Reads TPC5 files (renamed HDF5) with full format compatibility
 * Based on analysis of J25-07-30(2)_original(manuell).tpc5 structure
 */

import fs from 'fs';
import path from 'path';

const fsPromises = fs.promises;

class TPC5Reader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.rawData = {};
        this.calculatedData = {};
        this.processingStats = {};
        this.h5file = null;
        
        // Channel mapping: TPC5 → BinaryReader equivalent
        this.channelMapping = {
            '00000001': { index: 0, tpc5Name: 'A1', binaryName: 'channel_0' },  // U_L1L2
            '00000002': { index: 1, tpc5Name: 'A2', binaryName: 'channel_1' },  // U_L2L3  
            '00000003': { index: 2, tpc5Name: 'A3', binaryName: 'channel_2' },  // U_Diode_GR_unten_Bottom
            '00000004': { index: 3, tpc5Name: 'A4', binaryName: 'channel_3' },  // U_ElektrodeUnten
            '00000005': { index: 4, tpc5Name: 'B1', binaryName: 'channel_4' },  // U_RegV_StellsignalUE
            '00000006': { index: 5, tpc5Name: 'B3', binaryName: 'channel_5' }   // U_RegV_SchieberMonitor
        };
        
        // Constants for calculations (same as BinaryReader)
        this.TRAFO_STROM_MULTIPLIER = 35;
        this.FORCE_COEFF_1 = 6.2832;
        this.FORCE_COEFF_2 = 5.0108;
        
        // Validation flags
        this.isValidated = false;
        this.validationErrors = [];
    }

    /**
     * Validate TPC5 file before processing
     * @returns {Promise<Object>} Validation result
     */
    async validateFile() {
        const startTime = process.hrtime.bigint();
        const errors = [];
        
        try {
            // Check file exists
            try {
                await fsPromises.access(this.filename);
            } catch (error) {
                errors.push(`File not found: ${this.filename}`);
                return { isValid: false, errors };
            }

            // Check file size
            const stats = await fsPromises.stat(this.filename);
            const fileSizeGB = stats.size / (1024 * 1024 * 1024);
            
            if (stats.size === 0) {
                errors.push('File is empty');
            } else if (fileSizeGB > 5) {
                console.warn(`Large TPC5 file: ${fileSizeGB.toFixed(1)}GB - processing may take time`);
            }

            // Try to open as HDF5 file (skip for large files due to memory limits)
            try {
                const h5wasm = await import('h5wasm');
                await h5wasm.ready;
                
                // Declare fileName here (before if/else)
                const fileName = path.basename(this.filename);
                
                // Skip loading large files into memory for validation
                if (fileSizeGB > 2) {
                    console.log(`File too large for h5wasm validation (${fileSizeGB.toFixed(1)}GB), skipping structure check`);
                    // Just check file exists and has .tpc5 extension
                    if (!this.filename.toLowerCase().endsWith('.tpc5')) {
                        errors.push('File does not have .tpc5 extension');
                    }
                } else {
                    // Normal validation for smaller files
                    const buffer = await fsPromises.readFile(this.filename);
                    h5wasm.FS.writeFile(fileName, new Uint8Array(buffer));
                    
                    // Try to open HDF5 file
                    const testFile = new h5wasm.File(fileName, "r");
                    
                    // Check for expected TPC5 structure
                    if (!testFile.get('measurements')) {
                        errors.push('Missing /measurements group - not a valid TPC5 file');
                    } else {
                        const measurements = testFile.get('measurements/00000001');
                        if (!measurements) {
                            errors.push('Missing /measurements/00000001 group');
                        } else if (!measurements.get('channels')) {
                            errors.push('Missing channels group');
                        } else {
                            console.log(`Valid TPC5 file structure detected`);
                        }
                    }
                    
                    testFile.close();
                }
                
            } catch (error) {
                errors.push(`Cannot validate as HDF5 file: ${error.message}`);
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
     * Main file reading method
     * @returns {Promise<void>}
     */
    async readFile() {
        console.log(`Reading TPC5 file: ${path.basename(this.filename)}`);
        const overallStartTime = process.hrtime.bigint();
        
        try {
            // Validate file first
            if (!this.isValidated) {
                const validation = await this.validateFile();
                if (!validation.isValid) {
                    throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
                }
            }

            // Initialize h5wasm
            const h5wasm = await import('h5wasm');
            await h5wasm.ready;

            // Get file stats for size check
            const stats = await fsPromises.stat(this.filename);
            const fileSizeGB = stats.size / (1024 * 1024 * 1024);

            // Mount file directory for large files (>2GB) to avoid Node.js memory limits
            const fileReadStart = process.hrtime.bigint();
            const fileName = path.basename(this.filename);
            let actualFilePath;
            
            if (fileSizeGB > 2) {
                console.log(`Large file detected (${fileSizeGB.toFixed(1)}GB), using file system mounting`);
                
                try {
                    // Mount the directory containing the file
                    const fileDir = path.dirname(this.filename);
                    const mountPoint = '/data';
                    
                    // Create mount point if it doesn't exist
                    try {
                        h5wasm.FS.mkdir(mountPoint);
                    } catch (e) {
                        // Directory might already exist
                    }
                    
                    // Mount using NODEFS
                    h5wasm.FS.mount(h5wasm.NODEFS, { root: fileDir }, mountPoint);
                    
                    // Use mounted file path
                    actualFilePath = `${mountPoint}/${fileName}`;
                    
                } catch (error) {
                    console.warn(`File mounting failed: ${error.message}, trying direct access`);
                    // Fallback: try direct file access (may fail for very large files)
                    actualFilePath = fileName;
                    
                    // Copy file to virtual filesystem in chunks (this might still fail)
                    try {
                        console.log('Attempting chunked file read (this may fail for very large files)...');
                        const buffer = await fsPromises.readFile(this.filename);
                        h5wasm.FS.writeFile(fileName, new Uint8Array(buffer));
                    } catch (bufferError) {
                        throw new Error(`Cannot load large file: ${bufferError.message}. File is too large for current h5wasm configuration.`);
                    }
                }
            } else {
                // Small file - normal loading
                const buffer = await fsPromises.readFile(this.filename);
                h5wasm.FS.writeFile(fileName, new Uint8Array(buffer));
                actualFilePath = fileName;
            }
            
            const fileReadTime = Number(process.hrtime.bigint() - fileReadStart) / 1e9;
            console.log(`File prepared in: ${fileReadTime.toFixed(2)}s`);
            
            // Open HDF5 file
            this.h5file = new h5wasm.File(actualFilePath, "r");
            
            // Read metadata section
            console.log('Reading TPC5 metadata...');
            await this._readMetadataSection();
            
            // Read channel data efficiently using downsampled datasets
            console.log('Reading TPC5 channel data...');
            const dataStartTime = process.hrtime.bigint();
            await this.readChannelDataFromDownsampled();
            const dataReadTime = Number(process.hrtime.bigint() - dataStartTime) / 1e9;
            
            // Compute calculated channels (same as binary reader)
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
                memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024,
                fileSizeGB: fileSizeGB,
                usedFileSystemMount: fileSizeGB > 2
            };
            
            console.log(`Data reading completed in: ${dataReadTime.toFixed(2)}s`);
            console.log(`Calculated channels computed in: ${calcTime.toFixed(2)}s`);
            console.log(`Total processing time: ${totalTime.toFixed(2)}s`);
            console.log(`Memory usage: ${this.processingStats.memoryUsageMB.toFixed(1)} MB`);
            
        } catch (error) {
            console.error('Error reading TPC5 file:', error);
            throw new Error(`TPC5 file reading failed: ${error.message}`);
        } finally {
            if (this.h5file) {
                this.h5file.close();
                this.h5file = null;
            }
        }
    }

    /**
     * Read metadata section from TPC5 file
     * @private
     */
    async _readMetadataSection() {
        try {
            // Get measurement group
            const measurement = this.h5file.get('measurements/00000001');
            if (!measurement) {
                throw new Error('Measurement group not found');
            }

            const channels = measurement.get('channels');
            if (!channels) {
                throw new Error('Channels group not found');
            }

            // Initialize metadata arrays
            this.metadata = {
                channelCount: 0,
                channelMetadata: {},
                labels: [],
                units: [],
                samplingRate: 10000000.0, // All channels are 10MHz
                
                // TPC5-specific metadata
                deviceName: '',
                startTime: null,
                triggerSample: 0,
                triggerTimeSeconds: 0,
                
                // File info
                filePath: this.filename,
                fileName: path.basename(this.filename),
                processedAt: new Date()
            };

            // Read each channel's metadata
            const channelKeys = Object.keys(this.channelMapping);
            
            for (const channelKey of channelKeys) {
                const channelPath = `channels/${channelKey}`;
                const channelGroup = measurement.get(channelPath);
                
                if (!channelGroup) {
                    console.warn(`Channel ${channelKey} not found, skipping`);
                    continue;
                }

                // Read channel attributes
                const channelName = channelGroup.attrs.ChannelName || `Channel ${channelKey}`;
                const physicalUnit = channelGroup.attrs.physicalUnit || 'V';
                const binToVoltConstant = channelGroup.attrs.binToVoltConstant || 0.0;
                const binToVoltFactor = channelGroup.attrs.binToVoltFactor || 1.0;
                const voltToPhysicalConstant = channelGroup.attrs.voltToPhysicalConstant || 0.0;
                const voltToPhysicalFactor = channelGroup.attrs.voltToPhysicalFactor || 1.0;
                const deviceName = channelGroup.attrs.deviceName || '';
                
                // Get block metadata for timing
                const blockGroup = channelGroup.get('blocks/00000001');
                let startTime = null;
                let triggerSample = 0;
                let triggerTimeSeconds = 0;
                
                if (blockGroup) {
                    startTime = blockGroup.attrs.startTime || null;
                    triggerSample = blockGroup.attrs.triggerSample || 0;
                    triggerTimeSeconds = blockGroup.attrs.triggerTimeSeconds || 0;
                }

                // Store channel metadata
                const channelIndex = this.channelMapping[channelKey].index;
                this.metadata.channelMetadata[channelKey] = {
                    channelIndex,
                    channelKey,
                    channelName,
                    physicalUnit,
                    binToVoltConstant,
                    binToVoltFactor,
                    voltToPhysicalConstant,
                    voltToPhysicalFactor,
                    deviceName,
                    startTime,
                    triggerSample,
                    triggerTimeSeconds
                };

                // Build arrays for compatibility with BinaryReader
                this.metadata.labels[channelIndex] = channelName;
                this.metadata.units[channelIndex] = physicalUnit;
                
                // Store common metadata (use first channel's values)
                if (this.metadata.channelCount === 0) {
                    this.metadata.deviceName = deviceName;
                    this.metadata.startTime = startTime;
                    this.metadata.triggerSample = triggerSample;
                    this.metadata.triggerTimeSeconds = triggerTimeSeconds;
                }
                
                this.metadata.channelCount++;
            }

            console.log(`TPC5 metadata loaded: ${this.metadata.channelCount} channels`);
            console.log(`Device: ${this.metadata.deviceName}`);
            console.log(`Start time: ${this.metadata.startTime}`);
            console.log(`Sampling rate: ${this.metadata.samplingRate / 1e6} MHz`);
            
        } catch (error) {
            throw new Error(`Failed to read TPC5 metadata: ${error.message}`);
        }
    }

    /**
     * Read channel data efficiently using pre-computed downsampled datasets
     * Uses data@128 level for good balance of resolution and performance
     */
    async readChannelDataFromDownsampled() {
        try {
            const measurement = this.h5file.get('measurements/00000001');
            const channels = measurement.get('channels');
            
            // Choose downsampling level based on performance needs
            // data@128 gives us ~9.6M points per channel (good balance)
            const downsamplingLevel = 128;
            const datasetName = `data@${downsamplingLevel}`;
            
            console.log(`Using downsampling level: ${downsamplingLevel} (~${(1239155432/downsamplingLevel/1e6).toFixed(1)}M points per channel)`);
            
            for (const channelKey of Object.keys(this.channelMapping)) {
                const channelMeta = this.metadata.channelMetadata[channelKey];
                if (!channelMeta) continue;
                
                const channelIndex = channelMeta.channelIndex;
                const binaryName = this.channelMapping[channelKey].binaryName;
                
                try {
                    // Get downsampled dataset path
                    const datasetPath = `channels/${channelKey}/blocks/00000001/${datasetName}`;
                    const dataset = measurement.get(datasetPath);
                    
                    if (!dataset) {
                        console.warn(`Dataset ${datasetPath} not found, skipping channel ${channelKey}`);
                        continue;
                    }
                    
                    // Read min/max pairs (shape: [N, 2])
                    const rawMinMaxData = dataset.value;  // This gets the full dataset
                    const numPoints = rawMinMaxData.length / 2;  // Divide by 2 since it's [min,max] pairs
                    
                    console.log(`Channel ${channelKey}: Reading ${numPoints.toLocaleString()} min/max pairs`);
                    
                    // Convert min/max pairs to physical values and create time series
                    const physicalValues = new Float32Array(numPoints * 2); // Store both min and max
                    const timeArray = new Float32Array(numPoints * 2);
                    
                    // Calculate time step (10MHz with downsampling)
                    const dtSeconds = downsamplingLevel / this.metadata.samplingRate;
                    
                    let outputIndex = 0;
                    for (let i = 0; i < numPoints; i++) {
                        const minRaw = rawMinMaxData[i * 2];
                        const maxRaw = rawMinMaxData[i * 2 + 1];
                        
                        // Convert both min and max to physical values
                        const minPhysical = this.convertRawToPhysical(
                            minRaw, 
                            channelMeta.binToVoltFactor, 
                            channelMeta.binToVoltConstant,
                            channelMeta.voltToPhysicalFactor,
                            channelMeta.voltToPhysicalConstant
                        );
                        
                        const maxPhysical = this.convertRawToPhysical(
                            maxRaw,
                            channelMeta.binToVoltFactor,
                            channelMeta.binToVoltConstant,
                            channelMeta.voltToPhysicalFactor,
                            channelMeta.voltToPhysicalConstant
                        );
                        
                        // Store min/max with time points
                        const baseTime = i * dtSeconds;
                        
                        // Add min point
                        timeArray[outputIndex] = baseTime;
                        physicalValues[outputIndex] = minPhysical;
                        outputIndex++;
                        
                        // Add max point 
                        timeArray[outputIndex] = baseTime + dtSeconds * 0.5; // Offset slightly for visualization
                        physicalValues[outputIndex] = maxPhysical;
                        outputIndex++;
                    }
                    
                    // Store in rawData with same structure as BinaryReader
                    this.rawData[binaryName] = {
                        time: timeArray,
                        values: physicalValues,
                        label: channelMeta.channelName,
                        unit: channelMeta.physicalUnit,
                        downsampling: downsamplingLevel,
                        points: physicalValues.length,
                        channelIndex: channelIndex,
                        samplingRate: this.metadata.samplingRate / downsamplingLevel,
                        
                        // TPC5-specific metadata
                        tpc5ChannelKey: channelKey,
                        conversionFactors: {
                            binToVoltFactor: channelMeta.binToVoltFactor,
                            binToVoltConstant: channelMeta.binToVoltConstant,
                            voltToPhysicalFactor: channelMeta.voltToPhysicalFactor,
                            voltToPhysicalConstant: channelMeta.voltToPhysicalConstant
                        }
                    };
                    
                    console.log(`Channel ${channelKey} (${channelMeta.channelName}): ${physicalValues.length.toLocaleString()} points, ` +
                               `${(physicalValues.length * dtSeconds * 0.5).toFixed(1)}s duration`);
                    
                } catch (error) {
                    console.error(`Error reading channel ${channelKey}:`, error);
                }
            }
            
            console.log(`Successfully loaded ${Object.keys(this.rawData).length} channels from TPC5 file`);
            
        } catch (error) {
            throw new Error(`Failed to read TPC5 channel data: ${error.message}`);
        }
    }

    /**
     * Convert raw uint16 value to physical value using TPC5 conversion factors
     * @param {number} rawValue - Raw uint16 ADC value
     * @param {number} binToVoltFactor - Binary to voltage scaling factor
     * @param {number} binToVoltConstant - Binary to voltage offset
     * @param {number} voltToPhysicalFactor - Voltage to physical scaling factor  
     * @param {number} voltToPhysicalConstant - Voltage to physical offset
     * @returns {number} Physical value in engineering units
     */
    convertRawToPhysical(rawValue, binToVoltFactor, binToVoltConstant, voltToPhysicalFactor, voltToPhysicalConstant) {
        // Step 1: Raw uint16 → Voltage
        const voltage = (rawValue * binToVoltFactor) + binToVoltConstant;
        
        // Step 2: Voltage → Physical Units
        const physical = (voltage * voltToPhysicalFactor) + voltToPhysicalConstant;
        
        return physical;
    }

    /**
     * Compute calculated engineering channels from raw data
     * Uses same formulas as BinaryReader for consistency
     */
    computeCalculatedChannels() {
        // Define calculated channel metadata (same as BinaryReader)
        const calcChannelDefs = {
            0: { label: 'UL3L1*', unit: 'V', sourceChannels: [0, 1] },
            1: { label: 'IL2GR1*', unit: 'V', sourceChannels: [2, 3] },
            2: { label: 'IL2GR2*', unit: 'V', sourceChannels: [4, 5] },
            3: { label: 'I_DC_GR1*', unit: 'A', sourceChannels: [2, 3] },
            4: { label: 'I_DC_GR2*', unit: 'A', sourceChannels: [4, 5] },
            5: { label: 'U_DC*', unit: 'V', sourceChannels: [0, 1] },
            6: { label: 'F_Schlitten*', unit: 'kN', sourceChannels: [6, 7] } // Note: channels 6,7 don't exist in TPC5
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
     * Compute a single calculated channel (same logic as BinaryReader)
     * @param {number} calcIndex - Calculated channel index (0-6)
     * @param {Object} def - Channel definition
     * @returns {Object|null} Calculated channel data
     */
    computeSingleCalculatedChannel(calcIndex, def) {
        const sourceChannels = def.sourceChannels;
        
        // For F_Schlitten* (calc_6), we need channels 6&7 which don't exist in TPC5
        if (calcIndex === 6) {
            console.warn(`Calculated channel ${calcIndex} (${def.label}) requires channels 6&7 which don't exist in TPC5 format`);
            return null;
        }
        
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
        
        // Perform calculations based on channel index (same as BinaryReader)
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

    // === CALCULATION METHODS (same as BinaryReader) ===

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

    // === PUBLIC DATA ACCESS METHODS (same interface as BinaryReader) ===

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

        // Add raw channels (0-5 for TPC5, vs 0-7 for binary)
        for (let i = 0; i < 6; i++) {
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
            totalDataPoints: Object.values(this.rawData).reduce((sum, ch) => sum + ch.points, 0),
            fileFormat: 'TPC5/HDF5',
            downsamplingUsed: this.rawData[Object.keys(this.rawData)[0]]?.downsampling || 128
        };
    }
}

export default TPC5Reader;