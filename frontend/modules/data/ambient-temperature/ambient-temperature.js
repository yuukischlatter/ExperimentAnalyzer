/**
 * Ambient Temperature Module
 * Displays temperature CSV data with single-axis plotting focused on temperature measurements
 * Integrates with existing experiment system and follows bin-oscilloscope patterns
 */

class AmbientTemperature {
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
        
        console.log('AmbientTemperature initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            maxPoints: 3000,
            plotHeight: 600,
            colors: {
                temp_welding: '#D84315',      // Deep orange-red - primary welding temperature
                temp_channel_1: '#FF5722',    // Orange-red
                temp_channel_2: '#FF6F00',    // Deep orange
                temp_channel_3: '#FF8F00',    // Amber
                temp_channel_4: '#FFA000',    // Orange
                temp_channel_5: '#FFB300',    // Light orange
                temp_channel_6: '#FFC107',    // Yellow-orange
                temp_channel_7: '#FFCA28',    // Light yellow-orange
                temp_channel_8: '#FFD54F'     // Pale yellow-orange
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
            console.log('AmbientTemperature initialized successfully');
            
        } catch (error) {
            console.error('AmbientTemperature initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'AmbientTemperatureTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/data/ambient-temperature/ambient-temperature.html');
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
            'temperaturePlot', 'loadingSpinner', 'errorMessage', 'plotContainer'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Temperature plots don't need custom axis scrolling like oscilloscope
        // Standard Plotly zoom/pan is sufficient for temperature data
    }
    
    /**
     * Load experiment data (Standard module interface)
     * @param {string} experimentId - Experiment ID
     */
    async loadExperiment(experimentId) {
        try {
            console.log(`Loading temperature data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId}`;
            }
            
            // Load metadata first
            await this.loadMetadata();
            
            // Load available temperature channels
            await this.loadTemperatureChannelsData();
            
            // Create the plot
            await this.createPlot();
            
            this.state.isLoaded = true;
            this.hideLoading();
            
            console.log(`Temperature data loaded successfully for ${experimentId}`);
            
        } catch (error) {
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Load temperature CSV metadata
     */
    async loadMetadata() {
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/temp-metadata`
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Temperature CSV file not found for this experiment');
                }
                throw new Error(`Failed to load temperature metadata: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load temperature metadata');
            }
            
            this.state.metadata = result.data;
            this.state.currentTimeRange = {
                min: result.data.timeRange.min,
                max: result.data.timeRange.max
            };
            
            console.log('Temperature metadata loaded:', {
                duration: result.data.duration,
                channels: result.data.channels.available.temperature.length
            });
            
        } catch (error) {
            throw new Error(`Temperature metadata loading failed: ${error.message}`);
        }
    }
    
    /**
     * Load available temperature channels data
     */
    async loadTemperatureChannelsData() {
        try {
            // Get available channels from metadata
            const availableChannels = this.state.metadata.channels.available.temperature.map(ch => ch.id);
            
            if (availableChannels.length === 0) {
                throw new Error('No temperature channels found in CSV file');
            }
            
            console.log(`Loading ${availableChannels.length} temperature channels:`, availableChannels);
            
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/temp-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: availableChannels,
                        startTime: this.state.currentTimeRange.min,
                        endTime: this.state.currentTimeRange.max,
                        maxPoints: this.config.maxPoints
                    })
                }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to load temperature channel data: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load temperature channel data');
            }
            
            this.state.plotData = result.data.channels;
            
            console.log(`Loaded ${result.data.successfulChannels} temperature channels successfully`);
            
        } catch (error) {
            throw new Error(`Temperature channel data loading failed: ${error.message}`);
        }
    }
    
    /**
     * Create Plotly temperature plot
     */
    async createPlot() {
        if (!this.elements.temperaturePlot || !this.state.plotData) {
            throw new Error('Missing plot container or temperature data');
        }
        
        try {
            // Build plot traces
            const traces = this.buildTemperaturePlotTraces();
            const layout = this.createTemperaturePlotLayout();
            const config = this.createPlotConfig();
            
            // Create the plot
            this.plot = await Plotly.newPlot(
                this.elements.temperaturePlot, 
                traces, 
                layout, 
                config
            );
            
            // Setup plot event handlers
            this.attachPlotEvents();
            
            this.state.isPlotReady = true;
            this.showPlot();
            
            console.log('Temperature plot created successfully');
            
        } catch (error) {
            throw new Error(`Temperature plot creation failed: ${error.message}`);
        }
    }
    
    /**
     * Build Plotly traces from temperature channel data
     */
    buildTemperaturePlotTraces() {
        const traces = [];
        
        // Process each temperature channel
        for (const [channelId, channelData] of Object.entries(this.state.plotData)) {
            if (channelData && channelData.success) {
                const color = this.config.colors[channelId] || '#FF6B35'; // Fallback warm color
                const channelMeta = channelData.metadata;
                
                traces.push({
                    x: channelData.data.time,
                    y: channelData.data.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${channelMeta.label || channelId} [°C]`,
                    line: { 
                        color: color,
                        width: 2
                    },
                    hovertemplate: 
                        '<b>%{fullData.name}</b><br>' +
                        'Time: %{x:.3f} s<br>' +
                        'Temperature: %{y:.1f} °C<br>' +
                        '<extra></extra>'
                });
            }
        }
        
        // Sort traces to put welding temperature first
        traces.sort((a, b) => {
            const aIsWelding = a.name.toLowerCase().includes('schweissen');
            const bIsWelding = b.name.toLowerCase().includes('schweissen');
            
            if (aIsWelding && !bIsWelding) return -1;
            if (!aIsWelding && bIsWelding) return 1;
            return a.name.localeCompare(b.name);
        });
        
        return traces;
    }
    
    /**
     * Create Plotly layout for temperature plot (single Y-axis)
     */
    createTemperaturePlotLayout() {
        return {
            title: {
                text: '',  // No title - using module header instead
                font: { size: 0 }
            },
            
            // X-axis (time)
            xaxis: {
                title: 'Time [s]',
                showgrid: true,
                gridcolor: 'rgba(255, 140, 0, 0.15)',  // Warm orange grid
                range: [this.state.currentTimeRange.min, this.state.currentTimeRange.max],
                tickfont: { color: '#666666' }
            },
            
            // Y-axis (temperature)
            yaxis: {
                title: { 
                    text: 'Temperature [°C]', 
                    font: { color: '#D84315', size: 14 }  // Warm red for temperature
                },
                showgrid: true,
                gridcolor: 'rgba(216, 67, 21, 0.15)',  // Warm grid color matching temperature theme
                tickfont: { color: '#D84315' },
                titlefont: { color: '#D84315' },
                zeroline: true,
                zerolinecolor: 'rgba(216, 67, 21, 0.3)'
            },
            
            legend: {
                x: 0.02,
                y: 0.98,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(216, 67, 21, 0.3)',
                borderwidth: 1,
                font: { size: 12 }
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(255, 248, 245, 0.3)',  // Very light warm background
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
            scrollZoom: true,  // Enable scroll zoom for temperature data
            displaylogo: false,
            modeBarButtonsToRemove: [],
            toImageButtonOptions: {
                format: 'png',
                filename: `temperature_${this.state.experimentId}`,
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
        if (!this.elements.temperaturePlot) return;
        
        // Handle zoom/pan events for dynamic resampling
        this.elements.temperaturePlot.on('plotly_relayout', (eventData) => {
            this.handlePlotRelayout(eventData);
        });
        
        // Handle double-click to reset
        this.elements.temperaturePlot.on('plotly_doubleclick', () => {
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
            
            console.log(`Temperature time range changed: ${newStartTime.toFixed(2)}s - ${newEndTime.toFixed(2)}s`);
            
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
     * Resample temperature data for new time range
     */
    async resampleDataForTimeRange(startTime, endTime) {
        try {
            // Determine appropriate maxPoints based on zoom level
            const timespan = endTime - startTime;
            const totalDuration = this.state.metadata.timeRange.max - this.state.metadata.timeRange.min;
            const zoomFactor = totalDuration / timespan;
            const maxPoints = Math.min(5000, Math.max(2000, Math.floor(3000 * Math.sqrt(zoomFactor))));
            
            // Get available channels
            const availableChannels = this.state.metadata.channels.available.temperature.map(ch => ch.id);
            
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/temp-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: availableChannels,
                        startTime: startTime,
                        endTime: endTime,
                        maxPoints: maxPoints
                    })
                }
            );
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    // Update plot data
                    const newTraces = this.buildTemperatureTracesFromData(result.data.channels);
                    await Plotly.react(this.elements.temperaturePlot, newTraces, this.plot.layout);
                }
            }
            
        } catch (error) {
            console.error('Error resampling temperature data:', error);
        }
    }
    
    /**
     * Build traces from new temperature data (helper for resampling)
     */
    buildTemperatureTracesFromData(channelData) {
        const traces = [];
        
        for (const [channelId, data] of Object.entries(channelData)) {
            if (data && data.success) {
                const color = this.config.colors[channelId] || '#FF6B35';
                const channelMeta = data.metadata;
                
                traces.push({
                    x: data.data.time,
                    y: data.data.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${channelMeta.label || channelId} [°C]`,
                    line: { color: color, width: 2 },
                    hovertemplate: 
                        '<b>%{fullData.name}</b><br>' +
                        'Time: %{x:.3f} s<br>' +
                        'Temperature: %{y:.1f} °C<br>' +
                        '<extra></extra>'
                });
            }
        }
        
        // Sort traces to put welding temperature first
        traces.sort((a, b) => {
            const aIsWelding = a.name.toLowerCase().includes('schweissen');
            const bIsWelding = b.name.toLowerCase().includes('schweissen');
            
            if (aIsWelding && !bIsWelding) return -1;
            if (!aIsWelding && bIsWelding) return 1;
            return a.name.localeCompare(b.name);
        });
        
        return traces;
    }
    
    /**
     * Reset zoom to full temperature data range
     */
    resetZoom() {
        if (!this.state.metadata) return;
        
        const update = {
            'xaxis.range': [this.state.metadata.timeRange.min, this.state.metadata.timeRange.max],
            'yaxis.range': null  // Auto-scale temperature range
        };
        
        Plotly.relayout(this.elements.temperaturePlot, update);
    }
    
    // === STATE MANAGEMENT (same as bin-oscilloscope) ===
    
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
        const message = error.message || 'Failed to load temperature data';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'ambient-temperature',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:ambient-temperature:${eventName}`;
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
    
    destroy() {
        // Clean up Plotly plot
        if (this.plot && this.elements.temperaturePlot) {
            Plotly.purge(this.elements.temperaturePlot);
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
        
        console.log('AmbientTemperature destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config
        };
    }
}

// Export for global access
window.AmbientTemperature = AmbientTemperature;