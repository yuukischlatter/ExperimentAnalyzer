/**
 * Experiment Metadata Model
 * Converts C# Models/Core/ExperimentMetadata.cs to JavaScript
 */

class ExperimentMetadata {
    constructor(data = {}) {
        this.experimentId = data.experimentId || data.ExperimentId || '';
        this.programNumber = data.programNumber || data.ProgramNumber || null;
        this.programName = data.programName || data.ProgramName || null;
        this.material = data.material || data.Material || null;
        this.shape = data.shape || data.Shape || null;
        this.operator = data.operator || data.Operator || null;
        this.oilTemperature = data.oilTemperature || data.OilTemperature || null;
        this.crownMeasurementInterval = data.crownMeasurementInterval || data.CrownMeasurementInterval || null;
        this.crownEinlaufWarm = data.crownEinlaufWarm || data.CrownEinlaufWarm || null;
        this.crownAuslaufWarm = data.crownAuslaufWarm || data.CrownAuslaufWarm || null;
        this.crownEinlaufKalt = data.crownEinlaufKalt || data.CrownEinlaufKalt || null;
        this.crownAuslaufKalt = data.crownAuslaufKalt || data.CrownAuslaufKalt || null;
        this.grindingType = data.grindingType || data.GrindingType || null;
        this.grinder = data.grinder || data.Grinder || null;
        this.comments = data.comments || data.Comments || null;
        this.einlaufseite = data.einlaufseite || data.Einlaufseite || null;
        this.auslaufseite = data.auslaufseite || data.Auslaufseite || null;
        this.parsedAt = data.parsedAt || data.ParsedAt || new Date();
    }

    /**
     * Convert to database format (for INSERT/UPDATE)
     */
    toDatabaseFormat() {
        return {
            experiment_id: this.experimentId,
            program_number: this.programNumber,
            program_name: this.programName,
            material: this.material,
            shape: this.shape,
            operator: this.operator,
            oil_temperature: this.oilTemperature,
            crown_measurement_interval: this.crownMeasurementInterval,
            crown_einlauf_warm: this.crownEinlaufWarm,
            crown_auslauf_warm: this.crownAuslaufWarm,
            crown_einlauf_kalt: this.crownEinlaufKalt,
            crown_auslauf_kalt: this.crownAuslaufKalt,
            grinding_type: this.grindingType,
            grinder: this.grinder,
            comments: this.comments,
            einlaufseite: this.einlaufseite,
            auslaufseite: this.auslaufseite,
            parsed_at: formatDateTimeForDB(this.parsedAt)
        };
    }

    /**
     * Create from database row
     */
    static fromDatabaseRow(row) {
        if (!row) return null;
        
        return new ExperimentMetadata({
            experimentId: row.experiment_id || row.ExperimentId,
            programNumber: row.program_number || row.ProgramNumber,
            programName: row.program_name || row.ProgramName,
            material: row.material || row.Material,
            shape: row.shape || row.Shape,
            operator: row.operator || row.Operator,
            oilTemperature: row.oil_temperature || row.OilTemperature,
            crownMeasurementInterval: row.crown_measurement_interval || row.CrownMeasurementInterval,
            crownEinlaufWarm: row.crown_einlauf_warm || row.CrownEinlaufWarm,
            crownAuslaufWarm: row.crown_auslauf_warm || row.CrownAuslaufWarm,
            crownEinlaufKalt: row.crown_einlauf_kalt || row.CrownEinlaufKalt,
            crownAuslaufKalt: row.crown_auslauf_kalt || row.CrownAuslaufKalt,
            grindingType: row.grinding_type || row.GrindingType,
            grinder: row.grinder || row.Grinder,
            comments: row.comments || row.Comments,
            einlaufseite: row.einlaufseite || row.Einlaufseite,
            auslaufseite: row.auslaufseite || row.Auslaufseite,
            parsedAt: row.parsed_at || row.ParsedAt
        });
    }

    /**
     * Apply defaults (equivalent to C# repository defaults)
     */
    applyDefaults() {
        if (!this.programNumber) {
            this.programNumber = '60';
        }
        if (!this.programName) {
            this.programName = 'Standard';
        }
    }

    /**
     * Extract material and shape from rail label value
     * Equivalent to C# ExtractMaterialAndShape method
     */
    static extractMaterialAndShape(railLabelValue, metadata) {
        if (!railLabelValue || !metadata) return;
        
        // Parse rail label values like:
        // "P65-2;DT350" → Shape: "P65-2", Material: "DT350"
        // "VI60E1;R260" → Shape: "VI60E1", Material: "R260"
        // "VI60E1;400UHC" → Shape: "VI60E1", Material: "400UHC"
        
        const parts = railLabelValue.split(';');
        if (parts.length >= 2) {
            const shape = parts[0].trim();
            const material = parts[1].trim();
            
            // Only set if we haven't already found them (prefer first occurrence)
            if (!metadata.shape) {
                metadata.shape = shape;
            }
            if (!metadata.material) {
                metadata.material = material;
            }
        }
    }

    /**
     * Get program info summary
     */
    getProgramSummary() {
        if (this.programNumber && this.programName) {
            return `${this.programNumber} - ${this.programName}`;
        } else if (this.programNumber) {
            return this.programNumber;
        } else if (this.programName) {
            return this.programName;
        }
        return 'Unknown Program';
    }

    /**
     * Get material and shape summary
     */
    getMaterialShapeSummary() {
        const parts = [];
        if (this.material) parts.push(this.material);
        if (this.shape) parts.push(this.shape);
        return parts.length > 0 ? parts.join(' / ') : 'Unknown';
    }

    /**
     * Validate metadata
     */
    validate() {
        const errors = [];

        if (!this.experimentId) {
            errors.push('Experiment ID is required');
        }

        // Validate numeric fields
        if (this.oilTemperature !== null && (isNaN(this.oilTemperature) || this.oilTemperature < 0)) {
            errors.push('Oil temperature must be a positive number');
        }

        if (this.crownMeasurementInterval !== null && (isNaN(this.crownMeasurementInterval) || this.crownMeasurementInterval <= 0)) {
            errors.push('Crown measurement interval must be a positive integer');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

/**
 * Format datetime for database (YYYY-MM-DD HH:mm:ss)
 */
function formatDateTimeForDB(date) {
    if (!date) return null;
    const d = new Date(date);
    return d.getFullYear() + '-' + 
           String(d.getMonth() + 1).padStart(2, '0') + '-' + 
           String(d.getDate()).padStart(2, '0') + ' ' +
           String(d.getHours()).padStart(2, '0') + ':' + 
           String(d.getMinutes()).padStart(2, '0') + ':' + 
           String(d.getSeconds()).padStart(2, '0');
}

module.exports = ExperimentMetadata;