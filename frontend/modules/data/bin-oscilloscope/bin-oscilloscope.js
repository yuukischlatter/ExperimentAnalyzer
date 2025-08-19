/**
 * Binary Oscilloscope Module
 * Displays binary oscilloscope data with multi-axis plotting and custom Y-axis scrolling
 * Integrates with existing experiment system and design patterns
 * UPDATED: Added cleanup and abort functionality
 */

class BinOscilloscope {
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
            isPlotReady: false
        };
        this.elements = {};
        this.plot = null;
        
        // Y-axis hover zones for custom scrolling
        this.axisHoverZones = [];
        this.isAxisHovering = false;
        this.currentAxis = null;
        
        // NEW: Request management
        this.abortController = null;
        this.isLoading = false;
        
        // Event handler binding for proper cleanup
        this.boundEventHandlers = {};
        
        console.log('BinOscilloscope initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            maxPoints: 8000,
            plotHeight: 600,
            enableAxisScrolling: true,
            colors: {
                voltage: '#DC3232',    // Schlatter red
                current1: '#003278',   // Schlatter blue  
                current2: '#9B59B6',   // Purple
                force: '#FF9800'       // Orange
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
            console.log('BinOscilloscope initialized successfully');
            
        } catch (error) {
            console.error('BinOscilloscope initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'BinOscilloscopeTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/data/bin-oscilloscope/bin-oscilloscope.html');
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
            'oscilloscopePlot', 'loadingSpinner', 'errorMessage', 'plotContainer'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Setup custom Y-axis scrolling if enabled
        if (this.config.enableAxisScrolling && this.elements.oscilloscopePlot) {
            this.setupAxisScrolling();
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
        console.log('BinOscilloscope: Ongoing requests aborted');
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
        this.state.isPlotReady = false;
        this.state.currentTimeRange = { min: 0, max: 100 };
        
        // Reset axis hovering state
        this.isAxisHovering = false;
        this.currentAxis = null;
        
        // Clear plot
        if (this.plot && this.elements.oscilloscopePlot) {
            Plotly.purge(this.elements.oscilloscopePlot);
            this.plot = null;
        }
        
        // Clear UI
        this.hideError();
        this.hidePlot();
        this.hideLoading();
        
        console.log('BinOscilloscope: Cleanup completed');
    }
    
    /**
     * Load experiment data (Standard module interface) - MODIFIED: Added abort controller support
     * @param {string} experimentId - Experiment ID
     */
    async loadExperiment(experimentId) {
        try {
            // Prevent overlapping loads
            if (this.isLoading) {
                console.log('Already loading binary oscilloscope data, aborting previous request...');
                this.abort();
            }
            
            // Create new abort controller
            this.abortController = new AbortController();
            this.isLoading = true;
            
            console.log(`Loading binary data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId}`;
            }
            
            // Load metadata first
            await this.loadMetadata();
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Load default channels data
            await this.loadDefaultChannelsData();
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Create the plot
            await this.createPlot();
            
            this.state.isLoaded = true;
            this.isLoading = false;
            this.hideLoading();
            
            console.log(`Binary data loaded successfully for ${experimentId}`);
            
        } catch (error) {
            this.isLoading = false;
            
            // Don't show errors for aborted requests
            if (error.name === 'AbortError') {
                console.log('Binary oscilloscope loading was aborted');
                return;
            }
            
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Load binary file metadata - MODIFIED: Added abort signal support
     */
    async loadMetadata() {
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/bin-metadata`,
                { signal: this.abortController.signal }
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Binary file not found for this experiment');
                }
                throw new Error(`Failed to load metadata: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load metadata');
            }
            
            this.state.metadata = result.data;
            this.state.currentTimeRange = {
                min: result.data.timeRange.min,
                max: result.data.timeRange.max
            };
            
            console.log('Metadata loaded:', {
                duration: result.data.duration,
                channels: result.data.channels.available.calculated.length
            });
            
        } catch (error) {
            throw new Error(`Metadata loading failed: ${error.message}`);
        }
    }
    
    /**
     * Load default engineering channels data - MODIFIED: Added abort signal support
     */
    async loadDefaultChannelsData() {
        try {
            // Load the 4 key engineering channels
            const defaultChannels = ['calc_3', 'calc_4', 'calc_5', 'calc_6'];
            
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/bin-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: defaultChannels,
                        startTime: this.state.currentTimeRange.min,
                        endTime: this.state.currentTimeRange.max,
                        maxPoints: this.config.maxPoints
                    }),
                    signal: this.abortController.signal
                }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to load channel data: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load channel data');
            }
            
            this.state.plotData = result.data.channels;
            
            console.log(`Loaded ${result.data.successfulChannels} channels successfully`);
            
        } catch (error) {
            throw new Error(`Channel data loading failed: ${error.message}`);
        }
    }
    
    /**
     * Create Plotly oscilloscope plot
     */
    async createPlot() {
        if (!this.elements.oscilloscopePlot || !this.state.plotData) {
            throw new Error('Missing plot container or data');
        }
        
        try {
            // Build plot traces
            const traces = this.buildPlotTraces();
            const layout = this.createPlotLayout();
            const config = this.createPlotConfig();
            
            // Create the plot
            this.plot = await Plotly.newPlot(
                this.elements.oscilloscopePlot, 
                traces, 
                layout, 
                config
            );
            
            // Setup plot event handlers
            this.attachPlotEvents();
            
            // Setup custom axis hover zones
            this.createAxisHoverZones();
            
            this.state.isPlotReady = true;
            this.showPlot();
            
            console.log('Oscilloscope plot created successfully');
            
        } catch (error) {
            throw new Error(`Plot creation failed: ${error.message}`);
        }
    }
    
    /**
     * Build Plotly traces from channel data
     */
    buildPlotTraces() {
        const traces = [];
        
        // Channel configuration with colors and axes
        const channelConfig = {
            'calc_5': { name: 'U_DC*', unit: 'V', color: this.config.colors.voltage, yaxis: 'y' },
            'calc_3': { name: 'I_DC_GR1*', unit: 'A', color: this.config.colors.current1, yaxis: 'y2' },
            'calc_4': { name: 'I_DC_GR2*', unit: 'A', color: this.config.colors.current2, yaxis: 'y2' },
            'calc_6': { name: 'F_Schlitten*', unit: 'kN', color: this.config.colors.force, yaxis: 'y3' }
        };
        
        // Build traces for each channel
        for (const [channelId, config] of Object.entries(channelConfig)) {
            const channelData = this.state.plotData[channelId];
            
            if (channelData && channelData.success) {
                traces.push({
                    x: channelData.data.time,
                    y: channelData.data.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${config.name} [${config.unit}]`,
                    line: { 
                        color: config.color,
                        width: 2
                    },
                    yaxis: config.yaxis,
                    hovertemplate: 
                        '<b>%{fullData.name}</b><br>' +
                        'Time: %{x:.3f} s<br>' +
                        'Value: %{y:.3f} %{fullData.name}<br>' +
                        '<extra></extra>'
                });
            }
        }
        
        return traces;
    }
    
    /**
     * Create Plotly layout with multi-axis setup
     */
    createPlotLayout() {
        return {
            title: {
                text: '',  // No title - using module header instead
                font: { size: 0 }
            },
            
            // X-axis (time)
            xaxis: {
                title: 'Time [s]',
                domain: [0.08, 0.85],  // Leave space for Y-axes
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)',
                range: [this.state.currentTimeRange.min, this.state.currentTimeRange.max]
            },
            
            // Left Y-axis (Voltage)
            yaxis: {
                title: { text: 'Voltage [V]', font: { color: this.config.colors.voltage }},
                side: 'left',
                position: 0.0,
                showgrid: true,
                gridcolor: 'rgba(220, 50, 50, 0.2)',
                tickfont: { color: this.config.colors.voltage },
                titlefont: { color: this.config.colors.voltage }
            },
            
            // Right Y-axis 1 (Current)
            yaxis2: {
                title: { text: 'Current [A]', font: { color: this.config.colors.current1 }},
                side: 'right',
                position: 1.0,
                overlaying: 'y',
                showgrid: false,
                tickfont: { color: this.config.colors.current1 },
                titlefont: { color: this.config.colors.current1 }
            },
            
            // Right Y-axis 2 (Force)  
            yaxis3: {
                title: { text: 'Force [kN]', font: { color: this.config.colors.force }},
                side: 'right',
                position: 0.93,
                overlaying: 'y',
                anchor: 'free',
                showgrid: false,
                tickfont: { color: this.config.colors.force },
                titlefont: { color: this.config.colors.force }
            },
            
            legend: {
                x: 0.87,
                y: 1,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0,0,0,0.3)',
                borderwidth: 1,
                font: { size: 12 }
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 120, t: 30, b: 60 },
            plot_bgcolor: 'rgba(248,249,250,0.3)',
            paper_bgcolor: '#ffffff',
            autosize: true,
            showlegend: true
        };
    }
    
    /**
     * Create Plotly configuration
     */
    createPlotConfig() {
        return {
            responsive: true,
            displayModeBar: true,
            scrollZoom: false,  // Disable default scroll zoom for custom axis scrolling
            displaylogo: false,
            modeBarButtonsToRemove: [],
            toImageButtonOptions: {
                format: 'png',
                filename: `oscilloscope_${this.state.experimentId}`,
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
        if (!this.elements.oscilloscopePlot) return;
        
        // Handle zoom/pan events for dynamic resampling
        this.elements.oscilloscopePlot.on('plotly_relayout', (eventData) => {
            this.handlePlotRelayout(eventData);
        });
        
        // Handle double-click to reset
        this.elements.oscilloscopePlot.on('plotly_doubleclick', () => {
            this.resetZoom();
        });
    }
    
    /**
     * Handle plot zoom/pan events
     */
    async handlePlotRelayout(eventData) {
        // Check if this is a time range change
        if (eventData['xaxis.range[0]'] !== undefined && eventData['xaxis.range[1]'] !== undefined) {
            const newStartTime = eventData['xaxis.range[0]'];
            const newEndTime = eventData['xaxis.range[1]'];
            
            console.log(`Time range changed: ${newStartTime.toFixed(2)}s - ${newEndTime.toFixed(2)}s`);
            
            // Update current time range
            this.state.currentTimeRange = {
                min: newStartTime,
                max: newEndTime
            };
            
            // Resample data for new time range
            await this.resampleDataForTimeRange(newStartTime, newEndTime);
        }
    }
    
    /**
     * Resample data for new time range - MODIFIED: Added abort signal support
     */
    async resampleDataForTimeRange(startTime, endTime) {
        try {
            // Determine appropriate maxPoints based on zoom level
            const timespan = endTime - startTime;
            const totalDuration = this.state.metadata.timeRange.max - this.state.metadata.timeRange.min;
            const zoomFactor = totalDuration / timespan;
            const maxPoints = Math.min(5000, Math.max(2000, Math.floor(3000 * Math.sqrt(zoomFactor))));
            
            // Create abort controller for resampling request
            const resampleAbortController = new AbortController();
            
            // Load data for new time range
            const defaultChannels = ['calc_3', 'calc_4', 'calc_5', 'calc_6'];
            
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/bin-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: defaultChannels,
                        startTime: startTime,
                        endTime: endTime,
                        maxPoints: maxPoints
                    }),
                    signal: resampleAbortController.signal
                }
            );
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    // Update plot data
                    const newTraces = this.buildPlotTracesFromData(result.data.channels);
                    await Plotly.react(this.elements.oscilloscopePlot, newTraces, this.plot.layout);
                }
            }
            
        } catch (error) {
            // Don't log abort errors
            if (error.name === 'AbortError') {
                console.log('Binary oscilloscope resampling was aborted');
                return;
            }
            
            console.error('Error resampling data:', error);
        }
    }
    
    /**
     * Build traces from new data (helper for resampling)
     */
    buildPlotTracesFromData(channelData) {
        const traces = [];
        const channelConfig = {
            'calc_5': { name: 'U_DC*', unit: 'V', color: this.config.colors.voltage, yaxis: 'y' },
            'calc_3': { name: 'I_DC_GR1*', unit: 'A', color: this.config.colors.current1, yaxis: 'y2' },
            'calc_4': { name: 'I_DC_GR2*', unit: 'A', color: this.config.colors.current2, yaxis: 'y2' },
            'calc_6': { name: 'F_Schlitten*', unit: 'kN', color: this.config.colors.force, yaxis: 'y3' }
        };
        
        for (const [channelId, config] of Object.entries(channelConfig)) {
            const data = channelData[channelId];
            if (data && data.success) {
                traces.push({
                    x: data.data.time,
                    y: data.data.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${config.name} [${config.unit}]`,
                    line: { color: config.color, width: 2 },
                    yaxis: config.yaxis,
                    hovertemplate: 
                        '<b>%{fullData.name}</b><br>' +
                        'Time: %{x:.3f} s<br>' +
                        'Value: %{y:.3f}<br>' +
                        '<extra></extra>'
                });
            }
        }
        
        return traces;
    }
    
    /**
     * Setup custom Y-axis scrolling
     */
    setupAxisScrolling() {
        if (!this.elements.oscilloscopePlot) return;
        
        // Store bound event handlers for proper cleanup
        this.boundEventHandlers.axisWheel = (event) => this.handleAxisWheel(event);
        this.boundEventHandlers.axisHover = (event) => this.handleAxisHover(event);
        
        // Add mouse wheel event listener to plot container
        this.elements.oscilloscopePlot.addEventListener('wheel', this.boundEventHandlers.axisWheel, { passive: false });
        
        // Add mouse move event to track axis hovering
        this.elements.oscilloscopePlot.addEventListener('mousemove', this.boundEventHandlers.axisHover);
    }
    
    /**
     * Handle mouse wheel events for Y-axis scaling
     */
    handleAxisWheel(event) {
        if (!this.state.isPlotReady || !this.isAxisHovering) return;
        
        event.preventDefault();
        
        const deltaY = event.deltaY;
        const zoomFactor = deltaY > 0 ? 1.1 : 0.9;  // Zoom out/in
        
        this.zoomAxis(this.currentAxis, zoomFactor);
    }
    
    /**
     * Handle mouse hover to detect Y-axis areas
     */
    handleAxisHover(event) {
        if (!this.state.isPlotReady) return;
        
        const rect = this.elements.oscilloscopePlot.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Define hover zones
        const leftZone = x < 80;  // Left Y-axis (Voltage)
        const rightZone1 = x > rect.width - 120 && x < rect.width - 40;  // Right Y-axis 1 (Current)
        const rightZone2 = x > rect.width - 40;  // Right Y-axis 2 (Force)
        const validYZone = y > 30 && y < rect.height - 60;  // Valid Y range
        
        let newAxis = null;
        if (validYZone) {
            if (leftZone) newAxis = 'yaxis';
            else if (rightZone2) newAxis = 'yaxis3';
            else if (rightZone1) newAxis = 'yaxis2';
        }
        
        // Update hovering state
        this.isAxisHovering = newAxis !== null;
        this.currentAxis = newAxis;
        
        // Update cursor
        this.elements.oscilloscopePlot.style.cursor = 
            this.isAxisHovering ? 'ns-resize' : 'default';
    }
    
    /**
     * Zoom specific Y-axis
     */
    zoomAxis(axisName, zoomFactor) {
        if (!axisName || !this.plot || !this.plot.layout) return;
        
        const axis = this.plot.layout[axisName];
        if (!axis || !axis.range) return;
        
        const currentRange = axis.range;
        const center = (currentRange[0] + currentRange[1]) / 2;
        const currentSpan = currentRange[1] - currentRange[0];
        const newSpan = currentSpan * zoomFactor;
        
        const newRange = [
            center - newSpan / 2,
            center + newSpan / 2
        ];
        
        // Update the axis
        const update = {};
        update[`${axisName}.range`] = newRange;
        
        Plotly.relayout(this.elements.oscilloscopePlot, update);
    }
    
    /**
     * Create visual hover zones for axes
     */
    createAxisHoverZones() {
        // This is handled by mouse move events rather than visual zones
        // Visual zones can be added later if needed for user guidance
    }
    
    /**
     * Reset zoom to full data range
     */
    resetZoom() {
        if (!this.state.metadata) return;
        
        const update = {
            'xaxis.range': [this.state.metadata.timeRange.min, this.state.metadata.timeRange.max],
            'yaxis.range': null,
            'yaxis2.range': null,
            'yaxis3.range': null
        };
        
        Plotly.relayout(this.elements.oscilloscopePlot, update);
    }
    
    // === STATE MANAGEMENT ===
    
    showLoading() {
        this.hideError();
        this.hidePlot();
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
        this.hidePlot();
        
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
    
    showPlot() {
        this.hideLoading();
        this.hideError();
        
        if (this.elements.plotContainer) {
            this.elements.plotContainer.classList.remove('hidden');
        }
    }
    
    hidePlot() {
        if (this.elements.plotContainer) {
            this.elements.plotContainer.classList.add('hidden');
        }
    }
    
    onError(error) {
        const message = error.message || 'Failed to load oscilloscope data';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'bin-oscilloscope',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:bin-oscilloscope:${eventName}`;
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
     * Destroy module - MODIFIED: Enhanced cleanup with proper event listener removal
     */
    destroy() {
        // Abort any ongoing requests
        this.abort();
        
        // Clean up Plotly plot
        if (this.plot && this.elements.oscilloscopePlot) {
            Plotly.purge(this.elements.oscilloscopePlot);
        }
        
        // Remove event listeners
        if (this.elements.oscilloscopePlot) {
            if (this.boundEventHandlers.axisWheel) {
                this.elements.oscilloscopePlot.removeEventListener('wheel', this.boundEventHandlers.axisWheel);
            }
            if (this.boundEventHandlers.axisHover) {
                this.elements.oscilloscopePlot.removeEventListener('mousemove', this.boundEventHandlers.axisHover);
            }
        }
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        // Clear state
        this.state = {};
        this.elements = {};
        this.plot = null;
        this.boundEventHandlers = {};
        
        console.log('BinOscilloscope destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config,
            isLoading: this.isLoading
        };
    }
}

// Export for global access
window.BinOscilloscope = BinOscilloscope;