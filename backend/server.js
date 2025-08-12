/**
 * Experiment Analyzer - Node.js Backend Server
 * Main entry point (equivalent to C# Program.cs)
 * Enhanced with WebSocket support for thermal analysis
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');
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

    // Validate configuration
    try {
        config.validate();
        console.log('✓ Configuration validated successfully');
    } catch (error) {
        console.error('Configuration validation failed:', error.message);
        process.exit(1);
    }

    // Middleware setup
    if (config.app.enableCors) {
        app.use(cors({
            origin: true,
            credentials: true
        }));
    }

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Request logging middleware
    if (config.app.enableLogging) {
        app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
            next();
        });
    }

    // API Routes
    app.use('/api/experiments', experimentsRouter);

    // Health check endpoint
    app.get('/api/health', (req, res) => {
        res.json({
            success: true,
            data: {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: require('./package.json').version
            }
        });
    });

    // Serve frontend static files (equivalent to C# UseStaticFiles)
    const frontendPath = config.frontend.path;
    if (require('fs').existsSync(frontendPath)) {
        console.log(`Serving frontend files from: ${frontendPath}`);
        app.use(express.static(frontendPath, config.frontend.staticOptions));
        
        // SPA fallback - serve index.html for non-API routes
        app.get('*', (req, res) => {
            if (!req.url.startsWith('/api/')) {
                res.sendFile(path.join(frontendPath, 'index.html'));
            } else {
                res.status(404).json({ success: false, error: 'API endpoint not found' });
            }
        });
    } else {
        console.warn(`Frontend directory not found at: ${frontendPath}`);
        app.get('/', (req, res) => {
            res.json({ 
                success: false, 
                error: 'Frontend not found',
                message: 'Please ensure the frontend directory exists'
            });
        });
    }

    // Global error handler (must be last)
    app.use(errorHandler);

    return app;
}

async function startServer() {
    try {
        console.log('Starting Experiment Analyzer Backend...');

        // Initialize database schema
        console.log('Initializing database...');
        await initializeDatabase();
        console.log('✓ Database initialized successfully');

        // Create Express app
        const app = await createApp();

        // Create HTTP server (needed for WebSocket integration)
        const server = require('http').createServer(app);

        // Initialize WebSocket server for thermal analysis
        console.log('Initializing WebSocket server for thermal analysis...');
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
            console.error('❌ WebSocket server error:', error);
        });

        console.log('✓ WebSocket server initialized for thermal analysis');

        // Run startup services (equivalent to C# startup scope in Program.cs)
        if (config.app.autoScanOnStartup) {
            console.log('Running startup data services...');
            const startupService = new StartupService();
            const success = await startupService.initializeAllData(false); // false = no force refresh
            
            if (success) {
                console.log('✓ Startup data services completed successfully');
            } else {
                console.warn('⚠ Startup data services completed with errors');
            }
        }

        // Start server
        const serverInstance = server.listen(config.server.port, config.server.host, () => {
            console.log(`Server running on http://${config.server.host}:${config.server.port}`);
            console.log(`WebSocket endpoint: ws://${config.server.host}:${config.server.port}/thermal-ws`);
            console.log(`Experiment Analyzer ready for use!`);
            console.log(`🔥 Thermal analysis WebSocket server active`);
        });

        // Setup periodic cleanup for WebSocket service
        const cleanupInterval = setInterval(() => {
            thermalWebSocketService.cleanupInactiveConnections();
        }, 60000); // Every minute

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\nShutting down server gracefully after ${signal}...`);
            
            // Clear cleanup interval
            clearInterval(cleanupInterval);
            
            // Close WebSocket server
            console.log('Closing WebSocket server...');
            wss.close(() => {
                console.log('✓ WebSocket server closed');
            });
            
            // Close HTTP server
            serverInstance.close(() => {
                console.log('✓ Server closed');
                process.exit(0);
            });
            
            // Force exit after timeout
            setTimeout(() => {
                console.log('⚠️ Force exit after timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // Log WebSocket server status
        console.log('📊 WebSocket Server Status:');
        console.log(`   Path: /thermal-ws`);
        console.log(`   Max Connections: Unlimited`);
        console.log(`   Cleanup Interval: 60 seconds`);
        console.log(`   Supported Messages: loadVideo, analyzeLines, pixelTemperature`);

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server if this file is run directly
if (require.main === module) {
    startServer();
}

module.exports = { createApp, startServer };