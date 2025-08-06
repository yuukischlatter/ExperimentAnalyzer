/**
 * API Response Models
 * Converts C# Models/Api/ApiResponse.cs to JavaScript helper functions
 */

/**
 * Create successful API response
 * @param {*} data - The response data
 * @param {Object} metadata - Optional metadata
 * @returns {Object} Formatted API response
 */
function createSuccessResponse(data, metadata = {}) {
    return {
        success: true,
        data: data,
        error: null,
        metadata: {
            timestamp: new Date().toISOString(),
            requestId: metadata.requestId || generateRequestId(),
            processingTimeMs: metadata.processingTimeMs || null,
            ...metadata
        }
    };
}

/**
 * Create error API response
 * @param {string} errorMessage - Error message
 * @param {Object} metadata - Optional metadata
 * @returns {Object} Formatted API response
 */
function createErrorResponse(errorMessage, metadata = {}) {
    return {
        success: false,
        data: null,
        error: errorMessage,
        metadata: {
            timestamp: new Date().toISOString(),
            requestId: metadata.requestId || generateRequestId(),
            processingTimeMs: metadata.processingTimeMs || null,
            ...metadata
        }
    };
}

/**
 * Create service result (equivalent to C# ServiceResult)
 * @param {boolean} success - Whether operation succeeded
 * @param {string} message - Result message
 * @param {number} processedCount - Number of items processed
 * @param {number} skippedCount - Number of items skipped
 * @param {number} durationMs - Processing duration in milliseconds
 * @param {Array} errors - Array of error messages
 * @returns {Object} Service result object
 */
function createServiceResult(success = true, message = '', processedCount = 0, skippedCount = 0, durationMs = 0, errors = []) {
    return {
        success,
        message,
        processedCount,
        skippedCount,
        duration: durationMs,
        errors: Array.isArray(errors) ? errors : []
    };
}

/**
 * Generate unique request ID
 * @returns {string} Unique request identifier
 */
function generateRequestId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Express middleware to add request timing and ID
 * Usage: app.use(responseMiddleware);
 */
function responseMiddleware(req, res, next) {
    // Add request ID and start time
    req.requestId = generateRequestId();
    req.startTime = Date.now();
    
    // Override res.json to automatically format responses
    const originalJson = res.json;
    res.json = function(data) {
        const processingTime = Date.now() - req.startTime;
        
        // If data is already formatted (has success property), just add metadata
        if (data && typeof data === 'object' && data.hasOwnProperty('success')) {
            if (data.metadata) {
                data.metadata.requestId = req.requestId;
                data.metadata.processingTimeMs = processingTime;
            }
            return originalJson.call(this, data);
        }
        
        // Otherwise, format as success response
        const formattedResponse = createSuccessResponse(data, {
            requestId: req.requestId,
            processingTimeMs: processingTime
        });
        
        return originalJson.call(this, formattedResponse);
    };
    
    // Add helper methods to response object
    res.success = function(data, metadata = {}) {
        const response = createSuccessResponse(data, {
            requestId: req.requestId,
            processingTimeMs: Date.now() - req.startTime,
            ...metadata
        });
        return this.json(response);
    };
    
    res.error = function(errorMessage, statusCode = 500, metadata = {}) {
        const response = createErrorResponse(errorMessage, {
            requestId: req.requestId,
            processingTimeMs: Date.now() - req.startTime,
            ...metadata
        });
        return this.status(statusCode).json(response);
    };
    
    next();
}

module.exports = {
    createSuccessResponse,
    createErrorResponse,
    createServiceResult,
    generateRequestId,
    responseMiddleware
};