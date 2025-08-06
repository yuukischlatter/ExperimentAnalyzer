namespace ExperimentAnalyzer.Configuration;

/// <summary>
/// Configuration settings for binary oscilloscope data processing
/// Binds to "BinOscilloscopeSettings" section in appsettings.json
/// Supports sequential reading approach with welding calculations
/// </summary>
public class BinOscilloscopeSettings
{
    /// <summary>
    /// Maximum number of data points for overview/cached data
    /// Default: 5000 points for fast visualization
    /// </summary>
    public int MaxOverviewPoints { get; set; } = 5000;
    
    /// <summary>
    /// Buffer size for file I/O operations in bytes
    /// Default: 1MB buffer for efficient streaming
    /// </summary>
    public int StreamingBufferSize { get; set; } = 1024 * 1024;
    
    /// <summary>
    /// Maximum file size to process in bytes
    /// Default: 4GB limit for safety
    /// </summary>
    public long MaxFileSizeBytes { get; set; } = 4L * 1024 * 1024 * 1024;
    
    /// <summary>
    /// Timeout for processing operations in seconds
    /// Default: 10 minutes for large file processing
    /// </summary>
    public int ProcessingTimeoutSeconds { get; set; } = 600;
    
    /// <summary>
    /// Whether to enable detailed logging for binary processing
    /// Default: false (only log warnings/errors)
    /// </summary>
    public bool EnableDetailedLogging { get; set; } = false;

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
    
    /// <summary>
    /// Whether to cache overview data in database
    /// Default: true (improves performance for repeated requests)
    /// </summary>
    public bool EnableOverviewCaching { get; set; } = true;

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
    /// Minimum decimation ratio for overview generation
    /// Default: 1 (no minimum decimation)
    /// </summary>
    public int MinDecimationRatio { get; set; } = 1;
    
    /// <summary>
    /// Maximum decimation ratio for overview generation
    /// Default: 1000 (prevent excessive decimation)
    /// </summary>
    public int MaxDecimationRatio { get; set; } = 1000;
    
    /// <summary>
    /// Whether to log processing performance metrics
    /// Default: true (helps with monitoring and optimization)
    /// </summary>
    public bool LogPerformanceMetrics { get; set; } = true;

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

    // Helper methods for validation
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
}