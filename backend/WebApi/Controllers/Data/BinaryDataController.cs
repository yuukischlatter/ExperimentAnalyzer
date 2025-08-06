using Microsoft.AspNetCore.Mvc;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Models.Api;
using ExperimentAnalyzer.Services.Data;

namespace ExperimentAnalyzer.WebApi.Controllers.Data;

[ApiController]
[Route("api/experiments/{experimentId}/binary")]
public class BinaryDataController : ControllerBase
{
    private readonly IExperimentRepository _repository;
    private readonly BinaryDataProcessor _binaryProcessor;

    public BinaryDataController(IExperimentRepository repository, BinaryDataProcessor binaryProcessor)
    {
        _repository = repository;
        _binaryProcessor = binaryProcessor;
    }

    /// <summary>
    /// Get binary file metadata (channels, duration, sampling info)
    /// GET /api/experiments/{experimentId}/binary/metadata
    /// </summary>
    [HttpGet("metadata")]
    public async Task<ActionResult<ApiResponse<object>>> GetBinaryMetadata(string experimentId)
    {
        try
        {
            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(CreateErrorResponse("Experiment not found"));
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(CreateErrorResponse("No binary file available for this experiment"));
            }

            var binFilePath = GetBinaryFilePath(experiment);
            if (!System.IO.File.Exists(binFilePath))
            {
                return NotFound(CreateErrorResponse("Binary file not found on disk"));
            }

            var metadata = await _binaryProcessor.ReadMetadataAsync(binFilePath);

            var response = new
            {
                experimentId = experimentId,
                channels = Enumerable.Range(0, 8).Select(i => new
                {
                    index = i,
                    label = metadata.Labels[i],
                    unit = metadata.Units[i],
                    color = GetChannelColor(i),
                    yAxis = GetYAxisForUnit(metadata.Units[i])
                }).ToArray(),
                totalChannels = 8,
                duration = metadata.Duration,
                samplingRate = metadata.SamplingRate,
                samplingInterval = metadata.SamplingInterval,
                startDateTime = metadata.StartDateTime,
                bufferSize = metadata.BufferSize,
                maxAdcValue = metadata.MaxAdcValue
            };

            return Ok(CreateSuccessResponse(response));
        }
        catch (Exception ex)
        {
            return StatusCode(500, CreateErrorResponse($"Error reading binary metadata: {ex.Message}"));
        }
    }

    /// <summary>
    /// Get list of all channels with basic info
    /// GET /api/experiments/{experimentId}/binary/channels
    /// </summary>
    [HttpGet("channels")]
    public async Task<ActionResult<ApiResponse<object>>> GetChannelList(string experimentId)
    {
        try
        {
            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(CreateErrorResponse("Experiment not found"));
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(CreateErrorResponse("No binary file available"));
            }

            var binFilePath = GetBinaryFilePath(experiment);
            var metadata = await _binaryProcessor.ReadMetadataAsync(binFilePath);

            var channels = Enumerable.Range(0, 8).Select(i => new
            {
                index = i,
                label = metadata.Labels[i],
                unit = metadata.Units[i],
                color = GetChannelColor(i),
                yAxis = GetYAxisForUnit(metadata.Units[i]),
                downsamplingFactor = metadata.DownsamplingFactors[i],
                channelRange = metadata.ChannelRanges[i],
                channelScaling = metadata.ChannelScaling[i]
            }).ToArray();

            return Ok(CreateSuccessResponse(new { experimentId, channels }));
        }
        catch (Exception ex)
        {
            return StatusCode(500, CreateErrorResponse($"Error reading channel list: {ex.Message}"));
        }
    }

    /// <summary>
    /// Get channel data with time range filtering and resampling
    /// GET /api/experiments/{experimentId}/binary/data/{channel}
    /// Query parameters: startTime, endTime, maxPoints
    /// </summary>
    [HttpGet("data/{channel:int}")]
    public async Task<ActionResult<ApiResponse<object>>> GetChannelData(
        string experimentId, 
        int channel,
        [FromQuery] double startTime = 0,
        [FromQuery] double endTime = double.MaxValue,
        [FromQuery] int maxPoints = 2000)
    {
        try
        {
            // Validate channel
            if (channel < 0 || channel > 7)
            {
                return BadRequest(CreateErrorResponse("Channel must be between 0 and 7"));
            }

            // Validate parameters
            if (maxPoints <= 0 || maxPoints > 100000)
            {
                return BadRequest(CreateErrorResponse("maxPoints must be between 1 and 100000"));
            }

            if (startTime < 0)
            {
                return BadRequest(CreateErrorResponse("startTime must be non-negative"));
            }

            if (endTime != double.MaxValue && endTime <= startTime)
            {
                return BadRequest(CreateErrorResponse("endTime must be greater than startTime"));
            }

            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(CreateErrorResponse("Experiment not found"));
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(CreateErrorResponse("No binary file available"));
            }

            var binFilePath = GetBinaryFilePath(experiment);
            var channelData = await _binaryProcessor.ReadChannelDataAsync(
                binFilePath, channel, startTime, endTime, maxPoints);

            var response = new
            {
                experimentId,
                channel,
                channelName = channelData.Label,
                unit = channelData.Unit,
                color = channelData.Color,
                yAxis = GetYAxisForUnit(channelData.Unit),
                time = channelData.Time,
                values = channelData.Values,
                meta = new
                {
                    startTime = startTime,
                    endTime = endTime == double.MaxValue ? (double?)null : endTime,
                    requestedMaxPoints = maxPoints,
                    actualPoints = channelData.ActualPoints,
                    downsamplingFactor = channelData.DownsamplingFactor,
                    dataRange = new
                    {
                        min = channelData.MinValue,
                        max = channelData.MaxValue
                    }
                }
            };

            return Ok(CreateSuccessResponse(response));
        }
        catch (Exception ex)
        {
            return StatusCode(500, CreateErrorResponse($"Error reading channel data: {ex.Message}"));
        }
    }

    /// <summary>
    /// Get Y-axis ranges for all channels (for auto-scaling)
    /// GET /api/experiments/{experimentId}/binary/ranges
    /// </summary>
    [HttpGet("ranges")]
    public async Task<ActionResult<ApiResponse<object>>> GetDataRanges(string experimentId)
    {
        try
        {
            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(CreateErrorResponse("Experiment not found"));
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(CreateErrorResponse("No binary file available"));
            }

            var binFilePath = GetBinaryFilePath(experiment);
            var ranges = await _binaryProcessor.GetDataRangesAsync(binFilePath);

            // Group ranges by Y-axis for multi-axis plotting
            var axisRanges = new Dictionary<string, object>();
            
            // Voltage axis (yaxis)
            var voltageChannels = ranges.Where(r => r.Value.Unit == "V").ToList();
            if (voltageChannels.Any())
            {
                axisRanges["voltage"] = new
                {
                    min = voltageChannels.Min(r => r.Value.Min),
                    max = voltageChannels.Max(r => r.Value.Max),
                    unit = "V",
                    channels = voltageChannels.Select(r => r.Key).ToArray()
                };
            }

            // Current axis (yaxis2)
            var currentChannels = ranges.Where(r => r.Value.Unit == "A").ToList();
            if (currentChannels.Any())
            {
                axisRanges["current"] = new
                {
                    min = currentChannels.Min(r => r.Value.Min),
                    max = currentChannels.Max(r => r.Value.Max),
                    unit = "A",
                    channels = currentChannels.Select(r => r.Key).ToArray()
                };
            }

            // Pressure axis (yaxis3)
            var pressureChannels = ranges.Where(r => r.Value.Unit == "Bar").ToList();
            if (pressureChannels.Any())
            {
                axisRanges["pressure"] = new
                {
                    min = pressureChannels.Min(r => r.Value.Min),
                    max = pressureChannels.Max(r => r.Value.Max),
                    unit = "Bar",
                    channels = pressureChannels.Select(r => r.Key).ToArray()
                };
            }

            var response = new
            {
                experimentId,
                individualRanges = ranges.ToDictionary(
                    r => r.Key,
                    r => new
                    {
                        min = r.Value.Min,
                        max = r.Value.Max,
                        unit = r.Value.Unit,
                        label = r.Value.Label
                    }
                ),
                axisRanges = axisRanges
            };

            return Ok(CreateSuccessResponse(response));
        }
        catch (Exception ex)
        {
            return StatusCode(500, CreateErrorResponse($"Error calculating data ranges: {ex.Message}"));
        }
    }

    /// <summary>
    /// Get multiple channels at once (bulk endpoint for initial plot loading)
    /// GET /api/experiments/{experimentId}/binary/data
    /// Query parameters: channels (comma-separated), startTime, endTime, maxPoints
    /// </summary>
    [HttpGet("data")]
    public async Task<ActionResult<ApiResponse<object>>> GetMultipleChannelData(
        string experimentId,
        [FromQuery] string channels = "0,1,2,3,4,5,6,7",
        [FromQuery] double startTime = 0,
        [FromQuery] double endTime = double.MaxValue,
        [FromQuery] int maxPoints = 2000)
    {
        try
        {
            // Parse channel list
            var channelList = channels.Split(',')
                .Select(c => int.TryParse(c.Trim(), out var ch) ? ch : -1)
                .Where(c => c >= 0 && c <= 7)
                .ToArray();

            if (!channelList.Any())
            {
                return BadRequest(CreateErrorResponse("No valid channels specified"));
            }

            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(CreateErrorResponse("Experiment not found"));
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(CreateErrorResponse("No binary file available"));
            }

            var binFilePath = GetBinaryFilePath(experiment);
            var channelDataTasks = channelList.Select(async channel =>
            {
                var data = await _binaryProcessor.ReadChannelDataAsync(
                    binFilePath, channel, startTime, endTime, maxPoints);
                return new { channel, data };
            });

            var results = await Task.WhenAll(channelDataTasks);
            
            var response = new
            {
                experimentId,
                channels = results.ToDictionary(
                    r => $"channel_{r.channel}",
                    r => new
                    {
                        index = r.channel,
                        label = r.data.Label,
                        unit = r.data.Unit,
                        color = r.data.Color,
                        yAxis = GetYAxisForUnit(r.data.Unit),
                        time = r.data.Time,
                        values = r.data.Values,
                        actualPoints = r.data.ActualPoints,
                        minValue = r.data.MinValue,
                        maxValue = r.data.MaxValue
                    }
                ),
                meta = new
                {
                    startTime,
                    endTime = endTime == double.MaxValue ? (double?)null : endTime,
                    requestedMaxPoints = maxPoints,
                    totalChannels = channelList.Length,
                    totalPoints = results.Sum(r => r.data.ActualPoints)
                }
            };

            return Ok(CreateSuccessResponse(response));
        }
        catch (Exception ex)
        {
            return StatusCode(500, CreateErrorResponse($"Error reading multiple channel data: {ex.Message}"));
        }
    }

    #region Helper Methods

    /// <summary>
    /// Get the file path for the binary file
    /// </summary>
    private static string GetBinaryFilePath(Models.Core.Experiment experiment)
    {
        return Path.Combine(experiment.FolderPath, $"{experiment.Id}.bin");
    }

    /// <summary>
    /// Get color for channel (consistent with frontend)
    /// </summary>
    private static string GetChannelColor(int channel)
    {
        var colors = new[]
        {
            "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", 
            "#9467bd", "#8c564b", "#e377c2", "#7f7f7f"
        };
        return colors[channel % colors.Length];
    }

    /// <summary>
    /// Get Y-axis assignment based on unit
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
    /// Create successful API response
    /// </summary>
    private ApiResponse<T> CreateSuccessResponse<T>(T data)
    {
        return new ApiResponse<T>
        {
            Success = true,
            Data = data,
            Metadata = new ApiMetadata
            {
                RequestId = HttpContext.TraceIdentifier,
                Timestamp = DateTime.UtcNow
            }
        };
    }

    /// <summary>
    /// Create error API response
    /// </summary>
    private ApiResponse<object> CreateErrorResponse(string message)
    {
        return new ApiResponse<object>
        {
            Success = false,
            Error = message,
            Metadata = new ApiMetadata
            {
                RequestId = HttpContext.TraceIdentifier,
                Timestamp = DateTime.UtcNow
            }
        };
    }

    #endregion
}