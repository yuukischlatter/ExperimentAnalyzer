using System.Text;
using ExperimentAnalyzer.Models.Core;

namespace ExperimentAnalyzer.Services.Data;

/// <summary>
/// Processes .bin files from welding experiments and converts ADC values to physical measurements
/// Based on the original JavaScript BinaryReader with C# optimizations
/// </summary>
public class BinaryDataProcessor
{
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
    /// Channel data with time and values
    /// </summary>
    public class ChannelData
    {
        public float[] Time { get; set; } = Array.Empty<float>();
        public float[] Values { get; set; } = Array.Empty<float>();
        public string Label { get; set; } = string.Empty;
        public string Unit { get; set; } = string.Empty;
        public string Color { get; set; } = string.Empty;
        public int DownsamplingFactor { get; set; }
        public int ActualPoints { get; set; }
        public double MinValue { get; set; }
        public double MaxValue { get; set; }
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
    /// Read channel data with time range filtering and resampling
    /// </summary>
    public async Task<ChannelData> ReadChannelDataAsync(string filePath, int channel, 
        double startTime = 0, double endTime = double.MaxValue, int maxPoints = 2000)
    {
        if (channel < 0 || channel > 7)
            throw new ArgumentException("Channel must be between 0 and 7", nameof(channel));

        var metadata = await ReadMetadataAsync(filePath);
        
        using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
        using var reader = new BinaryReader(stream);

        // Skip to data section (after metadata)
        await SkipToDataSection(reader, metadata);

        // Calculate time parameters for this channel
        var downsamplingFactor = metadata.DownsamplingFactors[channel];
        var dtSeconds = (metadata.SamplingInterval * downsamplingFactor) / 1e9;
        var totalPoints = (int)(metadata.BufferSize / downsamplingFactor);

        // Calculate start/end indices based on time range
        var startIndex = Math.Max(0, (int)(startTime / dtSeconds));
        var endIndex = Math.Min(totalPoints - 1, (int)(endTime / dtSeconds));
        
        if (endTime == double.MaxValue)
            endIndex = totalPoints - 1;

        var requestedPoints = endIndex - startIndex + 1;
        
        // Determine if we need to resample
        var shouldResample = requestedPoints > maxPoints;
        var step = shouldResample ? Math.Max(1, requestedPoints / maxPoints) : 1;
        var actualPoints = (requestedPoints + step - 1) / step; // Ceiling division

        var timeArray = new float[actualPoints];
        var valueArray = new float[actualPoints];
        
        // Read and process data
        var dataIndex = 0;
        var outputIndex = 0;

        for (int bufferIndex = 0; bufferIndex < metadata.BufferSize; bufferIndex++)
        {
            for (int ch = 0; ch < 8; ch++)
            {
                if (bufferIndex % metadata.DownsamplingFactors[ch] == 0)
                {
                    var rawAdc = reader.ReadInt16();
                    
                    if (ch == channel)
                    {
                        // Check if this data point is in our time range and sampling step
                        if (dataIndex >= startIndex && dataIndex <= endIndex && 
                            (dataIndex - startIndex) % step == 0 && outputIndex < actualPoints)
                        {
                            // Convert ADC to physical value
                            var physicalValue = ConvertAdcToPhysical(
                                rawAdc,
                                metadata.MaxAdcValue,
                                metadata.ChannelRanges[channel],
                                metadata.ChannelScaling[channel]
                            );

                            timeArray[outputIndex] = (float)(dataIndex * dtSeconds);
                            valueArray[outputIndex] = (float)physicalValue;
                            outputIndex++;
                        }
                        dataIndex++;
                    }
                }
                else if (ch == channel)
                {
                    // Channel not sampled at this buffer index, but we need to skip the data
                    // This shouldn't happen in our data format, but handle gracefully
                }
            }
        }

        // Trim arrays to actual size
        if (outputIndex < actualPoints)
        {
            Array.Resize(ref timeArray, outputIndex);
            Array.Resize(ref valueArray, outputIndex);
        }

        // Calculate min/max for range information
        var minValue = valueArray.Length > 0 ? valueArray.Min() : 0;
        var maxValue = valueArray.Length > 0 ? valueArray.Max() : 0;

        return new ChannelData
        {
            Time = timeArray,
            Values = valueArray,
            Label = metadata.Labels[channel],
            Unit = metadata.Units[channel],
            Color = ChannelColors[channel],
            DownsamplingFactor = downsamplingFactor,
            ActualPoints = outputIndex,
            MinValue = minValue,
            MaxValue = maxValue
        };
    }

    /// <summary>
    /// Get data ranges for all channels (for Y-axis scaling)
    /// </summary>
    public async Task<Dictionary<string, DataRange>> GetDataRangesAsync(string filePath)
    {
        var metadata = await ReadMetadataAsync(filePath);
        var ranges = new Dictionary<string, DataRange>();

        using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
        using var reader = new BinaryReader(stream);

        await SkipToDataSection(reader, metadata);

        // Track min/max for each channel
        var channelMins = new double[8];
        var channelMaxs = new double[8];
        var channelHasData = new bool[8];

        Array.Fill(channelMins, double.MaxValue);
        Array.Fill(channelMaxs, double.MinValue);

        // Read through all data to find ranges (sample every 100th point for performance)
        var sampleStep = Math.Max(1, (int)(metadata.BufferSize / 10000)); // Sample ~10k points max
        
        for (int bufferIndex = 0; bufferIndex < metadata.BufferSize; bufferIndex += sampleStep)
        {
            for (int ch = 0; ch < 8; ch++)
            {
                if (bufferIndex % metadata.DownsamplingFactors[ch] == 0)
                {
                    var rawAdc = reader.ReadInt16();
                    var physicalValue = ConvertAdcToPhysical(
                        rawAdc,
                        metadata.MaxAdcValue,
                        metadata.ChannelRanges[ch],
                        metadata.ChannelScaling[ch]
                    );

                    channelMins[ch] = Math.Min(channelMins[ch], physicalValue);
                    channelMaxs[ch] = Math.Max(channelMaxs[ch], physicalValue);
                    channelHasData[ch] = true;
                }
            }
        }

        // Create ranges with padding
        for (int ch = 0; ch < 8; ch++)
        {
            if (channelHasData[ch])
            {
                var range = channelMaxs[ch] - channelMins[ch];
                var padding = Math.Max(range * 0.05, 0.01); // 5% padding, minimum 0.01

                ranges[$"channel_{ch}"] = new DataRange
                {
                    Min = channelMins[ch] - padding,
                    Max = channelMaxs[ch] + padding,
                    Unit = metadata.Units[ch],
                    Label = metadata.Labels[ch]
                };
            }
        }

        return ranges;
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