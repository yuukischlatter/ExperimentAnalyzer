/**
 * Journal Parser Service
 * Converts C# Services/Startup/JournalParser.cs to JavaScript
 * Parses Schweissjournal.txt files and extracts metadata
 */

const fs = require('fs').promises;
const path = require('path');
const ExperimentRepository = require('../repositories/ExperimentRepository');
const ExperimentMetadata = require('../models/ExperimentMetadata');

class JournalParser {
    constructor() {
        this.serviceName = 'Journal Parser';
        this.repository = new ExperimentRepository();
    }

    /**
     * Execute journal parsing (equivalent to C# ExecuteServiceLogicAsync)
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

            // Get experiments that have weld journals
            const experiments = await this.repository.getExperimentsWithJournalsAsync();
            console.log(`Found ${experiments.length} experiments with journals`);

            // Process each experiment
            for (const experiment of experiments) {
                try {
                    // Skip if metadata already parsed (unless force refresh)
                    if (!forceRefresh && await this.repository.metadataExistsAsync(experiment.id)) {
                        result.skippedCount++;
                        continue;
                    }

                    // Find journal file (guaranteed to exist since DirectoryScanner only saves experiments with journals)
                    const journalPath = await this.findJournalFile(experiment.folderPath);
                    if (!journalPath) {
                        throw new Error(`Journal file not found in ${experiment.folderPath}`);
                    }

                    // Parse journal file
                    const metadata = await this.parseJournalFile(experiment.id, journalPath);
                    await this.repository.upsertMetadataAsync(metadata);

                    result.processedCount++;
                    console.log(`Parsed journal for: ${experiment.id}`);

                } catch (error) {
                    const errorMsg = `Failed to parse journal for ${experiment.id}: ${error.message}`;
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
     * Find journal file in experiment folder
     * @param {string} experimentFolder 
     * @returns {Promise<string|null>} Journal file path
     */
    async findJournalFile(experimentFolder) {
        try {
            const files = await this.getAllFilesRecursive(experimentFolder);
            const journalFile = files.find(file => 
                path.basename(file).toLowerCase() === 'schweissjournal.txt'
            );
            return journalFile || null;
        } catch (error) {
            console.error(`Error finding journal file in ${experimentFolder}:`, error);
            return null;
        }
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
     * Parse journal file and extract metadata (equivalent to C# ParseJournalFileAsync)
     * @param {string} experimentId 
     * @param {string} journalPath 
     * @returns {Promise<ExperimentMetadata>}
     */
    async parseJournalFile(experimentId, journalPath) {
        try {
            // Read file content
            const content = await fs.readFile(journalPath, 'utf8');
            
            // Split into lines and clean up
            const lines = content.split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0);

            // Create metadata object
            const metadata = new ExperimentMetadata({
                experimentId: experimentId,
                parsedAt: new Date()
            });

            // Process each line
            for (const line of lines) {
                const parts = line.split(';');
                if (parts.length < 2) continue;

                let value = parts[0].trim();
                let key = parts[1].trim();

                // Special handling for rail label entries (they have 5 parts)
                // Format: "P65-2;DT350;49531 104 12 Bereits 2x geschweisst;Schienenetikett Einlaufseite;-"
                if (parts.length >= 4) {
                    const possibleKey = parts[3].trim().toLowerCase();
                    if (possibleKey.includes('schienenetikett')) {
                        key = possibleKey;
                        // For rail labels, we need the first two parts: "P65-2;DT350"
                        value = `${parts[0].trim()};${parts[1].trim()}`;
                    }
                }

                // Parse field based on key (same logic as C# version)
                this.parseMetadataField(metadata, key.toLowerCase(), value, parts);
            }

            return metadata;

        } catch (error) {
            throw new Error(`Failed to parse journal file ${journalPath}: ${error.message}`);
        }
    }

    /**
     * Parse individual metadata field (equivalent to C# switch statement)
     * @param {ExperimentMetadata} metadata 
     * @param {string} key 
     * @param {string} value 
     * @param {string[]} parts - All parts of the line
     */
    parseMetadataField(metadata, key, value, parts) {
        switch (key) {
            case 'program-nr':
                metadata.programNumber = value;
                break;
                
            case 'programname':
                metadata.programName = value;
                break;
                
            case 'operator':
                metadata.operator = value;
                break;
                
            case 'öltemperatur':
                const temp = parseFloat(value);
                if (!isNaN(temp)) {
                    metadata.oilTemperature = temp;
                }
                break;
                
            case 'zeitabstandcrownmessung':
                const interval = parseInt(value);
                if (!isNaN(interval)) {
                    metadata.crownMeasurementInterval = interval;
                }
                break;
                
            case 'crowneinlaufseitewarm':
                const crownEW = parseFloat(value);
                if (!isNaN(crownEW)) {
                    metadata.crownEinlaufWarm = crownEW;
                }
                break;
                
            case 'crownauslaufseitewarm':
                const crownAW = parseFloat(value);
                if (!isNaN(crownAW)) {
                    metadata.crownAuslaufWarm = crownAW;
                }
                break;
                
            case 'crowneinlaufseitekalt':
                if (value !== 'x') {
                    const crownEK = parseFloat(value);
                    if (!isNaN(crownEK)) {
                        metadata.crownEinlaufKalt = crownEK;
                    }
                }
                break;
                
            case 'crownauslaufseitekalt':
                if (value !== 'x') {
                    const crownAK = parseFloat(value);
                    if (!isNaN(crownAK)) {
                        metadata.crownAuslaufKalt = crownAK;
                    }
                }
                break;
                
            case 'schleifart':
                metadata.grindingType = value;
                break;
                
            case 'schleifer':
                metadata.grinder = value;
                break;
                
            case 'kommentar':
                metadata.comments = value;
                break;
                
            case 'schienenetikett einlaufseite':
                // Store the full rail info AND extract material/shape
                if (parts.length >= 3) {
                    metadata.einlaufseite = parts[2].trim(); // "49531 104 12 Bereits 2x geschweisst"
                    ExperimentMetadata.extractMaterialAndShape(value, metadata); // Extract from "P65-2;DT350"
                }
                break;
                
            case 'schienenetikett auslaufseite':
                // Store the full rail info
                if (parts.length >= 3) {
                    metadata.auslaufseite = parts[2].trim(); // "49531 104 2 Bereits 2x geschweisst"
                    // Only extract material/shape if we haven't found them yet
                    if (!metadata.material || !metadata.shape) {
                        ExperimentMetadata.extractMaterialAndShape(value, metadata);
                    }
                }
                break;
        }
    }
}

module.exports = JournalParser;