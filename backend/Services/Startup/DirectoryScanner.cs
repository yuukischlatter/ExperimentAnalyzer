using System.Text.RegularExpressions;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Models.Api;
using ExperimentAnalyzer.Models.Core;

namespace ExperimentAnalyzer.Services.Startup;

public class DirectoryScanner : BaseStartupService
{
    private readonly string _experimentRootPath;
    private readonly DateTime _validDateFrom;
    
    public override string ServiceName => "Directory Scanner";
    
    public DirectoryScanner(IExperimentRepository repository, IConfiguration configuration) 
        : base(repository)
    {
        _experimentRootPath = configuration["ExperimentSettings:RootPath"] ?? throw new InvalidOperationException("RootPath not configured");
        var validDateString = configuration["ExperimentSettings:ValidDateFrom"] ?? "2025-07-01";
        _validDateFrom = DateTime.Parse(validDateString);
    }
    
    protected override async Task<ServiceResult> ExecuteServiceLogicAsync(bool forceRefresh)
    {
        var result = new ServiceResult();
        
        if (!Directory.Exists(_experimentRootPath))
        {
            throw new DirectoryNotFoundException($"Experiment root path not found: {_experimentRootPath}");
        }
        
        var experimentFolders = GetValidExperimentFolders(_experimentRootPath);
        
        foreach (var folderPath in experimentFolders)
        {
            try
            {
                var experimentId = Path.GetFileName(folderPath);
                
                // Skip if already processed (unless force refresh)
                if (!forceRefresh && await _repository.ExperimentExistsAsync(experimentId))
                {
                    result.SkippedCount++;
                    continue;
                }
                
                var experiment = await ScanExperimentFolderAsync(experimentId, folderPath);
                await _repository.UpsertExperimentAsync(experiment);
                
                result.ProcessedCount++;
                Console.WriteLine($"Processed experiment: {experimentId}");
            }
            catch (Exception ex)
            {
                result.Errors.Add($"Failed to process {folderPath}: {ex.Message}");
                Console.WriteLine($"Failed to scan {folderPath}: {ex.Message}");
            }
        }
        
        return result;
    }
    
    private IEnumerable<string> GetValidExperimentFolders(string rootPath)
    {
        return Directory.GetDirectories(rootPath)
            .Where(IsValidExperimentFolder)
            .OrderBy(Path.GetFileName);
    }
    
    private bool IsValidExperimentFolder(string folderPath)
    {
        var folderName = Path.GetFileName(folderPath);
        
        // Match pattern like "J25-07-30(1)" 
        var match = Regex.Match(folderName, @"^J(\d{2})-(\d{2})-(\d{2})\(\d+\)$");
        if (!match.Success) return false;
        
        // Extract date and check if it's after validDateFrom
        var year = 2000 + int.Parse(match.Groups[1].Value);
        var month = int.Parse(match.Groups[2].Value);
        var day = int.Parse(match.Groups[3].Value);
        
        try
        {
            var folderDate = new DateTime(year, month, day);
            return folderDate >= _validDateFrom;
        }
        catch
        {
            return false; // Invalid date
        }
    }
    
    private async Task<Experiment> ScanExperimentFolderAsync(string experimentId, string folderPath)
    {
        // Get all files recursively (handles both flat and nested structures)
        var files = Directory.GetFiles(folderPath, "*", SearchOption.AllDirectories);
        
        return new Experiment
        {
            Id = experimentId,
            FolderPath = folderPath,
            ExperimentDate = ExtractDateFromFolderName(experimentId),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            
            // File detection logic
            HasBinFile = HasFileType(files, experimentId + ".bin"),
            HasAccelerationCsv = HasFileType(files, experimentId + "_beschleuinigung.csv"),
            HasPositionCsv = HasFilePattern(files, "snapshot_optoNCDT-*.csv"),
            HasTensileCsv = HasTensileFile(files, experimentId),
            HasThermalRavi = HasFilePattern(files, "Record_*.ravi"),
            HasTcp5File = HasFileType(files, experimentId + "_original(manuell).tpc5"),
            HasWeldJournal = HasFileType(files, "Schweissjournal.txt"),
            HasCrownMeasurements = HasFileType(files, "Geradheit+Versatz.xlsx"),
            HasAmbientTemperature = HasFilePattern(files, "temperature*.csv")
        };
    }
    
    private static bool HasFileType(string[] files, string fileName)
    {
        return files.Any(f => f.EndsWith(fileName, StringComparison.OrdinalIgnoreCase));
    }
    
    private static bool HasFilePattern(string[] files, string pattern)
    {
        var regex = new Regex(pattern.Replace("*", ".*"), RegexOptions.IgnoreCase);
        return files.Any(f => regex.IsMatch(Path.GetFileName(f)));
    }
    
    private static bool HasTensileFile(string[] files, string experimentId)
    {
        // Check for new format: {ExperimentID}*.csv (but not acceleration, temperature, or snapshot)
        var hasNewFormat = files.Any(f => 
            f.EndsWith(".csv", StringComparison.OrdinalIgnoreCase) && 
            Path.GetFileName(f).StartsWith(experimentId, StringComparison.OrdinalIgnoreCase) &&
            !f.Contains("beschleuinigung", StringComparison.OrdinalIgnoreCase) &&
            !f.Contains("temperature", StringComparison.OrdinalIgnoreCase) &&
            !f.Contains("snapshot", StringComparison.OrdinalIgnoreCase));
            
        // Check for old format: *redalsa.csv
        var hasOldFormat = files.Any(f => f.EndsWith("redalsa.csv", StringComparison.OrdinalIgnoreCase));
        
        return hasNewFormat || hasOldFormat;
    }
    
    private static DateTime? ExtractDateFromFolderName(string folderName)
    {
        var match = Regex.Match(folderName, @"J(\d{2})-(\d{2})-(\d{2})\(\d+\)");
        if (match.Success)
        {
            var year = 2000 + int.Parse(match.Groups[1].Value);
            var month = int.Parse(match.Groups[2].Value);
            var day = int.Parse(match.Groups[3].Value);
            
            try
            {
                return new DateTime(year, month, day);
            }
            catch
            {
                return null;
            }
        }
        return null;
    }
}