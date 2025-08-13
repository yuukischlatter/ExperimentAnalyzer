/**
 * Experiment Browser Module
 * Displays, filters, and manages experiment selection
 * UPDATED: Added cleanup and abort functionality
 */

class ExperimentBrowser {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        this.state = {
            isLoaded: false,
            isVisible: false,
            experiments: [],
            filteredExperiments: [],
            selectedExperiment: null,
            currentSort: 'date-desc',
            currentFilter: { by: '', value: '' },
            searchTerm: '',
            error: null
        };
        this.elements = {};
        
        // NEW: Request management
        this.abortController = null;
        this.isLoading = false;
        
        console.log('ExperimentBrowser initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            refreshInterval: null,
            enableKeyboardNavigation: true,
            maxResults: 1000
        };
    }
    
    async init() {
        try {
            await this.loadTemplate();
            this.bindElements();
            this.attachEvents();
            
            if (this.config.autoLoad) {
                await this.loadData();
            }
            
            this.show();
            console.log('ExperimentBrowser initialized successfully');
            
        } catch (error) {
            console.error('ExperimentBrowser initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'ExperimentBrowserTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/core/experiment-browser/experiment-browser.html');
            if (!response.ok) {
                throw new Error(`Failed to load template: ${response.status}`);
            }
            this.template = await response.text();
        }
        
        this.render();
    }
    
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            throw new Error(`Container element not found: ${this.containerId}`);
        }
        
        container.innerHTML = this.template;
        this.bindElements();
    }
    
    bindElements() {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        
        // Find all elements with data-bind attributes
        const bindableElements = container.querySelectorAll('[data-bind]');
        bindableElements.forEach(el => {
            const bindName = el.dataset.bind;
            this.elements[bindName] = el;
        });
        
        // Verify critical elements exist
        const requiredElements = [
            'experimentsTable', 'experimentsTableBody', 'loadingSpinner',
            'errorMessage', 'searchInput', 'sortSelect', 'filterSelect'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Search input
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', 
                this.debounce(this.handleSearch.bind(this), 300));
        }
        
        // Sort select
        if (this.elements.sortSelect) {
            this.elements.sortSelect.addEventListener('change', this.handleSortChange.bind(this));
        }
        
        // Filter select
        if (this.elements.filterSelect) {
            this.elements.filterSelect.addEventListener('change', this.handleFilterTypeChange.bind(this));
        }
        
        // Filter value input
        if (this.elements.filterValueInput) {
            this.elements.filterValueInput.addEventListener('input', 
                this.debounce(this.handleFilterValueChange.bind(this), 300));
        }
        
        // Refresh button
        if (this.elements.refreshBtn) {
            this.elements.refreshBtn.addEventListener('click', this.handleRefresh.bind(this));
        }
        
        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', this.handleRetry.bind(this));
        }
        
        // Clear filters button
        if (this.elements.clearFiltersBtn) {
            this.elements.clearFiltersBtn.addEventListener('click', this.handleClearFilters.bind(this));
        }
        
        // Keyboard navigation
        if (this.config.enableKeyboardNavigation) {
            document.addEventListener('keydown', this.handleKeydown.bind(this));
        }
    }
    
    /**
     * NEW: Abort ongoing requests
     */
    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.isLoading = false;
        console.log('ExperimentBrowser: Ongoing requests aborted');
    }
    
    /**
     * NEW: Cleanup state without destroying DOM
     */
    cleanup() {
        // Abort any ongoing requests
        this.abort();
        
        // Reset state
        this.state.experiments = [];
        this.state.filteredExperiments = [];
        this.state.selectedExperiment = null;
        this.state.isLoaded = false;
        this.state.error = null;
        
        // Clear UI
        if (this.elements.experimentsTableBody) {
            this.elements.experimentsTableBody.innerHTML = '';
        }
        
        this.hideTable();
        this.hideError();
        this.hideLoading();
        
        console.log('ExperimentBrowser: Cleanup completed');
    }
    
    /**
     * Load experiment data - MODIFIED: Added abort controller support
     */
    async loadData() {
        try {
            // Prevent overlapping loads
            if (this.isLoading) {
                console.log('Already loading experiments, aborting previous request...');
                this.abort();
            }
            
            // Create new abort controller
            this.abortController = new AbortController();
            this.isLoading = true;
            
            this.showLoading();
            
            const url = `${this.config.apiBaseUrl}/experiments`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                signal: this.abortController.signal
            });
            
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'API returned unsuccessful response');
            }
            
            // Check if request was aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            this.state.experiments = data.data || [];
            this.state.isLoaded = true;
            this.state.error = null;
            this.isLoading = false;
            
            this.applyFiltersAndSort();
            this.hideLoading();
            this.onDataLoaded();
            
            console.log(`Loaded ${this.state.experiments.length} experiments`);
            
        } catch (error) {
            this.isLoading = false;
            
            // Don't show errors for aborted requests
            if (error.name === 'AbortError') {
                console.log('Experiment loading was aborted');
                return;
            }
            
            console.error('Failed to load experiments:', error);
            this.state.error = error;
            this.hideLoading();
            this.onError(error);
        }
    }
    
    applyFiltersAndSort() {
        let filtered = [...this.state.experiments];
        
        // Apply search filter
        if (this.state.searchTerm) {
            const searchLower = this.state.searchTerm.toLowerCase();
            filtered = filtered.filter(item => {
                const exp = item.experiment || item.Experiment;
                const meta = item.metadata || item.Metadata;
                
                return (
                    exp.id?.toLowerCase().includes(searchLower) ||
                    exp.Id?.toLowerCase().includes(searchLower) ||
                    meta?.operator?.toLowerCase().includes(searchLower) ||
                    meta?.Operator?.toLowerCase().includes(searchLower) ||
                    meta?.programNumber?.toLowerCase().includes(searchLower) ||
                    meta?.ProgramNumber?.toLowerCase().includes(searchLower) ||
                    meta?.programName?.toLowerCase().includes(searchLower) ||
                    meta?.ProgramName?.toLowerCase().includes(searchLower) ||
                    meta?.material?.toLowerCase().includes(searchLower) ||
                    meta?.Material?.toLowerCase().includes(searchLower) ||
                    meta?.shape?.toLowerCase().includes(searchLower) ||
                    meta?.Shape?.toLowerCase().includes(searchLower)
                );
            });
        }
        
        // Apply field filter
        if (this.state.currentFilter.by && this.state.currentFilter.value) {
            const filterBy = this.state.currentFilter.by;
            const filterValue = this.state.currentFilter.value.toLowerCase();
            
            filtered = filtered.filter(item => {
                const meta = item.metadata || item.Metadata;
                if (!meta) return false;
                
                switch (filterBy) {
                    case 'operator':
                        return meta.operator?.toLowerCase().includes(filterValue) ||
                               meta.Operator?.toLowerCase().includes(filterValue);
                    case 'program':
                        return meta.programNumber?.toLowerCase().includes(filterValue) ||
                               meta.programName?.toLowerCase().includes(filterValue) ||
                               meta.ProgramNumber?.toLowerCase().includes(filterValue) ||
                               meta.ProgramName?.toLowerCase().includes(filterValue);
                    case 'material':
                        return meta.material?.toLowerCase().includes(filterValue) ||
                               meta.Material?.toLowerCase().includes(filterValue);
                    case 'shape':
                        return meta.shape?.toLowerCase().includes(filterValue) ||
                               meta.Shape?.toLowerCase().includes(filterValue);
                    default:
                        return true;
                }
            });
        }
        
        // Apply sorting
        filtered.sort((a, b) => {
            const expA = a.experiment || a.Experiment;
            const expB = b.experiment || b.Experiment;
            const metaA = a.metadata || a.Metadata;
            const metaB = b.metadata || b.Metadata;
            
            let comparison = 0;
            
            switch (this.state.currentSort) {
                case 'date-desc':
                    comparison = new Date(expB.experimentDate || expB.ExperimentDate || '1900-01-01') - 
                                new Date(expA.experimentDate || expA.ExperimentDate || '1900-01-01');
                    break;
                case 'date-asc':
                    comparison = new Date(expA.experimentDate || expA.ExperimentDate || '1900-01-01') - 
                                new Date(expB.experimentDate || expB.ExperimentDate || '1900-01-01');
                    break;
                case 'id-asc':
                    comparison = (expA.id || expA.Id || '').localeCompare(expB.id || expB.Id || '');
                    break;
                case 'id-desc':
                    comparison = (expB.id || expB.Id || '').localeCompare(expA.id || expA.Id || '');
                    break;
                case 'operator-asc':
                    comparison = (metaA?.operator || metaA?.Operator || '').localeCompare(metaB?.operator || metaB?.Operator || '');
                    break;
                case 'program-asc':
                    comparison = (metaA?.programNumber || metaA?.ProgramNumber || '').localeCompare(metaB?.programNumber || metaB?.ProgramNumber || '');
                    break;
                case 'material-asc':
                    comparison = (metaA?.material || metaA?.Material || '').localeCompare(metaB?.material || metaB?.Material || '');
                    break;
                case 'shape-asc':
                    comparison = (metaA?.shape || metaA?.Shape || '').localeCompare(metaB?.shape || metaB?.Shape || '');
                    break;
                default:
                    comparison = 0;
            }
            
            return comparison;
        });
        
        this.state.filteredExperiments = filtered;
        this.renderTable();
        this.updateResultsCount();
    }
    
    renderTable() {
        const tbody = this.elements.experimentsTableBody;
        if (!tbody) return;
        
        if (this.state.filteredExperiments.length === 0) {
            this.showEmptyState();
            return;
        }
        
        this.hideEmptyState();
        this.showTable();
        
        tbody.innerHTML = '';
        
        this.state.filteredExperiments.forEach((item, index) => {
            const exp = item.experiment || item.Experiment;
            const meta = item.metadata || item.Metadata;
            
            const row = this.createTableRow(exp, meta, index);
            tbody.appendChild(row);
        });
    }
    
    createTableRow(experiment, metadata, index) {
        const row = document.createElement('tr');
        row.className = 'experiment-row';
        row.dataset.experimentId = experiment.id || experiment.Id;
        row.dataset.index = index;
        
        // Format date
        const dateStr = experiment.experimentDate || experiment.ExperimentDate;
        const formattedDate = dateStr ? new Date(dateStr).toLocaleDateString('de-DE') : '-';
        
        // Create file indicators
        const fileIndicators = this.createFileIndicators(experiment);
        
        row.innerHTML = `
            <td class="col-id">
                <span class="font-medium">${experiment.id || experiment.Id}</span>
            </td>
            <td class="col-date">
                <span class="text-sm">${formattedDate}</span>
            </td>
            <td class="col-program">
                <div class="program-info">
                    <span class="font-medium text-sm">${metadata?.programNumber || metadata?.ProgramNumber || '-'}</span>
                    <br>
                    <span class="text-xs text-secondary">${this.truncateText(metadata?.programName || metadata?.ProgramName || '', 20)}</span>
                </div>
            </td>
            <td class="col-material">
                <span class="text-sm font-medium">${metadata?.material || metadata?.Material || '-'}</span>
            </td>
            <td class="col-shape">
                <span class="text-sm font-medium">${metadata?.shape || metadata?.Shape || '-'}</span>
            </td>
            <td class="col-operator">
                <span class="text-sm font-medium">${metadata?.operator || metadata?.Operator || '-'}</span>
            </td>
            <td class="col-files">
                <div class="file-indicators">
                    ${fileIndicators}
                </div>
            </td>
        `;
        
        // Add click handler
        row.addEventListener('click', () => this.selectExperiment(index));
        
        return row;
    }
    
    createFileIndicators(experiment) {
        const fileTypes = [
            { key: 'hasBinFile', label: 'BIN', className: 'bin' },
            { key: 'hasAccelerationCsv', label: 'ACC', className: 'csv' },
            { key: 'hasPositionCsv', label: 'POS', className: 'csv' },
            { key: 'hasTensileCsv', label: 'TEN', className: 'csv' },
            { key: 'hasPhotos', label: 'IMG', className: 'image' },
            { key: 'hasThermalRavi', label: 'IR', className: 'video' },
            { key: 'hasTcp5File', label: 'TCP5', className: 'data' },
            { key: 'hasWeldJournal', label: 'LOG', className: 'data' },
            { key: 'hasCrownMeasurements', label: 'CROWN', className: 'data' },
            { key: 'hasAmbientTemperature', label: 'TEMP', className: 'csv' }
        ];
        
        // Handle both C# PascalCase and JavaScript camelCase
        const normalizeKey = (key) => {
            const pascalCase = key.charAt(0).toUpperCase() + key.slice(1);
            return experiment[key] || experiment[pascalCase];
        };
        
        return fileTypes.map(fileType => {
            const hasFile = normalizeKey(fileType.key);
            const statusClass = hasFile ? 'available' : 'missing';
            const indicatorClass = hasFile ? fileType.className : 'missing';
            
            return `
                <div class="file-indicator-item ${statusClass}">
                    <span class="file-indicator ${indicatorClass}"></span>
                    <span class="file-label">${fileType.label}</span>
                </div>
            `;
        }).join('');
    }
    
    selectExperiment(index) {
        const experiment = this.state.filteredExperiments[index];
        if (!experiment) return;
        
        // Update selection state
        this.state.selectedExperiment = experiment;
        
        // Update UI
        this.updateTableSelection(index);
        
        // Emit selection event
        this.emit('experimentSelected', {
            experimentId: experiment.experiment?.id || experiment.Experiment?.Id,
            experiment: experiment.experiment || experiment.Experiment,
            metadata: experiment.metadata || experiment.Metadata
        });
        
        console.log('Experiment selected:', experiment.experiment?.id || experiment.Experiment?.Id);
    }
    
    updateTableSelection(selectedIndex) {
        const rows = this.elements.experimentsTableBody?.querySelectorAll('tr');
        if (!rows) return;
        
        rows.forEach((row, index) => {
            if (index === selectedIndex) {
                row.classList.add('selected');
            } else {
                row.classList.remove('selected');
            }
        });
    }
    
    // Event Handlers
    handleSearch(event) {
        this.state.searchTerm = event.target.value.trim();
        this.applyFiltersAndSort();
    }
    
    handleSortChange(event) {
        this.state.currentSort = event.target.value;
        this.applyFiltersAndSort();
    }
    
    handleFilterTypeChange(event) {
        const filterBy = event.target.value;
        this.state.currentFilter.by = filterBy;
        
        // Show/hide filter value input
        const filterValueGroup = this.elements.filterValueGroup;
        if (filterValueGroup) {
            if (filterBy) {
                filterValueGroup.style.display = 'block';
                this.elements.filterValueInput?.focus();
            } else {
                filterValueGroup.style.display = 'none';
                this.state.currentFilter.value = '';
                if (this.elements.filterValueInput) {
                    this.elements.filterValueInput.value = '';
                }
            }
        }
        
        this.applyFiltersAndSort();
    }
    
    handleFilterValueChange(event) {
        this.state.currentFilter.value = event.target.value.trim();
        this.applyFiltersAndSort();
    }
    
    /**
     * Handle refresh - MODIFIED: Added abort before new load
     */
    async handleRefresh() {
        console.log('Refreshing experiment data...');
        this.abort(); // Cancel any ongoing request
        await this.loadData();
    }
    
    /**
     * Handle retry - MODIFIED: Added abort before new load
     */
    async handleRetry() {
        console.log('Retrying data load...');
        this.abort(); // Cancel any ongoing request
        await this.loadData();
    }
    
    handleClearFilters() {
        // Reset all filters
        this.state.searchTerm = '';
        this.state.currentFilter = { by: '', value: '' };
        this.state.currentSort = 'date-desc';
        
        // Reset UI
        if (this.elements.searchInput) this.elements.searchInput.value = '';
        if (this.elements.filterSelect) this.elements.filterSelect.value = '';
        if (this.elements.filterValueInput) this.elements.filterValueInput.value = '';
        if (this.elements.sortSelect) this.elements.sortSelect.value = 'date-desc';
        if (this.elements.filterValueGroup) this.elements.filterValueGroup.style.display = 'none';
        
        this.applyFiltersAndSort();
    }
    
    handleKeydown(event) {
        // TODO: Implement keyboard navigation (arrow keys, Enter, etc.)
        if (event.key === 'Escape') {
            this.clearSelection();
        }
    }
    
    // State Management
    showLoading() {
        this.hideTable();
        this.hideError();
        this.hideEmptyState();
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.remove('hidden');
        }
    }
    
    hideLoading() {
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.add('hidden');
        }
    }
    
    showTable() {
        if (this.elements.tableContainer) {
            this.elements.tableContainer.classList.remove('hidden');
        }
    }
    
    hideTable() {
        if (this.elements.tableContainer) {
            this.elements.tableContainer.classList.add('hidden');
        }
    }
    
    showError(message) {
        this.hideTable();
        this.hideLoading();
        this.hideEmptyState();
        
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
    
    showEmptyState() {
        this.hideTable();
        this.hideLoading();
        this.hideError();
        
        if (this.elements.emptyState) {
            this.elements.emptyState.classList.remove('hidden');
        }
    }
    
    hideEmptyState() {
        if (this.elements.emptyState) {
            this.elements.emptyState.classList.add('hidden');
        }
    }
    
    updateResultsCount() {
        if (this.elements.resultsCount) {
            const total = this.state.experiments.length;
            const filtered = this.state.filteredExperiments.length;
            
            let text = `${filtered} experiment${filtered !== 1 ? 's' : ''}`;
            if (filtered !== total) {
                text += ` (${total} total)`;
            }
            
            this.elements.resultsCount.textContent = text;
        }
    }
    
    // Event Emission
    emit(eventName, data) {
        const fullEventName = `module:experiment-browser:${eventName}`;
        const event = new CustomEvent(fullEventName, {
            detail: data,
            bubbles: true
        });
        document.dispatchEvent(event);
        console.log(`Event emitted: ${fullEventName}`, data);
    }
    
    onDataLoaded() {
        this.emit('experimentsLoaded', {
            totalCount: this.state.experiments.length,
            filteredCount: this.state.filteredExperiments.length
        });
    }
    
    onError(error) {
        this.showError(error.message);
        this.emit('error', {
            moduleName: 'experiment-browser',
            message: error.message,
            recoverable: true
        });
    }
    
    // Utility Methods
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }
    
    clearSelection() {
        this.state.selectedExperiment = null;
        const rows = this.elements.experimentsTableBody?.querySelectorAll('tr');
        if (rows) {
            rows.forEach(row => row.classList.remove('selected'));
        }
    }
    
    // Public Interface (Standard Module Methods)
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
    
    /**
     * Destroy module - MODIFIED: Enhanced cleanup
     */
    destroy() {
        // Abort any ongoing requests
        this.abort();
        
        // Remove event listeners
        if (this.config.enableKeyboardNavigation) {
            document.removeEventListener('keydown', this.handleKeydown.bind(this));
        }
        
        // Clear intervals
        if (this.config.refreshInterval) {
            clearInterval(this.config.refreshInterval);
        }
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        // Clear state
        this.state = {};
        this.elements = {};
        
        console.log('ExperimentBrowser destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config,
            isLoading: this.isLoading
        };
    }
    
    // Public data access methods
    getExperiments() {
        return this.state.experiments;
    }
    
    getFilteredExperiments() {
        return this.state.filteredExperiments;
    }
    
    getSelectedExperiment() {
        return this.state.selectedExperiment;
    }
}

// Export for global access
window.ExperimentBrowser = ExperimentBrowser;