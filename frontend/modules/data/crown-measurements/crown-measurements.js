/**
 * Crown Measurements Module
 * Displays crown measurement data with 4 sections: warm side, cold side, top view, calculated values
 * Integrates with crown measurement backend service (Excel + Journal hybrid)
 * Features: Warm/Cold comparison, Top view geometry, Calculated AD values
 */

class CrownMeasurements {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        this.state = {
            isLoaded: false,
            isVisible: false,
            experimentId: null,
            metadata: null,
            channelData: null,
            areSectionsReady: false
        };
        this.elements = {};
        this.plots = {
            warmCrownPlot: null,
            coldCrownPlot: null,
            topViewPlot: null
        };
        
        console.log('CrownMeasurements initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            maxPoints: 1000,  // Crown data is typically small
            plotHeight: 280,
            colors: {
                warm: '#FF5722',        // Orange for warm measurements
                cold: '#2196F3',        // Blue for cold measurements
                topView: '#4CAF50',     // Green for top view
                calculated: '#9C27B0',  // Purple for calculated
                reference: '#666666'    // Gray for reference lines
            },
            // Crown measurement specific settings
            expectedUnits: { crown: 'mm', temperature: 'state' },
            measurementType: 'Rail Crown Geometry Analysis',
            scalingFactor: 30 // 30x scaling for visualization
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
            console.log('CrownMeasurements initialized successfully');
            
        } catch (error) {
            console.error('CrownMeasurements initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'CrownMeasurementsTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/data/crown-measurements/crown-measurements.html');
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
            'warmCrownPlot', 'coldCrownPlot', 'topViewPlot', 'calculatedValuesDisplay',
            'loadingSpinner', 'errorMessage', 'sectionsContainer'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Crown plots use standard Plotly interactions
        // No custom scrolling needed - crown data is small and focused
    }
    
    /**
     * Load experiment data (Standard module interface)
     * @param {string} experimentId - Experiment ID
     */
    async loadExperiment(experimentId) {
        try {
            console.log(`Loading crown measurement data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId} - ${this.config.measurementType}`;
            }
            
            // Load metadata first
            await this.loadCrownMetadata();
            
            // Load all four channel data types
            await this.loadAllChannelData();
            
            // Create all visualizations (3 plots + 1 calculated display)
            await this.createAllVisualizations();
            
            this.state.isLoaded = true;
            this.hideLoading();
            
            console.log(`Crown measurement data loaded successfully for ${experimentId}`);
            
        } catch (error) {
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Load crown measurement metadata
     */
    async loadCrownMetadata() {
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/crown-metadata`
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Crown measurement files not found for this experiment');
                }
                throw new Error(`Failed to load crown metadata: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load crown metadata');
            }
            
            this.state.metadata = result.data;
            
            // Update header metadata displays
            this.updateHeaderMetadata(result.data);
            
            console.log('Crown metadata loaded:', {
                experimentId: this.state.experimentId,
                comparison: result.data.comparison,
                crownInfo: result.data.crownInfo
            });
            
        } catch (error) {
            throw new Error(`Crown metadata loading failed: ${error.message}`);
        }
    }
    
    /**
     * Update header metadata displays
     */
    updateHeaderMetadata(metadata) {
        // Update measurement time info
        if (this.elements.warmMeasurementTime && metadata.crownInfo.zeitabstandCrownMessung) {
            this.elements.warmMeasurementTime.textContent = 
                `Measured ${metadata.crownInfo.zeitabstandCrownMessung} minutes after welding`;
        }
        
        // Update measurement info displays
        if (this.elements.coldMeasurementInfo) {
            this.elements.coldMeasurementInfo.textContent = 'Excel cells: J18, N18';
        }
        
        if (this.elements.topViewMeasurementInfo) {
            this.elements.topViewMeasurementInfo.textContent = 'Excel cells: J23, N23, J24, N24, J31, N31, J32, N32';
        }
        
        if (this.elements.calculatedMeasurementInfo) {
            this.elements.calculatedMeasurementInfo.textContent = 'Excel AD cells: AD19-AD31';
        }
    }
    
    /**
     * Load all four channel data types
     */
    async loadAllChannelData() {
        try {
            console.log('Loading all crown channel data...');
            
            // Use bulk endpoint to get all channels at once
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/crown-data/bulk`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        channelIds: ['crown_warm_side', 'crown_cold_side', 'crown_top_view', 'crown_calculated'],
                        maxPoints: this.config.maxPoints
                    })
                }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to load crown channel data: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load crown channel data');
            }
            
            // Process the bulk response
            this.state.channelData = {};
            
            for (const [channelId, channelResult] of Object.entries(result.data.channels)) {
                if (channelResult.success) {
                    this.state.channelData[channelId] = {
                        success: true,
                        data: channelResult.data,
                        metadata: channelResult.metadata
                    };
                } else {
                    console.warn(`Failed to load channel ${channelId}:`, channelResult.error);
                    this.state.channelData[channelId] = { success: false, error: channelResult.error };
                }
            }
            
            console.log(`Loaded crown channels successfully:`, Object.keys(this.state.channelData));
            
        } catch (error) {
            throw new Error(`Crown channel data loading failed: ${error.message}`);
        }
    }
    
    /**
     * Create all visualizations (3 plots + 1 calculated display)
     */
    async createAllVisualizations() {
        if (!this.elements.warmCrownPlot || !this.elements.coldCrownPlot || 
            !this.elements.topViewPlot || !this.elements.calculatedValuesDisplay || 
            !this.state.channelData) {
            throw new Error('Missing visualization containers or crown data');
        }
        
        try {
            console.log('Creating all crown visualizations...');
            
            // Create visualizations in sequence
            await this.createWarmSidePlot();
            await this.createColdSidePlot();
            await this.createTopViewPlot();
            await this.createCalculatedDisplay();
            
            // Setup event handlers for plots
            this.attachPlotEvents();
            
            this.state.areSectionsReady = true;
            this.showSections();
            
            console.log('All crown visualizations created successfully');
            
        } catch (error) {
            throw new Error(`Crown visualizations creation failed: ${error.message}`);
        }
    }
    
    /**
     * Create warm side view plot (journal data)
     */
    async createWarmSidePlot() {
        const channelData = this.state.channelData.crown_warm_side;
        if (!channelData || !channelData.success) {
            throw new Error('Warm crown data not available');
        }
        
        const data = channelData.data;
        const traces = [];
        
        // Create side view plot with inlet and outlet measurements
        const positions = [data.positions.outlet.x, data.positions.inlet.x]; // [-50, 50]
        const heights = [data.outlet, data.inlet]; // Warm measurements
        const labels = ['Outlet (Auslauf)', 'Inlet (Einlauf)'];
        
        // Main trace: Warm crown profile
        traces.push({
            x: positions,
            y: heights,
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Warm Crown Profile',
            line: { 
                color: this.config.colors.warm,
                width: 3
            },
            marker: {
                color: this.config.colors.warm,
                size: 10,
                symbol: 'circle'
            },
            hovertemplate: 
                '<b>%{text}</b><br>' +
                'Position: %{x} mm<br>' +
                'Height: %{y:.3f} mm<br>' +
                '<extra></extra>',
            text: labels
        });
        
        // Add reference line at y=0
        traces.push({
            x: [-100, 100],
            y: [0, 0],
            type: 'scatter',
            mode: 'lines',
            name: 'Reference Line',
            line: { 
                color: this.config.colors.reference,
                width: 1,
                dash: 'dash'
            },
            hovertemplate: '<b>Reference</b><br>Height: 0 mm<extra></extra>'
        });
        
        const layout = {
            title: { text: '', font: { size: 0 } },
            
            xaxis: {
                title: 'Position [mm]',
                showgrid: true,
                gridcolor: 'rgba(255, 87, 34, 0.1)',
                tickfont: { color: '#666666' },
                range: [-80, 80]
            },
            
            yaxis: {
                title: { 
                    text: 'Crown Height [mm]', 
                    font: { color: this.config.colors.warm, size: 14 }
                },
                showgrid: true,
                gridcolor: 'rgba(255, 87, 34, 0.1)',
                tickfont: { color: this.config.colors.warm },
                titlefont: { color: this.config.colors.warm },
                zeroline: true,
                zerolinecolor: 'rgba(255, 87, 34, 0.3)'
            },
            
            legend: {
                x: 0.02, y: 0.98,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(255, 87, 34, 0.3)',
                borderwidth: 1
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(255, 87, 34, 0.02)',
            paper_bgcolor: '#ffffff',
            autosize: true,
            showlegend: true
        };
        
        const config = this.createPlotConfig('warm_crown');
        
        this.plots.warmCrownPlot = await Plotly.newPlot(
            this.elements.warmCrownPlot, 
            traces, 
            layout, 
            config
        );
    }
    
    /**
     * Create cold side view plot (Excel data)
     */
    async createColdSidePlot() {
        const channelData = this.state.channelData.crown_cold_side;
        if (!channelData || !channelData.success) {
            throw new Error('Cold crown data not available');
        }
        
        const data = channelData.data;
        const traces = [];
        
        // Create side view plot with inlet and outlet measurements
        const positions = [data.positions.outlet.x, data.positions.inlet.x]; // [-50, 50]
        const heights = [data.outlet, data.inlet]; // Cold measurements
        const labels = ['Outlet (J18)', 'Inlet (N18)'];
        
        // Main trace: Cold crown profile
        traces.push({
            x: positions,
            y: heights,
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Cold Crown Profile',
            line: { 
                color: this.config.colors.cold,
                width: 3
            },
            marker: {
                color: this.config.colors.cold,
                size: 10,
                symbol: 'circle'
            },
            hovertemplate: 
                '<b>%{text}</b><br>' +
                'Position: %{x} mm<br>' +
                'Height: %{y:.3f} mm<br>' +
                '<extra></extra>',
            text: labels
        });
        
        // Add reference line at y=0
        traces.push({
            x: [-100, 100],
            y: [0, 0],
            type: 'scatter',
            mode: 'lines',
            name: 'Reference Line',
            line: { 
                color: this.config.colors.reference,
                width: 1,
                dash: 'dash'
            },
            hovertemplate: '<b>Reference</b><br>Height: 0 mm<extra></extra>'
        });
        
        const layout = {
            title: { text: '', font: { size: 0 } },
            
            xaxis: {
                title: 'Position [mm]',
                showgrid: true,
                gridcolor: 'rgba(33, 150, 243, 0.1)',
                tickfont: { color: '#666666' },
                range: [-80, 80]
            },
            
            yaxis: {
                title: { 
                    text: 'Crown Height [mm]', 
                    font: { color: this.config.colors.cold, size: 14 }
                },
                showgrid: true,
                gridcolor: 'rgba(33, 150, 243, 0.1)',
                tickfont: { color: this.config.colors.cold },
                titlefont: { color: this.config.colors.cold },
                zeroline: true,
                zerolinecolor: 'rgba(33, 150, 243, 0.3)'
            },
            
            legend: {
                x: 0.02, y: 0.98,
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: 'rgba(33, 150, 243, 0.3)',
                borderwidth: 1
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(33, 150, 243, 0.02)',
            paper_bgcolor: '#ffffff',
            autosize: true,
            showlegend: true
        };
        
        const config = this.createPlotConfig('cold_crown');
        
        this.plots.coldCrownPlot = await Plotly.newPlot(
            this.elements.coldCrownPlot, 
            traces, 
            layout, 
            config
        );
    }
    
    /**
     * Create top view plot (Excel lateral deviations - converted from Python script)
     */
    async createTopViewPlot() {
        const channelData = this.state.channelData.crown_top_view;
        if (!channelData || !channelData.success) {
            throw new Error('Top view crown data not available');
        }
        
        const data = channelData.data;
        const traces = [];
        
        // 1. Create reference lines (rail layout)
        const yPositions = [-62.5, -32.5, 32.5, 62.5];
        const xRange = [-600, 600];
        
        // Horizontal reference lines
        for (const yPos of yPositions) {
            traces.push({
                x: xRange,
                y: [yPos, yPos],
                type: 'scatter',
                mode: 'lines',
                name: '',
                line: { color: 'black', width: 2 },
                showlegend: false,
                hoverinfo: 'skip'
            });
        }
        
        // Vertical connection lines
        traces.push({
            x: [-600, -600],
            y: [62.5, -62.5],
            type: 'scatter',
            mode: 'lines',
            line: { color: 'black', width: 2 },
            showlegend: false,
            hoverinfo: 'skip'
        });
        
        traces.push({
            x: [600, 600],
            y: [62.5, -62.5],
            type: 'scatter',
            mode: 'lines',
            line: { color: 'black', width: 2 },
            showlegend: false,
            hoverinfo: 'skip'
        });
        
        // 2. Add support positions (green for positive Y, orange for negative Y)
        const supportPositions = [500, -500];
        
        // Positive Y supports (green)
        for (const yPos of [32.5, 62.5]) {
            for (const xPos of supportPositions) {
                traces.push({
                    x: [xPos],
                    y: [yPos],
                    type: 'scatter',
                    mode: 'markers',
                    marker: { color: 'green', size: 8, symbol: 'square' },
                    showlegend: false,
                    hoverinfo: 'skip'
                });
            }
        }
        
        // Negative Y supports (orange)
        for (const yPos of [-32.5, -62.5]) {
            for (const xPos of supportPositions) {
                traces.push({
                    x: [xPos],
                    y: [yPos],
                    type: 'scatter',
                    mode: 'markers',
                    marker: { color: 'orange', size: 8, symbol: 'square' },
                    showlegend: false,
                    hoverinfo: 'skip'
                });
            }
        }
        
        // 3. Add measurement points with deviations (30x scaled)
        for (const position of data.positions) {
            const yActual = position.y + (position.value * this.config.scalingFactor);
            const xActual = position.x;
            
            // Nominal position (gray)
            traces.push({
                x: [position.x],
                y: [position.y],
                type: 'scatter',
                mode: 'markers',
                marker: { color: 'lightgray', size: 6 },
                showlegend: false,
                hoverinfo: 'skip'
            });
            
            // Actual position (color-coded)
            const color = Math.abs(position.y) === 62.5 ? 'red' : 'blue';
            traces.push({
                x: [xActual],
                y: [yActual],
                type: 'scatter',
                mode: 'markers',
                marker: { color: color, size: 8 },
                showlegend: false,
                hovertemplate: 
                    `<b>${position.label}</b><br>` +
                    `Position: ${position.x} mm<br>` +
                    `Deviation: ${position.value.toFixed(3)} mm<br>` +
                    `Scaled Position: ${yActual.toFixed(1)} mm<br>` +
                    '<extra></extra>'
            });
            
            // Rail line from support to measurement
            const supportX = position.x > 0 ? 500 : -500;
            
            // Calculate Y at center (X=0)
            let yAtX0;
            if (yActual !== position.y) {
                const slope = (yActual - position.y) / (xActual - supportX);
                yAtX0 = yActual + (0 - xActual) * slope;
            } else {
                yAtX0 = yActual;
            }
            
            traces.push({
                x: [supportX, xActual, 0],
                y: [position.y, yActual, yAtX0],
                type: 'scatter',
                mode: 'lines',
                line: { color: color, width: 3 },
                showlegend: false,
                hoverinfo: 'skip'
            });
        }
        
        const layout = {
            title: { text: '', font: { size: 0 } },
            
            xaxis: {
                title: 'X-Position [mm]',
                showgrid: true,
                gridcolor: 'rgba(76, 175, 80, 0.1)',
                tickfont: { color: '#666666' },
                range: [-650, 650],
                zeroline: true,
                zerolinecolor: 'black'
            },
            
            yaxis: {
                title: { 
                    text: 'Y-Position [mm]', 
                    font: { color: this.config.colors.topView, size: 14 }
                },
                showgrid: true,
                gridcolor: 'rgba(76, 175, 80, 0.1)',
                tickfont: { color: this.config.colors.topView },
                titlefont: { color: this.config.colors.topView },
                range: [-100, 100],
                zeroline: true,
                zerolinecolor: 'black'
            },
            
            height: this.config.plotHeight,
            margin: { l: 80, r: 40, t: 30, b: 60 },
            plot_bgcolor: 'rgba(76, 175, 80, 0.02)',
            paper_bgcolor: '#ffffff',
            autosize: true,
            showlegend: false
        };
        
        const config = this.createPlotConfig('top_view');
        
        this.plots.topViewPlot = await Plotly.newPlot(
            this.elements.topViewPlot, 
            traces, 
            layout, 
            config
        );
    }
    
    /**
     * Create calculated values display (text-based, not Plotly)
     */
    async createCalculatedDisplay() {
        const channelData = this.state.channelData.crown_calculated;
        if (!channelData || !channelData.success) {
            throw new Error('Calculated crown data not available');
        }
        
        const data = channelData.data;
        const comparison = this.state.metadata.comparison;
        
        // Update all calculated value elements
        this.updateCalculatedValue('höhenversatzValue', data.values.höhenversatz);
        this.updateCalculatedValue('crownValue', data.values.crown);
        this.updateCalculatedValue('seitenversatzKopfAValue', data.values.seitenversatzKopfA);
        this.updateCalculatedValue('seitenversatzFussAValue', data.values.seitenversatzFussA);
        this.updateCalculatedValue('seitenversatzKopfBValue', data.values.seitenversatzKopfB);
        this.updateCalculatedValue('seitenversatzFussBValue', data.values.seitenversatzFussB);
        this.updateCalculatedValue('pfeilungAValue', data.values.pfeilungA);
        this.updateCalculatedValue('pfeilungBValue', data.values.pfeilungB);
        
        // Update warm vs cold comparison
        if (comparison) {
            this.updateCalculatedValue('inletColdValue', comparison.inlet.cold);
            this.updateCalculatedValue('inletWarmValue', comparison.inlet.warm);
            this.updateCalculatedValue('inletDifferenceValue', comparison.inlet.difference);
            
            this.updateCalculatedValue('outletColdValue', comparison.outlet.cold);
            this.updateCalculatedValue('outletWarmValue', comparison.outlet.warm);
            this.updateCalculatedValue('outletDifferenceValue', comparison.outlet.difference);
        }
        
        console.log('Calculated values display updated successfully');
    }
    
    /**
     * Update a calculated value element
     */
    updateCalculatedValue(elementName, value) {
        const element = this.elements[elementName];
        if (element) {
            if (value !== null && value !== undefined) {
                element.textContent = value.toFixed(3);
                element.classList.remove('missing-value');
            } else {
                element.textContent = '--';
                element.classList.add('missing-value');
            }
        }
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
                filename: `crown_${plotType}_${this.state.experimentId}`,
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
        // Crown plots are independent - no synchronization needed
        // Individual plot interactions handled by Plotly
    }
    
    // === STATE MANAGEMENT ===
    
    showLoading() {
        this.hideError();
        this.hideSections();
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
        this.hideSections();
        
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
    
    showSections() {
        this.hideLoading();
        this.hideError();
        
        if (this.elements.sectionsContainer) {
            this.elements.sectionsContainer.classList.remove('hidden');
        }
    }
    
    hideSections() {
        if (this.elements.sectionsContainer) {
            this.elements.sectionsContainer.classList.add('hidden');
        }
    }
    
    onError(error) {
        const message = error.message || 'Failed to load crown measurement data';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'crown-measurements',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:crown-measurements:${eventName}`;
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
        
        console.log('CrownMeasurements destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config
        };
    }
    
    // === CROWN-SPECIFIC METHODS ===
    
    /**
     * Get warm vs cold comparison data
     * @returns {Object|null} Comparison data
     */
    getWarmColdComparison() {
        return this.state.metadata?.comparison || null;
    }
    
    /**
     * Get calculated crown values
     * @returns {Object|null} Calculated values
     */
    getCalculatedValues() {
        const channelData = this.state.channelData?.crown_calculated;
        return channelData?.success ? channelData.data.values : null;
    }
    
    /**
     * Get crown measurement summary for reporting
     * @returns {Object|null} Summary data
     */
    getCrownSummary() {
        if (!this.state.metadata || !this.state.channelData) return null;
        
        const comparison = this.getWarmColdComparison();
        const calculated = this.getCalculatedValues();
        
        return {
            experimentId: this.state.experimentId,
            comparison: comparison,
            calculatedValues: calculated,
            measurementTime: this.state.metadata.crownInfo?.zeitabstandCrownMessung,
            scalingFactor: this.config.scalingFactor,
            dataQuality: {
                warmDataAvailable: this.state.channelData.crown_warm_side?.success || false,
                coldDataAvailable: this.state.channelData.crown_cold_side?.success || false,
                topViewDataAvailable: this.state.channelData.crown_top_view?.success || false,
                calculatedDataAvailable: this.state.channelData.crown_calculated?.success || false
            }
        };
    }
}

// Export for global access
window.CrownMeasurements = CrownMeasurements;