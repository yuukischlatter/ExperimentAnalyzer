/**
 * Acceleration Module
 * Displays 3-axis acceleration CSV data (X=Red, Y=Green, Z=Blue)
 * Simple implementation following distance-sensor pattern
 * UPDATED: Added cleanup and abort functionality
 */

class Acceleration {
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
        
        // NEW: Request management
        this.abortController = null;
        this.isLoading = false;
        
        console.log('Acceleration initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            maxPoints: 6000,  // Higher for acceleration data
            plotHeight: 600,
            colors: {
                acc_x: '#FF0000',  // Red for X-axis
                acc_y: '#00FF00',  // Green for Y-axis
                acc_z: '#0000FF'   // Blue for Z-axis
            },
            // Acceleration-specific settings
            expectedUnits: 'm/s²',
            filePatterns: ['*_beschleuinigung.csv', 'daq_download.csv']
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
            console.log('Acceleration initialized successfully');
            
        } catch (error) {
            console.error('Acceleration initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'AccelerationTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/data/acceleration/acceleration.html');
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
            'accelerationPlot', 'loadingSpinner', 'errorMessage', 'plotContainer'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Acceleration plots use standard Plotly zoom/pan
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
        console.log('Acceleration: Ongoing requests aborted');
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
        
        // Clear plot
        if (this.plot && this.elements.accelerationPlot) {
            Plotly.purge(this.elements.accelerationPlot);
            this.plot = null;
        }
        
        // Clear UI
        this.hideError();
        this.hidePlot();
        this.hideLoading();
        
        console.log('Acceleration: Cleanup completed');
    }
    
    /**
     * Load experiment data (Standard module interface) - MODIFIED: Added abort controller support
     * @param {string} experimentId - Experiment ID
     */
    async loadExperiment(experimentId) {
        try {
            // Prevent overlapping loads
            if (this.isLoading) {
                console.log('Already loading acceleration data, aborting previous request...');
                this.abort();
            }
            
            // Create new abort controller
            this.abortController = new AbortController();
            this.isLoading = true;
            
            console.log(`Loading acceleration data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId} - 3-axis acceleration data`;
            }
            
            // Load metadata first
            await this.loadMetadata();
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Load acceleration channel data (X, Y, Z)
            await this.loadAccelerationChannelData();
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Create the plot
            await this.createPlot();
            
            this.state.isLoaded = true;
            this.isLoading = false;
            this.hideLoading();
            
            console.log(`Acceleration data loaded successfully for ${experimentId}`);
            
        } catch (error) {
            this.isLoading = false;
            
            // Don't show errors for aborted requests
            if (error.name === 'AbortError') {
                console.log('Acceleration loading was aborted');
                return;
            }
            
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Load acceleration CSV metadata - MODIFIED: Added abort signal support
     */
    async loadMetadata() {
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/acc-metadata`,
                { signal: this.abortController.signal }
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Acceleration CSV file not found for this experiment');
                }
                throw new Error(`Failed to load acceleration metadata: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load acceleration metadata');
            }
            
            this.state.metadata = result.data;
            
            // Convert time range from microseconds to seconds for display
            this.state.currentTimeRange = {
                min: result.data.timeRange.min / 1000000,  // µs to seconds
                max: result.data.timeRange.max / 1000000   // µs to seconds
            };
            
            console.log('Acceleration metadata loaded:', {
                duration: result.data.duration / 1000,  // ms to seconds
                channels: result.data.channels.available.acceleration.length,
                samplingRate: result.data.accelerationInfo.samplingInfo
            });
            
        } catch (error) {
            throw new Error(`Acceleration metadata loading failed: ${error.message}`);
        }
    }
    
    /**
     * Load acceleration channel data (3 channels: acc_x, acc_y, acc_z) - MODIFIED: Added abort signal support
     */
    async loadAccelerationChannelData() {
        try {
            const channelIds = ['acc_x', 'acc_y', 'acc_z'];
            
            console.log(`Loading acceleration channels: ${channelIds.join(', ')}`);
            
            // Use bulk endpoint for efficiency
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/acc-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: channelIds,
                        startTime: this.state.currentTimeRange.min * 1000000,  // Convert to µs
                        endTime: this.state.currentTimeRange.max * 1000000,
                        maxPoints: this.config.maxPoints
                    }),
                    signal: this.abortController.signal
                }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to load acceleration channel data: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load acceleration channel data');
            }
            
            // Process bulk response data
            this.state.plotData = {};
            const bulkChannels = result.data.channels;
            
            for (const channelId of channelIds) {
                if (bulkChannels[channelId] && bulkChannels[channelId].success) {
                    const channelData = bulkChannels[channelId];
                    
                    // Convert time data from microseconds to seconds for plotting
                    const timeInSeconds = channelData.data.time.map(t => t / 1000000);
                    
                    this.state.plotData[channelId] = {
                        success: true,
                        data: {
                            time: timeInSeconds,
                            values: channelData.data.values
                        },
                        metadata: channelData.metadata
                    };
                } else {
                    console.warn(`Failed to load channel ${channelId}:`, bulkChannels[channelId]?.error);
                }
            }
            
            const loadedChannels = Object.keys(this.state.plotData).length;
            console.log(`Loaded ${loadedChannels} acceleration channels successfully`);
            
            if (loadedChannels === 0) {
                throw new Error('No acceleration channels could be loaded');
            }
            
        } catch (error) {
            console.error('Acceleration channel loading error details:', error);
            throw new Error(`Acceleration channel data loading failed: ${error.message}`);
        }
    }
    
    /**
     * Create Plotly acceleration plot
     */
    async createPlot() {
        if (!this.elements.accelerationPlot || !this.state.plotData) {
            throw new Error('Missing plot container or acceleration data');
        }
        
        try {
            // Build plot traces
            const traces = this.buildAccelerationPlotTraces();
            const layout = this.createAccelerationPlotLayout();
            const config = this.createPlotConfig();
            
            // Create the plot
            this.plot = await Plotly.newPlot(
                this.elements.accelerationPlot, 
                traces, 
                layout, 
                config
            );
            
            // Setup plot event handlers
            this.attachPlotEvents();
            
            this.state.isPlotReady = true;
            this.showPlot();
            
            console.log('Acceleration plot created successfully');
            
        } catch (error) {
            throw new Error(`Acceleration plot creation failed: ${error.message}`);
        }
    }
    
    /**
     * Build Plotly traces from acceleration channel data
     */
    buildAccelerationPlotTraces() {
        const traces = [];
        
        // 3 channels: acc_x (Red), acc_y (Green), acc_z (Blue)
        const channelOrder = ['acc_x', 'acc_y', 'acc_z'];
        
        for (const channelId of channelOrder) {
            const channelData = this.state.plotData[channelId];
            if (channelData && channelData.success) {
                const color = this.config.colors[channelId];
                const channelMeta = channelData.metadata;
                const axisName = channelId.replace('acc_', '').toUpperCase();
                
                traces.push({
                    x: channelData.data.time,
                    y: channelData.data.values,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${axisName}-Axis [${channelMeta.unit || 'm/s²'}]`,
                    line: { 
                        color: color,
                        width: 2
                    },
                    hovertemplate: 
                        '<b>%{fullData.name}</b><br>' +
                        'Time: %{x:.4f} s<br>' +
                        'Acceleration: %{y:.3f} m/s²<br>' +
                        '<extra></extra>'
                });
            }
        }
        
        return traces;
    }
    
    /**
     * Create Plotly layout for acceleration plot
     */
    createAccelerationPlotLayout() {
        return {
            title: {
                text: '',  // No title - using module header instead
                font: { size: 0 }
            },
            
            // X-axis (time in seconds)
            xaxis: {
                title: 'Time [s]',
                showgrid: true,
                gridcolor: 'rgba(255, 100, 100, 0.15)',  // Light red grid
                range: [this.state.currentTimeRange.min, this.state.currentTimeRange.max],
                tickfont: { color: '#666666' }
            },
            
            // Y-axis (acceleration in m/s²)
            yaxis: {
                title: { 
                    text: 'Acceleration [m/s²]', 
                    font: { color: '#FF0000', size: 14 }  // Red theme
                },
                showgrid: true,
                gridcolor: 'rgba(255, 100, 100, 0.15)',  // Light red grid
                tickfont: { color: '#FF0000' },
                titlefont: { color: '#FF0000' },
                zeroline: true,
                zerolinecolor: 'rgba(255, 0, 0, 0.3)'
            },
            
            legend: {
                x: 0.02,
                y: 0.98,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(255, 0, 0, 0.3)',
                borderwidth: 1,
                font: { size: 12 }
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(255, 240, 240, 0.3)',  // Very light red background
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
            scrollZoom: true,  // Enable scroll zoom for high-frequency data
            displaylogo: false,
            modeBarButtonsToRemove: [],
            toImageButtonOptions: {
                format: 'png',
                filename: `acceleration_${this.state.experimentId}`,
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
        if (!this.elements.accelerationPlot) return;
        
        // Handle zoom/pan events for dynamic resampling
        this.elements.accelerationPlot.on('plotly_relayout', (eventData) => {
            this.handlePlotRelayout(eventData);
        });
        
        // Handle double-click to reset
        this.elements.accelerationPlot.on('plotly_doubleclick', () => {
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
            
            console.log(`Acceleration time range changed: ${newStartTime.toFixed(3)}s - ${newEndTime.toFixed(3)}s`);
            
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
     * Resample acceleration data for new time range - MODIFIED: Added abort signal support
     */
    async resampleDataForTimeRange(startTime, endTime) {
        try {
            // Validate time range
            const validStartTime = Math.max(0, startTime);
            const maxTime = this.state.metadata.timeRange.max / 1000000; // Convert µs to seconds
            const validEndTime = Math.min(maxTime, endTime);
            
            if (validStartTime >= validEndTime) {
                console.warn('Invalid time range for resampling:', { startTime, endTime });
                return;
            }
            
            // Determine appropriate maxPoints based on zoom level
            const timespan = validEndTime - validStartTime;
            const totalDuration = maxTime;
            const zoomFactor = totalDuration / timespan;
            const maxPoints = Math.min(6000, Math.max(3000, Math.floor(4000 * Math.sqrt(zoomFactor))));
            
            console.log(`Resampling acceleration data: ${validStartTime.toFixed(3)}s - ${validEndTime.toFixed(3)}s, ${maxPoints} points`);
            
            // Create abort controller for resampling request
            const resampleAbortController = new AbortController();
            
            // Resample all 3 channels
            const channelIds = ['acc_x', 'acc_y', 'acc_z'];
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/acc-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: channelIds,
                        startTime: validStartTime * 1000000,  // Convert to microseconds
                        endTime: validEndTime * 1000000,
                        maxPoints: maxPoints
                    }),
                    signal: resampleAbortController.signal
                }
            );
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    // Build new traces with resampled data
                    const newTraces = [];
                    const bulkChannels = result.data.channels;
                    
                    for (const channelId of channelIds) {
                        if (bulkChannels[channelId] && bulkChannels[channelId].success) {
                            const channelData = bulkChannels[channelId];
                            const timeInSeconds = channelData.data.time.map(t => t / 1000000);
                            const color = this.config.colors[channelId];
                            const axisName = channelId.replace('acc_', '').toUpperCase();
                            
                            newTraces.push({
                                x: timeInSeconds,
                                y: channelData.data.values,
                                type: 'scatter',
                                mode: 'lines',
                                name: `${axisName}-Axis [m/s²]`,
                                line: { 
                                    color: color,
                                    width: 2
                                },
                                hovertemplate: 
                                    '<b>%{fullData.name}</b><br>' +
                                    'Time: %{x:.4f} s<br>' +
                                    'Acceleration: %{y:.3f} m/s²<br>' +
                                    '<extra></extra>'
                            });
                            
                            // Update internal state
                            this.state.plotData[channelId].data = {
                                time: timeInSeconds,
                                values: channelData.data.values
                            };
                        }
                    }
                    
                    // Update the plot with new data
                    await Plotly.react(this.elements.accelerationPlot, newTraces, this.plot.layout);
                    
                    console.log(`Plot updated with ${newTraces.length} channels for range ${validStartTime.toFixed(3)}s - ${validEndTime.toFixed(3)}s`);
                    
                } else {
                    console.error('Resampling API error:', result.error);
                }
            } else {
                console.error('Resampling HTTP error:', response.status);
            }
            
        } catch (error) {
            // Don't log abort errors
            if (error.name === 'AbortError') {
                console.log('Acceleration resampling was aborted');
                return;
            }
            
            console.error('Error resampling acceleration data:', error);
        }
    }
    
    /**
     * Reset zoom to full acceleration data range
     */
    resetZoom() {
        if (!this.state.metadata) return;
        
        const fullTimeRange = {
            min: this.state.metadata.timeRange.min / 1000000,
            max: this.state.metadata.timeRange.max / 1000000
        };
        
        const update = {
            'xaxis.range': [fullTimeRange.min, fullTimeRange.max],
            'yaxis.range': null  // Auto-scale acceleration range
        };
        
        Plotly.relayout(this.elements.accelerationPlot, update);
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
        const message = error.message || 'Failed to load acceleration data';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'acceleration',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:acceleration:${eventName}`;
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
        
        // Clean up Plotly plot
        if (this.plot && this.elements.accelerationPlot) {
            Plotly.purge(this.elements.accelerationPlot);
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
        
        console.log('Acceleration destroyed');
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
window.Acceleration = Acceleration;