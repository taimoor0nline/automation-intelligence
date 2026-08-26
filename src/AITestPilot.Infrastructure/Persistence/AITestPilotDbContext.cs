using System.Text.Json;
using AITestPilot.Application.Abstractions.Identity;
using AITestPilot.Domain.Auditing;
using AITestPilot.Domain.Common;
using AITestPilot.Domain.Identity;
using AITestPilot.Domain.Projects;
using AITestPilot.Domain.Testing;
using AITestPilot.Domain.Workspaces;
using AITestPilot.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace AITestPilot.Infrastructure.Persistence;

public sealed class AITestPilotDbContext : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>
{
    private readonly ICurrentUserContext? _currentUser;

    public AITestPilotDbContext(
        DbContextOptions<AITestPilotDbContext> options,
        ICurrentUserContext? currentUser = null) : base(options) => _currentUser = currentUser;

    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<WorkspaceMembership> WorkspaceMemberships => Set<WorkspaceMembership>();
    public DbSet<ProjectCategory> ProjectCategories => Set<ProjectCategory>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectEnvironment> ProjectEnvironments => Set<ProjectEnvironment>();
    public DbSet<TestCase> TestCases => Set<TestCase>();
    public DbSet<TestRun> TestRuns => Set<TestRun>();
    public DbSet<TestRunCase> TestRunCases => Set<TestRunCase>();
    public DbSet<TestResult> TestResults => Set<TestResult>();
    public DbSet<TestAssertionResult> TestAssertionResults => Set<TestAssertionResult>();
    public DbSet<TestNetworkEvent> TestNetworkEvents => Set<TestNetworkEvent>();
    public DbSet<TestBrowserEvent> TestBrowserEvents => Set<TestBrowserEvent>();
    public DbSet<TestArtifact> TestArtifacts => Set<TestArtifact>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Workspace>().ToTable("workspaces");
        builder.Entity<WorkspaceMembership>().ToTable("workspace_memberships");
        builder.Entity<ProjectCategory>().ToTable("project_categories");
        builder.Entity<Project>().ToTable("projects");
        builder.Entity<ProjectEnvironment>().ToTable("project_environments");
        builder.Entity<TestCase>().ToTable("test_cases");
        builder.Entity<TestRun>().ToTable("test_runs");
        builder.Entity<TestRunCase>().ToTable("test_run_cases");
        builder.Entity<TestResult>().ToTable("test_results");
        builder.Entity<TestAssertionResult>().ToTable("test_assertion_results");
        builder.Entity<TestNetworkEvent>().ToTable("test_network_events");
        builder.Entity<TestBrowserEvent>().ToTable("test_browser_events");
        builder.Entity<TestArtifact>().ToTable("test_artifacts");
        builder.Entity<AuditEvent>().ToTable("audit_events");

        ConfigureIdentityTables(builder);
        ConfigureIndexes(builder);
        ConfigureJson(builder);
        ConfigureLengths(builder);
        ApplySnakeCaseColumns(builder);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        StampAuditing();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        StampAuditing();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private static void ConfigureIdentityTables(ModelBuilder builder)
    {
        builder.Entity<ApplicationUser>().ToTable("users");
        builder.Entity<IdentityRole<Guid>>().ToTable("roles");
        builder.Entity<IdentityUserRole<Guid>>().ToTable("user_roles");
        builder.Entity<IdentityUserClaim<Guid>>().ToTable("user_claims");
        builder.Entity<IdentityUserLogin<Guid>>().ToTable("user_logins");
        builder.Entity<IdentityRoleClaim<Guid>>().ToTable("role_claims");
        builder.Entity<IdentityUserToken<Guid>>().ToTable("user_tokens");
    }

    private static void ConfigureIndexes(ModelBuilder builder)
    {
        builder.Entity<Workspace>().HasIndex(value => value.Code).IsUnique();
        builder.Entity<WorkspaceMembership>().HasIndex(value => new { value.WorkspaceId, value.UserId }).IsUnique();
        builder.Entity<ProjectCategory>().HasIndex(value => new { value.WorkspaceId, value.Code }).IsUnique();
        builder.Entity<Project>().HasIndex(value => new { value.WorkspaceId, value.Code }).IsUnique();
        builder.Entity<ProjectEnvironment>().HasIndex(value => new { value.WorkspaceId, value.ProjectId, value.Name }).IsUnique();
        builder.Entity<ProjectEnvironment>()
            .HasIndex(value => new { value.WorkspaceId, value.ProjectId, value.IsDefault })
            .IsUnique()
            .HasFilter("is_default = TRUE");
        builder.Entity<TestCase>().HasIndex(value => new { value.WorkspaceId, value.ProjectId, value.TestCaseNumber }).IsUnique();
        builder.Entity<TestRun>().HasIndex(value => new { value.WorkspaceId, value.ProjectId, value.RunNumber }).IsUnique();
        builder.Entity<TestRunCase>().HasIndex(value => new { value.WorkspaceId, value.TestRunId, value.Sequence }).IsUnique();
        builder.Entity<TestRunCase>().HasIndex(value => new { value.WorkspaceId, value.TestRunId, value.TestCaseId }).IsUnique();
        builder.Entity<TestResult>().HasIndex(value => new { value.WorkspaceId, value.TestRunId, value.TestCaseId }).IsUnique();
        builder.Entity<TestAssertionResult>().HasIndex(value => new { value.WorkspaceId, value.TestRunId, value.TestCaseId, value.Sequence });
        builder.Entity<TestNetworkEvent>().HasIndex(value => new { value.WorkspaceId, value.TestRunId, value.OccurredAtUtc });
        builder.Entity<TestBrowserEvent>().HasIndex(value => new { value.WorkspaceId, value.TestRunId, value.OccurredAtUtc });
        builder.Entity<TestArtifact>().HasIndex(value => new { value.WorkspaceId, value.TestRunId, value.TestResultId });
        builder.Entity<AuditEvent>().HasIndex(value => new { value.WorkspaceId, value.OccurredAtUtc });
    }

    private static void ConfigureJson(ModelBuilder builder)
    {
        builder.Entity<TestCase>()
            .Property(value => value.Definition)
            .HasColumnType("jsonb")
            .HasConversion(
                value => SerializeDefinition(value),
                value => DeserializeDefinition(value));

        builder.Entity<TestRunCase>()
            .Property(value => value.DefinitionSnapshot)
            .HasColumnType("jsonb")
            .HasConversion(
                value => SerializeDefinition(value),
                value => DeserializeDefinition(value));
    }

    private static void ConfigureLengths(ModelBuilder builder)
    {
        builder.Entity<ApplicationUser>().Property(value => value.DisplayName).HasMaxLength(200);
        builder.Entity<TestRun>().Property(value => value.Browser).HasMaxLength(50);
        builder.Entity<TestRun>().Property(value => value.ExecutionEngine).HasMaxLength(50);
        builder.Entity<TestRunCase>().Property(value => value.TestCaseNumberSnapshot).HasMaxLength(50);
        builder.Entity<TestRunCase>().Property(value => value.TitleSnapshot).HasMaxLength(300);
        builder.Entity<TestArtifact>().Property(value => value.StorageProvider).HasMaxLength(100);
        builder.Entity<TestArtifact>().Property(value => value.ContentType).HasMaxLength(200);
    }

    private static string SerializeDefinition(TestDefinition value) =>
        JsonSerializer.Serialize(value, (JsonSerializerOptions?)null);

    private static TestDefinition DeserializeDefinition(string value) =>
        JsonSerializer.Deserialize<TestDefinition>(value, (JsonSerializerOptions?)null)
        ?? new TestDefinition(1, [], []);

    private void StampAuditing()
    {
        var now = DateTimeOffset.UtcNow;
        var userId = _currentUser is { IsAuthenticated: true }
            ? _currentUser.UserId
            : (Guid?)null;

        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Property(nameof(AuditableEntity.CreatedAtUtc)).CurrentValue = now;
                entry.Property(nameof(AuditableEntity.CreatedByUserId)).CurrentValue = userId;
            }

            if (entry.State is EntityState.Added or EntityState.Modified)
            {
                entry.Property(nameof(AuditableEntity.UpdatedAtUtc)).CurrentValue = now;
                entry.Property(nameof(AuditableEntity.UpdatedByUserId)).CurrentValue = userId;
            }
        }
    }

    private static void ApplySnakeCaseColumns(ModelBuilder builder)
    {
        foreach (var entityType in builder.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                property.SetColumnName(ToSnakeCase(property.Name));
            }
        }
    }

    private static string ToSnakeCase(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;
        var chars = new List<char>(value.Length + 8);
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (char.IsUpper(character) && index > 0) chars.Add('_');
            chars.Add(char.ToLowerInvariant(character));
        }
        return new string([.. chars]);
    }
}
