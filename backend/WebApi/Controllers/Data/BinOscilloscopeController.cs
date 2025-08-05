using Microsoft.AspNetCore.Mvc;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Models.Api;
using ExperimentAnalyzer.Models.Data;
using ExperimentAnalyzer.Services.Data;

namespace ExperimentAnalyzer.WebApi.Controllers.Data;
/// REST API controller for binary oscilloscope data from PicoScope experiments
/// Provides endpoints for metadata, overview, and full resolution dat
[ApiController]
[Route("api/experiments/{experimentId}/bin-oscilloscope")]
public class BinOscilloscopeController : ControllerBase
{
    private readonly IBinFileProcessor _binFileProcessor;
    private readonly IExperimentRepository _repository;
    private readonly ILogger<BinOscilloscopeController> _logger;
    
    public BinOscilloscopeController(
        IBinFileProcessor binFileProcessor,
        IExperimentRepository repository,
        ILogger<BinOscilloscopeController> logger)
    {
        _binFileProcessor = binFileProcessor;
        _repository = repository;
        _logger = logger;
    }
    
    /// Get binary oscilloscope metadata (fast ~100ms)
    /// Returns header information without loading full data
    [HttpGet("metadata")]
    public async Task<ActionResult<ApiResponse<BinFileMetadata>>> GetMetadata(string experimentId)
    {
        try
        {
            _logger.LogDebug("Getting metadata for experiment: {ExperimentId}", experimentId);
            
            var binPath = await GetBinFilePathAsync(experimentId);
            if (binPath == null)
            {
                return NotFound(CreateErrorResponse<BinFileMetadata>("Binary file not found for experiment"));
            }
            
            var metadata = await _binFileProcessor.ReadMetadataAsync(binPath);
            
            return Ok(new ApiResponse<BinFileMetadata>
            {
                Success = true,
                Data = metadata,
                Metadata = CreateApiMetadata()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get metadata for experiment: {ExperimentId}", experimentId);
            return StatusCode(500, CreateErrorResponse<BinFileMetadata>(ex.Message));
        }
    }
    
    /// Get cached overview data (fast ~100ms if cached, ~10s if not cached)
    /// Returns ~5000 decimated points for quick visualization
    [HttpGet("overview")]
    public async Task<ActionResult<ApiResponse<BinOscilloscopeData>>> GetOverview(string experimentId)
    {
        try
        {
            _logger.LogDebug("Getting overview data for experiment: {ExperimentId}", experimentId);
            
            // Check cache first
            var cachedOverview = await _repository.GetCachedOverviewAsync(experimentId);
            if (cachedOverview != null)
            {
                _logger.LogDebug("Returning cached overview for experiment: {ExperimentId}", experimentId);
                return Ok(new ApiResponse<BinOscilloscopeData>
                {
                    Success = true,
                    Data = cachedOverview,
                    Metadata = CreateApiMetadata()
                });
            }
            
            // Generate overview if not cached
            var binPath = await GetBinFilePathAsync(experimentId);
            if (binPath == null)
            {
                return NotFound(CreateErrorResponse<BinOscilloscopeData>("Binary file not found for experiment"));
            }
            
            _logger.LogInformation("Generating overview data for experiment: {ExperimentId}", experimentId);
            var overviewData = await _binFileProcessor.GetOverviewDataAsync(binPath);
            
            // Cache the generated overview
            await _repository.SaveOverviewCacheAsync(experimentId, overviewData);
            
            return Ok(new ApiResponse<BinOscilloscopeData>
            {
                Success = true,
                Data = overviewData,
                Metadata = CreateApiMetadata()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get overview data for experiment: {ExperimentId}", experimentId);
            return StatusCode(500, CreateErrorResponse<BinOscilloscopeData>(ex.Message));
        }
    }
    
    /// Get full resolution binary oscilloscope data (slow ~10-30 seconds)
    /// Returns complete dataset with all channels
    [HttpGet]
    public async Task<ActionResult<ApiResponse<BinOscilloscopeData>>> GetFullData(
        string experimentId,
        [FromQuery] double? startTimeMs = null,
        [FromQuery] double? endTimeMs = null)
    {
        try
        {
            _logger.LogInformation("Getting full data for experiment: {ExperimentId}, timeRange: {Start}-{End}ms", 
                experimentId, startTimeMs, endTimeMs);
            
            var binPath = await GetBinFilePathAsync(experimentId);
            if (binPath == null)
            {
                return NotFound(CreateErrorResponse<BinOscilloscopeData>("Binary file not found for experiment"));
            }
            
            BinOscilloscopeData data;
            
            // Load time range or full data
            if (startTimeMs.HasValue && endTimeMs.HasValue)
            {
                data = await _binFileProcessor.GetTimeRangeDataAsync(binPath, startTimeMs.Value, endTimeMs.Value);
            }
            else
            {
                data = await _binFileProcessor.GetBinDataAsync(binPath);
            }
            
            return Ok(new ApiResponse<BinOscilloscopeData>
            {
                Success = true,
                Data = data,
                Metadata = CreateApiMetadata()
            });
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid time range for experiment: {ExperimentId}", experimentId);
            return BadRequest(CreateErrorResponse<BinOscilloscopeData>(ex.Message));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get full data for experiment: {ExperimentId}", experimentId);
            return StatusCode(500, CreateErrorResponse<BinOscilloscopeData>(ex.Message));
        }
    }
    
    /// Get specific time range data with full resolution
    /// Efficient extraction of time windows for detailed analysis
    [HttpGet("range")]
    public async Task<ActionResult<ApiResponse<BinOscilloscopeData>>> GetTimeRange(
        string experimentId,
        [FromQuery] double startTimeMs,
        [FromQuery] double endTimeMs)
    {
        try
        {
            if (startTimeMs < 0 || endTimeMs <= startTimeMs)
            {
                return BadRequest(CreateErrorResponse<BinOscilloscopeData>("Invalid time range parameters"));
            }
            
            _logger.LogDebug("Getting time range data for experiment: {ExperimentId}, range: {Start}-{End}ms", 
                experimentId, startTimeMs, endTimeMs);
            
            var binPath = await GetBinFilePathAsync(experimentId);
            if (binPath == null)
            {
                return NotFound(CreateErrorResponse<BinOscilloscopeData>("Binary file not found for experiment"));
            }
            
            var data = await _binFileProcessor.GetTimeRangeDataAsync(binPath, startTimeMs, endTimeMs);
            
            return Ok(new ApiResponse<BinOscilloscopeData>
            {
                Success = true,
                Data = data,
                Metadata = CreateApiMetadata()
            });
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid time range for experiment: {ExperimentId}", experimentId);
            return BadRequest(CreateErrorResponse<BinOscilloscopeData>(ex.Message));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get time range data for experiment: {ExperimentId}", experimentId);
            return StatusCode(500, CreateErrorResponse<BinOscilloscopeData>(ex.Message));
        }
    }
    
    /// Resolves binary file path for experiment
    private async Task<string?> GetBinFilePathAsync(string experimentId)
    {
        var experiment = await _repository.GetExperimentAsync(experimentId);
        if (experiment == null || !experiment.HasBinFile)
        {
            return null;
        }
        
        var binPath = Path.Combine(experiment.FolderPath, $"{experimentId}.bin");
        return System.IO.File.Exists(binPath) ? binPath : null;
    }
    
    /// Creates standardized API metadata
    private ApiMetadata CreateApiMetadata()
    {
        return new ApiMetadata
        {
            RequestId = HttpContext.TraceIdentifier,
            Timestamp = DateTime.UtcNow
        };
    }
    
    /// Creates standardized error response
    private ApiResponse<T> CreateErrorResponse<T>(string errorMessage)
    {
        return new ApiResponse<T>
        {
            Success = false,
            Error = errorMessage,
            Metadata = CreateApiMetadata()
        };
    }
}