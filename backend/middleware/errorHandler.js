/**
 * Global Error Handler Middleware
 * Handles all unhandled errors in the Express application
 */

const { createErrorResponse } = require('../models/ApiResponse');

function errorHandler(err, req, res, next) {
    // Log the error for debugging
    console.error(`Error in ${req.method} ${req.path}:`, err);

    // Default error response
    let statusCode = 500;
    let errorMessage = 'Internal Server Error';

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        errorMessage = err.message;
    } else if (err.name === 'UnauthorizedError') {
        statusCode = 401;
        errorMessage = 'Unauthorized';
    } else if (err.code === 'ENOENT') {
        statusCode = 404;
        errorMessage = 'File or resource not found';
    } else if (err.code === 'EACCES') {
        statusCode = 403;
        errorMessage = 'Access denied';
    } else if (err.message) {
        errorMessage = err.message;
    }

    // Create formatted error response
    const errorResponse = createErrorResponse(errorMessage, {
        requestId: req.requestId,
        processingTimeMs: req.startTime ? Date.now() - req.startTime : null,
        error: process.env.NODE_ENV === 'development' ? {
            stack: err.stack,
            name: err.name,
            code: err.code
        } : undefined
    });

    res.status(statusCode).json(errorResponse);
}

module.exports = errorHandler;