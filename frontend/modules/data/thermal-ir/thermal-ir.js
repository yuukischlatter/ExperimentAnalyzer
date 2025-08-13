/**
 * Thermal IR Module - Chart.js Implementation with Raw Data Display
 * Interactive thermal video analysis with high-performance Chart.js visualization
 * Features: Direct video loading, immediate canvas interaction, raw data visualization
 * UPDATED: Added cleanup and abort functionality
 */

class ThermalIr {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        
        // Simplified state - dynamic values start at 0
        this.state = {
            experimentId: null,
            wsConnected: false,
            engineReady: false,
            currentFrame: 0,
            totalFrames: 0, // Dynamic - starts at 0, updated from API
            fps: 0, // Dynamic - starts at 0, updated from API
            isPlaying: false,
            
            // Line positions
            line1: { x1: 0, y1: 0, x2: 0, y2: 0 }, // Horizontal (blue)
            line2: { x1: 0, y1: 0, x2: 0, y2: 0 }, // Vertical (green)
            dragging: null,
            lastAnalysisTime: 0,
            
            // Chart state
            chartsInitialized: false,
            lastUpdateTime: 0
        };
        
        // DOM elements and objects
        this.elements = {};
        this.webSocket = null;
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.charts = {
            horizontal: null,
            vertical: null
        };
        
        // Performance optimization
        this.updateQueue = [];
        this.isUpdating = false;
        
        // NEW: Request management
        this.abortController = null;
        this.isLoading = false;
        this.analysisTimeout = null;
        this.reconnectTimeout = null;
        
        // Event handler binding for proper cleanup
        this.boundEventHandlers = {};
        
        console.log('ThermalIr initialized with Chart.js');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            wsEndpoint: '/thermal-ws',
            maxAnalysisRate: 10,
            colors: {
                line1: '#2563eb', // Horizontal (blue)
                line2: '#059669', // Vertical (green)
                grid: 'rgba(0, 50, 120, 0.1)',
                background: 'rgba(37, 99, 235, 0.1)',
                background2: 'rgba(5, 150, 105, 0.1)'
            },
            videoAspectRatio: 908/1200, // Default - will be updated from API
            videoWidth: 908, // Default - will be updated from API
            videoHeight: 1200, // Default - will be updated from API
            dragThreshold: 15,
            reconnectDelay: 3000,
            chartHeights: {
                horizontal: 200,
                vertical: 400
            }
        };
    }
    
    async init() {
        try {
            await this.loadTemplate();
            this.bindElements();
            this.attachEvents();
            this.initializeCharts();
            this.show();
            
            console.log('ThermalIr initialized successfully with Chart.js');
            
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
        // Video events - bind with proper cleanup tracking
        if (this.video) {
            this.boundEventHandlers.videoTimeUpdate = () => this.handleVideoTimeUpdate();
            this.boundEventHandlers.videoMetadata = () => this.handleVideoMetadata();
            this.boundEventHandlers.videoCanPlay = () => console.log('Video ready to play');
            this.boundEventHandlers.videoError = () => console.error('Video loading error');
            
            this.video.addEventListener('timeupdate', this.boundEventHandlers.videoTimeUpdate);
            this.video.addEventListener('loadedmetadata', this.boundEventHandlers.videoMetadata);
            this.video.addEventListener('canplay', this.boundEventHandlers.videoCanPlay);
            this.video.addEventListener('error', this.boundEventHandlers.videoError);
        }
        
        // Canvas events - bind with proper cleanup tracking
        if (this.canvas) {
            this.boundEventHandlers.mouseDown = (e) => this.handleMouseDown(e);
            this.boundEventHandlers.mouseMove = (e) => this.handleMouseMove(e);
            this.boundEventHandlers.mouseUp = (e) => this.handleMouseUp(e);
            
            this.canvas.addEventListener('mousedown', this.boundEventHandlers.mouseDown);
            this.canvas.addEventListener('mousemove', this.boundEventHandlers.mouseMove);
            this.canvas.addEventListener('mouseup', this.boundEventHandlers.mouseUp);
        }
        
        // Control events
        if (this.elements.playButton) {
            this.boundEventHandlers.playButton = () => this.togglePlayPause();
            this.elements.playButton.addEventListener('click', this.boundEventHandlers.playButton);
        }
        
        if (this.elements.frameSlider) {
            this.boundEventHandlers.frameSliderInput = (e) => this.handleFrameSlider(e);
            this.boundEventHandlers.frameSliderMouseDown = () => {
                this.elements.frameSlider.dataset.dragging = 'true';
            };
            this.boundEventHandlers.frameSliderMouseUp = () => {
                delete this.elements.frameSlider.dataset.dragging;
            };
            
            this.elements.frameSlider.addEventListener('input', this.boundEventHandlers.frameSliderInput);
            this.elements.frameSlider.addEventListener('mousedown', this.boundEventHandlers.frameSliderMouseDown);
            this.elements.frameSlider.addEventListener('mouseup', this.boundEventHandlers.frameSliderMouseUp);
        }
        
        // Window resize for chart responsiveness
        this.boundEventHandlers.windowResize = () => this.handleResize();
        window.addEventListener('resize', this.boundEventHandlers.windowResize);
    }
    
    /**
     * NEW: Abort ongoing requests and connections
     */
    abort() {
        // Clear timeouts
        if (this.analysisTimeout) {
            clearTimeout(this.analysisTimeout);
            this.analysisTimeout = null;
        }
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        // Abort main API request if any
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        // Close WebSocket connection
        if (this.webSocket) {
            this.webSocket.close();
            this.webSocket = null;
        }
        
        this.isLoading = false;
        this.state.wsConnected = false;
        this.state.engineReady = false;
        
        console.log('ThermalIr: Ongoing requests and connections aborted');
    }
    
    /**
     * NEW: Cleanup state without destroying DOM
     */
    cleanup() {
        // Abort any ongoing requests
        this.abort();
        
        // Stop video playback
        if (this.video) {
            this.video.pause();
            this.video.src = '';
            this.video.load(); // Reset video element
        }
        
        // Reset state
        this.state.experimentId = null;
        this.state.currentFrame = 0;
        this.state.totalFrames = 0;
        this.state.fps = 0;
        this.state.isPlaying = false;
        this.state.dragging = null;
        this.state.lastAnalysisTime = 0;
        this.state.lastUpdateTime = 0;
        
        // Reset line positions
        this.state.line1 = { x1: 0, y1: 0, x2: 0, y2: 0 };
        this.state.line2 = { x1: 0, y1: 0, x2: 0, y2: 0 };
        
        // Clear canvas
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Clear charts data
        if (this.charts.horizontal) {
            this.charts.horizontal.data.labels = [];
            this.charts.horizontal.data.datasets[0].data = [];
            this.charts.horizontal.update('none');
        }
        
        if (this.charts.vertical) {
            this.charts.vertical.data.labels = [];
            this.charts.vertical.data.datasets[0].data = [];
            this.charts.vertical.update('none');
        }
        
        // Update UI elements
        if (this.elements.frameSlider) {
            this.elements.frameSlider.value = 0;
            this.elements.frameSlider.max = 0;
        }
        
        if (this.elements.frameInfo) {
            this.elements.frameInfo.textContent = 'Frame: 0 / 0';
        }
        
        if (this.elements.videoInfo) {
            this.elements.videoInfo.textContent = '0 frames, 0.000 FPS, 0x0';
        }
        
        if (this.elements.playButtonText) {
            this.elements.playButtonText.textContent = 'Play';
        }
        
        console.log('ThermalIr: Cleanup completed');
    }
    
    /**
     * Load experiment - MODIFIED: Added abort controller support
     */
    async loadExperiment(experimentId) {
        try {
            // Prevent overlapping loads
            if (this.isLoading) {
                console.log('Already loading thermal IR data, aborting previous request...');
                this.abort();
            }
            
            // Create new abort controller
            this.abortController = new AbortController();
            this.isLoading = true;
            
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
            
            // Check if aborted
            if (this.abortController.signal.aborted) {
                return;
            }
            
            // Setup frame slider with initial values (will be updated when video loads)
            this.setupFrameSlider();
            
            // Setup canvas immediately (independent of video/WebSocket)
            this.setupCanvas();
            
            // Setup WebSocket in background (for analysis only)
            this.setupWebSocketBackground();
            
            this.isLoading = false;
            
            console.log(`Thermal module loaded for ${experimentId}`);
            
        } catch (error) {
            this.isLoading = false;
            
            // Don't show errors for aborted requests
            if (error.name === 'AbortError') {
                console.log('Thermal IR loading was aborted');
                return;
            }
            
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.showError(`Failed to load experiment: ${error.message}`);
        }
    }
    
    /**
     * Setup frame slider with initial values
     */
    setupFrameSlider() {
        if (this.elements.frameSlider) {
            this.elements.frameSlider.max = this.state.totalFrames;
            this.elements.frameSlider.value = 0;
        }
        this.updateFrameInfo(0);
    }
    
    /**
     * Setup WebSocket in background - MODIFIED: Added abort support
     */
    setupWebSocketBackground() {
        if (this.webSocket || this.abortController?.signal.aborted) return; // Already connecting/connected or aborted
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}${this.config.wsEndpoint}`;
        
        console.log(`Connecting to WebSocket: ${wsUrl}`);
        
        this.webSocket = new WebSocket(wsUrl);
        
        this.webSocket.onopen = () => {
            if (this.abortController?.signal.aborted) {
                this.webSocket.close();
                return;
            }
            
            this.state.wsConnected = true;
            console.log('WebSocket connected');
        };
        
        this.webSocket.onmessage = (event) => {
            if (this.abortController?.signal.aborted) return;
            this.handleWebSocketMessage(event);
        };
        
        this.webSocket.onclose = () => {
            this.state.wsConnected = false;
            this.state.engineReady = false;
            console.log('WebSocket disconnected');
            
            // Auto-reconnect only if not aborted
            if (!this.abortController?.signal.aborted && this.state.experimentId) {
                this.reconnectTimeout = setTimeout(() => {
                    if (this.state.experimentId && !this.state.wsConnected && !this.abortController?.signal.aborted) {
                        this.setupWebSocketBackground();
                    }
                }, this.config.reconnectDelay);
            }
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
     * Handle video loaded in engine - UPDATED: Now calls dynamic update functions
     */
    handleVideoLoadedInEngine(data) {
        console.log('Thermal engine ready:', data);
        
        this.state.engineReady = true;
        
        // Update video info if available from engine
        if (data.metadata?.videoInfo) {
            const info = data.metadata.videoInfo;
            
            // Update state with dynamic values
            this.state.totalFrames = info.frames || 0;
            this.state.fps = info.fps || 0;
            
            // Update video dimensions if provided
            if (info.width && info.height) {
                this.config.videoWidth = info.width;
                this.config.videoHeight = info.height;
                this.config.videoAspectRatio = info.width / info.height;
            }
            
            // Update UI elements with dynamic values
            this.updateVideoMetadata(info);
            this.updateFrameSlider(this.state.totalFrames);
            
            console.log(`Video metadata updated: ${this.state.totalFrames} frames, ${this.state.fps} FPS`);
        }
    }
    
    /**
     * Update video metadata display - NEW FUNCTION
     */
    updateVideoMetadata(videoInfo) {
        if (this.elements.videoInfo) {
            const frames = videoInfo.frames || this.state.totalFrames || 0;
            const fps = videoInfo.fps || this.state.fps || 0;
            const width = videoInfo.width || this.config.videoWidth || 0;
            const height = videoInfo.height || this.config.videoHeight || 0;
            
            this.elements.videoInfo.textContent = `${frames} frames, ${fps.toFixed(3)} FPS, ${width}x${height}`;
        }
    }
    
    /**
     * Update frame slider and frame info - NEW FUNCTION
     */
    updateFrameSlider(totalFrames) {
        // Update slider max value
        if (this.elements.frameSlider) {
            this.elements.frameSlider.max = totalFrames;
        }
        
        // Update frame info display
        this.updateFrameInfo(this.state.currentFrame);
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
        
        // Calculate proper dimensions maintaining aspect ratio
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
            this.requestAnalysisDebounced();
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
        
        // Calculate current frame using dynamic FPS
        const currentFrame = Math.floor(this.video.currentTime * this.state.fps);
        this.state.currentFrame = currentFrame;
        
        this.updateFrameInfo(currentFrame);
        
        // Update slider if not being dragged by user
        if (this.elements.frameSlider && !this.elements.frameSlider.dataset.dragging) {
            this.elements.frameSlider.value = currentFrame;
        }
        
        this.requestAnalysisDebounced();
    }
    
    handleVideoMetadata() {
        // Recalculate canvas size when video metadata is loaded
        setTimeout(() => {
            this.adjustCanvasSize();
            this.initializeDefaultLines();
            this.drawLines();
            // Resize charts to match new container
            this.handleResize();
        }, 100);
    }
    
    handleFrameSlider(event) {
        const frameNumber = parseInt(event.target.value);
        this.seekToFrame(frameNumber);
        this.requestAnalysisDebounced();
    }
    
    seekToFrame(frameNumber) {
        if (!this.video || this.state.fps === 0) return;
        
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
     * Handle window resize
     */
    handleResize() {
        if (this.state.chartsInitialized) {
            // Resize Chart.js charts
            setTimeout(() => {
                if (this.charts.horizontal) {
                    this.charts.horizontal.resize();
                }
                if (this.charts.vertical) {
                    this.charts.vertical.resize();
                }
            }, 100);
        }
        
        // Resize canvas
        this.adjustCanvasSize();
        this.drawLines();
    }
    
    /**
     * Debounced analysis request for smooth interactions
     */
    requestAnalysisDebounced() {
        if (this.analysisTimeout) {
            clearTimeout(this.analysisTimeout);
        }
        this.analysisTimeout = setTimeout(() => {
            this.requestAnalysis();
        }, 100); // 100ms debounce
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
            
            if (line1Result.success && line1Result.temperatures) {
                this.updateHorizontalChart(line1Result.temperatures);
            }
            
            if (line2Result.success && line2Result.temperatures) {
                this.updateVerticalChart(line2Result.temperatures);
            }
        }
    }
    
    /**
     * Create temperature charts - Chart.js Implementation
     */
    initializeCharts() {
        try {
            this.createHorizontalChart();
            this.createVerticalChart();
            this.state.chartsInitialized = true;
            console.log('Chart.js charts initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Chart.js charts:', error);
        }
    }
    
    createHorizontalChart() {
    const canvas = this.elements.horizontalTemperaturePlot;
    if (!canvas) {
        console.error('Horizontal chart canvas not found');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    this.charts.horizontal = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], // Raw position indices
            datasets: [{
                label: 'Temperature',
                data: [],
                borderColor: this.config.colors.line1,
                backgroundColor: this.config.colors.background,
                borderWidth: 2,
                pointRadius: 0, // No points for performance with high-resolution data
                pointHoverRadius: 4,
                fill: false,
                tension: 0.1 // Slight smoothing
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0 // Disable animations for real-time performance
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'Position (Data Point)',
                        color: '#374151',
                        font: { size: 12, weight: 'bold' }
                    },
                    beginAtZero: true,
                    grace: 0, // Remove padding/buffer
                    grid: {
                        color: this.config.colors.grid,
                        lineWidth: 1
                    },
                    ticks: {
                        color: '#6B7280'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Temperature (°C)',
                        color: '#374151',
                        font: { size: 12, weight: 'bold' }
                    },
                    min: 600, // Fixed temperature range
                    max: 1500, // Fixed temperature range
                    grid: {
                        color: this.config.colors.grid,
                        lineWidth: 1
                    },
                    ticks: {
                        color: '#6B7280'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false // Hide legend for cleaner look
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderColor: this.config.colors.line1,
                    borderWidth: 1
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            elements: {
                line: {
                    tension: 0.1
                }
            }
        }
    });
}
    
    createVerticalChart() {
    const canvas = this.elements.verticalTemperaturePlot;
    if (!canvas) {
        console.error('Vertical chart canvas not found');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    this.charts.vertical = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], // Temperature values
            datasets: [{
                label: 'Position',
                data: [],
                borderColor: this.config.colors.line2,
                backgroundColor: this.config.colors.background2,
                borderWidth: 2,
                pointRadius: 0, // No points for performance with high-resolution data
                pointHoverRadius: 4,
                fill: false,
                tension: 0.1 // Slight smoothing
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0 // Disable animations for real-time performance
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'Temperature (°C)',
                        color: '#374151',
                        font: { size: 12, weight: 'bold' }
                    },
                    min: 600, // Fixed temperature range
                    max: 1500, // Fixed temperature range
                    grid: {
                        color: this.config.colors.grid,
                        lineWidth: 1
                    },
                    ticks: {
                        color: '#6B7280'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Position (Data Point)',
                        color: '#374151',
                        font: { size: 12, weight: 'bold' }
                    },
                    reverse: true, // Reverse Y-axis (top to bottom)
                    beginAtZero: true,
                    grace: 0, // Remove padding/buffer
                    grid: {
                        color: this.config.colors.grid,
                        lineWidth: 1
                    },
                    ticks: {
                        color: '#6B7280'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false // Hide legend for cleaner look
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderColor: this.config.colors.line2,
                    borderWidth: 1
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            elements: {
                line: {
                    tension: 0.1
                }
            }
        }
    });
}
    
    /**
     * Update charts using Chart.js efficient update methods - SIMPLIFIED RAW DATA
     */
    updateHorizontalChart(temperatures) {
        if (!this.charts.horizontal || !temperatures || temperatures.length === 0) return;
        
        try {
            // Use raw data - no decimation, no percentage conversion
            const positions = temperatures.map((_, index) => index); // Just 0, 1, 2, 3, 4...
            
            // Update chart data efficiently
            this.charts.horizontal.data.labels = positions;
            this.charts.horizontal.data.datasets[0].data = temperatures.map((temp, index) => ({
                x: index, // Raw position index
                y: temp   // Raw temperature value
            }));
            
             // Fix X-axis max to remove buffer
            this.charts.horizontal.options.scales.x.max = temperatures.length - 1;

            // Update without animation for real-time performance
            this.charts.horizontal.update('none');
            
        } catch (error) {
            console.error('Error updating horizontal chart:', error);
        }
    }
    
    updateVerticalChart(temperatures) {
        if (!this.charts.vertical || !temperatures || temperatures.length === 0) return;
        
        try {
            // Use raw data - no decimation, no percentage conversion
            const positions = temperatures.map((_, index) => index); // Just 0, 1, 2, 3, 4...
            
            // Update chart data efficiently
            this.charts.vertical.data.labels = temperatures;
            this.charts.vertical.data.datasets[0].data = temperatures.map((temp, index) => ({
                x: temp,  // Raw temperature value
                y: index  // Raw position index
            }));
            
            // Fix Y-axis max to remove buffer
            this.charts.vertical.options.scales.y.max = temperatures.length - 1;

            // Update without animation for real-time performance
            this.charts.vertical.update('none');
            
        } catch (error) {
            console.error('Error updating vertical chart:', error);
        }
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
    
    /**
     * Destroy module - MODIFIED: Enhanced cleanup with proper event listener removal
     */
    destroy() {
        // Abort any ongoing requests and connections
        this.abort();
        
        // Remove all event listeners
        if (this.video) {
            this.video.removeEventListener('timeupdate', this.boundEventHandlers.videoTimeUpdate);
            this.video.removeEventListener('loadedmetadata', this.boundEventHandlers.videoMetadata);
            this.video.removeEventListener('canplay', this.boundEventHandlers.videoCanPlay);
            this.video.removeEventListener('error', this.boundEventHandlers.videoError);
        }
        
        if (this.canvas) {
            this.canvas.removeEventListener('mousedown', this.boundEventHandlers.mouseDown);
            this.canvas.removeEventListener('mousemove', this.boundEventHandlers.mouseMove);
            this.canvas.removeEventListener('mouseup', this.boundEventHandlers.mouseUp);
        }
        
        if (this.elements.playButton) {
            this.elements.playButton.removeEventListener('click', this.boundEventHandlers.playButton);
        }
        
        if (this.elements.frameSlider) {
            this.elements.frameSlider.removeEventListener('input', this.boundEventHandlers.frameSliderInput);
            this.elements.frameSlider.removeEventListener('mousedown', this.boundEventHandlers.frameSliderMouseDown);
            this.elements.frameSlider.removeEventListener('mouseup', this.boundEventHandlers.frameSliderMouseUp);
        }
        
        if (this.boundEventHandlers.windowResize) {
            window.removeEventListener('resize', this.boundEventHandlers.windowResize);
        }
        
        // Clean up Chart.js charts
        if (this.charts.horizontal) {
            try {
                this.charts.horizontal.destroy();
                this.charts.horizontal = null;
            } catch (e) {
                console.warn('Error destroying horizontal chart:', e);
            }
        }
        if (this.charts.vertical) {
            try {
                this.charts.vertical.destroy();
                this.charts.vertical = null;
            } catch (e) {
                console.warn('Error destroying vertical chart:', e);
            }
        }
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) container.innerHTML = '';
        
        console.log('ThermalIr destroyed');
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
window.ThermalIr = ThermalIr;