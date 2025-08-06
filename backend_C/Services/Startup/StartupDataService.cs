using System.Diagnostics;
using ExperimentAnalyzer.Models.Api;

namespace ExperimentAnalyzer.Services.Startup;

public class StartupDataService
{
    private readonly IServiceProvider _serviceProvider;
    
    public StartupDataService(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }
    
    public async Task<bool> InitializeAllDataAsync(bool forceRefresh = false)
    {
        var totalStopwatch = Stopwatch.StartNew();
        var allSuccess = true;
        
        Console.WriteLine($"Starting data initialization (forceRefresh: {forceRefresh})...");
        
        // Get services in execution order
        var services = new List<IStartupService>
        {
            _serviceProvider.GetRequiredService<DirectoryScanner>(),
            _serviceProvider.GetRequiredService<JournalParser>()
        };
        
        foreach (var service in services)
        {
            var result = await service.ExecuteAsync(forceRefresh);
            if (!result.Success)
            {
                allSuccess = false;
                Console.WriteLine($"Service {service.ServiceName} failed: {result.Message}");
                foreach (var error in result.Errors)
                {
                    Console.WriteLine($"  - {error}");
                }
                // Don't continue - fail fast
                break;
            }
        }
        
        Console.WriteLine($"Data initialization completed in {totalStopwatch.Elapsed.TotalSeconds:F2}s. Success: {allSuccess}");
        return allSuccess;
    }
}