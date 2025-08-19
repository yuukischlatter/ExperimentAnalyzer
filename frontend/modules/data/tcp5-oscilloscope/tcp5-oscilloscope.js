/**
 * TCP5 Oscilloscope Module
 * Displays TCP5/HDF5 oscilloscope data with multi-axis plotting and custom Y-axis scrolling
 * Integrates with progressive HDF5 reader for optimal performance
 * Supports all 6 channels with dynamic discovery and coordinated bulk loading
 * UPDATED: Added cleanup and abort functionality
 */

class Tcp5Oscilloscope {
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
            isPlotReady: false,
            availableChannels: [],
            defaultChannels: []
        };
        this.elements = {};
        this.plot = null;
        
        // Y-axis hover zones for custom scrolling (3+ axes)
        this.axisHoverZones = [];
        this.isAxisHovering = false;
        this.currentAxis = null;
        
        // NEW: Request management
        this.abortController = null;
        this.isLoading = false;
        
        // Event handler binding for proper cleanup
        this.boundEventHandlers = {};
        
        console.log('Tcp5Oscilloscope initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            maxPoints: 20000,
            plotHeight: 600,
            enableAxisScrolling: true,
            
            // 6-channel color scheme for TCP5
            colors: {
                ch1: '#DC3232',    // Red - U_L1L2
                ch2: '#003278',    // Blue - U_L2L3  
                ch3: '#9B59B6',    // Purple - U_Diode
                ch4: '#FF9800',    // Orange - U_ElektrodeUnten
                ch5: '#4CAF50',    // Green - RegV_StellsignalUE
                ch6: '#E91E63'     // Pink - RegV_SchieberMonitor
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
            console.log('Tcp5Oscilloscope initialized successfully');
            
        } catch (error) {
            console.error('Tcp5Oscilloscope initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'Tcp5OscilloscopeTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/data/tcp5-oscilloscope/tcp5-oscilloscope.html');
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
        console.log('Tcp5Oscilloscope: Ongoing requests aborted');
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
        this.state.availableChannels = [];
        this.state.defaultChannels = [];
        
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
        
        console.log('Tcp5Oscilloscope: Cleanup completed');
    }
    
    /**
     * Load experiment data (Standard module interface) - MODIFIED: Added abort controller support
     * @param {string} experimentId - Experiment ID
     */
    async loadExperiment(experimentId) {
        try {
            // Prevent overlapping loads
            if (this.isLoading) {
                console.log('Already loading TCP5 oscilloscope data, aborting previous request...');
                this.abort();
            }
            
            // Create new abort controller
            this.abortController = new AbortController();
            this.isLoading = true;
            
            console.log(`Loading TCP5 data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId}`;
            }
            
            // Load metadata first to discover available channels
            await this.loadMetadata();
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Load all available channels data
            await this.loadAllChannelsData();
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Create the plot
            await this.createPlot();
            
            this.state.isLoaded = true;
            this.isLoading = false;
            this.hideLoading();
            
            console.log(`TCP5 data loaded successfully for ${experimentId}`);
            
        } catch (error) {
            this.isLoading = false;
            
            // Don't show errors for aborted requests
            if (error.name === 'AbortError') {
                console.log('TCP5 oscilloscope loading was aborted');
                return;
            }
            
            console.error(`Failed to load TCP5 experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Load HDF5/TCP5 file metadata and discover available channels - MODIFIED: Added abort signal support
     */
    async loadMetadata() {
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/hdf5-metadata`,
                { signal: this.abortController.signal }
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('TCP5/HDF5 file not found for this experiment');
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
            
            // Extract available channels dynamically
            this.state.availableChannels = result.data.channels.available.hdf5 || [];
            this.state.defaultChannels = this.state.availableChannels.map(ch => ch.id);
            
            console.log('TCP5 Metadata loaded:', {
                duration: result.data.duration,
                channels: this.state.availableChannels.length,
                channelIds: this.state.defaultChannels
            });
            
        } catch (error) {
            throw new Error(`Metadata loading failed: ${error.message}`);
        }
    }
    
    /**
     * Load all available channels data using coordinated bulk loading - MODIFIED: Added abort signal support
     */
    async loadAllChannelsData() {
        try {
            if (this.state.defaultChannels.length === 0) {
                throw new Error('No TCP5 channels found in metadata');
            }
            
            console.log(`Loading ${this.state.defaultChannels.length} TCP5 channels:`, this.state.defaultChannels);
            
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/hdf5-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: this.state.defaultChannels,
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
            
            console.log(`Loaded ${result.data.successfulChannels} TCP5 channels successfully`);
            if (result.data.coordinatedLoading) {
                console.log(`Used coordinated dataset: ${result.data.selectedDataset}`);
            }
            
        } catch (error) {
            throw new Error(`Channel data loading failed: ${error.message}`);
        }
    }
    
    /**
     * Create Plotly oscilloscope plot with multi-axis support for all channels
     */
    async createPlot() {
        if (!this.elements.oscilloscopePlot || !this.state.plotData) {
            throw new Error('Missing plot container or data');
        }
        
        try {
            // Build plot traces for all available channels
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
            
            console.log('TCP5 oscilloscope plot created successfully');
            
        } catch (error) {
            throw new Error(`Plot creation failed: ${error.message}`);
        }
    }
    
    /**
     * Build Plotly traces from all channel data with dynamic mapping
     */
    buildPlotTraces() {
        const traces = [];
        
        // Dynamic channel configuration based on actual channel data
        const channelConfigs = this.buildChannelConfigurations();
        
        // Build traces for each available channel
        for (const [channelId, config] of Object.entries(channelConfigs)) {
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
                        'Value: %{y:.3f}<br>' +
                        '<extra></extra>'
                });
            }
        }
        
        return traces;
    }
    
    /**
     * Build channel configurations dynamically based on available channels
     */
    buildChannelConfigurations() {
        const configs = {};
        const colors = Object.values(this.config.colors);
        
        // Group channels by logical function for Y-axis assignment
        this.state.availableChannels.forEach((channel, index) => {
            const channelId = channel.id;
            const channelName = channel.label || channel.name || `Channel ${channelId}`;
            const channelUnit = channel.unit || 'V';
            
            // Determine Y-axis assignment based on channel name/type
            let yaxis = 'y';  // Default to left axis
            
            // Main voltage measurements (U_L1L2, U_L2L3) → Left Y-axis
            if (channelName.includes('U_L1L2') || channelName.includes('U_L2L3')) {
                yaxis = 'y';
            }
            // Component voltages (Diode, Electrode) → Right Y-axis 1
            else if (channelName.includes('Diode') || channelName.includes('Elektrode')) {
                yaxis = 'y2';
            }
            // Control/regulation signals → Right Y-axis 2
            else if (channelName.includes('RegV') || channelName.includes('Stellsignal') || channelName.includes('Monitor')) {
                yaxis = 'y3';
            }
            // Additional channels → Cycle through available axes
            else {
                const axisIndex = index % 3;
                yaxis = axisIndex === 0 ? 'y' : axisIndex === 1 ? 'y2' : 'y3';
            }
            
            configs[channelId] = {
                name: this.shortenChannelName(channelName),
                unit: channelUnit,
                color: colors[index % colors.length],
                yaxis: yaxis
            };
        });
        
        return configs;
    }
    
    /**
     * Shorten channel names for display
     */
    shortenChannelName(fullName) {
        // Extract meaningful short names from full channel names
        if (fullName.includes('U_L1L2')) return 'U_L1L2';
        if (fullName.includes('U_L2L3')) return 'U_L2L3';
        if (fullName.includes('Diode')) return 'U_Diode';
        if (fullName.includes('Elektrode')) return 'U_Electrode';
        if (fullName.includes('StellsignalUE')) return 'RegV_Control';
        if (fullName.includes('SchieberMonitor')) return 'RegV_Monitor';
        
        // Fallback: use first part or shorten long names
        const parts = fullName.split(/[\s\(\)]/);
        return parts[0].length > 15 ? parts[0].substring(0, 15) + '...' : parts[0];
    }
    
    /**
     * Create Plotly layout with multi-axis setup for 3+ Y-axes
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
                domain: [0.08, 0.82],  // More space for multiple Y-axes
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)',
                range: [this.state.currentTimeRange.min, this.state.currentTimeRange.max]
            },
            
            // Left Y-axis (Main voltage measurements)
            yaxis: {
                title: { text: 'Main Voltage [V]', font: { color: this.config.colors.ch1 }},
                side: 'left',
                position: 0.0,
                showgrid: true,
                gridcolor: 'rgba(220, 50, 50, 0.2)',
                tickfont: { color: this.config.colors.ch1 },
                titlefont: { color: this.config.colors.ch1 }
            },
            
            // Right Y-axis 1 (Component voltages)
            yaxis2: {
                title: { text: 'Component Voltage [V]', font: { color: this.config.colors.ch3 }},
                side: 'right',
                position: 1.0,
                overlaying: 'y',
                showgrid: false,
                tickfont: { color: this.config.colors.ch3 },
                titlefont: { color: this.config.colors.ch3 }
            },
            
            // Right Y-axis 2 (Control signals)  
            yaxis3: {
                title: { text: 'Control Signals [V]', font: { color: this.config.colors.ch5 }},
                side: 'right',
                position: 0.90,
                overlaying: 'y',
                anchor: 'free',
                showgrid: false,
                tickfont: { color: this.config.colors.ch5 },
                titlefont: { color: this.config.colors.ch5 }
            },
            
            legend: {
                x: 0.84,
                y: 1,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0,0,0,0.3)',
                borderwidth: 1,
                font: { size: 11 }  // Smaller font for 6 channels
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 140, t: 30, b: 60 },  // More right margin for 3 Y-axes
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
                filename: `tcp5_oscilloscope_${this.state.experimentId}`,
                height: 600,
                width: 1200,  // Wider for multi-axis plot
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
     * Handle plot zoom/pan events with progressive dataset selection
     */
    async handlePlotRelayout(eventData) {
        // Check if this is a time range change
        if (eventData['xaxis.range[0]'] !== undefined && eventData['xaxis.range[1]'] !== undefined) {
            const newStartTime = eventData['xaxis.range[0]'];
            const newEndTime = eventData['xaxis.range[1]'];
            
            console.log(`TCP5 time range changed: ${newStartTime.toFixed(2)}s - ${newEndTime.toFixed(2)}s`);
            
            // Update current time range
            this.state.currentTimeRange = {
                min: newStartTime,
                max: newEndTime
            };
            
            // Resample data for new time range using HDF5 progressive loading
            await this.resampleDataForTimeRange(newStartTime, newEndTime);
        }
    }
    
    /**
     * Resample data for new time range using HDF5 coordinated bulk loading - MODIFIED: Added abort signal support
     */
    async resampleDataForTimeRange(startTime, endTime) {
        try {
            // Determine appropriate maxPoints based on zoom level
            const timespan = endTime - startTime;
            const totalDuration = this.state.metadata.timeRange.max - this.state.metadata.timeRange.min;
            const zoomFactor = totalDuration / timespan;
            const maxPoints = Math.min(50000, Math.max(20000, Math.floor(50000 * Math.sqrt(zoomFactor))));
            
            console.log(`TCP5 resampling: zoom ${zoomFactor.toFixed(1)}x, ${maxPoints} points`);
            
            // Create abort controller for resampling request
            const resampleAbortController = new AbortController();
            
            // Load data for new time range using coordinated bulk loading
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/hdf5-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: this.state.defaultChannels,
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
                    
                    if (result.data.coordinatedLoading) {
                        console.log(`TCP5 coordinated resampling used dataset: ${result.data.selectedDataset}`);
                    }
                }
            }
            
        } catch (error) {
            // Don't log abort errors
            if (error.name === 'AbortError') {
                console.log('TCP5 resampling was aborted');
                return;
            }
            
            console.error('Error resampling TCP5 data:', error);
        }
    }
    
    /**
     * Build traces from new data (helper for resampling)
     */
    buildPlotTracesFromData(channelData) {
        const traces = [];
        const channelConfigs = this.buildChannelConfigurations();
        
        for (const [channelId, config] of Object.entries(channelConfigs)) {
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
     * Setup custom Y-axis scrolling for 3+ axes
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
     * Handle mouse hover to detect Y-axis areas (3+ axes)
     */
    handleAxisHover(event) {
        if (!this.state.isPlotReady) return;
        
        const rect = this.elements.oscilloscopePlot.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Define hover zones for 3 Y-axes
        const leftZone = x < 80;  // Left Y-axis (Main voltage)
        const rightZone1 = x > rect.width - 140 && x < rect.width - 70;  // Right Y-axis 1 (Components)
        const rightZone2 = x > rect.width - 70;  // Right Y-axis 2 (Control)
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
        const message = error.message || 'Failed to load TCP5 oscilloscope data';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'tcp5-oscilloscope',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:tcp5-oscilloscope:${eventName}`;
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
        
        console.log('Tcp5Oscilloscope destroyed');
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
window.Tcp5Oscilloscope = Tcp5Oscilloscope;