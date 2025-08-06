/**
 * Directory Scanner Service
 * Converts C# Services/Startup/DirectoryScanner.cs to JavaScript
 * Scans experiment directories and detects available files
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const ExperimentRepository = require('../repositories/ExperimentRepository');
const Experiment = require('../models/Experiment');

class DirectoryScanner {
    constructor() {
        this.serviceName = 'Directory Scanner';
        this.repository = new ExperimentRepository();
        this.experimentRootPath = config.experiments.rootPath;
        this.validDateFrom = new Date(config.experiments.validDateFrom);
    }

    /**
     * Execute directory scanning (equivalent to C# ExecuteServiceLogicAsync)
     * @param {boolean} forceRefresh 
     * @returns {Promise<Object>} Service result
     */
    async executeServiceLogicAsync(forceRefresh = false) {
        const startTime = Date.now();
        const result = {
            success: true,
            message: '',
            processedCount: 0,
            skippedCount: 0,
            duration: 0,
            errors: []
        };

        try {
            console.log(`Starting ${this.serviceName}...`);

            // Check if root path exists
            try {
                await fs.access(this.experimentRootPath);
            } catch (error) {
                throw new Error(`Experiment root path not found: ${this.experimentRootPath}`);
            }

            // Get valid experiment folders
            const experimentFolders = await this.getValidExperimentFolders();
            console.log(`Found ${experimentFolders.length} valid experiment folders`);

            // Process each folder
            for (const folderPath of experimentFolders) {
                try {
                    const experimentId = path.basename(folderPath);

                    // Check if journal file exists - skip entire experiment if missing
                    if (!(await this.hasJournalFile(folderPath))) {
                        console.log(`Skipped experiment (no journal): ${experimentId}`);
                        continue; // Skip completely - don't save to database
                    }

                    // Skip if already processed (unless force refresh)
                    if (!forceRefresh && await this.repository.experimentExistsAsync(experimentId)) {
                        result.skippedCount++;
                        continue;
                    }

                    // Scan experiment folder
                    const experiment = await this.scanExperimentFolder(experimentId, folderPath);
                    await this.repository.upsertExperimentAsync(experiment);

                    result.processedCount++;
                    console.log(`Processed experiment: ${experimentId}`);

                } catch (error) {
                    const errorMsg = `Failed to process ${folderPath}: ${error.message}`;
                    result.errors.push(errorMsg);
                    console.error(errorMsg);
                }
            }

            result.duration = Date.now() - startTime;
            result.message = `${this.serviceName} completed: ${result.processedCount} processed, ${result.skippedCount} skipped`;

            console.log(`${this.serviceName} completed: ${result.processedCount} processed, ` +
                       `${result.skippedCount} skipped in ${(result.duration / 1000).toFixed(2)}s`);

        } catch (error) {
            result.success = false;
            result.message = error.message;
            result.errors.push(error.toString());
            result.duration = Date.now() - startTime;
            console.error(`${this.serviceName} failed: ${error.message}`);
            throw error; // Re-throw to fail fast as requested
        }

        return result;
    }

    /**
     * Get valid experiment folders
     * @returns {Promise<string[]>} Array of folder paths
     */
    async getValidExperimentFolders() {
        try {
            const entries = await fs.readdir(this.experimentRootPath, { withFileTypes: true });
            const folders = entries
                .filter(entry => entry.isDirectory())
                .map(entry => path.join(this.experimentRootPath, entry.name))
                .filter(folderPath => this.isValidExperimentFolder(folderPath))
                .sort(); // Sort by folder name

            return folders;
        } catch (error) {
            console.error('Error reading experiment root directory:', error);
            return [];
        }
    }

    /**
     * Check if folder is valid experiment folder (equivalent to C# IsValidExperimentFolder)
     * @param {string} folderPath 
     * @returns {boolean}
     */
    isValidExperimentFolder(folderPath) {
        const folderName = path.basename(folderPath);

        // Match pattern like "J25-07-30(1)" 
        const match = folderName.match(/^J(\d{2})-(\d{2})-(\d{2})\((\d+)\)$/);
        if (!match) return false;

        // Extract date and check if it's after validDateFrom
        const year = 2000 + parseInt(match[1]);
        const month = parseInt(match[2]);
        const day = parseInt(match[3]);

        try {
            const folderDate = new Date(year, month - 1, day); // month is 0-based in JS
            return folderDate >= this.validDateFrom;
        } catch {
            return false; // Invalid date
        }
    }

    /**
     * Check if folder has journal file (equivalent to C# HasJournalFile)
     * @param {string} folderPath 
     * @returns {Promise<boolean>}
     */
    async hasJournalFile(folderPath) {
        try {
            const files = await this.getAllFilesRecursive(folderPath);
            return files.some(file => 
                path.basename(file).toLowerCase() === 'schweissjournal.txt'
            );
        } catch (error) {
            console.error(`Error checking journal file in ${folderPath}:`, error);
            return false;
        }
    }

    /**
     * Scan experiment folder and detect files (equivalent to C# ScanExperimentFolderAsync)
     * @param {string} experimentId 
     * @param {string} folderPath 
     * @returns {Promise<Experiment>}
     */
    async scanExperimentFolder(experimentId, folderPath) {
        // Get all files recursively (handles both flat and nested structures)
        const files = await this.getAllFilesRecursive(folderPath);
        const fileNames = files.map(f => path.basename(f).toLowerCase());

        const experiment = new Experiment({
            id: experimentId,
            folderPath: folderPath,
            experimentDate: this.extractDateFromFolderName(experimentId),
            createdAt: new Date(),
            updatedAt: new Date(),
            
            // File detection logic (same as C# version)
            hasBinFile: this.hasFileType(fileNames, `${experimentId.toLowerCase()}.bin`),
            hasAccelerationCsv: this.hasFileType(fileNames, `${experimentId.toLowerCase()}_beschleuinigung.csv`),
            hasPositionCsv: this.hasFilePattern(fileNames, /^snapshot_optoNCDT-.*\.csv$/i),
            hasTensileCsv: this.hasTensileFile(fileNames, experimentId),
            hasPhotos: this.hasImageFile(files),
            hasThermalRavi: this.hasFilePattern(fileNames, /^record_.*\.ravi$/i),
            hasTcp5File: this.hasFileType(fileNames, `${experimentId.toLowerCase()}_original(manuell).tpc5`),
            hasWeldJournal: this.hasFileType(fileNames, 'schweissjournal.txt'),
            hasCrownMeasurements: this.hasFileType(fileNames, 'geradheit+versatz.xlsx'),
            hasAmbientTemperature: this.hasFilePattern(fileNames, /^temperature.*\.csv$/i)
        });

        return experiment;
    }

    /**
     * Get all files recursively from directory
     * @param {string} dirPath 
     * @returns {Promise<string[]>}
     */
    async getAllFilesRecursive(dirPath) {
        const files = [];
        
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    const subFiles = await this.getAllFilesRecursive(fullPath);
                    files.push(...subFiles);
                } else if (entry.isFile()) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
        }
        
        return files;
    }

    /**
     * Check if specific file type exists
     * @param {string[]} fileNames - Lowercase filenames
     * @param {string} fileName - Target filename (lowercase)
     * @returns {boolean}
     */
    hasFileType(fileNames, fileName) {
        return fileNames.includes(fileName.toLowerCase());
    }

    /**
     * Check if file pattern exists
     * @param {string[]} fileNames - Lowercase filenames
     * @param {RegExp} pattern - Regex pattern
     * @returns {boolean}
     */
    hasFilePattern(fileNames, pattern) {
        return fileNames.some(name => pattern.test(name));
    }

    /**
     * Check for tensile file (equivalent to C# HasTensileFile)
     * @param {string[]} fileNames - Lowercase filenames
     * @param {string} experimentId 
     * @returns {boolean}
     */
    hasTensileFile(fileNames, experimentId) {
        const expIdLower = experimentId.toLowerCase();
        
        // Check for new format: {ExperimentID}*.csv (but not acceleration, temperature, or snapshot)
        const hasNewFormat = fileNames.some(name => 
            name.endsWith('.csv') &&
            name.startsWith(expIdLower) &&
            !name.includes('beschleuinigung') &&
            !name.includes('temperature') &&
            !name.includes('snapshot')
        );
        
        // Check for old format: *redalsa.csv
        const hasOldFormat = fileNames.some(name => name.endsWith('redalsa.csv'));
        
        return hasNewFormat || hasOldFormat;
    }

    /**
     * Check for image files (equivalent to C# HasImageFile)
     * @param {string[]} files - Full file paths
     * @returns {boolean}
     */
    hasImageFile(files) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif'];
        return files.some(file => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
        });
    }

    /**
     * Extract date from folder name (equivalent to C# ExtractDateFromFolderName)
     * @param {string} folderName 
     * @returns {Date|null}
     */
    extractDateFromFolderName(folderName) {
        const match = folderName.match(/^J(\d{2})-(\d{2})-(\d{2})\((\d+)\)$/);
        if (match) {
            const year = 2000 + parseInt(match[1]);
            const month = parseInt(match[2]);
            const day = parseInt(match[3]);
            
            try {
                return new Date(year, month - 1, day); // month is 0-based in JS
            } catch {
                return null;
            }
        }
        return null;
    }
}

module.exports = DirectoryScanner;