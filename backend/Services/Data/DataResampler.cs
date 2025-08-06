using System;
using System.Linq;

namespace ExperimentAnalyzer.Services.Data;

/// <summary>
/// Data resampling service that implements the exact MinMax-LTTB algorithm from the JS version
/// This is a 1:1 port of DataProcessor.js getResampledData() method
/// </summary>
public class DataResampler
{
    /// <summary>
    /// Result of resampling operation matching JS structure
    /// </summary>
    public class ResampledData
    {
        public float[] Time { get; set; } = Array.Empty<float>();
        public float[] Values { get; set; } = Array.Empty<float>();
        public int ActualPoints { get; set; }
        public double MinValue { get; set; }
        public double MaxValue { get; set; }
    }

    /// <summary>
    /// Resample data using MinMax-LTTB algorithm - EXACT copy of JS getResampledData()
    /// </summary>
    /// <param name="timeArray">Original time array</param>
    /// <param name="valueArray">Original value array</param>
    /// <param name="startTime">Start time in seconds</param>
    /// <param name="endTime">End time in seconds</param>
    /// <param name="maxPoints">Maximum points to return (default 2000 like JS)</param>
    /// <param name="downsamplingFactor">Channel downsampling factor</param>
    /// <param name="samplingInterval">Sampling interval in nanoseconds</param>
    public ResampledData GetResampledData(
        float[] timeArray, 
        float[] valueArray, 
        double startTime, 
        double endTime, 
        int maxPoints = 2000,
        int downsamplingFactor = 1,
        uint samplingInterval = 1000000)
    {
        if (timeArray == null || valueArray == null || timeArray.Length == 0)
        {
            return new ResampledData 
            { 
                Time = Array.Empty<float>(), 
                Values = Array.Empty<float>(),
                ActualPoints = 0,
                MinValue = 0,
                MaxValue = 0
            };
        }

        // Find indices for time range using binary search (EXACT copy of JS findTimeIndex)
        int startIdx = FindTimeIndex(timeArray, (float)startTime);
        int endIdx = FindTimeIndex(timeArray, (float)endTime);
        
        // Ensure valid range
        if (startIdx >= timeArray.Length) startIdx = timeArray.Length - 1;
        if (endIdx >= timeArray.Length) endIdx = timeArray.Length - 1;
        if (endIdx < startIdx) endIdx = startIdx;

        int totalPoints = endIdx - startIdx + 1;
        
        // If within limits, return raw data (EXACT behavior from JS)
        if (totalPoints <= maxPoints)
        {
            // Return raw data slice
            int sliceLength = endIdx - startIdx + 1;
            var timeSlice = new float[sliceLength];
            var valueSlice = new float[sliceLength];
            
            Array.Copy(timeArray, startIdx, timeSlice, 0, sliceLength);
            Array.Copy(valueArray, startIdx, valueSlice, 0, sliceLength);
            
            return new ResampledData
            {
                Time = timeSlice,
                Values = valueSlice,
                ActualPoints = sliceLength,
                MinValue = valueSlice.Length > 0 ? valueSlice.Min() : 0,
                MaxValue = valueSlice.Length > 0 ? valueSlice.Max() : 0
            };
        }

        // Resample using MinMax-LTTB algorithm (EXACT copy from JS)
        int step = Math.Max(1, totalPoints / maxPoints);
        
        // Use lists for dynamic sizing like JS arrays
        var resampledTime = new System.Collections.Generic.List<float>();
        var resampledValues = new System.Collections.Generic.List<float>();
        
        // Calculate time step for spike preservation
        double dtSeconds = (samplingInterval * downsamplingFactor) / 1e9;
        
        for (int i = startIdx; i < endIdx; i += step)
        {
            // Calculate min, max, and average in each bucket
            float min = valueArray[i];
            float max = valueArray[i];
            double sum = 0;
            int count = 0;
            
            // Process bucket
            for (int j = 0; j < step && i + j <= endIdx; j++)
            {
                float val = valueArray[i + j];
                min = Math.Min(min, val);
                max = Math.Max(max, val);
                sum += val;
                count++;
            }
            
            if (count > 0)
            {
                float avg = (float)(sum / count);
                float time = timeArray[i];
                float timeStep = (float)dtSeconds;
                
                // EXACT spike preservation logic from JS
                // "if (Math.abs(max - min) > Math.abs(avg) * 0.1)"
                if (Math.Abs(max - min) > Math.Abs(avg) * 0.1)
                {
                    // Significant variation - include min, max, and average
                    // JS: resampledTime.push(time, time + timeStep, time + timeStep * 0.5);
                    // JS: resampledValues.push(min, max, avg);
                    
                    resampledTime.Add(time);
                    resampledTime.Add(time + timeStep);
                    resampledTime.Add(time + timeStep * 0.5f);
                    
                    resampledValues.Add(min);
                    resampledValues.Add(max);
                    resampledValues.Add(avg);
                }
                else
                {
                    // Small variation - just average
                    // JS: resampledTime.push(time);
                    // JS: resampledValues.push(avg);
                    
                    resampledTime.Add(time);
                    resampledValues.Add(avg);
                }
            }
        }
        
        var finalTimeArray = resampledTime.ToArray();
        var finalValueArray = resampledValues.ToArray();
        
        return new ResampledData
        {
            Time = finalTimeArray,
            Values = finalValueArray,
            ActualPoints = finalTimeArray.Length,
            MinValue = finalValueArray.Length > 0 ? finalValueArray.Min() : 0,
            MaxValue = finalValueArray.Length > 0 ? finalValueArray.Max() : 0
        };
    }

    /// <summary>
    /// Binary search for time index - EXACT copy of JS findTimeIndex()
    /// </summary>
    private int FindTimeIndex(float[] timeArray, float targetTime)
    {
        // EXACT port of JS binary search
        // JS: let left = 0;
        // JS: let right = timeArray.length - 1;
        int left = 0;
        int right = timeArray.Length - 1;
        
        // JS: while (left <= right)
        while (left <= right)
        {
            // JS: const mid = Math.floor((left + right) / 2);
            int mid = (left + right) / 2;
            
            // JS: if (timeArray[mid] < targetTime)
            if (timeArray[mid] < targetTime)
            {
                // JS: left = mid + 1;
                left = mid + 1;
            }
            else
            {
                // JS: right = mid - 1;
                right = mid - 1;
            }
        }
        
        // JS: return Math.max(0, Math.min(timeArray.length - 1, left));
        return Math.Max(0, Math.Min(timeArray.Length - 1, left));
    }

    /// <summary>
    /// Calculate data ranges for auto-scaling - port of JS getDataRanges()
    /// </summary>
    public (double min, double max) CalculateDataRange(float[] values)
    {
        if (values == null || values.Length == 0)
        {
            return (0, 1);
        }

        double min = values[0];
        double max = values[0];
        
        // JS uses a for loop to find min/max
        for (int i = 1; i < values.Length; i++)
        {
            if (values[i] < min) min = values[i];
            if (values[i] > max) max = values[i];
        }
        
        // Add 5% padding like JS
        // JS: const padding = (max - min) * 0.05;
        double range = max - min;
        double padding = Math.Max(range * 0.05, 0.01); // Minimum padding of 0.01
        
        return (min - padding, max + padding);
    }

    /// <summary>
    /// Get metadata summary matching JS getMetadataSummary()
    /// </summary>
    public class ChannelSummary
    {
        public int Index { get; set; }
        public string Label { get; set; } = string.Empty;
        public string Unit { get; set; } = string.Empty;
        public int Points { get; set; }
        public double Duration { get; set; }
    }

    /// <summary>
    /// Create channel summary matching JS structure
    /// </summary>
    public ChannelSummary CreateChannelSummary(
        int channelIndex, 
        string label, 
        string unit, 
        int points, 
        double duration)
    {
        return new ChannelSummary
        {
            Index = channelIndex,
            Label = label,
            Unit = unit,
            Points = points,
            Duration = duration
        };
    }
}