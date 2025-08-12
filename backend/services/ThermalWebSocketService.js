/**
 * Thermal WebSocket Service
 * Handles WebSocket connections for real-time thermal analysis
 * Processes video frame analysis requests and manages client connections
 */

const ThermalParserService = require('./ThermalParserService');
const { v4: uuidv4 } = require('uuid');

class ThermalWebSocketService {
    constructor() {
        this.serviceName = 'Thermal WebSocket Service';
        
        // Connection management
        this.connections = new Map(); // connectionId → connection info
        this.activeVideos = new Map(); // experimentId → active connection count
        
        // Services
        this.thermalService = new ThermalParserService();
        
        // Performance tracking
        this.stats = {
            totalConnections: 0,
            activeConnections: 0,
            totalMessages: 0,
            totalAnalysisRequests: 0,
            errors: 0
        };
        
        console.log(`${this.serviceName} initialized`);
    }

    /**
     * Handle new WebSocket connection
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} request - HTTP request object
     */
    handleConnection(ws, request) {
        const connectionId = uuidv4();
        const clientIP = request.socket.remoteAddress || 'unknown';
        
        // Store connection info
        const connectionInfo = {
            id: connectionId,
            ws: ws,
            clientIP: clientIP,
            connectedAt: new Date(),
            currentExperiment: null,
            messageCount: 0,
            lastActivity: new Date()
        };
        
        this.connections.set(connectionId, connectionInfo);
        this.stats.totalConnections++;
        this.stats.activeConnections++;
        
        console.log(`🔌 New thermal WebSocket connection: ${connectionId} from ${clientIP}`);
        console.log(`📊 Active connections: ${this.stats.activeConnections}`);
        
        // Send welcome message
        this.sendResponse(ws, 'connected', {
            connectionId: connectionId,
            message: 'Connected to Thermal Analysis Service',
            capabilities: [
                'loadVideo',
                'analyzeLines', 
                'pixelTemperature',
                'videoInfo'
            ],
            timestamp: new Date().toISOString()
        });
        
        // Setup message handler
        ws.on('message', (data) => {
            this.handleMessage(ws, data, connectionId);
        });
        
        // Setup close handler
        ws.on('close', (code, reason) => {
            this.handleDisconnect(connectionId, code, reason);
        });
        
        // Setup error handler
        ws.on('error', (error) => {
            console.error(`❌ WebSocket error for connection ${connectionId}:`, error);
            this.stats.errors++;
            this.sendError(ws, `Connection error: ${error.message}`);
        });
        
        // Setup ping/pong for connection health
        const pingInterval = setInterval(() => {
            if (ws.readyState === ws.OPEN) {
                ws.ping();
            } else {
                clearInterval(pingInterval);
            }
        }, 30000); // Ping every 30 seconds
        
        ws.on('pong', () => {
            // Update last activity
            const conn = this.connections.get(connectionId);
            if (conn) {
                conn.lastActivity = new Date();
            }
        });
    }

    /**
     * Handle incoming WebSocket message
     * @param {WebSocket} ws - WebSocket connection
     * @param {Buffer} data - Message data
     * @param {string} connectionId - Connection ID
     */
    async handleMessage(ws, data, connectionId) {
        try {
            // Parse message
            let message;
            try {
                message = JSON.parse(data.toString());
            } catch (parseError) {
                this.sendError(ws, 'Invalid JSON message format');
                return;
            }
            
            // Update connection stats
            const connectionInfo = this.connections.get(connectionId);
            if (connectionInfo) {
                connectionInfo.messageCount++;
                connectionInfo.lastActivity = new Date();
            }
            
            this.stats.totalMessages++;
            
            // Validate message structure
            if (!message.type) {
                this.sendError(ws, 'Message must have a type field');
                return;
            }
            
            console.log(`📨 Received message: ${message.type} from ${connectionId}`);
            
            // Route message based on type
            switch (message.type) {
                case 'loadVideo':
                    await this.handleLoadVideo(ws, message.data, connectionId);
                    break;
                    
                case 'analyzeLines':
                    await this.handleAnalyzeLines(ws, message.data, connectionId);
                    break;
                    
                case 'pixelTemperature':
                    await this.handlePixelTemperature(ws, message.data, connectionId);
                    break;
                    
                case 'videoInfo':
                    await this.handleVideoInfo(ws, message.data, connectionId);
                    break;
                    
                case 'disconnect':
                    await this.handleExplicitDisconnect(ws, connectionId);
                    break;
                    
                case 'ping':
                    this.sendResponse(ws, 'pong', { 
                        timestamp: new Date().toISOString() 
                    });
                    break;
                    
                default:
                    this.sendError(ws, `Unknown message type: ${message.type}`);
            }
            
        } catch (error) {
            console.error(`❌ Error handling message from ${connectionId}:`, error);
            this.stats.errors++;
            this.sendError(ws, `Failed to process message: ${error.message}`);
        }
    }

    /**
     * Handle video loading request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} data - Message data
     * @param {string} connectionId - Connection ID
     */
    async handleLoadVideo(ws, data, connectionId) {
        try {
            // Validate request data
            if (!data || !data.experimentId) {
                this.sendError(ws, 'loadVideo requires experimentId');
                return;
            }
            
            const { experimentId } = data;
            console.log(`🎥 Loading thermal video for experiment: ${experimentId}`);
            
            // Update connection info
            const connectionInfo = this.connections.get(connectionId);
            if (connectionInfo) {
                connectionInfo.currentExperiment = experimentId;
            }
            
            // Track active video usage
            const currentCount = this.activeVideos.get(experimentId) || 0;
            this.activeVideos.set(experimentId, currentCount + 1);
            
            // Parse thermal file
            const parseResult = await this.thermalService.parseExperimentThermalFile(experimentId);
            if (!parseResult.success) {
                this.sendError(ws, `Failed to load thermal video: ${parseResult.message}`);
                return;
            }
            
            // Get metadata
            const metadataResult = await this.thermalService.getThermalMetadata(experimentId);
            if (!metadataResult.success) {
                this.sendError(ws, `Failed to get video metadata: ${metadataResult.error}`);
                return;
            }
            
            // Send success response
            this.sendResponse(ws, 'videoLoaded', {
                experimentId: experimentId,
                metadata: metadataResult,
                loadTime: parseResult.processingTime || 0,
                message: 'Thermal video loaded successfully'
            });
            
            console.log(`✅ Thermal video loaded for ${experimentId} on connection ${connectionId}`);
            
        } catch (error) {
            console.error(`❌ Error loading video:`, error);
            this.sendError(ws, `Video loading failed: ${error.message}`);
        }
    }

    /**
     * Handle line analysis request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} data - Message data
     * @param {string} connectionId - Connection ID
     */
    async handleAnalyzeLines(ws, data, connectionId) {
        try {
            // Validate request data
            if (!data || !data.experimentId || typeof data.frameNum !== 'number' || !Array.isArray(data.lines)) {
                this.sendError(ws, 'analyzeLines requires experimentId, frameNum, and lines array');
                return;
            }
            
            const { experimentId, frameNum, lines } = data;
            this.stats.totalAnalysisRequests++;
            
            // Limit lines per request
            if (lines.length > 10) {
                this.sendError(ws, 'Maximum 10 lines per analysis request');
                return;
            }
            
            console.log(`🔍 Analyzing ${lines.length} lines for ${experimentId} frame ${frameNum}`);
            
            // Perform analysis
            const analysisResult = await this.thermalService.analyzeLines(experimentId, frameNum, lines);
            
            if (!analysisResult.success) {
                this.sendError(ws, `Analysis failed: ${analysisResult.error}`);
                return;
            }
            
            // Send analysis results
            this.sendResponse(ws, 'analysisResult', {
                experimentId: experimentId,
                frameNum: frameNum,
                lineCount: lines.length,
                results: analysisResult.data.results,
                statistics: this._calculateOverallStatistics(analysisResult.data.results),
                metadata: {
                    processingTime: analysisResult.metadata?.processingTime,
                    cacheUsed: analysisResult.metadata?.cacheUsed,
                    timestamp: new Date().toISOString()
                }
            });
            
        } catch (error) {
            console.error(`❌ Error analyzing lines:`, error);
            this.stats.errors++;
            this.sendError(ws, `Line analysis failed: ${error.message}`);
        }
    }

    /**
     * Handle pixel temperature request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} data - Message data
     * @param {string} connectionId - Connection ID
     */
    async handlePixelTemperature(ws, data, connectionId) {
        try {
            // Validate request data
            if (!data || !data.experimentId || 
                typeof data.r !== 'number' || typeof data.g !== 'number' || typeof data.b !== 'number') {
                this.sendError(ws, 'pixelTemperature requires experimentId and RGB values');
                return;
            }
            
            const { experimentId, r, g, b } = data;
            
            // Get pixel temperature
            const tempResult = await this.thermalService.getPixelTemperature(experimentId, r, g, b);
            
            if (!tempResult.success) {
                this.sendError(ws, `Temperature lookup failed: ${tempResult.error}`);
                return;
            }
            
            // Send temperature result
            this.sendResponse(ws, 'pixelTempResult', {
                experimentId: experimentId,
                rgb: { r, g, b },
                temperature: tempResult.temperature,
                hasTemperature: tempResult.hasTemperature,
                metadata: tempResult.metadata
            });
            
        } catch (error) {
            console.error(`❌ Error getting pixel temperature:`, error);
            this.stats.errors++;
            this.sendError(ws, `Pixel temperature failed: ${error.message}`);
        }
    }

    /**
     * Handle video info request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} data - Message data
     * @param {string} connectionId - Connection ID
     */
    async handleVideoInfo(ws, data, connectionId) {
        try {
            if (!data || !data.experimentId) {
                this.sendError(ws, 'videoInfo requires experimentId');
                return;
            }
            
            const { experimentId } = data;
            
            // Get video metadata
            const metadataResult = await this.thermalService.getThermalMetadata(experimentId);
            
            if (!metadataResult.success) {
                this.sendError(ws, `Failed to get video info: ${metadataResult.error}`);
                return;
            }
            
            this.sendResponse(ws, 'videoInfo', {
                experimentId: experimentId,
                videoInfo: metadataResult.videoInfo,
                capabilities: metadataResult.thermalSpecific
            });
            
        } catch (error) {
            console.error(`❌ Error getting video info:`, error);
            this.sendError(ws, `Video info failed: ${error.message}`);
        }
    }

    /**
     * Handle explicit disconnect request
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} connectionId - Connection ID
     */
    async handleExplicitDisconnect(ws, connectionId) {
        console.log(`🔌 Explicit disconnect requested by ${connectionId}`);
        
        this.sendResponse(ws, 'disconnecting', {
            message: 'Disconnecting as requested',
            timestamp: new Date().toISOString()
        });
        
        // Close connection after short delay to ensure message is sent
        setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
                ws.close(1000, 'Client requested disconnect');
            }
        }, 100);
    }

    /**
     * Handle connection disconnect/close
     * @param {string} connectionId - Connection ID
     * @param {number} code - Close code
     * @param {string} reason - Close reason
     */
    handleDisconnect(connectionId, code, reason) {
        const connectionInfo = this.connections.get(connectionId);
        
        if (connectionInfo) {
            console.log(`🔌 WebSocket disconnected: ${connectionId} (code: ${code}, reason: ${reason})`);
            
            // Update video usage tracking
            if (connectionInfo.currentExperiment) {
                const currentCount = this.activeVideos.get(connectionInfo.currentExperiment) || 1;
                const newCount = Math.max(0, currentCount - 1);
                
                if (newCount === 0) {
                    this.activeVideos.delete(connectionInfo.currentExperiment);
                    // Optionally clear cache for unused experiments
                    setTimeout(() => {
                        if (!this.activeVideos.has(connectionInfo.currentExperiment)) {
                            console.log(`🗑️ Clearing unused thermal cache for ${connectionInfo.currentExperiment}`);
                            this.thermalService.clearCache(connectionInfo.currentExperiment);
                        }
                    }, 60000); // Clear after 1 minute of inactivity
                } else {
                    this.activeVideos.set(connectionInfo.currentExperiment, newCount);
                }
            }
            
            // Remove connection
            this.connections.delete(connectionId);
            this.stats.activeConnections--;
            
            console.log(`📊 Active connections: ${this.stats.activeConnections}`);
        }
    }

    /**
     * Send formatted response to client
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} type - Response type
     * @param {Object} data - Response data
     */
    sendResponse(ws, type, data) {
        try {
            if (ws.readyState === ws.OPEN) {
                const response = {
                    type: type,
                    data: data,
                    timestamp: new Date().toISOString()
                };
                
                ws.send(JSON.stringify(response));
            }
        } catch (error) {
            console.error(`❌ Error sending response:`, error);
        }
    }

    /**
     * Send error response to client
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} message - Error message
     */
    sendError(ws, message) {
        this.stats.errors++;
        this.sendResponse(ws, 'error', {
            message: message,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get service statistics
     * @returns {Object} Service statistics and status
     */
    getServiceStats() {
        const connectionStats = [];
        
        for (const [id, conn] of this.connections.entries()) {
            connectionStats.push({
                id: id,
                clientIP: conn.clientIP,
                connectedAt: conn.connectedAt,
                currentExperiment: conn.currentExperiment,
                messageCount: conn.messageCount,
                lastActivity: conn.lastActivity
            });
        }
        
        return {
            serviceName: this.serviceName,
            stats: this.stats,
            connections: {
                active: this.stats.activeConnections,
                total: this.stats.totalConnections,
                details: connectionStats
            },
            activeVideos: Object.fromEntries(this.activeVideos),
            thermalServiceCache: this.thermalService.getCacheStatus(),
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        };
    }

    /**
     * Cleanup inactive connections
     */
    cleanupInactiveConnections() {
        const now = Date.now();
        const maxInactiveTime = 5 * 60 * 1000; // 5 minutes
        
        for (const [connectionId, conn] of this.connections.entries()) {
            const inactiveTime = now - conn.lastActivity.getTime();
            
            if (inactiveTime > maxInactiveTime) {
                console.log(`🧹 Cleaning up inactive connection: ${connectionId}`);
                
                if (conn.ws.readyState === conn.ws.OPEN) {
                    conn.ws.close(1001, 'Connection inactive');
                }
                
                this.handleDisconnect(connectionId, 1001, 'Cleanup - inactive');
            }
        }
    }

    // === PRIVATE HELPER METHODS ===

    /**
     * Calculate overall statistics from multiple line results
     * @private
     * @param {Array} results - Analysis results
     * @returns {Object} Overall statistics
     */
    _calculateOverallStatistics(results) {
        const successfulResults = results.filter(r => r.success);
        
        if (successfulResults.length === 0) {
            return {
                successfulLines: 0,
                totalTemperaturePoints: 0,
                overallRange: null
            };
        }
        
        let totalPoints = 0;
        let allTemperatures = [];
        
        for (const result of successfulResults) {
            totalPoints += result.temperatures.length;
            allTemperatures.push(...result.temperatures.filter(t => t >= 0));
        }
        
        let overallRange = null;
        if (allTemperatures.length > 0) {
            overallRange = {
                min: Math.min(...allTemperatures),
                max: Math.max(...allTemperatures),
                avg: allTemperatures.reduce((a, b) => a + b, 0) / allTemperatures.length
            };
        }
        
        return {
            successfulLines: successfulResults.length,
            totalTemperaturePoints: totalPoints,
            validTemperaturePoints: allTemperatures.length,
            overallRange: overallRange
        };
    }
}

module.exports = ThermalWebSocketService;