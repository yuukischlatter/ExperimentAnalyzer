using System.Text;
using ExperimentAnalyzer.Models.Core;

namespace ExperimentAnalyzer.Services.Data;

/// <summary>
/// Processes .bin files from welding experiments and converts ADC values to physical measurements
/// Updated to match JS BinaryReader.js behavior exactly with DataResampler integration
/// </summary>
public class BinaryDataProcessor
{
    private readonly DataResampler _resampler;
    
    // Store raw data in memory like JS version
    private readonly Dictionary<string, RawChannelData> _rawDataCache = new();
    private string? _currentFile = null;
    
    // Voltage range lookup table (matches original system)
    private static readonly Dictionary<int, double> VoltageRanges = new()
    {
        { 0, 0.01 }, { 1, 0.02 }, { 2, 0.05 }, { 3, 0.1 }, { 4, 0.2 }, { 5, 0.5 },
        { 6, 1.0 }, { 7, 2.0 }, { 8, 5.0 }, { 9, 10.0 }, { 10, 20.0 }, { 11, 50.0 },
        { 12, 100.0 }, { 13, 200.0 }
    };

    // Channel colors for consistent visualization
    private static readonly string[] ChannelColors = 
    {
        "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", 
        "#9467bd", "#8c564b", "#e377c2", "#7f7f7f"
    };
    
    public BinaryDataProcessor(DataResampler resampler)
    {
        _resampler = resampler;
    }

    /// <summary>
    /// Binary file metadata extracted from header
    /// </summary>
    public class BinaryMetadata
    {
        public string Header { get; set; } = string.Empty;
        public uint BufferSize { get; set; }
        public long StartTimeBinary { get; set; }
        public DateTime StartDateTime { get; set; }
        public short MaxAdcValue { get; set; }
        public int[] ChannelRanges { get; set; } = new int[8];
        public short[] ChannelScaling { get; set; } = new short[8];
        public uint SamplingInterval { get; set; }
        public int[] DownsamplingFactors { get; set; } = new int[8];
        public string[] Units { get; set; } = new string[8];
        public string[] Labels { get; set; } = new string[8];
        public double Duration { get; set; }
        public double SamplingRate { get; set; }
    }
    
    /// <summary>
    /// Raw channel data stored in memory (like JS version)
    /// </summary>
    public class RawChannelData
    {
        public float[] Time { get; set; } = Array.Empty<float>();
        public float[] Values { get; set; } = Array.Empty<float>();
        public string Label { get; set; } = string.Empty;
        public string Unit { get; set; } = string.Empty;
        public int Downsampling { get; set; }
        public int Points { get; set; }
    }

    /// <summary>
    /// Channel data response matching JS structure exactly
    /// </summary>
    public class ChannelDataResponse
    {
        public float[] Time { get; set; } = Array.Empty<float>();
        public float[] Values { get; set; } = Array.Empty<float>();
        public string ChannelName { get; set; } = string.Empty;
        public string Unit { get; set; } = string.Empty;
        public string Color { get; set; } = string.Empty;
        public string YAxis { get; set; } = string.Empty;
        public int ActualPoints { get; set; }
        public double MinValue { get; set; }
        public double MaxValue { get; set; }
        public double SamplingRate { get; set; }
        public Dictionary<string, object> Meta { get; set; } = new();
    }

    /// <summary>
    /// Read and parse binary file header and metadata
    /// </summary>
    public async Task<BinaryMetadata> ReadMetadataAsync(string filePath)
    {
        using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
        using var reader = new BinaryReader(stream);

        var metadata = new BinaryMetadata();

        try
        {
            // Read header string (C# BinaryReader.ReadString format)
            metadata.Header = reader.ReadString();
            
            // Read metadata values
            metadata.BufferSize = reader.ReadUInt32();
            metadata.StartTimeBinary = reader.ReadInt64();
            metadata.MaxAdcValue = reader.ReadInt16();

            // Convert binary timestamp to DateTime
            metadata.StartDateTime = ConvertBinaryTimestampToDateTime(metadata.StartTimeBinary);

            // Read channel ranges (8x Int32)
            for (int i = 0; i < 8; i++)
            {
                metadata.ChannelRanges[i] = reader.ReadInt32();
            }

            // Read channel scaling (8x Int16)
            for (int i = 0; i < 8; i++)
            {
                metadata.ChannelScaling[i] = reader.ReadInt16();
            }

            // Read sampling interval
            metadata.SamplingInterval = reader.ReadUInt32();

            // Read downsampling factors (8x int)
            for (int i = 0; i < 8; i++)
            {
                metadata.DownsamplingFactors[i] = reader.ReadInt32();
            }

            // Read units (8x string)
            for (int i = 0; i < 8; i++)
            {
                metadata.Units[i] = reader.ReadString();
            }

            // Read labels (8x string)
            for (int i = 0; i < 8; i++)
            {
                metadata.Labels[i] = reader.ReadString();
            }

            // Calculate derived values
            metadata.SamplingRate = 1e9 / metadata.SamplingInterval;
            
            // Calculate duration based on buffer size and fastest channel
            var minDownsampling = metadata.DownsamplingFactors.Min();
            var totalSamples = metadata.BufferSize / minDownsampling;
            metadata.Duration = (totalSamples * metadata.SamplingInterval * minDownsampling) / 1e9;

            return metadata;
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error reading binary file metadata: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// Load all raw data into memory (like JS version does)
    /// </summary>
    private async Task LoadRawDataIfNeeded(string filePath)
    {
        // Check if we already have this file loaded
        if (_currentFile == filePath && _rawDataCache.Count > 0)
        {
            return; // Already loaded
        }
        
        // Clear previous data
        _rawDataCache.Clear();
        _currentFile = filePath;
        
        var metadata = await ReadMetadataAsync(filePath);
        
        using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
        using var reader = new BinaryReader(stream);
        
        // Skip to data section
        await SkipToDataSection(reader, metadata);
        
        // Pre-allocate arrays for each channel (like JS Float32Array)
        var channelDataArrays = new float[8][];
        var channelTimeArrays = new float[8][];
        var channelIndices = new int[8];
        
        for (int channel = 0; channel < 8; channel++)
        {
            int points = (int)(metadata.BufferSize / metadata.DownsamplingFactors[channel]);
            channelDataArrays[channel] = new float[points];
            channelTimeArrays[channel] = new float[points];
            channelIndices[channel] = 0;
        }
        
        // Read all data like JS version
        for (uint j = 0; j < metadata.BufferSize; j++)
        {
            for (int channel = 0; channel < 8; channel++)
            {
                if (j % metadata.DownsamplingFactors[channel] == 0)
                {
                    // Read ADC value
                    var rawAdc = reader.ReadInt16();
                    
                    // Convert to physical value
                    var physicalValue = ConvertAdcToPhysical(
                        rawAdc,
                        metadata.MaxAdcValue,
                        metadata.ChannelRanges[channel],
                        metadata.ChannelScaling[channel]
                    );
                    
                    // Calculate time for this sample
                    var dtSeconds = (metadata.SamplingInterval * metadata.DownsamplingFactors[channel]) / 1e9;
                    var time = channelIndices[channel] * dtSeconds;
                    
                    // Store in arrays
                    channelTimeArrays[channel][channelIndices[channel]] = (float)time;
                    channelDataArrays[channel][channelIndices[channel]] = (float)physicalValue;
                    channelIndices[channel]++;
                }
            }
        }
        
        // Store in cache
        for (int channel = 0; channel < 8; channel++)
        {
            var actualPoints = channelIndices[channel];
            
            // Trim arrays to actual size
            var timeArray = new float[actualPoints];
            var valueArray = new float[actualPoints];
            Array.Copy(channelTimeArrays[channel], 0, timeArray, 0, actualPoints);
            Array.Copy(channelDataArrays[channel], 0, valueArray, 0, actualPoints);
            
            _rawDataCache[$"channel_{channel}"] = new RawChannelData
            {
                Time = timeArray,
                Values = valueArray,
                Label = metadata.Labels[channel],
                Unit = metadata.Units[channel],
                Downsampling = metadata.DownsamplingFactors[channel],
                Points = actualPoints
            };
        }
    }

    /// <summary>
    /// Read channel data with time range filtering and resampling (using DataResampler)
    /// This now matches JS behavior exactly
    /// </summary>
    public async Task<ChannelDataResponse> ReadChannelDataAsync(string filePath, int channel, 
        double startTime = 0, double endTime = double.MaxValue, int maxPoints = 2000)
    {
        if (channel < 0 || channel > 7)
            throw new ArgumentException("Channel must be between 0 and 7", nameof(channel));

        // Load raw data if needed
        await LoadRawDataIfNeeded(filePath);
        
        // Get raw channel data
        var rawData = _rawDataCache[$"channel_{channel}"];
        
        // Get metadata for additional info
        var metadata = await ReadMetadataAsync(filePath);
        
        // Use actual end time if not specified
        if (endTime == double.MaxValue)
        {
            endTime = rawData.Time.Length > 0 ? rawData.Time[rawData.Time.Length - 1] : metadata.Duration;
        }
        
        // Use DataResampler to get resampled data (exact JS logic)
        var resampledData = _resampler.GetResampledData(
            rawData.Time,
            rawData.Values,
            startTime,
            endTime,
            maxPoints,
            rawData.Downsampling,
            metadata.SamplingInterval
        );
        
        // Build response matching JS structure
        return new ChannelDataResponse
        {
            Time = resampledData.Time,
            Values = resampledData.Values,
            ChannelName = rawData.Label,
            Unit = rawData.Unit,
            Color = ChannelColors[channel],
            YAxis = GetYAxisForUnit(rawData.Unit),
            ActualPoints = resampledData.ActualPoints,
            MinValue = resampledData.MinValue,
            MaxValue = resampledData.MaxValue,
            SamplingRate = metadata.SamplingRate,
            Meta = new Dictionary<string, object>
            {
                { "timeRange", new { start = startTime, end = endTime } },
                { "actualPoints", resampledData.ActualPoints },
                { "requestedMaxPoints", maxPoints },
                { "downsampling", rawData.Downsampling }
            }
        };
    }

    /// <summary>
    /// Get raw channel data without resampling (for FFT, etc.)
    /// </summary>
    public async Task<RawChannelData> GetRawChannelDataAsync(string filePath, int channel)
    {
        await LoadRawDataIfNeeded(filePath);
        return _rawDataCache[$"channel_{channel}"];
    }

    /// <summary>
    /// Get data ranges for all channels (for Y-axis scaling)
    /// </summary>
    public async Task<Dictionary<string, DataRange>> GetDataRangesAsync(string filePath)
    {
        await LoadRawDataIfNeeded(filePath);
        
        var ranges = new Dictionary<string, DataRange>();
        
        for (int channel = 0; channel < 8; channel++)
        {
            var rawData = _rawDataCache[$"channel_{channel}"];
            if (rawData.Values.Length == 0) continue;
            
            var (min, max) = _resampler.CalculateDataRange(rawData.Values);
            
            ranges[$"channel_{channel}"] = new DataRange
            {
                Min = min,
                Max = max,
                Unit = rawData.Unit,
                Label = rawData.Label
            };
        }
        
        return ranges;
    }

    /// <summary>
    /// Data range for axis scaling
    /// </summary>
    public class DataRange
    {
        public double Min { get; set; }
        public double Max { get; set; }
        public string Unit { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
    }

    /// <summary>
    /// Convert ADC value to physical measurement
    /// </summary>
    private static double ConvertAdcToPhysical(short rawAdc, short maxAdcValue, 
        int channelRange, short channelScaling)
    {
        var voltageRange = VoltageRanges.GetValueOrDefault(channelRange, 5.0);
        var millivolts = ((double)rawAdc / maxAdcValue) * voltageRange * 1000;
        var physicalValue = (channelScaling / 1000.0) * millivolts;
        return physicalValue;
    }

    /// <summary>
    /// Get Y-axis assignment based on unit (matching JS exactly)
    /// </summary>
    private static string GetYAxisForUnit(string unit)
    {
        return unit switch
        {
            "V" => "y",      // Primary Y-axis for voltage
            "A" => "y2",     // Secondary Y-axis for current  
            "Bar" => "y3",   // Tertiary Y-axis for pressure
            _ => "y"
        };
    }

    /// <summary>
    /// Convert .NET DateTime.ToBinary() format to DateTime
    /// </summary>
    private static DateTime ConvertBinaryTimestampToDateTime(long binaryTimestamp)
    {
        try
        {
            // Handle .NET DateTime.ToBinary() format
            long ticks;
            
            if (binaryTimestamp >= 0)
            {
                // UTC time - ticks are in the lower 62 bits
                ticks = binaryTimestamp & 0x3FFFFFFFFFFFFFFF;
            }
            else
            {
                // Local time - extract ticks differently
                const long ticksMask = 0x3FFFFFFFFFFFFFFF; // 62-bit mask
                ticks = binaryTimestamp & ticksMask;
                
                if (ticks < 0)
                {
                    var absValue = binaryTimestamp < 0 ? -binaryTimestamp : binaryTimestamp;
                    ticks = absValue & ticksMask;
                }
            }
            
            // .NET epoch is January 1, 0001, but we want Unix-style dates
            const long dotNetEpochTicks = 621355968000000000; // Ticks between .NET epoch and Unix epoch
            
            if (ticks > dotNetEpochTicks)
            {
                return new DateTime(ticks, DateTimeKind.Utc);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Warning: Could not convert binary timestamp: {ex.Message}");
        }
        
        // Fallback to current time if conversion fails
        return DateTime.UtcNow;
    }

    /// <summary>
    /// Skip binary reader to the start of data section
    /// </summary>
    private static async Task SkipToDataSection(BinaryReader reader, BinaryMetadata metadata)
    {
        // Reset to beginning and skip header
        reader.BaseStream.Seek(0, SeekOrigin.Begin);
        
        // Skip header string
        reader.ReadString();
        
        // Skip metadata (fixed size portion)
        reader.BaseStream.Seek(
            4 + 8 + 2 +           // BufferSize + StartTimeBinary + MaxAdcValue
            (8 * 4) +             // ChannelRanges
            (8 * 2) +             // ChannelScaling  
            4 +                   // SamplingInterval
            (8 * 4),              // DownsamplingFactors
            SeekOrigin.Current
        );
        
        // Skip variable-length strings (units and labels)
        for (int i = 0; i < 16; i++) // 8 units + 8 labels
        {
            reader.ReadString();
        }
        
        // Now we're at the start of the data section
    }
}