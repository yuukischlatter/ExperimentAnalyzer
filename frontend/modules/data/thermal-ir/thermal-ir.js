/**
 * Thermal IR Module
 * Interactive thermal video analysis with real-time WebSocket integration
 * Features: Video playback, line drawing, temperature analysis, real-time charts
 * Integration: WebSocket connection to /thermal-ws endpoint
 * Desktop-only application
 */

class ThermalIr {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        
        // Module state
        this.state = {
            isLoaded: false,
            isVisible: false,
            experimentId: null,
            
            // WebSocket states
            wsConnected: false,
            engineReady: false,
            videoLoaded: false,
            
            // Video states
            videoInfo: {},
            currentFrame: 0,
            isPlaying: false,
            
            // Analysis states
            line1: { x1: 0, y1: 0, x2: 0, y2: 0 }, // Horizontal line (blue)
            line2: { x1: 0, y1: 0, x2: 0, y2: 0 }, // Vertical line (green)
            dragging: null,
            lastAnalysisTime: 0
        };
        
        // DOM elements and objects
        this.elements = {};
        this.webSocket = null;
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.plots = {
            horizontal: null,
            vertical: null
        };
        
        console.log('ThermalIr initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            wsEndpoint: '/thermal-ws',
            autoLoad: true,
            maxAnalysisRate: 10, // Max analysis requests per second
            plotHeight: 250,
            colors: {
                line1: '#2563eb', // Horizontal line (blue)
                line2: '#059669', // Vertical line (green)
                grid: 'rgba(0, 50, 120, 0.1)',
                background: '#003278'
            },
            videoAspectRatio: 908/1200, // Thermal video aspect ratio
            dragThreshold: 15, // Pixel threshold for endpoint detection
            reconnectDelay: 3000 // WebSocket reconnection delay
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
            console.log('ThermalIr initialized successfully');
            
        } catch (error) {
            console.error('ThermalIr initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        const templateVar = 'ThermalIrTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            const response = await fetch('/modules/data/thermal-ir/thermal-ir.html');
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
        
        // Set up core elements
        this.video = this.elements.thermalVideo;
        this.canvas = this.elements.lineOverlay;
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
        }
        
        // Verify critical elements exist
        const requiredElements = [
            'thermalVideo', 'lineOverlay', 'playButton', 'frameSlider',
            'loadingSpinner', 'errorMessage', 'sectionsContainer',
            'horizontalTemperaturePlot', 'verticalTemperaturePlot'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Video events
        if (this.video) {
            this.video.addEventListener('timeupdate', () => this.handleVideoTimeUpdate());
            this.video.addEventListener('loadedmetadata', () => this.handleVideoMetadata());
        }
        
        // Canvas events for line drawing
        if (this.canvas) {
            this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
            this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        }
        
        // Control events
        if (this.elements.playButton) {
            this.elements.playButton.addEventListener('click', () => this.togglePlayPause());
        }
        
        if (this.elements.frameSlider) {
            this.elements.frameSlider.addEventListener('input', (e) => this.handleFrameSlider(e));
        }
    }
    
    /**
     * Load experiment data (Standard module interface)
     */
    async loadExperiment(experimentId) {
        try {
            console.log(`Loading thermal data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId} - Interactive thermal video analysis`;
            }
            
            // Setup WebSocket connection
            await this.setupWebSocket();
            
            // Load thermal video
            await this.loadThermalVideo(experimentId);
            
            // Initialize charts
            this.createTemperatureCharts();
            
            this.state.isLoaded = true;
            this.hideLoading();
            
            console.log(`Thermal data loaded successfully for ${experimentId}`);
            
        } catch (error) {
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Setup WebSocket connection
     */
    async setupWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.host}${this.config.wsEndpoint}`;
                
                console.log(`Connecting to WebSocket: ${wsUrl}`);
                
                this.webSocket = new WebSocket(wsUrl);
                
                this.webSocket.onopen = () => {
                    this.state.wsConnected = true;
                    this.updateConnectionStatus();
                    console.log('WebSocket connected');
                    resolve(); // ← This resolves the promise properly
                };
                
                this.webSocket.onmessage = (event) => {
                    this.handleWebSocketMessage(event);
                };
                
                this.webSocket.onclose = () => {
                    this.state.wsConnected = false;
                    this.updateConnectionStatus();
                    console.log('WebSocket disconnected');
                    
                    // Auto-reconnect
                    setTimeout(() => {
                        if (this.state.experimentId && !this.state.wsConnected) {
                            this.setupWebSocket();
                        }
                    }, this.config.reconnectDelay);
                };
                
                this.webSocket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.updateConnectionStatus();
                    reject(new Error('WebSocket connection failed'));
                };
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Handle WebSocket messages
     */
    handleWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
                case 'connected':
                    console.log('WebSocket connection established');
                    break;
                    
                case 'videoLoaded':
                    this.handleVideoLoaded(message.data);
                    break;
                    
                case 'analysisResult':
                    this.handleAnalysisResult(message.data);
                    break;
                    
                case 'error':
                    console.error('WebSocket error:', message.data.message);
                    this.updateAnalysisInfo(`Error: ${message.data.message}`);
                    break;
                    
                default:
                    console.warn('Unknown WebSocket message type:', message.type);
            }
            
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    }
    
    /**
     * Send WebSocket message
     */
    sendWebSocketMessage(type, data) {
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            const message = {
                type: type,
                data: data
            };
            
            this.webSocket.send(JSON.stringify(message));
            return true;
        }
        
        console.warn(`Cannot send WebSocket message - readyState: ${this.webSocket ? this.webSocket.readyState : 'null'}`);
        return false;
    }
    
    /**
     * Load thermal video
     */
    async loadThermalVideo(experimentId) {
        console.log('Loading thermal video...');
        
        // Wait for WebSocket to be fully ready
        if (!this.state.wsConnected) {
            console.log('Waiting for WebSocket connection...');
            await new Promise((resolve, reject) => {
                const checkConnection = () => {
                    if (this.state.wsConnected && this.webSocket.readyState === WebSocket.OPEN) {
                        resolve();
                    } else if (this.webSocket.readyState === WebSocket.CLOSED || this.webSocket.readyState === WebSocket.CLOSING) {
                        reject(new Error('WebSocket connection failed'));
                    } else {
                        setTimeout(checkConnection, 50); // Check every 50ms
                    }
                };
                checkConnection();
            });
        }
        
        const success = this.sendWebSocketMessage('loadVideo', {
            experimentId: experimentId
        });
        
        if (!success) {
            throw new Error('Failed to send loadVideo message - WebSocket not connected');
        }
        
        // Wait for video loaded response
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Thermal video loading timeout'));
            }, 10000);
            
            const originalHandler = this.handleVideoLoaded.bind(this);
            this.handleVideoLoaded = (data) => {
                clearTimeout(timeout);
                this.handleVideoLoaded = originalHandler;
                originalHandler(data);
                resolve();
            };
        });
    }
    
    /**
     * Handle video loaded response
     */
    handleVideoLoaded(data) {
        console.log('Thermal video loaded:', data);
        
        this.state.videoInfo = data.metadata.videoInfo;
        this.state.videoLoaded = true;
        this.state.engineReady = true;
        
        this.updateConnectionStatus();
        this.setupVideoControls();
        this.setupCanvas();
        this.initializeDefaultLines();
        
        // Update video info display
        if (this.elements.videoInfo) {
            const info = this.state.videoInfo;
            this.elements.videoInfo.textContent = 
                `${info.frames} frames, ${info.fps} FPS, ${info.width}x${info.height}`;
        }
        
        console.log('Video setup completed');
    }
    
    /**
     * Setup video controls
     */
    setupVideoControls() {
        const info = this.state.videoInfo;
        
        // Enable controls
        if (this.elements.playButton) {
            this.elements.playButton.disabled = false;
        }
        
        if (this.elements.frameSlider) {
            this.elements.frameSlider.disabled = false;
            this.elements.frameSlider.max = info.frames - 1;
            this.elements.frameSlider.value = 0;
        }
        
        this.updateFrameInfo(0);
    }
    
    /**
     * Setup canvas for line drawing
     */
    setupCanvas() {
        if (!this.canvas || !this.video) return;
        
        // Wait for video to be ready
        setTimeout(() => {
            this.adjustCanvasSize();
            this.initializeDefaultLines();
            this.drawLines();
        }, 100);
    }
    
    /**
     * Adjust canvas size to match video
     */
    adjustCanvasSize() {
        if (!this.canvas || !this.video) return;
        
        const videoRect = this.video.getBoundingClientRect();
        const containerRect = this.video.parentElement.getBoundingClientRect();
        
        // Calculate display size based on aspect ratio
        const videoAspectRatio = this.config.videoAspectRatio;
        const containerAspectRatio = containerRect.width / containerRect.height;
        
        let displayWidth, displayHeight;
        
        if (containerAspectRatio > videoAspectRatio) {
            displayHeight = containerRect.height;
            displayWidth = displayHeight * videoAspectRatio;
        } else {
            displayWidth = containerRect.width;
            displayHeight = displayWidth / videoAspectRatio;
        }
        
        // Set canvas size
        this.canvas.width = displayWidth;
        this.canvas.height = displayHeight;
        
        // Center canvas
        const leftOffset = (containerRect.width - displayWidth) / 2;
        const topOffset = (containerRect.height - displayHeight) / 2;
        
        this.canvas.style.left = leftOffset + 'px';
        this.canvas.style.top = topOffset + 'px';
    }
    
    /**
     * Initialize default line positions
     */
    initializeDefaultLines() {
        if (!this.canvas) return;
        
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Horizontal line (Line 1 - blue)
        this.state.line1 = {
            x1: width * 0.1,
            y1: height * 0.5,
            x2: width * 0.9,
            y2: height * 0.5
        };
        
        // Vertical line (Line 2 - green)
        this.state.line2 = {
            x1: width * 0.5,
            y1: height * 0.1,
            x2: width * 0.5,
            y2: height * 0.9
        };
        
        this.drawLines();
    }
    
    /**
     * Mouse event handlers for line drawing
     */
    handleMouseDown(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const nearestEndpoint = this.getNearestEndpoint(x, y);
        if (nearestEndpoint) {
            this.state.dragging = nearestEndpoint;
            this.canvas.classList.add('grabbing-cursor');
            event.preventDefault();
        }
    }
    
    handleMouseMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        if (this.state.dragging) {
            const constrainedX = Math.max(0, Math.min(this.canvas.width - 1, x));
            const constrainedY = Math.max(0, Math.min(this.canvas.height - 1, y));
            
            this.updateDraggedEndpoint(constrainedX, constrainedY);
            this.drawLines();
            this.requestAnalysis();
        } else {
            const nearestEndpoint = this.getNearestEndpoint(x, y);
            this.canvas.className = nearestEndpoint ? 'grab-cursor' : '';
        }
    }
    
    handleMouseUp(event) {
        if (this.state.dragging) {
            this.state.dragging = null;
            this.canvas.classList.remove('grabbing-cursor');
            this.requestAnalysis();
        }
    }
    
    /**
     * Find nearest line endpoint for dragging
     */
    getNearestEndpoint(x, y) {
        const endpoints = [
            { name: 'line1_start', x: this.state.line1.x1, y: this.state.line1.y1 },
            { name: 'line1_end', x: this.state.line1.x2, y: this.state.line1.y2 },
            { name: 'line2_start', x: this.state.line2.x1, y: this.state.line2.y1 },
            { name: 'line2_end', x: this.state.line2.x2, y: this.state.line2.y2 }
        ];
        
        let minDistance = Infinity;
        let nearestEndpoint = null;
        
        for (const endpoint of endpoints) {
            const distance = Math.sqrt((x - endpoint.x) ** 2 + (y - endpoint.y) ** 2);
            if (distance <= this.config.dragThreshold && distance < minDistance) {
                minDistance = distance;
                nearestEndpoint = endpoint.name;
            }
        }
        
        return nearestEndpoint;
    }
    
    /**
     * Update dragged endpoint position
     */
    updateDraggedEndpoint(x, y) {
        switch (this.state.dragging) {
            case 'line1_start': 
                this.state.line1.x1 = x; 
                this.state.line1.y1 = y; 
                break;
            case 'line1_end': 
                this.state.line1.x2 = x; 
                this.state.line1.y2 = y; 
                break;
            case 'line2_start': 
                this.state.line2.x1 = x; 
                this.state.line2.y1 = y; 
                break;
            case 'line2_end': 
                this.state.line2.x2 = x; 
                this.state.line2.y2 = y; 
                break;
        }
    }
    
    /**
     * Draw lines on canvas
     */
    drawLines() {
        if (!this.ctx) return;
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Line 1 (horizontal - blue)
        this.ctx.strokeStyle = this.config.colors.line1;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(this.state.line1.x1, this.state.line1.y1);
        this.ctx.lineTo(this.state.line1.x2, this.state.line1.y2);
        this.ctx.stroke();
        
        // Line 2 (vertical - green)
        this.ctx.strokeStyle = this.config.colors.line2;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(this.state.line2.x1, this.state.line2.y1);
        this.ctx.lineTo(this.state.line2.x2, this.state.line2.y2);
        this.ctx.stroke();
        
        // Draw endpoints
        this.drawEndpoint(this.state.line1.x1, this.state.line1.y1, this.config.colors.line1);
        this.drawEndpoint(this.state.line1.x2, this.state.line1.y2, this.config.colors.line1);
        this.drawEndpoint(this.state.line2.x1, this.state.line2.y1, this.config.colors.line2);
        this.drawEndpoint(this.state.line2.x2, this.state.line2.y2, this.config.colors.line2);
    }
    
    /**
     * Draw line endpoint
     */
    drawEndpoint(x, y, color) {
        this.ctx.fillStyle = color;
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 6, 0, 2 * Math.PI);
        this.ctx.fill();
        this.ctx.stroke();
    }
    
    /**
     * Video control handlers
     */
    togglePlayPause() {
        if (!this.video || !this.state.videoLoaded) return;
        
        if (this.video.paused) {
            this.video.play();
            this.state.isPlaying = true;
            if (this.elements.playButtonText) {
                this.elements.playButtonText.textContent = 'Pause';
            }
        } else {
            this.video.pause();
            this.state.isPlaying = false;
            if (this.elements.playButtonText) {
                this.elements.playButtonText.textContent = 'Play';
            }
        }
    }
    
    handleVideoTimeUpdate() {
        if (!this.state.videoLoaded || !this.state.videoInfo.fps) return;
        
        const currentFrame = Math.floor(this.video.currentTime * this.state.videoInfo.fps);
        this.state.currentFrame = currentFrame;
        
        this.updateFrameInfo(currentFrame);
        
        // Update slider if not being dragged
        if (this.elements.frameSlider && !this.elements.frameSlider.dataset.dragging) {
            this.elements.frameSlider.value = currentFrame;
        }
        
        this.requestAnalysis();
    }
    
    handleVideoMetadata() {
        setTimeout(() => {
            this.adjustCanvasSize();
            this.initializeDefaultLines();
            this.drawLines();
        }, 100);
    }
    
    handleFrameSlider(event) {
        const frameNumber = parseInt(event.target.value);
        this.seekToFrame(frameNumber);
        this.requestAnalysis();
    }
    
    /**
     * Seek to specific frame
     */
    seekToFrame(frameNumber) {
        if (!this.video || !this.state.videoInfo.fps) return;
        
        const time = frameNumber / this.state.videoInfo.fps;
        this.video.currentTime = time;
        this.state.currentFrame = frameNumber;
        this.updateFrameInfo(frameNumber);
    }
    
    /**
     * Update frame information display
     */
    updateFrameInfo(frameNumber) {
        if (this.elements.frameInfo) {
            const total = this.state.videoInfo.frames - 1;
            this.elements.frameInfo.textContent = `Frame: ${frameNumber} / ${total}`;
        }
    }
    
    /**
     * Request temperature analysis
     */
    requestAnalysis() {
        if (!this.state.wsConnected || !this.state.engineReady) return;
        
        // Throttle analysis requests
        const now = Date.now();
        if (now - this.state.lastAnalysisTime < (1000 / this.config.maxAnalysisRate)) {
            return;
        }
        
        this.state.lastAnalysisTime = now;
        
        const lines = [
            this.convertToVideoCoords(this.state.line1),
            this.convertToVideoCoords(this.state.line2)
        ];
        
        const success = this.sendWebSocketMessage('analyzeLines', {
            experimentId: this.state.experimentId,
            frameNum: this.state.currentFrame,
            lines: lines
        });
        
        if (success) {
            this.updateAnalysisInfo('Analyzing temperature...');
        }
    }
    
    /**
     * Convert canvas coordinates to video coordinates
     */
    convertToVideoCoords(line) {
        const videoInfo = this.state.videoInfo;
        const scaleX = (videoInfo.width || 908) / this.canvas.width;
        const scaleY = (videoInfo.height || 1200) / this.canvas.height;
        
        return {
            x1: Math.round(line.x1 * scaleX),
            y1: Math.round(line.y1 * scaleY),
            x2: Math.round(line.x2 * scaleX),
            y2: Math.round(line.y2 * scaleY)
        };
    }
    
    /**
     * Handle analysis results from WebSocket
     */
    handleAnalysisResult(data) {
        console.log('Analysis result received:', data);
        
        if (data.results && data.results.length >= 2) {
            const line1Result = data.results[0];
            const line2Result = data.results[1];
            
            if (line1Result.success && line1Result.temperatures) {
                this.updateHorizontalChart(line1Result.temperatures);
            }
            
            if (line2Result.success && line2Result.temperatures) {
                this.updateVerticalChart(line2Result.temperatures);
            }
            
            this.updateAnalysisInfo(`Analysis complete - ${data.lineCount} lines processed`);
        }
    }
    
    /**
     * Create temperature charts
     */
    createTemperatureCharts() {
        this.createHorizontalChart();
        this.createVerticalChart();
    }
    
    /**
     * Create horizontal temperature chart (bottom)
     */
    createHorizontalChart() {
        const traces = [{
            x: [],
            y: [],
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: this.config.colors.line1, width: 2 },
            marker: { color: this.config.colors.line1, size: 4 },
            name: 'Temperature'
        }];
        
        const layout = {
            title: '',
            xaxis: {
                title: 'Position (%)',
                range: [0, 100],
                showgrid: true,
                gridcolor: this.config.colors.grid
            },
            yaxis: {
                title: 'Temperature (°C)',
                showgrid: true,
                gridcolor: this.config.colors.grid
            },
            height: this.config.plotHeight,
            margin: { l: 60, r: 40, t: 30, b: 50 },
            plot_bgcolor: '#ffffff',
            paper_bgcolor: '#ffffff'
        };
        
        const config = {
            responsive: true,
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d']
        };
        
        this.plots.horizontal = Plotly.newPlot(
            this.elements.horizontalTemperaturePlot,
            traces,
            layout,
            config
        );
    }
    
    /**
     * Create vertical temperature chart (right)
     */
    createVerticalChart() {
        const traces = [{
            x: [],
            y: [],
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: this.config.colors.line2, width: 2 },
            marker: { color: this.config.colors.line2, size: 4 },
            name: 'Temperature'
        }];
        
        const layout = {
            title: '',
            xaxis: {
                title: 'Temperature (°C)',
                showgrid: true,
                gridcolor: this.config.colors.grid
            },
            yaxis: {
                title: 'Position (% from top)',
                range: [0, 100],
                autorange: 'reversed', // 0% at top, 100% at bottom
                showgrid: true,
                gridcolor: this.config.colors.grid
            },
            height: 300, // Taller for vertical chart
            margin: { l: 60, r: 40, t: 30, b: 50 },
            plot_bgcolor: '#ffffff',
            paper_bgcolor: '#ffffff'
        };
        
        const config = {
            responsive: true,
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d']
        };
        
        this.plots.vertical = Plotly.newPlot(
            this.elements.verticalTemperaturePlot,
            traces,
            layout,
            config
        );
    }
    
    /**
     * Update horizontal temperature chart
     */
    updateHorizontalChart(temperatures) {
        if (!this.plots.horizontal || !temperatures.length) return;
        
        const positions = temperatures.map((_, index) => 
            Math.round((index / (temperatures.length - 1)) * 100)
        );
        
        const update = {
            x: [positions],
            y: [temperatures]
        };
        
        Plotly.restyle(this.elements.horizontalTemperaturePlot, update, [0]);
    }
    
    /**
     * Update vertical temperature chart
     */
    updateVerticalChart(temperatures) {
        if (!this.plots.vertical || !temperatures.length) return;
        
        // Reverse temperatures for proper orientation (top to bottom)
        const reversedTemps = [...temperatures].reverse();
        const positions = reversedTemps.map((_, index) => 
            Math.round((index / (reversedTemps.length - 1)) * 100)
        );
        
        const update = {
            x: [reversedTemps],
            y: [positions]
        };
        
        Plotly.restyle(this.elements.verticalTemperaturePlot, update, [0]);
    }
    
    /**
     * Update connection status indicators
     */
    updateConnectionStatus() {
        // WebSocket status
        if (this.elements.webSocketStatus) {
            const status = this.state.wsConnected ? 'connected' : 'disconnected';
            const text = this.state.wsConnected ? 'Connected' : 'Disconnected';
            
            this.elements.webSocketStatus.dataset.status = status;
            const statusText = this.elements.webSocketStatus.querySelector('.status-text');
            if (statusText) statusText.textContent = text;
        }
        
        // Engine status
        if (this.elements.engineStatus) {
            const status = this.state.engineReady ? 'ready' : 'not-ready';
            const text = this.state.engineReady ? 'Ready' : 'Not Ready';
            
            this.elements.engineStatus.dataset.status = status;
            const statusText = this.elements.engineStatus.querySelector('.status-text');
            if (statusText) statusText.textContent = text;
        }
        
        // Video status
        if (this.elements.videoStatus) {
            const status = this.state.videoLoaded ? 'loaded' : 'not-loaded';
            const text = this.state.videoLoaded ? 'Loaded' : 'Not Loaded';
            
            this.elements.videoStatus.dataset.status = status;
            const statusText = this.elements.videoStatus.querySelector('.status-text');
            if (statusText) statusText.textContent = text;
        }
    }
    
    /**
     * Update analysis info display
     */
    updateAnalysisInfo(message) {
        if (this.elements.analysisInfo) {
            this.elements.analysisInfo.textContent = message;
        }
        
        if (this.elements.lastAnalysis) {
            this.elements.lastAnalysis.textContent = new Date().toLocaleTimeString();
        }
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
        const message = error.message || 'Failed to load thermal analysis';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'thermal-ir',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:thermal-ir:${eventName}`;
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
        // Clean up WebSocket
        if (this.webSocket) {
            this.webSocket.close();
            this.webSocket = null;
        }
        
        // Clean up Plotly plots
        if (this.plots.horizontal) {
            Plotly.purge(this.elements.horizontalTemperaturePlot);
        }
        if (this.plots.vertical) {
            Plotly.purge(this.elements.verticalTemperaturePlot);
        }
        
        // Clean up video
        if (this.video) {
            this.video.pause();
            this.video.src = '';
        }
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        // Clear state
        this.state = {};
        this.elements = {};
        this.plots = {};
        
        console.log('ThermalIr destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config
        };
    }
}

// Export for global access
window.ThermalIr = ThermalIr;