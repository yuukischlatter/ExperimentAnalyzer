namespace ExperimentAnalyzer.Models.Core;

public class ExperimentMetadata
{
    public string ExperimentId { get; set; } = string.Empty;
    public string? ProgramNumber { get; set; }
    public string? ProgramName { get; set; }
    public string? Material { get; set; }
    public string? Shape { get; set; }
    public string? Operator { get; set; }
    public decimal? OilTemperature { get; set; }
    public int? CrownMeasurementInterval { get; set; }
    public decimal? CrownEinlaufWarm { get; set; }
    public decimal? CrownAuslaufWarm { get; set; }
    public decimal? CrownEinlaufKalt { get; set; }
    public decimal? CrownAuslaufKalt { get; set; }
    public string? GrindingType { get; set; }
    public string? Grinder { get; set; }
    public string? Comments { get; set; }
    public string? Einlaufseite { get; set; }
    public string? Auslaufseite { get; set; }
    public DateTime ParsedAt { get; set; }
}