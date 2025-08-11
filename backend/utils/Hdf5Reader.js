/**
 * HDF5 Reader - Adapter Layer
 * Adapts progressive-hdf5-reader.js to match BinaryReader.js interface
 * Provides consistent API for HDF5 files in the experiment system
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');

class Hdf5Reader {
    constructor(filename) {
        this.filename = filename;
        this.metadata = {};
        this.rawData = {}; // Not used in HDF5 - mapped to empty for compatibility
        this.calculatedData = {}; // Maps to physical converted channels
        this.processingStats = {};
        
        // HDF5-specific properties
        this.progressiveReader = null;
        this.channelMapping = new Map(); // HDF5 ID → backend format mapping
        this.isValidated = false;
        this.validationErrors = [];
        
        console.log(`HDF5Reader initialized for: ${path.basename(this.filename)}`);
    }

    /**
     * Validate HDF5 file before processing
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
            } else if (fileSizeGB > 10) {
                errors.push(`File very large: ${fileSizeGB.toFixed(1)}GB (performance may be affected)`);
            }

            // Check file extension
            const ext = path.extname(this.filename).toLowerCase();
            const validExtensions = config.hdf5?.fileExtensions || ['.tpc5', '.hdf5', '.h5'];
            if (!validExtensions.includes(ext)) {
                errors.push(`Invalid file extension: ${ext}. Expected: ${validExtensions.join(', ')}`);
            }

            // Try to initialize progressive reader for basic HDF5 validation
            try {
                const ProgressiveZoomHDF5Reader = require('../lib/progressive-hdf5-reader');
                const testReader = new ProgressiveZoomHDF5Reader();
                
                // Quick validation without full file parsing
                console.log(`Validating HDF5 structure: ${path.basename(this.filename)}`);
                
                // Note: We'll do a quick validation here, full opening happens in readFile()
                
            } catch (error) {
                errors.push(`HDF5 validation failed: ${error.message}`);
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
     * Main file reading method - Initialize progressive reader and load metadata
     * @returns {Promise<void>}
     */
    async readFile() {
        console.log(`Reading HDF5 file: ${path.basename(this.filename)}`);
        const overallStartTime = process.hrtime.bigint();
        
        try {
            // Validate file first
            if (!this.isValidated) {
                const validation = await this.validateFile();
                if (!validation.isValid) {
                    throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
                }
            }

            // Initialize progressive reader
            const initStartTime = process.hrtime.bigint();
            const ProgressiveZoomHDF5Reader = require('../lib/progressive-hdf5-reader');
            this.progressiveReader = new ProgressiveZoomHDF5Reader();
            
            // Open HDF5 file
            const success = await this.progressiveReader.open(this.filename);
            if (!success) {
                throw new Error('Failed to open HDF5 file with progressive reader');
            }
            
            const initTime = Number(process.hrtime.bigint() - initStartTime) / 1e9;
            
            // Load and process metadata
            console.log('Processing HDF5 metadata and channels...');
            const metadataStartTime = process.hrtime.bigint();
            
            await this._processChannelMetadata();
            await this._buildChannelMappings();
            
            const metadataTime = Number(process.hrtime.bigint() - metadataStartTime) / 1e9;
            
            // Store processing statistics
            const totalTime = Number(process.hrtime.bigint() - overallStartTime) / 1e9;
            this.processingStats = {
                ...this.processingStats,
                initializationTime: initTime,
                metadataProcessingTime: metadataTime,
                totalProcessingTime: totalTime,
                memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024
            };
            
            console.log(`HDF5 file loaded successfully in: ${totalTime.toFixed(2)}s`);
            console.log(`Found ${this.channelMapping.size} channels`);
            console.log(`Memory usage: ${this.processingStats.memoryUsageMB.toFixed(1)} MB`);
            
        } catch (error) {
            console.error('Error reading HDF5 file:', error);
            throw new Error(`HDF5 file reading failed: ${error.message}`);
        }
    }

    /**
     * Process channel metadata from HDF5 file
     * @private
     */
    async _processChannelMetadata() {
        const channelInfo = this.progressiveReader.getChannelInfo();
        
        // Build comprehensive metadata
        this.metadata = {
            header: 'HDF5 Time Series Data',
            filePath: this.filename,
            fileName: path.basename(this.filename),
            processedAt: new Date(),
            fileType: 'hdf5',
            
            // Channel information
            totalChannels: channelInfo.length,
            channelIds: channelInfo.map(ch => ch.id),
            
            // Sampling information (use first channel as reference)
            samplingRate: channelInfo[0]?.sampleRate || 10000000,
            totalDuration: channelInfo[0]?.totalDuration || 0,
            
            // HDF5-specific metadata
            hdf5Specific: {
                measurementPath: '/measurements/00000001',
                availableDatasets: channelInfo[0]?.availableDatasets || [],
                triggerSample: channelInfo[0]?.triggerSample,
                startTime: channelInfo[0]?.startTime,
                fileFormat: 'TPC5/HDF5'
            }
        };
        
        console.log(`Processed metadata for ${channelInfo.length} channels`);
        console.log(`Sampling rate: ${(this.metadata.samplingRate / 1e6).toFixed(1)} MHz`);
        console.log(`Duration: ${this.metadata.totalDuration.toFixed(2)}s`);
    }

    /**
     * Build channel mapping from HDF5 IDs to backend format
     * @private
     */
    async _buildChannelMappings() {
        const channelInfo = this.progressiveReader.getChannelInfo();
        
        for (const channel of channelInfo) {
            const hdf5Id = channel.id;
            const backendId = `hdf5_${hdf5Id}`; // Prefix to distinguish from binary channels
            
            // Map channel for calculatedData (physical converted data)
            this.calculatedData[backendId] = {
                // Note: Actual data loading is done on-demand via progressive reader
                hdf5ChannelId: hdf5Id,
                label: channel.name,
                unit: channel.physicalUnit,
                samplingRate: channel.sampleRate,
                totalDuration: channel.totalDuration,
                availableDatasets: Object.keys(channel.datasets || {}),
                
                // Conversion parameters from HDF5 attributes
                conversion: channel.conversion || {
                    binToVoltConstant: 0.0,
                    binToVoltFactor: 1.0,
                    voltToPhysicalConstant: 0.0,
                    voltToPhysicalFactor: 1.0
                },
                
                // Channel metadata
                channelIndex: hdf5Id,
                type: 'hdf5_physical',
                points: 0, // Will be set when data is loaded
                
                // Reference to progressive reader for actual data access
                _progressiveReader: this.progressiveReader
            };
            
            // Store mapping for quick lookups
            this.channelMapping.set(backendId, hdf5Id);
            this.channelMapping.set(hdf5Id, backendId); // Bidirectional mapping
            
            console.log(`Mapped channel: ${hdf5Id} → ${backendId} (${channel.name})`);
        }
    }

    /**
     * Get metadata (compatible with BinaryReader interface)
     * @returns {Object} Comprehensive metadata
     */
    getMetadata() {
        return {
            ...this.metadata,
            processingStats: this.processingStats,
            isValidated: this.isValidated,
            validationErrors: this.validationErrors,
            
            // Additional HDF5-specific metadata
            channelMapping: Object.fromEntries(this.channelMapping),
            progressiveReaderStatus: this.progressiveReader ? 'initialized' : 'not_initialized'
        };
    }

    /**
     * Get raw data (empty for HDF5 - not applicable)
     * @returns {Object} Empty object for compatibility
     */
    getRawData() {
        // HDF5 doesn't have "raw" data in the same sense as binary files
        // Return empty object for interface compatibility
        return {};
    }

    /**
     * Get calculated data (maps to HDF5 physical channels)
     * @returns {Object} Channel data mapping
     */
    getCalculatedData() {
        return this.calculatedData;
    }

    /**
     * Get channel data by ID (HDF5 or backend format)
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel information
     */
    getChannelData(channelId) {
        // Handle both HDF5 format and backend format
        let backendId = channelId;
        if (!channelId.startsWith('hdf5_')) {
            backendId = this.channelMapping.get(channelId);
        }
        
        return this.calculatedData[backendId] || null;
    }

    /**
     * Get all channels organized by type
     * @returns {Object} All channel data
     */
    getAllChannels() {
        const allChannels = {
            raw: {}, // Empty for HDF5 compatibility
            calculated: { ...this.calculatedData }, // HDF5 channels are "calculated" (physical)
            hdf5: { ...this.calculatedData } // Also provide under hdf5 key
        };

        return allChannels;
    }

    /**
     * Get processing statistics
     * @returns {Object} Performance and processing information
     */
    getProcessingStats() {
        return {
            ...this.processingStats,
            channelCount: this.channelMapping.size / 2, // Divided by 2 due to bidirectional mapping
            hdf5ChannelCount: Object.keys(this.calculatedData).length,
            totalDataPoints: 0, // Will be calculated when data is actually loaded
            
            // HDF5-specific stats
            progressiveReaderStats: this.progressiveReader ? 
                this.progressiveReader.getCacheStatus() : null
        };
    }

    /**
     * Get progressive reader instance for direct access
     * @returns {ProgressiveZoomHDF5Reader|null} Progressive reader instance
     */
    getProgressiveReader() {
        return this.progressiveReader;
    }

    /**
     * Get HDF5 channel ID from backend format
     * @param {string} backendChannelId - Backend format channel ID
     * @returns {string|null} Original HDF5 channel ID
     */
    getHdf5ChannelId(backendChannelId) {
        if (backendChannelId.startsWith('hdf5_')) {
            return backendChannelId.substring(5); // Remove 'hdf5_' prefix
        }
        return this.channelMapping.get(backendChannelId);
    }

    /**
     * Get backend channel ID from HDF5 format
     * @param {string} hdf5ChannelId - HDF5 channel ID
     * @returns {string|null} Backend format channel ID
     */
    getBackendChannelId(hdf5ChannelId) {
        return this.channelMapping.get(hdf5ChannelId);
    }

    /**
     * Check if file is properly loaded and ready
     * @returns {boolean} True if ready for data operations
     */
    isReady() {
        return this.isValidated && 
               this.progressiveReader !== null && 
               this.channelMapping.size > 0;
    }

    /**
     * Close HDF5 file and cleanup resources
     */
    close() {
        if (this.progressiveReader) {
            this.progressiveReader.close();
            this.progressiveReader = null;
        }
        
        this.channelMapping.clear();
        this.calculatedData = {};
        this.metadata = {};
        
        console.log(`Closed HDF5 file: ${path.basename(this.filename)}`);
    }

    /**
     * Get available zoom levels for optimization info
     * @param {string} channelId - Channel ID (backend or HDF5 format)
     * @returns {Array} Available zoom levels
     */
    getAvailableZoomLevels(channelId) {
        if (!this.progressiveReader) return [];
        
        const hdf5Id = this.getHdf5ChannelId(channelId);
        if (!hdf5Id) return [];
        
        try {
            return this.progressiveReader.getAvailableZoomLevels(hdf5Id);
        } catch (error) {
            console.error(`Error getting zoom levels for ${channelId}:`, error);
            return [];
        }
    }
}

module.exports = Hdf5Reader;