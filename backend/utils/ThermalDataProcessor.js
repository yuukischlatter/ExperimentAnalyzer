/**
 * Thermal Data Processor
 * Handles thermal analysis data processing and API formatting
 * Processes video frame analysis, line temperature profiles, and pixel temperatures
 */

class ThermalDataProcessor {
    constructor(thermalReader) {
        this.thermalReader = thermalReader;
        this.videoInfo = thermalReader.getVideoInfo();
        this.metadata = thermalReader.getMetadata();
        
        // Cache for analysis results (with TTL)
        this.analysisCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        
        // Pre-calculate commonly used values
        this.frameRange = { min: 0, max: Math.max(0, this.videoInfo.frames - 1) };
        this.coordinateBounds = {
            x: { min: 0, max: Math.max(0, this.videoInfo.width - 1) },
            y: { min: 0, max: Math.max(0, this.videoInfo.height - 1) }
        };
        
        console.log('ThermalDataProcessor initialized for thermal analysis');
    }

    /**
     * Get comprehensive video information
     * @returns {Object} Video metadata and properties
     */
    getVideoInfo() {
        return {
            frames: this.videoInfo.frames || 0,
            fps: this.videoInfo.fps || 0,
            width: this.videoInfo.width || 0,
            height: this.videoInfo.height || 0,
            duration: this.videoInfo.fps > 0 ? (this.videoInfo.frames / this.videoInfo.fps) : 0,
            loaded: this.videoInfo.loaded || false,
            
            // Navigation helpers
            frameRange: this.frameRange,
            coordinateBounds: this.coordinateBounds,
            
            // Analysis capabilities
            capabilities: {
                lineAnalysis: true,
                pixelTemperature: true,
                frameNavigation: true,
                realTimeAnalysis: true
            }
        };
    }

    /**
     * Analyze temperature along multiple lines for a specific frame
     * @param {number} frameNum - Frame number (0-based)
     * @param {Array} lines - Array of line objects {x1, y1, x2, y2}
     * @returns {Object} Analysis results for all lines
     */
    analyzeLines(frameNum, lines) {
        try {
            // Validate frame number
            const validatedFrame = this.validateFrameNumber(frameNum);
            if (!validatedFrame.isValid) {
                throw new Error(validatedFrame.error);
            }

            // Validate lines array
            if (!Array.isArray(lines) || lines.length === 0) {
                throw new Error('Lines must be a non-empty array');
            }

            if (lines.length > 10) {
                throw new Error('Maximum 10 lines per analysis');
            }

            const results = [];
            const nativeEngine = this.thermalReader.getNativeEngine();
            
            if (!nativeEngine) {
                throw new Error('Native thermal engine not available');
            }

            console.log(`Analyzing ${lines.length} lines for frame ${frameNum}`);

            // Process each line
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                
                // Validate coordinates
                const validatedLine = this.validateCoordinates(line);
                if (!validatedLine.isValid) {
                    results.push({
                        lineIndex: i,
                        success: false,
                        error: validatedLine.error,
                        line: line
                    });
                    continue;
                }

                // Check cache first
                const cacheKey = `line_${frameNum}_${line.x1}_${line.y1}_${line.x2}_${line.y2}`;
                const cached = this._getCachedResult(cacheKey);
                if (cached) {
                    results.push({
                        lineIndex: i,
                        success: true,
                        line: validatedLine.line,
                        temperatures: cached.temperatures,
                        statistics: cached.statistics,
                        metadata: { ...cached.metadata, fromCache: true }
                    });
                    continue;
                }

                // Perform analysis
                const analysisStartTime = Date.now();
                const temperatures = nativeEngine.analyzeLine(
                    frameNum, 
                    validatedLine.line.x1, 
                    validatedLine.line.y1, 
                    validatedLine.line.x2, 
                    validatedLine.line.y2
                );
                const analysisTime = Date.now() - analysisStartTime;

                // Calculate statistics
                const statistics = this._calculateTemperatureStatistics(temperatures);

                // Create result
                const result = {
                    lineIndex: i,
                    success: true,
                    line: validatedLine.line,
                    temperatures: temperatures,
                    statistics: statistics,
                    metadata: {
                        frameNumber: frameNum,
                        pixelCount: temperatures.length,
                        analysisTime: analysisTime,
                        fromCache: false
                    }
                };

                // Cache the result
                this._setCachedResult(cacheKey, {
                    temperatures: temperatures,
                    statistics: statistics,
                    metadata: result.metadata
                });

                results.push(result);
            }

            return {
                success: true,
                frameNumber: frameNum,
                lineCount: lines.length,
                results: results,
                successfulLines: results.filter(r => r.success).length,
                failedLines: results.filter(r => !r.success).length
            };

        } catch (error) {
            console.error(`Error analyzing lines for frame ${frameNum}:`, error);
            return {
                success: false,
                error: `Failed to analyze lines: ${error.message}`,
                frameNumber: frameNum,
                lineCount: lines.length
            };
        }
    }

    /**
     * Analyze temperature along a single line
     * @param {number} frameNum - Frame number
     * @param {Object} line - Line coordinates {x1, y1, x2, y2}
     * @returns {Object} Single line analysis result
     */
    analyzeSingleLine(frameNum, line) {
        const result = this.analyzeLines(frameNum, [line]);
        
        if (!result.success) {
            return result;
        }

        const lineResult = result.results[0];
        return {
            success: lineResult.success,
            error: lineResult.error,
            frameNumber: frameNum,
            line: lineResult.line,
            temperatures: lineResult.temperatures,
            statistics: lineResult.statistics,
            metadata: lineResult.metadata
        };
    }

    /**
     * Get temperature for a specific pixel RGB value
     * @param {number} r - Red value (0-255)
     * @param {number} g - Green value (0-255)
     * @param {number} b - Blue value (0-255)
     * @returns {Object} Pixel temperature result
     */
    getPixelTemperature(r, g, b) {
        try {
            // Validate RGB values
            const rgbValidation = this.validateRGBValues(r, g, b);
            if (!rgbValidation.isValid) {
                throw new Error(rgbValidation.error);
            }

            const nativeEngine = this.thermalReader.getNativeEngine();
            if (!nativeEngine) {
                throw new Error('Native thermal engine not available');
            }

            // Get temperature
            const temperature = nativeEngine.getPixelTemperature(r, g, b);

            return {
                success: true,
                rgb: { r, g, b },
                temperature: temperature,
                hasTemperature: temperature !== null && temperature >= 0,
                metadata: {
                    lookupMethod: temperature !== null ? 'mapping' : 'not_found',
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            console.error(`Error getting pixel temperature for RGB(${r},${g},${b}):`, error);
            return {
                success: false,
                error: `Failed to get pixel temperature: ${error.message}`,
                rgb: { r, g, b },
                temperature: null
            };
        }
    }

    /**
     * Validate frame number against video bounds
     * @param {number} frameNum - Frame number to validate
     * @returns {Object} Validation result
     */
    validateFrameNumber(frameNum) {
        if (typeof frameNum !== 'number' || isNaN(frameNum)) {
            return { isValid: false, error: 'Frame number must be a valid number' };
        }

        if (frameNum < this.frameRange.min) {
            return { 
                isValid: false, 
                error: `Frame number ${frameNum} below minimum (${this.frameRange.min})`,
                corrected: this.frameRange.min
            };
        }

        if (frameNum > this.frameRange.max) {
            return { 
                isValid: false, 
                error: `Frame number ${frameNum} above maximum (${this.frameRange.max})`,
                corrected: this.frameRange.max
            };
        }

        return { 
            isValid: true, 
            frameNumber: Math.floor(frameNum) 
        };
    }

    /**
     * Validate and clamp line coordinates to video bounds
     * @param {Object} line - Line coordinates {x1, y1, x2, y2}
     * @returns {Object} Validation result with corrected coordinates
     */
    validateCoordinates(line) {
        if (!line || typeof line !== 'object') {
            return { isValid: false, error: 'Line must be an object' };
        }

        const { x1, y1, x2, y2 } = line;

        // Check if all coordinates are numbers
        if (typeof x1 !== 'number' || typeof y1 !== 'number' || 
            typeof x2 !== 'number' || typeof y2 !== 'number' ||
            isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
            return { isValid: false, error: 'All line coordinates must be valid numbers' };
        }

        // Clamp coordinates to bounds
        const clampedLine = {
            x1: Math.max(this.coordinateBounds.x.min, Math.min(Math.floor(x1), this.coordinateBounds.x.max)),
            y1: Math.max(this.coordinateBounds.y.min, Math.min(Math.floor(y1), this.coordinateBounds.y.max)),
            x2: Math.max(this.coordinateBounds.x.min, Math.min(Math.floor(x2), this.coordinateBounds.x.max)),
            y2: Math.max(this.coordinateBounds.y.min, Math.min(Math.floor(y2), this.coordinateBounds.y.max))
        };

        // Check if line has length
        if (clampedLine.x1 === clampedLine.x2 && clampedLine.y1 === clampedLine.y2) {
            return { isValid: false, error: 'Line must have length (start and end points cannot be the same)' };
        }

        const wasModified = clampedLine.x1 !== x1 || clampedLine.y1 !== y1 || 
                           clampedLine.x2 !== x2 || clampedLine.y2 !== y2;

        return {
            isValid: true,
            line: clampedLine,
            wasModified: wasModified,
            original: wasModified ? { x1, y1, x2, y2 } : null
        };
    }

    /**
     * Validate RGB values
     * @param {number} r - Red value
     * @param {number} g - Green value
     * @param {number} b - Blue value
     * @returns {Object} Validation result
     */
    validateRGBValues(r, g, b) {
        // Check if values are numbers
        if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number' ||
            isNaN(r) || isNaN(g) || isNaN(b)) {
            return { isValid: false, error: 'RGB values must be valid numbers' };
        }

        // Check range
        if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
            return { isValid: false, error: 'RGB values must be between 0 and 255' };
        }

        return { 
            isValid: true, 
            rgb: { 
                r: Math.floor(r), 
                g: Math.floor(g), 
                b: Math.floor(b) 
            } 
        };
    }

    /**
     * Convert frame number to time (seconds)
     * @param {number} frameNum - Frame number
     * @param {number} fps - Frames per second (optional, uses video FPS if not provided)
     * @returns {number} Time in seconds
     */
    convertFrameToTime(frameNum, fps = null) {
        const actualFps = fps || this.videoInfo.fps || 1;
        return frameNum / actualFps;
    }

    /**
     * Convert time to frame number
     * @param {number} timeSeconds - Time in seconds
     * @param {number} fps - Frames per second (optional, uses video FPS if not provided)
     * @returns {number} Frame number
     */
    convertTimeToFrame(timeSeconds, fps = null) {
        const actualFps = fps || this.videoInfo.fps || 1;
        return Math.floor(timeSeconds * actualFps);
    }

    /**
     * Format frame analysis results for API response
     * @param {Object} analysisResult - Raw analysis result
     * @returns {Object} API-formatted result
     */
    getFrameAnalysisForAPI(analysisResult) {
        if (!analysisResult.success) {
            return {
                success: false,
                error: analysisResult.error,
                frameNumber: analysisResult.frameNumber
            };
        }

        return {
            success: true,
            data: {
                frameNumber: analysisResult.frameNumber,
                timestamp: this.convertFrameToTime(analysisResult.frameNumber),
                lineCount: analysisResult.lineCount,
                successfulLines: analysisResult.successfulLines,
                failedLines: analysisResult.failedLines,
                results: analysisResult.results
            },
            metadata: {
                processingMethod: 'native_thermal_engine',
                videoInfo: {
                    totalFrames: this.videoInfo.frames,
                    fps: this.videoInfo.fps,
                    resolution: `${this.videoInfo.width}x${this.videoInfo.height}`
                }
            }
        };
    }

    /**
     * Get cache status for monitoring
     * @returns {Object} Cache information
     */
    getCacheStatus() {
        const now = Date.now();
        let expiredEntries = 0;
        
        for (const [key, cached] of this.analysisCache.entries()) {
            if (now - cached.timestamp > this.cacheTimeout) {
                expiredEntries++;
            }
        }

        return {
            totalEntries: this.analysisCache.size,
            expiredEntries: expiredEntries,
            validEntries: this.analysisCache.size - expiredEntries,
            cacheTimeoutMs: this.cacheTimeout,
            maxCacheSize: 1000 // Reasonable limit
        };
    }

    /**
     * Clear analysis cache
     */
    clearCache() {
        const count = this.analysisCache.size;
        this.analysisCache.clear();
        console.log(`Cleared thermal analysis cache (${count} entries)`);
    }

    // === PRIVATE HELPER METHODS ===

    /**
     * Calculate temperature statistics for an array of temperatures
     * @private
     * @param {Array<number>} temperatures - Temperature values
     * @returns {Object} Statistics object
     */
    _calculateTemperatureStatistics(temperatures) {
        if (!temperatures || temperatures.length === 0) {
            return {
                count: 0,
                min: null,
                max: null,
                avg: null,
                median: null,
                range: null
            };
        }

        // Filter out invalid temperatures (negative values)
        const validTemps = temperatures.filter(t => t >= 0);
        
        if (validTemps.length === 0) {
            return {
                count: 0,
                validCount: 0,
                invalidCount: temperatures.length,
                min: null,
                max: null,
                avg: null,
                median: null,
                range: null
            };
        }

        // Calculate basic statistics
        const min = Math.min(...validTemps);
        const max = Math.max(...validTemps);
        const sum = validTemps.reduce((a, b) => a + b, 0);
        const avg = sum / validTemps.length;

        // Calculate median
        const sortedTemps = [...validTemps].sort((a, b) => a - b);
        const median = sortedTemps.length % 2 === 0 
            ? (sortedTemps[sortedTemps.length / 2 - 1] + sortedTemps[sortedTemps.length / 2]) / 2
            : sortedTemps[Math.floor(sortedTemps.length / 2)];

        return {
            count: temperatures.length,
            validCount: validTemps.length,
            invalidCount: temperatures.length - validTemps.length,
            min: min,
            max: max,
            avg: avg,
            median: median,
            range: max - min,
            
            // Additional metrics
            sum: sum,
            validPercentage: (validTemps.length / temperatures.length) * 100
        };
    }

    /**
     * Get cached analysis result
     * @private
     * @param {string} cacheKey - Cache key
     * @returns {Object|null} Cached result or null
     */
    _getCachedResult(cacheKey) {
        const cached = this.analysisCache.get(cacheKey);
        if (!cached) return null;

        // Check if cache has expired
        const now = Date.now();
        if (now - cached.timestamp > this.cacheTimeout) {
            this.analysisCache.delete(cacheKey);
            return null;
        }

        return cached.data;
    }

    /**
     * Set cached analysis result
     * @private
     * @param {string} cacheKey - Cache key
     * @param {Object} data - Data to cache
     */
    _setCachedResult(cacheKey, data) {
        // Prevent cache from growing too large
        if (this.analysisCache.size > 1000) {
            // Remove oldest entries
            const entries = Array.from(this.analysisCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            for (let i = 0; i < 100; i++) {
                this.analysisCache.delete(entries[i][0]);
            }
        }

        this.analysisCache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
    }
}

module.exports = ThermalDataProcessor;