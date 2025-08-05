using System.Diagnostics;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Models.Api;

namespace ExperimentAnalyzer.Services.Startup;

public abstract class BaseStartupService : IStartupService
{
    protected readonly IExperimentRepository _repository;
    
    public abstract string ServiceName { get; }
    
    protected BaseStartupService(IExperimentRepository repository)
    {
        _repository = repository;
    }
    
    public async Task<ServiceResult> ExecuteAsync(bool forceRefresh = false)
    {
        var stopwatch = Stopwatch.StartNew();
        var result = new ServiceResult();
        
        try
        {
            Console.WriteLine($"Starting {ServiceName}...");
            
            result = await ExecuteServiceLogicAsync(forceRefresh);
            result.Success = true;
            result.Duration = stopwatch.Elapsed;
            
            Console.WriteLine($"{ServiceName} completed: {result.ProcessedCount} processed, " +
                            $"{result.SkippedCount} skipped in {result.Duration.TotalSeconds:F2}s");
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Message = ex.Message;
            result.Errors.Add(ex.ToString());
            Console.WriteLine($"{ServiceName} failed: {ex.Message}");
            throw; // Re-throw to fail fast as requested
        }
        
        return result;
    }
    
    protected abstract Task<ServiceResult> ExecuteServiceLogicAsync(bool forceRefresh);
}