/**
 * Experiment Analyzer - Node.js Backend Server
 * Main entry point (equivalent to C# Program.cs)
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config/config');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// Import routes
const experimentsRouter = require('./routes/experiments');

// Import services
const { initializeDatabase } = require('./database/connection');
const StartupService = require('./services/StartupService');

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
        const server = app.listen(config.server.port, config.server.host, () => {
            console.log(`Server running on http://${config.server.host}:${config.server.port}`);
            console.log(`Experiment Analyzer ready for use!`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            console.log('Shutting down server gracefully...');
            server.close(() => {
                console.log('✓ Server closed');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            console.log('Shutting down server gracefully...');
            server.close(() => {
                console.log('✓ Server closed');
                process.exit(0);
            });
        });

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