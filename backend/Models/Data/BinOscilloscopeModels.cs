namespace ExperimentAnalyzer.Models.Data;
/// Main response containing binary oscilloscope data with time arrays and channel data
public class BinOscilloscopeData
{
    /// Time array in milliseconds from experiment start
        public double[] TimeArray { get; set; } = Array.Empty<double>();
    
    /// Channel data dictionary - key is channel number (0-7)
        public Dictionary<int, ChannelData> Channels { get; set; } = new Dictionary<int, ChannelData>();
    
    /// Metadata about the binary file
        public BinFileMetadata Metadata { get; set; } = new BinFileMetadata();
    
    /// Requested time range (null if full data requested)
        public TimeRange? RequestedRange { get; set; }
    
    /// Total number of data points returned
        public int TotalDataPoints { get; set; }
    
    /// Indicates if this is overview data (decimated) or full resolution
        public bool IsOverviewData { get; set; }
}
/// Individual channel data with engineering unit values
public class ChannelData
{
    /// Channel values in engineering units (V, A, Bar)
        public double[] Values { get; set; } = Array.Empty<double>();
    
    /// Channel label (e.g., "UL1L2", "IL1GR1", "P_Vor")
        public string Label { get; set; } = string.Empty;
    
    /// Engineering unit (e.g., "V", "A", "Bar")
        public string Unit { get; set; } = string.Empty;
    
    /// Time period between samples in milliseconds
        public double PeriodMs { get; set; }
    
    /// Original downsampling ratio from recording [1,1,10,10,10,10,10,10]
        public int OriginalDownsampling { get; set; }
    
    /// Additional decimation applied for this request
        public int AdditionalDecimation { get; set; }
    
    /// Scaling factor from header [100,100,100,100,100,100,350,350]
        public short Scaling { get; set; }
    
    /// PicoConnect probe range used during recording
        public uint ProbeRange { get; set; }
}
/// Metadata extracted from binary file header
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
    
    /// Per-channel downsampling ratios [1,1,10,10,10,10,10,10]
        public int[] Downsampling { get; set; } = Array.Empty<int>();
    
    /// Channel labels ["UL1L2","UL2L3","IL1GR1","IL3GR1","IL1GR2","IL3GR2","P_Vor","P_Rueck"]
        public string[] Labels { get; set; } = Array.Empty<string>();
    
    /// Channel units ["V","V","A","A","A","A","Bar","Bar"]
        public string[] Units { get; set; } = Array.Empty<string>();
    
    /// Scaling factors [100,100,100,100,100,100,350,350]
        public short[] Scalings { get; set; } = Array.Empty<short>();
    
    /// PicoConnect probe ranges per channel
        public uint[] ChannelRanges { get; set; } = Array.Empty<uint>();
    
    /// Number of channels (typically 8)
        public int ChannelCount => Labels?.Length ?? 0;
}
/// Time range selection for data extraction
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