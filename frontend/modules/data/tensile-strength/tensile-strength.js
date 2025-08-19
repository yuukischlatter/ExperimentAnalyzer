/**
 * Tensile Strength Module
 * Displays tensile testing CSV data with 3 individual plots for materials analysis
 * Integrates with tensile CSV backend service and shows red reference lines
 * Features: Force vs Displacement, Force vs Time, Displacement vs Time
 * UPDATED: Added cleanup and abort functionality
 */

class TensileStrength {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        this.state = {
            isLoaded: false,
            isVisible: false,
            experimentId: null,
            metadata: null,
            plotData: null,
            currentTimeRange: { min: 0, max: 100 },
            arePlotsReady: false
        };
        this.elements = {};
        this.plots = {
            forceDisplacementPlot: null,
            forceTimePlot: null,
            displacementTimePlot: null
        };
        
        // NEW: Request management
        this.abortController = null;
        this.isLoading = false;
        
        console.log('TensileStrength initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            maxPoints: 8000,  // Good for materials testing data
            plotHeight: 400,
            colors: {
                main: '#003278',        // Schlatter blue for traces
                reference: '#DC3232'    // Red for min limit lines
            },
            // Materials testing specific settings
            expectedUnits: { force: 'kN', displacement: 'mm', time: 's' },
            testType: 'Rail Tensile Testing',
            referenceLineWidth: 2
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
            console.log('TensileStrength initialized successfully');
            
        } catch (error) {
            console.error('TensileStrength initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'TensileStrengthTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/data/tensile-strength/tensile-strength.html');
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
            'forceDisplacementPlot', 'forceTimePlot', 'displacementTimePlot',
            'loadingSpinner', 'errorMessage', 'plotsContainer'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Tensile plots use standard Plotly interactions
        // No custom scrolling needed - materials testing data is typically smaller
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
        console.log('TensileStrength: Ongoing requests aborted');
    }
    
    /**
     * NEW: Cleanup state without destroying DOM
     */
    cleanup() {
        // Abort any ongoing requests
        this.abort();
        
        // Reset state
        this.state.experimentId = null;
        this.state.metadata = null;
        this.state.plotData = null;
        this.state.isLoaded = false;
        this.state.arePlotsReady = false;
        this.state.currentTimeRange = { min: 0, max: 100 };
        
        // Clear plots
        Object.values(this.plots).forEach(plot => {
            if (plot) {
                const plotElement = plot._fullLayout?._container || plot.parentNode;
                if (plotElement) {
                    Plotly.purge(plotElement);
                }
            }
        });
        
        this.plots = {
            forceDisplacementPlot: null,
            forceTimePlot: null,
            displacementTimePlot: null
        };
        
        // Clear UI
        this.hideError();
        this.hidePlots();
        this.hideLoading();
        
        console.log('TensileStrength: Cleanup completed');
    }
    
    /**
     * Load experiment data (Standard module interface) - MODIFIED: Added abort controller support
     * @param {string} experimentId - Experiment ID
     */
    async loadExperiment(experimentId) {
        try {
            // Prevent overlapping loads
            if (this.isLoading) {
                console.log('Already loading tensile strength data, aborting previous request...');
                this.abort();
            }
            
            // Create new abort controller
            this.abortController = new AbortController();
            this.isLoading = true;
            
            console.log(`Loading tensile testing data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId} - ${this.config.testType}`;
            }
            
            // Load metadata first
            await this.loadMetadata();
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Load all three channel data types
            await this.loadAllChannelData();
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Create all three plots
            await this.createAllPlots();
            
            this.state.isLoaded = true;
            this.isLoading = false;
            this.hideLoading();
            
            console.log(`Tensile testing data loaded successfully for ${experimentId}`);
            
        } catch (error) {
            this.isLoading = false;
            
            // Don't show errors for aborted requests
            if (error.name === 'AbortError') {
                console.log('Tensile strength loading was aborted');
                return;
            }
            
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Load tensile CSV metadata - MODIFIED: Added abort signal support
     */
    async loadMetadata() {
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/tensile-metadata`,
                { signal: this.abortController.signal }
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Tensile CSV file not found for this experiment');
                }
                throw new Error(`Failed to load tensile metadata: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load tensile metadata');
            }
            
            this.state.metadata = result.data;
            
            // Convert time range from microseconds to seconds for display (if available)
            if (result.data.timeRange) {
                this.state.currentTimeRange = {
                    min: result.data.timeRange.min / 1000000,  // µs to seconds
                    max: result.data.timeRange.max / 1000000   // µs to seconds
                };
            }
            
            // Update header metadata display
            this.updateHeaderMetadata(result.data.testMetadata);
            
            console.log('Tensile metadata loaded:', {
                testNumber: result.data.testMetadata.testNumber,
                materialGrade: result.data.testMetadata.materialGrade,
                nominalForce: result.data.testMetadata.nominalForce,
                minForceLimit: result.data.testMetadata.minForceLimit
            });
            
        } catch (error) {
            throw new Error(`Tensile metadata loading failed: ${error.message}`);
        }
    }
    
    /**
     * Update header metadata display
     */
    updateHeaderMetadata(testMetadata) {
    }
    
    /**
     * Load all three channel data types - MODIFIED: Added abort signal support
     */
    async loadAllChannelData() {
        try {
            console.log('Loading all tensile channel data...');
            
            // Use bulk endpoint to get all channels at once
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/tensile-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: ['force_kN', 'displacement_mm', 'force_vs_displacement'],
                        startTime: this.state.currentTimeRange.min * 1000000, // Convert to µs
                        endTime: this.state.currentTimeRange.max * 1000000,
                        maxPoints: this.config.maxPoints
                    }),
                    signal: this.abortController.signal
                }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to load tensile channel data: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load tensile channel data');
            }
            
            // Process the bulk response
            this.state.plotData = {};
            
            for (const [channelId, channelResult] of Object.entries(result.data.channels)) {
                if (channelResult.success) {
                    // Handle different data structures for time-series vs XY data
                    if (channelResult.data.time) {
                        // Time series data (force_kN, displacement_mm)
                        const timeInSeconds = channelResult.data.time.map(t => t / 1000000); // Convert µs to s
                        this.state.plotData[channelId] = {
                            success: true,
                            data: {
                                time: timeInSeconds,
                                values: channelResult.data.values
                            },
                            metadata: channelResult.metadata
                        };
                    } else if (channelResult.data.x && channelResult.data.y) {
                        // XY relationship data (force_vs_displacement)
                        this.state.plotData[channelId] = {
                            success: true,
                            data: {
                                x: channelResult.data.x,  // displacement in mm
                                y: channelResult.data.y   // force in kN
                            },
                            metadata: channelResult.metadata
                        };
                    }
                } else {
                    console.warn(`Failed to load channel ${channelId}:`, channelResult.error);
                    this.state.plotData[channelId] = { success: false, error: channelResult.error };
                }
            }
            
            console.log(`Loaded tensile channels successfully:`, Object.keys(this.state.plotData));
            
        } catch (error) {
            throw new Error(`Tensile channel data loading failed: ${error.message}`);
        }
    }
    
    /**
     * Create all three Plotly plots
     */
    async createAllPlots() {
        if (!this.elements.forceDisplacementPlot || !this.elements.forceTimePlot || 
            !this.elements.displacementTimePlot || !this.state.plotData) {
            throw new Error('Missing plot containers or tensile data');
        }
        
        try {
            console.log('Creating all tensile plots...');
            
            // Create plots in sequence for better performance
            await this.createForceDisplacementPlot();
            await this.createForceTimePlot();
            await this.createDisplacementTimePlot();
            
            // Setup event handlers for all plots
            this.attachPlotEvents();
            
            this.state.arePlotsReady = true;
            this.showPlots();
            
            console.log('All tensile plots created successfully');
            
        } catch (error) {
            throw new Error(`Tensile plots creation failed: ${error.message}`);
        }
    }
    
    /**
     * Create Force vs Displacement plot (Primary materials testing plot)
     */
    async createForceDisplacementPlot() {
        const channelData = this.state.plotData.force_vs_displacement;
        if (!channelData || !channelData.success) {
            throw new Error('Force vs displacement data not available');
        }
        
        const traces = [];
        
        // Main trace: Force vs Displacement curve
        traces.push({
            x: channelData.data.x,  // displacement in mm
            y: channelData.data.y,  // force in kN
            type: 'scatter',
            mode: 'lines',
            name: 'Force vs Displacement',
            line: { 
                color: this.config.colors.main,
                width: 2.5
            },
            hovertemplate: 
                '<b>Force vs Displacement</b><br>' +
                'Displacement: %{x:.3f} mm<br>' +
                'Force: %{y:.2f} kN<br>' +
                '<extra></extra>'
        });
        
        // Add reference lines from metadata
        const refLines = this.createForceDisplacementReferenceLines();
        traces.push(...refLines);
        
        const layout = {
            title: { text: '', font: { size: 0 } },
            
            xaxis: {
                title: 'Displacement [mm]',
                showgrid: true,
                gridcolor: 'rgba(0, 50, 120, 0.1)',
                tickfont: { color: '#666666' }
            },
            
            yaxis: {
                title: { 
                    text: 'Force [kN]', 
                    font: { color: this.config.colors.main, size: 14 }
                },
                showgrid: true,
                gridcolor: 'rgba(0, 50, 120, 0.1)',
                tickfont: { color: this.config.colors.main },
                titlefont: { color: this.config.colors.main },
                zeroline: true,
                zerolinecolor: 'rgba(0, 50, 120, 0.3)'
            },
            
            legend: {
                x: 0.02, y: 0.98,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0, 50, 120, 0.3)',
                borderwidth: 1
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(0, 50, 120, 0.02)',
            paper_bgcolor: '#ffffff',
            autosize: true,
            showlegend: true
        };
        
        const config = this.createPlotConfig('force_displacement');
        
        this.plots.forceDisplacementPlot = await Plotly.newPlot(
            this.elements.forceDisplacementPlot, 
            traces, 
            layout, 
            config
        );
    }
    
    /**
     * Create Force vs Time plot
     */
    async createForceTimePlot() {
        const channelData = this.state.plotData.force_kN;
        if (!channelData || !channelData.success) {
            throw new Error('Force time series data not available');
        }
        
        const traces = [];
        
        // Main trace: Force over time
        traces.push({
            x: channelData.data.time,    // time in seconds
            y: channelData.data.values,  // force in kN
            type: 'scatter',
            mode: 'lines',
            name: 'Force Development',
            line: { 
                color: this.config.colors.main,
                width: 2
            },
            hovertemplate: 
                '<b>Force Development</b><br>' +
                'Time: %{x:.3f} s<br>' +
                'Force: %{y:.2f} kN<br>' +
                '<extra></extra>'
        });
        
        // Add horizontal reference line for min force limit
        const minForceLimit = this.state.metadata.testMetadata.minForceLimit;
        if (minForceLimit) {
            traces.push({
                x: [channelData.data.time[0], channelData.data.time[channelData.data.time.length - 1]],
                y: [minForceLimit, minForceLimit],
                type: 'scatter',
                mode: 'lines',
                name: `Min Force Limit (${minForceLimit} kN)`,
                line: { 
                    color: this.config.colors.reference,
                    width: this.config.referenceLineWidth,
                    dash: 'dash'
                },
                hovertemplate: 
                    '<b>Min Force Limit</b><br>' +
                    'Force: %{y:.2f} kN<br>' +
                    '<extra></extra>'
            });
        }
        
        const layout = {
            title: { text: '', font: { size: 0 } },
            
            xaxis: {
                title: 'Time [s]',
                showgrid: true,
                gridcolor: 'rgba(0, 50, 120, 0.1)',
                tickfont: { color: '#666666' }
            },
            
            yaxis: {
                title: { 
                    text: 'Force [kN]', 
                    font: { color: this.config.colors.main, size: 14 }
                },
                showgrid: true,
                gridcolor: 'rgba(0, 50, 120, 0.1)',
                tickfont: { color: this.config.colors.main },
                titlefont: { color: this.config.colors.main },
                zeroline: true,
                zerolinecolor: 'rgba(0, 50, 120, 0.3)'
            },
            
            legend: {
                x: 0.02, y: 0.98,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0, 50, 120, 0.3)',
                borderwidth: 1
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(0, 50, 120, 0.01)',
            paper_bgcolor: '#ffffff',
            autosize: true,
            showlegend: true
        };
        
        const config = this.createPlotConfig('force_time');
        
        this.plots.forceTimePlot = await Plotly.newPlot(
            this.elements.forceTimePlot, 
            traces, 
            layout, 
            config
        );
    }
    
    /**
     * Create Displacement vs Time plot
     */
    async createDisplacementTimePlot() {
        const channelData = this.state.plotData.displacement_mm;
        if (!channelData || !channelData.success) {
            throw new Error('Displacement time series data not available');
        }
        
        const traces = [];
        
        // Main trace: Displacement over time
        traces.push({
            x: channelData.data.time,    // time in seconds
            y: channelData.data.values,  // displacement in mm
            type: 'scatter',
            mode: 'lines',
            name: 'Displacement Development',
            line: { 
                color: this.config.colors.main,
                width: 2
            },
            hovertemplate: 
                '<b>Displacement Development</b><br>' +
                'Time: %{x:.3f} s<br>' +
                'Displacement: %{y:.3f} mm<br>' +
                '<extra></extra>'
        });
        
        // Add horizontal reference line for min displacement
        const minDisplacement = this.state.metadata.testMetadata.minDeformation;
        if (minDisplacement) {
            traces.push({
                x: [channelData.data.time[0], channelData.data.time[channelData.data.time.length - 1]],
                y: [minDisplacement, minDisplacement],
                type: 'scatter',
                mode: 'lines',
                name: `Min Displacement (${minDisplacement} mm)`,
                line: { 
                    color: this.config.colors.reference,
                    width: this.config.referenceLineWidth,
                    dash: 'dash'
                },
                hovertemplate: 
                    '<b>Min Displacement</b><br>' +
                    'Displacement: %{y:.3f} mm<br>' +
                    '<extra></extra>'
            });
        }
        
        const layout = {
            title: { text: '', font: { size: 0 } },
            
            xaxis: {
                title: 'Time [s]',
                showgrid: true,
                gridcolor: 'rgba(0, 50, 120, 0.1)',
                tickfont: { color: '#666666' }
            },
            
            yaxis: {
                title: { 
                    text: 'Displacement [mm]', 
                    font: { color: this.config.colors.main, size: 14 }
                },
                showgrid: true,
                gridcolor: 'rgba(0, 50, 120, 0.1)',
                tickfont: { color: this.config.colors.main },
                titlefont: { color: this.config.colors.main },
                zeroline: true,
                zerolinecolor: 'rgba(0, 50, 120, 0.3)'
            },
            
            legend: {
                x: 0.02, y: 0.98,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0, 50, 120, 0.3)',
                borderwidth: 1
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(0, 50, 120, 0.01)',
            paper_bgcolor: '#ffffff',
            autosize: true,
            showlegend: true
        };
        
        const config = this.createPlotConfig('displacement_time');
        
        this.plots.displacementTimePlot = await Plotly.newPlot(
            this.elements.displacementTimePlot, 
            traces, 
            layout, 
            config
        );
    }
    
    /**
     * Create reference lines for Force vs Displacement plot
     */
    createForceDisplacementReferenceLines() {
        const traces = [];
        const testMetadata = this.state.metadata.testMetadata;
        const channelData = this.state.plotData.force_vs_displacement.data;
        
        // Get data ranges for reference lines
        const xMin = Math.min(...channelData.x);
        const xMax = Math.max(...channelData.x);
        const yMin = Math.min(...channelData.y);
        const yMax = Math.max(...channelData.y);
        
        // Vertical line at min displacement
        if (testMetadata.minDeformation) {
            traces.push({
                x: [testMetadata.minDeformation, testMetadata.minDeformation],
                y: [yMin, yMax],
                type: 'scatter',
                mode: 'lines',
                name: `Min Displacement (${testMetadata.minDeformation} mm)`,
                line: { 
                    color: this.config.colors.reference,
                    width: this.config.referenceLineWidth,
                    dash: 'dash'
                },
                hovertemplate: 
                    '<b>Min Displacement Limit</b><br>' +
                    'Displacement: %{x:.3f} mm<br>' +
                    '<extra></extra>'
            });
        }
        
        // Horizontal line at min force limit
        if (testMetadata.minForceLimit) {
            traces.push({
                x: [xMin, xMax],
                y: [testMetadata.minForceLimit, testMetadata.minForceLimit],
                type: 'scatter',
                mode: 'lines',
                name: `Min Force Limit (${testMetadata.minForceLimit} kN)`,
                line: { 
                    color: this.config.colors.reference,
                    width: this.config.referenceLineWidth,
                    dash: 'dash'
                },
                hovertemplate: 
                    '<b>Min Force Limit</b><br>' +
                    'Force: %{y:.2f} kN<br>' +
                    '<extra></extra>'
            });
        }
        
        return traces;
    }
    
    /**
     * Create Plotly configuration for plots
     */
    createPlotConfig(plotType) {
        return {
            responsive: true,
            displayModeBar: true,
            scrollZoom: true,
            displaylogo: false,
            modeBarButtonsToRemove: [],
            toImageButtonOptions: {
                format: 'png',
                filename: `tensile_${plotType}_${this.state.experimentId}`,
                height: 600,
                width: 1000,
                scale: 1
            }
        };
    }
    
    /**
     * Attach plot event handlers
     */
    attachPlotEvents() {
        // Time-based plots can be synchronized (optional future enhancement)
        // For now, each plot is independent
        
        // Handle zoom events for time-based plots if needed
        if (this.elements.forceTimePlot) {
            this.elements.forceTimePlot.on('plotly_relayout', (eventData) => {
                // Could implement synchronized zoom between time plots
            });
        }
        
        if (this.elements.displacementTimePlot) {
            this.elements.displacementTimePlot.on('plotly_relayout', (eventData) => {
                // Could implement synchronized zoom between time plots
            });
        }
    }
    
    // === STATE MANAGEMENT ===
    
    showLoading() {
        this.hideError();
        this.hidePlots();
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
        this.hidePlots();
        
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
    
    showPlots() {
        this.hideLoading();
        this.hideError();
        
        if (this.elements.plotsContainer) {
            this.elements.plotsContainer.classList.remove('hidden');
        }
    }
    
    hidePlots() {
        if (this.elements.plotsContainer) {
            this.elements.plotsContainer.classList.add('hidden');
        }
    }
    
    onError(error) {
        const message = error.message || 'Failed to load tensile testing data';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'tensile-strength',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:tensile-strength:${eventName}`;
        const event = new CustomEvent(fullEventName, {
            detail: data,
            bubbles: true
        });
        document.dispatchEvent(event);
    }
    
    // === PUBLIC INTERFACE (Standard Module Methods) ===
    
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
        
        // Clean up all Plotly plots
        Object.values(this.plots).forEach(plot => {
            if (plot) {
                const plotElement = plot._fullLayout?._container || plot.parentNode;
                if (plotElement) {
                    Plotly.purge(plotElement);
                }
            }
        });
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        // Clear state
        this.state = {};
        this.elements = {};
        this.plots = {};
        
        console.log('TensileStrength destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config,
            isLoading: this.isLoading
        };
    }
    
    // === TENSILE-SPECIFIC METHODS ===
    
    /**
     * Get ultimate strength (maximum force reached)
     * @returns {number|null} Ultimate strength in kN
     */
    getUltimateStrength() {
        const forceData = this.state.plotData?.force_vs_displacement;
        if (!forceData || !forceData.success) return null;
        
        return Math.max(...forceData.data.y);
    }
    
    /**
     * Get maximum displacement reached
     * @returns {number|null} Maximum displacement in mm
     */
    getMaximumDisplacement() {
        const forceData = this.state.plotData?.force_vs_displacement;
        if (!forceData || !forceData.success) return null;
        
        return Math.max(...forceData.data.x);
    }
    
    /**
     * Get test metadata for integration with other modules
     * @returns {Object|null} Test metadata
     */
    getTestMetadata() {
        return this.state.metadata?.testMetadata || null;
    }
    
    /**
     * Check if test passes minimum requirements
     * @returns {Object} {passesForce: boolean, passesDisplacement: boolean, overall: boolean}
     */
    getTestResults() {
        const metadata = this.getTestMetadata();
        if (!metadata) return null;
        
        const ultimateStrength = this.getUltimateStrength();
        const maxDisplacement = this.getMaximumDisplacement();
        
        const passesForce = ultimateStrength >= metadata.minForceLimit;
        const passesDisplacement = maxDisplacement >= metadata.minDeformation;
        
        return {
            passesForce,
            passesDisplacement,
            overall: passesForce && passesDisplacement,
            values: {
                ultimateStrength,
                maxDisplacement,
                minForceLimit: metadata.minForceLimit,
                minDeformation: metadata.minDeformation
            }
        };
    }
}

// Export for global access
window.TensileStrength = TensileStrength;