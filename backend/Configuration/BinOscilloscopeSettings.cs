namespace ExperimentAnalyzer.Configuration;

/// Configuration settings for binary oscilloscope data processing
/// Binds to "BinOscilloscopeSettings" section in appsettings.json
public class BinOscilloscopeSettings
{
        /// Maximum number of data points for overview/cached data
    /// Default: 5000 points for fast visualization
        public int MaxOverviewPoints { get; set; } = 5000;
    
        /// Buffer size for file I/O operations in bytes
    /// Default: 1MB buffer for efficient streaming
        public int StreamingBufferSize { get; set; } = 1024 * 1024;
    
        /// Maximum file size to process in bytes
    /// Default: 4GB limit for safety
        public long MaxFileSizeBytes { get; set; } = 4L * 1024 * 1024 * 1024;
    
        /// Timeout for processing operations in seconds
    /// Default: 10 minutes for large file processing
        public int ProcessingTimeoutSeconds { get; set; } = 600;
    
        /// Whether to enable detailed logging for binary processing
    /// Default: false (only log warnings/errors)
        public bool EnableDetailedLogging { get; set; } = false;
}