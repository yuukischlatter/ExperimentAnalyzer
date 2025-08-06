/**
 * Binary Oscilloscope Module
 * High-performance visualization of .bin file data with multi-axis support
 * Integrates with Experiment Analyzer module system
 */

class BinOscilloscope {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        
        // State management
        this.state = {
            isLoaded: false,
            isVisible: false,
            currentExperiment: null,
            metadata: null,
            currentPlot: null,
            isLoading: false,
            error: null,
            
            // Channel visibility (only channel 0 for testing)
            visibleChannels: [0],
            
            // Current time range for zoom-responsive loading
            currentTimeRange: { start: 0, end: 100 },
            
            // Data cache for performance
            cachedData: new Map(),
            
            // Plot interaction state
            isZooming: false,
            zoomTimeout: null
        };
        
        this.elements = {};
        
        console.log('BinOscilloscope initialized');
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            maxPointsDefault: 2000,
            maxPointsZoomed: 5000,
            zoomDebounceMs: 200,
            colors: [
                '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
                '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'
            ]
        };
    }
    
    /**
     * Initialize the module (called by app.js)
     */
    async init() {
        try {
            await this.loadTemplate();
            this.render();
            this.bindElements();
            this.attachEvents();
            this.show();
            
            console.log('BinOscilloscope module initialized successfully');
            
        } catch (error) {
            console.error('BinOscilloscope initialization failed:', error);
            this.onError(error);
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
     * Render template to container - FIXED VERSION
     */
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            throw new Error(`Container element not found: ${this.containerId}`);
        }
        
        if (!this.template) {
            throw new Error('Template not loaded');
        }
        
        console.log('🎨 Rendering template to container:', this.containerId);
        container.innerHTML = this.template;
        console.log('✅ Template rendered successfully');
        // DON'T call bindElements() here - let init() handle it
    }
    
    /**
     * Bind DOM elements
     */
    bindElements() {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        
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
        // Channel visibility checkboxes (will be created dynamically)
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
        
        // Toggle all channels button
        if (this.elements.toggleAllBtn) {
            this.elements.toggleAllBtn.addEventListener('click', this.toggleAllChannels.bind(this));
        }
    }
    
    /**
     * Load experiment data (main entry point called by app orchestrator)
     */
    async loadExperiment(experimentId) {
        try {
            console.log(`Loading binary data for experiment: ${experimentId}`);
            
            this.state.currentExperiment = experimentId;
            this.state.isLoading = true;
            this.showLoading();
            
            // Clear previous data
            this.state.cachedData.clear();
            
            // Load metadata first
            await this.loadMetadata();
            
            // Create channel controls
            this.createChannelControls();
            
            // Load initial plot data
            await this.loadInitialPlotData();
            
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
     * Load experiment metadata
     */
    async loadMetadata() {
        const response = await fetch(`${this.config.apiBaseUrl}/experiments/${this.state.currentExperiment}/binary/metadata`);
        
        if (!response.ok) {
            throw new Error(`Failed to load metadata: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Metadata request failed');
        }
        
        this.state.metadata = result.data;
        this.state.currentTimeRange = { start: 0, end: this.state.metadata.duration };
        
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
                <span class="channel-indicator" style="background-color: ${ch.color}"></span>
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
     * Load initial plot data and create plot
     */
    async loadInitialPlotData() {
        // Load data for all visible channels
        const channelDataPromises = this.state.visibleChannels.map(channel => 
            this.loadChannelData(channel, this.state.currentTimeRange.start, this.state.currentTimeRange.end)
        );
        
        const channelDataArray = await Promise.all(channelDataPromises);
        
        // Create plot traces
        const traces = channelDataArray.map(data => ({
            x: Array.from(data.time),
            y: Array.from(data.values),
            type: 'scatter',
            mode: 'lines',
            name: `${data.channelName} [${data.unit}]`,
            line: { color: data.color, width: 1.5 },
            yaxis: data.yAxis,
            visible: true,
            legendgroup: 'binary'
        }));
        
        // Create plot layout
        const layout = this.createPlotLayout();
        
        // Create the plot
        await this.createPlot(traces, layout);
        
        console.log(`Initial plot created with ${traces.length} traces`);
    }
    
    /**
     * Load data for a specific channel - DEBUG VERSION
     */
    async loadChannelData(channel, startTime, endTime, maxPoints = null) {
        const cacheKey = `${channel}_${startTime}_${endTime}_${maxPoints || this.config.maxPointsDefault}`;
        
        console.log(`🔍 Loading channel ${channel} data (${startTime}s - ${endTime}s, ${maxPoints || this.config.maxPointsDefault} points)...`);
        
        // Check cache first
        if (this.state.cachedData.has(cacheKey)) {
            console.log(`🎯 Cache hit for channel ${channel}`);
            return this.state.cachedData.get(cacheKey);
        }
        
        const params = new URLSearchParams({
            startTime: startTime.toString(),
            endTime: endTime.toString(),
            maxPoints: (maxPoints || this.config.maxPointsDefault).toString()
        });
        
        console.log(`📡 Fetching channel ${channel} data from API...`);
        console.log(`🌐 URL: ${this.config.apiBaseUrl}/experiments/${this.state.currentExperiment}/binary/data/${channel}?${params}`);
        
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.currentExperiment}/binary/data/${channel}?${params}`
            );
            
            console.log(`📡 Response for channel ${channel}:`, {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok,
                headers: Object.fromEntries(response.headers.entries())
            });
            
            if (!response.ok) {
                console.error(`❌ Response not OK for channel ${channel}:`, response.status, response.statusText);
                throw new Error(`Failed to load channel ${channel} data: ${response.status}`);
            }
            
            console.log(`🔄 Starting JSON parsing for channel ${channel}...`);
            const result = await response.json();
            console.log(`✅ JSON parsed successfully for channel ${channel}. Success:`, result.success);
            
            if (!result.success) {
                console.error(`❌ API returned unsuccessful for channel ${channel}:`, result.error);
                throw new Error(result.error || `Channel ${channel} data request failed`);
            }
            
            console.log(`💾 Caching data for channel ${channel} (${result.data.actualPoints || result.data.values?.length} points)`);
            
            // Cache the result
            this.state.cachedData.set(cacheKey, result.data);
            
            console.log(`🎉 Successfully loaded channel ${channel} data`);
            return result.data;
            
        } catch (error) {
            console.error(`💥 Error loading channel ${channel} data:`, error);
            console.error(`💥 Error details:`, {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    
    /**
     * Create Plotly layout with multi-axis support
     */
    createPlotLayout() {
        const metadata = this.state.metadata;
        
        return {
            title: {
                text: `Binary Data - ${this.state.currentExperiment}`,
                font: { size: 16, color: '#2c3e50' }
            },
            
            // X-axis (time)
            xaxis: {
                title: 'Time [s]',
                range: [this.state.currentTimeRange.start, this.state.currentTimeRange.end],
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)',
                domain: [0.15, 0.85] // Leave space for Y-axes
            },
            
            // Voltage axis (left side)
            yaxis: {
                title: { text: 'Voltage [V]', font: { color: '#1f77b4' } },
                side: 'left',
                position: 0.0,
                showgrid: true,
                gridcolor: 'rgba(31, 119, 180, 0.2)',
                zeroline: true,
                zerolinecolor: 'rgba(31, 119, 180, 0.7)',
                tickfont: { color: '#1f77b4' },
                linecolor: '#1f77b4'
            },
            
            // Current axis (second from left)
            yaxis2: {
                title: { text: 'Current [A]', font: { color: '#ff7f0e' } },
                side: 'left',
                position: 0.08,
                overlaying: 'y',
                anchor: 'free',
                showgrid: false,
                zeroline: true,
                zerolinecolor: 'rgba(255, 127, 14, 0.7)',
                tickfont: { color: '#ff7f0e' },
                linecolor: '#ff7f0e'
            },
            
            // Pressure axis (third from left) 
            yaxis3: {
                title: { text: 'Pressure [Bar]', font: { color: '#2ca02c' } },
                side: 'left',
                position: 0.16,
                overlaying: 'y',
                anchor: 'free',
                showgrid: false,
                zeroline: true,
                zerolinecolor: 'rgba(44, 160, 44, 0.7)',
                tickfont: { color: '#2ca02c' },
                linecolor: '#2ca02c'
            },
            
            // Plot styling
            height: 500,
            margin: { l: 120, r: 50, t: 80, b: 60 },
            plot_bgcolor: 'rgba(248,249,250,0.3)',
            paper_bgcolor: 'rgba(0,0,0,0)',
            
            // Legend
            legend: {
                x: 1.02,
                y: 1,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(0,0,0,0.3)',
                borderwidth: 1
            },
            
            // Enable zoom preservation
            uirevision: 'bin-oscilloscope-ui'
        };
    }
    
    /**
     * Create Plotly plot with event handlers - FIXED VERSION
     */
    async createPlot(traces, layout) {
        console.log('🎨 Creating plot with', traces.length, 'traces...');
        
        // Wait for DOM element to be ready
        let plotContainer = this.elements.plotContainer;
        let retryCount = 0;
        const maxRetries = 10;
        
        // Retry logic to wait for DOM element
        while (!plotContainer && retryCount < maxRetries) {
            console.log(`⏳ Plot container not found, retry ${retryCount + 1}/${maxRetries}...`);
            
            // Re-bind elements in case they weren't ready before
            this.bindElements();
            plotContainer = this.elements.plotContainer;
            
            if (!plotContainer) {
                // Wait a bit and try again
                await new Promise(resolve => setTimeout(resolve, 100));
                retryCount++;
            }
        }
        
        if (!plotContainer) {
            console.error('💥 Plot container still not found after retries');
            console.error('💥 Available elements:', Object.keys(this.elements));
            console.error('💥 Container ID:', this.containerId);
            
            // Check if the container exists in DOM
            const containerElement = document.getElementById(this.containerId);
            console.error('💥 Container element exists:', !!containerElement);
            
            if (containerElement) {
                console.error('💥 Container innerHTML:', containerElement.innerHTML.slice(0, 200) + '...');
            }
            
            throw new Error('Plot container not found after multiple retries');
        }
        
        console.log('✅ Plot container found, creating Plotly plot...');
        
        const config = {
            responsive: true,
            displayModeBar: true,
            scrollZoom: false
        };
        
        try {
            // Create plot
            this.state.currentPlot = await Plotly.newPlot(plotContainer, traces, layout, config);
            
            // Setup event listeners
            this.setupPlotEventListeners();
            
            console.log('🎉 Plotly plot created successfully');
            
        } catch (error) {
            console.error('💥 Error creating Plotly plot:', error);
            throw error;
        }
    }
    
    /**
     * Setup plot event listeners for zoom-responsive loading
     */
    setupPlotEventListeners() {
        const plotContainer = this.elements.plotContainer;
        if (!plotContainer) return;
        
        // Remove existing listeners
        plotContainer.removeAllListeners?.('plotly_relayout');
        
        // Add zoom/pan handler with debouncing
        plotContainer.on('plotly_relayout', this.handleZoomEvent.bind(this));
        
        console.log('Plot event listeners setup complete');
    }
    
    /**
     * Handle zoom/pan events with debounced data reloading
     */
    async handleZoomEvent(eventData) {
        // Check if this is a zoom event
        if (!eventData['xaxis.range[0]'] && !eventData['xaxis.range[1]']) return;
        if (this.state.isZooming) return;
        
        const newStart = eventData['xaxis.range[0]'] || this.state.currentTimeRange.start;
        const newEnd = eventData['xaxis.range[1]'] || this.state.currentTimeRange.end;
        
        // Update current time range
        this.state.currentTimeRange = { start: newStart, end: newEnd };
        
        // Clear existing timeout
        if (this.state.zoomTimeout) {
            clearTimeout(this.state.zoomTimeout);
        }
        
        // Debounce the data reload
        this.state.zoomTimeout = setTimeout(async () => {
            await this.reloadDataForZoom(newStart, newEnd);
        }, this.config.zoomDebounceMs);
    }
    
    /**
     * Reload data for new zoom level
     */
    async reloadDataForZoom(startTime, endTime) {
        if (this.state.isZooming) return;
        
        try {
            this.state.isZooming = true;
            
            console.log(`Reloading data for zoom: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);
            
            // Load higher resolution data for zoomed view
            const channelDataPromises = this.state.visibleChannels.map(channel =>
                this.loadChannelData(channel, startTime, endTime, this.config.maxPointsZoomed)
            );
            
            const channelDataArray = await Promise.all(channelDataPromises);
            
            // Update plot with new data
            const updateData = {
                x: channelDataArray.map(data => Array.from(data.time)),
                y: channelDataArray.map(data => Array.from(data.values))
            };
            
            const traceIndices = this.state.visibleChannels.map((_, index) => index);
            
            await Plotly.restyle(this.elements.plotContainer, updateData, traceIndices);
            
            this.updateStatusInfo();
            
        } catch (error) {
            console.error('Error reloading data for zoom:', error);
        } finally {
            this.state.isZooming = false;
        }
    }
    
    /**
     * Handle channel visibility toggle
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
        
        // Reload plot with new channel selection
        await this.reloadPlotWithChannels();
    }
    
    /**
     * Toggle all channels on/off
     */
    async toggleAllChannels() {
        const allChannels = [0, 1, 2, 3, 4, 5, 6, 7];
        
        if (this.state.visibleChannels.length === 8) {
            // All visible, turn all off
            this.state.visibleChannels = [];
        } else {
            // Some or none visible, turn all on
            this.state.visibleChannels = [...allChannels];
        }
        
        // Update checkboxes
        const checkboxes = this.elements.channelControls?.querySelectorAll('input[type="checkbox"]');
        checkboxes?.forEach(cb => {
            const channel = parseInt(cb.dataset.channel);
            cb.checked = this.state.visibleChannels.includes(channel);
        });
        
        // Reload plot
        await this.reloadPlotWithChannels();
    }
    
    /**
     * Reload plot with current channel selection
     */
    async reloadPlotWithChannels() {
        if (!this.state.isLoaded || this.state.visibleChannels.length === 0) {
            // Clear plot if no channels visible
            if (this.state.currentPlot) {
                await Plotly.purge(this.elements.plotContainer);
                this.state.currentPlot = null;
            }
            return;
        }
        
        try {
            // Load data for visible channels
            await this.loadInitialPlotData();
            
        } catch (error) {
            console.error('Error reloading plot:', error);
            this.showError('Failed to reload plot data');
        }
    }
    
    /**
     * Reset zoom to full view
     */
    resetZoom() {
        if (!this.state.metadata || !this.state.currentPlot) return;
        
        const update = {
            'xaxis.range': [0, this.state.metadata.duration]
        };
        
        Plotly.relayout(this.elements.plotContainer, update);
    }
    
    /**
     * Reset Y-axes to auto-range
     */
    resetYAxes() {
        if (!this.state.currentPlot) return;
        
        const update = {
            'yaxis.range': null,
            'yaxis2.range': null,
            'yaxis3.range': null
        };
        
        Plotly.relayout(this.elements.plotContainer, update);
    }
    
    /**
     * Update status information
     */
    updateStatusInfo() {
        if (!this.elements.statusInfo) return;
        
        const totalPoints = this.state.visibleChannels.length > 0 ? 
            this.state.visibleChannels.length * this.config.maxPointsDefault : 0;
        
        const timeRange = `${this.state.currentTimeRange.start.toFixed(2)}s - ${this.state.currentTimeRange.end.toFixed(2)}s`;
        
        this.elements.statusInfo.textContent = 
            `${this.state.visibleChannels.length} channels, ~${totalPoints.toLocaleString()} points, ${timeRange}`;
    }
    
    // State management methods
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
        
        // Emit error event
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
    
    /**
     * Handle errors
     */
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
            hasPlot: !!this.state.currentPlot,
            cacheSize: this.state.cachedData.size
        };
    }
    
    /**
     * Clean up resources
     */
    destroy() {
        // Clean up plot
        if (this.state.currentPlot && this.elements.plotContainer) {
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