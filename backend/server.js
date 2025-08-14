/**
 * Experiment Analyzer - Node.js Backend Server
 * Main entry point (equivalent to C# Program.cs)
 * Enhanced with WebSocket support for thermal analysis
 * MODIFIED: Added Electron integration and R: drive database handling
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const config = require('./config/config');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// Import routes
const experimentsRouter = require('./routes/experiments');

// Import services
const { initializeDatabase } = require('./database/connection');
const StartupService = require('./services/StartupService');
const ThermalWebSocketService = require('./services/ThermalWebSocketService');

async function createApp() {
    const app = express();

    // Log environment information
    config.logEnvironmentInfo();

    // Validate configuration
    try {
        config.validate();
        console.log('✓ Configuration validated successfully');
        
        // MODIFIED: Check R: drive access for Electron
        if (config.isElectron) {
            console.log('🔍 Verifying R: drive access...');
            config.checkRDriveAccess(); // Throws error if inaccessible
            console.log('✓ R: drive access verified');
        }
        
    } catch (error) {
        console.error('❌ Configuration validation failed:', error.message);
        
        // MODIFIED: In Electron, show more user-friendly error handling
        if (config.isElectron) {
            // Error handling is done in electron-main.js with dialog
            throw error; // Re-throw for Electron main process to handle
        }
        
        process.exit(1);
    }

    // Middleware setup
    // MODIFIED: Enhanced CORS for Electron
    if (config.app.enableCors) {
        const corsOptions = {
            origin: config.isElectron 
                ? [`http://localhost:${config.server.port}`, `http://127.0.0.1:${config.server.port}`]
                : true,
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
        };
        
        app.use(cors(corsOptions));
        console.log(`✓ CORS enabled ${config.isElectron ? '(Electron mode)' : '(Web mode)'}`);
    }

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Request logging middleware
    if (config.app.enableLogging) {
        app.use((req, res, next) => {
            const timestamp = new Date().toISOString();
            const logPrefix = config.isElectron ? '[Electron-Backend]' : '[Backend]';
            console.log(`${logPrefix} ${timestamp} - ${req.method} ${req.url}`);
            next();
        });
    }

    // ===== THERMAL VIDEO STATIC SERVING =====
    // Create thermal cache directory if it doesn't exist
    const thermalCacheDir = config.thermal.cacheDir;
    if (!fs.existsSync(thermalCacheDir)) {
        fs.mkdirSync(thermalCacheDir, { recursive: true });
        console.log(`✓ Created thermal cache directory: ${thermalCacheDir}`);
    }

    // Serve thermal videos statically (Express handles all file access properly)
    app.use('/cache/thermal', express.static(thermalCacheDir, {
        maxAge: '1h',           // Cache for 1 hour
        etag: true,             // Enable ETags for proper caching
        lastModified: true,     // Enable Last-Modified headers
        acceptRanges: true,     // Enable range requests for video seeking
        cacheControl: true,     // Enable Cache-Control headers
        immutable: false        // Files can be updated
    }));

    console.log(`✓ Thermal video static serving enabled: /cache/thermal -> ${thermalCacheDir}`);
    // ===== END THERMAL VIDEO STATIC SERVING =====

    // API Routes
    app.use('/api/experiments', experimentsRouter);

    // MODIFIED: Enhanced health check endpoint with Electron info
    app.get('/api/health', (req, res) => {
        res.json({
            success: true,
            data: {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: require('./package.json').version,
                environment: config.server.nodeEnv,
                electron: config.isElectron,
                database: config.isElectron ? 'R:\\Schweissungen\\experiments.db' : config.database.fullPath,
                experimentsRoot: config.experiments.rootPath,
                thermalCacheEnabled: true,
                thermalCacheDir: thermalCacheDir,
                port: config.server.port,
                rDriveAccessible: config.isElectron ? true : 'N/A' // If we get here, R: drive is accessible
            }
        });
    });

    // MODIFIED: Enhanced frontend serving for Electron
    const frontendPath = config.frontend.path;
    
    if (fs.existsSync(frontendPath)) {
        console.log(`✓ Serving frontend files from: ${frontendPath}`);
        app.use(express.static(frontendPath, {
            ...config.frontend.staticOptions,
            // MODIFIED: Add Electron-specific headers
            setHeaders: (res, path, stat) => {
                if (config.isElectron) {
                    // Add Electron identification header
                    res.set('X-Powered-By', 'Electron-ExperimentAnalyzer');
                    
                    // Disable some security headers that aren't needed in Electron
                    res.removeHeader('X-Powered-By');
                }
            }
        }));
        
        // SPA fallback - serve index.html for non-API routes
        app.get('*', (req, res) => {
            if (!req.url.startsWith('/api/') && !req.url.startsWith('/cache/')) {
                res.sendFile(path.join(frontendPath, 'index.html'));
            } else {
                res.status(404).json({ 
                    success: false, 
                    error: 'Endpoint not found',
                    electron: config.isElectron 
                });
            }
        });
    } else {
        console.warn(`⚠️  Frontend directory not found at: ${frontendPath}`);
        app.get('/', (req, res) => {
            res.json({ 
                success: false, 
                error: 'Frontend not found',
                message: 'Please ensure the frontend directory exists',
                electron: config.isElectron,
                frontendPath: frontendPath
            });
        });
    }

    // Global error handler (must be last)
    // MODIFIED: Enhanced error handler for Electron
    app.use((error, req, res, next) => {
        console.error(`❌ ${config.isElectron ? '[Electron-Backend]' : '[Backend]'} Error:`, error);
        
        // Enhanced error information for Electron
        const errorResponse = {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            electron: config.isElectron
        };
        
        // Add more details in development
        if (config.server.nodeEnv === 'development') {
            errorResponse.stack = error.stack;
            errorResponse.details = error;
        }
        
        // R: drive specific errors
        if (error.message.includes('R:') || error.message.includes('ENOENT')) {
            errorResponse.troubleshooting = [
                'Check if R: drive is mapped and accessible',
                'Verify network connection to R: drive',
                'Ensure read/write permissions to R:\\Schweissungen',
                'Try restarting the application'
            ];
        }
        
        res.status(500).json(errorResponse);
    });

    return app;
}

async function startServer() {
    try {
        const logPrefix = config.isElectron ? '[Electron-Backend]' : '[Backend]';
        console.log(`${logPrefix} Starting Experiment Analyzer Backend...`);

        // Initialize database schema
        console.log(`${logPrefix} Initializing database...`);
        await initializeDatabase();
        console.log(`✓ Database initialized: ${config.database.fullPath}`);

        // Create Express app
        const app = await createApp();

        // Create HTTP server (needed for WebSocket integration)
        const server = require('http').createServer(app);

        // Initialize WebSocket server for thermal analysis
        console.log(`${logPrefix} Initializing WebSocket server for thermal analysis...`);
        const wss = new WebSocket.Server({ 
            server,
            path: '/thermal-ws'
        });

        // Initialize thermal WebSocket service
        const thermalWebSocketService = new ThermalWebSocketService();

        // Handle WebSocket connections
        wss.on('connection', (ws, request) => {
            thermalWebSocketService.handleConnection(ws, request);
        });

        // WebSocket server error handling
        wss.on('error', (error) => {
            console.error(`❌ ${logPrefix} WebSocket server error:`, error);
        });

        console.log(`✓ WebSocket server initialized for thermal analysis`);

        // Run startup services (equivalent to C# startup scope in Program.cs)
        if (config.app.autoScanOnStartup) {
            console.log(`${logPrefix} Running startup data services...`);
            const startupService = new StartupService();
            const success = await startupService.initializeAllData(false); // false = no force refresh
            
            if (success) {
                console.log(`✓ Startup data services completed successfully`);
            } else {
                console.warn(`⚠️  Startup data services completed with errors`);
            }
        }

        // Start server
        const serverInstance = server.listen(config.server.port, config.server.host, () => {
            const baseUrl = `http://${config.server.host}:${config.server.port}`;
            console.log(`🚀 ${logPrefix} Server running on ${baseUrl}`);
            console.log(`🔌 WebSocket endpoint: ws://${config.server.host}:${config.server.port}/thermal-ws`);
            console.log(`📹 Thermal video cache: ${baseUrl}/cache/thermal/`);
            console.log(`📊 Health check: ${baseUrl}/api/health`);
            
            if (config.isElectron) {
                console.log(`📱 Electron mode - Database: ${config.database.fullPath}`);
                console.log(`📂 Experiments root: ${config.experiments.rootPath}`);
            }
            
            console.log(`🎉 Experiment Analyzer ready for use!`);
        });

        // Setup periodic cleanup for WebSocket service
        const cleanupInterval = setInterval(() => {
            thermalWebSocketService.cleanupInactiveConnections();
        }, 60000); // Every minute

        // MODIFIED: Enhanced graceful shutdown for Electron
        const shutdown = (signal) => {
            console.log(`\n${logPrefix} Shutting down server gracefully after ${signal}...`);
            
            // Clear cleanup interval
            clearInterval(cleanupInterval);
            
            // Close WebSocket server
            console.log(`${logPrefix} Closing WebSocket server...`);
            wss.close(() => {
                console.log(`✓ WebSocket server closed`);
            });
            
            // Close HTTP server
            serverInstance.close(() => {
                console.log(`✓ ${logPrefix} Server closed`);
                
                // In Electron, don't exit process - let Electron handle it
                if (!config.isElectron) {
                    process.exit(0);
                }
            });
            
            // Force exit after timeout (but not in Electron)
            if (!config.isElectron) {
                setTimeout(() => {
                    console.log(`⚠️ Force exit after timeout`);
                    process.exit(1);
                }, 10000);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // Log server status
        console.log(`📊 ${logPrefix} Server Status:`);
        console.log(`   HTTP: http://${config.server.host}:${config.server.port}`);
        console.log(`   WebSocket: ws://${config.server.host}:${config.server.port}/thermal-ws`);
        console.log(`   Thermal Cache: /cache/thermal/`);
        console.log(`   Frontend: ${config.frontend.path}`);
        console.log(`   Database: ${config.database.fullPath}`);
        console.log(`   Mode: ${config.isElectron ? 'Electron Desktop App' : 'Web Application'}`);

        return serverInstance;

    } catch (error) {
        const logPrefix = config.isElectron ? '[Electron-Backend]' : '[Backend]';
        console.error(`❌ ${logPrefix} Failed to start server:`, error);
        
        // In Electron, re-throw for main process to handle with dialog
        if (config.isElectron) {
            throw error;
        }
        
        process.exit(1);
    }
}

// Start the server if this file is run directly
if (require.main === module) {
    startServer();
}

module.exports = { createApp, startServer };