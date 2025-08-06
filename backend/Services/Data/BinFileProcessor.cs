using ExperimentAnalyzer.Models.Data;
using ExperimentAnalyzer.Configuration;
using Microsoft.Extensions.Options;

namespace ExperimentAnalyzer.Services.Data;

/// <summary>
/// Core service for processing binary oscilloscope files from PicoScope experiments
/// Uses sequential reading approach with welding calculations exactly matching JavaScript
/// Automatically decimates large datasets using simple approach for browser compatibility
/// </summary>
public class BinFileProcessor : IBinFileProcessor
{
    private readonly ILogger<BinFileProcessor> _logger;
    private readonly BinOscilloscopeSettings _settings;
    
    /// PicoConnect probe voltage ranges in millivolts (matches JavaScript exactly)
    private static readonly uint[] VOLTAGE_RANGES = 
    { 
        10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000 
    };

    /// Welding calculation constants (must match JavaScript exactly)
    private const double TrafoCurrentMultiplier = 35.0;
    private const double PressureToForceMultiplier1 = 6.2832;
    private const double PressureToForceMultiplier2 = 5.0108;
    
    /// Browser-safe data point limits
    private const int DefaultMaxPoints = 2000;
    private const int MaxAllowedPoints = 10000;
    
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
            
            // Use existing temp file if it's less than 1 hour old or newer than original
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
    /// Core sequential data loading method exactly matching JavaScript approach
    /// Includes real-time welding calculations during read with simple decimation
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
        
        // Initialize data storage for raw channels (0-7) - exactly like JavaScript
        var channelLists = new Dictionary<int, List<double>>();
        var timeList = new List<double>();
        
        for (int ch = 0; ch < 8; ch++)
        {
            channelLists[ch] = new List<double>();
        }
        
        // Initialize data storage for calculated channels (8-11) - exactly like JavaScript
        var calculatedChannelLists = new Dictionary<int, List<double>>
        {
            [8] = new List<double>(), // I_DC_GR1*
            [9] = new List<double>(), // I_DC_GR2*  
            [10] = new List<double>(), // U_DC*
            [11] = new List<double>()  // F_Schlitten*
        };
        
        // Sequential reading with localidx approach - exactly matching JavaScript
        int[] localIdx = new int[8];
        
        // Read interleaved data exactly like JavaScript
        for (uint j = 0; j < metadata.TotalSamples; j++)
        {
            // Storage for current sample values (for calculations) - reset per sample
            double[] currentValues = new double[8];
            
            for (int channel = 0; channel < 8; channel++)
            {
                short rawValue = reader.ReadInt16();
                
                // Apply downsampling check - matches JavaScript logic exactly
                if (j % metadata.Downsampling[channel] == 0)
                {
                    // Convert to engineering units using exact JavaScript formula
                    double engineeringValue = ConvertToEngineeringUnits(
                        rawValue, 
                        metadata.ChannelRanges[channel], 
                        metadata.MaxADCValue, 
                        metadata.Scalings[channel]);
                    
                    channelLists[channel].Add(engineeringValue);
                    currentValues[channel] = engineeringValue;
                    
                    // Add time point (use channel 0 as reference - fastest sampling) - exactly like JavaScript
                    if (channel == 0)
                    {
                        double timeSeconds = j * metadata.SampleIntervalMicroseconds / 1_000_000.0; // Convert to seconds
                        timeList.Add(timeSeconds);
                    }
                    
                    // Welding calculations - matches JavaScript logic exactly, called immediately
                    PerformWeldingCalculations(channel, currentValues, calculatedChannelLists);
                    
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
        
        // Apply simple decimation exactly like JavaScript
        var originalPoints = timeList.Count;
        var decimationRatio = CalculateDecimationRatio(originalPoints, maxPoints);
        
        if (decimationRatio > 1)
        {
            _logger.LogInformation("Applying simple decimation: {OriginalPoints} -> ~{TargetPoints} points", 
                originalPoints, maxPoints);
            
            // Apply simple decimation to time array and all channels using JavaScript approach
            var timeArray = timeList.ToArray();
            var decimatedTime = ApplySimpleDecimation(timeArray, maxPoints);
            data.TimeArray = decimatedTime;
            data.TotalDataPoints = decimatedTime.Length;
            
            // Apply same decimation to all channel data
            for (int ch = 0; ch < 8; ch++)
            {
                var decimatedValues = ApplySimpleDecimation(channelLists[ch].ToArray(), maxPoints);
                channelLists[ch] = decimatedValues.ToList();
            }
            
            // Apply same decimation to calculated channels
            for (int ch = 8; ch <= 11; ch++)
            {
                var decimatedValues = ApplySimpleDecimation(calculatedChannelLists[ch].ToArray(), maxPoints);
                calculatedChannelLists[ch] = decimatedValues.ToList();
            }
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
        
        // Set calculated channel data (channels 8-11) - exactly like JavaScript
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
        
        _logger.LogInformation("Sequential loading completed from local file. {Points} data points, {Channels} total channels (decimated: {WasDecimated})", 
            data.TotalDataPoints, data.Channels.Count, decimationRatio > 1);
        
        return data;
    }
    
    /// <summary>
    /// Calculate decimation ratio needed to achieve target point count - exactly like JavaScript
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
    /// Apply simple decimation exactly matching JavaScript approach
    /// </summary>
    private double[] ApplySimpleDecimation(double[] originalValues, int maxPoints)
    {
        if (originalValues.Length <= maxPoints || originalValues.Length == 0)
        {
            return originalValues;
        }
        
        var decimatedValues = new List<double>();
        
        // Simple step-based approach exactly like JavaScript
        int step = (int)Math.Ceiling((double)originalValues.Length / maxPoints);
        
        for (int i = 0; i < originalValues.Length; i += step)
        {
            // Take min, max, and average in each bucket for better representation - exactly like JavaScript
            double min = originalValues[i];
            double max = originalValues[i];
            double sum = 0;
            int count = 0;
            
            for (int j = 0; j < step && i + j < originalValues.Length; j++)
            {
                double val = originalValues[i + j];
                min = Math.Min(min, val);
                max = Math.Max(max, val);
                sum += val;
                count++;
            }
            
            if (count > 0)
            {
                double avg = sum / count;
                
                // JavaScript logic: if significant variation, include min and max
                if (Math.Abs(max - min) > Math.Abs(avg) * 0.1) // 10% threshold exactly like JavaScript
                {
                    // Significant variation - include min, max, and average
                    decimatedValues.Add(min);
                    decimatedValues.Add(max);
                    decimatedValues.Add(avg);
                }
                else
                {
                    // Small variation - just average
                    decimatedValues.Add(avg);
                }
            }
        }
        
        return decimatedValues.ToArray();
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
    /// Performs welding calculations exactly as JavaScript
    /// Called immediately after each channel is read for real-time calculation
    /// </summary>
    private void PerformWeldingCalculations(
        int channel, 
        double[] currentValues, 
        Dictionary<int, List<double>> calculatedChannelLists)
    {
        // Intermediate calculations (not exposed in API)
        double ul3l1, il2gr1, il2gr2;
        
        // Match JavaScript calculation logic exactly
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
    
    /// <summary>
    /// Convert ADC to engineering units using exact JavaScript formula
    /// </summary>
    public double ConvertToEngineeringUnits(short rawValue, uint channelRange, short maxADCValue, short scalingFactor)
    {
        // Use exact JavaScript logic
        var voltageRangeMillivolts = channelRange < VOLTAGE_RANGES.Length ? VOLTAGE_RANGES[channelRange] : 5000;
        var millivolts = ((double)rawValue / maxADCValue) * voltageRangeMillivolts;
        var physicalValue = (scalingFactor / 1000.0) * millivolts;
        return physicalValue;
    }
    
    /// <summary>
    /// Extracts version information from header string
    /// </summary>
    private static string ExtractVersionFromHeader(string header)
    {
        // Extract version from "Binary data from Picoscope. Use ScottPlotApp to read back. V1.3"
        var versionStart = header.LastIndexOf('V');
        return versionStart >= 0 ? header.Substring(versionStart) : "Unknown";
    }
    
    /// <summary>
    /// Skips binary header section to reach data by re-reading metadata
    /// </summary>
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