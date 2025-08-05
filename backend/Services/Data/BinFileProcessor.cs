using ExperimentAnalyzer.Models.Data;
using Microsoft.Extensions.Options;

namespace ExperimentAnalyzer.Services.Data;

Core service for processing binary oscilloscope files from PicoScope experiments
/// Handles 2-3GB binary files with interleaved 8-channel data

public class BinFileProcessor : IBinFileProcessor
{
    private readonly ILogger<BinFileProcessor> _logger;
    
    /// PicoConnect probe input ranges in millivolts
    /// Maps to enum: Range_10MV=0, Range_20MV=1, ..., Range_200V=13
    
    private static readonly uint[] InputRanges = 
    { 
        10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000 
    };
    
    public BinFileProcessor(ILogger<BinFileProcessor> logger)
    {
        _logger = logger;
    }
    
    public async Task<BinFileMetadata> ReadMetadataAsync(string binPath)
    {
        if (!File.Exists(binPath))
        {
            throw new FileNotFoundException($"Binary file not found: {binPath}");
        }
        
        _logger.LogDebug("Reading metadata from: {BinPath}", binPath);
        
        using var stream = new FileStream(binPath, FileMode.Open, FileAccess.Read);
        using var reader = new BinaryReader(stream);
        
        var metadata = new BinFileMetadata();
        
        // Read header string
        metadata.FileVersion = ExtractVersionFromHeader(reader.ReadString());
        
        // Read core header data
        metadata.TotalSamples = reader.ReadUInt32();
        metadata.ExperimentDateTime = DateTime.FromBinary(reader.ReadInt64());
        metadata.MaxADCValue = reader.ReadInt16();
        
        // Read channel ranges (8 channels)
        metadata.ChannelRanges = new uint[8];
        for (int i = 0; i < 8; i++)
        {
            metadata.ChannelRanges[i] = (uint)reader.ReadInt32();
        }
        
        // Read scaling factors (8 channels)
        metadata.Scalings = new short[8];
        for (int i = 0; i < 8; i++)
        {
            metadata.Scalings[i] = reader.ReadInt16();
        }
        
        // Read sample interval
        metadata.SampleIntervalMicroseconds = reader.ReadUInt32();
        
        // Read downsampling ratios (8 channels)
        metadata.Downsampling = new int[8];
        for (int i = 0; i < 8; i++)
        {
            metadata.Downsampling[i] = reader.ReadInt32();
        }
        
        // Read units (8 strings)
        metadata.Units = new string[8];
        for (int i = 0; i < 8; i++)
        {
            metadata.Units[i] = reader.ReadString();
        }
        
        // Read labels (8 strings)
        metadata.Labels = new string[8];
        for (int i = 0; i < 8; i++)
        {
            metadata.Labels[i] = reader.ReadString();
        }
        
        _logger.LogDebug("Metadata read successfully. Duration: {Duration}ms, Samples: {Samples}", 
            metadata.TotalDurationMs, metadata.TotalSamples);
        
        return metadata;
    }
    
    public async Task<BinOscilloscopeData> GetBinDataAsync(string binPath)
    {
        var metadata = await ReadMetadataAsync(binPath);
        
        _logger.LogInformation("Loading full binary data from: {BinPath} ({Duration}s, {Samples} samples)", 
            binPath, metadata.TotalDurationMs / 1000, metadata.TotalSamples);
        
        return await LoadBinaryDataInternalAsync(binPath, metadata, null, 1);
    }
    
    public async Task<BinOscilloscopeData> GetOverviewDataAsync(string binPath, int maxPoints = 5000)
    {
        var metadata = await ReadMetadataAsync(binPath);
        
        // Calculate effective sample count after original downsampling
        var effectiveSamples = metadata.TotalSamples / (uint)metadata.Downsampling.Max();
        var decimationRatio = CalculateDecimationRatio(effectiveSamples, maxPoints);
        
        _logger.LogInformation("Generating overview data: {MaxPoints} points, decimation: {Decimation}", 
            maxPoints, decimationRatio);
        
        var data = await LoadBinaryDataInternalAsync(binPath, metadata, null, decimationRatio);
        data.IsOverviewData = true;
        
        return data;
    }
    
    public async Task<BinOscilloscopeData> GetTimeRangeDataAsync(string binPath, double startTimeMs, double endTimeMs)
    {
        var metadata = await ReadMetadataAsync(binPath);
        
        if (startTimeMs < 0 || endTimeMs > metadata.TotalDurationMs || startTimeMs >= endTimeMs)
        {
            throw new ArgumentException($"Invalid time range: {startTimeMs}-{endTimeMs}ms (file duration: {metadata.TotalDurationMs}ms)");
        }
        
        var timeRange = new TimeRange { StartTimeMs = startTimeMs, EndTimeMs = endTimeMs };
        
        _logger.LogInformation("Loading time range: {Start}-{End}ms ({Duration}ms)", 
            startTimeMs, endTimeMs, timeRange.DurationMs);
        
        var data = await LoadBinaryDataInternalAsync(binPath, metadata, timeRange, 1);
        data.RequestedRange = timeRange;
        
        return data;
    }
    
    /// Core binary data loading method with optional time range and decimation
    
    private async Task<BinOscilloscopeData> LoadBinaryDataInternalAsync(
        string binPath, 
        BinFileMetadata metadata, 
        TimeRange? timeRange, 
        int additionalDecimation)
    {
        using var stream = new FileStream(binPath, FileMode.Open, FileAccess.Read);
        using var reader = new BinaryReader(stream);
        
        // Skip to data section (after header)
        await SkipHeaderAsync(reader);
        
        // Calculate sample range to read
        var (startSample, endSample) = CalculateSampleRange(metadata, timeRange);
        var totalSamplesToRead = endSample - startSample;
        
        _logger.LogDebug("Reading samples {Start} to {End} (total: {Count}) from file with {Total} samples", 
            startSample, endSample, totalSamplesToRead, metadata.TotalSamples);
        
        // Safety check for massive files
        if (totalSamplesToRead > 50_000_000 && additionalDecimation == 1)
        {
            _logger.LogWarning("Large sample count detected: {Count}. Consider using overview mode.", totalSamplesToRead);
        }
        
        // Initialize data structures
        var data = new BinOscilloscopeData
        {
            Metadata = metadata,
            RequestedRange = timeRange,
            Channels = new Dictionary<int, ChannelData>()
        };
        
        // Initialize channel data arrays
        var channelLists = new Dictionary<int, List<double>>();
        var timeList = new List<double>();
        
        for (int ch = 0; ch < metadata.ChannelCount; ch++)
        {
            channelLists[ch] = new List<double>();
            data.Channels[ch] = new ChannelData
            {
                Label = metadata.Labels[ch],
                Unit = metadata.Units[ch],
                OriginalDownsampling = metadata.Downsampling[ch],
                AdditionalDecimation = additionalDecimation,
                Scaling = metadata.Scalings[ch],
                ProbeRange = metadata.ChannelRanges[ch],
                Values = Array.Empty<double>() // Will be set after processing
            };
        }
        
        // Skip to start sample if needed
        if (startSample > 0)
        {
            await SkipToSampleAsync(reader, startSample, metadata.ChannelCount);
        }
        
        // Read interleaved data - matches original recording logic
        long[] averageBuffers = new long[metadata.ChannelCount];
        int[] localIdx = new int[metadata.ChannelCount];
        
        // Initialize channel data arrays with correct sizes per channel
        for (int ch = 0; ch < metadata.ChannelCount; ch++)
        {
            var channelDataSize = (int)(metadata.TotalSamples / metadata.Downsampling[ch] / additionalDecimation + 1);
            channelLists[ch] = new List<double>(channelDataSize);
        }
        
        // Read the file exactly as it was written in your original code
        for (uint j = 0; j < metadata.TotalSamples; j++)
        {
            for (int ch = 0; ch < metadata.ChannelCount; ch++)
            {
                averageBuffers[ch] += reader.ReadInt16();
                
                // Write data point only when downsampling period is complete (matches original logic)
                if ((j + 1) % metadata.Downsampling[ch] == 0)
                {
                    // Apply additional decimation for overview
                    if (localIdx[ch] % additionalDecimation == 0)
                    {
                        var averageRaw = (short)(averageBuffers[ch] / metadata.Downsampling[ch]);
                        var engineeringValue = ConvertToEngineeringUnits(
                            averageRaw, 
                            metadata.ChannelRanges[ch], 
                            metadata.MaxADCValue, 
                            metadata.Scalings[ch]);
                        
                        channelLists[ch].Add(engineeringValue);
                        
                        // Add time point (use channel 0 timing as reference)
                        if (ch == 0)
                        {
                            var timeMs = j * metadata.SampleIntervalMicroseconds / 1000.0;
                            timeList.Add(timeMs);
                        }
                    }
                    
                    localIdx[ch]++;
                    averageBuffers[ch] = 0;
                }
            }
            
            // Safety check for file truncation
            if (reader.BaseStream.Position >= reader.BaseStream.Length - 16)
            {
                _logger.LogWarning("Reached end of file at sample {Sample}/{Total}", j, metadata.TotalSamples);
                break;
            }
        }
        
        // Convert lists to arrays and set final data
        data.TimeArray = timeList.ToArray();
        data.TotalDataPoints = timeList.Count;
        
        for (int ch = 0; ch < metadata.ChannelCount; ch++)
        {
            data.Channels[ch].Values = channelLists[ch].ToArray();
            data.Channels[ch].PeriodMs = metadata.SampleIntervalMicroseconds * 
                metadata.Downsampling[ch] * additionalDecimation / 1000.0;
        }
        
        _logger.LogDebug("Loaded {Points} data points, channel 0 has {Ch0Points} values", 
            timeList.Count, channelLists[0].Count);
        
        return data;
    }
    
    public double ConvertToEngineeringUnits(short rawValue, uint channelRange, short maxADCValue, short scalingFactor)
    {
        // Convert raw ADC to millivolts using PicoConnect probe ranges
        var millivolts = (rawValue * InputRanges[channelRange]) / (double)maxADCValue;
        
        // Apply scaling factor to get final engineering units (V, A, Bar)
        return (scalingFactor / 1000.0) * millivolts;
    }
    
    public int CalculateDecimationRatio(uint totalSamples, int maxOutputPoints)
    {
        if (totalSamples <= maxOutputPoints)
        {
            return 1; // No decimation needed
        }
        
        return (int)Math.Ceiling((double)totalSamples / maxOutputPoints);
    }
    
    /// Extracts version information from header string
    
    private static string ExtractVersionFromHeader(string header)
    {
        // Extract version from "Binary data from Picoscope. Use ScottPlotApp to read back. V1.3"
        var versionStart = header.LastIndexOf('V');
        return versionStart >= 0 ? header.Substring(versionStart) : "Unknown";
    }
    
    /// Skips binary header section to reach data by re-reading metadata
    
    private async Task SkipHeaderAsync(BinaryReader reader)
    {
        // Reset to beginning and read through all header data
        reader.BaseStream.Seek(0, SeekOrigin.Begin);
        
        // Header string
        reader.ReadString();
        
        // Core header data
        reader.ReadUInt32(); // tempBufferSize
        reader.ReadInt64();  // timestamp
        reader.ReadInt16();  // maxADCValue
        
        // Channel ranges (8 * 4 = 32 bytes)
        for (int i = 0; i < 8; i++) reader.ReadInt32();
        
        // Scalings (8 * 2 = 16 bytes)
        for (int i = 0; i < 8; i++) reader.ReadInt16();
        
        // Sample interval (4 bytes)
        reader.ReadUInt32();
        
        // Downsampling ratios (8 * 4 = 32 bytes)
        for (int i = 0; i < 8; i++) reader.ReadInt32();
        
        // Units (8 strings)
        for (int i = 0; i < 8; i++) reader.ReadString();
        
        // Labels (8 strings)
        for (int i = 0; i < 8; i++) reader.ReadString();
        
        // Now we're positioned at the start of data section
    }
    
    /// Calculates sample range based on time range
    
    private (uint startSample, uint endSample) CalculateSampleRange(BinFileMetadata metadata, TimeRange? timeRange)
    {
        if (timeRange == null)
        {
            return (0, metadata.TotalSamples);
        }
        
        var samplesPerMs = 1000.0 / metadata.SampleIntervalMicroseconds;
        var startSample = (uint)(timeRange.StartTimeMs * samplesPerMs);
        var endSample = (uint)(timeRange.EndTimeMs * samplesPerMs);
        
        // Clamp to valid range
        startSample = Math.Min(startSample, metadata.TotalSamples);
        endSample = Math.Min(endSample, metadata.TotalSamples);
        
        return (startSample, endSample);
    }
    
    /// Skips to specific sample position in interleaved data
    
    private async Task SkipToSampleAsync(BinaryReader reader, uint targetSample, int channelCount)
    {
        var bytesToSkip = targetSample * channelCount * sizeof(short);
        reader.BaseStream.Seek(bytesToSkip, SeekOrigin.Current);
    }
}