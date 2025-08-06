/**
 * Experiment Model
 * Converts C# Models/Core/Experiment.cs to JavaScript
 */

class Experiment {
    constructor(data = {}) {
        this.id = data.id || data.Id || '';
        this.folderPath = data.folderPath || data.FolderPath || '';
        this.experimentDate = data.experimentDate || data.ExperimentDate || null;
        this.createdAt = data.createdAt || data.CreatedAt || new Date();
        this.updatedAt = data.updatedAt || data.UpdatedAt || new Date();
        
        // File availability flags (populated by DirectoryScanner)
        this.hasBinFile = Boolean(data.hasBinFile || data.HasBinFile);
        this.hasAccelerationCsv = Boolean(data.hasAccelerationCsv || data.HasAccelerationCsv);
        this.hasPositionCsv = Boolean(data.hasPositionCsv || data.HasPositionCsv);
        this.hasTensileCsv = Boolean(data.hasTensileCsv || data.HasTensileCsv);
        this.hasThermalRavi = Boolean(data.hasThermalRavi || data.HasThermalRavi);
        this.hasTcp5File = Boolean(data.hasTcp5File || data.HasTcp5File);
        this.hasWeldJournal = Boolean(data.hasWeldJournal || data.HasWeldJournal);
        this.hasCrownMeasurements = Boolean(data.hasCrownMeasurements || data.HasCrownMeasurements);
        this.hasAmbientTemperature = Boolean(data.hasAmbientTemperature || data.HasAmbientTemperature);
        this.hasPhotos = Boolean(data.hasPhotos || data.HasPhotos);
    }

    /**
     * Convert to database format (for INSERT/UPDATE)
     * Converts JavaScript naming to database column names
     */
    toDatabaseFormat() {
        return {
            id: this.id,
            folder_path: this.folderPath,
            experiment_date: this.experimentDate ? formatDateForDB(this.experimentDate) : null,
            created_at: formatDateTimeForDB(this.createdAt),
            updated_at: formatDateTimeForDB(this.updatedAt),
            has_bin_file: this.hasBinFile ? 1 : 0,
            has_acceleration_csv: this.hasAccelerationCsv ? 1 : 0,
            has_position_csv: this.hasPositionCsv ? 1 : 0,
            has_tensile_csv: this.hasTensileCsv ? 1 : 0,
            has_thermal_ravi: this.hasThermalRavi ? 1 : 0,
            has_tcp5_file: this.hasTcp5File ? 1 : 0,
            has_weld_journal: this.hasWeldJournal ? 1 : 0,
            has_crown_measurements: this.hasCrownMeasurements ? 1 : 0,
            has_ambient_temperature: this.hasAmbientTemperature ? 1 : 0,
            has_photos: this.hasPhotos ? 1 : 0
        };
    }

    /**
     * Create from database row
     * Converts database column names to JavaScript naming
     */
    static fromDatabaseRow(row) {
        if (!row) return null;
        
        return new Experiment({
            id: row.id || row.Id,
            folderPath: row.folder_path || row.FolderPath,
            experimentDate: row.experiment_date || row.ExperimentDate,
            createdAt: row.created_at || row.CreatedAt,
            updatedAt: row.updated_at || row.UpdatedAt,
            hasBinFile: Boolean(row.has_bin_file || row.HasBinFile),
            hasAccelerationCsv: Boolean(row.has_acceleration_csv || row.HasAccelerationCsv),
            hasPositionCsv: Boolean(row.has_position_csv || row.HasPositionCsv),
            hasTensileCsv: Boolean(row.has_tensile_csv || row.HasTensileCsv),
            hasThermalRavi: Boolean(row.has_thermal_ravi || row.HasThermalRavi),
            hasTcp5File: Boolean(row.has_tcp5_file || row.HasTcp5File),
            hasWeldJournal: Boolean(row.has_weld_journal || row.HasWeldJournal),
            hasCrownMeasurements: Boolean(row.has_crown_measurements || row.HasCrownMeasurements),
            hasAmbientTemperature: Boolean(row.has_ambient_temperature || row.HasAmbientTemperature),
            hasPhotos: Boolean(row.has_photos || row.HasPhotos)
        });
    }

    /**
     * Validate experiment data
     */
    validate() {
        const errors = [];

        if (!this.id) {
            errors.push('Experiment ID is required');
        }

        if (!this.folderPath) {
            errors.push('Folder path is required');
        }

        if (this.experimentDate && isNaN(new Date(this.experimentDate).getTime())) {
            errors.push('Invalid experiment date');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Get human-readable file summary
     */
    getFileSummary() {
        const availableFiles = [];
        
        if (this.hasBinFile) availableFiles.push('Binary Data');
        if (this.hasAccelerationCsv) availableFiles.push('Acceleration');
        if (this.hasPositionCsv) availableFiles.push('Position');
        if (this.hasTensileCsv) availableFiles.push('Tensile Strength');
        if (this.hasPhotos) availableFiles.push('Photos');
        if (this.hasThermalRavi) availableFiles.push('Thermal IR');
        if (this.hasTcp5File) availableFiles.push('TCP5');
        if (this.hasWeldJournal) availableFiles.push('Weld Journal');
        if (this.hasCrownMeasurements) availableFiles.push('Crown Measurements');
        if (this.hasAmbientTemperature) availableFiles.push('Temperature');

        return availableFiles.join(', ') || 'No files available';
    }
}

/**
 * Format date for database (YYYY-MM-DD)
 */
function formatDateForDB(date) {
    if (!date) return null;
    const d = new Date(date);
    return d.getFullYear() + '-' + 
           String(d.getMonth() + 1).padStart(2, '0') + '-' + 
           String(d.getDate()).padStart(2, '0');
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

module.exports = Experiment;