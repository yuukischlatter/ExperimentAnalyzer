/**
 * Binary Oscilloscope Module
 * High-performance visualization of .bin file data with multi-axis support
 * FINAL VERSION: Exact copy of JS system behavior
 */

class BinOscilloscope {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        
        // State management - matching JS system exactly
        this.state = {
            isLoaded: false,
            isVisible: false,
            isInitialized: false,
            currentExperiment: null,
            metadata: null,
            currentPlot: null,
            isLoading: false,
            error: null,
            
            // Channel visibility - start with all channels visible
            visibleChannels: [0, 1, 2, 3, 4, 5, 6, 7],
            
            // Current time range for zoom-responsive loading
            currentTimeRange: { start: 0, end: 100 },
            
            // Data cache for performance
            cachedData: new Map(),
            
            // Plot interaction state
            isHandlingZoom: false,
            zoomTimeout: null,
            
            // Visibility state preservation (like JS)
            currentVisibilityState: {},
            
            // Track if we have a plotly instance
            plotlyInitialized: false,
            
            // UI revision for state preservation
            uiRevision: 'bin-oscilloscope-ui-v1'
        };
        
        this.elements = {};
        
        console.log('BinOscilloscope initialized');
        
        // Initialize the module immediately after construction
        this.init().catch(error => {
            console.error('Failed to initialize BinOscilloscope:', error);
        });
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            // EXACT JS VALUES:
            maxPointsDefault: 2000,      // Default points (JS default)
            maxPointsZoomed: 3000,       // ALWAYS 3000 when zoomed (JS behavior)
            zoomDebounceMs: 150,         // JS uses 150ms
            colors: [
                '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
                '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'
            ]
        };
    }
    
    /**
     * Initialize the module
     */
    async init() {
        if (this.state.isInitialized) {
            console.log('BinOscilloscope already initialized');
            return;
        }
        
        try {
            await this.loadTemplate();
            this.render();
            // Wait a bit for DOM to settle
            await new Promise(resolve => setTimeout(resolve, 100));
            this.bindElements();
            this.attachEvents();
            this.show();
            
            this.state.isInitialized = true;
            console.log('BinOscilloscope module initialized successfully');
            
        } catch (error) {
            console.error('BinOscilloscope initialization failed:', error);
            this.onError(error);
        }
    }
    
    /**
     * Ensure module is initialized before performing operations
     */
    async ensureInitialized() {
        if (!this.state.isInitialized) {
            await this.init();
        }
    }
    
    /**
     * Load HTML template
     */
    async loadTemplate() {
        const templateVar = 'BinOscilloscopeTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
            console.log('Template loaded from window');
        } else {
            const response = await fetch('/modules/data/bin-oscilloscope/bin-oscilloscope.html');
            if (!response.ok) {
                throw new Error(`Failed to load template: ${response.status}`);
            }
            this.template = await response.text();
            console.log('Template loaded from fetch');
        }
    }
    
    /**
     * Render template to container
     */
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            throw new Error(`Container element not found: ${this.containerId}`);
        }
        
        if (!this.template) {
            throw new Error('Template not loaded');
        }
        
        console.log('Rendering template to container:', this.containerId);
        container.innerHTML = this.template;
    }
    
    /**
     * Bind DOM elements
     */
    bindElements() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error('Container not found for binding:', this.containerId);
            return;
        }
        
        const bindableElements = container.querySelectorAll('[data-bind]');
        
        bindableElements.forEach(el => {
            const bindName = el.dataset.bind;
            this.elements[bindName] = el;
        });
        
        // Verify required elements
        const required = ['plotContainer', 'loadingSpinner', 'errorMessage', 'channelControls'];
        for (const elementName of required) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    /**
     * Attach event listeners
     */
    attachEvents() {
        // Channel visibility checkboxes
        if (this.elements.channelControls) {
            this.elements.channelControls.addEventListener('change', this.handleChannelToggle.bind(this));
        }
        
        // Reset zoom button
        if (this.elements.resetZoomBtn) {
            this.elements.resetZoomBtn.addEventListener('click', this.resetZoom.bind(this));
        }
        
        // Reset Y-axes button  
        if (this.elements.resetYAxesBtn) {
            this.elements.resetYAxesBtn.addEventListener('click', this.resetYAxes.bind(this));
        }
        
        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', () => {
                this.hideError();
                if (this.state.currentExperiment) {
                    this.loadExperiment(this.state.currentExperiment);
                }
            });
        }
    }
    
    /**
     * Load experiment data (main entry point)
     */
    async loadExperiment(experimentId) {
        try {
            await this.ensureInitialized();
            
            console.log(`Loading binary data for experiment: ${experimentId}`);
            
            this.state.currentExperiment = experimentId;
            this.state.isLoading = true;
            this.showLoading();
            
            // Clear previous data and plot
            this.clearPreviousData();
            
            // Load metadata first
            await this.loadMetadata();
            
            // Create channel controls
            this.createChannelControls();
            
            // Build initial traces and create plot
            await this.createInitialPlot();
            
            // Update state
            this.state.isLoaded = true;
            this.state.isLoading = false;
            this.state.error = null;
            
            this.hideLoading();
            this.updateStatusInfo();
            
            console.log('Binary data loaded successfully');
            
        } catch (error) {
            console.error('Error loading experiment:', error);
            this.state.isLoading = false;
            this.state.error = error;
            this.showError(error.message);
        }
    }
    
    /**
     * Clear previous data and plot
     */
    clearPreviousData() {
        // Clear cache
        this.state.cachedData.clear();
        
        // Clear plot if exists
        if (this.state.plotlyInitialized && this.elements.plotContainer) {
            try {
                Plotly.purge(this.elements.plotContainer);
                this.state.plotlyInitialized = false;
            } catch (error) {
                console.warn('Error purging previous plot:', error);
            }
        }
        
        // Reset state
        this.state.currentVisibilityState = {};
        this.state.isHandlingZoom = false;
        if (this.state.zoomTimeout) {
            clearTimeout(this.state.zoomTimeout);
            this.state.zoomTimeout = null;
        }
    }
    
    /**
     * Load experiment metadata - using NEW JS-compatible endpoint
     */
    async loadMetadata() {
        // Use NEW JS-compatible endpoint format
        const response = await fetch(`${this.config.apiBaseUrl}/experiment/${this.state.currentExperiment}/metadata`);
        
        if (!response.ok) {
            throw new Error(`Failed to load metadata: ${response.status} ${response.statusText}`);
        }
        
        const metadata = await response.json();
        
        // Transform to our internal format
        this.state.metadata = {
            channels: metadata.channels,
            duration: metadata.duration,
            samplingRate: metadata.samplingRate,
            totalPoints: metadata.totalPoints
        };
        
        this.state.currentTimeRange = { start: 0, end: metadata.duration };
        
        console.log('Metadata loaded:', this.state.metadata);
    }
    
    /**
     * Create channel visibility controls
     */
    createChannelControls() {
        if (!this.elements.channelControls || !this.state.metadata) return;
        
        const channels = this.state.metadata.channels;
        const controlsHTML = channels.map(ch => `
            <label class="channel-control" data-channel="${ch.index}">
                <input type="checkbox" 
                       data-channel="${ch.index}" 
                       ${this.state.visibleChannels.includes(ch.index) ? 'checked' : ''}>
                <span class="channel-indicator" style="background-color: ${this.config.colors[ch.index]}"></span>
                <span class="channel-label">${ch.label}</span>
                <span class="channel-unit">[${ch.unit}]</span>
            </label>
        `).join('');
        
        this.elements.channelControls.innerHTML = `
            <div class="controls-header">
                <h4>Channels</h4>
                <button data-bind="toggleAllBtn" class="btn btn-sm">Toggle All</button>
            </div>
            <div class="controls-grid">
                ${controlsHTML}
            </div>
        `;
        
        // Re-bind the toggle all button
        this.elements.toggleAllBtn = this.elements.channelControls.querySelector('[data-bind="toggleAllBtn"]');
        if (this.elements.toggleAllBtn) {
            this.elements.toggleAllBtn.addEventListener('click', this.toggleAllChannels.bind(this));
        }
    }
    
    /**
     * Create initial plot with all traces
     */
    async createInitialPlot() {
        const startTime = 0;
        const endTime = this.state.metadata.duration;
        
        // Build all traces with default points (2000)
        const result = await this.buildAllTraces(startTime, endTime, this.config.maxPointsDefault);
        
        // Create plot layout
        const layout = this.createPlotLayout();
        
        // Create the plot
        await this.createPlot(result.traces, layout);
        
        // Capture initial visibility state
        this.captureCurrentVisibility();
        
        console.log(`Initial plot created with ${result.traces.length} traces`);
    }
    
    /**
     * Build all traces for current visible channels - EXACT JS COPY
     */
    async buildAllTraces(startTime, endTime, maxPoints) {
        const traces = [];
        
        // Load data for all visible channels in parallel
        const channelPromises = this.state.visibleChannels.map(async channel => {
            try {
                const data = await this.loadChannelData(channel, startTime, endTime, maxPoints);
                const ch = this.state.metadata.channels[channel];
                
                return {
                    x: data.time,
                    y: data.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${ch.label} [${ch.unit}]`,
                    line: { color: this.config.colors[channel], width: 1.5 },
                    yaxis: this.getYAxisForUnit(ch.unit),
                    visible: true,
                    legendgroup: 'binary',
                    showlegend: true
                };
            } catch (error) {
                console.warn(`Failed to load channel ${channel}:`, error.message);
                return null;
            }
        });
        
        const results = await Promise.all(channelPromises);
        
        // Add successful traces
        results.forEach(trace => {
            if (trace) {
                traces.push(trace);
            }
        });
        
        return { 
            traces, 
            totalPoints: traces.reduce((sum, t) => sum + (t.x?.length || 0), 0)
        };
    }
    
    /**
     * Load data for a specific channel - using NEW JS-compatible endpoint
     */
    async loadChannelData(channel, startTime, endTime, maxPoints) {
        // Build cache key
        const cacheKey = `${channel}_${startTime}_${endTime}_${maxPoints}`;
        
        // Check cache first
        if (this.state.cachedData.has(cacheKey)) {
            return this.state.cachedData.get(cacheKey);
        }
        
        // Use NEW JS-compatible endpoint and parameters
        const params = new URLSearchParams({
            start: startTime.toString(),     // Changed from startTime
            end: endTime.toString(),          // Changed from endTime  
            maxPoints: maxPoints.toString()
        });
        
        try {
            // Use NEW endpoint format
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiment/${this.state.currentExperiment}/data/${channel}?${params}`
            );
            
            if (!response.ok) {
                throw new Error(`Failed to load channel ${channel}: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Cache the result
            this.state.cachedData.set(cacheKey, data);
            
            // Limit cache size
            if (this.state.cachedData.size > 50) {
                const firstKey = this.state.cachedData.keys().next().value;
                this.state.cachedData.delete(firstKey);
            }
            
            return data;
            
        } catch (error) {
            console.error(`Error loading channel ${channel}:`, error);
            throw error;
        }
    }
    
    /**
     * Create Plotly layout - EXACT JS COPY
     */
    createPlotLayout() {
        return {
            title: {
                text: `${this.state.currentExperiment} - Multi-Channel Data`,
                font: { size: 16, color: '#2c3e50' }
            },
            
            // IMPORTANT: uirevision for state preservation (JS system)
            uirevision: this.state.uiRevision,
            
            // X-axis (time) - EXACT JS domain
            xaxis: {
                title: 'Time [s]',
                range: [this.state.currentTimeRange.start, this.state.currentTimeRange.end],
                domain: [0.26, 0.94],  // EXACT JS values
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)',
                automargin: true
            },
            
            // Voltage axis (left side - y)
            yaxis: {
                title: { 
                    text: 'Voltage [V]', 
                    font: { color: this.config.colors[0], size: 14, family: 'Arial Black' },
                    standoff: 12
                },
                tickfont: { color: this.config.colors[0], size: 12 },
                side: 'left',
                position: 0.0,
                showgrid: true,
                gridcolor: 'rgba(31, 119, 180, 0.2)',
                gridwidth: 1,
                zeroline: true,
                zerolinecolor: 'rgba(31, 119, 180, 0.7)',
                zerolinewidth: 2,
                automargin: true,
                linecolor: this.config.colors[0],
                linewidth: 3,
                showline: true
            },
            
            // Current axis (second from left - y2)
            yaxis2: {
                title: { 
                    text: 'Current [A]', 
                    font: { color: this.config.colors[2], size: 14, family: 'Arial Black' },
                    standoff: 12
                },
                tickfont: { color: this.config.colors[2], size: 12 },
                side: 'left',
                position: 0.08,
                overlaying: 'y',
                anchor: 'free',
                showgrid: false,
                zeroline: true,
                zerolinecolor: 'rgba(44, 160, 44, 0.7)',
                zerolinewidth: 2,
                automargin: true,
                linecolor: this.config.colors[2],
                linewidth: 3,
                showline: true
            },
            
            // Pressure axis (third from left - y3)
            yaxis3: {
                title: { 
                    text: 'Pressure [Bar]', 
                    font: { color: this.config.colors[6], size: 14, family: 'Arial Black' },
                    standoff: 12
                },
                tickfont: { color: this.config.colors[6], size: 12 },
                side: 'left',
                position: 0.16,
                overlaying: 'y',
                anchor: 'free',
                showgrid: false,
                zeroline: false,
                automargin: true,
                linecolor: this.config.colors[6],
                linewidth: 3,
                showline: true
            },
            
            // Legend - EXACT JS settings
            legend: {
                x: 1.02,
                y: 1,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0,0,0,0.3)',
                borderwidth: 1,
                groupclick: 'toggleitem',
                uirevision: this.state.uiRevision
            },
            
            height: 600,
            margin: { 
                l: 120,  // Adjusted for multiple Y-axes
                r: 50, 
                t: 80, 
                b: 60 
            },
            plot_bgcolor: 'rgba(248,249,250,0.3)',
            paper_bgcolor: 'rgba(0,0,0,0)',
            autosize: true
        };
    }
    
    /**
     * Create Plotly plot with event handlers
     */
    async createPlot(traces, layout) {
        if (!this.elements.plotContainer) {
            throw new Error('Plot container element not found');
        }
        
        const config = {
            responsive: true,
            displayModeBar: true,
            scrollZoom: false,
            modeBarButtonsToAdd: ['pan2d', 'select2d', 'lasso2d'],
            displaylogo: false
        };
        
        try {
            await Plotly.newPlot(this.elements.plotContainer, traces, layout, config);
            this.state.plotlyInitialized = true;
            this.state.currentPlot = this.elements.plotContainer;
            
            // Setup event listeners
            this.setupPlotEventListeners();
            
            console.log('Plotly plot created successfully');
            
        } catch (error) {
            console.error('Error creating Plotly plot:', error);
            throw error;
        }
    }
    
    /**
     * Setup plot event listeners - EXACT JS COPY
     */
    setupPlotEventListeners() {
        const plotContainer = this.elements.plotContainer;
        if (!plotContainer) return;
        
        // Remove existing listeners
        plotContainer.removeAllListeners?.('plotly_relayout');
        plotContainer.removeAllListeners?.('plotly_restyle');
        
        // Add zoom/pan handler
        plotContainer.on('plotly_relayout', this.handleZoomEvent.bind(this));
        
        // Add visibility change handler
        plotContainer.on('plotly_restyle', this.handleVisibilityEvent.bind(this));
        
        // Add Y-axis scroll zoom (JS feature)
        this.setupYAxisScrollZoom();
        
        console.log('Plot event listeners setup complete');
    }
    
    /**
     * Handle zoom/pan events - EXACT JS COPY
     */
    async handleZoomEvent(eventData) {
        // Check if this is a zoom event
        if (!eventData['xaxis.range[0]'] && !eventData['xaxis.range[1]']) return;
        if (this.state.isHandlingZoom) return;
        if (!this.state.currentExperiment) return;
        
        const startTime = eventData['xaxis.range[0]'] || 0;
        const endTime = eventData['xaxis.range[1]'] || this.state.metadata.duration;
        
        // Update current time range
        this.state.currentTimeRange = { start: startTime, end: endTime };
        
        // Debounce rapid zoom events (150ms like JS)
        if (this.state.zoomTimeout) {
            clearTimeout(this.state.zoomTimeout);
        }
        
        this.state.zoomTimeout = setTimeout(async () => {
            await this.performZoomResample(startTime, endTime);
        }, this.config.zoomDebounceMs);
    }
    
    /**
     * Perform zoom resampling - EXACT JS COPY
     */
    async performZoomResample(startTime, endTime) {
        if (this.state.isHandlingZoom) return;
        
        try {
            this.state.isHandlingZoom = true;
            
            // IMPORTANT: Capture current visibility state before rebuilding
            const savedVisibilityState = this.captureCurrentVisibility();
            
            console.log(`Resampling data for zoom: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);
            
            // Build new traces with FIXED 3000 points (EXACT JS behavior)
            const result = await this.buildAllTraces(startTime, endTime, 3000);
            
            // IMPORTANT: Restore visibility state to new traces
            this.restoreVisibilityState(result.traces, savedVisibilityState);
            
            // Update plot with Plotly.react (JS uses react, not restyle)
            await Plotly.react(this.state.currentPlot, result.traces, this.state.currentPlot.layout);
            
            this.updateStatusInfo();
            
        } catch (error) {
            console.error('Error during zoom resampling:', error);
        } finally {
            this.state.isHandlingZoom = false;
        }
    }
    
    /**
     * Setup Y-axis scroll zoom - JS FEATURE
     */
    setupYAxisScrollZoom() {
        const plotContainer = this.elements.plotContainer;
        if (!plotContainer) return;
        
        // Remove existing listeners
        plotContainer.removeEventListener('wheel', this.handleWheelZoom);
        
        // Add new listener with bound context
        this.handleWheelZoom = this.handleWheelZoom.bind(this);
        plotContainer.addEventListener('wheel', this.handleWheelZoom, { passive: false });
    }
    
    /**
     * Handle wheel zoom on Y-axes - EXACT JS COPY
     */
    handleWheelZoom(e) {
        // Find the plot area
        const plotArea = e.target.closest('.plot-container');
        if (!plotArea) return;
        
        const rect = plotArea.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        
        // Calculate which axis zone we're in
        const zones = this.calculateAxisZones(width);
        const targetAxis = this.determineTargetAxis(x, zones);
        
        if (targetAxis && this.state.currentPlot?.layout?.[targetAxis.id]) {
            e.preventDefault();
            
            const currentRange = this.state.currentPlot.layout[targetAxis.id].range || 
                                this.state.currentPlot.layout[targetAxis.id].autorange;
            
            if (currentRange && currentRange !== true) {
                const center = (currentRange[1] + currentRange[0]) / 2;
                const span = currentRange[1] - currentRange[0];
                const zoomFactor = e.deltaY > 0 ? 1.25 : 0.8;
                const newSpan = span * zoomFactor;
                const newRange = [center - newSpan/2, center + newSpan/2];
                
                const update = {};
                update[targetAxis.id + '.range'] = newRange;
                Plotly.relayout(this.state.currentPlot, update);
            }
        }
    }
    
    /**
     * Calculate axis zones - EXACT JS COPY
     */
    calculateAxisZones(plotWidth) {
        return {
            voltage: { start: plotWidth * 0.10, end: plotWidth * 0.15, id: 'yaxis', name: 'Voltage' },
            current: { start: plotWidth * 0.15, end: plotWidth * 0.20, id: 'yaxis2', name: 'Current' },
            pressure: { start: plotWidth * 0.20, end: plotWidth * 0.25, id: 'yaxis3', name: 'Pressure' }
        };
    }
    
    /**
     * Determine target axis from mouse position
     */
    determineTargetAxis(mouseX, zones) {
        for (const [key, zone] of Object.entries(zones)) {
            if (zone && mouseX >= zone.start && mouseX < zone.end) {
                return zone;
            }
        }
        return null;
    }
    
    /**
     * Capture current visibility state - EXACT JS COPY
     */
    captureCurrentVisibility() {
        const visibilityState = {};
        
        if (this.state.currentPlot?.data) {
            this.state.currentPlot.data.forEach((trace, index) => {
                if (trace.name) {
                    visibilityState[trace.name] = trace.visible !== false && trace.visible !== 'legendonly';
                }
            });
        }
        
        this.state.currentVisibilityState = visibilityState;
        return visibilityState;
    }
    
    /**
     * Restore visibility state - EXACT JS COPY
     */
    restoreVisibilityState(traces, savedVisibilityState) {
        if (!savedVisibilityState || Object.keys(savedVisibilityState).length === 0) {
            return;
        }
        
        traces.forEach(trace => {
            if (trace.name && savedVisibilityState.hasOwnProperty(trace.name)) {
                const wasVisible = savedVisibilityState[trace.name];
                trace.visible = wasVisible ? true : 'legendonly';
            }
        });
    }
    
    /**
     * Handle visibility changes from legend
     */
    handleVisibilityEvent(eventData) {
        if (eventData && eventData[0] && eventData[0].hasOwnProperty('visible')) {
            // Update visibility state after a delay
            setTimeout(() => {
                this.captureCurrentVisibility();
            }, 100);
        }
    }
    
    /**
     * Handle channel toggle from controls
     */
    async handleChannelToggle(event) {
        if (event.target.type !== 'checkbox') return;
        
        const channel = parseInt(event.target.dataset.channel);
        if (isNaN(channel)) return;
        
        if (event.target.checked) {
            if (!this.state.visibleChannels.includes(channel)) {
                this.state.visibleChannels.push(channel);
            }
        } else {
            const index = this.state.visibleChannels.indexOf(channel);
            if (index > -1) {
                this.state.visibleChannels.splice(index, 1);
            }
        }
        
        await this.reloadPlotWithChannels();
    }
    
    /**
     * Toggle all channels
     */
    async toggleAllChannels() {
        if (this.state.visibleChannels.length === 8) {
            this.state.visibleChannels = [];
        } else {
            this.state.visibleChannels = [0, 1, 2, 3, 4, 5, 6, 7];
        }
        
        // Update checkboxes
        const checkboxes = this.elements.channelControls?.querySelectorAll('input[type="checkbox"]');
        checkboxes?.forEach(cb => {
            const channel = parseInt(cb.dataset.channel);
            cb.checked = this.state.visibleChannels.includes(channel);
        });
        
        await this.reloadPlotWithChannels();
    }
    
    /**
     * Reload plot with current channel selection
     */
    async reloadPlotWithChannels() {
        if (!this.state.isLoaded) return;
        
        if (this.state.visibleChannels.length === 0) {
            if (this.state.plotlyInitialized) {
                await Plotly.purge(this.elements.plotContainer);
                this.state.plotlyInitialized = false;
            }
            return;
        }
        
        try {
            this.showLoading();
            
            const startTime = this.state.currentTimeRange.start;
            const endTime = this.state.currentTimeRange.end;
            
            // Determine points based on zoom (like performZoomResample)
            const zoomRange = endTime - startTime;
            const fullRange = this.state.metadata.duration;
            const isZoomed = zoomRange < fullRange * 0.9;
            
            // Use 3000 points if zoomed, otherwise default
            const maxPoints = isZoomed ? 3000 : this.config.maxPointsDefault;
            
            const result = await this.buildAllTraces(startTime, endTime, maxPoints);
            
            if (this.state.plotlyInitialized) {
                await Plotly.react(this.state.currentPlot, result.traces, this.state.currentPlot.layout);
            } else {
                const layout = this.createPlotLayout();
                await this.createPlot(result.traces, layout);
            }
            
            this.hideLoading();
            this.updateStatusInfo();
            
        } catch (error) {
            console.error('Error reloading plot:', error);
            this.showError('Failed to reload plot data');
        }
    }
    
    /**
     * Reset zoom to full view - EXACT JS COPY
     */
    resetZoom() {
        if (!this.state.metadata || !this.state.plotlyInitialized) return;
        
        const update = {
            'xaxis.range': [0, this.state.metadata.duration]
        };
        
        Plotly.relayout(this.state.currentPlot, update);
        
        // Update tracked range
        this.state.currentTimeRange = { start: 0, end: this.state.metadata.duration };
    }
    
    /**
     * Reset Y-axes to auto-range
     */
    resetYAxes() {
        if (!this.state.plotlyInitialized) return;
        
        const update = {
            'yaxis.autorange': true,
            'yaxis2.autorange': true,
            'yaxis3.autorange': true
        };
        
        Plotly.relayout(this.state.currentPlot, update);
    }
    
    /**
     * Get Y-axis for unit - matching JS
     */
    getYAxisForUnit(unit) {
        switch (unit) {
            case 'V': return 'y';
            case 'A': return 'y2';
            case 'Bar': return 'y3';
            default: return 'y';
        }
    }
    
    /**
     * Update status information
     */
    updateStatusInfo() {
        if (!this.elements.statusInfo) return;
        
        const timeRange = `${this.state.currentTimeRange.start.toFixed(2)}s - ${this.state.currentTimeRange.end.toFixed(2)}s`;
        
        this.elements.statusInfo.textContent = 
            `${this.state.visibleChannels.length} channels, ${timeRange}`;
    }
    
    // UI State management
    showLoading() {
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.remove('hidden');
        }
        if (this.elements.plotContainer) {
            this.elements.plotContainer.classList.add('hidden');
        }
        this.hideError();
    }
    
    hideLoading() {
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.add('hidden');
        }
        if (this.elements.plotContainer) {
            this.elements.plotContainer.classList.remove('hidden');
        }
    }
    
    showError(message) {
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.remove('hidden');
            const errorText = this.elements.errorMessage.querySelector('.error-text');
            if (errorText) {
                errorText.textContent = message;
            }
        }
        this.hideLoading();
        
        this.emit('error', {
            moduleName: 'bin-oscilloscope',
            message: message,
            recoverable: true
        });
    }
    
    hideError() {
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.add('hidden');
        }
    }
    
    show() {
        this.state.isVisible = true;
        const container = document.getElementById(this.containerId);
        if (container) {
            container.classList.remove('hidden');
        }
    }
    
    hide() {
        this.state.isVisible = false;
        const container = document.getElementById(this.containerId);
        if (container) {
            container.classList.add('hidden');
        }
    }
    
    onError(error) {
        this.state.error = error;
        this.showError(error.message);
    }
    
    /**
     * Emit events for inter-module communication
     */
    emit(eventName, data) {
        const fullEventName = `module:bin-oscilloscope:${eventName}`;
        const event = new CustomEvent(fullEventName, {
            detail: data,
            bubbles: true
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Get current state (for debugging)
     */
    getState() {
        return {
            ...this.state,
            config: this.config,
            hasPlot: this.state.plotlyInitialized,
            cacheSize: this.state.cachedData.size
        };
    }
    
    /**
     * Clean up resources
     */
    destroy() {
        // Remove event listeners
        if (this.elements.plotContainer) {
            this.elements.plotContainer.removeEventListener('wheel', this.handleWheelZoom);
        }
        
        // Clean up plot
        if (this.state.plotlyInitialized && this.elements.plotContainer) {
            try {
                Plotly.purge(this.elements.plotContainer);
            } catch (error) {
                console.warn('Error purging plot:', error);
            }
        }
        
        // Clear timeouts
        if (this.state.zoomTimeout) {
            clearTimeout(this.state.zoomTimeout);
        }
        
        // Clear cache
        this.state.cachedData.clear();
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        console.log('BinOscilloscope destroyed');
    }
}

// Export for global access
window.BinOscilloscope = BinOscilloscope;