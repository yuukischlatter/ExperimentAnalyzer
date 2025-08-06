namespace ExperimentAnalyzer.Models.Core;

public class Experiment
{
    public string Id { get; set; } = string.Empty;
    public string FolderPath { get; set; } = string.Empty;
    public DateTime? ExperimentDate { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    
    // File availability flags (populated by DirectoryScanner)
    public bool HasBinFile { get; set; }
    public bool HasAccelerationCsv { get; set; }
    public bool HasPositionCsv { get; set; }
    public bool HasTensileCsv { get; set; }
    public bool HasThermalRavi { get; set; }
    public bool HasTcp5File { get; set; }
    public bool HasWeldJournal { get; set; }
    public bool HasCrownMeasurements { get; set; }
    public bool HasAmbientTemperature { get; set; }
    public bool HasPhotos { get; set; }
}