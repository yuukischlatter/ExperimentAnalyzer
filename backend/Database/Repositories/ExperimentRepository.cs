using System.Data;
using Dapper;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Models.Core;

namespace ExperimentAnalyzer.Database.Repositories;

public class ExperimentRepository : IExperimentRepository
{
    private readonly IDbConnection _connection;

    public ExperimentRepository(IDbConnection connection)
    {
        _connection = connection;
    }

    public async Task<bool> ExperimentExistsAsync(string experimentId)
    {
        const string sql = "SELECT COUNT(*) FROM experiments WHERE id = @ExperimentId";
        var count = await _connection.QuerySingleAsync<int>(sql, new { ExperimentId = experimentId });
        return count > 0;
    }

    public async Task<bool> MetadataExistsAsync(string experimentId)
    {
        const string sql = "SELECT COUNT(*) FROM experiment_metadata WHERE experiment_id = @ExperimentId";
        var count = await _connection.QuerySingleAsync<int>(sql, new { ExperimentId = experimentId });
        return count > 0;
    }

    public async Task<Experiment?> GetExperimentAsync(string experimentId)
    {
        const string sql = @"
            SELECT 
                id as Id,
                folder_path as FolderPath,
                experiment_date as ExperimentDate,
                created_at as CreatedAt,
                updated_at as UpdatedAt,
                has_bin_file as HasBinFile,
                has_acceleration_csv as HasAccelerationCsv,
                has_position_csv as HasPositionCsv,
                has_tensile_csv as HasTensileCsv,
                has_photos as HasPhotos,
                has_thermal_ravi as HasThermalRavi,
                has_tcp5_file as HasTcp5File,
                has_weld_journal as HasWeldJournal,
                has_crown_measurements as HasCrownMeasurements,
                has_ambient_temperature as HasAmbientTemperature
            FROM experiments 
            WHERE id = @ExperimentId";
        return await _connection.QuerySingleOrDefaultAsync<Experiment>(sql, new { ExperimentId = experimentId });
    }

    public async Task<ExperimentWithMetadata?> GetExperimentWithMetadataAsync(string experimentId)
    {
        const string sql = @"
            SELECT 
                e.id as Id,
                e.folder_path as FolderPath,
                e.experiment_date as ExperimentDate,
                e.created_at as CreatedAt,
                e.updated_at as UpdatedAt,
                e.has_bin_file as HasBinFile,
                e.has_acceleration_csv as HasAccelerationCsv,
                e.has_position_csv as HasPositionCsv,
                e.has_tensile_csv as HasTensileCsv,
                e.has_photos as HasPhotos,
                e.has_thermal_ravi as HasThermalRavi,
                e.has_tcp5_file as HasTcp5File,
                e.has_weld_journal as HasWeldJournal,
                e.has_crown_measurements as HasCrownMeasurements,
                e.has_ambient_temperature as HasAmbientTemperature,
                m.experiment_id as ExperimentId,
                m.program_number as ProgramNumber,
                m.program_name as ProgramName,
                m.material as Material,
                m.shape as Shape,
                m.operator as Operator,
                m.oil_temperature as OilTemperature,
                m.crown_measurement_interval as CrownMeasurementInterval,
                m.crown_einlauf_warm as CrownEinlaufWarm,
                m.crown_auslauf_warm as CrownAuslaufWarm,
                m.crown_einlauf_kalt as CrownEinlaufKalt,
                m.crown_auslauf_kalt as CrownAuslaufKalt,
                m.grinding_type as GrindingType,
                m.grinder as Grinder,
                m.comments as Comments,
                m.einlaufseite as Einlaufseite,
                m.auslaufseite as Auslaufseite,
                m.parsed_at as ParsedAt
            FROM experiments e
            LEFT JOIN experiment_metadata m ON e.id = m.experiment_id
            WHERE e.id = @ExperimentId";

        var result = await _connection.QueryAsync<Experiment, ExperimentMetadata?, ExperimentWithMetadata>(
            sql,
            (experiment, metadata) => new ExperimentWithMetadata 
            { 
                Experiment = experiment, 
                Metadata = metadata 
            },
            new { ExperimentId = experimentId },
            splitOn: "ExperimentId");

        return result.FirstOrDefault();
    }

    public async Task UpsertExperimentAsync(Experiment experiment)
    {
        const string sql = @"
            INSERT OR REPLACE INTO experiments (
                id, folder_path, experiment_date, created_at, updated_at,
                has_bin_file, has_acceleration_csv, has_position_csv, has_tensile_csv,
                has_photos, has_thermal_ravi, has_tcp5_file, has_weld_journal, 
                has_crown_measurements, has_ambient_temperature
            ) VALUES (
                @Id, @FolderPath, @ExperimentDate, @CreatedAt, @UpdatedAt,
                @HasBinFile, @HasAccelerationCsv, @HasPositionCsv, @HasTensileCsv,
                @HasPhotos, @HasThermalRavi, @HasTcp5File, @HasWeldJournal, 
                @HasCrownMeasurements, @HasAmbientTemperature
            )";

        await _connection.ExecuteAsync(sql, new
        {
            Id = experiment.Id,
            FolderPath = experiment.FolderPath,
            ExperimentDate = experiment.ExperimentDate?.ToString("yyyy-MM-dd"),
            CreatedAt = experiment.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss"),
            UpdatedAt = experiment.UpdatedAt.ToString("yyyy-MM-dd HH:mm:ss"),
            HasBinFile = experiment.HasBinFile ? 1 : 0,
            HasAccelerationCsv = experiment.HasAccelerationCsv ? 1 : 0,
            HasPositionCsv = experiment.HasPositionCsv ? 1 : 0,
            HasTensileCsv = experiment.HasTensileCsv ? 1 : 0,
            HasPhotos = experiment.HasPhotos ? 1 : 0,
            HasThermalRavi = experiment.HasThermalRavi ? 1 : 0,
            HasTcp5File = experiment.HasTcp5File ? 1 : 0,
            HasWeldJournal = experiment.HasWeldJournal ? 1 : 0,
            HasCrownMeasurements = experiment.HasCrownMeasurements ? 1 : 0,
            HasAmbientTemperature = experiment.HasAmbientTemperature ? 1 : 0
        });
    }

    public async Task UpsertMetadataAsync(ExperimentMetadata metadata)
    {
        // Set defaults if missing
        if (string.IsNullOrEmpty(metadata.ProgramNumber))
            metadata.ProgramNumber = "60";
        if (string.IsNullOrEmpty(metadata.ProgramName))
            metadata.ProgramName = "Standard";

        const string sql = @"
            INSERT OR REPLACE INTO experiment_metadata (
                experiment_id, program_number, program_name, material, shape, operator,
                oil_temperature, crown_measurement_interval, crown_einlauf_warm, 
                crown_auslauf_warm, crown_einlauf_kalt, crown_auslauf_kalt,
                grinding_type, grinder, comments, einlaufseite, auslaufseite, parsed_at
            ) VALUES (
                @ExperimentId, @ProgramNumber, @ProgramName, @Material, @Shape, @Operator,
                @OilTemperature, @CrownMeasurementInterval, @CrownEinlaufWarm,
                @CrownAuslaufWarm, @CrownEinlaufKalt, @CrownAuslaufKalt,
                @GrindingType, @Grinder, @Comments, @Einlaufseite, @Auslaufseite, @ParsedAt
            )";

        await _connection.ExecuteAsync(sql, metadata);
    }

    public async Task<List<Experiment>> GetExperimentsWithJournalsAsync()
    {
        const string sql = @"
            SELECT 
                id as Id,
                folder_path as FolderPath,
                experiment_date as ExperimentDate,
                created_at as CreatedAt,
                updated_at as UpdatedAt,
                has_bin_file as HasBinFile,
                has_acceleration_csv as HasAccelerationCsv,
                has_position_csv as HasPositionCsv,
                has_tensile_csv as HasTensileCsv,
                has_photos as HasPhotos,
                has_thermal_ravi as HasThermalRavi,
                has_tcp5_file as HasTcp5File,
                has_weld_journal as HasWeldJournal,
                has_crown_measurements as HasCrownMeasurements,
                has_ambient_temperature as HasAmbientTemperature
            FROM experiments 
            WHERE has_weld_journal = 1";
        var result = await _connection.QueryAsync<Experiment>(sql);
        return result.ToList();
    }

    public async Task<List<ExperimentWithMetadata>> GetAllExperimentsWithMetadataAsync()
    {
        const string sql = @"
            SELECT 
                e.id as Id,
                e.folder_path as FolderPath,
                e.experiment_date as ExperimentDate,
                e.created_at as CreatedAt,
                e.updated_at as UpdatedAt,
                e.has_bin_file as HasBinFile,
                e.has_acceleration_csv as HasAccelerationCsv,
                e.has_position_csv as HasPositionCsv,
                e.has_tensile_csv as HasTensileCsv,
                e.has_photos as HasPhotos,
                e.has_thermal_ravi as HasThermalRavi,
                e.has_tcp5_file as HasTcp5File,
                e.has_weld_journal as HasWeldJournal,
                e.has_crown_measurements as HasCrownMeasurements,
                e.has_ambient_temperature as HasAmbientTemperature,
                m.experiment_id as ExperimentId,
                m.program_number as ProgramNumber,
                m.program_name as ProgramName,
                m.material as Material,
                m.shape as Shape,
                m.operator as Operator,
                m.oil_temperature as OilTemperature,
                m.crown_measurement_interval as CrownMeasurementInterval,
                m.crown_einlauf_warm as CrownEinlaufWarm,
                m.crown_auslauf_warm as CrownAuslaufWarm,
                m.crown_einlauf_kalt as CrownEinlaufKalt,
                m.crown_auslauf_kalt as CrownAuslaufKalt,
                m.grinding_type as GrindingType,
                m.grinder as Grinder,
                m.comments as Comments,
                m.einlaufseite as Einlaufseite,
                m.auslaufseite as Auslaufseite,
                m.parsed_at as ParsedAt
            FROM experiments e
            LEFT JOIN experiment_metadata m ON e.id = m.experiment_id
            ORDER BY e.experiment_date DESC, e.id";

        var result = await _connection.QueryAsync<Experiment, ExperimentMetadata?, ExperimentWithMetadata>(
            sql,
            (experiment, metadata) => new ExperimentWithMetadata 
            { 
                Experiment = experiment, 
                Metadata = metadata 
            },
            splitOn: "ExperimentId");

        return result.ToList();
    }

    public async Task<List<ExperimentWithMetadata>> GetFilteredExperimentsAsync(
        string? filterBy = null, 
        string? filterValue = null,
        string sortBy = "date",
        string sortDirection = "desc")
    {
        var sql = @"
            SELECT 
                e.id as Id,
                e.folder_path as FolderPath,
                e.experiment_date as ExperimentDate,
                e.created_at as CreatedAt,
                e.updated_at as UpdatedAt,
                e.has_bin_file as HasBinFile,
                e.has_acceleration_csv as HasAccelerationCsv,
                e.has_position_csv as HasPositionCsv,
                e.has_tensile_csv as HasTensileCsv,
                e.has_photos as HasPhotos,
                e.has_thermal_ravi as HasThermalRavi,
                e.has_tcp5_file as HasTcp5File,
                e.has_weld_journal as HasWeldJournal,
                e.has_crown_measurements as HasCrownMeasurements,
                e.has_ambient_temperature as HasAmbientTemperature,
                m.experiment_id as ExperimentId,
                m.program_number as ProgramNumber,
                m.program_name as ProgramName,
                m.material as Material,
                m.shape as Shape,
                m.operator as Operator,
                m.oil_temperature as OilTemperature,
                m.crown_measurement_interval as CrownMeasurementInterval,
                m.crown_einlauf_warm as CrownEinlaufWarm,
                m.crown_auslauf_warm as CrownAuslaufWarm,
                m.crown_einlauf_kalt as CrownEinlaufKalt,
                m.crown_auslauf_kalt as CrownAuslaufKalt,
                m.grinding_type as GrindingType,
                m.grinder as Grinder,
                m.comments as Comments,
                m.einlaufseite as Einlaufseite,
                m.auslaufseite as Auslaufseite,
                m.parsed_at as ParsedAt
            FROM experiments e
            LEFT JOIN experiment_metadata m ON e.id = m.experiment_id";

        var whereClause = "";
        var orderClause = GetOrderClause(sortBy, sortDirection);

        if (!string.IsNullOrEmpty(filterBy) && !string.IsNullOrEmpty(filterValue))
        {
            whereClause = filterBy.ToLowerInvariant() switch
            {
                "operator" => " WHERE m.operator LIKE @FilterValue",
                "program" => " WHERE (m.program_number LIKE @FilterValue OR m.program_name LIKE @FilterValue)",
                "material" => " WHERE m.material LIKE @FilterValue",
                "shape" => " WHERE m.shape LIKE @FilterValue",
                _ => ""
            };
        }

        sql += whereClause + orderClause;

        var parameters = new { FilterValue = $"%{filterValue}%" };

        var result = await _connection.QueryAsync<Experiment, ExperimentMetadata?, ExperimentWithMetadata>(
            sql,
            (experiment, metadata) => new ExperimentWithMetadata 
            { 
                Experiment = experiment, 
                Metadata = metadata 
            },
            parameters,
            splitOn: "ExperimentId");

        return result.ToList();
    }

    public async Task InitializeDatabaseAsync()
    {
        // Read and execute schema files
        var baseDir = Directory.GetCurrentDirectory();
        var schemaPath = Path.Combine(baseDir, "Database", "Schema", "DatabaseSchema.sql");
        var indexPath = Path.Combine(baseDir, "Database", "Schema", "Indexes.sql");

        if (File.Exists(schemaPath))
        {
            var schema = await File.ReadAllTextAsync(schemaPath);
            await _connection.ExecuteAsync(schema);
        }

        if (File.Exists(indexPath))
        {
            var indexes = await File.ReadAllTextAsync(indexPath);
            await _connection.ExecuteAsync(indexes);
        }
    }

    public async Task<int> GetExperimentCountAsync()
    {
        const string sql = "SELECT COUNT(*) FROM experiments";
        return await _connection.QuerySingleAsync<int>(sql);
    }

    private static string GetOrderClause(string sortBy, string sortDirection)
    {
        var isDesc = sortDirection.ToLowerInvariant() == "desc";
        var direction = isDesc ? "DESC" : "ASC";

        return sortBy.ToLowerInvariant() switch
        {
            "date" => $" ORDER BY e.experiment_date {direction}, e.id {direction}",
            "id" => $" ORDER BY e.id {direction}",
            "operator" => $" ORDER BY m.operator {direction}",
            "program" => $" ORDER BY m.program_number {direction}",
            "material" => $" ORDER BY m.material {direction}",
            "shape" => $" ORDER BY m.shape {direction}",
            _ => " ORDER BY e.experiment_date DESC, e.id DESC"
        };
    }
}