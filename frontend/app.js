/**
 * Experiment Analyzer - Main Application Controller
 * Manages module loading, global state, and inter-module communication
 * UPDATED: Added cleanup and abort functionality for experiment switching
 */

class ExperimentAnalyzer {
    constructor() {
        this.modules = new Map();
        this.currentExperiment = null;
        this.apiBaseUrl = window.location.origin + '/api';
        this.isInitialized = false;
        
        // NEW: Request and loading management
        this.activeAbortControllers = new Map();
        this.currentExperimentLoadAbort = null;
        this.isLoadingExperiment = false;
        this.moduleLoadPromises = new Map();
        
        // Application state
        this.state = {
            connectionStatus: 'disconnected',
            loadedModules: [],
            activeModules: [],
            currentExperiment: null
        };
        
        console.log('Experiment Analyzer initialized');
    }
    
    /**
     * Initialize the application
     */
    async init() {
        try {
            console.log('Starting application initialization...');
            
            this.showLoading('Loading Experiment Analyzer...');
            
            // Setup global event listeners
            this.setupEventListeners();
            
            // Check API connection
            await this.checkApiConnection();
            
            // Load the experiment browser module (always loads first)
            await this.loadModule('experiment-browser', 'experiment-browser-container');
            
            // Hide loading overlay
            this.hideLoading();
            
            this.isInitialized = true;
            console.log('Application initialization complete');
            
        } catch (error) {
            console.error('Application initialization failed:', error);
            this.showError('Failed to initialize application', error.message);
        }
    }
    
    /**
     * Setup global event listeners for inter-module communication
     */
    setupEventListeners() {
        // Listen for experiment selection from browser module
        document.addEventListener('module:experiment-browser:experimentSelected', (event) => {
            this.handleExperimentSelected(event);
        });
        
        // Listen for module errors
        document.addEventListener('module:error', (event) => {
            this.handleModuleError(event);
        });
        
        // Listen for window events
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
        window.addEventListener('online', () => this.updateConnectionStatus('online'));
        window.addEventListener('offline', () => this.updateConnectionStatus('offline'));
        
        // Error boundary for unhandled errors
        window.addEventListener('error', (event) => {
            console.error('Unhandled error:', event.error);
            this.handleModuleError({
                detail: {
                    moduleName: 'application',
                    message: event.error.message,
                    recoverable: true
                }
            });
        });
        
        // Retry button in error overlay
        const retryButton = document.getElementById('retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                this.hideError();
                this.init();
            });
        }
    }
    
    /**
     * Check API connection status
     */
    async checkApiConnection() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/experiments/count`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                this.updateConnectionStatus('connected');
                const data = await response.json();
                console.log(`API connected. Total experiments: ${data.data}`);
            } else {
                throw new Error(`API returned status ${response.status}`);
            }
            
        } catch (error) {
            console.error('API connection failed:', error);
            this.updateConnectionStatus('disconnected');
            throw new Error(`Cannot connect to API: ${error.message}`);
        }
    }
    
    /**
     * NEW: Cleanup current experiment and all active operations
     */
    cleanupCurrentExperiment() {
        console.log('Cleaning up current experiment...');
        
        // 1. Abort all ongoing requests
        this.abortAllRequests();
        
        // 2. Destroy all active modules
        this.destroyAllModules();
        
        // 3. Reset module containers
        this.resetModuleContainers();
        
        // 4. Clear current experiment state
        this.currentExperiment = null;
        this.state.currentExperiment = null;
        
        console.log('Current experiment cleanup completed');
    }
    
    /**
     * NEW: Abort all active requests
     */
    abortAllRequests() {
        // Abort current experiment loading if active
        if (this.currentExperimentLoadAbort) {
            this.currentExperimentLoadAbort.abort();
            this.currentExperimentLoadAbort = null;
        }
        
        // Abort all tracked controllers
        for (const [key, controller] of this.activeAbortControllers) {
            try {
                controller.abort();
            } catch (error) {
                console.warn(`Error aborting controller ${key}:`, error);
            }
        }
        
        this.activeAbortControllers.clear();
        console.log('All active requests aborted');
    }
    
    /**
     * NEW: Destroy all loaded modules
     */
    destroyAllModules() {
        for (const [name, module] of this.modules) {
            try {
                if (typeof module.destroy === 'function') {
                    module.destroy();
                }
            } catch (error) {
                console.error(`Error destroying module ${name}:`, error);
            }
        }
        
        this.modules.clear();
        this.state.loadedModules = [];
        this.state.activeModules = [];
        
        console.log('All modules destroyed');
    }
    
    /**
     * NEW: Reset all module containers to hidden state
     */
    resetModuleContainers() {
        // Hide summary container
        const summaryContainer = document.getElementById('experiment-summary-container');
        if (summaryContainer) {
            summaryContainer.classList.add('hidden');
            summaryContainer.innerHTML = '';
        }
        
        // Hide data modules container
        const dataContainer = document.getElementById('data-modules-container');
        if (dataContainer) {
            dataContainer.classList.add('hidden');
        }
        
        // Reset all individual module containers
        const moduleContainers = [
            'bin-oscilloscope-container',
            'ambient-temperature-container', 
            'acceleration-container',
            'distance-sensor-container',
            'tensile-strength-container',
            'photo-gallery-container',
            'thermal-ir-container',
            'tcp5-oscilloscope-container',
            'weld-journal-container',
            'crown-measurements-container'
        ];
        
        moduleContainers.forEach(containerId => {
            const container = document.getElementById(containerId);
            if (container) {
                container.classList.add('hidden');
                container.innerHTML = '';
            }
        });
        
        console.log('Module containers reset');
    }
    
    /**
     * Load a module dynamically - MODIFIED: Added abort signal support
     */
    async loadModule(moduleName, containerId, config = {}, abortSignal = null) {
        try {
            console.log(`Loading module: ${moduleName}`);
            
            // Check if module already loaded
            if (this.modules.has(moduleName)) {
                console.log(`Module ${moduleName} already loaded`);
                return this.modules.get(moduleName);
            }
            
            // Check if loading was aborted
            if (abortSignal && abortSignal.aborted) {
                throw new Error('Module loading aborted');
            }
            
            // Determine module path based on type
            const modulePath = this.getModulePath(moduleName);
            
            // Load module files
            await this.loadModuleFiles(modulePath, moduleName, abortSignal);
            
            // Check abort again after async operation
            if (abortSignal && abortSignal.aborted) {
                throw new Error('Module loading aborted');
            }
            
            // Get module class name (convert kebab-case to PascalCase)
            const className = this.getModuleClassName(moduleName);
            
            // Instantiate module
            if (window[className]) {
                const moduleInstance = new window[className](containerId, {
                    apiBaseUrl: this.apiBaseUrl,
                    ...config
                });
                
                this.modules.set(moduleName, moduleInstance);
                this.state.loadedModules.push(moduleName);
                
                console.log(`Module ${moduleName} loaded successfully`);
                
                // EMIT FOLDING EVENT: Module is ready for folding
                this.emitModuleReadyForFolding(moduleName, containerId);
                
                return moduleInstance;
                
            } else {
                throw new Error(`Module class ${className} not found`);
            }
            
        } catch (error) {
            // Don't log abort errors as real errors
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                console.log(`Module loading aborted: ${moduleName}`);
                return null;
            }
            
            console.error(`Failed to load module ${moduleName}:`, error);
            throw error;
        }
    }
    
    /**
     * Emit event when module is ready for folding initialization
     */
    emitModuleReadyForFolding(moduleName, containerId) {
        // Small delay to ensure DOM is fully updated
        setTimeout(() => {
            const event = new CustomEvent('module:ready-for-folding', {
                detail: {
                    moduleName: moduleName,
                    containerId: containerId,
                    timestamp: Date.now()
                },
                bubbles: true
            });
            
            document.dispatchEvent(event);
            console.log(`Folding event emitted for module: ${moduleName}`);
        }, 50); // Small delay to ensure DOM is ready
    }
    
    /**
     * Get module file path based on module name
     */
    getModulePath(moduleName) {
        // Core modules (experiment browser, summary, etc.)
        if (['experiment-browser', 'experiment-summary'].includes(moduleName)) {
            return `/modules/core/${moduleName}`;
        }
        
        // Data visualization modules - UPDATED: Added thermal-ir
        if (['bin-oscilloscope', 'acceleration', 'distance-sensor', 'tensile-strength', 
             'photo-gallery', 'thermal-ir', 'tcp5-oscilloscope', 'weld-journal',
             'crown-measurements', 'ambient-temperature'].includes(moduleName)) {
            return `/modules/data/${moduleName}`;
        }
        
        // Analysis modules
        if (['multi-axis-plotter', 'fft-analyzer', 'comparison-viewer'].includes(moduleName)) {
            return `/modules/analysis/${moduleName}`;
        }
        
        throw new Error(`Unknown module type for: ${moduleName}`);
    }
    
    /**
     * Convert kebab-case module name to PascalCase class name
     */
    getModuleClassName(moduleName) {
        return moduleName
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
    }
    
    /**
     * Load module files (HTML, CSS, JS) - MODIFIED: Added abort signal support
     */
    async loadModuleFiles(modulePath, moduleName, abortSignal = null) {
        const promises = [];
        
        // Load CSS first
        promises.push(this.loadCSS(`${modulePath}/${moduleName}.css`, abortSignal));
        
        // Load HTML template
        promises.push(this.loadHTML(`${modulePath}/${moduleName}.html`, abortSignal));
        
        // Load JavaScript last
        promises.push(this.loadScript(`${modulePath}/${moduleName}.js`, abortSignal));
        
        await Promise.all(promises);
    }
    
    /**
     * Load CSS file - MODIFIED: Added abort signal support
     */
    loadCSS(url, abortSignal = null) {
        return new Promise((resolve, reject) => {
            if (abortSignal && abortSignal.aborted) {
                reject(new Error('CSS loading aborted'));
                return;
            }
            
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            link.onload = resolve;
            link.onerror = () => reject(new Error(`Failed to load CSS: ${url}`));
            
            // Handle abort
            if (abortSignal) {
                abortSignal.addEventListener('abort', () => {
                    link.remove();
                    reject(new Error('CSS loading aborted'));
                });
            }
            
            document.head.appendChild(link);
        });
    }
    
    /**
     * Load HTML template - MODIFIED: Added abort signal support
     */
    async loadHTML(url, abortSignal = null) {
        const response = await fetch(url, { signal: abortSignal });
        if (!response.ok) {
            throw new Error(`Failed to load HTML: ${url}`);
        }
        const html = await response.text();
        
        // Store template for module access
        const moduleName = url.split('/').pop().replace('.html', '');
        window[`${this.getModuleClassName(moduleName)}Template`] = html;
    }
    
    /**
     * Load JavaScript file - MODIFIED: Added abort signal support
     */
    loadScript(url, abortSignal = null) {
        return new Promise((resolve, reject) => {
            if (abortSignal && abortSignal.aborted) {
                reject(new Error('Script loading aborted'));
                return;
            }
            
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
            
            // Handle abort
            if (abortSignal) {
                abortSignal.addEventListener('abort', () => {
                    script.remove();
                    reject(new Error('Script loading aborted'));
                });
            }
            
            document.body.appendChild(script);
        });
    }
    
    /**
     * Handle experiment selection from browser module - MODIFIED: Added cleanup
     */
    async handleExperimentSelected(event) {
        try {
            const { experimentId, experiment, metadata } = event.detail;
            
            console.log(`Experiment selected: ${experimentId}`);
            
            // NEW: Check if already loading an experiment
            if (this.isLoadingExperiment) {
                console.log('Already loading an experiment, cleaning up first...');
            }
            
            // NEW: Cleanup current experiment first
            this.cleanupCurrentExperiment();
            
            // NEW: Create abort controller for this experiment load
            this.currentExperimentLoadAbort = new AbortController();
            this.isLoadingExperiment = true;
            
            // Update current experiment
            this.currentExperiment = { experimentId, experiment, metadata };
            this.state.currentExperiment = this.currentExperiment;
            
            // STEP 1: Load and show experiment summary module FIRST
            await this.loadExperimentSummary(experimentId, this.currentExperimentLoadAbort.signal);
            
            // Check if aborted
            if (this.currentExperimentLoadAbort.signal.aborted) {
                return;
            }
            
            // STEP 2: Show data modules container
            this.showDataModules();
            
            // STEP 3: Load data modules based on available files
            await this.loadDataModulesForExperiment(experiment, this.currentExperimentLoadAbort.signal);
            
            // Mark loading complete
            this.isLoadingExperiment = false;
            
            // Update URL (optional)
            if (history.pushState) {
                history.pushState(null, '', `?experiment=${experimentId}`);
            }
            
        } catch (error) {
            this.isLoadingExperiment = false;
            
            // Don't show errors for aborted operations
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                console.log('Experiment loading was aborted');
                return;
            }
            
            console.error('Error handling experiment selection:', error);
            this.handleModuleError({
                detail: {
                    moduleName: 'application',
                    message: `Failed to load experiment: ${error.message}`,
                    recoverable: true
                }
            });
        }
    }
    
    /**
     * Load and initialize experiment summary module - MODIFIED: Added abort signal
     */
    async loadExperimentSummary(experimentId, abortSignal) {
        try {
            console.log(`Loading experiment summary for: ${experimentId}`);
            
            const containerId = 'experiment-summary-container';
            
            // Load summary module
            const summaryModule = await this.loadModule('experiment-summary', containerId, {
                experimentId: experimentId,
                experiment: this.currentExperiment.experiment,
                metadata: this.currentExperiment.metadata
            }, abortSignal);
            
            // Check if aborted
            if (abortSignal && abortSignal.aborted) {
                return;
            }
            
            // Show the summary container
            const container = document.getElementById(containerId);
            if (container) {
                container.classList.remove('hidden');
            }
            
            // Load experiment data into summary module
            if (summaryModule && typeof summaryModule.loadExperiment === 'function') {
                await summaryModule.loadExperiment(experimentId);
            }
            
            console.log(`Experiment summary loaded successfully for ${experimentId}`);
            
        } catch (error) {
            // Don't log abort errors
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                return;
            }
            
            console.error(`Failed to load experiment summary for ${experimentId}:`, error);
            
            // Don't fail the entire loading process - summary is helpful but not critical
            // Just log the error and continue
            this.showNotification(`Summary loading failed: ${error.message}`, 'warning');
        }
    }
    
    /**
     * Load data modules based on experiment file availability - MODIFIED: Added abort signal
     */
    async loadDataModulesForExperiment(experiment, abortSignal) {
        const moduleMap = {
            'hasAccelerationCsv': 'acceleration',
            'hasPositionCsv': 'distance-sensor',
            'hasTensileCsv': 'tensile-strength',
            'hasPhotos': 'photo-gallery',
            'hasThermalRavi': 'thermal-ir',  
            'hasTcp5File': 'tcp5-oscilloscope',
            //'hasWeldJournal': 'weld-journal',
            'hasCrownMeasurements': 'crown-measurements',
            'hasAmbientTemperature': 'ambient-temperature',
            'hasBinFile': 'bin-oscilloscope'
        };
        
        const loadPromises = [];
        
        for (const [fileFlag, moduleName] of Object.entries(moduleMap)) {
            if (experiment[fileFlag]) {
                console.log(`Loading ${moduleName} module (${fileFlag} = true)`);
                
                const containerId = `${moduleName}-container`;
                const promise = this.loadModule(moduleName, containerId, {
                    experimentId: this.currentExperiment.experimentId,
                    experiment: this.currentExperiment.experiment,
                    metadata: this.currentExperiment.metadata
                }, abortSignal).then(module => {
                    // Check if aborted
                    if (abortSignal && abortSignal.aborted) {
                        return;
                    }
                    
                    // Show the module container
                    const container = document.getElementById(containerId);
                    if (container) {
                        container.classList.remove('hidden');
                    }
                    
                    // Load experiment data into module
                    if (module && typeof module.loadExperiment === 'function') {
                        return module.loadExperiment(this.currentExperiment.experimentId);
                    }
                }).catch(error => {
                    // Don't log abort errors
                    if (error.name === 'AbortError' || error.message.includes('aborted')) {
                        return;
                    }
                    
                    console.error(`Failed to load ${moduleName}:`, error);
                    // Don't fail the entire loading process for individual modules
                });
                
                loadPromises.push(promise);
            }
        }
        
        // Wait for all modules to load
        await Promise.allSettled(loadPromises);
        
        console.log('Data modules loading completed');
    }
    
    /**
     * Show data modules container
     */
    showDataModules() {
        const container = document.getElementById('data-modules-container');
        if (container) {
            container.classList.remove('hidden');
        }
    }
    
    /**
     * Handle module errors
     */
    handleModuleError(event) {
        const { moduleName, message, recoverable } = event.detail;
        
        console.error(`Module error (${moduleName}):`, message);
        
        if (!recoverable) {
            this.showError(`${moduleName} Error`, message);
        } else {
            // Show non-blocking error notification
            this.showNotification(`${moduleName}: ${message}`, 'error');
        }
    }
    
    /**
     * Update connection status
     */
    updateConnectionStatus(status) {
        this.state.connectionStatus = status;
        
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            const statusText = {
                'connected': 'Connected to API',
                'disconnected': 'API Disconnected',
                'online': 'Online',
                'offline': 'Offline'
            };
            
            statusElement.textContent = statusText[status] || status;
            statusElement.className = `text-sm ${status === 'connected' || status === 'online' ? 'text-muted' : 'status-error'}`;
        }
    }
    
    /**
     * Show loading overlay
     */
    showLoading(message = 'Loading...') {
        const overlay = document.getElementById('app-loading');
        const content = overlay?.querySelector('.loading-content p');
        
        if (overlay) {
            overlay.classList.remove('hidden');
        }
        if (content) {
            content.textContent = message;
        }
    }
    
    /**
     * Hide loading overlay
     */
    hideLoading() {
        const overlay = document.getElementById('app-loading');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }
    
    /**
     * Show error overlay
     */
    showError(title, message) {
        const overlay = document.getElementById('app-error');
        const titleElement = overlay?.querySelector('h3');
        const messageElement = overlay?.querySelector('#error-message');
        
        if (overlay) {
            overlay.classList.remove('hidden');
        }
        if (titleElement) {
            titleElement.textContent = title;
        }
        if (messageElement) {
            messageElement.textContent = message;
        }
    }
    
    /**
     * Hide error overlay
     */
    hideError() {
        const overlay = document.getElementById('app-error');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }
    
    /**
     * Show notification (toast-style, future enhancement)
     */
    showNotification(message, type = 'info') {
        console.log(`Notification (${type}): ${message}`);
        // TODO: Implement toast notifications in future versions
    }
    
    /**
     * Get module by name
     */
    getModule(moduleName) {
        return this.modules.get(moduleName);
    }
    
    /**
     * Cleanup on page unload - MODIFIED: Enhanced cleanup
     */
    cleanup() {
        // Abort all requests
        this.abortAllRequests();
        
        // Destroy all modules
        this.destroyAllModules();
        
        console.log('Application cleanup completed');
    }
    
    /**
     * Get application state (for debugging)
     */
    getState() {
        return {
            ...this.state,
            modulesLoaded: Array.from(this.modules.keys()),
            isInitialized: this.isInitialized,
            isLoadingExperiment: this.isLoadingExperiment
        };
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.experimentAnalyzer = new ExperimentAnalyzer();
    window.experimentAnalyzer.init();
});

// Export for module access
window.ExperimentAnalyzer = ExperimentAnalyzer;