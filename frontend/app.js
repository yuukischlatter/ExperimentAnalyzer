/**
 * Experiment Analyzer - Main Application Controller
 * Manages module loading, global state, and inter-module communication
 * UPDATED: Added folding integration events
 */

class ExperimentAnalyzer {
    constructor() {
        this.modules = new Map();
        this.currentExperiment = null;
        this.apiBaseUrl = window.location.origin + '/api';
        this.isInitialized = false;
        
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
     * Load a module dynamically
     */
    async loadModule(moduleName, containerId, config = {}) {
        try {
            console.log(`Loading module: ${moduleName}`);
            
            // Check if module already loaded
            if (this.modules.has(moduleName)) {
                console.log(`Module ${moduleName} already loaded`);
                return this.modules.get(moduleName);
            }
            
            // Determine module path based on type
            const modulePath = this.getModulePath(moduleName);
            
            // Load module files
            await this.loadModuleFiles(modulePath, moduleName);
            
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
        // Core modules (experiment browser, etc.)
        if (['experiment-browser'].includes(moduleName)) {
            return `/modules/core/${moduleName}`;
        }
        
        // Data visualization modules
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
     * Load module files (HTML, CSS, JS)
     */
    async loadModuleFiles(modulePath, moduleName) {
        const promises = [];
        
        // Load CSS first
        promises.push(this.loadCSS(`${modulePath}/${moduleName}.css`));
        
        // Load HTML template
        promises.push(this.loadHTML(`${modulePath}/${moduleName}.html`));
        
        // Load JavaScript last
        promises.push(this.loadScript(`${modulePath}/${moduleName}.js`));
        
        await Promise.all(promises);
    }
    
    /**
     * Load CSS file
     */
    loadCSS(url) {
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            link.onload = resolve;
            link.onerror = () => reject(new Error(`Failed to load CSS: ${url}`));
            document.head.appendChild(link);
        });
    }
    
    /**
     * Load HTML template (store in window for module access)
     */
    async loadHTML(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load HTML: ${url}`);
        }
        const html = await response.text();
        
        // Store template for module access
        const moduleName = url.split('/').pop().replace('.html', '');
        window[`${this.getModuleClassName(moduleName)}Template`] = html;
    }
    
    /**
     * Load JavaScript file
     */
    loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
            document.body.appendChild(script);
        });
    }
    
    /**
     * Handle experiment selection from browser module
     */
    async handleExperimentSelected(event) {
        try {
            const { experimentId, experiment, metadata } = event.detail;
            
            console.log(`Experiment selected: ${experimentId}`);
            
            // Update current experiment
            this.currentExperiment = { experimentId, experiment, metadata };
            this.state.currentExperiment = this.currentExperiment;
            
            // Show data modules container
            this.showDataModules();
            
            // Load data modules based on available files
            await this.loadDataModulesForExperiment(experiment);
            
            // Update URL (optional)
            if (history.pushState) {
                history.pushState(null, '', `?experiment=${experimentId}`);
            }
            
        } catch (error) {
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
     * Load data modules based on experiment file availability
     */
    async loadDataModulesForExperiment(experiment) {
        const moduleMap = {
            'hasBinFile': 'bin-oscilloscope',
            //'hasAccelerationCsv': 'acceleration',
            'hasPositionCsv': 'distance-sensor',
            //'hasTensileCsv': 'tensile-strength',
            //'hasPhotos': 'photo-gallery',
            //'hasThermalRavi': 'thermal-ir',
            //'hasTcp5File': 'tcp5-oscilloscope',
            //'hasWeldJournal': 'weld-journal',
            //'hasCrownMeasurements': 'crown-measurements',
            'hasAmbientTemperature': 'ambient-temperature'
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
                }).then(module => {
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
     * Cleanup on page unload
     */
    cleanup() {
        // Destroy all modules
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
        console.log('Application cleanup completed');
    }
    
    /**
     * Get application state (for debugging)
     */
    getState() {
        return {
            ...this.state,
            modulesLoaded: Array.from(this.modules.keys()),
            isInitialized: this.isInitialized
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