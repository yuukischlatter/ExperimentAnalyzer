/**
 * CORS Middleware Configuration
 * Custom CORS setup for Experiment Analyzer
 */

const cors = require('cors');

/**
 * CORS options for different environments
 */
const corsOptions = {
    development: {
        origin: true, // Allow all origins in development
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    },
    production: {
        origin: [
            'http://localhost:5000',
            'http://127.0.0.1:5000'
            // Add your production domains here
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }
};

/**
 * Get CORS configuration based on environment
 * @param {string} env - Environment (development/production)
 * @returns {Object} CORS options
 */
function getCorsOptions(env = 'development') {
    return corsOptions[env] || corsOptions.development;
}

/**
 * Create CORS middleware for Express
 * @param {string} env - Environment
 * @returns {Function} CORS middleware
 */
function createCorsMiddleware(env = 'development') {
    const options = getCorsOptions(env);
    console.log(`CORS configured for ${env} environment`);
    return cors(options);
}

module.exports = {
    getCorsOptions,
    createCorsMiddleware
};