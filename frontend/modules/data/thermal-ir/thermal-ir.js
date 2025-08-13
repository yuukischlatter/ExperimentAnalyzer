/**
 * Thermal IR Module - Simplified
 * Interactive thermal video analysis with independent component initialization
 * Features: Direct video loading, immediate canvas interaction, background WebSocket analysis
 */

class ThermalIr {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        
        // Simplified state - only essentials
        this.state = {
            experimentId: null,
            wsConnected: false,
            engineReady: false,
            currentFrame: 0,
            totalFrames: 3674, // Actual frame count
            fps: 14.108, // Actual FPS
            isPlaying: false,
            
            // Line positions
            line1: { x1: 0, y1: 0, x2: 0, y2: 0 }, // Horizontal (blue)
            line2: { x1: 0, y1: 0, x2: 0, y2: 0 }, // Vertical (green)
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
            maxAnalysisRate: 10,
            plotHeight: 250,
            colors: {
                line1: '#2563eb', // Horizontal (blue)
                line2: '#059669', // Vertical (green)
                grid: 'rgba(0, 50, 120, 0.1)'
            },
            videoAspectRatio: 908/1200, // Exact aspect ratio
            videoWidth: 908,
            videoHeight: 1200,
            dragThreshold: 15,
            reconnectDelay: 3000
        };
    }
    
    async init() {
        try {
            await this.loadTemplate();
            this.bindElements();
            this.attachEvents();
            this.createTemperatureCharts();
            this.show();
            
            console.log('ThermalIr initialized successfully');
            
        } catch (error) {
            console.error('ThermalIr initialization failed:', error);
            this.showError(error.message);
        }
    }
    
    async loadTemplate() {
        const templateVar = 'ThermalIrTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            const response = await fetch('/modules/data/thermal-ir/thermal-ir.html');
            if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);
            this.template = await response.text();
        }
        this.render();
    }
    
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) throw new Error(`Container not found: ${this.containerId}`);
        
        container.innerHTML = this.template;
        this.bindElements();
    }
    
    bindElements() {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        
        const bindableElements = container.querySelectorAll('[data-bind]');
        bindableElements.forEach(el => {
            this.elements[el.dataset.bind] = el;
        });
        
        // Set up core elements
        this.video = this.elements.thermalVideo;
        this.canvas = this.elements.lineOverlay;
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
        }
    }
    
    attachEvents() {
        // Video events - work immediately
        if (this.video) {
            this.video.addEventListener('timeupdate', () => this.handleVideoTimeUpdate());
            this.video.addEventListener('loadedmetadata', () => this.handleVideoMetadata());
            this.video.addEventListener('canplay', () => console.log('Video ready to play'));
            this.video.addEventListener('error', () => console.error('Video loading error'));
        }
        
        // Canvas events - work immediately (no WebSocket dependency)
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
            this.elements.frameSlider.addEventListener('mousedown', () => {
                this.elements.frameSlider.dataset.dragging = 'true';
            });
            this.elements.frameSlider.addEventListener('mouseup', () => {
                delete this.elements.frameSlider.dataset.dragging;
            });
        }
    }
    
    /**
     * Load experiment - simplified, independent loading
     */
    async loadExperiment(experimentId) {
        try {
            console.log(`Loading thermal data for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            
            // Update experiment info
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId} - Interactive thermal video analysis`;
            }
            
            // Set video source directly - browser handles loading
            if (this.video) {
                const videoUrl = `${this.config.apiBaseUrl}/experiments/${experimentId}/thermal/video`;
                this.video.src = videoUrl;
                console.log(`Video source set: ${videoUrl}`);
            }
            
            // Setup frame slider with correct values
            this.setupFrameSlider();
            
            // Setup canvas immediately (independent of video/WebSocket)
            this.setupCanvas();
            
            // Setup WebSocket in background (for analysis only)
            this.setupWebSocketBackground();
            
            console.log(`Thermal module loaded for ${experimentId}`);
            
        } catch (error) {
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.showError(`Failed to load experiment: ${error.message}`);
        }
    }
    
    /**
     * Setup frame slider with correct frame count
     */
    setupFrameSlider() {
        if (this.elements.frameSlider) {
            this.elements.frameSlider.max = this.state.totalFrames;
            this.elements.frameSlider.value = 0;
        }
        this.updateFrameInfo(0);
    }
    
    /**
     * Setup WebSocket in background - non-blocking
     */
    setupWebSocketBackground() {
        if (this.webSocket) return; // Already connecting/connected
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}${this.config.wsEndpoint}`;
        
        console.log(`Connecting to WebSocket: ${wsUrl}`);
        
        this.webSocket = new WebSocket(wsUrl);
        
        this.webSocket.onopen = () => {
            this.state.wsConnected = true;
            console.log('WebSocket connected');
        };
        
        this.webSocket.onmessage = (event) => this.handleWebSocketMessage(event);
        
        this.webSocket.onclose = () => {
            this.state.wsConnected = false;
            this.state.engineReady = false;
            console.log('WebSocket disconnected');
            
            // Auto-reconnect
            setTimeout(() => {
                if (this.state.experimentId && !this.state.wsConnected) {
                    this.setupWebSocketBackground();
                }
            }, this.config.reconnectDelay);
        };
        
        this.webSocket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }
    
    handleWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
                case 'connected':
                    console.log('WebSocket connection established');
                    this.loadVideoInEngine();
                    break;
                    
                case 'videoLoaded':
                    this.handleVideoLoadedInEngine(message.data);
                    break;
                    
                case 'analysisResult':
                    this.handleAnalysisResult(message.data);
                    break;
                    
                case 'error':
                    console.error('WebSocket error:', message.data.message);
                    break;
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    }
    
    /**
     * Load video in thermal engine (WebSocket)
     */
    loadVideoInEngine() {
        if (!this.state.experimentId) return;
        
        this.sendWebSocketMessage('loadVideo', {
            experimentId: this.state.experimentId
        });
    }
    
    /**
     * Handle video loaded in engine
     */
    handleVideoLoadedInEngine(data) {
        console.log('Thermal engine ready:', data);
        
        this.state.engineReady = true;
        
        // Update video info if available from engine
        if (data.metadata?.videoInfo) {
            const info = data.metadata.videoInfo;
            this.state.totalFrames = info.frames || 3674;
            this.state.fps = info.fps || 14.108;
            
            // Update slider max value
            if (this.elements.frameSlider) {
                this.elements.frameSlider.max = this.state.totalFrames;
            }
        }
    }
    
    sendWebSocketMessage(type, data) {
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            const message = { type, data };
            this.webSocket.send(JSON.stringify(message));
            return true;
        }
        return false;
    }
    
    /**
     * Setup canvas - works immediately, independent of other components
     */
    setupCanvas() {
        if (!this.canvas) return;
        
        // Wait a bit for container to be properly sized
        setTimeout(() => {
            this.adjustCanvasSize();
            this.initializeDefaultLines();
            this.drawLines();
        }, 100);
    }
    
    adjustCanvasSize() {
        if (!this.canvas || !this.video) return;
        
        const videoContainer = this.video.parentElement;
        const containerRect = videoContainer.getBoundingClientRect();
        
        // Calculate proper dimensions maintaining 908:1200 aspect ratio
        const aspectRatio = this.config.videoAspectRatio;
        
        let canvasWidth, canvasHeight;
        
        // Apply max constraints first
        let availableWidth = Math.min(containerRect.width, 550); // Match CSS max-width
        let availableHeight = Math.min(containerRect.height, 650); // Match CSS max-height
        
        // Use aspect ratio to determine final size
        if (availableWidth / availableHeight > aspectRatio) {
            // Container is wider - fit to height
            canvasHeight = availableHeight;
            canvasWidth = canvasHeight * aspectRatio;
        } else {
            // Container is taller - fit to width
            canvasWidth = availableWidth;
            canvasHeight = canvasWidth / aspectRatio;
        }
        
        // Set canvas size
        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        
        // Center canvas in container
        const leftOffset = (containerRect.width - canvasWidth) / 2;
        const topOffset = (containerRect.height - canvasHeight) / 2;
        
        this.canvas.style.left = leftOffset + 'px';
        this.canvas.style.top = topOffset + 'px';
        this.canvas.style.width = canvasWidth + 'px';
        this.canvas.style.height = canvasHeight + 'px';
        
        console.log(`Canvas sized: ${canvasWidth}x${canvasHeight}, offset: ${leftOffset},${topOffset}`);
    }
    
    initializeDefaultLines() {
        if (!this.canvas) return;
        
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Horizontal line (blue) - centered horizontally
        this.state.line1 = {
            x1: width * 0.1,
            y1: height * 0.5,
            x2: width * 0.9,
            y2: height * 0.5
        };
        
        // Vertical line (green) - centered vertically
        this.state.line2 = {
            x1: width * 0.5,
            y1: height * 0.1,
            x2: width * 0.5,
            y2: height * 0.9
        };
        
        console.log('Default lines initialized');
    }
    
    /**
     * Mouse event handlers - improved coordinate handling
     */
    handleMouseDown(event) {
        if (!this.canvas) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        
        const nearestEndpoint = this.getNearestEndpoint(x, y);
        if (nearestEndpoint) {
            this.state.dragging = nearestEndpoint;
            this.canvas.classList.add('grabbing-cursor');
            event.preventDefault();
        }
    }
    
    handleMouseMove(event) {
        if (!this.canvas) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        
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
    
    updateDraggedEndpoint(x, y) {
        switch (this.state.dragging) {
            case 'line1_start': this.state.line1.x1 = x; this.state.line1.y1 = y; break;
            case 'line1_end': this.state.line1.x2 = x; this.state.line1.y2 = y; break;
            case 'line2_start': this.state.line2.x1 = x; this.state.line2.y1 = y; break;
            case 'line2_end': this.state.line2.x2 = x; this.state.line2.y2 = y; break;
        }
    }
    
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
        if (!this.video) return;
        
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
        if (!this.video || this.video.duration === 0) return;
        
        // Calculate current frame using actual FPS
        const currentFrame = Math.floor(this.video.currentTime * this.state.fps);
        this.state.currentFrame = currentFrame;
        
        this.updateFrameInfo(currentFrame);
        
        // Update slider if not being dragged by user
        if (this.elements.frameSlider && !this.elements.frameSlider.dataset.dragging) {
            this.elements.frameSlider.value = currentFrame;
        }
        
        this.requestAnalysis();
    }
    
    handleVideoMetadata() {
        // Recalculate canvas size when video metadata is loaded
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
    
    seekToFrame(frameNumber) {
        if (!this.video) return;
        
        const time = frameNumber / this.state.fps;
        this.video.currentTime = time;
        this.state.currentFrame = frameNumber;
        this.updateFrameInfo(frameNumber);
    }
    
    updateFrameInfo(frameNumber) {
        if (this.elements.frameInfo) {
            this.elements.frameInfo.textContent = `Frame: ${frameNumber} / ${this.state.totalFrames}`;
        }
    }
    
    /**
     * Request temperature analysis (only works when WebSocket ready)
     */
    requestAnalysis() {
        if (!this.state.wsConnected || !this.state.engineReady) return;
        
        const now = Date.now();
        if (now - this.state.lastAnalysisTime < (1000 / this.config.maxAnalysisRate)) return;
        
        this.state.lastAnalysisTime = now;
        
        const lines = [
            this.convertToVideoCoords(this.state.line1),
            this.convertToVideoCoords(this.state.line2)
        ];
        
        this.sendWebSocketMessage('analyzeLines', {
            experimentId: this.state.experimentId,
            frameNum: this.state.currentFrame,
            lines: lines
        });
    }
    
    convertToVideoCoords(line) {
        const scaleX = this.config.videoWidth / this.canvas.width;
        const scaleY = this.config.videoHeight / this.canvas.height;
        
        return {
            x1: Math.round(line.x1 * scaleX),
            y1: Math.round(line.y1 * scaleY),
            x2: Math.round(line.x2 * scaleX),
            y2: Math.round(line.y2 * scaleY)
        };
    }
    
    handleAnalysisResult(data) {
        console.log('Analysis result received:', data);
        
        if (data.results && data.results.length >= 2) {
            const line1Result = data.results[0];
            const line2Result = data.results[1];
            
            // Log resolution information for debugging
            console.log('Line 1 temperature points:', line1Result.temperatures?.length);
            console.log('Line 2 temperature points:', line2Result.temperatures?.length);
            console.log('Line 1 sample temperatures (first 10):', line1Result.temperatures?.slice(0, 10));
            console.log('Line 2 sample temperatures (first 10):', line2Result.temperatures?.slice(0, 10));
            
            if (line1Result.success && line1Result.temperatures) {
                this.updateHorizontalChart(line1Result.temperatures);
            }
            
            if (line2Result.success && line2Result.temperatures) {
                this.updateVerticalChart(line2Result.temperatures);
            }
        }
    }
    
    /**
     * Create temperature charts
     */
    createTemperatureCharts() {
        this.createHorizontalChart();
        this.createVerticalChart();
    }
    
    createHorizontalChart() {
        const traces = [{
            x: [], y: [],
            type: 'scatter', mode: 'lines', // Changed from 'lines+markers' for high-resolution data
            line: { color: this.config.colors.line1, width: 2 },
            name: 'Temperature'
        }];
        
        const layout = {
            title: '',
            xaxis: { title: 'Position (%)', range: [0, 100], showgrid: true, gridcolor: this.config.colors.grid },
            yaxis: { title: 'Temperature (°C)', showgrid: true, gridcolor: this.config.colors.grid },
            height: this.config.plotHeight,
            margin: { l: 60, r: 40, t: 30, b: 50 },
            plot_bgcolor: '#ffffff', paper_bgcolor: '#ffffff'
        };
        
        this.plots.horizontal = Plotly.newPlot(this.elements.horizontalTemperaturePlot, traces, layout, {
            responsive: true, displayModeBar: true, displaylogo: false,
            modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d']
        });
    }
    
    createVerticalChart() {
        const traces = [{
            x: [], y: [],
            type: 'scatter', mode: 'lines', // Changed from 'lines+markers' for high-resolution data
            line: { color: this.config.colors.line2, width: 2 },
            name: 'Temperature'
        }];
        
        const layout = {
            title: '',
            xaxis: { title: 'Temperature (°C)', showgrid: true, gridcolor: this.config.colors.grid },
            yaxis: { title: 'Position (% from top)', range: [0, 100], autorange: 'reversed', showgrid: true, gridcolor: this.config.colors.grid },
            height: 420, // Match CSS height exactly for better space utilization
            margin: { l: 60, r: 40, t: 15, b: 25 }, // Reduced top/bottom margins for more plot area
            plot_bgcolor: '#ffffff', paper_bgcolor: '#ffffff'
        };
        
        this.plots.vertical = Plotly.newPlot(this.elements.verticalTemperaturePlot, traces, layout, {
            responsive: true, displayModeBar: true, displaylogo: false,
            modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d']
        });
    }
    
    updateHorizontalChart(temperatures) {
        if (!this.plots.horizontal || !temperatures.length) return;
        
        const positions = temperatures.map((_, index) => 
            Math.round((index / (temperatures.length - 1)) * 100)
        );
        
        Plotly.restyle(this.elements.horizontalTemperaturePlot, {
            x: [positions], y: [temperatures]
        }, [0]);
    }
    
    updateVerticalChart(temperatures) {
        if (!this.plots.vertical || !temperatures.length) return;
        
        const reversedTemps = [...temperatures].reverse();
        const positions = reversedTemps.map((_, index) => 
            Math.round((index / (reversedTemps.length - 1)) * 100)
        );
        
        Plotly.restyle(this.elements.verticalTemperaturePlot, {
            x: [reversedTemps], y: [positions]
        }, [0]);
    }
    
    showError(message) {
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.remove('hidden');
        }
        if (this.elements.errorText) {
            this.elements.errorText.textContent = message;
        }
        if (this.elements.sectionsContainer) {
            this.elements.sectionsContainer.classList.add('hidden');
        }
    }
    
    /**
     * Public interface (Standard Module Methods)
     */
    show() {
        const container = document.getElementById(this.containerId);
        if (container) container.style.display = 'block';
    }
    
    hide() {
        const container = document.getElementById(this.containerId);
        if (container) container.style.display = 'none';
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
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) container.innerHTML = '';
        
        console.log('ThermalIr destroyed');
    }
    
    getState() {
        return { ...this.state, config: this.config };
    }
}

// Export for global access
window.ThermalIr = ThermalIr;