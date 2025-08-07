/**
 * Distance Sensor Module
 * Displays position CSV data with single-axis plotting focused on laser displacement measurements
 * Integrates with position CSV backend service and follows existing module patterns
 */

class DistanceSensor {
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
        
        console.log('DistanceSensor initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            maxPoints: 4000,  // Higher for interpolated 1ms data
            plotHeight: 600,
            colors: {
                pos_x: '#1976D2'  // Primary blue for position data
            },
            // Position-specific settings
            expectedUnits: 'mm',
            sensorType: 'optoNCDT-ILD1220',
            interpolationInterval: 1000  // 1ms in microseconds
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
            console.log('DistanceSensor initialized successfully');
            
        } catch (error) {
            console.error('DistanceSensor initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'DistanceSensorTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/data/distance-sensor/distance-sensor.html');
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
            'distancePlot', 'loadingSpinner', 'errorMessage', 'plotContainer'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Distance plots use standard Plotly zoom/pan
        // No custom axis scrolling needed for single channel data
    }
    
    /**
     * Load experiment data (Standard module interface)
     * @param {string} experimentId - Experiment ID
     */
    async loadExperiment(experimentId) {
        try {
            console.log(`Loading distance sensor data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId} - ${this.config.sensorType}`;
            }
            
            // Load metadata first
            await this.loadMetadata();
            
            // Load position channel data (pos_x)
            await this.loadPositionChannelData();
            
            // Create the plot
            await this.createPlot();
            
            this.state.isLoaded = true;
            this.hideLoading();
            
            console.log(`Distance sensor data loaded successfully for ${experimentId}`);
            
        } catch (error) {
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Load position CSV metadata
     */
    async loadMetadata() {
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/pos-metadata`
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Position CSV file not found for this experiment');
                }
                throw new Error(`Failed to load position metadata: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load position metadata');
            }
            
            this.state.metadata = result.data;
            
            // Convert time range from microseconds to seconds for display
            this.state.currentTimeRange = {
                min: result.data.timeRange.min / 1000000,  // µs to seconds
                max: result.data.timeRange.max / 1000000   // µs to seconds
            };
            
            console.log('Position metadata loaded:', {
                duration: result.data.duration / 1000,  // ms to seconds
                channels: result.data.channels.available.position.length,
                interpolated: result.data.positionInfo.isInterpolated,
                sensorType: result.data.positionInfo.sensorType
            });
            
        } catch (error) {
            throw new Error(`Position metadata loading failed: ${error.message}`);
        }
    }
    
    /**
 * Load position channel data (single channel: pos_x)
 */
async loadPositionChannelData() {
    try {
        const channelId = 'pos_x';  // Single channel for position data
        
        console.log(`Loading position channel: ${channelId}`);
        
        const response = await fetch(
            `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/pos-data/${channelId}?` +
            `start=${this.state.currentTimeRange.min * 1000000}&` +  // Convert back to µs
            `end=${this.state.currentTimeRange.max * 1000000}&` +
            `maxPoints=${this.config.maxPoints}`,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            }
        );
        
        if (!response.ok) {
            throw new Error(`Failed to load position channel data: ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to load position channel data');
        }
        
        // FIXED: The API response has nested structure: result.data.data.time
        const apiData = result.data.data || result.data; // Handle both structures
        const apiMetadata = result.data.metadata || result.metadata;
        
        if (!apiData.time || !Array.isArray(apiData.time)) {
            throw new Error('Invalid API response: missing time data array');
        }
        
        // Convert time data from microseconds to seconds for plotting
        const timeInSeconds = apiData.time.map(t => t / 1000000);
        
        this.state.plotData = {
            pos_x: {
                success: true,
                data: {
                    time: timeInSeconds,
                    values: apiData.values
                },
                metadata: apiMetadata
            }
        };
        
        console.log(`Loaded position channel successfully: ${apiData.time.length} points`);
        
    } catch (error) {
        console.error('Position channel loading error details:', error);
        throw new Error(`Position channel data loading failed: ${error.message}`);
    }
}
    
    /**
     * Create Plotly distance plot
     */
    async createPlot() {
        if (!this.elements.distancePlot || !this.state.plotData) {
            throw new Error('Missing plot container or position data');
        }
        
        try {
            // Build plot traces
            const traces = this.buildDistancePlotTraces();
            const layout = this.createDistancePlotLayout();
            const config = this.createPlotConfig();
            
            // Create the plot
            this.plot = await Plotly.newPlot(
                this.elements.distancePlot, 
                traces, 
                layout, 
                config
            );
            
            // Setup plot event handlers
            this.attachPlotEvents();
            
            this.state.isPlotReady = true;
            this.showPlot();
            
            console.log('Distance plot created successfully');
            
        } catch (error) {
            throw new Error(`Distance plot creation failed: ${error.message}`);
        }
    }
    
    /**
     * Build Plotly traces from position channel data
     */
    buildDistancePlotTraces() {
        const traces = [];
        
        // Single channel: pos_x
        const channelData = this.state.plotData.pos_x;
        if (channelData && channelData.success) {
            const color = this.config.colors.pos_x;
            const channelMeta = channelData.metadata;
            
            traces.push({
                x: channelData.data.time,
                y: channelData.data.values,
                type: 'scatter',
                mode: 'lines',
                name: `${channelMeta.label || 'Position X'} [${channelMeta.unit || 'mm'}]`,
                line: { 
                    color: color,
                    width: 2
                },
                hovertemplate: 
                    '<b>%{fullData.name}</b><br>' +
                    'Time: %{x:.4f} s<br>' +
                    'Position: %{y:.3f} mm<br>' +
                    '<extra></extra>'
            });
        }
        
        return traces;
    }
    
    /**
     * Create Plotly layout for distance plot (single Y-axis)
     */
    createDistancePlotLayout() {
        return {
            title: {
                text: '',  // No title - using module header instead
                font: { size: 0 }
            },
            
            // X-axis (time in seconds)
            xaxis: {
                title: 'Time [s]',
                showgrid: true,
                gridcolor: 'rgba(25, 118, 210, 0.15)',  // Cool blue grid
                range: [this.state.currentTimeRange.min, this.state.currentTimeRange.max],
                tickfont: { color: '#666666' }
            },
            
            // Y-axis (position/distance in mm)
            yaxis: {
                title: { 
                    text: 'Position [mm]', 
                    font: { color: '#1976D2', size: 14 }  // Distance sensor blue
                },
                showgrid: true,
                gridcolor: 'rgba(25, 118, 210, 0.15)',  // Blue grid matching theme
                tickfont: { color: '#1976D2' },
                titlefont: { color: '#1976D2' },
                zeroline: true,
                zerolinecolor: 'rgba(25, 118, 210, 0.3)'
            },
            
            legend: {
                x: 0.02,
                y: 0.98,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(25, 118, 210, 0.3)',
                borderwidth: 1,
                font: { size: 12 }
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(233, 247, 255, 0.3)',  // Very light blue background
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
            scrollZoom: true,  // Enable scroll zoom for high-density data
            displaylogo: false,
            modeBarButtonsToRemove: [],
            toImageButtonOptions: {
                format: 'png',
                filename: `distance_sensor_${this.state.experimentId}`,
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
        if (!this.elements.distancePlot) return;
        
        // Handle zoom/pan events for dynamic resampling
        this.elements.distancePlot.on('plotly_relayout', (eventData) => {
            this.handlePlotRelayout(eventData);
        });
        
        // Handle double-click to reset
        this.elements.distancePlot.on('plotly_doubleclick', () => {
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
            
            console.log(`Distance sensor time range changed: ${newStartTime.toFixed(3)}s - ${newEndTime.toFixed(3)}s`);
            
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
 * Resample position data for new time range
 */
async resampleDataForTimeRange(startTime, endTime) {
    try {
        // Validate time range - don't allow negative times
        const validStartTime = Math.max(0, startTime);
        const maxTime = this.state.metadata.timeRange.max / 1000000; // Convert µs to seconds
        const validEndTime = Math.min(maxTime, endTime);
        
        // Skip if invalid range
        if (validStartTime >= validEndTime) {
            console.warn('Invalid time range for resampling:', { startTime, endTime, validStartTime, validEndTime });
            return;
        }
        
        // Determine appropriate maxPoints based on zoom level
        const timespan = validEndTime - validStartTime;
        const totalDuration = maxTime;
        const zoomFactor = totalDuration / timespan;
        
        // Higher point density for position data since it's interpolated to 1ms
        const maxPoints = Math.min(8000, Math.max(3000, Math.floor(4000 * Math.sqrt(zoomFactor))));
        
        console.log(`Resampling for zoom: ${validStartTime.toFixed(3)}s - ${validEndTime.toFixed(3)}s, ${maxPoints} points`);
        
        const response = await fetch(
            `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/pos-data/pos_x?` +
            `start=${validStartTime * 1000000}&` +  // Convert to microseconds
            `end=${validEndTime * 1000000}&` +
            `maxPoints=${maxPoints}`,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            }
        );
        
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                // Handle the nested API response structure correctly
                const apiData = result.data.data || result.data;
                
                if (!apiData.time || !Array.isArray(apiData.time)) {
                    console.error('Invalid resampling response:', result);
                    return;
                }
                
                // Convert time back to seconds
                const timeInSeconds = apiData.time.map(t => t / 1000000);
                
                // Use Plotly.react to completely update the plot
                const newTraces = [{
                    x: timeInSeconds,
                    y: apiData.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `Position X [mm]`,
                    line: { 
                        color: this.config.colors.pos_x,
                        width: 2
                    },
                    hovertemplate: 
                        '<b>%{fullData.name}</b><br>' +
                        'Time: %{x:.4f} s<br>' +
                        'Position: %{y:.3f} mm<br>' +
                        '<extra></extra>'
                }];
                
                // Update the plot completely with new data
                await Plotly.react(this.elements.distancePlot, newTraces, this.plot.layout);
                
                console.log(`Plot updated with ${timeInSeconds.length} points for range ${validStartTime.toFixed(3)}s - ${validEndTime.toFixed(3)}s`);
                
                // Update internal state for consistency
                this.state.plotData.pos_x.data = {
                    time: timeInSeconds,
                    values: apiData.values
                };
                
                console.log(`Resampling completed: ${apiData.time.length} points loaded`);
                
            } else {
                console.error('Resampling API error:', result.error);
            }
        } else {
            console.error('Resampling HTTP error:', response.status);
        }
        
    } catch (error) {
        console.error('Error resampling position data:', error);
    }
}
    
    /**
     * Reset zoom to full position data range
     */
    resetZoom() {
        if (!this.state.metadata) return;
        
        const fullTimeRange = {
            min: this.state.metadata.timeRange.min / 1000000,
            max: this.state.metadata.timeRange.max / 1000000
        };
        
        const update = {
            'xaxis.range': [fullTimeRange.min, fullTimeRange.max],
            'yaxis.range': null  // Auto-scale position range
        };
        
        Plotly.relayout(this.elements.distancePlot, update);
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
        const message = error.message || 'Failed to load distance sensor data';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'distance-sensor',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:distance-sensor:${eventName}`;
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
        if (this.plot && this.elements.distancePlot) {
            Plotly.purge(this.elements.distancePlot);
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
        
        console.log('DistanceSensor destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config
        };
    }
    
    // === POSITION-SPECIFIC METHODS ===
    
    /**
     * Get current position value (for integration with other modules)
     * @returns {number|null} Current position in mm
     */
    getCurrentPosition() {
        if (!this.state.plotData || !this.state.plotData.pos_x) return null;
        
        const values = this.state.plotData.pos_x.data.values;
        return values.length > 0 ? values[values.length - 1] : null;
    }
    
    /**
     * Get position data range
     * @returns {Object|null} {min, max} position values in mm
     */
    getPositionRange() {
        if (!this.state.plotData || !this.state.plotData.pos_x) return null;
        
        const values = this.state.plotData.pos_x.data.values;
        if (values.length === 0) return null;
        
        return {
            min: Math.min(...values),
            max: Math.max(...values),
            range: Math.max(...values) - Math.min(...values)
        };
    }
}

// Export for global access
window.DistanceSensor = DistanceSensor;