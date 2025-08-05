using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Models.Api;
using ExperimentAnalyzer.Models.Core;

namespace ExperimentAnalyzer.Services.Startup;

public class JournalParser : BaseStartupService
{
    public override string ServiceName => "Journal Parser";
    
    public JournalParser(IExperimentRepository repository) : base(repository)
    {
    }
    
    protected override async Task<ServiceResult> ExecuteServiceLogicAsync(bool forceRefresh)
    {
        var result = new ServiceResult();
        var experiments = await _repository.GetExperimentsWithJournalsAsync();
        
        foreach (var experiment in experiments)
        {
            try
            {
                // Skip if metadata already parsed (unless force refresh)
                if (!forceRefresh && await _repository.MetadataExistsAsync(experiment.Id))
                {
                    result.SkippedCount++;
                    continue;
                }
                
                var journalPath = FindJournalFile(experiment.FolderPath);
                if (journalPath == null)
                {
                    result.Errors.Add($"Journal file not found for {experiment.Id}");
                    continue;
                }
                
                var metadata = await ParseJournalFileAsync(experiment.Id, journalPath);
                await _repository.UpsertMetadataAsync(metadata);
                
                result.ProcessedCount++;
                Console.WriteLine($"Parsed journal for: {experiment.Id}");
            }
            catch (Exception ex)
            {
                result.Errors.Add($"Failed to parse journal for {experiment.Id}: {ex.Message}");
                Console.WriteLine($"Failed to parse journal for {experiment.Id}: {ex.Message}");
            }
        }
        
        return result;
    }
    
    private static string? FindJournalFile(string experimentFolder)
    {
        var journalFiles = Directory.GetFiles(experimentFolder, "*", SearchOption.AllDirectories)
            .Where(f => f.EndsWith("Schweissjournal.txt", StringComparison.OrdinalIgnoreCase))
            .ToList();
            
        return journalFiles.FirstOrDefault();
    }
    
    private static async Task<ExperimentMetadata> ParseJournalFileAsync(string experimentId, string journalPath)
    {
        var content = await File.ReadAllTextAsync(journalPath);
        var lines = content.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Where(line => !string.IsNullOrEmpty(line))
            .ToList();
        
        var metadata = new ExperimentMetadata
        {
            ExperimentId = experimentId,
            ParsedAt = DateTime.UtcNow
        };
        
        foreach (var line in lines)
        {
            var parts = line.Split(';');
            if (parts.Length < 2) continue;
            
            var value = parts[0].Trim();
            var key = parts[1].Trim();
            
            switch (key.ToLowerInvariant())
            {
                case "program-nr":
                    metadata.ProgramNumber = value;
                    break;
                case "programname":
                    metadata.ProgramName = value;
                    break;
                case "operator":
                    metadata.Operator = value;
                    break;
                case "öltemperatur":
                    if (decimal.TryParse(value, out var temp))
                        metadata.OilTemperature = temp;
                    break;
                case "zeitabstandcrownmessung":
                    if (int.TryParse(value, out var interval))
                        metadata.CrownMeasurementInterval = interval;
                    break;
                case "crowneinlaufseitewarm":
                    if (decimal.TryParse(value, out var crownEW))
                        metadata.CrownEinlaufWarm = crownEW;
                    break;
                case "crownauslaufseitewarm":
                    if (decimal.TryParse(value, out var crownAW))
                        metadata.CrownAuslaufWarm = crownAW;
                    break;
                case "crowneinlaufseitekalt":
                    if (value != "x" && decimal.TryParse(value, out var crownEK))
                        metadata.CrownEinlaufKalt = crownEK;
                    break;
                case "crownauslaufseitekalt":
                    if (value != "x" && decimal.TryParse(value, out var crownAK))
                        metadata.CrownAuslaufKalt = crownAK;
                    break;
                case "schleifart":
                    metadata.GrindingType = value;
                    break;
                case "schleifer":
                    metadata.Grinder = value;
                    break;
                case "kommentar":
                    metadata.Comments = value;
                    break;
                case "schienenetikett einlaufseite":
                    // Store the full rail info AND extract material/shape
                    if (parts.Length >= 3)
                    {
                        metadata.Einlaufseite = parts[2].Trim(); // "49531 104 12 Bereits 2x geschweisst"
                        ExtractMaterialAndShape(value, metadata); // Extract from "P65-2;DT350"
                    }
                    break;
                case "schienenetikett auslaufseite":
                    // Store the full rail info
                    if (parts.Length >= 3)
                    {
                        metadata.Auslaufseite = parts[2].Trim(); // "49531 104 2 Bereits 2x geschweisst"
                        // Only extract material/shape if we haven't found them yet
                        if (string.IsNullOrEmpty(metadata.Material) || string.IsNullOrEmpty(metadata.Shape))
                        {
                            ExtractMaterialAndShape(value, metadata);
                        }
                    }
                    break;
            }
        }
        
        return metadata;
    }
    
    private static void ExtractMaterialAndShape(string railLabelValue, ExperimentMetadata metadata)
    {
        // Parse rail label values like:
        // "P65-2;DT350" → Shape: "P65-2", Material: "DT350"
        // "VI60E1;R260" → Shape: "VI60E1", Material: "R260"
        // "VI60E1;400UHC" → Shape: "VI60E1", Material: "400UHC"
        
        var parts = railLabelValue.Split(';');
        if (parts.Length >= 2)
        {
            var shape = parts[0].Trim();
            var material = parts[1].Trim();
            
            // Only set if we haven't already found them (prefer first occurrence)
            if (string.IsNullOrEmpty(metadata.Shape))
                metadata.Shape = shape;
            if (string.IsNullOrEmpty(metadata.Material))
                metadata.Material = material;
        }
    }
}