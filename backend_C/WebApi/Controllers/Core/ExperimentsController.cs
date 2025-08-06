using Microsoft.AspNetCore.Mvc;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Models.Api;
using ExperimentAnalyzer.Models.Core;
using ExperimentAnalyzer.Services.Startup;

namespace ExperimentAnalyzer.WebApi.Controllers.Core;

[ApiController]
[Route("api/experiments")]
public class ExperimentsController : ControllerBase
{
    private readonly IExperimentRepository _repository;
    private readonly StartupDataService _startupService;
    
    public ExperimentsController(IExperimentRepository repository, StartupDataService startupService)
    {
        _repository = repository;
        _startupService = startupService;
    }
    
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ExperimentWithMetadata>>>> GetExperiments(
        [FromQuery] string sortBy = "date",
        [FromQuery] string sortDirection = "desc",
        [FromQuery] string? filterBy = null,
        [FromQuery] string? filterValue = null)
    {
        try
        {
            var experiments = await _repository.GetFilteredExperimentsAsync(
                filterBy, filterValue, sortBy, sortDirection);
            
            return Ok(new ApiResponse<List<ExperimentWithMetadata>>
            {
                Success = true,
                Data = experiments,
                Metadata = new ApiMetadata
                {
                    RequestId = HttpContext.TraceIdentifier,
                    Timestamp = DateTime.UtcNow
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new ApiResponse<List<ExperimentWithMetadata>>
            {
                Success = false,
                Error = ex.Message,
                Metadata = new ApiMetadata
                {
                    RequestId = HttpContext.TraceIdentifier,
                    Timestamp = DateTime.UtcNow
                }
            });
        }
    }
    
    [HttpGet("{experimentId}")]
    public async Task<ActionResult<ApiResponse<ExperimentWithMetadata>>> GetExperiment(string experimentId)
    {
        try
        {
            var experiment = await _repository.GetExperimentWithMetadataAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(new ApiResponse<ExperimentWithMetadata>
                {
                    Success = false,
                    Error = "Experiment not found",
                    Metadata = new ApiMetadata
                    {
                        RequestId = HttpContext.TraceIdentifier,
                        Timestamp = DateTime.UtcNow
                    }
                });
            }
            
            return Ok(new ApiResponse<ExperimentWithMetadata>
            {
                Success = true,
                Data = experiment,
                Metadata = new ApiMetadata
                {
                    RequestId = HttpContext.TraceIdentifier,
                    Timestamp = DateTime.UtcNow
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new ApiResponse<ExperimentWithMetadata>
            {
                Success = false,
                Error = ex.Message,
                Metadata = new ApiMetadata
                {
                    RequestId = HttpContext.TraceIdentifier,
                    Timestamp = DateTime.UtcNow
                }
            });
        }
    }
    
    [HttpPost("rescan")]
    public async Task<ActionResult<ApiResponse<string>>> RescanExperiments(
        [FromQuery] bool forceRefresh = false)
    {
        try
        {
            var success = await _startupService.InitializeAllDataAsync(forceRefresh);
            var message = success 
                ? "Rescan completed successfully" 
                : "Rescan completed with errors";
            
            return Ok(new ApiResponse<string>
            {
                Success = success,
                Data = message,
                Metadata = new ApiMetadata
                {
                    RequestId = HttpContext.TraceIdentifier,
                    Timestamp = DateTime.UtcNow
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new ApiResponse<string>
            {
                Success = false,
                Error = ex.Message,
                Metadata = new ApiMetadata
                {
                    RequestId = HttpContext.TraceIdentifier,
                    Timestamp = DateTime.UtcNow
                }
            });
        }
    }
    
    [HttpGet("count")]
    public async Task<ActionResult<ApiResponse<int>>> GetExperimentCount()
    {
        try
        {
            var count = await _repository.GetExperimentCountAsync();
            
            return Ok(new ApiResponse<int>
            {
                Success = true,
                Data = count,
                Metadata = new ApiMetadata
                {
                    RequestId = HttpContext.TraceIdentifier,
                    Timestamp = DateTime.UtcNow
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new ApiResponse<int>
            {
                Success = false,
                Error = ex.Message,
                Metadata = new ApiMetadata
                {
                    RequestId = HttpContext.TraceIdentifier,
                    Timestamp = DateTime.UtcNow
                }
            });
        }
    }
}