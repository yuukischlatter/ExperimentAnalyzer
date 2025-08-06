namespace ExperimentAnalyzer.Models.Data;

/// <summary>
/// Main response containing binary oscilloscope data with time arrays and channel data
/// Contains 12 total channels: 8 raw oscilloscope channels + 4 calculated welding parameters
/// </summary>
public class BinOscilloscopeData
{
    /// Time array in milliseconds from experiment start
    public double[] TimeArray { get; set; } = Array.Empty<double>();
    
    /// Channel data dictionary - supports channels 0-11
    /// Channels 0-7: Raw oscilloscope data from PicoScope
    /// Channels 8-11: Calculated welding parameters
    public Dictionary<int, ChannelData> Channels { get; set; } = new Dictionary<int, ChannelData>();
    
    /// Metadata about the binary file (describes 8 physical channels)
    public BinFileMetadata Metadata { get; set; } = new BinFileMetadata();
    
    /// Requested time range (null if full data requested)
    public TimeRange? RequestedRange { get; set; }
    
    /// Total number of data points returned
    public int TotalDataPoints { get; set; }

    // Channel index constants for calculated welding parameters
    /// <summary>DC Current Group 1 calculated channel index</summary>
    public const int CHANNEL_I_DC_GR1 = 8;
    
    /// <summary>DC Current Group 2 calculated channel index</summary>
    public const int CHANNEL_I_DC_GR2 = 9;
    
    /// <summary>DC Voltage calculated channel index</summary>
    public const int CHANNEL_U_DC = 10;
    
    /// <summary>Force from pressure sensors calculated channel index</summary>
    public const int CHANNEL_F_SCHLITTEN = 11;

    // Raw channel constants for reference
    /// <summary>Raw voltage UL1L2 channel index</summary>
    public const int CHANNEL_UL1L2 = 0;
    
    /// <summary>Raw voltage UL2L3 channel index</summary>
    public const int CHANNEL_UL2L3 = 1;
    
    /// <summary>Raw current IL1GR1 channel index</summary>
    public const int CHANNEL_IL1GR1 = 2;
    
    /// <summary>Raw current IL3GR1 channel index</summary>
    public const int CHANNEL_IL3GR1 = 3;
    
    /// <summary>Raw current IL1GR2 channel index</summary>
    public const int CHANNEL_IL1GR2 = 4;
    
    /// <summary>Raw current IL3GR2 channel index</summary>
    public const int CHANNEL_IL3GR2 = 5;
    
    /// <summary>Raw pressure P_Vor channel index</summary>
    public const int CHANNEL_P_VOR = 6;
    
    /// <summary>Raw pressure P_Rueck channel index</summary>
    public const int CHANNEL_P_RUECK = 7;

    // Welding calculation constants
    /// <summary>Transformer current multiplier used in welding calculations</summary>
    public const double TRAFO_CURRENT_MULTIPLIER = 35.0;
    
    /// <summary>First pressure to force conversion multiplier</summary>
    public const double PRESSURE_TO_FORCE_MULTIPLIER_1 = 6.2832;
    
    /// <summary>Second pressure to force conversion multiplier</summary>  
    public const double PRESSURE_TO_FORCE_MULTIPLIER_2 = 5.0108;
}

/// <summary>
/// Individual channel data with engineering unit values
/// Used for both raw oscilloscope channels and calculated welding parameters
/// </summary>
public class ChannelData
{
    /// Channel values in engineering units (V, A, Bar, kN)
    public double[] Values { get; set; } = Array.Empty<double>();
    
    /// Channel label (e.g., "UL1L2", "IL1GR1", "P_Vor", "I_DC_GR1*", "U_DC*", "F_Schlitten*")
    public string Label { get; set; } = string.Empty;
    
    /// Engineering unit (e.g., "V", "A", "Bar", "kN")
    public string Unit { get; set; } = string.Empty;
    
    /// Time period between samples in milliseconds
    public double PeriodMs { get; set; }
    
    /// Original downsampling ratio from recording [1,1,10,10,10,10,10,10]
    public int OriginalDownsampling { get; set; }
    
    /// Additional decimation applied for this request (always 1 for full resolution)
    public int AdditionalDecimation { get; set; }
    
    /// Scaling factor from header [100,100,100,100,100,100,350,350]
    public short Scaling { get; set; }
    
    /// PicoConnect probe range used during recording
    public uint ProbeRange { get; set; }

    // Helper properties for welding channel identification
    /// <summary>True if this is a calculated welding parameter channel (8-11)</summary>
    public bool IsCalculatedWeldingChannel => Label.EndsWith("*");
    
    /// <summary>True if this is a raw oscilloscope channel (0-7)</summary>
    public bool IsRawOscilloscopeChannel => !IsCalculatedWeldingChannel;
    
    /// <summary>True if this channel represents current measurements (A)</summary>
    public bool IsCurrentChannel => Unit == "A";
    
    /// <summary>True if this channel represents voltage measurements (V)</summary>
    public bool IsVoltageChannel => Unit == "V";
    
    /// <summary>True if this channel represents pressure measurements (Bar)</summary>
    public bool IsPressureChannel => Unit == "Bar";
    
    /// <summary>True if this channel represents force measurements (kN)</summary>
    public bool IsForceChannel => Unit == "kN";
}

/// <summary>
/// Metadata extracted from binary file header
/// Describes the 8 physical oscilloscope channels only (not calculated channels)
/// </summary>
public class BinFileMetadata
{
    /// Experiment start timestamp from binary file
    public DateTime ExperimentDateTime { get; set; }
    
    /// Sample interval in microseconds (typically 1000 = 1MHz)
    public uint SampleIntervalMicroseconds { get; set; }
    
    /// Total number of samples in the file
    public uint TotalSamples { get; set; }
    
    /// Total experiment duration in milliseconds
    public double TotalDurationMs => TotalSamples * SampleIntervalMicroseconds / 1000.0;
    
    /// Maximum ADC value (typically 32767 for 15-bit ADC)
    public short MaxADCValue { get; set; }
    
    /// Binary file format version (e.g., "V1.3")
    public string FileVersion { get; set; } = string.Empty;
    
    /// Per-channel downsampling ratios [1,1,10,10,10,10,10,10] for 8 physical channels
    public int[] Downsampling { get; set; } = Array.Empty<int>();
    
    /// Channel labels ["UL1L2","UL2L3","IL1GR1","IL3GR1","IL1GR2","IL3GR2","P_Vor","P_Rueck"] for 8 physical channels
    public string[] Labels { get; set; } = Array.Empty<string>();
    
    /// Channel units ["V","V","A","A","A","A","Bar","Bar"] for 8 physical channels
    public string[] Units { get; set; } = Array.Empty<string>();
    
    /// Scaling factors [100,100,100,100,100,100,350,350] for 8 physical channels
    public short[] Scalings { get; set; } = Array.Empty<short>();
    
    /// PicoConnect probe ranges per channel for 8 physical channels
    public uint[] ChannelRanges { get; set; } = Array.Empty<uint>();
    
    /// Number of physical channels from file (always 8)
    public int ChannelCount => Labels?.Length ?? 0;

    /// <summary>Gets the expected labels for welding calculated channels</summary>
    public static readonly string[] CalculatedChannelLabels = 
    {
        "I_DC_GR1*",     // Channel 8
        "I_DC_GR2*",     // Channel 9  
        "U_DC*",         // Channel 10
        "F_Schlitten*"   // Channel 11
    };
    
    /// <summary>Gets the expected units for welding calculated channels</summary>
    public static readonly string[] CalculatedChannelUnits = 
    {
        "A",    // Channel 8 - I_DC_GR1*
        "A",    // Channel 9 - I_DC_GR2*
        "V",    // Channel 10 - U_DC*
        "kN"    // Channel 11 - F_Schlitten*
    };
    
    /// <summary>Total channels in API response (8 raw + 4 calculated)</summary>
    public const int TotalChannelsInResponse = 12;
}

/// <summary>
/// Time range selection for data extraction
/// </summary>
public class TimeRange
{
    /// Start time in milliseconds from experiment start
    public double StartTimeMs { get; set; }
    
    /// End time in milliseconds from experiment start
    public double EndTimeMs { get; set; }
    
    /// Duration of the time range in milliseconds
    public double DurationMs => EndTimeMs - StartTimeMs;
    
    /// Validates that the time range is sensible
    public bool IsValid => StartTimeMs >= 0 && EndTimeMs > StartTimeMs;
}