/**
 * Photo Service
 * Handles photo/image file scanning and metadata extraction for experiments
 * Manages photo listing, metadata generation, and file serving for experiment folders
 */

const path = require('path');
const fs = require('fs').promises;
const config = require('../config/config');
const { createServiceResult } = require('../models/ApiResponse');

class PhotoService {
    constructor() {
        this.serviceName = 'Photo Service';
        // In-memory cache for photo metadata
        this.photoCache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes TTL (same as other services)
        
        // Supported image extensions
        this.supportedExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.gif'];
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Get all photos metadata for an experiment
     * @param {string} experimentId - Experiment ID (e.g., "J25-07-30(3)")
     * @param {boolean} forceRefresh - Force re-scanning even if cached
     * @returns {Promise<Object>} Service result with photo metadata
     */
    async getExperimentPhotos(experimentId, forceRefresh = false) {
        const startTime = Date.now();
        
        try {
            console.log(`${this.serviceName}: Getting photos for experiment ${experimentId}`);
            
            // Check cache first (unless forcing refresh)
            if (!forceRefresh) {
                const cachedData = this._getCachedData(experimentId);
                if (cachedData) {
                    console.log(`Using cached photo data for ${experimentId}`);
                    return createServiceResult(true, 'Photo data loaded from cache', cachedData.photos.length, 0, Date.now() - startTime);
                }
            }

            // Get experiment folder path
            const experimentFolder = path.join(config.experiments.rootPath, experimentId);
            
            // Check if experiment folder exists
            try {
                await fs.access(experimentFolder);
            } catch (error) {
                const errorMsg = `Experiment folder not found: ${experimentId}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Scan for photo files
            const photoFiles = await this.scanPhotosInFolder(experimentFolder);
            
            if (photoFiles.length === 0) {
                const errorMsg = `No photo files found for experiment: ${experimentId}`;
                console.warn(errorMsg);
                return createServiceResult(false, errorMsg, 0, 0, Date.now() - startTime, [errorMsg]);
            }

            // Generate metadata for each photo
            const photosMetadata = [];
            for (const photoPath of photoFiles) {
                try {
                    const metadata = await this.generatePhotoMetadata(photoPath);
                    photosMetadata.push(metadata);
                } catch (error) {
                    console.warn(`Failed to generate metadata for ${photoPath}:`, error.message);
                    // Continue with other photos
                }
            }

            // Cache the results
            const photoData = {
                experimentId: experimentId,
                experimentFolder: experimentFolder,
                photoCount: photosMetadata.length,
                photos: photosMetadata,
                scannedAt: new Date()
            };

            this._setCachedData(experimentId, photoData);

            const duration = Date.now() - startTime;
            console.log(`${this.serviceName}: Successfully scanned ${photosMetadata.length} photos for ${experimentId} in ${duration}ms`);

            return createServiceResult(
                true, 
                `Found ${photosMetadata.length} photos`, 
                photosMetadata.length, 
                0, 
                duration
            );

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = `Failed to get photos for ${experimentId}: ${error.message}`;
            console.error(`${this.serviceName}:`, errorMsg);
            
            return createServiceResult(
                false, 
                errorMsg, 
                0, 
                0, 
                duration, 
                [error.toString()]
            );
        }
    }

    /**
     * Scan folder for photo files recursively
     * @param {string} folderPath - Folder to scan
     * @returns {Promise<string[]>} Array of photo file paths
     */
    async scanPhotosInFolder(folderPath) {
        const photoFiles = [];
        
        try {
            const files = await this._getAllFilesRecursive(folderPath);
            
            // Filter for image files
            for (const filePath of files) {
                const ext = path.extname(filePath).toLowerCase();
                if (this.supportedExtensions.includes(ext)) {
                    photoFiles.push(filePath);
                }
            }
            
            // Sort photos by filename for consistent ordering
            photoFiles.sort((a, b) => {
                const nameA = path.basename(a).toLowerCase();
                const nameB = path.basename(b).toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
        } catch (error) {
            console.error(`Error scanning photos in ${folderPath}:`, error);
        }
        
        return photoFiles;
    }

    /**
     * Generate metadata for a single photo file
     * @param {string} photoPath - Full path to photo file
     * @returns {Promise<Object>} Photo metadata
     */
    async generatePhotoMetadata(photoPath) {
        try {
            const stats = await fs.stat(photoPath);
            const filename = path.basename(photoPath);
            const ext = path.extname(photoPath).toLowerCase();
            
            // Basic file metadata
            const metadata = {
                filename: filename,
                filepath: photoPath, // Full path for internal use
                relativePath: photoPath.replace(config.experiments.rootPath, ''), // Relative path
                extension: ext,
                size: stats.size,
                sizeFormatted: this.formatFileSize(stats.size),
                lastModified: stats.mtime,
                created: stats.birthtime,
                
                // Image-specific metadata (basic)
                type: this.getImageType(ext),
                isSupported: true
            };

            // Try to get image dimensions (optional - requires image processing library)
            try {
                // For now, we'll skip dimension detection to avoid heavy dependencies
                // Could be added later with libraries like 'sharp' or 'image-size'
                metadata.dimensions = null;
            } catch (error) {
                // Dimensions not available
                metadata.dimensions = null;
            }

            return metadata;
            
        } catch (error) {
            throw new Error(`Failed to generate metadata for ${photoPath}: ${error.message}`);
        }
    }

    /**
     * Get photo file path for serving
     * @param {string} experimentId - Experiment ID
     * @param {string} filename - Photo filename
     * @returns {Promise<string|null>} Full path to photo file or null if not found
     */
    async getPhotoFilePath(experimentId, filename) {
        try {
            // Get cached photo data if available
            const cachedData = this._getCachedData(experimentId);
            if (cachedData) {
                const photo = cachedData.photos.find(p => p.filename === filename);
                if (photo) {
                    // Verify file still exists
                    try {
                        await fs.access(photo.filepath);
                        return photo.filepath;
                    } catch (error) {
                        console.warn(`Cached photo file no longer exists: ${photo.filepath}`);
                    }
                }
            }

            // Fallback: scan folder for the file
            const experimentFolder = path.join(config.experiments.rootPath, experimentId);
            const photoFiles = await this.scanPhotosInFolder(experimentFolder);
            
            const photoFile = photoFiles.find(filePath => 
                path.basename(filePath).toLowerCase() === filename.toLowerCase()
            );
            
            return photoFile || null;
            
        } catch (error) {
            console.error(`Error getting photo file path for ${experimentId}/${filename}:`, error);
            return null;
        }
    }

    /**
     * Check if experiment has photos
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<boolean>} True if experiment has photos
     */
    async hasPhotos(experimentId) {
        try {
            const result = await this.getExperimentPhotos(experimentId);
            return result.success && result.processedCount > 0;
        } catch (error) {
            console.error(`Error checking photos for ${experimentId}:`, error);
            return false;
        }
    }

    /**
     * Get photo metadata only (lightweight)
     * @param {string} experimentId - Experiment ID
     * @returns {Promise<Object>} Photo metadata without file data
     */
    async getPhotosMetadata(experimentId) {
        try {
            const result = await this.getExperimentPhotos(experimentId);
            
            if (!result.success) {
                return { success: false, error: result.message };
            }

            const cachedData = this._getCachedData(experimentId);
            if (!cachedData) {
                return { success: false, error: 'No photo data found after scanning' };
            }

            // Return lightweight metadata (no file paths for security)
            const lightweightPhotos = cachedData.photos.map(photo => ({
                filename: photo.filename,
                extension: photo.extension,
                size: photo.size,
                sizeFormatted: photo.sizeFormatted,
                lastModified: photo.lastModified,
                type: photo.type,
                dimensions: photo.dimensions
            }));

            return {
                success: true,
                experimentId: experimentId,
                photoCount: cachedData.photoCount,
                photos: lightweightPhotos,
                scannedAt: cachedData.scannedAt
            };

        } catch (error) {
            console.error(`Error getting photos metadata for ${experimentId}:`, error);
            return { 
                success: false, 
                error: `Failed to get photos metadata: ${error.message}` 
            };
        }
    }

    /**
     * Clear cached data for experiment
     * @param {string} experimentId - Experiment ID
     */
    clearCache(experimentId) {
        if (this.photoCache.has(experimentId)) {
            this.photoCache.delete(experimentId);
            console.log(`Cleared photo cache for experiment ${experimentId}`);
        }
    }

    /**
     * Clear all cached data
     */
    clearAllCache() {
        const count = this.photoCache.size;
        this.photoCache.clear();
        console.log(`Cleared all photo cached data (${count} experiments)`);
    }

    /**
     * Get cache status
     * @returns {Object} Cache information
     */
    getCacheStatus() {
        const cacheEntries = [];
        
        for (const [experimentId, data] of this.photoCache.entries()) {
            cacheEntries.push({
                experimentId: experimentId,
                scannedAt: data.scannedAt,
                photoCount: data.photoCount,
                folderPath: path.basename(data.experimentFolder)
            });
        }

        return {
            totalCachedExperiments: this.photoCache.size,
            cacheTimeoutMs: this.cacheTimeout,
            supportedExtensions: this.supportedExtensions,
            entries: cacheEntries
        };
    }

    // === PRIVATE HELPER METHODS ===

    /**
     * Get cached data for experiment
     * @private
     */
    _getCachedData(experimentId) {
        const cached = this.photoCache.get(experimentId);
        if (!cached) return null;

        // Check if cache has expired
        const now = Date.now();
        const cacheAge = now - cached.scannedAt.getTime();
        
        if (cacheAge > this.cacheTimeout) {
            this.photoCache.delete(experimentId);
            console.log(`Photo cache expired for experiment ${experimentId}`);
            return null;
        }

        return cached;
    }

    /**
     * Set cached data for experiment
     * @private
     */
    _setCachedData(experimentId, data) {
        this.photoCache.set(experimentId, data);
        console.log(`Cached photo data for experiment ${experimentId}: ${data.photoCount} photos`);
    }

    /**
     * Get all files recursively from directory (helper method)
     * @private
     */
    async _getAllFilesRecursive(dirPath) {
        const files = [];
        
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isFile()) {
                    files.push(fullPath);
                } else if (entry.isDirectory()) {
                    // Recursively scan subdirectories
                    const subFiles = await this._getAllFilesRecursive(fullPath);
                    files.push(...subFiles);
                }
            }
        } catch (error) {
            // Silently handle directory read errors
            console.warn(`Could not read directory ${dirPath}: ${error.message}`);
        }
        
        return files;
    }

    /**
     * Format file size in human readable format
     * @private
     */
    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = bytes / Math.pow(1024, i);
        
        return Math.round(size * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Get image type from extension
     * @private
     */
    getImageType(extension) {
        const types = {
            '.jpg': 'JPEG Image',
            '.jpeg': 'JPEG Image', 
            '.png': 'PNG Image',
            '.bmp': 'Bitmap Image',
            '.tiff': 'TIFF Image',
            '.tif': 'TIFF Image',
            '.gif': 'GIF Image'
        };
        
        return types[extension.toLowerCase()] || 'Image File';
    }
}

module.exports = PhotoService;