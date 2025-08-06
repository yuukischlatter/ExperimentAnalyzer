using ExperimentAnalyzer.Models.Data;
using Microsoft.Extensions.Options;

namespace ExperimentAnalyzer.Services.Data;

/// <summary>
/// Core service for processing binary oscilloscope files from PicoScope experiments
/// Uses sequential reading approach with welding calculations
/// </summary>
/// Handles 2-3GB binary files with interleaved 8-channel data and calculates welding parameters

public class BinFileProcessor : IBinFileProcessor
{
    private readonly ILogger<BinFileProcessor> _logger;
    
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
        
        _logger.LogInformation("Loading sequential binary data from: {BinPath} ({Duration}s, {Samples} samples)", 
            binPath, metadata.TotalDurationMs / 1000, metadata.TotalSamples);
        
        return await LoadBinaryDataSequentialAsync(binPath, metadata, 1);
    }
    
    public async Task<BinOscilloscopeData> GetOverviewDataAsync(string binPath, int maxPoints = 5000)
    {
        var metadata = await ReadMetadataAsync(binPath);
        
        // Calculate effective sample count after original downsampling
        var effectiveSamples = metadata.TotalSamples / (uint)metadata.Downsampling.Max();
        var decimationRatio = CalculateDecimationRatio(effectiveSamples, maxPoints);
        
        _logger.LogInformation("Generating overview data: {MaxPoints} points, decimation: {Decimation}", 
            maxPoints, decimationRatio);
        
        var data = await LoadBinaryDataSequentialAsync(binPath, metadata, decimationRatio);
        data.IsOverviewData = true;
        
        return data;
    }

    public async Task<BinOscilloscopeData> GetTimeRangeDataAsync(string binPath, double startTimeMs, double endTimeMs)
    {
        var metadata = await ReadMetadataAsync(binPath);

        // For simplicity, return full data - frontend can filter by time array
        _logger.LogInformation("Loading time range: {Start}-{End}ms (returning full sequential data)", 
            startTimeMs, endTimeMs);

        var data = await LoadBinaryDataSequentialAsync(binPath, metadata, 1);
        data.RequestedRange = new TimeRange { StartTimeMs = startTimeMs, EndTimeMs = endTimeMs };

        return data;
    }

    /// <summary>
    /// Core sequential data loading method matching standalone Form1.cs logic
    /// Includes real-time welding calculations during read
    /// </summary>
    private async Task<BinOscilloscopeData> LoadBinaryDataSequentialAsync(
        string binPath, 
        BinFileMetadata metadata, 
        int additionalDecimation)
    {
        using var stream = new FileStream(binPath, FileMode.Open, FileAccess.Read);
        using var reader = new BinaryReader(stream);
        
        // Skip to data section (after header)
        await SkipHeaderAsync(reader);
        
        _logger.LogDebug("Sequential reading started. Total samples: {Total}, decimation: {Decimation}", 
            metadata.TotalSamples, additionalDecimation);
        
        // Initialize data structure
        var data = new BinOscilloscopeData
        {
            Metadata = metadata,
            Channels = new Dictionary<int, ChannelData>(),
            IsOverviewData = additionalDecimation > 1
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
                    // Apply additional decimation for overview
                    if (localIdx[channel] % additionalDecimation == 0)
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
                        PerformWeldingCalculations(channel, currentValues, calculatedChannelLists, localIdx, additionalDecimation);
                    }
                    
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
        
        // Set time array
        data.TimeArray = timeList.ToArray();
        data.TotalDataPoints = timeList.Count;
        
        // Set raw channel data (channels 0-7)
        for (int ch = 0; ch < 8; ch++)
        {
            data.Channels[ch] = new ChannelData
            {
                Values = channelLists[ch].ToArray(),
                Label = metadata.Labels[ch],
                Unit = metadata.Units[ch],
                PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[ch] * additionalDecimation / 1000.0,
                OriginalDownsampling = metadata.Downsampling[ch],
                AdditionalDecimation = additionalDecimation,
                Scaling = metadata.Scalings[ch],
                ProbeRange = metadata.ChannelRanges[ch]
            };
        }
        
        // Set calculated channel data (channels 8-11) - only the visualized ones
        data.Channels[8] = new ChannelData
        {
            Values = calculatedChannelLists[8].ToArray(),
            Label = "I_DC_GR1*",
            Unit = "A",
            PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[2] * additionalDecimation / 1000.0,
            OriginalDownsampling = metadata.Downsampling[2],
            AdditionalDecimation = additionalDecimation,
            Scaling = metadata.Scalings[2],
            ProbeRange = metadata.ChannelRanges[2]
        };
        
        data.Channels[9] = new ChannelData
        {
            Values = calculatedChannelLists[9].ToArray(),
            Label = "I_DC_GR2*",
            Unit = "A", 
            PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[4] * additionalDecimation / 1000.0,
            OriginalDownsampling = metadata.Downsampling[4],
            AdditionalDecimation = additionalDecimation,
            Scaling = metadata.Scalings[4],
            ProbeRange = metadata.ChannelRanges[4]
        };
        
        data.Channels[10] = new ChannelData
        {
            Values = calculatedChannelLists[10].ToArray(),
            Label = "U_DC*",
            Unit = "V",
            PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[0] * additionalDecimation / 1000.0,
            OriginalDownsampling = metadata.Downsampling[0],
            AdditionalDecimation = additionalDecimation,
            Scaling = metadata.Scalings[0],
            ProbeRange = metadata.ChannelRanges[0]
        };
        
        data.Channels[11] = new ChannelData
        {
            Values = calculatedChannelLists[11].ToArray(),
            Label = "F_Schlitten*",
            Unit = "kN",
            PeriodMs = metadata.SampleIntervalMicroseconds * metadata.Downsampling[6] * additionalDecimation / 1000.0,
            OriginalDownsampling = metadata.Downsampling[6],
            AdditionalDecimation = additionalDecimation,
            Scaling = metadata.Scalings[6],
            ProbeRange = metadata.ChannelRanges[6]
        };
        
        _logger.LogDebug("Sequential loading completed. {Points} data points, {Channels} total channels", 
            timeList.Count, data.Channels.Count);
        
        return data;
    }
    
    /// <summary>
    /// Performs welding calculations exactly as in Form1.cs
    /// Called during sequential reading for real-time calculation
    /// </summary>
    private void PerformWeldingCalculations(
        int channel, 
        double[] currentValues, 
        Dictionary<int, List<double>> calculatedChannelLists,
        int[] localIdx,
        int additionalDecimation)
    {
        // Intermediate calculations (not exposed in API)
        double ul3l1, il2gr1, il2gr2;
        
        // Match Form1.cs calculation logic exactly
        switch (channel)
        {
            case 1: // After UL2L3 is read
                if (localIdx[channel] % additionalDecimation == 0)
                {
                    // UL3L1* = -UL1L2 - UL2L3 (intermediate calculation)
                    ul3l1 = -currentValues[0] - currentValues[1];
                    
                    // U_DC* = (|UL1L2| + |UL2L3| + |UL3L1*|) / 35
                    double uDc = (Math.Abs(currentValues[0]) + Math.Abs(currentValues[1]) + Math.Abs(ul3l1)) / TrafoCurrentMultiplier;
                    calculatedChannelLists[10].Add(uDc);
                }
                break;
                
            case 3: // After IL3GR1 is read  
                if (localIdx[channel] % additionalDecimation == 0)
                {
                    // IL2GR1* = -IL1GR1 - IL3GR1 (intermediate calculation)
                    il2gr1 = -currentValues[2] - currentValues[3];
                    
                    // I_DC_GR1* = 35 * (|IL1GR1| + |IL3GR1| + |IL2GR1*|)
                    double iDcGr1 = TrafoCurrentMultiplier * (Math.Abs(currentValues[2]) + Math.Abs(currentValues[3]) + Math.Abs(il2gr1));
                    calculatedChannelLists[8].Add(iDcGr1);
                }
                break;
                
            case 5: // After IL3GR2 is read
                if (localIdx[channel] % additionalDecimation == 0)
                {
                    // IL2GR2* = -IL1GR2 - IL3GR2 (intermediate calculation) 
                    il2gr2 = -currentValues[4] - currentValues[5];
                    
                    // I_DC_GR2* = 35 * (|IL1GR2| + |IL3GR2| + |IL2GR2*|)
                    double iDcGr2 = TrafoCurrentMultiplier * (Math.Abs(currentValues[4]) + Math.Abs(currentValues[5]) + Math.Abs(il2gr2));
                    calculatedChannelLists[9].Add(iDcGr2);
                }
                break;
                
            case 7: // After P_Rueck is read
                if (localIdx[channel] % additionalDecimation == 0)
                {
                    // F_Schlitten* = P_Vor * 6.2832 - P_Rueck * 5.0108
                    double force = currentValues[6] * PressureToForceMultiplier1 - currentValues[7] * PressureToForceMultiplier2;
                    calculatedChannelLists[11].Add(force);
                }
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
}