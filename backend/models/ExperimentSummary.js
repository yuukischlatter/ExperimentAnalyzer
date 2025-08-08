/**
 * Experiment Summary Model
 * Data model for computed experiment summary information
 * File: backend/models/ExperimentSummary.js
 */

class ExperimentSummary {
    constructor(data = {}) {
        // Core experiment info
        this.experimentId = data.experimentId || '';
        this.experiment = data.experiment || null;
        this.metadata = data.metadata || null;
        
        // Computed summary sections
        this.weldingPerformance = data.weldingPerformance || {};
        this.tensileResults = data.tensileResults || {};
        this.temperatureMonitoring = data.temperatureMonitoring || {};
        this.geometryAndPosition = data.geometryAndPosition || {};
        this.vibrationAnalysis = data.vibrationAnalysis || {};
        this.fileAvailability = data.fileAvailability || {};
        
        // Processing metadata
        this.computedAt = data.computedAt || new Date();
        this.dataSourcesUsed = data.dataSourcesUsed || [];
        this.computationStatus = data.computationStatus || 'unknown';
        this.errors = data.errors || [];
    }

    // === WELDING PERFORMANCE METHODS ===

    /**
     * Set welding performance metrics
     */
    setWeldingPerformance(data) {
        this.weldingPerformance = {
            program: data.program || 'Unknown',
            programNumber: data.programNumber || '',
            programName: data.programName || '',
            material: data.material || 'Unknown',
            shape: data.shape || '',
            operator: data.operator || 'Unknown',
            peakForce: this.formatMetric(data.peakForce, 'kN', 1),
            peakCurrentGR1: this.formatMetric(data.peakCurrentGR1, 'A', 0),
            peakCurrentGR2: this.formatMetric(data.peakCurrentGR2, 'A', 0),
            maxVoltage: this.formatMetric(data.maxVoltage, 'V', 1),
            maxPressure: this.formatMetric(data.maxPressure, 'Bar', 1),
            duration: this.formatDuration(data.duration),
            oilTemperature: this.formatMetric(data.oilTemperature, '°C', 1)
        };
    }

    // === TENSILE RESULTS METHODS ===

    /**
     * Set tensile test results
     */
    setTensileResults(data) {
        const peakForce = data.peakForce || 0;
        const targetForce = data.targetForce || data.nominalForce || 1800;
        const minForce = data.minForceLimit || targetForce * 0.9;
        
        this.tensileResults = {
            peakForce: this.formatMetric(peakForce, 'kN', 0),
            targetForce: this.formatMetric(targetForce, 'kN', 0),
            minForceLimit: this.formatMetric(minForce, 'kN', 0),
            result: this.determinePassFail(peakForce, minForce),
            maxDisplacement: this.formatMetric(data.maxDisplacement, 'mm', 1),
            materialGrade: data.materialGrade || data.material || 'Unknown',
            testDate: data.testDate || null,
            marginPercent: this.calculateMargin(peakForce, targetForce)
        };
    }

    // === TEMPERATURE MONITORING METHODS ===

    /**
     * Set temperature monitoring data
     */
    setTemperatureMonitoring(data) {
        this.temperatureMonitoring = {
            weldingTempRange: {
                min: this.formatMetric(data.weldingTempMin, '°C', 1),
                max: this.formatMetric(data.weldingTempMax, '°C', 1),
                range: this.formatMetric(data.weldingTempRange, '°C', 1)
            },
            ambientTempRange: {
                min: this.formatMetric(data.ambientTempMin, '°C', 1),
                max: this.formatMetric(data.ambientTempMax, '°C', 1),
                range: this.formatMetric(data.ambientTempRange, '°C', 1)
            },
            duration: this.formatDuration(data.duration),
            channels: data.channels || []
        };
    }

    // === GEOMETRY AND POSITION METHODS ===

    /**
     * Set geometry and position data
     */
    setGeometryAndPosition(data) {
        this.geometryAndPosition = {
            crownMeasurements: {
                warm: {
                    inlet: this.formatMetric(data.crownEinlaufWarm, 'mm', 1),
                    outlet: this.formatMetric(data.crownAuslaufWarm, 'mm', 1)
                },
                cold: {
                    inlet: this.formatMetric(data.crownEinlaufKalt, 'mm', 1),
                    outlet: this.formatMetric(data.crownAuslaufKalt, 'mm', 1)
                },
                differences: {
                    inlet: this.formatMetric(data.crownDifferenceInlet, 'mm', 2),
                    outlet: this.formatMetric(data.crownDifferenceOutlet, 'mm', 2)
                },
                measurementInterval: this.formatMetric(data.crownMeasurementInterval, 'min', 0)
            },
            railMovement: {
                totalDisplacement: this.formatMetric(data.totalDisplacement, 'mm', 1),
                positionRange: {
                    min: this.formatMetric(data.positionMin, 'mm', 2),
                    max: this.formatMetric(data.positionMax, 'mm', 2)
                }
            },
            railInfo: {
                einlaufseite: data.einlaufseite || '',
                auslaufseite: data.auslaufseite || ''
            }
        };
    }

    // === VIBRATION ANALYSIS METHODS ===

    /**
     * Set vibration analysis data
     */
    setVibrationAnalysis(data) {
        this.vibrationAnalysis = {
            peakAcceleration: this.formatMetric(data.peakAcceleration, 'm/s²', 1),
            axisBreakdown: {
                x: this.formatMetric(data.maxAccX, 'm/s²', 1),
                y: this.formatMetric(data.maxAccY, 'm/s²', 1),
                z: this.formatMetric(data.maxAccZ, 'm/s²', 1)
            },
            rmsValues: {
                x: this.formatMetric(data.rmsX, 'm/s²', 2),
                y: this.formatMetric(data.rmsY, 'm/s²', 2),
                z: this.formatMetric(data.rmsZ, 'm/s²', 2),
                magnitude: this.formatMetric(data.rmsMagnitude, 'm/s²', 2)
            },
            duration: this.formatDuration(data.duration),
            samplingRate: this.formatMetric(data.samplingRate, 'Hz', 0)
        };
    }

    // === FILE AVAILABILITY METHODS ===

    /**
     * Set file availability summary
     */
    setFileAvailability(experiment) {
        const fileTypes = [
            { key: 'hasBinFile', label: 'Binary Data', priority: 'high' },
            { key: 'hasTensileCsv', label: 'Tensile Test', priority: 'high' },
            { key: 'hasWeldJournal', label: 'Weld Journal', priority: 'high' },
            { key: 'hasAccelerationCsv', label: 'Acceleration', priority: 'medium' },
            { key: 'hasPositionCsv', label: 'Position', priority: 'medium' },
            { key: 'hasAmbientTemperature', label: 'Temperature', priority: 'medium' },
            { key: 'hasCrownMeasurements', label: 'Crown Measurements', priority: 'medium' },
            { key: 'hasPhotos', label: 'Photos', priority: 'low' },
            { key: 'hasThermalRavi', label: 'Thermal IR', priority: 'low' },
            { key: 'hasTcp5File', label: 'TCP5 Data', priority: 'low' }
        ];

        const available = [];
        const missing = [];
        let highPriorityCount = 0;
        let totalHighPriority = 0;

        fileTypes.forEach(fileType => {
            if (fileType.priority === 'high') totalHighPriority++;
            
            if (experiment[fileType.key]) {
                available.push(fileType.label);
                if (fileType.priority === 'high') highPriorityCount++;
            } else {
                missing.push(fileType.label);
            }
        });

        this.fileAvailability = {
            available: available,
            missing: missing,
            totalFiles: fileTypes.length,
            availableCount: available.length,
            missingCount: missing.length,
            completeness: Math.round((available.length / fileTypes.length) * 100),
            criticalFilesComplete: highPriorityCount === totalHighPriority,
            criticalFilesCount: `${highPriorityCount}/${totalHighPriority}`
        };
    }

    // === UTILITY METHODS ===

    /**
     * Format metric value with unit and precision
     */
    formatMetric(value, unit, precision = 1) {
        if (value == null || isNaN(value)) {
            return { value: null, display: 'N/A', unit: unit };
        }

        const numValue = parseFloat(value);
        const displayValue = precision === 0 ? 
            Math.round(numValue).toLocaleString() : 
            numValue.toFixed(precision);

        return {
            value: numValue,
            display: displayValue,
            unit: unit,
            formatted: `${displayValue} ${unit}`
        };
    }

    /**
     * Format duration (seconds to readable format)
     */
    formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) {
            return { value: null, display: 'N/A' };
        }

        const sec = Math.round(seconds);
        const min = Math.floor(sec / 60);
        const remainingSec = sec % 60;

        let display;
        if (min === 0) {
            display = `${remainingSec}s`;
        } else {
            display = `${min}:${String(remainingSec).padStart(2, '0')}`;
        }

        return {
            value: seconds,
            display: display,
            totalSeconds: sec,
            minutes: min,
            seconds: remainingSec
        };
    }

    /**
     * Determine pass/fail status
     */
    determinePassFail(actual, minimum) {
        if (actual == null || minimum == null) return 'UNKNOWN';
        return actual >= minimum ? 'PASS' : 'FAIL';
    }

    /**
     * Calculate margin percentage
     */
    calculateMargin(actual, target) {
        if (!actual || !target) return null;
        return Math.round(((actual - target) / target) * 100);
    }

    // === OUTPUT METHODS ===

    /**
     * Convert to display format for frontend
     */
    toDisplayFormat() {
        return {
            experimentId: this.experimentId,
            weldingPerformance: this.weldingPerformance,
            tensileResults: this.tensileResults,
            temperatureMonitoring: this.temperatureMonitoring,
            geometryAndPosition: this.geometryAndPosition,
            vibrationAnalysis: this.vibrationAnalysis,
            fileAvailability: this.fileAvailability,
            computedAt: this.computedAt,
            dataSourcesUsed: this.dataSourcesUsed,
            computationStatus: this.computationStatus,
            hasErrors: this.errors.length > 0,
            errors: this.errors
        };
    }

    /**
     * Get key metrics as bullet points
     */
    getBulletPoints() {
        const bullets = [];

        // Welding performance
        if (this.weldingPerformance.program) {
            bullets.push(`Program: ${this.weldingPerformance.program}`);
        }
        if (this.weldingPerformance.material) {
            bullets.push(`Material: ${this.weldingPerformance.material}`);
        }
        if (this.weldingPerformance.peakForce.value) {
            bullets.push(`Peak Force: ${this.weldingPerformance.peakForce.formatted}`);
        }

        // Tensile results
        if (this.tensileResults.peakForce.value) {
            bullets.push(`Tensile: ${this.tensileResults.peakForce.formatted} ${this.tensileResults.result}`);
        }

        // File completeness
        if (this.fileAvailability.completeness) {
            bullets.push(`Files: ${this.fileAvailability.completeness}% complete`);
        }

        return bullets;
    }

    /**
     * Check if summary is complete
     */
    isComplete() {
        return this.computationStatus === 'complete' && this.errors.length === 0;
    }

    /**
     * Add error to summary
     */
    addError(error) {
        this.errors.push({
            message: error,
            timestamp: new Date()
        });
        if (this.computationStatus === 'complete') {
            this.computationStatus = 'partial';
        }
    }

    /**
     * Add data source
     */
    addDataSource(source) {
        if (!this.dataSourcesUsed.includes(source)) {
            this.dataSourcesUsed.push(source);
        }
    }

    /**
     * Set computation status
     */
    setComputationStatus(status) {
        this.computationStatus = status; // 'complete', 'partial', 'failed', 'unknown'
    }
}

module.exports = ExperimentSummary;