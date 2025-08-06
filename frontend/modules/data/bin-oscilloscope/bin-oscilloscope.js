/**
 * Binary Oscilloscope Module
 * Welding Parameter Visualization (4 Calculated Channels)
 * Shows DC voltage, DC current, and force calculations from PicoScope data
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
            channelVisibility: { 8: true, 9: true, 10: true, 11: true },
            isLoading: false,
            error: null,
            zoomLoadingTimeout: null
        };
        this.elements = {};
        
        // Channel configuration for calculated welding parameters (channels 8-11)
        this.channelConfig = {
            8: { 
                label: 'I_DC_GR1*', 
                unit: 'A', 
                axis: 'y2', 
                color: '#ff7f0e', 
                group: 'dc-current',
                description: 'DC Current Group 1'
            },
            9: { 
                label: 'I_DC_GR2*', 
                unit: 'A', 
                axis: 'y2', 
                color: '#d62728', 
                group: 'dc-current',
                description: 'DC Current Group 2'
            },
            10: { 
                label: 'U_DC*', 
                unit: 'V', 
                axis: 'y', 
                color: '#1f77b4', 
                group: 'dc-voltage',
                description: 'DC Voltage'
            },
            11: { 
                label: 'F_Schlitten*', 
                unit: 'kN', 
                axis: 'y3', 
                color: '#2ca02c', 
                group: 'force',
                description: 'Force from Pressure Sensors'
            }
        };
        
        console.log('BinOscilloscope initialized for welding parameters');
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
        // Channel toggle checkboxes for calculated channels (8-11)
        for (let i = 8; i < 12; i++) {
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
                this.showLoading('Loading welding parameter data...');
                await this.loadOverviewData(experimentId);
            }
            
        } catch (error) {
            console.error('Failed to load experiment:', error);
            this.onError(error);
        }
    }
    
    async loadMetadata(experimentId) {
        const url = `${this.config.apiBaseUrl}/experiments/${experimentId}/bin-oscilloscope/metadata`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Metadata request failed: ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to load metadata');
        }
        
        console.log('Metadata loaded:', result.data);
        return result.data;
    }
    
    async loadOverviewData(experimentId) {
        const url = `${this.config.apiBaseUrl}/experiments/${experimentId}/bin-oscilloscope/overview`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Overview request failed: ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to load overview data');
        }
        
        this.state.data = result.data;
        this.state.isLoaded = true;
        
        await this.initializePlot(result.data);
        this.setupZoomHandling();
        this.hideLoading();
        this.onDataLoaded();
        
        console.log(`Welding parameters loaded: ${this.calculateTotalPoints(result.data)} points`);
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
        
        // Only process calculated welding parameter channels (8-11)
        Object.entries(data.channels).forEach(([channelIndex, channelData]) => {
            const chIndex = parseInt(channelIndex);
            const config = this.channelConfig[chIndex];
            
            // Only show channels 8-11 (calculated welding parameters)
            if (this.state.channelVisibility[chIndex] && config && chIndex >= 8 && chIndex <= 11) {
                traces.push({
                    x: data.timeArray,
                    y: channelData.values,
                    name: `${config.label} (${config.unit})`,
                    type: 'scatter',
                    mode: 'lines',
                    line: { 
                        color: config.color,
                        width: config.group === 'dc-voltage' ? 2 : 1.5
                    },
                    yaxis: config.axis,
                    hovertemplate: `<b>${config.label}</b><br>` +
                                  `${config.description}<br>` +
                                  `Time: %{x:.2f} ms<br>` +
                                  `Value: %{y:.3f} ${config.unit}<extra></extra>`
                });
            }
        });
        
        return traces;
    }
    
    createPlotlyLayout(data) {
        return {
            title: {
                text: `Welding Parameters - ${this.state.currentExperiment}`,
                font: { size: 16, color: '#003278' }
            },
            xaxis: {
                title: 'Time (ms)',
                showgrid: true,
                gridcolor: '#E0E0E0'
            },
            yaxis: {
                title: 'DC Voltage (V)',
                titlefont: { color: '#1f77b4' },
                tickfont: { color: '#1f77b4' },
                side: 'left',
                showgrid: true,
                gridcolor: '#F0F0F0'
            },
            yaxis2: {
                title: 'DC Current (A)',
                titlefont: { color: '#ff7f0e' },
                tickfont: { color: '#ff7f0e' },
                overlaying: 'y',
                side: 'right',
                showgrid: false
            },
            yaxis3: {
                title: 'Force (kN)',
                titlefont: { color: '#2ca02c' },
                tickfont: { color: '#2ca02c' },
                overlaying: 'y',
                side: 'right',
                position: 0.95,
                showgrid: false
            },
            legend: {
                x: 0.01,
                y: 0.99,
                bgcolor: 'rgba(255, 255, 255, 0.8)',
                bordercolor: '#C8C8C8',
                borderwidth: 1
            },
            margin: { l: 60, r: 80, t: 50, b: 50 },
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
    
    async loadDetailDataForRange(startTimeMs, endTimeMs) {
        if (!this.state.currentExperiment) return;
        
        try {
            this.updateStatus('Loading detail data...', 'loading');
            
            const url = `${this.config.apiBaseUrl}/experiments/${this.state.currentExperiment}/bin-oscilloscope/range?` +
                       `startTimeMs=${startTimeMs}&endTimeMs=${endTimeMs}`;
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Detail request failed: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load detail data');
            }
            
            await this.updatePlotData(result.data);
            
            this.updateStatus('Detail data loaded', 'loaded', 
                this.calculateTotalPoints(result.data),
                `${startTimeMs.toFixed(0)} - ${endTimeMs.toFixed(0)} ms`);
            
            this.emit('zoomDataLoaded', {
                experimentId: this.state.currentExperiment,
                timeRange: { startTimeMs, endTimeMs },
                totalPoints: this.calculateTotalPoints(result.data)
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
            filename: `welding_parameters_${this.state.currentExperiment}_${Date.now()}`
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
            'yaxis3.autorange': true
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
        const weldingChannels = Object.keys(this.state.data?.channels || {})
            .filter(ch => parseInt(ch) >= 8 && parseInt(ch) <= 11)
            .length;
            
        this.emit('dataLoaded', {
            experimentId: this.state.currentExperiment,
            totalPoints: this.calculateTotalPoints(this.state.data),
            weldingChannels: weldingChannels,
            channels: ['DC Voltage', 'DC Current GR1', 'DC Current GR2', 'Force']
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
        return data?.timeArray?.length || 0;
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