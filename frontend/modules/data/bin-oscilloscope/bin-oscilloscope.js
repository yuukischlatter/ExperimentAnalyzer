/**
 * Binary Oscilloscope Module
 * Complete Oscilloscope Data Visualization (12 Channels: 8 Raw + 4 Calculated)
 * Shows raw oscilloscope data + calculated welding parameters from PicoScope data
 * Fixed to work with C# backend API endpoints and data structure
 */

class BinOscilloscope {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        this.state = {
            isLoaded: false,
            isVisible: false,
            currentExperiment: null,
            data: null,
            plotDiv: null,
            channelVisibility: {
                // Raw channels (0-7) - default visible
                0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true,
                // Calculated channels (8-11) - default visible
                8: true, 9: true, 10: true, 11: true
            },
            isLoading: false,
            error: null,
            zoomLoadingTimeout: null
        };
        this.elements = {};
        
        // Channel configuration for all 12 channels (0-11) - matches C# backend exactly
        this.channelConfig = {
            // Raw oscilloscope channels (0-7)
            0: { label: 'UL1L2', unit: 'V', axis: 'y', color: '#1f77b4', group: 'voltage', description: 'Raw Voltage UL1L2' },
            1: { label: 'UL2L3', unit: 'V', axis: 'y', color: '#ff7f0e', group: 'voltage', description: 'Raw Voltage UL2L3' },
            2: { label: 'IL1GR1', unit: 'A', axis: 'y2', color: '#2ca02c', group: 'current', description: 'Raw Current IL1GR1' },
            3: { label: 'IL3GR1', unit: 'A', axis: 'y2', color: '#d62728', group: 'current', description: 'Raw Current IL3GR1' },
            4: { label: 'IL1GR2', unit: 'A', axis: 'y2', color: '#9467bd', group: 'current', description: 'Raw Current IL1GR2' },
            5: { label: 'IL3GR2', unit: 'A', axis: 'y2', color: '#8c564b', group: 'current', description: 'Raw Current IL3GR2' },
            6: { label: 'P_Vor', unit: 'Bar', axis: 'y3', color: '#e377c2', group: 'pressure', description: 'Raw Pressure P_Vor' },
            7: { label: 'P_Rueck', unit: 'Bar', axis: 'y3', color: '#7f7f7f', group: 'pressure', description: 'Raw Pressure P_Rueck' },
            
            // Calculated welding parameter channels (8-11)
            8: { label: 'I_DC_GR1*', unit: 'A', axis: 'y2', color: '#ff4500', group: 'dc-current', description: 'DC Current Group 1' },
            9: { label: 'I_DC_GR2*', unit: 'A', axis: 'y2', color: '#ff1493', group: 'dc-current', description: 'DC Current Group 2' },
            10: { label: 'U_DC*', unit: 'V', axis: 'y', color: '#4169e1', group: 'dc-voltage', description: 'DC Voltage' },
            11: { label: 'F_Schlitten*', unit: 'kN', axis: 'y4', color: '#32cd32', group: 'force', description: 'Force from Pressure Sensors' }
        };
        
        console.log('BinOscilloscope initialized for all 12 channels (8 raw + 4 calculated)');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            zoomLoadDelay: 500,
            maxOverviewPoints: 5000,
            enableWebGL: true,
            autoLoadOverview: true
        };
    }
    
    async init() {
        try {
            await this.loadTemplate();
            this.bindElements();
            this.attachEvents();
            this.show();
            console.log('BinOscilloscope initialized successfully');
        } catch (error) {
            console.error('BinOscilloscope initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        const templateVar = 'BinOscilloscopeTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
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
        
        const bindableElements = container.querySelectorAll('[data-bind]');
        bindableElements.forEach(el => {
            const bindName = el.dataset.bind;
            this.elements[bindName] = el;
        });
        
        // Verify critical elements exist
        const requiredElements = [
            'chartContainer', 'loadingSpinner', 'errorMessage', 'statusIndicator',
            'resolutionStatus', 'dataPoints', 'timeRange', 'experimentInfo'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Channel toggle checkboxes for ALL channels (0-11)
        for (let i = 0; i < 12; i++) {
            const checkbox = this.elements[`channel${i}Checkbox`];
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    this.handleChannelToggle(i, e.target.checked);
                });
            }
        }
        
        // Action buttons
        if (this.elements.exportBtn) {
            this.elements.exportBtn.addEventListener('click', this.handleExportPNG.bind(this));
        }
        
        if (this.elements.resetZoomBtn) {
            this.elements.resetZoomBtn.addEventListener('click', this.handleResetZoom.bind(this));
        }
        
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', this.handleRetry.bind(this));
        }
        
        // Listen for experiment selection
        document.addEventListener('module:experiment-browser:experimentSelected', (event) => {
            const { experimentId, experiment } = event.detail;
            if (experiment.hasBinFile || experiment.HasBinFile) {
                this.loadExperiment(experimentId);
            }
        });
    }
    
    async loadExperiment(experimentId) {
        try {
            console.log(`Loading experiment: ${experimentId}`);
            this.state.currentExperiment = experimentId;
            this.updateExperimentInfo(experimentId);
            
            this.showLoading('Loading oscilloscope metadata...');
            
            // Load metadata first (fast)
            const metadata = await this.loadMetadata(experimentId);
            this.updateStatus('Metadata loaded', 'loaded');
            
            // Load overview data (cached or generated)
            if (this.config.autoLoadOverview) {
                this.showLoading('Loading oscilloscope data...');
                await this.loadOverviewData(experimentId);
            }
            
        } catch (error) {
            console.error('Failed to load experiment:', error);
            this.onError(error);
        }
    }
    
    async loadMetadata(experimentId) {
        // FIXED: Use correct C# controller endpoint
        const url = `${this.config.apiBaseUrl}/experiments/${experimentId}/bin-oscilloscope/metadata`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Metadata request failed: ${response.status}`);
        }
        
        const result = await response.json();
        // FIXED: Handle C# API response structure with capital 'S' in Success
        if (!result.Success && !result.success) {
            throw new Error(result.Error || result.error || 'Failed to load metadata');
        }
        
        console.log('Metadata loaded:', result.Data || result.data);
        return result.Data || result.data;
    }
    
    async loadOverviewData(experimentId) {
        // FIXED: Use correct C# controller endpoint (no /overview path)
        const url = `${this.config.apiBaseUrl}/experiments/${experimentId}/bin-oscilloscope?maxPoints=${this.config.maxOverviewPoints}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Overview request failed: ${response.status}`);
        }
        
        const result = await response.json();
        // FIXED: Handle C# API response structure
        if (!result.Success && !result.success) {
            throw new Error(result.Error || result.error || 'Failed to load overview data');
        }
        
        // FIXED: Use correct property name (capital D in Data)
        this.state.data = result.Data || result.data;
        this.state.isLoaded = true;
        
        await this.initializePlot(this.state.data);
        this.setupZoomHandling();
        this.hideLoading();
        this.onDataLoaded();
        
        console.log(`Oscilloscope data loaded: ${this.calculateTotalPoints(this.state.data)} points`);
    }
    
    async initializePlot(data) {
        const traces = this.createPlotlyTraces(data);
        const layout = this.createPlotlyLayout(data);
        const config = this.createPlotlyConfig();
        
        const chartContainer = document.getElementById('plotly-chart-container');
        if (!chartContainer) {
            throw new Error('Chart container not found');
        }
        
        // Plotly automatically uses WebGL for large datasets
        this.state.plotDiv = await Plotly.newPlot(chartContainer, traces, layout, config);
    }
    
    createPlotlyTraces(data) {
        const traces = [];
        
        // FIXED: Process all channels (0-11) and handle C# data structure
        Object.entries(data.Channels || data.channels || {}).forEach(([channelIndex, channelData]) => {
            const chIndex = parseInt(channelIndex);
            const config = this.channelConfig[chIndex];
            
            // Show all visible channels (0-11)
            if (this.state.channelVisibility[chIndex] && config) {
                traces.push({
                    // FIXED: Use correct property names from C# backend
                    x: data.TimeArray || data.timeArray,
                    y: channelData.Values || channelData.values,
                    name: `${config.label} (${config.unit})`,
                    type: 'scatter',
                    mode: 'lines',
                    line: { 
                        color: config.color,
                        width: config.group === 'dc-voltage' || config.group === 'voltage' ? 2 : 1.5
                    },
                    yaxis: config.axis,
                    hovertemplate: `<b>${config.label}</b><br>` +
                                  `${config.description}<br>` +
                                  `Time: %{x:.3f} s<br>` +  // FIXED: Changed from ms to s
                                  `Value: %{y:.3f} ${config.unit}<extra></extra>`
                });
            }
        });
        
        return traces;
    }
    
    createPlotlyLayout(data) {
        return {
            title: {
                text: `Complete Oscilloscope Data - ${this.state.currentExperiment}`,
                font: { size: 16, color: '#003278' }
            },
            xaxis: {
                title: 'Time (s)',  // FIXED: Changed from ms to s
                showgrid: true,
                gridcolor: '#E0E0E0'
            },
            // Voltage axis (left side - y)
            yaxis: {
                title: 'Voltage (V)',
                titlefont: { color: '#1f77b4' },
                tickfont: { color: '#1f77b4' },
                side: 'left',
                showgrid: true,
                gridcolor: '#F0F0F0'
            },
            // Current axis (right side - y2)
            yaxis2: {
                title: 'Current (A)',
                titlefont: { color: '#2ca02c' },
                tickfont: { color: '#2ca02c' },
                overlaying: 'y',
                side: 'right',
                showgrid: false
            },
            // Pressure axis (right side - y3)
            yaxis3: {
                title: 'Pressure (Bar)',
                titlefont: { color: '#e377c2' },
                tickfont: { color: '#e377c2' },
                overlaying: 'y',
                side: 'right',
                position: 0.95,
                showgrid: false
            },
            // Force axis (right side - y4) for calculated force
            yaxis4: {
                title: 'Force (kN)',
                titlefont: { color: '#32cd32' },
                tickfont: { color: '#32cd32' },
                overlaying: 'y',
                side: 'right',
                position: 0.90,
                showgrid: false
            },
            legend: {
                x: 0.01,
                y: 0.99,
                bgcolor: 'rgba(255, 255, 255, 0.8)',
                bordercolor: '#C8C8C8',
                borderwidth: 1
            },
            margin: { l: 60, r: 120, t: 50, b: 50 }, // More right margin for multiple y-axes
            hovermode: 'x unified',
            showlegend: true
        };
    }
    
    createPlotlyConfig() {
        return {
            displayModeBar: true,
            modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d', 'autoScale2d'],
            modeBarButtonsToAdd: [{
                name: 'Export PNG',
                icon: Plotly.Icons.camera,
                click: () => this.handleExportPNG()
            }],
            responsive: true,
            displaylogo: false
        };
    }
    
    setupZoomHandling() {
        if (!this.state.plotDiv) return;
        
        const debouncedZoomHandler = this.debounce((eventData) => {
            if (eventData['xaxis.range[0]'] && eventData['xaxis.range[1]']) {
                this.loadDetailDataForRange(
                    eventData['xaxis.range[0]'], 
                    eventData['xaxis.range[1]']
                );
            }
        }, this.config.zoomLoadDelay);
        
        this.state.plotDiv.on('plotly_relayout', debouncedZoomHandler);
    }
    
    async loadDetailDataForRange(startTime, endTime) {
        if (!this.state.currentExperiment) return;
        
        try {
            this.updateStatus('Loading detail data...', 'loading');
            
            // FIXED: Use correct C# controller endpoint with correct parameter names
            const url = `${this.config.apiBaseUrl}/experiments/${this.state.currentExperiment}/bin-oscilloscope/range?` +
                       `startTimeMs=${startTime * 1000}&endTimeMs=${endTime * 1000}&maxPoints=10000`; // Convert s to ms for API
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Detail request failed: ${response.status}`);
            }
            
            const result = await response.json();
            // FIXED: Handle C# API response structure
            if (!result.Success && !result.success) {
                throw new Error(result.Error || result.error || 'Failed to load detail data');
            }
            
            await this.updatePlotData(result.Data || result.data);
            
            this.updateStatus('Detail data loaded', 'loaded', 
                this.calculateTotalPoints(result.Data || result.data),
                `${startTime.toFixed(2)} - ${endTime.toFixed(2)} s`); // FIXED: Show seconds
            
            this.emit('zoomDataLoaded', {
                experimentId: this.state.currentExperiment,
                timeRange: { startTime, endTime },
                totalPoints: this.calculateTotalPoints(result.Data || result.data)
            });
            
        } catch (error) {
            console.error('Failed to load detail data:', error);
            this.updateStatus('Failed to load detail data', 'error');
        }
    }
    
    async updatePlotData(newData) {
        if (!this.state.plotDiv) return;
        
        const newTraces = this.createPlotlyTraces(newData);
        const update = {
            x: newTraces.map(trace => trace.x),
            y: newTraces.map(trace => trace.y)
        };
        
        const traceIndices = newTraces.map((_, index) => index);
        await Plotly.restyle(this.state.plotDiv, update, traceIndices);
        
        this.state.data = newData;
    }
    
    handleChannelToggle(channelIndex, visible) {
        this.state.channelVisibility[channelIndex] = visible;
        
        if (this.state.plotDiv && this.state.data) {
            // Find trace index for this channel
            const traceIndex = this.getTraceIndexForChannel(channelIndex);
            if (traceIndex !== -1) {
                Plotly.restyle(this.state.plotDiv, { visible: visible }, [traceIndex]);
            }
        }
        
        const config = this.channelConfig[channelIndex];
        this.emit('channelToggled', {
            experimentId: this.state.currentExperiment,
            channelIndex,
            visible,
            channelLabel: config?.label
        });
    }
    
    getTraceIndexForChannel(channelIndex) {
        if (!this.state.plotDiv?.data) return -1;
        
        const config = this.channelConfig[channelIndex];
        if (!config) return -1;
        
        return this.state.plotDiv.data.findIndex(trace => 
            trace.name && trace.name.includes(config.label)
        );
    }
    
    handleExportPNG() {
        if (!this.state.plotDiv) return;
        
        Plotly.downloadImage(this.state.plotDiv, {
            format: 'png',
            width: 1200,
            height: 800,
            filename: `oscilloscope_data_${this.state.currentExperiment}_${Date.now()}`
        });
        
        this.emit('plotExported', {
            experimentId: this.state.currentExperiment,
            format: 'png'
        });
    }
    
    handleResetZoom() {
        if (!this.state.plotDiv) return;
        
        Plotly.relayout(this.state.plotDiv, {
            'xaxis.autorange': true,
            'yaxis.autorange': true,
            'yaxis2.autorange': true,
            'yaxis3.autorange': true,
            'yaxis4.autorange': true
        });
    }
    
    async handleRetry() {
        if (this.state.currentExperiment) {
            await this.loadExperiment(this.state.currentExperiment);
        }
    }
    
    // State Management
    showLoading(message = 'Loading...') {
        this.state.isLoading = true;
        this.hideError();
        
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.remove('hidden');
        }
        if (this.elements.loadingMessage) {
            this.elements.loadingMessage.textContent = message;
        }
        this.updateStatus(message, 'loading');
    }
    
    hideLoading() {
        this.state.isLoading = false;
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.add('hidden');
        }
    }
    
    showError(message) {
        this.hideLoading();
        this.state.error = message;
        
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.remove('hidden');
        }
        if (this.elements.errorText) {
            this.elements.errorText.textContent = message;
        }
        this.updateStatus('Error', 'error');
    }
    
    hideError() {
        this.state.error = null;
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.add('hidden');
        }
    }
    
    updateStatus(message, state, totalPoints = null, timeRange = null) {
        if (this.elements.resolutionStatus) {
            this.elements.resolutionStatus.textContent = message;
        }
        
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.className = `status-indicator ${state}`;
        }
        
        if (totalPoints && this.elements.dataPoints) {
            this.elements.dataPoints.textContent = `Points: ${totalPoints.toLocaleString()}`;
        }
        
        if (timeRange && this.elements.timeRange) {
            this.elements.timeRange.textContent = `Range: ${timeRange}`;
        }
    }
    
    updateExperimentInfo(experimentId) {
        if (this.elements.experimentInfo) {
            this.elements.experimentInfo.textContent = `Experiment: ${experimentId}`;
        }
    }
    
    // Event System
    emit(eventName, data) {
        const fullEventName = `module:bin-oscilloscope:${eventName}`;
        const event = new CustomEvent(fullEventName, {
            detail: data,
            bubbles: true
        });
        document.dispatchEvent(event);
        console.log(`Event emitted: ${fullEventName}`, data);
    }
    
    onDataLoaded() {
        const allChannels = Object.keys(this.state.data?.Channels || this.state.data?.channels || {}).length;
        const rawChannels = Object.keys(this.state.data?.Channels || this.state.data?.channels || {})
            .filter(ch => parseInt(ch) >= 0 && parseInt(ch) <= 7).length;
        const calcChannels = Object.keys(this.state.data?.Channels || this.state.data?.channels || {})
            .filter(ch => parseInt(ch) >= 8 && parseInt(ch) <= 11).length;
            
        this.emit('dataLoaded', {
            experimentId: this.state.currentExperiment,
            totalPoints: this.calculateTotalPoints(this.state.data),
            totalChannels: allChannels,
            rawChannels: rawChannels,
            calculatedChannels: calcChannels,
            channels: Object.keys(this.channelConfig).map(ch => this.channelConfig[ch].label)
        });
    }
    
    onError(error) {
        this.showError(error.message);
        this.emit('error', {
            moduleName: 'bin-oscilloscope',
            message: error.message,
            recoverable: true
        });
    }
    
    // Utility Methods
    calculateTotalPoints(data) {
        return (data?.TimeArray || data?.timeArray)?.length || 0;
    }
    
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // Standard Module Interface
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
        // Clear timeouts
        if (this.state.zoomLoadingTimeout) {
            clearTimeout(this.state.zoomLoadingTimeout);
        }
        
        // Destroy Plotly chart
        if (this.state.plotDiv) {
            Plotly.purge(this.state.plotDiv);
            this.state.plotDiv = null;
        }
        
        // Remove event listeners
        document.removeEventListener('module:experiment-browser:experimentSelected', this.handleExperimentSelected);
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        // Clear state
        this.state = {};
        this.elements = {};
        
        console.log('BinOscilloscope destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config,
            availableChannels: Object.keys(this.channelConfig)
        };
    }
}

// Export for global access
window.BinOscilloscope = BinOscilloscope;