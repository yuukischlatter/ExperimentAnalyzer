/**
 * Experiment Summary Module
 * Executive overview of key metrics and experiment results
 * Integrates with backend SummaryService for comprehensive analysis
 * NOW INCLUDES: Notes functionality for user annotations
 */

class ExperimentSummary {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = Object.assign(this.getDefaultConfig(), config);
        this.state = {
            isLoaded: false,
            isVisible: false,
            experimentId: null,
            summaryData: null,
            lastUpdated: null
        };
        this.elements = {};
        
        // Notes-specific state
        this.lastSavedNotesText = '';
        this.notesAutoSaveTimeout = null;
        
        console.log('ExperimentSummary initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            refreshInterval: null,
            cacheTimeout: 5 * 60 * 1000,
            precision: {
                force: 1,
                current: 0,
                voltage: 1,
                temperature: 1,
                position: 2,
                acceleration: 2
            }
        };
    }
    
    async init() {
        try {
            await this.loadTemplate();
            this.bindElements();
            this.attachEvents();
            
            if (this.config.autoLoad && this.config.experimentId) {
                await this.loadExperiment(this.config.experimentId);
            }
            
            this.show();
            console.log('ExperimentSummary initialized successfully');
            
        } catch (error) {
            console.error('ExperimentSummary initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        const templateVar = 'ExperimentSummaryTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            const response = await fetch('/modules/core/experiment-summary/experiment-summary.html');
            if (!response.ok) {
                throw new Error('Failed to load template: ' + response.status);
            }
            this.template = await response.text();
        }
        
        this.render();
    }
    
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            throw new Error('Container element not found: ' + this.containerId);
        }
        
        container.innerHTML = this.template;
        this.bindElements();
    }
    
    bindElements() {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        
        const bindableElements = container.querySelectorAll('[data-bind]');
        bindableElements.forEach(el => {
            const bindName = el.dataset.bind;
            this.elements[bindName] = el;
        });
        
        const requiredElements = [
            'loadingSpinner', 'errorMessage', 'summaryContainer',
            'experimentInfo', 'refreshBtn', 'retryBtn',
            // Notes elements
            'notesTextarea', 'saveNotesBtn', 'clearNotesBtn', 'notesLoading',
            'notesWordCount', 'notesCharCount', 'notesLastSaved', 'notesStatus',
            'notesError', 'notesErrorText', 'retryNotesBtn'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn('Required element not found: ' + elementName);
            }
        }
    }
    
    attachEvents() {
        if (this.elements.refreshBtn) {
            this.elements.refreshBtn.addEventListener('click', this.handleRefresh.bind(this));
        }
        
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', this.handleRetry.bind(this));
        }
        
        // NEW: Notes event handlers
        if (this.elements.notesTextarea) {
            this.elements.notesTextarea.addEventListener('input', this.handleNotesInput.bind(this));
            this.elements.notesTextarea.addEventListener('blur', this.handleNotesBlur.bind(this));
        }
        
        if (this.elements.saveNotesBtn) {
            this.elements.saveNotesBtn.addEventListener('click', this.handleSaveNotes.bind(this));
        }
        
        if (this.elements.clearNotesBtn) {
            this.elements.clearNotesBtn.addEventListener('click', this.handleClearNotes.bind(this));
        }
        
        if (this.elements.retryNotesBtn) {
            this.elements.retryNotesBtn.addEventListener('click', this.handleRetryNotes.bind(this));
        }
    }
    
    async loadExperiment(experimentId) {
        try {
            console.log('Loading summary for experiment: ' + experimentId);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = 'Experiment: ' + experimentId + ' - Computing comprehensive summary';
            }
            
            // Load summary data and notes in parallel
            await Promise.all([
                this.loadSummaryData(),
                this.loadExperimentNotes()
            ]);
            
            this.populateSummaryDisplay();
            
            this.state.isLoaded = true;
            this.state.lastUpdated = new Date();
            this.hideLoading();
            
            console.log('Summary loaded successfully for ' + experimentId);
            
        } catch (error) {
            console.error('Failed to load summary for ' + experimentId + ':', error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    async loadSummaryData() {
        try {
            const response = await fetch(
                this.config.apiBaseUrl + '/experiments/' + this.state.experimentId + '/summary',
                {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                }
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Summary data not available for this experiment');
                }
                throw new Error('Failed to load summary: ' + response.status + ' ' + response.statusText);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load summary data');
            }
            
            this.state.summaryData = result.data;
            
            console.log('Summary data loaded:', {
                experimentId: this.state.experimentId,
                computationStatus: result.data.computationStatus,
                dataSourcesUsed: result.data.dataSourcesUsed,
                hasErrors: result.data.hasErrors
            });
            
        } catch (error) {
            throw new Error('Summary data loading failed: ' + error.message);
        }
    }
    
    // === NEW NOTES FUNCTIONALITY ===
    
    /**
     * Load experiment notes
     */
    async loadExperimentNotes() {
        try {
            if (this.elements.notesLoading) {
                this.elements.notesLoading.classList.remove('hidden');
            }
            
            const response = await fetch(
                this.config.apiBaseUrl + '/experiments/' + this.state.experimentId + '/notes',
                {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                }
            );
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    const notes = result.data.notes || '';
                    
                    if (this.elements.notesTextarea) {
                        this.elements.notesTextarea.value = notes;
                    }
                    
                    this.lastSavedNotesText = notes;
                    this.updateNotesMetadata(result.data);
                    this.updateNotesCharCount();
                    this.updateSaveButtonState();
                    
                    console.log('Notes loaded successfully');
                }
            } else if (response.status === 404) {
                // No notes exist yet - that's OK
                console.log('No notes found for experiment - starting with empty notes');
                this.lastSavedNotesText = '';
                this.updateNotesCharCount();
                this.updateSaveButtonState();
            } else {
                throw new Error('Failed to load notes: ' + response.status);
            }
            
        } catch (error) {
            console.error('Notes loading failed:', error);
            this.showNotesError('Failed to load notes: ' + error.message);
        } finally {
            if (this.elements.notesLoading) {
                this.elements.notesLoading.classList.add('hidden');
            }
        }
    }
    
    /**
     * Handle notes input changes
     */
    handleNotesInput() {
        this.updateNotesCharCount();
        this.updateSaveButtonState();
        this.hideNotesError();
        
        // Auto-save after user stops typing (debounced)
        clearTimeout(this.notesAutoSaveTimeout);
        this.notesAutoSaveTimeout = setTimeout(() => {
            this.autoSaveNotes();
        }, 2000); // Save after 2 seconds of no typing
    }
    
    /**
     * Handle notes blur (when user clicks away)
     */
    handleNotesBlur() {
        // Save immediately when user clicks away
        clearTimeout(this.notesAutoSaveTimeout);
        this.autoSaveNotes();
    }
    
    /**
     * Update character and word count
     */
    updateNotesCharCount() {
        if (!this.elements.notesTextarea) return;
        
        const text = this.elements.notesTextarea.value;
        const charCount = text.length;
        const wordCount = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
        
        if (this.elements.notesCharCount) {
            this.elements.notesCharCount.textContent = charCount + ' / 5000 characters';
            
            // Color coding for character limit
            if (charCount > 4500) {
                this.elements.notesCharCount.style.color = 'var(--status-error)';
            } else if (charCount > 4000) {
                this.elements.notesCharCount.style.color = 'var(--status-warning)';
            } else {
                this.elements.notesCharCount.style.color = '';
            }
        }
        
        if (this.elements.notesWordCount) {
            this.elements.notesWordCount.textContent = wordCount + ' words';
        }
    }
    
    /**
     * Update save button state based on text changes
     */
    updateSaveButtonState() {
        if (!this.elements.saveNotesBtn || !this.elements.notesTextarea) return;
        
        const hasChanges = this.elements.notesTextarea.value !== this.lastSavedNotesText;
        
        if (hasChanges) {
            this.elements.saveNotesBtn.disabled = false;
            this.elements.saveNotesBtn.classList.add('btn-primary');
            this.elements.saveNotesBtn.classList.remove('btn-secondary');
            
            if (this.elements.notesStatus) {
                this.elements.notesStatus.textContent = 'Unsaved changes';
                this.elements.notesStatus.style.color = 'var(--status-warning)';
            }
        } else {
            this.elements.saveNotesBtn.disabled = true;
            this.elements.saveNotesBtn.classList.remove('btn-primary');
            this.elements.saveNotesBtn.classList.add('btn-secondary');
            
            if (this.elements.notesStatus) {
                this.elements.notesStatus.textContent = 'Saved';
                this.elements.notesStatus.style.color = 'var(--status-success)';
            }
        }
    }
    
    /**
     * Auto-save notes (background save)
     */
    async autoSaveNotes() {
        if (!this.elements.notesTextarea) return;
        
        const text = this.elements.notesTextarea.value;
        
        // Don't save if no changes
        if (text === this.lastSavedNotesText) {
            return;
        }
        
        try {
            if (this.elements.notesStatus) {
                this.elements.notesStatus.textContent = 'Saving...';
                this.elements.notesStatus.style.color = '';
            }
            
            await this.saveNotesToServer(text);
            
        } catch (error) {
            console.warn('Auto-save failed:', error);
            // Don't show error for auto-save failures, just update status
            if (this.elements.notesStatus) {
                this.elements.notesStatus.textContent = 'Auto-save failed';
                this.elements.notesStatus.style.color = 'var(--status-error)';
            }
        }
    }
    
    /**
     * Handle manual save button click
     */
    async handleSaveNotes() {
        if (!this.elements.notesTextarea) return;
        
        const text = this.elements.notesTextarea.value;
        
        try {
            if (this.elements.saveNotesBtn) {
                this.elements.saveNotesBtn.disabled = true;
                this.elements.saveNotesBtn.innerHTML = '<span>💾</span> Saving...';
            }
            
            await this.saveNotesToServer(text);
            
            if (this.elements.saveNotesBtn) {
                this.elements.saveNotesBtn.innerHTML = '<span>💾</span> Saved!';
                setTimeout(() => {
                    if (this.elements.saveNotesBtn) {
                        this.elements.saveNotesBtn.innerHTML = '<span>💾</span> Save';
                    }
                }, 1500);
            }
            
        } catch (error) {
            console.error('Manual save failed:', error);
            this.showNotesError('Failed to save notes: ' + error.message);
            
            if (this.elements.saveNotesBtn) {
                this.elements.saveNotesBtn.disabled = false;
                this.elements.saveNotesBtn.innerHTML = '<span>💾</span> Save';
            }
        }
    }
    
    /**
     * Save notes to server
     */
    async saveNotesToServer(text) {
        const response = await fetch(
            this.config.apiBaseUrl + '/experiments/' + this.state.experimentId + '/notes',
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ notes: text })
            }
        );
        
        if (!response.ok) {
            throw new Error('Server returned status ' + response.status);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to save notes');
        }
        
        // Update internal state
        this.lastSavedNotesText = text;
        this.updateNotesMetadata(result.data.notes);
        this.updateSaveButtonState();
        this.hideNotesError();
        
        console.log('Notes saved successfully');
    }
    
    /**
     * Handle clear notes button
     */
    async handleClearNotes() {
        if (!confirm('Are you sure you want to clear all notes for this experiment?')) {
            return;
        }
        
        try {
            if (this.elements.notesTextarea) {
                this.elements.notesTextarea.value = '';
            }
            
            await this.saveNotesToServer('');
            this.updateNotesCharCount();
            
        } catch (error) {
            console.error('Clear notes failed:', error);
            this.showNotesError('Failed to clear notes: ' + error.message);
        }
    }
    
    /**
     * Handle retry notes action
     */
    async handleRetryNotes() {
        this.hideNotesError();
        await this.loadExperimentNotes();
    }
    
    /**
     * Update notes metadata display
     */
    updateNotesMetadata(notesData) {
        if (this.elements.notesLastSaved && notesData && notesData.updatedAt) {
            const date = new Date(notesData.updatedAt);
            this.elements.notesLastSaved.textContent = 'Last saved: ' + date.toLocaleString();
        }
    }
    
    /**
     * Show notes error
     */
    showNotesError(message) {
        if (this.elements.notesError) {
            this.elements.notesError.classList.remove('hidden');
        }
        if (this.elements.notesErrorText) {
            this.elements.notesErrorText.textContent = message;
        }
    }
    
    /**
     * Hide notes error
     */
    hideNotesError() {
        if (this.elements.notesError) {
            this.elements.notesError.classList.add('hidden');
        }
    }
    
    // === END NOTES FUNCTIONALITY ===
    
    populateSummaryDisplay() {
        if (!this.state.summaryData) {
            throw new Error('No summary data available');
        }
        
        const summary = this.state.summaryData;
        
        try {
            this.populateExperimentInfo(summary);
            
            this.populateWeldingSection(summary);
            this.populateBreakTestSection(summary);
            this.populateTemperatureSection(summary);
            this.populateCrownSection(summary);
            this.populatePositionSection(summary);
            this.populateVibrationSection(summary);
            
            this.populateFileAvailability(summary);
            
            this.showSummary();
            
            console.log('Summary display populated successfully');
            
        } catch (error) {
            throw new Error('Summary display population failed: ' + error.message);
        }
    }
    
    populateExperimentInfo(summary) {
        const welding = summary.weldingPerformance;
        
        this.updateElement('programInfo', welding.program || 'Unknown Program');
        this.updateElement('materialInfo', welding.material || 'Unknown Material');
        this.updateElement('operatorInfo', welding.operator || 'Unknown Operator');
        this.updateElement('oilTempInfo', welding.oilTemperature ? welding.oilTemperature.formatted : '--');
        
        const dateMatch = this.state.experimentId.match(/(\d{2})-(\d{2})-(\d{2})/);
        let dateStr = 'Unknown Date';
        if (dateMatch) {
            dateStr = '20' + dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3];
        }
        this.updateElement('dateInfo', dateStr);
        
        const geometry = summary.geometryAndPosition;
        if (geometry.railInfo) {
            this.updateElement('inletRailInfo', this.parseRailInfo(geometry.railInfo.einlaufseite));
            this.updateElement('outletRailInfo', this.parseRailInfo(geometry.railInfo.auslaufseite));
        }
    }
    
    populateWeldingSection(summary) {
        const welding = summary.weldingPerformance;
        
        this.updateElement('peakCurrentGR1', welding.peakCurrentGR1 ? welding.peakCurrentGR1.formatted : '-- A');
        this.updateElement('peakCurrentGR2', welding.peakCurrentGR2 ? welding.peakCurrentGR2.formatted : '-- A');
        this.updateElement('maxVoltage', welding.maxVoltage ? welding.maxVoltage.formatted : '-- V');
        this.updateElement('maxPressure', welding.maxPressure ? welding.maxPressure.formatted : '-- Bar');
        
        const hasBinaryData = summary.dataSourcesUsed.includes('binary');
        this.updateElement('weldingDataSource', hasBinaryData ? 'Binary Data' : 'Journal Data');
    }
    
    populateBreakTestSection(summary) {
        const tensile = summary.tensileResults;
        
        this.updateElement('tensileValue', tensile.peakForce ? tensile.peakForce.formatted : '--');
        this.updateElement('targetForceValue', tensile.targetForce ? tensile.targetForce.formatted : '--');
        this.updateElement('maxDisplacementValue', tensile.maxDisplacement ? tensile.maxDisplacement.formatted : '--');
        
        const targetDisplacement = tensile.targetDisplacement || tensile.deformationDistance || 20;
        this.updateElement('targetDisplacementValue', targetDisplacement + ' mm');
        
        const hasTensileData = summary.dataSourcesUsed.includes('tensile');
        this.updateElement('breakTestDataSource', hasTensileData ? 'Tensile CSV' : 'No Data');
    }
    
    populateTemperatureSection(summary) {
        const temperature = summary.temperatureMonitoring;
        
        if (temperature.weldingTempRange) {
            const min = temperature.weldingTempRange.min ? temperature.weldingTempRange.min.display : '--';
            const max = temperature.weldingTempRange.max ? temperature.weldingTempRange.max.display : '--';
            this.updateElement('weldingTempRange', min + ' - ' + max + ' °C');
        }
        
        if (temperature.ambientTempRange) {
            const min = temperature.ambientTempRange.min ? temperature.ambientTempRange.min.display : '--';
            const max = temperature.ambientTempRange.max ? temperature.ambientTempRange.max.display : '--';
            this.updateElement('ambientTempRange', min + ' - ' + max + ' °C');
        }
        
        const hasTempData = summary.dataSourcesUsed.includes('temperature');
        this.updateElement('tempDataSource', hasTempData ? 'Temperature CSV' : 'No Data');
    }
    
    populateCrownSection(summary) {
        const geometry = summary.geometryAndPosition;
        
        if (geometry.crownMeasurements) {
            const crown = geometry.crownMeasurements;
            
            this.updateElement('crownInletWarm', crown.warm && crown.warm.inlet ? crown.warm.inlet.display : '--');
            this.updateElement('crownInletCold', crown.cold && crown.cold.inlet ? crown.cold.inlet.display : '--');
            this.updateElement('crownOutletWarm', crown.warm && crown.warm.outlet ? crown.warm.outlet.display : '--');
            this.updateElement('crownOutletCold', crown.cold && crown.cold.outlet ? crown.cold.outlet.display : '--');
        }
        
        const hasCrownData = summary.dataSourcesUsed.includes('geometry') || summary.dataSourcesUsed.includes('crown');
        this.updateElement('crownDataSource', hasCrownData ? 'Journal + Excel' : 'No Data');
    }
    
    populatePositionSection(summary) {
        const geometry = summary.geometryAndPosition;
        
        if (geometry.railMovement) {
            this.updateElement('totalDisplacement', 
                geometry.railMovement.totalDisplacement ? geometry.railMovement.totalDisplacement.formatted : '--');
            
            if (geometry.railMovement.positionRange) {
                const range = geometry.railMovement.positionRange;
                const min = range.min ? range.min.display : '--';
                const max = range.max ? range.max.display : '--';
                this.updateElement('positionRange', min + ' - ' + max + ' mm');
            }
        }
        
        const hasPositionData = summary.dataSourcesUsed.includes('position');
        this.updateElement('positionDataSource', hasPositionData ? 'Position CSV' : 'No Data');
    }
    
    populateVibrationSection(summary) {
        const vibration = summary.vibrationAnalysis;
        
        this.updateElement('peakAcceleration', 
            vibration.peakAcceleration ? (vibration.peakAcceleration.display + ' m/s²') : '-- m/s²');
        this.updateElement('rmsMagnitude', 
            vibration.rmsValues && vibration.rmsValues.magnitude ? (vibration.rmsValues.magnitude.display + ' m/s²') : '-- m/s²');
        
        const axisValues = [
            vibration.axisBreakdown && vibration.axisBreakdown.x ? vibration.axisBreakdown.x.display : '--',
            vibration.axisBreakdown && vibration.axisBreakdown.y ? vibration.axisBreakdown.y.display : '--',
            vibration.axisBreakdown && vibration.axisBreakdown.z ? vibration.axisBreakdown.z.display : '--'
        ];
        this.updateElement('maxAxisValues', axisValues.join(' / ') + ' m/s²');
        
        this.updateElement('samplingRate', 
            vibration.samplingRate ? (vibration.samplingRate.display + ' Hz') : '-- Hz');
        
        const hasVibrationData = summary.dataSourcesUsed.includes('acceleration');
        this.updateElement('vibrationDataSource', hasVibrationData ? 'Acceleration CSV' : 'No Data');
    }
    
    populateFileAvailability(summary) {
        const files = summary.fileAvailability;
        
        this.updateElement('fileCompleteness', files.completeness + '%');
        
        if (this.elements.fileIndicators) {
            this.elements.fileIndicators.innerHTML = this.createFileIndicatorsHTML(files);
        }
    }
    
    createFileIndicatorsHTML(files) {
        const fileTypeMap = {
            'Binary Data': { type: 'bin', available: files.available.includes('Binary Data') },
            'Acceleration': { type: 'csv', available: files.available.includes('Acceleration') },
            'Position': { type: 'csv', available: files.available.includes('Position') },
            'Tensile Test': { type: 'csv', available: files.available.includes('Tensile Test') },
            'Photos': { type: 'image', available: files.available.includes('Photos') },
            'Thermal IR': { type: 'video', available: files.available.includes('Thermal IR') },
            'TCP5 Data': { type: 'data', available: files.available.includes('TCP5 Data') },
            'Weld Journal': { type: 'data', available: files.available.includes('Weld Journal') },
            'Crown Measurements': { type: 'data', available: files.available.includes('Crown Measurements') },
            'Temperature': { type: 'csv', available: files.available.includes('Temperature') }
        };
        
        return Object.entries(fileTypeMap).map(function(entry) {
            const fileName = entry[0];
            const info = entry[1];
            const statusClass = info.available ? 'available' : 'missing';
            const indicatorClass = info.available ? info.type : 'missing';
            
            return '<div class="file-indicator-item ' + statusClass + '">' +
                   '<span class="file-indicator ' + indicatorClass + '"></span>' +
                   '<span class="file-label">' + fileName + '</span>' +
                   '</div>';
        }).join('');
    }
    
    updateElement(elementName, value) {
        const element = this.elements[elementName];
        if (element) {
            element.textContent = value || '--';
            
            if (!value || value === '--' || value === 'Unknown') {
                element.classList.add('missing-value');
            } else {
                element.classList.remove('missing-value');
            }
        }
    }
    
    parseRailInfo(railString) {
        if (!railString) return '--';
        
        const parts = railString.split(' Bereits ');
        if (parts.length === 2) {
            const railId = parts[0].trim();
            const weldInfo = parts[1].trim();
            
            const weldMatch = weldInfo.match(/(\d+)x/);
            if (weldMatch) {
                return railId + ' (' + weldMatch[1] + 'x welded)';
            }
        }
        
        return railString;
    }
    
    async handleRefresh() {
        console.log('Refreshing summary data...');
        try {
            const response = await fetch(
                this.config.apiBaseUrl + '/experiments/' + this.state.experimentId + '/summary/refresh',
                { method: 'GET' }
            );
            
            if (response.ok) {
                await this.loadExperiment(this.state.experimentId);
            } else {
                throw new Error('Refresh failed: ' + response.status);
            }
        } catch (error) {
            console.error('Summary refresh failed:', error);
            this.onError(error);
        }
    }
    
    async handleRetry() {
        console.log('Retrying summary load...');
        if (this.state.experimentId) {
            await this.loadExperiment(this.state.experimentId);
        }
    }
    
    showLoading() {
        this.hideError();
        this.hideSummary();
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.remove('hidden');
        }
    }
    
    hideLoading() {
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.add('hidden');
        }
    }
    
    showError(message) {
        this.hideLoading();
        this.hideSummary();
        
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.remove('hidden');
        }
        if (this.elements.errorText) {
            this.elements.errorText.textContent = message;
        }
    }
    
    hideError() {
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.add('hidden');
        }
    }
    
    showSummary() {
        this.hideLoading();
        this.hideError();
        
        if (this.elements.summaryContainer) {
            this.elements.summaryContainer.classList.remove('hidden');
        }
    }
    
    hideSummary() {
        if (this.elements.summaryContainer) {
            this.elements.summaryContainer.classList.add('hidden');
        }
    }
    
    onError(error) {
        const message = error.message || 'Failed to load experiment summary';
        this.showError(message);
        
        this.emit('error', {
            moduleName: 'experiment-summary',
            message: message,
            recoverable: true
        });
    }
    
    emit(eventName, data) {
        const fullEventName = 'module:experiment-summary:' + eventName;
        const event = new CustomEvent(fullEventName, {
            detail: data,
            bubbles: true
        });
        document.dispatchEvent(event);
    }
    
    show() {
        this.state.isVisible = true;
        const container = document.getElementById(this.containerId);
        if (container) {
            container.style.display = 'block';
        }
    }
    
    hide() {
        this.state.isVisible = false;
        const container = document.getElementById(this.containerId);
        if (container) {
            container.style.display = 'none';
        }
    }
    
    destroy() {
        if (this.config.refreshInterval) {
            clearInterval(this.config.refreshInterval);
        }
        
        // Clean up notes auto-save timeout
        if (this.notesAutoSaveTimeout) {
            clearTimeout(this.notesAutoSaveTimeout);
        }
        
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        this.state = {};
        this.elements = {};
        
        console.log('ExperimentSummary destroyed');
    }
    
    getState() {
        return {
            isLoaded: this.state.isLoaded,
            isVisible: this.state.isVisible,
            experimentId: this.state.experimentId,
            lastUpdated: this.state.lastUpdated,
            config: this.config
        };
    }
    
    getSummaryData() {
        return this.state.summaryData;
    }
    
    getKeyMetrics() {
        if (!this.state.summaryData) return null;
        
        const summary = this.state.summaryData;
        return {
            experimentId: this.state.experimentId,
            peakForce: summary.weldingPerformance.peakForce,
            tensileResult: summary.tensileResults.result,
            tensileForce: summary.tensileResults.peakForce,
            fileCompleteness: summary.fileAvailability.completeness,
            criticalFilesComplete: summary.fileAvailability.criticalFilesComplete,
            computationStatus: summary.computationStatus,
            dataSourcesUsed: summary.dataSourcesUsed,
            lastUpdated: this.state.lastUpdated
        };
    }
    
    isSummaryReady() {
        return this.state.isLoaded && 
               this.state.summaryData && 
               this.state.summaryData.computationStatus === 'complete';
    }
}

window.ExperimentSummary = ExperimentSummary;