/**
 * Video Conversion Service
 * Handles AVI to MP4 conversion for thermal video files using FFmpeg
 * Manages conversion cache, progress tracking, and file serving
 * UPDATED: Returns static file paths for Express static serving
 */

const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class VideoConversionService {
    constructor() {
        this.serviceName = 'Video Conversion Service';
        
        // Set FFmpeg binary path
        ffmpeg.setFfmpegPath(ffmpegStatic);
        
        // Conversion cache and status tracking
        this.conversionCache = new Map(); // experimentId → conversion info
        this.activeConversions = new Map(); // experimentId → conversion promise
        
        // Configuration - UPDATED: Use cache directory instead of temp
        this.outputFormat = 'mp4';
        this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
        this.cacheDir = path.join(__dirname, '..', 'cache', 'thermal'); // Static serving directory
        this.maxConcurrentConversions = config.thermal?.maxConcurrentConversions || 2;
        
        // Ensure cache directory exists
        this._ensureCacheDirectory();
        
        console.log(`${this.serviceName} initialized`);
        console.log(`FFmpeg path: ${ffmpegStatic}`);
        console.log(`Cache directory: ${this.cacheDir}`);
    }

    /**
     * Convert AVI to MP4 and get file path for serving
     * @param {string} experimentId - Experiment ID
     * @param {string} aviFilePath - Source AVI file path
     * @returns {Promise<Object>} Conversion result with MP4 path
     */
    async convertAndGetMp4Path(experimentId, aviFilePath) {
        try {
            // Check if already converted and cached
            const cached = this._getCachedConversion(experimentId);
            if (cached && await this._fileExists(cached.mp4Path)) {
                console.log(`Using cached MP4 for ${experimentId}`);
                return {
                    success: true,
                    message: 'Using cached MP4 file',
                    mp4Path: cached.mp4Path,
                    fileSize: cached.fileSize,
                    convertedAt: cached.convertedAt,
                    fromCache: true
                };
            }

            // Check if conversion is already in progress
            if (this.activeConversions.has(experimentId)) {
                console.log(`Waiting for active conversion: ${experimentId}`);
                return await this.activeConversions.get(experimentId);
            }

            // Start new conversion
            const conversionPromise = this._performConversion(experimentId, aviFilePath);
            this.activeConversions.set(experimentId, conversionPromise);

            try {
                const result = await conversionPromise;
                return result;
            } finally {
                this.activeConversions.delete(experimentId);
            }

        } catch (error) {
            console.error(`Error in convertAndGetMp4Path for ${experimentId}:`, error);
            this.activeConversions.delete(experimentId);
            return {
                success: false,
                message: `Conversion failed: ${error.message}`,
                error: error.toString()
            };
        }
    }

    /**
     * Convert AVI and return static serving info - UPDATED: Return static URL
     * @param {string} experimentId - Experiment ID  
     * @param {string} aviFilePath - Source AVI file path
     * @returns {Promise<Object>} Static serving info for Express static
     */
    async convertAndServe(experimentId, aviFilePath) {
        try {
            const conversionResult = await this.convertAndGetMp4Path(experimentId, aviFilePath);
            
            console.log('DEBUG - Conversion result structure:', JSON.stringify(conversionResult, null, 2));
            
            if (!conversionResult.success) {
                return {
                    success: false,
                    message: conversionResult.message,
                    error: conversionResult.error || 'Conversion failed'
                };
            }

            // Get MP4 path from result
            const mp4Path = conversionResult.mp4Path;
            if (!mp4Path) {
                console.error('MP4 path missing from conversion result:', conversionResult);
                return {
                    success: false,
                    message: 'MP4 path not found in conversion result',
                    error: 'Missing mp4Path in result'
                };
            }

            // Verify file exists
            if (!await this._fileExists(mp4Path)) {
                return {
                    success: false,
                    message: 'Converted MP4 file not found',
                    error: `File not found: ${mp4Path}`
                };
            }

            // Get file stats for serving
            const stats = await fs.stat(mp4Path);

            // UPDATED: Return static URL instead of streaming info
            return {
                success: true,
                message: 'MP4 ready for static serving',
                data: {
                    staticUrl: `/cache/thermal/${experimentId}.mp4`,  // Static URL for Express
                    mp4Path: mp4Path,                                 // Local file path
                    fileSize: stats.size,
                    convertedAt: conversionResult.convertedAt,
                    fromCache: conversionResult.fromCache || false
                }
            };

        } catch (error) {
            console.error(`Error in convertAndServe for ${experimentId}:`, error);
            return {
                success: false,
                message: `Serve preparation failed: ${error.message}`,
                error: error.toString()
            };
        }
    }

    /**
     * Get conversion status for an experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Object} Conversion status information
     */
    getConversionStatus(experimentId) {
        // Check if actively converting
        if (this.activeConversions.has(experimentId)) {
            return {
                status: 'converting',
                experimentId: experimentId,
                message: 'Conversion in progress'
            };
        }

        // Check if cached
        const cached = this._getCachedConversion(experimentId);
        if (cached) {
            return {
                status: 'completed',
                experimentId: experimentId,
                convertedAt: cached.convertedAt,
                fileSize: cached.fileSize,
                mp4Path: cached.mp4Path,
                staticUrl: `/cache/thermal/${experimentId}.mp4`
            };
        }

        return {
            status: 'not_converted',
            experimentId: experimentId,
            message: 'No conversion found'
        };
    }

    /**
     * Clear conversion cache for experiment
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if cleared successfully
     */
    async clearConversionCache(experimentId) {
        try {
            const cached = this.conversionCache.get(experimentId);
            
            if (cached && cached.mp4Path) {
                // Delete the MP4 file
                try {
                    await fs.unlink(cached.mp4Path);
                    console.log(`Deleted cached MP4 for ${experimentId}`);
                } catch (error) {
                    console.warn(`Could not delete MP4 file: ${error.message}`);
                }
            }

            // Remove from cache
            this.conversionCache.delete(experimentId);
            return true;

        } catch (error) {
            console.error(`Error clearing conversion cache for ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Clear all conversion cache
     * @returns {Promise<number>} Number of entries cleared
     */
    async clearAllCache() {
        let cleared = 0;
        
        for (const experimentId of this.conversionCache.keys()) {
            const success = await this.clearConversionCache(experimentId);
            if (success) cleared++;
        }

        console.log(`Cleared ${cleared} conversion cache entries`);
        return cleared;
    }

    /**
     * Get service status and cache information
     * @returns {Object} Service status
     */
    getServiceStatus() {
        const cacheEntries = [];
        
        for (const [experimentId, cached] of this.conversionCache.entries()) {
            cacheEntries.push({
                experimentId: experimentId,
                convertedAt: cached.convertedAt,
                fileSize: cached.fileSize,
                fileSizeMB: (cached.fileSize / 1024 / 1024).toFixed(1),
                mp4File: path.basename(cached.mp4Path),
                staticUrl: `/cache/thermal/${experimentId}.mp4`
            });
        }

        return {
            serviceName: this.serviceName,
            status: 'active',
            ffmpegPath: ffmpegStatic,
            cacheDirectory: this.cacheDir,
            cache: {
                totalConversions: this.conversionCache.size,
                activeConversions: this.activeConversions.size,
                cacheTimeoutHours: this.cacheTimeout / (60 * 60 * 1000),
                entries: cacheEntries
            },
            configuration: {
                outputFormat: this.outputFormat,
                maxConcurrentConversions: this.maxConcurrentConversions,
                cacheDir: this.cacheDir
            },
            capabilities: {
                inputFormats: ['.avi'],
                outputFormat: this.outputFormat,
                videoCodec: 'libx264',
                audioCodec: 'aac',
                staticServing: true
            }
        };
    }

    // === PRIVATE METHODS ===

    /**
     * Perform the actual AVI to MP4 conversion
     * @private
     */
    async _performConversion(experimentId, aviFilePath) {
        const startTime = Date.now();
        
        try {
            console.log(`Starting conversion: ${experimentId}`);
            
            // Validate source file
            if (!await this._fileExists(aviFilePath)) {
                throw new Error(`Source AVI file not found: ${aviFilePath}`);
            }

            // Generate output path - UPDATED: Use cache directory
            const mp4FileName = `${experimentId}.mp4`;
            const mp4Path = path.join(this.cacheDir, mp4FileName);

            // Check if output already exists (shouldn't happen due to cache check, but safety)
            if (await this._fileExists(mp4Path)) {
                await fs.unlink(mp4Path);
            }

            // Get source file info
            const sourceStats = await fs.stat(aviFilePath);
            const sourceSizeMB = (sourceStats.size / 1024 / 1024).toFixed(1);
            console.log(`Converting ${sourceSizeMB}MB AVI to MP4...`);

            // Perform conversion
            await this._ffmpegConvert(aviFilePath, mp4Path);

            // Verify output file
            if (!await this._fileExists(mp4Path)) {
                throw new Error('MP4 file was not created');
            }

            const outputStats = await fs.stat(mp4Path);
            const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(1);
            const duration = Date.now() - startTime;

            console.log(`Conversion completed: ${sourceSizeMB}MB AVI → ${outputSizeMB}MB MP4 in ${duration}ms`);

            // Cache the result
            const cacheEntry = {
                experimentId: experimentId,
                mp4Path: mp4Path,
                fileSize: outputStats.size,
                convertedAt: new Date(),
                sourceFile: aviFilePath,
                conversionTime: duration
            };
            
            this.conversionCache.set(experimentId, cacheEntry);

            // Return simple object (not createServiceResult)
            return {
                success: true,
                message: `Conversion completed: ${outputSizeMB}MB MP4`,
                mp4Path: mp4Path,
                fileSize: outputStats.size,
                convertedAt: cacheEntry.convertedAt,
                conversionTime: duration,
                fromCache: false
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`Conversion failed for ${experimentId}:`, error);
            return {
                success: false,
                message: `Conversion failed: ${error.message}`,
                error: error.toString(),
                conversionTime: duration
            };
        }
    }

    /**
     * Execute FFmpeg conversion
     * @private
     */
    _ffmpegConvert(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .outputOptions([
                    '-c:v libx264',        // H.264 video codec
                    '-crf 23',             // Good quality/size balance
                    '-preset fast',        // Fast encoding
                    '-c:a aac',            // AAC audio codec
                    '-b:a 128k',           // Audio bitrate
                    '-movflags +faststart', // Enable progressive download
                    '-pix_fmt yuv420p'     // Ensure browser compatibility
                ])
                .output(outputPath)
                .on('start', (commandLine) => {
                    console.log('FFmpeg command:', commandLine);
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`Conversion progress: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', () => {
                    console.log('FFmpeg conversion completed');
                    resolve();
                })
                .on('error', (error) => {
                    console.error('FFmpeg error:', error);
                    reject(new Error(`FFmpeg conversion failed: ${error.message}`));
                })
                .run();
        });
    }

    /**
     * Get cached conversion info
     * @private
     */
    _getCachedConversion(experimentId) {
        const cached = this.conversionCache.get(experimentId);
        if (!cached) return null;

        // Check if cache has expired
        const now = Date.now();
        const cacheAge = now - cached.convertedAt.getTime();
        
        if (cacheAge > this.cacheTimeout) {
            console.log(`Conversion cache expired for ${experimentId}`);
            this.clearConversionCache(experimentId);
            return null;
        }

        return cached;
    }

    /**
     * Ensure cache directory exists - UPDATED: Use cache directory
     * @private
     */
    async _ensureCacheDirectory() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            console.error(`Failed to create cache directory ${this.cacheDir}:`, error);
        }
    }

    /**
     * Check if file exists
     * @private
     */
    async _fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = VideoConversionService;