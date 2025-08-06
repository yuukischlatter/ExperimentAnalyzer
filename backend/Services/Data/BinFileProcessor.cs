using ExperimentAnalyzer.Models.Data;
using ExperimentAnalyzer.Configuration;
using Microsoft.Extensions.Options;

namespace ExperimentAnalyzer.Services.Data;

/// <summary>
/// Core service for processing binary oscilloscope files from PicoScope experiments
/// Uses sequential reading approach with welding calculations
/// Copies network files to temp folder for optimal performance
/// Automatically decimates large datasets using smart MinMax-LTTB algorithm for browser compatibility
/// </summary>
public class BinFileProcessor : IBinFileProcessor
{
    private readonly ILogger<BinFileProcessor> _logger;
    private readonly BinOscilloscopeSettings _settings;
    
    /// PicoConnect probe input ranges in millivolts
    /// Maps to enum: Range_10MV=0, Range_20MV=1, ..., Range_200V=13
    private static readonly uint[] InputRanges = 
    { 
        10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000 
    };

    /// Welding calculation constants
    private const double TrafoCurrentMultiplier = 35.0;
    private const double PressureToForceMultiplier1 = 6.2832;
    private const double PressureToForceMultiplier2 = 5.0108;
    
    /// Browser-safe data point limits
    private const int DefaultMaxPoints = 2000;
    private const int MaxAllowedPoints = 10000;
    
    /// Smart decimation constants
    private const double DefaultSpikeThreshold = 0.1; // 10% variation threshold
    private const int DefaultMinBucketSize = 3;
    private const int DefaultMaxPointsPerBucket = 3;
    
    public BinFileProcessor(
        ILogger<BinFileProcessor> logger,
        IOptions<BinOscilloscopeSettings> settings)
    {
        _logger = logger;
        _settings = settings.Value;
    }
    
    /// <summary>
    /// Copies network file to local temp folder if needed and returns local path
    /// </summary>
    private async Task<string> EnsureLocalFileAsync(string originalPath)
    {
        // If already on local drive, use as-is
        if (Path.GetPathRoot(originalPath)?.StartsWith("C:", StringComparison.OrdinalIgnoreCase) == true)
        {
            return originalPath;
        }
        
        // Create temp directory if it doesn't exist
        var tempDir = Path.Combine("C:", "temp", "experiment_bin_files");
        Directory.CreateDirectory(tempDir);
        
        // Generate temp file name based on original file
        var fileName = Path.GetFileName(originalPath);
        var tempPath = Path.Combine(tempDir, fileName);
        
        // Check if temp file already exists and is recent
        if (File.Exists(tempPath))
        {
            var tempFileAge = DateTime.Now - File.GetLastWriteTime(tempPath);
            var originalFileAge = DateTime.Now - File.GetLastWriteTime(originalPath);
            
            // Use existing temp file if it's newer than original or less than 1 hour old
            if (tempFileAge < TimeSpan.FromHours(1) || File.GetLastWriteTime(tempPath) >= File.GetLastWriteTime(originalPath))
            {
                _logger.LogDebug("Using existing temp file: {TempPath}", tempPath);
                return tempPath;
            }
        }
        
        // Copy file to temp location
        var fileInfo = new FileInfo(originalPath);
        _logger.LogInformation("Copying network file to temp: {OriginalPath} -> {TempPath} ({Size:F1} MB)", 
            originalPath, tempPath, fileInfo.Length / (1024.0 * 1024.0));
        
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        await using (var sourceStream = new FileStream(originalPath, FileMode.Open, FileAccess.Read))
        await using (var destStream = new FileStream(tempPath, FileMode.Create, FileAccess.Write))
        {
            await sourceStream.CopyToAsync(destStream, _settings.StreamingBufferSize);
        }
        stopwatch.Stop();
        
        _logger.LogInformation("File copy completed in {Duration:F1}s", stopwatch.Elapsed.TotalSeconds);
        return tempPath;
    }
    
    /// <summary>
    /// Cleanup old temp files (called during processing)
    /// </summary>
    private void CleanupOldTempFiles()
    {
        try
        {
            var tempDir = Path.Combine("C:", "temp", "experiment_bin_files");
            if (!Directory.Exists(tempDir)) return;
            
            var cutoffTime = DateTime.Now.AddHours(-24); // Remove files older than 24 hours
            var tempFiles = Directory.GetFiles(tempDir, "*.bin");
            
            foreach (var file in tempFiles)
            {
                if (File.GetLastWriteTime(file) < cutoffTime)
                {
                    try
                    {
                        File.Delete(file);
                        _logger.LogDebug("Cleaned up old temp file: {File}", file);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning("Failed to cleanup temp file {File}: {Error}", file, ex.Message);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to cleanup temp directory: {Error}", ex.Message);
        }
    }
    
    public async Task<BinFileMetadata> ReadMetadataAsync(string binPath)
    {
        if (!File.Exists(binPath))
        {
            throw new FileNotFoundException($"Binary file not found: {binPath}");
        }
        
        _logger.LogDebug("Reading metadata from: {BinPath}", binPath);
        
        // Ensure we have a local copy
        var localPath = await EnsureLocalFileAsync(binPath);
        
        using var stream = new FileStream(localPath, FileMode.Open, FileAccess.Read);
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
    
    public async Task<BinOscilloscopeData> GetBinDataAsync(string binPath, int maxPoints = DefaultMaxPoints)
    {
        // Cleanup old temp files periodically
        CleanupOldTempFiles();
        
        // Validate maxPoints parameter
        maxPoints = ValidateMaxPoints(maxPoints);
        
        var metadata = await ReadMetadataAsync(binPath);
        
        _logger.LogInformation("Loading sequential binary data from: {BinPath} ({Duration}s, {Samples} samples, maxPoints: {MaxPoints})", 
            binPath, metadata.TotalDurationMs / 1000, metadata.TotalSamples, maxPoints);
        
        // Ensure we have local copy for sequential reading
        var localPath = await EnsureLocalFileAsync(binPath);
        
        return await LoadBinaryDataSequentialAsync(localPath, metadata, maxPoints);
    }

    public async Task<BinOscilloscopeData> GetTimeRangeDataAsync(string binPath, double startTimeMs, double endTimeMs, int maxPoints = DefaultMaxPoints)
    {
        // Validate maxPoints parameter
        maxPoints = ValidateMaxPoints(maxPoints);
        
        var metadata = await ReadMetadataAsync(binPath);

        // For simplicity, return full data with decimation - frontend can filter by time array
        _logger.LogInformation("Loading time range: {Start}-{End}ms (returning full sequential data with {MaxPoints} points)", 
            startTimeMs, endTimeMs, maxPoints);

        // Ensure we have local copy for sequential reading
        var localPath = await EnsureLocalFileAsync(binPath);
        
        var data = await LoadBinaryDataSequentialAsync(localPath, metadata, maxPoints);
        data.RequestedRange = new TimeRange { StartTimeMs = startTimeMs, EndTimeMs = endTimeMs };

        return data;
    }

    /// <summary>
    /// Core sequential data loading method with smart MinMax-LTTB decimation
    /// Includes real-time welding calculations during read
    /// Now uses local temp files for optimal performance and applies smart decimation
    /// </summary>
    private async Task<BinOscilloscopeData> LoadBinaryDataSequentialAsync(
        string localBinPath, 
        BinFileMetadata metadata,
        int maxPoints)
    {
        using var stream = new FileStream(localBinPath, FileMode.Open, FileAccess.Read);
        using var reader = new BinaryReader(stream);
        
        // Skip to data section (after header)
        await SkipHeaderAsync(reader);
        
        _logger.LogDebug("Sequential reading started from local file. Total samples: {Total}, target points: {MaxPoints}", 
            metadata.TotalSamples, maxPoints);
        
        // Initialize data structure
        var data = new BinOscilloscopeData
        {
            Metadata = metadata,
            Channels = new Dictionary<int, ChannelData>()
        };
        
        // Initialize data storage for raw channels (0-7)
        var channelLists = new Dictionary<int, List<double>>();
        var timeList = new List<double>();
        
        for (int ch = 0; ch < 8; ch++)
        {
            channelLists[ch] = new List<double>();
        }
        
        // Initialize data storage for calculated channels (8-11)
        var calculatedChannelLists = new Dictionary<int, List<double>>
        {
            [8] = new List<double>(), // I_DC_GR1*
            [9] = new List<double>(), // I_DC_GR2*  
            [10] = new List<double>(), // U_DC*
            [11] = new List<double>()  // F_Schlitten*
        };
        
        // Sequential reading with localidx approach from standalone
        int[] localIdx = new int[8];
        
        // Read interleaved data exactly as in Form1.cs
        for (uint j = 0; j < metadata.TotalSamples; j++)
        {
            // Storage for current sample values (for calculations)
            double[] currentValues = new double[8];
            
            for (int channel = 0; channel < 8; channel++)
            {
                short rawValue = reader.ReadInt16();
                
                // Apply downsampling check - matches Form1.cs logic exactly
                if (j % metadata.Downsampling[channel] == 0)
                {
                    // Convert to engineering units
                    double engineeringValue = ConvertToEngineeringUnits(
                        rawValue, 
                        metadata.ChannelRanges[channel], 
                        metadata.MaxADCValue, 
                        metadata.Scalings[channel]);
                    
                    channelLists[channel].Add(engineeringValue);
                    currentValues[channel] = engineeringValue;
                    
                    // Add time point (use channel 0 as reference - fastest sampling)
                    if (channel == 0)
                    {
                        double timeMs = j * metadata.SampleIntervalMicroseconds / 1000.0;
                        timeList.Add(timeMs);
                    }
                    
                    // Welding calculations - matches Form1.cs logic exactly
                    PerformWeldingCalculations(channel, currentValues, calculatedChannelLists, localIdx);
                    
                    localIdx[channel]++;
                }
            }
            
            // Safety check for file truncation
            if (reader.BaseStream.Position >= reader.BaseStream.Length - 16)
            {
                _logger.LogWarning("Reached end of file at sample {Sample}/{Total}", j, metadata.TotalSamples);
                break;
            }
        }
        
        // Apply smart decimation to time array and all channels
        var originalPoints = timeList.Count;
        var decimationRatio = CalculateDecimationRatio(originalPoints, maxPoints);
        
        if (decimationRatio > 1)
        {
            _logger.LogInformation("Applying smart MinMax-LTTB decimation: {OriginalPoints} -> ~{TargetPoints} points", 
                originalPoints, maxPoints);
            
            // Apply smart decimation to time array
            var timeArray = timeList.ToArray();
            var decimationResult = ApplySmartDecimation(timeArray, timeArray, maxPoints);
            data.TimeArray = decimationResult.DecimatedTime;
            data.TotalDataPoints = data.TimeArray.Length;
            
            var spikesPreserved = 0;
            var bucketsWithVariation = 0;
            
            // Apply smart decimation to all channel data using the same time indices
            for (int ch = 0; ch < 8; ch++)
            {
                var channelResult = ApplySmartDecimation(channelLists[ch].ToArray(), timeArray, maxPoints);
                channelLists[ch] = channelResult.DecimatedValues.ToList();
                spikesPreserved += channelResult.SpikesPreserved;
                bucketsWithVariation += channelResult.BucketsWithVariation;
            }
            
            // Apply smart decimation to calculated channels
            for (int ch = 8; ch <= 11; ch++)
            {
                var channelResult = ApplySmartDecimation(calculatedChannelLists[ch].ToArray(), timeArray, maxPoints);
                calculatedChannelLists[ch] = channelResult.DecimatedValues.ToList();
                spikesPreserved += channelResult.SpikesPreserved;
            }
            
            _logger.LogInformation("Smart decimation completed: {FinalPoints} points, {SpikesPreserved} spikes preserved, {BucketsWithVariation}% buckets had significant variation", 
                data.TotalDataPoints, spikesPreserved, (bucketsWithVariation * 100) / Math.Max(1, maxPoints));
        }
        else
        {
            _logger.LogDebug("No decimation needed: {Points} points within limit", originalPoints);
            data.TimeArray = timeList.ToArray();
            data.TotalDataPoints = timeList.Count;
        }
        
        // Set raw channel data (channels 0-7)
        for (int ch = 0; ch < 8; ch++)
        {
            data.Channels[ch] = new ChannelData
            {
                Values = channelLists[ch].ToArray(),
                Label = metadata.Labels[ch],
                Unit = metadata.Units[ch],
                PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[ch] * decimationRatio / 1000.0,
                OriginalDownsampling = metadata.Downsampling[ch],
                AdditionalDecimation = decimationRatio,
                Scaling = metadata.Scalings[ch],
                ProbeRange = metadata.ChannelRanges[ch]
            };
        }
        
        // Set calculated channel data (channels 8-11)
        data.Channels[8] = new ChannelData
        {
            Values = calculatedChannelLists[8].ToArray(),
            Label = "I_DC_GR1*",
            Unit = "A",
            PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[2] * decimationRatio / 1000.0,
            OriginalDownsampling = metadata.Downsampling[2],
            AdditionalDecimation = decimationRatio,
            Scaling = metadata.Scalings[2],
            ProbeRange = metadata.ChannelRanges[2]
        };
        
        data.Channels[9] = new ChannelData
        {
            Values = calculatedChannelLists[9].ToArray(),
            Label = "I_DC_GR2*",
            Unit = "A", 
            PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[4] * decimationRatio / 1000.0,
            OriginalDownsampling = metadata.Downsampling[4],
            AdditionalDecimation = decimationRatio,
            Scaling = metadata.Scalings[4],
            ProbeRange = metadata.ChannelRanges[4]
        };
        
        data.Channels[10] = new ChannelData
        {
            Values = calculatedChannelLists[10].ToArray(),
            Label = "U_DC*",
            Unit = "V",
            PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[0] * decimationRatio / 1000.0,
            OriginalDownsampling = metadata.Downsampling[0],
            AdditionalDecimation = decimationRatio,
            Scaling = metadata.Scalings[0],
            ProbeRange = metadata.ChannelRanges[0]
        };
        
        data.Channels[11] = new ChannelData
        {
            Values = calculatedChannelLists[11].ToArray(),
            Label = "F_Schlitten*",
            Unit = "kN",
            PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[6] * decimationRatio / 1000.0,
            OriginalDownsampling = metadata.Downsampling[6],
            AdditionalDecimation = decimationRatio,
            Scaling = metadata.Scalings[6],
            ProbeRange = metadata.ChannelRanges[6]
        };
        
        _logger.LogInformation("Sequential loading completed from local file. {Points} data points, {Channels} total channels (smart decimation: {WasDecimated})", 
            data.TotalDataPoints, data.Channels.Count, decimationRatio > 1);
        
        return data;
    }
    
    /// <summary>
    /// Calculate decimation ratio needed to achieve target point count
    /// </summary>
    private int CalculateDecimationRatio(int totalPoints, int maxPoints)
    {
        if (totalPoints <= maxPoints)
        {
            return 1; // No decimation needed
        }
        
        return (int)Math.Ceiling((double)totalPoints / maxPoints);
    }
    
    /// <summary>
    /// Smart decimation result containing both decimated data and statistics
    /// </summary>
    private class SmartDecimationResult
    {
        public double[] DecimatedValues { get; set; } = Array.Empty<double>();
        public double[] DecimatedTime { get; set; } = Array.Empty<double>();
        public int SpikesPreserved { get; set; }
        public int BucketsWithVariation { get; set; }
    }
    
    /// <summary>
    /// Apply smart MinMax-LTTB decimation with spike preservation
    /// Based on the algorithm from your working JS system
    /// </summary>
    private SmartDecimationResult ApplySmartDecimation(double[] originalValues, double[] timeArray, int targetPoints)
    {
        if (originalValues.Length <= targetPoints || originalValues.Length == 0)
        {
            return new SmartDecimationResult 
            { 
                DecimatedValues = originalValues, 
                DecimatedTime = timeArray,
                SpikesPreserved = 0,
                BucketsWithVariation = 0
            };
        }
        
        var result = new SmartDecimationResult();
        var decimatedValues = new List<double>();
        var decimatedTime = new List<double>();
        var spikesPreserved = 0;
        var bucketsWithVariation = 0;
        
        // Create buckets - divide data into targetPoints buckets
        var bucketSize = Math.Max(DefaultMinBucketSize, originalValues.Length / targetPoints);
        var actualBuckets = (int)Math.Ceiling((double)originalValues.Length / bucketSize);
        
        for (int bucketIndex = 0; bucketIndex < actualBuckets; bucketIndex++)
        {
            var startIdx = bucketIndex * bucketSize;
            var endIdx = Math.Min(startIdx + bucketSize, originalValues.Length);
            var bucketLength = endIdx - startIdx;
            
            if (bucketLength == 0) continue;
            
            // Extract bucket data
            var bucketValues = new ArraySegment<double>(originalValues, startIdx, bucketLength);
            var bucketTimes = new ArraySegment<double>(timeArray, startIdx, bucketLength);
            
            // Process bucket with MinMax-LTTB algorithm
            var bucketResult = ProcessBucket(bucketValues, bucketTimes);
            
            // Add results to decimated arrays
            decimatedValues.AddRange(bucketResult.Values);
            decimatedTime.AddRange(bucketResult.Times);
            
            // Update statistics
            spikesPreserved += bucketResult.SpikesPreserved;
            if (bucketResult.HasSignificantVariation)
            {
                bucketsWithVariation++;
            }
        }
        
        result.DecimatedValues = decimatedValues.ToArray();
        result.DecimatedTime = decimatedTime.ToArray();
        result.SpikesPreserved = spikesPreserved;
        result.BucketsWithVariation = bucketsWithVariation;
        
        return result;
    }
    
    /// <summary>
    /// Bucket processing result
    /// </summary>
    private class BucketResult
    {
        public List<double> Values { get; set; } = new List<double>();
        public List<double> Times { get; set; } = new List<double>();
        public int SpikesPreserved { get; set; }
        public bool HasSignificantVariation { get; set; }
    }
    
    /// <summary>
    /// Process a single bucket using MinMax-LTTB algorithm
    /// Preserves spikes by including min, max, and average when significant variation detected
    /// </summary>
    private BucketResult ProcessBucket(ArraySegment<double> bucketValues, ArraySegment<double> bucketTimes)
    {
        var result = new BucketResult();
        
        if (bucketValues.Count == 0) return result;
        
        // Single point - just return it
        if (bucketValues.Count == 1)
        {
            result.Values.Add(bucketValues[0]);
            result.Times.Add(bucketTimes[0]);
            return result;
        }
        
        // Calculate statistics
        var min = bucketValues.Min();
        var max = bucketValues.Max();
        var avg = bucketValues.Average();
        var range = max - min;
        
        // Determine if bucket has significant variation (spike detection)
        var spikeThreshold = Math.Max(DefaultSpikeThreshold * Math.Abs(avg), 0.001); // Prevent division by zero
        var hasSignificantVariation = range > spikeThreshold;
        
        result.HasSignificantVariation = hasSignificantVariation;
        
        if (hasSignificantVariation && bucketValues.Count >= DefaultMinBucketSize)
        {
            // Significant variation - include min, max, and average (spike preservation)
            var minIdx = bucketValues.ToArray().ToList().IndexOf(min);
            var maxIdx = bucketValues.ToArray().ToList().IndexOf(max);
            var midIdx = bucketValues.Count / 2;
            
            // Add points in time order to preserve signal shape
            var points = new List<(double value, double time, int priority)>
            {
                (min, bucketTimes[minIdx], 1),
                (max, bucketTimes[maxIdx], 1),
                (bucketValues[midIdx], bucketTimes[midIdx], 2)
            };
            
            // Sort by time to maintain chronological order
            points.Sort((a, b) => a.time.CompareTo(b.time));
            
            // Add up to MaxPointsPerBucket points
            var pointsToAdd = Math.Min(DefaultMaxPointsPerBucket, points.Count);
            for (int i = 0; i < pointsToAdd; i++)
            {
                result.Values.Add(points[i].value);
                result.Times.Add(points[i].time);
            }
            
            result.SpikesPreserved = pointsToAdd > 1 ? 1 : 0;
        }
        else
        {
            // Small variation - just use average (or middle point for time alignment)
            var midIdx = bucketValues.Count / 2;
            result.Values.Add(bucketValues[midIdx]);
            result.Times.Add(bucketTimes[midIdx]);
        }
        
        return result;
    }
    
    /// <summary>
    /// Validate maxPoints parameter is within acceptable range
    /// </summary>
    private int ValidateMaxPoints(int requestedPoints)
    {
        if (requestedPoints < 100)
        {
            _logger.LogWarning("MaxPoints too small ({Requested}), using minimum 100", requestedPoints);
            return 100;
        }
        
        if (requestedPoints > MaxAllowedPoints)
        {
            _logger.LogWarning("MaxPoints too large ({Requested}), using maximum {Max}", requestedPoints, MaxAllowedPoints);
            return MaxAllowedPoints;
        }
        
        return requestedPoints;
    }
    
    /// <summary>
    /// Performs welding calculations exactly as in Form1.cs
    /// Called during sequential reading for real-time calculation
    /// </summary>
    private void PerformWeldingCalculations(
        int channel, 
        double[] currentValues, 
        Dictionary<int, List<double>> calculatedChannelLists,
        int[] localIdx)
    {
        // Intermediate calculations (not exposed in API)
        double ul3l1, il2gr1, il2gr2;
        
        // Match Form1.cs calculation logic exactly
        switch (channel)
        {
            case 1: // After UL2L3 is read
                // UL3L1* = -UL1L2 - UL2L3 (intermediate calculation)
                ul3l1 = -currentValues[0] - currentValues[1];
                
                // U_DC* = (|UL1L2| + |UL2L3| + |UL3L1*|) / 35
                double uDc = (Math.Abs(currentValues[0]) + Math.Abs(currentValues[1]) + Math.Abs(ul3l1)) / TrafoCurrentMultiplier;
                calculatedChannelLists[10].Add(uDc);
                break;
                
            case 3: // After IL3GR1 is read  
                // IL2GR1* = -IL1GR1 - IL3GR1 (intermediate calculation)
                il2gr1 = -currentValues[2] - currentValues[3];
                
                // I_DC_GR1* = 35 * (|IL1GR1| + |IL3GR1| + |IL2GR1*|)
                double iDcGr1 = TrafoCurrentMultiplier * (Math.Abs(currentValues[2]) + Math.Abs(currentValues[3]) + Math.Abs(il2gr1));
                calculatedChannelLists[8].Add(iDcGr1);
                break;
                
            case 5: // After IL3GR2 is read
                // IL2GR2* = -IL1GR2 - IL3GR2 (intermediate calculation) 
                il2gr2 = -currentValues[4] - currentValues[5];
                
                // I_DC_GR2* = 35 * (|IL1GR2| + |IL3GR2| + |IL2GR2*|)
                double iDcGr2 = TrafoCurrentMultiplier * (Math.Abs(currentValues[4]) + Math.Abs(currentValues[5]) + Math.Abs(il2gr2));
                calculatedChannelLists[9].Add(iDcGr2);
                break;
                
            case 7: // After P_Rueck is read
                // F_Schlitten* = P_Vor * 6.2832 - P_Rueck * 5.0108
                double force = currentValues[6] * PressureToForceMultiplier1 - currentValues[7] * PressureToForceMultiplier2;
                calculatedChannelLists[11].Add(force);
                break;
        }
    }
    
    public double ConvertToEngineeringUnits(short rawValue, uint channelRange, short maxADCValue, short scalingFactor)
    {
        // Convert raw ADC to millivolts using PicoConnect probe ranges
        var millivolts = (rawValue * InputRanges[channelRange]) / (double)maxADCValue;
        
        // Apply scaling factor to get final engineering units (V, A, Bar)
        return (scalingFactor / 1000.0) * millivolts;
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
}