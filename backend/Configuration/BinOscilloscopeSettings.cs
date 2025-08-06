namespace ExperimentAnalyzer.Configuration;

/// <summary>
/// Configuration settings for binary oscilloscope data processing
/// Binds to "BinOscilloscopeSettings" section in appsettings.json
/// Supports sequential reading approach with automatic temp file optimization
/// Includes smart MinMax-LTTB decimation for browser compatibility
/// </summary>
public class BinOscilloscopeSettings
{
    /// <summary>
    /// Buffer size for file I/O operations in bytes
    /// Default: 1MB buffer for efficient streaming and file copying
    /// </summary>
    public int StreamingBufferSize { get; set; } = 1024 * 1024;
    
    /// <summary>
    /// Maximum file size to process in bytes
    /// Default: 4GB limit for safety
    /// </summary>
    public long MaxFileSizeBytes { get; set; } = 4L * 1024 * 1024 * 1024;
    
    /// <summary>
    /// Timeout for processing operations in seconds
    /// Default: 5 minutes for large file processing (reduced from 10min due to temp file optimization)
    /// </summary>
    public int ProcessingTimeoutSeconds { get; set; } = 300;
    
    /// <summary>
    /// Whether to enable detailed logging for binary processing
    /// Default: false (only log warnings/errors)
    /// </summary>
    public bool EnableDetailedLogging { get; set; } = false;

    // Temp file management settings
    /// <summary>
    /// Root directory for temporary file storage
    /// Default: "C:\temp\experiment_bin_files" for optimal local disk performance
    /// </summary>
    public string TempFileDirectory { get; set; } = Path.Combine("C:", "temp", "experiment_bin_files");
    
    /// <summary>
    /// Maximum age of temp files before cleanup in hours
    /// Default: 24 hours (files older than this will be automatically deleted)
    /// </summary>
    public int TempFileMaxAgeHours { get; set; } = 24;
    
    /// <summary>
    /// Whether to automatically cleanup old temp files during processing
    /// Default: true (cleanup happens once per processing session)
    /// </summary>
    public bool EnableTempFileCleanup { get; set; } = true;
    
    /// <summary>
    /// Whether to reuse existing temp files if they're recent
    /// Default: true (avoids re-copying if temp file is newer than source or less than 1 hour old)
    /// </summary>
    public bool EnableTempFileReuse { get; set; } = true;
    
    /// <summary>
    /// Maximum age of temp files to reuse in hours
    /// Default: 1 hour (temp files older than this will be re-copied from network)
    /// </summary>
    public int TempFileReuseMaxAgeHours { get; set; } = 1;

    // Smart decimation settings (Phase 2)
    /// <summary>
    /// Default maximum points for browser compatibility
    /// Default: 2000 points (safe for all browsers, good performance)
    /// </summary>
    public int DefaultMaxPoints { get; set; } = 2000;
    
    /// <summary>
    /// Maximum allowed points (hard limit to prevent browser crashes)
    /// Default: 10000 points (absolute maximum, may be slow in some browsers)
    /// </summary>
    public int MaxAllowedPoints { get; set; } = 10000;
    
    /// <summary>
    /// Enable smart MinMax-LTTB decimation with spike preservation
    /// Default: true (uses intelligent algorithm to preserve signal characteristics)
    /// </summary>
    public bool EnableSmartDecimation { get; set; } = true;
    
    /// <summary>
    /// Spike detection threshold for preserving important signal variations
    /// Default: 0.1 (10% variation threshold - signals with >10% variation get spike preservation)
    /// Range: 0.01 (1% - very sensitive) to 0.5 (50% - only major spikes)
    /// </summary>
    public double SpikeDetectionThreshold { get; set; } = 0.1;
    
    /// <summary>
    /// Minimum bucket size for smart decimation algorithm
    /// Default: 3 (each bucket needs at least 3 points to analyze variation)
    /// Range: 1 (no minimum) to 10 (large buckets, less detail)
    /// </summary>
    public int MinBucketSize { get; set; } = 3;
    
    /// <summary>
    /// Maximum points per bucket for spike preservation
    /// Default: 3 (min + max + average when significant variation detected)
    /// Range: 1 (just average) to 5 (very detailed spike preservation)
    /// </summary>
    public int MaxPointsPerBucket { get; set; } = 3;

    // Welding calculation constants - can be overridden via configuration
    /// <summary>
    /// Transformer current multiplier used in DC current calculations
    /// Default: 35.0 (matches standalone application)
    /// </summary>
    public double TrafoCurrentMultiplier { get; set; } = 35.0;
    
    /// <summary>
    /// First pressure to force conversion multiplier for F_Schlitten calculation
    /// Default: 6.2832 (matches standalone application)
    /// </summary>
    public double PressureToForceMultiplier1 { get; set; } = 6.2832;
    
    /// <summary>
    /// Second pressure to force conversion multiplier for F_Schlitten calculation
    /// Default: 5.0108 (matches standalone application)
    /// </summary>
    public double PressureToForceMultiplier2 { get; set; } = 5.0108;

    // Processing behavior settings
    /// <summary>
    /// Whether to use sequential reading approach (recommended)
    /// Default: true (matches standalone application logic)
    /// </summary>
    public bool UseSequentialReading { get; set; } = true;
    
    /// <summary>
    /// Whether to include calculated welding parameters in API response
    /// Default: true (provides channels 8-11 with welding calculations)
    /// </summary>
    public bool IncludeWeldingCalculations { get; set; } = true;

    // Validation and safety settings
    /// <summary>
    /// Maximum number of channels expected in response
    /// Default: 12 (8 raw oscilloscope + 4 calculated welding)
    /// </summary>
    public int MaxExpectedChannels { get; set; } = 12;
    
    /// <summary>
    /// Whether to validate welding calculation results
    /// Default: true (log warnings for unexpected values)
    /// </summary>
    public bool ValidateWeldingCalculations { get; set; } = true;
    
    /// <summary>
    /// Maximum reasonable DC current value for validation (Amperes)
    /// Default: 10000A (values above this trigger warnings)
    /// </summary>
    public double MaxReasonableDcCurrent { get; set; } = 10000.0;
    
    /// <summary>
    /// Maximum reasonable DC voltage value for validation (Volts)
    /// Default: 1000V (values above this trigger warnings)
    /// </summary>
    public double MaxReasonableDcVoltage { get; set; } = 1000.0;
    
    /// <summary>
    /// Maximum reasonable force value for validation (kN)
    /// Default: 100kN (values above this trigger warnings)
    /// </summary>
    public double MaxReasonableForce { get; set; } = 100.0;

    // Performance tuning settings
    /// <summary>
    /// Whether to log processing performance metrics
    /// Default: true (helps with monitoring and optimization)
    /// </summary>
    public bool LogPerformanceMetrics { get; set; } = true;
    
    /// <summary>
    /// Whether to log temp file operations (copy, reuse, cleanup)
    /// Default: true (helps with monitoring temp file system)
    /// </summary>
    public bool LogTempFileOperations { get; set; } = true;
    
    /// <summary>
    /// Whether to log smart decimation statistics (spikes preserved, buckets processed)
    /// Default: true (helps with monitoring decimation quality)
    /// </summary>
    public bool LogDecimationStatistics { get; set; } = true;

    // Channel label validation (optional - can be used for validation)
    /// <summary>
    /// Expected labels for raw oscilloscope channels (channels 0-7)
    /// Used for validation if not empty
    /// </summary>
    public string[] ExpectedRawChannelLabels { get; set; } = Array.Empty<string>();
    
    /// <summary>
    /// Expected units for raw oscilloscope channels (channels 0-7)
    /// Used for validation if not empty  
    /// </summary>
    public string[] ExpectedRawChannelUnits { get; set; } = Array.Empty<string>();

    // Helper methods for validation and smart decimation
    /// <summary>
    /// Validates if a DC current value is within reasonable bounds
    /// </summary>
    public bool IsReasonableDcCurrent(double current) => Math.Abs(current) <= MaxReasonableDcCurrent;
    
    /// <summary>
    /// Validates if a DC voltage value is within reasonable bounds
    /// </summary>
    public bool IsReasonableDcVoltage(double voltage) => Math.Abs(voltage) <= MaxReasonableDcVoltage;
    
    /// <summary>
    /// Validates if a force value is within reasonable bounds
    /// </summary>
    public bool IsReasonableForce(double force) => Math.Abs(force) <= MaxReasonableForce;
    
    /// <summary>
    /// Gets the full path for the temp file directory, creating it if necessary
    /// </summary>
    public string GetTempFileDirectory()
    {
        if (!Directory.Exists(TempFileDirectory))
        {
            Directory.CreateDirectory(TempFileDirectory);
        }
        return TempFileDirectory;
    }
    
    /// <summary>
    /// Determines if a temp file should be reused based on age and settings
    /// </summary>
    public bool ShouldReuseTempFile(string tempFilePath, string originalFilePath)
    {
        if (!EnableTempFileReuse || !File.Exists(tempFilePath))
            return false;
            
        var tempFileAge = DateTime.Now - File.GetLastWriteTime(tempFilePath);
        
        // Reuse if temp file is newer than original or within reuse age limit
        return tempFileAge < TimeSpan.FromHours(TempFileReuseMaxAgeHours) ||
               File.GetLastWriteTime(tempFilePath) >= File.GetLastWriteTime(originalFilePath);
    }
    
    /// <summary>
    /// Determines if a temp file should be cleaned up based on age and settings
    /// </summary>
    public bool ShouldCleanupTempFile(string tempFilePath)
    {
        if (!EnableTempFileCleanup || !File.Exists(tempFilePath))
            return false;
            
        var tempFileAge = DateTime.Now - File.GetLastWriteTime(tempFilePath);
        return tempFileAge > TimeSpan.FromHours(TempFileMaxAgeHours);
    }
    
    /// <summary>
    /// Validates maxPoints parameter is within acceptable range
    /// </summary>
    public int ValidateMaxPoints(int requestedPoints)
    {
        if (requestedPoints < 100)
        {
            return 100; // Minimum reasonable points
        }
        
        if (requestedPoints > MaxAllowedPoints)
        {
            return MaxAllowedPoints; // Enforce hard limit
        }
        
        return requestedPoints;
    }
    
    /// <summary>
    /// Determines if smart decimation should be applied based on settings and data size
    /// </summary>
    public bool ShouldApplySmartDecimation(int totalPoints, int maxPoints)
    {
        return EnableSmartDecimation && totalPoints > maxPoints && totalPoints > MinBucketSize;
    }
    
    /// <summary>
    /// Validates smart decimation configuration is properly set up
    /// </summary>
    public bool IsSmartDecimationConfigured()
    {
        return EnableSmartDecimation && 
               SpikeDetectionThreshold > 0 && SpikeDetectionThreshold < 1.0 &&
               MinBucketSize >= 1 && MinBucketSize <= 100 &&
               MaxPointsPerBucket >= 1 && MaxPointsPerBucket <= 10 &&
               DefaultMaxPoints > 0 && MaxAllowedPoints >= DefaultMaxPoints;
    }
    
    /// <summary>
    /// Gets a summary of smart decimation configuration for logging
    /// </summary>
    public string GetSmartDecimationConfigSummary()
    {
        return $"Smart Decimation Config: Enabled={EnableSmartDecimation}, " +
               $"SpikeThreshold={SpikeDetectionThreshold:P1}, " +
               $"MinBucket={MinBucketSize}, MaxPerBucket={MaxPointsPerBucket}, " +
               $"DefaultPoints={DefaultMaxPoints}, MaxPoints={MaxAllowedPoints}";
    }
}